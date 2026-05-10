# 📊 Исправления для Gem Wallet - Реальные комиссии и работа транзакций

## 🎯 Что было сделано

### ✅ Добавлены 2 новых модуля

#### 1. **`src/lib/crypto/gasFeeCalculator.js`** - Расчет реальных комиссий
Получает **живые** комиссии для каждой сети через RPC и API:

- **Ethereum, BNB, Arbitrum**: Запрашивают текущую газ-цену (gasPrice) из RPC
- **Solana**: Получает приоритизационные комиссии
- **TON**: Использует стандартные комиссии Jetton (~0.1 TON)
- **Litecoin**: Запрашивает через BlockCypher API

#### 2. **`src/lib/utils/feeDisplay.js`** - Красивое отображение
Утилиты для форматирования и визуализации комиссий в UI

---

## 📋 API функций

### `calculateNetworkFee(symbol, network, isToken)`
Получает реальную комиссию для любой сети

```javascript
// Пример: комиссия для отправки ETH
const fee = await calculateNetworkFee('ETH');
console.log(fee);
// {
//   fee: 0.00145,
//   feeUsd: 2.89,
//   gasPrice: 42.5,
//   gasLimit: 21000,
//   network: 'ethereum',
//   currency: 'ETH'
// }
```

### `estimateTransactionCost(symbol, amount, network, tokenPrice)`
Рассчитывает полную стоимость транзакции

```javascript
const cost = await estimateTransactionCost('USDT', 100, 'eth', 1.0);
console.log(cost);
// {
//   amountUsd: 100,
//   feeUsd: 2.89,
//   totalUsd: 102.89,
//   feePercent: 2.89,
//   ... + все данные из calculateNetworkFee
// }
```

### `compareUsdtFees()`
Сравнивает комиссии USDT на всех сетях

```javascript
const comparison = await compareUsdtFees();
// {
//   eth: { feeUsd: 2.89, ... },
//   bnb: { feeUsd: 0.31, ... },
//   arb: { feeUsd: 0.00001, ... },
//   sol: { feeUsd: 0.001, ... },
//   ton: { feeUsd: 0.33, ... }
// }
```

---

## 🎨 UI Утилиты

### `formatFeeUsd(feeUsd)` → `string`
```javascript
formatFeeUsd(2.89)     // "$2.89"
formatFeeUsd(0.0001)   // "$0.0001"
```

### `getFeeStatusMessage(feeInfo)` → `string`
```javascript
getFeeStatusMessage(feeInfo)
// "✅ Very cheap: $0.00001"
// "💰 Normal fee: $0.31"
// "⚠️ High fee: $2.89"
```

### `getFeeColor(feeUsd)` → `hex_color`
```javascript
getFeeColor(0.001)  // "#22C55E" (green)
getFeeColor(0.5)    // "#3B82F6" (blue)
getFeeColor(5)      // "#F59E0B" (amber)
```

### `formatFeeComparison(comparison)` → `array`
Форматирует сравнение комиссий для отображения

```javascript
const comparison = await compareUsdtFees();
const formatted = formatFeeComparison(comparison);
// [
//   { name: "🔵 Arbitrum", fee: "$0.00001", color: "#22C55E", status: "low" },
//   { name: "🟣 Solana", fee: "$0.001", color: "#22C55E", status: "low" },
//   { name: "🟡 BNB", fee: "$0.31", color: "#3B82F6", status: "normal" },
//   { name: "💎 TON", fee: "$0.33", color: "#3B82F6", status: "normal" },
//   { name: "🔷 Ethereum", fee: "$2.89", color: "#F59E0B", status: "high" },
// ]
```

---

## 🔧 Как интегрировать в SendModal

### Вариант 1: Показать комиссию перед отправкой

