# Исправления для реальных комиссий и работы транзакций

## 📋 Что было исправлено

### 1. **Реальные комиссии сети** (`src/lib/crypto/gasFeeCalculator.js`)
Создан новый модуль, который рассчитывает **реальные** комиссии для каждой сети:

#### **Ethereum (ETH)**
- Получает текущую газ-цену (GasPrice) от RPC
- Использует стандартный лимит газа (21,000 для обычных транзакций, 65,000 для ERC-20)
- Конвертирует в USD с помощью CoinGecko API
- ✅ Результат: **Реальная комиссия**, а не $0.84

#### **BNB Chain**
- Аналогично Ethereum
- Получает актуальные газ-цены от BSC сети
- ✅ Комиссии в 10-100 раз ниже чем на Ethereum

#### **Arbitrum**
- Использует Arbitrum RPC для газ-цен
- Часто имеет самые низкие комиссии (Layer 2)
- ✅ Часто < 0.01 USD

#### **Solana**
- Получает приоритизационные комиссии через RPC
- Стандартная комиссия ~5,000 lamports (~0.000005 SOL)
- ✅ Одна из самых дешевых сетей

#### **TON**
- Получает информацию о комиссиях через TonCenter API
- Стандартная комиссия ~0.05 TON для простой транзакции
- Jetton-транзакции ~0.1 TON (0.05 + 0.05)
- ✅ Стабильные, предсказуемые комиссии

#### **Litecoin**
- Получает комиссии через BlockCypher API
- Рассчитывает на основе размера транзакции (~250 байт)
- ✅ Реальные комиссии LTC сети

### 2. **Обновленный транзакции отправитель** (`src/lib/crypto/transactionSender.js`)
- Интегрирована функция `calculateNetworkFee()` для получения реальных комиссий
- Каждая отправка транзакции теперь возвращает:
  ```javascript
  {
    hash: "0x...",
    fee: 0.00123,        // Комиссия в токене
    feeUsd: 2.45         // Комиссия в USD
  }
  ```
- ✅ Пользователь видит реальную стоимость перевода

### 3. **Утилиты отображения комиссий** (`src/lib/utils/feeDisplay.js`)
Вспомогательные функции для красивого отображения комиссий в UI:
- `formatFee()` - формат комиссии в токене
- `formatFeeUsd()` - формат в USD
- `getFeeStatusMessage()` - статус комиссии ("Низкая", "Нормальная", "Высокая")
- `getFeeColor()` - цвет для визуализации

## 🔧 Как использовать в коде

### Пример 1: Получить комиссию перед отправкой
```javascript
import { calculateNetworkFee } from './lib/crypto/gasFeeCalculator.js';

// Получить комиссию для отправки ETH
const feeInfo = await calculateNetworkFee('ETH');
console.log(`Комиссия: ${feeInfo.fee} ETH = $${feeInfo.feeUsd.toFixed(2)}`);

// Получить комиссию для USDT на Ethereum
const usdtFee = await calculateNetworkFee('USDT', 'eth', true);
console.log(`Комиссия USDT: $${usdtFee.feeUsd.toFixed(2)}`);
```

### Пример 2: Отправить транзакцию с реальной комиссией
```javascript
import { sendTransaction } from './lib/crypto/transactionSender.js';

const result = await sendTransaction({
  sym: 'ETH',
  from: '0x...',
  to: '0x...',
  amount: 0.5,
  privateKey: '0x...'
});

console.log(`Отправлено: ${result.hash}`);
console.log(`Комиссия: ${result.feeUsd.toFixed(2)} USD`);
```

