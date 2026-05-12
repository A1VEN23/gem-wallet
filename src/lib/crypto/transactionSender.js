import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext.jsx';
import { sendTransaction } from '../lib/crypto/transactionSender.js';

const NET_TO_SYM = {
  ethereum: 'ETH', bsc: 'BNB', arbitrum: 'ARB',
  solana: 'SOL', ton: 'TON', litecoin: 'LTC',
};

const SUPPORTED_NETS = new Set(['ethereum', 'bsc', 'arbitrum', 'solana', 'ton', 'litecoin']);

const FEE_UNITS = {
  ethereum: { unit: 'gwei', symbol: 'ETH', kind: 'evm', evmGasLimit: 21000 },
  bsc: { unit: 'gwei', symbol: 'BNB', kind: 'evm', evmGasLimit: 21000 },
  arbitrum: { unit: 'gwei', symbol: 'ARB', kind: 'evm', evmGasLimit: 21000 },
  solana: { unit: 'micro-lamports', symbol: 'SOL', kind: 'sol' },
  ton: { unit: 'nanoton', symbol: 'TON', kind: 'ton', decimals: 9 },
  litecoin: { unit: 'sat/byte', symbol: 'LTC', kind: 'ltc', decimals: 8, estimateBytes: 250 },
};

const STANDARD_FEES = {
  ethereum: [
    { name: 'Эконом', value: 10, time: '1-2 мин' },
    { name: 'Стандарт', value: 20, time: '1-2 мин' },
    { name: 'Быстрая', value: 40, time: '1-2 мин' },
  ],
  bsc: [
    { name: 'Эконом', value: 1, time: '1-2 мин' },
    { name: 'Стандарт', value: 2, time: '1-2 мин' },
    { name: 'Быстрая', value: 3, time: '1-2 мин' },
  ],
  arbitrum: [
    { name: 'Эконом', value: 0.05, time: '1-2 мин' },
    { name: 'Стандарт', value: 0.1, time: '1-2 мин' },
    { name: 'Быстрая', value: 0.2, time: '1-2 мин' },
  ],
  solana: [
    { name: 'Эконом', value: 1000, time: '1-2 мин' },
    { name: 'Стандарт', value: 5000, time: '1-2 мин' },
    { name: 'Быстрая', value: 10000, time: '1-2 мин' },
  ],
  ton: [
    { name: 'Эконом', value: 2000000, time: '1-2 мин' },
    { name: 'Стандарт', value: 5000000, time: '1-2 мин' },
    { name: 'Быстрая', value: 10000000, time: '1-2 мин' },
  ],
  litecoin: [
    { name: 'Эконом', value: 10, time: '1-2 мин' },
    { name: 'Стандарт', value: 25, time: '1-2 мин' },
    { name: 'Быстрая', value: 50, time: '1-2 мин' },
  ],
};

