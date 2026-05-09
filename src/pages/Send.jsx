import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext.jsx';
import { sendTransaction } from '../lib/crypto/transactionSender.js';

// Map wallet context network IDs → transactionSender chain symbols / networkIds
const NET_TO_SYM = {
  ethereum: 'ETH',
  bsc:      'BNB',
  arbitrum: 'ARB',
  solana:   'SOL',
  ton:      'TON',
  litecoin: 'LTC',
  polygon:  'POL',   // not yet in transactionSender — will show warning
  base:     'ETH',   // Base uses ETH symbol
  optimism: 'ETH',   // Optimism uses ETH symbol
  avalanche:'AVAX',  // not yet in transactionSender — will show warning
  tron:     'TRX',   // not yet in transactionSender — will show warning
  bitcoin:  'BTC',   // not yet in transactionSender — will show warning
};

// Networks fully supported by transactionSender
const SUPPORTED_NETS = new Set(['ethereum', 'bsc', 'arbitrum', 'solana', 'ton', 'litecoin']);

// Map network id → networkId param for USDT routing in transactionSender
const NET_TO_USDT_NETWORK = {
  ethereum: 'eth',
  bsc:      'bnb',
  arbitrum: 'arb',
  solana:   'sol',
  ton:      'ton',
};

export default function Send() {
  const { addresses, balances, activeNetwork, setActiveNetwork } = useWallet();
  const { getPrivateKey } = useWallet();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [password, setPassword] = useState('');
  const [asset, setAsset] = useState('native'); // 'native' | 'usdt'
  const [step, setStep] = useState('form'); // form | confirm | result
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const isSupported = SUPPORTED_NETS.has(activeNetwork);
  const sym = NET_TO_SYM[activeNetwork] || activeNetwork.toUpperCase();
  const hasUsdt = NET_TO_USDT_NETWORK[activeNetwork] !== undefined;

  // Determine which balance to show
  const nativeBalance = balances[activeNetwork] || '0';
  const usdtBalance = balances._usdtByNetwork?.[NET_TO_USDT_NETWORK[activeNetwork]] || '0';
  const displayBalance = asset === 'usdt' ? usdtBalance : nativeBalance;
  const displaySym = asset === 'usdt' ? 'USDT' : sym;

  // Explorer base URL per network
  const EXPLORERS = {
    ethereum: 'https://etherscan.io',
    bsc:      'https://bscscan.com',
    arbitrum: 'https://arbiscan.io',
    solana:   'https://solscan.io',
    ton:      null, // TON doesn't have a simple /tx/ URL
    litecoin: 'https://blockchair.com/litecoin/transaction',
  };

  const explorerBase = EXPLORERS[activeNetwork];
  const explorerUrl = explorerBase && txHash
    ? activeNetwork === 'litecoin'
      ? `${explorerBase}/${txHash}`
      : `${explorerBase}/tx/${txHash}`
    : null;

  const handleNext = () => {
    setError('');
    if (!to || to.length < 10) { setError('Введите корректный адрес'); return; }
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) { setError('Введите сумму'); return; }
    if (parseFloat(amount) > parseFloat(displayBalance)) { setError('Недостаточно средств'); return; }
    if (!isSupported) { setError(`Отправка для этой сети пока не поддерживается`); return; }
    setStep('confirm');
  };

  const handleSend = async () => {
    setError('');
    setLoading(true);
    try {
      // Get private key from memory (set during unlock/create)
      const pkChain = asset === 'usdt'
        ? (activeNetwork === 'solana' ? 'SOL' : activeNetwork === 'ton' ? 'TON' : sym)
        : sym;
      const privateKey = getPrivateKey(pkChain);
      if (!privateKey) {
        throw new Error('Приватный ключ недоступен. Заблокируйте кошелёк и разблокируйте снова.');
      }

      const fromAddress = addresses[activeNetwork];

      let hash;
      if (asset === 'usdt') {
        hash = await sendTransaction({
          sym: 'USDT',
          networkId: NET_TO_USDT_NETWORK[activeNetwork],
          from: fromAddress,
          to,
          amount: parseFloat(amount),
          privateKey,
        });
      } else {
        hash = await sendTransaction({
          sym,
          networkId: activeNetwork,
          from: fromAddress,
          to,
          amount: parseFloat(amount),
          privateKey,
        });
      }

      setTxHash(hash);
      setStep('result');
    } catch (e) {
      setError(e.message || 'Ошибка транзакции');
    } finally {
      setLoading(false);
    }
  };

  // Supported network IDs for the chip selector
  const NETWORK_LIST = [
    { id: 'ethereum', symbol: 'ETH',  color: '#627EEA', name: 'Ethereum' },
    { id: 'bsc',      symbol: 'BNB',  color: '#F3BA2F', name: 'BNB Chain' },
    { id: 'arbitrum', symbol: 'ARB',  color: '#12AAFF', name: 'Arbitrum' },
    { id: 'solana',   symbol: 'SOL',  color: '#9945FF', name: 'Solana' },
    { id: 'ton',      symbol: 'TON',  color: '#0088CC', name: 'TON' },
    { id: 'litecoin', symbol: 'LTC',  color: '#A6A9AA', name: 'Litecoin' },
  ];

  return (
    <div className="send-page">
      <div className="page-header">
        <button className="back-btn" onClick={() => step === 'form' ? navigate('/wallet') : setStep('form')}>
          ← Назад
        </button>
        <h2>Отправить</h2>
        <div />
      </div>

      {step === 'form' && (
        <>
          {/* Network Selector */}
          <div className="net-selector-scroll">
            {NETWORK_LIST.map(n => (
              <button
                key={n.id}
                className={`net-chip ${activeNetwork === n.id ? 'active' : ''}`}
                onClick={() => { setActiveNetwork(n.id); setAsset('native'); setError(''); }}
                style={{ '--nc': n.color }}
              >
                {n.symbol}
              </button>
            ))}
          </div>

          {/* Asset toggle (native / USDT) */}
          {hasUsdt && (
            <div className="asset-toggle">
              <button
                className={`asset-btn ${asset === 'native' ? 'active' : ''}`}
                onClick={() => setAsset('native')}
              >
                {sym}
              </button>
              <button
                className={`asset-btn ${asset === 'usdt' ? 'active' : ''}`}
                onClick={() => setAsset('usdt')}
              >
                USDT
              </button>
            </div>
          )}

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
            <div className="warn-msg">⚠️ Отправка для этой сети пока не поддерживается</div>
          )}

          {error && <div className="error-msg">{error}</div>}

          <button className="btn-primary" onClick={handleNext} disabled={!isSupported}>
            Далее
          </button>
        </>
      )}

      {step === 'confirm' && (
        <>
          <div className="confirm-card">
            <div className="confirm-row">
              <span>Сеть</span>
              <strong>{NETWORK_LIST.find(n => n.id === activeNetwork)?.name || activeNetwork}</strong>
            </div>
            <div className="confirm-row">
              <span>Актив</span>
              <strong>{displaySym}</strong>
            </div>
            <div className="confirm-row">
              <span>Кому</span>
              <strong className="addr-sm">{to.slice(0, 8)}...{to.slice(-6)}</strong>
            </div>
            <div className="confirm-row">
              <span>Сумма</span>
              <strong>{amount} {displaySym}</strong>
            </div>
            <div className="confirm-row warn">
              <span>⚠️ Транзакция необратима</span>
            </div>
          </div>

          {error && <div className="error-msg" style={{ margin: '0 16px' }}>{error}</div>}

          <button
            className="btn-primary btn-danger"
            onClick={handleSend}
            disabled={loading}
          >
            {loading ? 'Отправка...' : `Отправить ${amount} ${displaySym}`}
          </button>
        </>
      )}

      {step === 'result' && (
        <div className="result-card">
          <div className="result-icon success">✓</div>
          <h3>Транзакция отправлена!</h3>
          <div className="tx-hash">
            <span>TX Hash:</span>
            <code>{txHash.length > 20 ? `${txHash.slice(0, 10)}...${txHash.slice(-8)}` : txHash}</code>
          </div>
          {explorerUrl && (
            <a href={explorerUrl} target="_blank" rel="noreferrer" className="explorer-link">
              Открыть в Explorer ↗
            </a>
          )}
          <button className="btn-primary" onClick={() => navigate('/wallet')}>
            Назад к кошельку
          </button>
        </div>
      )}
    </div>
  );
}
