import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext.jsx';
import { sendTransaction } from '../lib/crypto/transactionSender.js';

// Map wallet context network IDs  transactionSender chain symbols
const NET_TO_SYM = {
  ethereum: 'ETH',
  bsc:      'BNB',
  arbitrum: 'ARB',
  solana:   'SOL',
  ton:      'TON',
  litecoin: 'LTC',
};

const SUPPORTED_NETS = new Set(['ethereum', 'bsc', 'arbitrum', 'solana', 'ton', 'litecoin']);

// Fee units for each network (small units)
const FEE_UNITS = {
  ethereum: { unit: 'gwei', decimals: 9, symbol: 'ETH' },
  bsc:      { unit: 'gwei', decimals: 9, symbol: 'BNB' },
  arbitrum: { unit: 'gwei', decimals: 9, symbol: 'ARB' },
  solana:   { unit: 'micro-lamports', decimals: 15, symbol: 'SOL' }, // 1 SOL = 10^9 lamports = 10^15 micro-lamports
  ton:      { unit: 'nanoton', decimals: 9, symbol: 'TON' },
  litecoin: { unit: 'sat', decimals: 8, symbol: 'LTC' },
};

// Standard fee options in small units (realistic values)
const STANDARD_FEES = {
  ethereum: [
    { name: 'Эконом', value: 20000, time: '1-2 мин' },      // 20000 gwei
    { name: 'Стандарт', value: 40000, time: '1-2 мин' },     // 40000 gwei
    { name: 'Быстрая', value: 80000, time: '1-2 мин' },      // 80000 gwei
  ],
  bsc: [
    { name: 'Эконом', value: 5000, time: '1-2 мин' },         // 5000 gwei
    { name: 'Стандарт', value: 10000, time: '1-2 мин' },     // 10000 gwei
    { name: 'Быстрая', value: 20000, time: '1-2 мин' },      // 20000 gwei
  ],
  arbitrum: [
    { name: 'Эконом', value: 100, time: '1-2 мин' },         // 100 gwei
    { name: 'Стандарт', value: 200, time: '1-2 мин' },       // 200 gwei
    { name: 'Быстрая', value: 500, time: '1-2 мин' },       // 500 gwei
  ],
  solana: [
    { name: 'Эконом', value: 5000000000, time: '1-2 мин' },   // 5000 lamports in micro-lamports
    { name: 'Стандарт', value: 10000000000, time: '1-2 мин' }, // 10000 lamports
    { name: 'Быстрая', value: 20000000000, time: '1-2 мин' },  // 20000 lamports
  ],
  ton: [
    { name: 'Эконом', value: 1000000, time: '1-2 мин' },      // 0.001 TON in nanoton
    { name: 'Стандарт', value: 5000000, time: '1-2 мин' },    // 0.005 TON
    { name: 'Быстрая', value: 10000000, time: '1-2 мин' },    // 0.01 TON
  ],
  litecoin: [
    { name: 'Эконом', value: 1000, time: '1-2 мин' },         // 1000 sat
    { name: 'Стандарт', value: 5000, time: '1-2 мин' },     // 5000 sat
    { name: 'Быстрая', value: 10000, time: '1-2 мин' },     // 10000 sat
  ],
};