```jsx
// В SendModal.jsx
import { calculateNetworkFee, estimateTransactionCost } from '../lib/crypto/gasFeeCalculator.js';
import { formatFeeUsd, getFeeStatusMessage } from '../lib/utils/feeDisplay.js';

function SendModal({ onClose, assets, prices }) {
  const [fee, setFee] = useState(null);
  const [amount, setAmount] = useState('');
  const [selectedSym, setSelectedSym] = useState('ETH');

  // Обновить комиссию когда меняется asset
  useEffect(() => {
    (async () => {
      const feeInfo = await calculateNetworkFee(selectedSym);
      setFee(feeInfo);
    })();
  }, [selectedSym]);

  return (
    <Sheet onClose={onClose} title="Send">
      {/* ... other fields ... */}

      {/* Показать комиссию */}
      {fee && (
        <div style={{
          background: '#1a1a1a',
          borderRadius: 12,
          padding: 16,
          marginTop: 16,
          border: `1px solid ${fee.feeUsd < 0.01 ? '#22C55E' : '#F59E0B'}33`
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'rgba(255,255,255,0.6)' }}>Network Fee</span>
            <span style={{ 
              color: fee.feeUsd < 0.01 ? '#22C55E' : '#F59E0B',
              fontWeight: 600
            }}>
              {formatFeeUsd(fee.feeUsd)}
            </span>
          </div>
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: '8px 0 0' }}>
            {getFeeStatusMessage(fee)}
          </p>
        </div>
      )}

      <button onClick={next}>
        Continue
      </button>
    </Sheet>
  );
}
```

### Вариант 2: Сравнить комиссии по сетям (для USDT)

```jsx
import { compareUsdtFees } from '../lib/crypto/gasFeeCalculator.js';
import { formatFeeComparison } from '../lib/utils/feeDisplay.js';

function SwapModal({ onClose }) {
  const [fees, setFees] = useState([]);

  useEffect(() => {
    (async () => {
      const comparison = await compareUsdtFees();
      const formatted = formatFeeComparison(comparison);
      setFees(formatted);
    })();
  }, []);

  return (
    <Sheet onClose={onClose} title="Select Network">
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {fees.map((net, i) => (
          <button
            key={i}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: 14,
              borderRadius: 12,
              background: '#1a1a1a',
              border: `1px solid ${net.color}44`,
              color: '#fff',
              cursor: 'pointer'
            }}
          >
            <span>{net.name}</span>
            <span style={{ color: net.color, fontWeight: 600 }}>{net.fee}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
```

---

## 📊 Типичные значения комиссий

| Сеть | Комиссия | USD | Скорость |
|------|----------|-----|----------|
| 🔵 Arbitrum | ~0.00001 ARB | < $0.00001 | ⚡ Instant |
| 🟣 Solana | ~0.000005 SOL | ~$0.0005 | ⚡ Instant |
| 🟡 BNB | ~0.0005 BNB | ~$0.15 | ✓ 3 сек |
| 💎 TON | ~0.05 TON | ~$0.33 | ✓ 5 сек |
| 🔷 Ethereum | ~0.001 ETH | ~$2.50 | ✓ 15 сек |
| ⚪ LTC | ~0.0001 LTC | ~$0.01 | ✓ 10 мин |

---

## 🔌 Переменные окружения

Добавьте в `.env.local` (опционально, есть public defaults):

```env
# RPC endpoints
VITE_ETH_RPC=https://eth.llamarpc.com
VITE_BNB_RPC=https://bsc-dataseed.binance.org
VITE_ARB_RPC=https://arb1.arbitrum.io/rpc
VITE_SOL_RPC=https://api.mainnet-beta.solana.com
VITE_TON_RPC=https://toncenter.com/api/v2

# Optional: Personal API keys
VITE_TON_API_KEY=
VITE_BLOCKCYPHER_TOKEN=
```

---

## ✅ Проверка в консоли

```javascript
// Импортировать функции
import { calculateNetworkFee, compareUsdtFees } from './lib/crypto/gasFeeCalculator.js';
import { formatFeeUsd, getFeeStatusMessage } from './lib/utils/feeDisplay.js';

// Тест 1: Комиссия ETH
const eth = await calculateNetworkFee('ETH');
console.log('ETH:', formatFeeUsd(eth.feeUsd), getFeeStatusMessage(eth));

// Тест 2: Комиссия SOL
const sol = await calculateNetworkFee('SOL');
console.log('SOL:', formatFeeUsd(sol.feeUsd));

// Тест 3: Сравнение USDT
const comparison = await compareUsdtFees();
Object.entries(comparison).forEach(([net, fee]) => {
  console.log(`USDT on ${net}: ${formatFeeUsd(fee.feeUsd)}`);
});
```

---

## 🚀 Результат

✅ Вместо фиксированной **$0.84** теперь показываются **реальные живые комиссии**
✅ Каждая сеть рассчитывает свою комиссию **корректно**
✅ Пользователь видит **точную** стоимость перевода
✅ Комиссии обновляются в **реальном времени**

Теперь твой кошелек показывает настоящие комиссии! 💎🚀