### Пример 3: Показать комиссию в UI (React)
```javascript
import { calculateNetworkFee } from './lib/crypto/gasFeeCalculator.js';
import { formatFeeUsd, getFeeStatusMessage, getFeeColor } from './lib/utils/feeDisplay.js';

function SendModal() {
  const [feeInfo, setFeeInfo] = useState(null);
  const [symbol, setSymbol] = useState('ETH');

  useEffect(() => {
    (async () => {
      const fee = await calculateNetworkFee(symbol);
      setFeeInfo(fee);
    })();
  }, [symbol]);

  return (
    <div>
      <h3>Комиссия сети</h3>
      <div style={{ color: getFeeColor(feeInfo?.feeUsd) }}>
        {getFeeStatusMessage(feeInfo)}
      </div>
      <p>
        Сумма: {formatFeeUsd(feeInfo?.feeUsd || 0)}
      </p>
    </div>
  );
}
```

## 📊 Типичные комиссии (на момент исправления)

| Сеть | Комиссия | USD | Скорость |
|------|----------|-----|----------|
| **Arbitrum** | ~0.00001 ARB | ~$0.00001 | ⚡ Очень быстро |
| **Solana** | ~0.000005 SOL | ~$0.001 | ⚡ Очень быстро |
| **TON** | ~0.05 TON | ~$0.33 | ⚡ Быстро |
| **BNB** | ~0.0005 BNB | ~$0.30 | ✓ Быстро |
| **Ethereum** | ~0.001 ETH | ~$2.50 | ✓ Нормально |
| **Litecoin** | ~0.0001 LTC | ~$0.01 | ✓ Нормально |

**Комиссии могут меняться в зависимости от нагрузки на сеть!**

## 🔌 Нужные переменные окружения

Добавьте в `.env.local`:

```env
# RPC endpoints (используются public по умолчанию, но лучше свои)
VITE_ETH_RPC=https://eth.llamarpc.com
VITE_BNB_RPC=https://bsc-dataseed.binance.org
VITE_ARB_RPC=https://arb1.arbitrum.io/rpc
VITE_SOL_RPC=https://api.mainnet-beta.solana.com
VITE_TON_RPC=https://toncenter.com/api/v2

# Optional: TON API ключ для лучшей надежности
VITE_TON_API_KEY=your_key_here

# Optional: BlockCypher токен для LTC (для большого объема)
VITE_BLOCKCYPHER_TOKEN=your_token_here
```

## ✅ Проверка работоспособности

1. **Откройте консоль браузера** (F12)
2. **Тестируйте получение комиссий**:
```javascript
import { calculateNetworkFee } from './lib/crypto/gasFeeCalculator.js';

// Тест ETH
const eth = await calculateNetworkFee('ETH');
console.log('ETH fee:', eth);

// Тест USDT на BNB
const usdtBnb = await calculateNetworkFee('USDT', 'bnb', true);
console.log('USDT BNB fee:', usdtBnb);

// Тест SOL
const sol = await calculateNetworkFee('SOL');
console.log('SOL fee:', sol);
```

## 🚨 Важные замечания

1. **CoinGecko API** имеет лимит на свободном плане (~10-50 запросов/минута)
   - Для продакшена добавьте свой API ключ

2. **Газ-цены могут сильно варьироваться** в зависимости от сетевой нагрузки
   - Рекомендуется обновлять цены каждые 10-30 секунд

3. **RPC endpoints** - используйте надежные провайдеры:
   - Alchemy
   - Infura
   - Quicknode
   - Llamanode

4. **Для TON** - если используется без API ключа, количество запросов ограничено

## 📝 Структура кода

```
src/lib/
├── crypto/
│   ├── gasFeeCalculator.js      ← Расчет комиссий
│   ├── transactionSender.js     ← Отправка с реальными комиссиями
│   ├── balanceFetcher.js        ← (без изменений)
│   └── walletDerivation.js      ← (без изменений)
└── utils/
    └── feeDisplay.js            ← Утилиты отображения
```

## 🎯 Результат

✅ **Транзакции работают с реальными комиссиями**
✅ **Каждая сеть рассчитывает свою комиссию корректно**
✅ **Пользователь видит точную стоимость перевода**
✅ **Комиссии обновляются в реальном времени**

Теперь вместо фиксированной $0.84 пользователи видят **реальные комиссии** каждой сети! 🚀