export default function Send() {
  const { addresses, balances, activeNetwork, setActiveNetwork, getPrivateKey } = useWallet();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [password, setPassword] = useState('');
  const [asset, setAsset] = useState('native');
  const [step, setStep] = useState('address'); // address | fee | confirm | result
  const [selectedFee, setSelectedFee] = useState(null);
  const [customFee, setCustomFee] = useState('');
  const [feeMode, setFeeMode] = useState('standard'); // standard | custom
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const isSupported = SUPPORTED_NETS.has(activeNetwork);
  const sym = NET_TO_SYM[activeNetwork] || activeNetwork.toUpperCase();
  const feeConfig = FEE_UNITS[activeNetwork];
  const feeOptions = STANDARD_FEES[activeNetwork] || [];
  const minStandardFee = Math.min(...feeOptions.map(f => f.value));

  const nativeBalance = balances[activeNetwork] || '0';
  const displayBalance = nativeBalance;
  const displaySym = sym;

  // Format fee to readable with unit
  const formatFee = (valueInSmallUnits) => {
    if (!valueInSmallUnits || valueInSmallUnits === '0') return '0 ' + feeConfig.unit;
    return `${valueInSmallUnits} ${feeConfig.unit}`;
  };

  // Convert small units to native for display
  const toNativeUnit = (smallUnits) => {
    return (smallUnits / Math.pow(10, feeConfig.decimals)).toFixed(8);
  };

  // Get timer based on fee selection
  const getTimer = () => {
    if (feeMode === 'custom') {
      const customVal = parseFloat(customFee) || 0;
      if (customVal < minStandardFee) {
        return '30-120 мин';
      }
      return '1-2 мин';
    }
    const selected = feeOptions.find(f => f.name === selectedFee);
    return selected ? selected.time : '1-2 мин';
  };

  // Get current fee value in small units
  const getCurrentFeeValue = () => {
    if (feeMode === 'custom') {
      return parseFloat(customFee) || minStandardFee;
    }
    const selected = feeOptions.find(f => f.name === selectedFee);
    return selected ? selected.value : feeOptions[1]?.value || 0;
  };

  const handleAddressNext = () => {
    setError('');
    if (!to || to.length < 10) { setError('Введите корректный адрес'); return; }
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) { setError('Введите сумму'); return; }
    if (parseFloat(amount) > parseFloat(displayBalance)) { setError('Недостаточно средств'); return; }
    if (!isSupported) { setError('Отправка для этой сети пока не поддерживается'); return; }
    
    // Set default fee
    setSelectedFee(feeOptions[1]?.name || feeOptions[0]?.name);
    setStep('fee');
  };

  const handleFeeNext = () => {
    setError('');
    if (feeMode === 'custom') {
      if (!customFee || parseFloat(customFee) <= 0) {
        setError('Введите комиссию');
        return;
      }
    }
    setStep('confirm');
  };

  const handleSend = async () => {
    setError('');
    setLoading(true);
    try {
      const privateKey = getPrivateKey(sym);
      if (!privateKey) {
        throw new Error('Приватный ключ недоступен. Заблокируйте кошелёк и разблокируйте снова.');
      }

      const fromAddress = addresses[activeNetwork];
      const feeValue = getCurrentFeeValue();

      const hash = await sendTransaction({
        sym,
        networkId: activeNetwork,
        from: fromAddress,
        to,
        amount: parseFloat(amount),
        privateKey,
        fee: feeValue, // Pass fee to sender
      });

      setTxHash(hash);
      setStep('result');
    } catch (e) {
      setError(e.message || 'Ошибка транзакции');
    } finally {
      setLoading(false);
    }
  };

  const NETWORK_LIST = [
    { id: 'ethereum', symbol: 'ETH',  color: '#627EEA', name: 'Ethereum' },
    { id: 'bsc',      symbol: 'BNB',  color: '#F3BA2F', name: 'BNB Chain' },
    { id: 'arbitrum', symbol: 'ARB',  color: '#12AAFF', name: 'Arbitrum' },
    { id: 'solana',   symbol: 'SOL',  color: '#9945FF', name: 'Solana' },
    { id: 'ton',      symbol: 'TON',  color: '#0088CC', name: 'TON' },
    { id: 'litecoin', symbol: 'LTC',  color: '#A6A9AA', name: 'Litecoin' },
  ];

  const renderAddressStep = () => (
    <>
      <div className="net-selector-scroll">
        {NETWORK_LIST.map(n => (
          <button
            key={n.id}
            className={`net-chip ${activeNetwork === n.id ? 'active' : ''}`}
            onClick={() => { setActiveNetwork(n.id); setError(''); }}
            style={{ '--nc': n.color }}
          >
            {n.symbol}
          </button>
        ))}
      </div>

      <div className="send-balance-hint">
        Баланс: <strong>{parseFloat(displayBalance).toFixed(6)} {displaySym}</strong>
      </div>

      <div className="form-group">
        <label>Адрес получателя</label>
        <input
          type="text"
          placeholder={activeNetwork === 'solana' ? 'Base58 адрес...' : activeNetwork === 'ton' ? 'UQ... или EQ...' : '0x...'}
          value={to}
          onChange={e => setTo(e.target.value)}
        />
      </div>

      <div className="form-group amount-group">
        <label>Сумма ({displaySym})</label>
        <input
          type="number"
          placeholder="0.0"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          step="any"
          min="0"
        />
        <button className="max-btn" onClick={() => setAmount(String(displayBalance))}>MAX</button>
      </div>

      {!isSupported && (
        <div className="warn-msg"> Отправка для этой сети пока не поддерживается</div>
      )}

      {error && <div className="error-msg">{error}</div>}

      <button className="btn-primary" onClick={handleAddressNext} disabled={!isSupported}>
        Далее
      </button>
    </>
  );

  const renderFeeStep = () => (
    <>
      <div className="page-header">
        <button className="back-btn" onClick={() => setStep('address')}> Назад</button>
        <h2>Выбор комиссии</h2>
        <div />
      </div>

      <div style={{ padding: '0 16px' }}>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 16 }}>
          Выберите скорость транзакции для {displaySym}
        </p>

        {/* Fee mode selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <button
            onClick={() => setFeeMode('standard')}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: 12,
              border: 'none',
              background: feeMode === 'standard' ? '#2563eb' : '#1a1a1a',
              color: feeMode === 'standard' ? '#fff' : 'rgba(255,255,255,0.5)',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Стандартные
          </button>
          <button
            onClick={() => setFeeMode('custom')}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: 12,
              border: 'none',
              background: feeMode === 'custom' ? '#2563eb' : '#1a1a1a',
              color: feeMode === 'custom' ? '#fff' : 'rgba(255,255,255,0.5)',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Своя
          </button>
        </div>

        {feeMode === 'standard' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {feeOptions.map((fee) => (
              <button
                key={fee.name}
                onClick={() => setSelectedFee(fee.name)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '16px',
                  borderRadius: 12,
                  border: selectedFee === fee.name ? '2px solid #2563eb' : '1px solid rgba(255,255,255,0.1)',
                  background: selectedFee === fee.name ? 'rgba(37,99,235,0.1)' : '#1a1a1a',
                  cursor: 'pointer'
                }}
              >
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>{fee.name}</div>
                  <div style={{ fontSize: 12, color: '#f59e0b' }}>~{fee.time}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>
                    {formatFee(fee.value)}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                    {toNativeUnit(fee.value)} {feeConfig.symbol}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ background: '#1a1a1a', borderRadius: 12, padding: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
              Введите комиссию в {feeConfig.unit}
            </label>
            <input
              type="number"
              placeholder={`Например: ${minStandardFee}`}
              value={customFee}
              onChange={(e) => setCustomFee(e.target.value)}
              style={{
                width: '100%',
                padding: '12px',
                background: '#111',
                border: '1px solid #333',
                borderRadius: 8,
                color: '#fff',
                fontSize: 16,
                marginBottom: 8
              }}
            />
            {customFee && (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                 {toNativeUnit(parseFloat(customFee))} {feeConfig.symbol}
              </div>
            )}
          </div>
        )}

        {/* Timer display */}
        <div style={{
          marginTop: 20,
          padding: '14px',
          background: 'rgba(245,158,11,0.1)',
          border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: 12,
          textAlign: 'center'
        }}>
          <span style={{ fontSize: 13, color: '#f59e0b', fontWeight: 600 }}>
             Время подтверждения: {getTimer()}
          </span>
          {feeMode === 'custom' && parseFloat(customFee) < minStandardFee && customFee && (
            <div style={{ fontSize: 11, color: '#ef4444', marginTop: 6 }}>
               Комиссия ниже рекомендуемой  возможны задержки
            </div>
          )}
        </div>

        {error && <div className="error-msg" style={{ marginTop: 16 }}>{error}</div>}

        <button
          className="btn-primary"
          onClick={handleFeeNext}
          style={{ marginTop: 20 }}
        >
          Продолжить
        </button>
      </div>
    </>
  );

  const renderConfirmStep = () => (
    <>
      <div className="page-header">
        <button className="back-btn" onClick={() => setStep('fee')}> Назад</button>
        <h2>Подтверждение</h2>
        <div />
      </div>

      <div className="confirm-card" style={{ margin: '0 16px 16px' }}>
        <div className="confirm-row">
          <span>Сеть</span>
          <strong>{NETWORK_LIST.find(n => n.id === activeNetwork)?.name || activeNetwork}</strong>
        </div>
        <div className="confirm-row">
          <span>Кому</span>
          <strong className="addr-sm">{to.slice(0, 8)}...{to.slice(-6)}</strong>
        </div>
        <div className="confirm-row">
          <span>Сумма</span>
          <strong>{amount} {displaySym}</strong>
        </div>
        <div className="confirm-row">
          <span>Комиссия</span>
          <strong>{formatFee(getCurrentFeeValue())}</strong>
        </div>
        <div className="confirm-row">
          <span>Итого к списанию</span>
          <strong>{(parseFloat(amount) + parseFloat(toNativeUnit(getCurrentFeeValue()))).toFixed(8)} {displaySym}</strong>
        </div>
        <div className="confirm-row warn">
          <span> Транзакция необратима</span>
        </div>
      </div>

      {error && <div className="error-msg" style={{ margin: '0 16px' }}>{error}</div>}

      <button
        className="btn-primary btn-danger"
        onClick={handleSend}
        disabled={loading}
        style={{ margin: '0 16px' }}
      >
        {loading ? 'Отправка...' : `Отправить ${amount} ${displaySym}`}
      </button>
    </>
  );

  const renderResultStep = () => (
    <div className="result-card">
      <div className="result-icon success"></div>
      <h3>Транзакция отправлена!</h3>
      <div className="tx-hash">
        <span>TX Hash:</span>
        <code>{txHash.length > 20 ? `${txHash.slice(0, 10)}...${txHash.slice(-8)}` : txHash}</code>
      </div>
      <button className="btn-primary" onClick={() => navigate('/wallet')}>
        Назад к кошельку
      </button>
    </div>
  );

  return (
    <div className="send-page">
      {step !== 'fee' && step !== 'confirm' && step !== 'result' && (
        <div className="page-header">
          <button className="back-btn" onClick={() => navigate('/wallet')}> Назад</button>
          <h2>Отправить</h2>
          <div />
        </div>
      )}

      {step === 'address' && renderAddressStep()}
      {step === 'fee' && renderFeeStep()}
      {step === 'confirm' && renderConfirmStep()}
      {step === 'result' && renderResultStep()}
    </div>
  );
}
