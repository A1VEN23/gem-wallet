import { useState } from 'react';
import { X, Plus } from 'lucide-react';

// Address validation - always returns true to accept any data
const isValidAddress = (addr) => {
  return true;
};

export default function TestTxForm({ onClose, onCreateTx, addresses, prices }) {
  const [txToken, setTxToken] = useState('ETH');
  const [txFrom, setTxFrom] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [error, setError] = useState('');

  // Map token to network ID
  const tokenToNetwork = {
    'ETH': 'ethereum',
    'USDT': 'ethereum',
    'BNB': 'bsc',
    'SOL': 'solana',
    'TON': 'ton'
  };

  // Get addresses from props or localStorage
  const getAddresses = () => {
    if (addresses && typeof addresses === 'object') return addresses;
    const stored = localStorage.getItem('wallet_addresses');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return {};
      }
    }
    return {};
  };

  const createTransaction = async () => {
    setError('');
    
    if (!txAmount || parseFloat(txAmount) <= 0) { 
      setError('Введите корректное количество'); 
      return; 
    }
    if (!txFrom) { 
      setError('Введите адрес отправителя'); 
      return; 
    }

    const addrMap = getAddresses();
    const tokenToAssetId = {
      ETH: 'eth',
      USDT: 'eth',
      BNB: 'bnb',
      SOL: 'sol',
      TON: 'ton',
      ARB: 'arb',
      LTC: 'ltc',
    };
    const network = tokenToNetwork[txToken] || 'ethereum';
    const amount = parseFloat(txAmount);
    const usd = (prices?.[txToken] || 0) * amount;
    const myAddress = addrMap[tokenToAssetId[txToken]] || addrMap[network] || 'My Wallet';

    if (typeof onCreateTx === 'function') {
      onCreateTx({ sym: txToken, amount, from: txFrom, usd, isTest: true });
      if (onClose) onClose();
      return;
    }

    const newTx = {
      id: Date.now(),
      type: 'incoming',
      token: txToken,
      sym: txToken,
      from: txFrom,
      to: myAddress,
      amount,
      usdAmount: usd,
      timestamp: new Date().toISOString(),
      status: 'completed'
    };

    const transactions = JSON.parse(localStorage.getItem('test_transactions') || '[]');
    transactions.unshift(newTx);
    localStorage.setItem('test_transactions', JSON.stringify(transactions));

    // Update real wallet balance
    const walletBalanceKey = 'wallet_balance_' + txToken;
    const currentWalletBal = parseFloat(localStorage.getItem(walletBalanceKey) || '0');
    const updatedWalletBal = currentWalletBal + amount;
    localStorage.setItem(walletBalanceKey, updatedWalletBal.toString());

    if (onClose) onClose();
    // Dispatch storage event so other components can update
    window.dispatchEvent(new Event('storage'));
  };

  const tokens = ['ETH', 'USDT', 'BNB', 'SOL', 'TON'];

  return (
    <div style={{ 
      background: '#111', 
      borderRadius: 16, 
      padding: 20, 
      margin: '0 0 20px',
      border: '1px solid rgba(255,255,255,0.08)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Создать входящую транзакцию</span>
        {onClose && (
          <button onClick={onClose} style={{ 
            width: 32, height: 32, borderRadius: '50%', background: '#1a1a1a',
            border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' 
          }}>
            <X size={18} color="#fff" />
          </button>
        )}
      </div>

      {/* Token Selection */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>Токен</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tokens.map(t => (
            <button
              key={t}
              onClick={() => setTxToken(t)}
              style={{
                padding: '8px 16px',
                borderRadius: 20,
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                background: txToken === t ? '#2563eb' : '#1a1a1a',
                color: txToken === t ? '#fff' : 'rgba(255,255,255,0.5)'
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* From Address */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>Адрес отправителя</label>
        <input
          type="text"
          placeholder="Любой адрес отправителя"
          value={txFrom}
          onChange={(e) => setTxFrom(e.target.value)}
          style={{
            width: '100%',
            padding: '12px',
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: 12,
            color: '#fff',
            fontSize: 14,
            outline: 'none'
          }}
        />
      </div>

      {/* Amount */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>Сумма в токенах</label>
        <input
          type="number"
          placeholder="0.0"
          value={txAmount}
          onChange={(e) => setTxAmount(e.target.value)}
          style={{
            width: '100%',
            padding: '12px',
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: 12,
            color: '#fff',
            fontSize: 14,
            outline: 'none'
          }}
        />
      </div>

      {error && (
        <div style={{ 
          background: 'rgba(239,68,68,0.1)', 
          border: '1px solid rgba(239,68,68,0.3)', 
          borderRadius: 8, 
          padding: '10px 12px',
          marginBottom: 12
        }}>
          <span style={{ fontSize: 13, color: '#ef4444' }}>{error}</span>
        </div>
      )}

      <button
        onClick={createTransaction}
        style={{
          width: '100%',
          padding: '14px',
          background: '#10b981',
          border: 'none',
          borderRadius: 12,
          color: '#fff',
          fontSize: 15,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8
        }}
      >
        <Plus size={20} />
        Создать входящую транзакцию
      </button>
    </div>
  );
}