export default function Send() {
  const { addresses, balances, activeNetwork, setActiveNetwork, getPrivateKey } = useWallet();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState('address'); // address | amount | fee | confirm | result
  const [selectedFee, setSelectedFee] = useState(null);
  const [customFee, setCustomFee] = useState('');
  const [feeMode, setFeeMode] = useState('standard');
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const isSupported = SUPPORTED_NETS.has(activeNetwork);
  const sym = NET_TO_SYM[activeNetwork] || activeNetwork.toUpperCase();
  const feeConfig = FEE_UNITS[activeNetwork];
  const feeOptions = STANDARD_FEES[activeNetwork] || [];
  const minStandardFee = feeOptions.length ? Math.min(...feeOptions.map(f => f.value)) : 0;

  const nativeBalance = balances[activeNetwork] || '0';
  const displayBalance = nativeBalance;
  const displaySym = sym;

  const getFeeTotalSmallUnits = (value) => {
    if (!feeConfig) return 0;
    if (feeConfig.kind === 'ltc') return Math.round((parseFloat(value) || 0) * feeConfig.estimateBytes);
    return parseFloat(value) || 0;
  };

  const getFeePrimaryText = (value) => {
    if (!feeConfig) return '';
    const v = value === null || value === undefined || value === '' ? 0 : value;
    return `${v} ${feeConfig.unit}`;
  };

  const getFeeSecondaryText = (value) => {
    if (!feeConfig) return '';
    const v = parseFloat(value) || 0;

    if (feeConfig.kind === 'evm') {
      const gasLimit = feeConfig.evmGasLimit || 21000;
      const estimatedNative = (v * gasLimit) / 1e9;
      return `≈${estimatedNative.toFixed(8)} ${feeConfig.symbol}`;
    }

    if (feeConfig.kind === 'sol') {
      const lamports = Math.floor(v / 1e6);
      return `≈${lamports} lamports`;
    }

    const total = getFeeTotalSmallUnits(v);
    const native = feeConfig.decimals ? (total / Math.pow(10, feeConfig.decimals)) : 0;
    return `≈${native.toFixed(8)} ${feeConfig.symbol}`;
  };

  const getTimer = () => {
    if (feeMode === 'custom') {
      const customVal = parseFloat(customFee) || 0;
      if (customVal < minStandardFee) return '30-120 мин';
      return '1-2 мин';
    }
    const selected = feeOptions.find(f => f.name === selectedFee);
    return selected ? selected.time : '1-2 мин';
  };

  const getCurrentFeeValue = () => {
    if (feeMode === 'custom') {
      return parseFloat(customFee) || minStandardFee;
    }
    const selected = feeOptions.find(f => f.name === selectedFee);
    return selected ? selected.value : feeOptions[1]?.value || 0;
  };

  const getCurrentFeeForSend = () => {
    const current = getCurrentFeeValue();
    if (!feeConfig) return current;
    if (feeConfig.kind === 'ltc') return getFeeTotalSmallUnits(current);
    return current;
  };

  const getCurrentFeeNativeEstimate = () => {
    if (!feeConfig) return 0;
    const current = getCurrentFeeValue();

    if (feeConfig.kind === 'evm') {
      const gasLimit = feeConfig.evmGasLimit || 21000;
      return (parseFloat(current) * gasLimit) / 1e9;
    }

    if (feeConfig.kind === 'sol') {
      return 0;
    }

    const total = getFeeTotalSmallUnits(current);
    return feeConfig.decimals ? total / Math.pow(10, feeConfig.decimals) : 0;
  };

  // Step 1: Address
  const handleAddressNext = () => {
    setError('');
    if (!to || to.length < 10) { setError('Введите корректный адрес'); return; }
    if (!isSupported) { setError('Отправка для этой сети пока не поддерживается'); return; }
    setStep('amount');
  };

  // Step 2: Amount
  const handleAmountNext = () => {
    setError('');
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) { setError('Введите сумму'); return; }
    if (parseFloat(amount) > parseFloat(displayBalance)) { setError('Недостаточно средств'); return; }
    // Set default fee
    setSelectedFee(feeOptions[1]?.name || feeOptions[0]?.name);
    setFeeMode('standard');
    setStep('fee');
  };

  // Step 3: Fee
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

  // Step 4: Confirm and Send
  const handleSend = async () => {
    setError('');
    setLoading(true);
    try {
      const privateKey = getPrivateKey(sym);
      if (!privateKey) {
        throw new Error('Приватный ключ недоступен. Заблокируйте кошелёк и разблокируйте снова.');
      }

      const fromAddress = addresses[activeNetwork];
      const feeValue = getCurrentFeeForSend();

      const hash = await sendTransaction({
        sym,
        networkId: activeNetwork,
        from: fromAddress,
        to,
        amount: parseFloat(amount),
        privateKey,
        fee: feeValue,
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
    { id: 'ethereum', symbol: 'ETH', color: '#627EEA', name: 'Ethereum' },
    { id: 'bsc', symbol: 'BNB', color: '#F3BA2F', name: 'BNB Chain' },
    { id: 'arbitrum', symbol: 'ARB', color: '#12AAFF', name: 'Arbitrum' },
    { id: 'solana', symbol: 'SOL', color: '#9945FF', name: 'Solana' },
    { id: 'ton', symbol: 'TON', color: '#0088CC', name: 'TON' },
    { id: 'litecoin', symbol: 'LTC', color: '#A6A9AA', name: 'Litecoin' },
  ];

  const inputStyle = {
    width: '100%',
    padding: '14px',
    background: '#1a1a1a',
    border: '1px solid #333',
    borderRadius: 12,
    color: '#fff',
    fontSize: 16,
    outline: 'none',
    marginTop: 8
  };

  const labelStyle = {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: 500
  };

  const renderStepper = () => {
    const steps = [
      { key: 'address', label: 'Адрес' },
      { key: 'amount', label: 'Сумма' },
      { key: 'fee', label: 'Комиссия' },
      { key: 'confirm', label: 'Подтверждение' },
    ];
    const activeIdx = steps.findIndex(s => s.key === step);
    return (
      <div style={{ padding: '0 16px', marginTop: 12, marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          {steps.map((s, idx) => (
            <div key={s.key} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                margin: '0 auto 6px',
                background: idx <= activeIdx ? '#2563eb' : 'rgba(255,255,255,0.15)'
              }} />
              <div style={{ fontSize: 11, color: idx <= activeIdx ? '#fff' : 'rgba(255,255,255,0.45)' }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Step 1: Address
  const renderAddressStep = () => (
    <>
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate('/wallet')}> Назад</button>
        <h2>Шаг 1 из 4: Адрес</h2>
        <div />
      </div>
      {renderStepper()}

      <div className="net-selector-scroll" style={{ marginBottom: 20 }}>
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

      <div style={{ padding: '0 16px' }}>
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Адрес получателя</label>
          <input
            type="text"
            placeholder={activeNetwork === 'solana' ? 'Base58 адрес...' : activeNetwork === 'ton' ? 'UQ... или EQ...' : '0x...'}
            value={to}
            onChange={e => setTo(e.target.value)}
            style={inputStyle}
          />
        </div>

        {!isSupported && (
          <div className="warn-msg" style={{ marginBottom: 16 }}> Отправка для этой сети пока не поддерживается</div>
        )}

        {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}

        <button className="btn-primary" onClick={handleAddressNext} disabled={!isSupported} style={{ width: '100%' }}>
          Далее 
        </button>
      </div>
    </>
  );

  // Step 2: Amount
  const renderAmountStep = () => (
    <>
      <div className="page-header">
        <button className="back-btn" onClick={() => setStep('address')}> Назад</button>
        <h2>Шаг 2 из 4: Сумма</h2>
        <div />
      </div>
      {renderStepper()}

      <div style={{ padding: '0 16px' }}>
        <div style={{ 
          background: '#111', 
          borderRadius: 16, 
          padding: '20px', 
          marginBottom: 20,
          textAlign: 'center'
        }}>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>Доступно</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#fff' }}>
            {parseFloat(displayBalance).toFixed(6)} {displaySym}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Сумма к отправке</label>
          <div style={{ position: 'relative' }}>
            <input
              type="number"
              placeholder="0.0"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              step="any"
              min="0"
              style={{ ...inputStyle, paddingRight: '70px' }}
            />
            <span style={{ 
              position: 'absolute', 
              right: '16px', 
              top: '50%', 
              transform: 'translateY(-50%)',
              color: 'rgba(255,255,255,0.5)',
              fontSize: 14
            }}>
              {displaySym}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {['0.25', '0.5', '0.75', '1'].map(percent => (
            <button
              key={percent}
              onClick={() => setAmount(String(parseFloat(displayBalance) * parseFloat(percent)))}
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: 10,
                border: '1px solid #333',
                background: '#1a1a1a',
                color: 'rgba(255,255,255,0.7)',
                fontSize: 12,
                cursor: 'pointer'
              }}
            >
              {parseInt(parseFloat(percent) * 100)}%
            </button>
          ))}
          <button
            onClick={() => setAmount(String(displayBalance))}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: 10,
              border: '1px solid #333',
              background: '#1a1a1a',
              color: '#2563eb',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            MAX
          </button>
        </div>

        {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}

        <button className="btn-primary" onClick={handleAmountNext} style={{ width: '100%' }}>
          Далее 
        </button>
      </div>
    </>
  );

  // Step 3: Fee
  const renderFeeStep = () => (
    <>
      <div className="page-header">
        <button className="back-btn" onClick={() => setStep('amount')}> Назад</button>
        <h2>Шаг 3 из 4: Комиссия</h2>
        <div />
      </div>
      {renderStepper()}

      <div style={{ padding: '0 16px' }}>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 16 }}>
          Выберите скорость для {displaySym}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {feeOptions.map((fee) => (
            <button
              key={fee.name}
              onClick={() => { setFeeMode('standard'); setSelectedFee(fee.name); }}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px',
                borderRadius: 12,
                border: feeMode === 'standard' && selectedFee === fee.name ? '2px solid #2563eb' : '1px solid rgba(255,255,255,0.1)',
                background: feeMode === 'standard' && selectedFee === fee.name ? 'rgba(37,99,235,0.1)' : '#1a1a1a',
                cursor: 'pointer'
              }}
            >
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>{fee.name}</div>
                <div style={{ fontSize: 12, color: '#f59e0b' }}>~{fee.time}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>
                  {getFeePrimaryText(fee.value)}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                  {getFeeSecondaryText(fee.value)}
                </div>
              </div>
            </button>
          ))}

          <div style={{
            borderRadius: 12,
            border: feeMode === 'custom' ? '2px solid #2563eb' : '1px solid rgba(255,255,255,0.1)',
            background: feeMode === 'custom' ? 'rgba(37,99,235,0.1)' : '#1a1a1a',
            padding: 16
          }}>
            <button
              onClick={() => setFeeMode('custom')}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'transparent',
                border: 'none',
                color: '#fff',
                cursor: 'pointer',
                padding: 0
              }}
            >
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Своя</div>
                <div style={{ fontSize: 12, color: '#f59e0b' }}>~{getTimer()}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>
                  {customFee ? getFeePrimaryText(customFee) : `Введите ${feeConfig?.unit || ''}`}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                  {customFee ? getFeeSecondaryText(customFee) : ''}
                </div>
              </div>
            </button>

            {feeMode === 'custom' && (
              <div style={{ marginTop: 12 }}>
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
                {customFee && parseFloat(customFee) < minStandardFee && (
                  <div style={{ fontSize: 11, color: '#ef4444' }}>
                    Комиссия ниже рекомендуемой возможны задержки
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

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
        </div>

        {error && <div className="error-msg" style={{ marginTop: 16 }}>{error}</div>}

        <button className="btn-primary" onClick={handleFeeNext} style={{ marginTop: 20, width: '100%' }}>
          Далее 
        </button>
      </div>
    </>
  );

  // Step 4: Confirm
  const renderConfirmStep = () => (
    <>
      <div className="page-header">
        <button className="back-btn" onClick={() => setStep('fee')}> Назад</button>
        <h2>Шаг 4 из 4: Подтверждение</h2>
        <div />
      </div>
      {renderStepper()}

      <div style={{ padding: '0 16px' }}>
        <div className="confirm-card" style={{ marginBottom: 20 }}>
          <div className="confirm-row" style={{ padding: '12px 0' }}>
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>Адрес получателя</span>
            <strong style={{ color: '#fff', fontSize: 13 }}>{to.slice(0, 6)}...{to.slice(-4)}</strong>
          </div>
          <div className="confirm-row" style={{ padding: '12px 0' }}>
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>Сумма</span>
            <strong style={{ color: '#fff' }}>{amount} {displaySym}</strong>
          </div>
          <div className="confirm-row" style={{ padding: '12px 0' }}>
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>Комиссия</span>
            <strong style={{ color: '#fff' }}>{getFeePrimaryText(getCurrentFeeValue())}</strong>
          </div>
          <div className="confirm-row" style={{ padding: '12px 0', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: 8 }}>
            <span style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>Итого (оценка)</span>
            <strong style={{ color: '#10b981', fontSize: 16 }}>
              {(parseFloat(amount) + parseFloat(getCurrentFeeNativeEstimate())).toFixed(8)} {displaySym}
            </strong>
          </div>
          <div className="confirm-row" style={{ padding: '8px 0', marginTop: 8 }}>
            <span style={{ fontSize: 12, color: '#f59e0b' }}> Время: {getTimer()}</span>
          </div>
        </div>

        <div style={{ 
          background: 'rgba(239,68,68,0.1)', 
          border: '1px solid rgba(239,68,68,0.3)', 
          borderRadius: 12, 
          padding: 12,
          marginBottom: 16
        }}>
          <span style={{ fontSize: 12, color: '#ef4444' }}> Транзакция необратима</span>
        </div>

        {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}

        <button
          className="btn-primary"
          onClick={handleSend}
          disabled={loading}
          style={{ 
            width: '100%', 
            background: '#10b981',
            fontSize: 16,
            fontWeight: 600
          }}
        >
          {loading ? 'Отправка...' : ` Подтвердить и отправить`}
        </button>
      </div>
    </>
  );

  // Result Step
  const renderResultStep = () => (
    <div className="result-card" style={{ textAlign: 'center', padding: '40px 24px' }}>
      <div style={{ 
        width: 80, 
        height: 80, 
        borderRadius: '50%', 
        background: '#10b981',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 24px',
        fontSize: 40
      }}>
        
      </div>
      <h3 style={{ color: '#fff', marginBottom: 16 }}>Транзакция отправлена!</h3>
      <div style={{ 
        background: '#1a1a1a', 
        borderRadius: 12, 
        padding: 16, 
        marginBottom: 24,
        fontSize: 13
      }}>
        <span style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 4 }}>TX Hash:</span>
        <code style={{ color: '#fff', fontSize: 12 }}>
          {txHash.length > 20 ? `${txHash.slice(0, 10)}...${txHash.slice(-8)}` : txHash}
        </code>
      </div>
      <button className="btn-primary" onClick={() => navigate('/wallet')} style={{ width: '100%' }}>
        Назад к кошельку
      </button>
    </div>
  );

  return (
    <div className="send-page">
      {step === 'address' && renderAddressStep()}
      {step === 'amount' && renderAmountStep()}
      {step === 'fee' && renderFeeStep()}
      {step === 'confirm' && renderConfirmStep()}
      {step === 'result' && renderResultStep()}
    </div>
  );
}
