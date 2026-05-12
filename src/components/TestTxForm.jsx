import { useState } from 'react';
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

export default function TestTxForm({ onClose }) {
  const [txType, setTxType] = useState('incoming');
  const [txToken, setTxToken] = useState('ETH');
  const [txFrom, setTxFrom] = useState('');
  const [txTo, setTxTo] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txUsd, setTxUsd] = useState('');
  const [error, setError] = useState('');

  const createTransaction = () => {
    setError('');
    
    if (!txAmount || parseFloat(txAmount) <= 0) { 
      setError('Введите корректное количество'); 
      return; 
    }
    if (!txFrom) { 
      setError('Введите адрес отправителя'); 
      return; 
    }
    if (!isValidAddress(txFrom)) {
      setError('Неверный формат адреса отправителя');
      return;
    }
    if (!txTo) { 
      setError('Введите адрес получателя'); 
      return; 
    }
    if (!isValidAddress(txTo)) {
      setError('Неверный формат адреса получателя');
      return;
    }

    const newTx = {
      id: Date.now(),
      type: txType,
      token: txToken,
      from: txFrom,
      to: txTo,
      amount: parseFloat(txAmount),
      usdAmount: parseFloat(txUsd) || (parseFloat(txAmount) * 2000),
      timestamp: new Date().toISOString(),
      status: 'completed'
    };

    const transactions = JSON.parse(localStorage.getItem('test_transactions') || '[]');
    transactions.unshift(newTx);
    localStorage.setItem('test_transactions', JSON.stringify(transactions));

    // Update balance - incoming adds, outgoing subtracts
    const currentBalance = parseFloat(localStorage.getItem('test_balance') || '0');
    const newBalance = txType === 'incoming'
      ? currentBalance + parseFloat(txAmount)
      : currentBalance - parseFloat(txAmount);
    localStorage.setItem('test_balance', newBalance.toString());

    // Also update real wallet display
    const walletBalance = localStorage.getItem('wallet_balance_' + txToken);
    if (walletBalance) {
      const realBal = parseFloat(walletBalance);
      const updatedRealBal = txType === 'incoming'
        ? realBal + parseFloat(txAmount)
        : realBal - parseFloat(txAmount);
      localStorage.setItem('wallet_balance_' + txToken, updatedRealBal.toString());
    }

    if (onClose) onClose();
    window.location.reload();
  };

  const tokens = ['ETH', 'USDT', 'BNB', 'SOL', 'TON'];
  const bg = { incoming: '#052e16', outgoing: '#2d0c0c' };
  const Icon = txType === 'incoming' ? ArrowDownLeft : ArrowUpRight;

  return (
    <div style={{ 
      background: '#111', 
      borderRadius: 16, 
      padding: 20, 
      margin: '0 0 20px',
      border: '1px solid rgba(255,255,255,0.08)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Создать транзакцию</span>
        {onClose && (
          <button onClick={onClose} style={{ 
            width: 32, height: 32, borderRadius: '50%', background: '#1a1a1a',
            border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' 
          }}>
            <X size={18} color="#fff" />
          </button>
        )}
      </div>

      {/* Type Selection */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['incoming', 'outgoing'].map(t => (
          <button
            key={t}
            onClick={() => setTxType(t)}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: 12,
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              background: txType === t ? (t === 'incoming' ? '#10b981' : '#ef4444') : '#1a1a1a',
              color: txType === t ? '#fff' : 'rgba(255,255,255,0.5)',
              fontSize: 14,
              fontWeight: 600
            }}
          >
            {t === 'incoming' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
            {t === 'incoming' ? 'Входящая' : 'Исходящая'}
          </button>
        ))}
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
          placeholder="0x... (Ethereum/BNB) или Solana/TON адрес"
          value={txFrom}
          onChange={(e) => setTxFrom(e.target.value)}
          style={{
            width: '100%',
            padding: '12px',
            background: '#1a1a1a',
            border: `1px solid ${txFrom && !isValidAddress(txFrom) ? '#ef4444' : '#333'}`,
            borderRadius: 12,
            color: '#fff',
            fontSize: 14,
            outline: 'none'
          }}
        />
        {txFrom && !isValidAddress(txFrom) && (
          <span style={{ fontSize: 11, color: '#ef4444', marginTop: 4, display: 'block' }}>Неверный формат адреса</span>
        )}
      </div>

      {/* To Address */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>Адрес получателя</label>
        <input
          type="text"
          placeholder="0x... (Ethereum/BNB) или Solana/TON адрес"
          value={txTo}
          onChange={(e) => setTxTo(e.target.value)}
          style={{
            width: '100%',
            padding: '12px',
            background: '#1a1a1a',
            border: `1px solid ${txTo && !isValidAddress(txTo) ? '#ef4444' : '#333'}`,
            borderRadius: 12,
            color: '#fff',
            fontSize: 14,
            outline: 'none'
          }}
        />
        {txTo && !isValidAddress(txTo) && (
          <span style={{ fontSize: 11, color: '#ef4444', marginTop: 4, display: 'block' }}>Неверный формат адреса</span>
        )}
      </div>

      {/* Amount */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>Количество</label>
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

      {/* USD Amount */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>Сумма в USD (опционально)</label>
        <input
          type="number"
          placeholder="0.00"
          value={txUsd}
          onChange={(e) => setTxUsd(e.target.value)}
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
          background: txType === 'incoming' ? '#10b981' : '#ef4444',
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
        Создать {txType === 'incoming' ? 'входящую' : 'исходящую'} транзакцию
      </button>
    </div>
  );
}
