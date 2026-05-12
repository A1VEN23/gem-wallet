import { useState, useEffect } from 'react';
import { X, Plus, ArrowDownLeft, ArrowUpRight } from 'lucide-react';

// Address validation - only valid crypto addresses allowed
const isValidAddress = (addr) => {
  // Ethereum / BNB / ARB - 0x followed by 40 hex chars
  if (/^0x[a-fA-F0-9]{40}$/.test(addr)) return true;
  // Solana - base58, 32-44 chars
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return true;
  // TON - EQ or UQ followed by base64
  if (/^(EQ|UQ)[a-zA-Z0-9_-]{43,46}$/.test(addr)) return true;
  return false;
};

// Storage helper duplicate to ensure consistency with GemWallet.jsx
const getTgUserId = () => {
  try {
    return window.Telegram?.WebApp?.initDataUnsafe?.user?.id || null;
  } catch { return null; }
};

const storageKey = (base) => {
  const uid = getTgUserId();
  return uid ? `${base}_${uid}` : base;
};

export default function TestTxForm({ onClose }) {
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

  // Get addresses from localStorage
  const getAddresses = () => {
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

    const addresses = getAddresses();
    const network = tokenToNetwork[txToken] || 'ethereum';
    const myAddress = addresses[network] || 'My Wallet';

    // Get current price for realistic USD amount
    let currentPrice = 0;
    try {
      const idsMap = {
        'ETH': 'ethereum', 'USDT': 'tether', 'BNB': 'binancecoin',
        'SOL': 'solana', 'TON': 'the-open-network'
      };
      const cgId = idsMap[txToken];
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`);
      const data = await res.json();
      currentPrice = data[cgId]?.usd || 0;
    } catch (e) {
      // Fallback prices
      const fallbacks = { 'ETH': 3500, 'USDT': 1, 'BNB': 600, 'SOL': 150, 'TON': 7 };
      currentPrice = fallbacks[txToken] || 0;
    }

    const usdVal = (parseFloat(txAmount) * currentPrice).toFixed(2);

    const newTx = {
      id: Date.now(),
      type: 'incoming',
      token: txToken,
      sym: txToken,
      from: txFrom,
      to: myAddress,
      addr: txFrom,
      amount: parseFloat(txAmount),
      usd: `+$${usdVal}`,
      usdAmount: parseFloat(usdVal),
      timestamp: Date.now(),
      time: new Date().toLocaleString('ru-RU', { 
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' 
      }),
      status: 'confirmed',
      network: network.charAt(0).toUpperCase() + network.slice(1),
      hash: '0x' + Array.from({length:64}, () => "0123456789abcdef"[Math.floor(Math.random()*16)]).join(""),
      block: "#" + Math.floor(19000000 + Math.random() * 500000).toLocaleString()
    };

    const transactions = JSON.parse(localStorage.getItem('test_transactions') || '[]');
    transactions.unshift(newTx);
    localStorage.setItem('test_transactions', JSON.stringify(transactions));

    // Update real wallet balance with storageKey support
    const walletBalanceKey = storageKey('gem_balances');
    try {
      const allBalances = JSON.parse(localStorage.getItem(walletBalanceKey) || '{}');
      allBalances[txToken] = (parseFloat(allBalances[txToken]) || 0) + parseFloat(txAmount);
      localStorage.setItem(walletBalanceKey, JSON.stringify(allBalances));
      
      // Fallback for older balance keys if any
      localStorage.setItem('wallet_balance_' + txToken, allBalances[txToken].toString());
    } catch(e) {
      console.error("Balance update failed", e);
    }

    // Also update global history with storageKey
    const globalHistoryKey = storageKey('gem_tx_history');
    try {
      const globalHistory = JSON.parse(localStorage.getItem(globalHistoryKey) || '[]');
      globalHistory.unshift({
        ...newTx,
        id: 'test_' + Date.now(),
        label: txToken
      });
      localStorage.setItem(globalHistoryKey, JSON.stringify(globalHistory.slice(0, 50)));
    } catch(e) {
      console.warn("Failed to update global history", e);
    }

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
