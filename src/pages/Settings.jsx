import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext.jsx';

export default function Settings() {
  const { lock, deleteWallet, getMnemonic } = useWallet();
  const [showSeed, setShowSeed] = useState(false);
  const [seedPassword, setSeedPassword] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [seedError, setSeedError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showTestMode, setShowTestMode] = useState(false);
  const [transactions, setTransactions] = useState(() => {
    const saved = localStorage.getItem('test_transactions');
    return saved ? JSON.parse(saved) : [];
  });
  const [txType, setTxType] = useState('incoming');
  const [token, setToken] = useState('ETH');
  const [amount, setAmount] = useState('');
  const [usdAmount, setUsdAmount] = useState('');
  const [commissionType, setCommissionType] = useState('normal'); // custom, fast, normal
  const [customCommission, setCustomCommission] = useState('');
  const navigate = useNavigate();

  const handleLock = () => {
    lock();
    // AppRoutes автоматически покажет Unlock когда isUnlocked станет false
  };

  const handleShowSeed = async () => {
    setSeedError('');
    try {
      const m = await getMnemonic(seedPassword);
      setMnemonic(m);
    } catch {
      setSeedError('Неверный пароль');
    }
  };

  const handleDelete = () => {
    deleteWallet();
    navigate('/');
  };

  const createTransaction = () => {
    if (!amount || !usdAmount) {
      alert('Заполните количество и USD сумму');
      return;
    }

    if (commissionType === 'custom' && !customCommission) {
      alert('Укажите кастомную комиссию');
      return;
    }

    // Calculate timer based on commission type
    let cancelTimerMinutes;
    if (commissionType === 'custom') {
      cancelTimerMinutes = Math.floor(Math.random() * 31) + 30; // 30-60 minutes
    } else {
      cancelTimerMinutes = 1; // 1 minute for fast/normal
    }

    const cancelTime = new Date(Date.now() + cancelTimerMinutes * 60 * 1000).toISOString();

    const newTx = {
      id: Date.now(),
      type: txType,
      token: token,
      amount: parseFloat(amount),
      usdAmount: parseFloat(usdAmount),
      commissionType: commissionType,
      customCommission: commissionType === 'custom' ? parseFloat(customCommission) : null,
      cancelTime: cancelTime,
      timestamp: new Date().toISOString(),
      status: 'pending'
    };

    const newTxs = [newTx, ...transactions];
    setTransactions(newTxs);
    localStorage.setItem('test_transactions', JSON.stringify(newTxs));

    // Start timer for transaction completion
    setTimeout(() => {
      const updatedTxs = JSON.parse(localStorage.getItem('test_transactions') || '[]');
      const txIndex = updatedTxs.findIndex(tx => tx.id === newTx.id);
      if (txIndex !== -1) {
        updatedTxs[txIndex].status = 'completed';
        localStorage.setItem('test_transactions', JSON.stringify(updatedTxs));
        setTransactions(updatedTxs);

        // Update balance only when completed
        const currentBalance = parseFloat(localStorage.getItem('test_balance') || '0');
        const newBalance = txType === 'incoming' 
          ? currentBalance + parseFloat(amount)
          : currentBalance - parseFloat(amount);
        localStorage.setItem('test_balance', newBalance.toString());
      }
    }, cancelTimerMinutes * 60 * 1000);

    // Clear form
    setAmount('');
    setUsdAmount('');
    setCustomCommission('');

    alert(`${txType === 'incoming' ? 'Входящая' : 'Исходящая'} транзакция создана!\nОтмена возможна через ${cancelTimerMinutes} минут`);
  };

  const deleteTransaction = (id) => {
    const txToDelete = transactions.find(tx => tx.id === id);
    if (!txToDelete) return;

    // Reverse balance change
    const currentBalance = parseFloat(localStorage.getItem('test_balance') || '0');
    const reversedBalance = txToDelete.type === 'incoming' 
      ? currentBalance - txToDelete.amount
      : currentBalance + txToDelete.amount;
    localStorage.setItem('test_balance', reversedBalance.toString());

    // Remove transaction
    const newTxs = transactions.filter(tx => tx.id !== id);
    setTransactions(newTxs);
    localStorage.setItem('test_transactions', JSON.stringify(newTxs));
  };

  const clearTestData = () => {
    if (confirm('Вы уверены, что хотите удалить все тестовые данные?')) {
      localStorage.removeItem('test_transactions');
      localStorage.removeItem('test_balance');
      setTransactions([]);
      alert('Тестовые данные удалены');
    }
  };

  return (
    <div className="settings-page">
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate('/wallet')}>← Назад</button>
        <h2>Настройки</h2>
        <div />
      </div>

      <div className="settings-section">
        <div className="settings-item" onClick={handleLock}>
          <span className="s-icon">🔒</span>
          <div className="s-info">
            <span className="s-title">Заблокировать</span>
            <span className="s-sub">Закрыть кошелёк</span>
          </div>
          <span className="s-arrow">›</span>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-item" onClick={() => setShowSeed(s => !s)}>
          <span className="s-icon">🔑</span>
          <div className="s-info">
            <span className="s-title">Показать seed-фразу</span>
            <span className="s-sub">Просмотр резервной копии</span>
          </div>
          <span className="s-arrow">{showSeed ? '∨' : '›'}</span>
        </div>

        {showSeed && !mnemonic && (
          <div className="settings-sub-form">
            <p className="hint warn">⚠️ Никому не показывайте seed-фразу</p>
            <input
              type="password"
              placeholder="Введите пароль"
              value={seedPassword}
              onChange={e => setSeedPassword(e.target.value)}
            />
            {seedError && <div className="error-msg">{seedError}</div>}
            <button className="btn-secondary" onClick={handleShowSeed}>Показать</button>
          </div>
        )}

        {mnemonic && (
          <div className="settings-sub-form">
            <div className="mnemonic-grid small">
              {mnemonic.split(' ').map((word, i) => (
                <div key={i} className="mnemonic-word">
                  <span className="word-num">{i + 1}</span>
                  <span className="word-text">{word}</span>
                </div>
              ))}
            </div>
            <button className="btn-secondary" onClick={() => { setMnemonic(''); setSeedPassword(''); }}>
              Скрыть
            </button>
          </div>
        )}
      </div>

      {/* Test Mode Section */}
      <div className="settings-section">
        <div className="settings-item" onClick={() => setShowTestMode(s => !s)}>
          <span className="s-icon">🧪</span>
          <div className="s-info">
            <span className="s-title">Тестовый режим</span>
            <span className="s-sub">Создание тестовых транзакций</span>
          </div>
          <span className="s-arrow">{showTestMode ? '∨' : '›'}</span>
        </div>

        {showTestMode && (
          <div className="settings-sub-form">
            {/* Transaction Creation Form */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'var(--text3)' }}>
                Тип транзакции:
              </label>
              <select 
                value={txType} 
                onChange={(e) => setTxType(e.target.value)}
                style={{ width: '100%', padding: '8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px' }}
              >
                <option value="incoming">Входящая</option>
                <option value="outgoing">Исходящая</option>
              </select>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'var(--text3)' }}>
                Токен:
              </label>
              <select 
                value={token} 
                onChange={(e) => setToken(e.target.value)}
                style={{ width: '100%', padding: '8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px' }}
              >
                <option value="ETH">ETH</option>
                <option value="USDT">USDT</option>
                <option value="BNB">BNB</option>
                <option value="SOL">SOL</option>
                <option value="TON">TON</option>
              </select>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'var(--text3)' }}>
                Количество токенов:
              </label>
              <input
                type="number"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={{ width: '100%', padding: '8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px' }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'var(--text3)' }}>
                Сумма в USD:
              </label>
              <input
                type="number"
                placeholder="0.0"
                value={usdAmount}
                onChange={(e) => setUsdAmount(e.target.value)}
                style={{ width: '100%', padding: '8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px' }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'var(--text3)' }}>
                Комиссия:
              </label>
              <select 
                value={commissionType} 
                onChange={(e) => setCommissionType(e.target.value)}
                style={{ width: '100%', padding: '8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px', marginBottom: '8px' }}
              >
                <option value="fast">Быстрая (до 1 мин)</option>
                <option value="normal">Нормальная (до 1 мин)</option>
                <option value="custom">Кастомная (30-60 мин)</option>
              </select>

              {commissionType === 'custom' && (
                <input
                  type="number"
                  placeholder="Укажите комиссию"
                  value={customCommission}
                  onChange={(e) => setCustomCommission(e.target.value)}
                  style={{ width: '100%', padding: '8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px' }}
                />
              )}
            </div>

            <button 
              className="btn-secondary" 
              onClick={createTransaction}
              style={{ width: '100%', marginBottom: '16px' }}
            >
              Создать транзакцию
            </button>

            {/* Transaction History */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h4 style={{ margin: 0, fontSize: '14px', color: 'var(--text)' }}>
                  История транзакций ({transactions.length})
                </h4>
                {transactions.length > 0 && (
                  <button 
                    onClick={clearTestData}
                    style={{ 
                      background: 'none', 
                      border: '1px solid var(--red)', 
                      color: 'var(--red)', 
                      borderRadius: '4px', 
                      padding: '4px 8px', 
                      fontSize: '11px', 
                      cursor: 'pointer' 
                    }}
                  >
                    Очистить все
                  </button>
                )}
              </div>
              
              {transactions.length === 0 ? (
                <p style={{ fontSize: '12px', color: 'var(--text3)', textAlign: 'center', padding: '20px 0' }}>
                  Нет транзакций
                </p>
              ) : (
                <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                  {transactions.map(tx => (
                    <div 
                      key={tx.id}
                      style={{ 
                        background: 'var(--bg2)', 
                        border: '1px solid var(--border)', 
                        borderRadius: '6px', 
                        padding: '12px', 
                        marginBottom: '8px',
                        fontSize: '12px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ color: tx.type === 'incoming' ? '#22C55E' : '#EF4444', fontWeight: '600' }}>
                          {tx.type === 'incoming' ? '↓ Входящая' : '↑ Исходящая'}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ 
                            fontSize: '10px', 
                            padding: '2px 6px', 
                            borderRadius: '4px',
                            background: tx.status === 'completed' ? '#22C55E' : '#f59e0b',
                            color: '#fff'
                          }}>
                            {tx.status === 'completed' ? '✓ Выполнено' : '⏳ Ожидание'}
                          </span>
                          <button
                            onClick={() => deleteTransaction(tx.id)}
                            style={{ 
                              background: 'none', 
                              border: 'none', 
                              color: '#EF4444', 
                              cursor: 'pointer',
                              fontSize: '12px'
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <div style={{ marginBottom: '2px', color: 'var(--text3)' }}>
                        {tx.token}: {tx.amount}
                      </div>
                      <div style={{ marginBottom: '2px', color: 'var(--text3)' }}>
                        USD: ${tx.usdAmount}
                      </div>
                      <div style={{ marginBottom: '2px', color: 'var(--text3)', fontSize: '11px' }}>
                        Комиссия: {tx.commissionType === 'custom' ? `Кастомная (${tx.customCommission})` : tx.commissionType === 'fast' ? 'Быстрая' : 'Нормальная'}
                      </div>
                      {tx.status === 'pending' && (
                        <div style={{ marginBottom: '2px', color: '#f59e0b', fontSize: '11px' }}>
                          Отмена через: {Math.ceil((new Date(tx.cancelTime) - new Date()) / 60000)} мин
                        </div>
                      )}
                      <div style={{ color: 'var(--text3)', fontSize: '11px' }}>
                        {new Date(tx.timestamp).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="settings-section danger-section">
        {!confirmDelete ? (
          <div className="settings-item danger-item" onClick={() => setConfirmDelete(true)}>
            <span className="s-icon">🗑</span>
            <div className="s-info">
              <span className="s-title">Удалить кошелёк</span>
              <span className="s-sub">Удалить с этого устройства</span>
            </div>
            <span className="s-arrow">›</span>
          </div>
        ) : (
          <div className="settings-sub-form">
            <p className="hint warn">❗ Удаление необратимо. Убедитесь, что у вас есть seed-фраза!</p>
            <div className="confirm-btns">
              <button className="btn-danger-full" onClick={handleDelete}>Удалить</button>
              <button className="btn-secondary" onClick={() => setConfirmDelete(false)}>Отмена</button>
            </div>
          </div>
        )}
      </div>

      <div className="settings-footer">
        <span>Gem Wallet TMA v1.0</span>
        <span>GPL-3.0 License</span>
      </div>
    </div>
  );
}
