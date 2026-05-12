import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext.jsx';
import NetworkIcon from '../components/NetworkIcon.jsx';

export default function Wallet() {
  const { addresses, balances, networks, activeNetwork, setActiveNetwork, refreshBalance, lock } = useWallet();
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showQuickTx, setShowQuickTx] = useState(false);
  const [txType, setTxType] = useState('incoming');
  const [txAmount, setTxAmount] = useState('');
  const [txToken, setTxToken] = useState('ETH');
  const [txFrom, setTxFrom] = useState('');
  const [txTo, setTxTo] = useState('');
  const [txFee, setTxFee] = useState('');
  const [txUsd, setTxUsd] = useState('');
  const [feeMode, setFeeMode] = useState('standard');
  const [txTimer, setTxTimer] = useState(null);
  const navigate = useNavigate();

  const net = networks[activeNetwork];
  const address = addresses[activeNetwork];
  const realBalance = balances[activeNetwork] || '0';
  
  // Check if test balance exists and use it
  const testBalance = localStorage.getItem('test_balance');
  const balance = testBalance ? parseFloat(testBalance).toFixed(6) : realBalance;

  useEffect(() => {
    if (address) refreshBalance(activeNetwork);
  }, [activeNetwork, address, refreshBalance]);

  const handleCopy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshBalance(activeNetwork);
    setRefreshing(false);
  };

  const STANDARD_FEE = 0.002;

  const getFeeValue = () => {
    if (feeMode === 'standard') return STANDARD_FEE;
    if (feeMode === 'fast') return STANDARD_FEE * 2;
    return parseFloat(txFee) || 0;
  };

  const getTimer = () => {
    if (feeMode === 'standard') return '1-2 мин';
    if (feeMode === 'fast') return '30-60 сек';
    const customVal = parseFloat(txFee) || 0;
    if (customVal < STANDARD_FEE) return '30-60 мин';
    if (customVal >= STANDARD_FEE * 2) return '30-60 сек';
    return '1-2 мин';
  };

  const createQuickTransaction = () => {
    if (!txAmount) { alert('Введите количество'); return; }
    if (!txFrom) { alert('Введите адрес отправителя'); return; }
    if (!txTo) { alert('Введите адрес получателя'); return; }

    const feeVal = getFeeValue();
    const timer = getTimer();

    const newTx = {
      id: Date.now(),
      type: txType,
      token: txToken,
      from: txFrom,
      to: txTo,
      amount: parseFloat(txAmount),
      fee: feeVal,
      feeMode: feeMode,
      usdAmount: parseFloat(txUsd) || (parseFloat(txAmount) * 2000),
      timer: timer,
      timestamp: new Date().toISOString(),
      status: 'completed'
    };

    const transactions = JSON.parse(localStorage.getItem('test_transactions') || '[]');
    transactions.unshift(newTx);
    localStorage.setItem('test_transactions', JSON.stringify(transactions));

    const currentBalance = parseFloat(localStorage.getItem('test_balance') || '0');
    const newBalance = txType === 'incoming' 
      ? currentBalance + parseFloat(txAmount)
      : currentBalance - parseFloat(txAmount) - feeVal;
    localStorage.setItem('test_balance', newBalance.toString());

    setTxTimer(timer);
    alert(`${txType === 'incoming' ? 'Входящая' : 'Исходящая'} транзакция создана!\nКомиссия: ${feeVal} | Таймер: ${timer}`);
    setTxAmount(''); setTxFrom(''); setTxTo(''); setTxFee(''); setTxUsd('');
    setShowQuickTx(false);
    window.location.reload();
  };

  const shortAddr = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : '—';

  return (
    <div className="wallet-page">
      {/* Header */}
      <div className="wallet-header">
        <span className="wallet-title">Gem Wallet</span>
        <div className="header-actions">
          <button className="icon-btn" onClick={handleRefresh} title="Обновить">
            <span className={refreshing ? 'spin' : ''}>↻</span>
          </button>
          <button 
            className="icon-btn" 
            onClick={() => navigate('/settings')} 
            title="Тестовый режим"
            style={{ 
              background: localStorage.getItem('test_balance') ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'var(--bg2)',
              color: localStorage.getItem('test_balance') ? '#fff' : 'var(--text)'
            }}
          >
            🧪
          </button>
          <button className="icon-btn" onClick={() => navigate('/settings')} title="Настройки">
            ⚙
          </button>
        </div>
      </div>

      {/* Balance Card */}
      <div className="balance-card" style={{ '--net-color': net?.color }}>
        <div className="net-badge">
          <NetworkIcon network={net} size={28} />
          <span>{net?.name}</span>
          {testBalance && <span style={{ 
            background: '#f59e0b', 
            color: '#fff', 
            fontSize: '10px', 
            padding: '2px 6px', 
            borderRadius: '4px', 
            marginLeft: '8px',
            fontWeight: '600'
          }}>ТЕСТ</span>}
        </div>
        <div className="balance-amount">
          <span className="balance-num">{parseFloat(balance).toFixed(6)}</span>
          <span className="balance-sym">{net?.symbol}</span>
        </div>
        <div className="address-row" onClick={handleCopy}>
          <span className="addr-text">{shortAddr}</span>
          <span className="copy-icon">{copied ? '✓' : '⎘'}</span>
        </div>
        {testBalance && (
          <div style={{ 
            marginTop: '8px', 
            fontSize: '11px', 
            color: '#f59e0b', 
            textAlign: 'center',
            fontWeight: '500'
          }}>
            Тестовый режим (создано транзакций: {JSON.parse(localStorage.getItem('test_transactions') || '[]').length})
          </div>
        )}
      </div>

      {/* Quick Transaction Button */}
      <div style={{ margin: '0 16px 16px' }}>
        <button onClick={() => setShowQuickTx(!showQuickTx)} style={{ width: '100%', padding: '16px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '16px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', boxShadow: '0 4px 12px rgba(16,185,129,0.3)' }}>💰 СОЗДАТЬ ТРАНЗАКЦИЮ</button>

        {showQuickTx && (
          <div style={{ 
            marginTop: '12px', 
            padding: '16px', 
            background: 'var(--card)', 
            border: '2px solid #10b981', 
            borderRadius: '12px' 
          }}>
            <h4 style={{ margin: '0 0 12px 0', color: '#10b981', textAlign: 'center', fontSize: '16px' }}>💰 СОЗДАНИЕ ТРАНЗАКЦИИ</h4>
            
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'var(--text3)' }}>Тип:</label>
              <select value={txType} onChange={(e) => setTxType(e.target.value)} style={{ width: '100%', padding: '8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px' }}>
                <option value="incoming">Входящая</option>
                <option value="outgoing">Исходящая</option>
              </select>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'var(--text3)' }}>Токен:</label>
              <select value={txToken} onChange={(e) => setTxToken(e.target.value)} style={{ width: '100%', padding: '8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px' }}>
                <option value="ETH">ETH</option>
                <option value="USDT">USDT</option>
                <option value="BNB">BNB</option>
                <option value="SOL">SOL</option>
                <option value="TON">TON</option>
              </select>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'var(--text3)' }}>Адрес отправителя:</label>
              <input type="text" placeholder="0x..." value={txFrom} onChange={(e) => setTxFrom(e.target.value)} style={{ width: '100%', padding: '8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px' }} />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'var(--text3)' }}>Адрес получателя:</label>
              <input type="text" placeholder="0x..." value={txTo} onChange={(e) => setTxTo(e.target.value)} style={{ width: '100%', padding: '8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px' }} />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'var(--text3)' }}>Количество:</label>
              <input type="number" placeholder="0.0" value={txAmount} onChange={(e) => setTxAmount(e.target.value)} style={{ width: '100%', padding: '8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px' }} />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'var(--text3)' }}>Сумма USD:</label>
              <input type="number" placeholder="0.0" value={txUsd} onChange={(e) => setTxUsd(e.target.value)} style={{ width: '100%', padding: '8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px' }} />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'var(--text3)' }}>Комиссия:</label>
              <select value={feeMode} onChange={(e) => { setFeeMode(e.target.value); if (e.target.value === 'standard') setTxFee('0.002'); if (e.target.value === 'fast') setTxFee('0.004'); }} style={{ width: '100%', padding: '8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px' }}>
                <option value="standard">Стандартная (0.002)</option>
                <option value="fast">Быстрая (0.004)</option>
                <option value="custom">Кастомная</option>
              </select>
              {feeMode === 'custom' && (
                <input type="number" placeholder="Комиссия" value={txFee} onChange={(e) => setTxFee(e.target.value)} style={{ width: '100%', padding: '8px', marginTop: '8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px' }} />
              )}
            </div>

            <div style={{ marginBottom: '16px', padding: '10px', background: 'rgba(245,158,11,0.15)', borderRadius: '8px', textAlign: 'center' }}>
              <span style={{ fontSize: '12px', color: '#f59e0b', fontWeight: '600' }}>⏱ Таймер: {getTimer()}</span>
            </div>

            <button onClick={createQuickTransaction} style={{ width: '100%', padding: '12px', background: '#10b981', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>Создать</button>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="action-row">
        <button className="action-btn" onClick={() => navigate('/receive')}>
          <span className="action-icon">↓</span>
          <span>Получить</span>
        </button>
        <button className="action-btn" onClick={() => navigate('/send')}>
          <span className="action-icon">↑</span>
          <span>Отправить</span>
        </button>
      </div>

      {/* Network List */}
      <div className="section-title">Сети</div>
      <div className="network-list">
        {Object.values(networks).map(n => (
          <div
            key={n.id}
            className={`network-item ${activeNetwork === n.id ? 'active' : ''}`}
            onClick={() => setActiveNetwork(n.id)}
          >
            <NetworkIcon network={n} size={36} />
            <div className="net-info">
              <span className="net-name">{n.name}</span>
              <span className="net-addr">
                {addresses[n.id]
                  ? `${addresses[n.id].slice(0, 6)}...${addresses[n.id].slice(-4)}`
                  : '—'}
              </span>
            </div>
            <div className="net-balance">
              <span>{balances[n.id] ? parseFloat(balances[n.id]).toFixed(4) : '—'}</span>
              <span className="net-sym">{n.symbol}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
