/**
 * swapAggregator.js
 * Get quotes and execute token swaps across chains.
 *
 * SOL / SOL↔USDT  — Jupiter Aggregator v6 API (no key required)
 * ETH / BNB / ARB — KyberSwap Aggregator API (no key required)
 * TON / TON↔USDT  — Ston.fi REST API (no key required)
 *
 * All amounts are in human-readable units (e.g. "1.5" SOL, "100" USDT).
 * Returns { txHash } on success, throws on failure.
 */

import { ethers } from 'ethers';

// ─── env helpers ─────────────────────────────────────────────────────────────
function env(key, fallback = '') {
  return (typeof import.meta !== 'undefined' && import.meta.env?.[key]) || fallback;
}

// ─── RPC URLs ─────────────────────────────────────────────────────────────────
const RPC = {
  eth: () => env('VITE_ETH_RPC', 'https://eth.llamarpc.com'),
  bnb: () => env('VITE_BNB_RPC', 'https://bsc-dataseed.binance.org'),
  arb: () => env('VITE_ARB_RPC', 'https://arb1.arbitrum.io/rpc'),
  sol: () => env('VITE_SOL_RPC', 'https://api.mainnet-beta.solana.com'),
};

// ─── KyberSwap chain slugs ────────────────────────────────────────────────────
// https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator/aggregator-api-and-widget/aggregator-api
const KYBER_CHAIN = { eth: 'ethereum', bnb: 'bsc', arb: 'arbitrum' };

// ─── Well-known token addresses ───────────────────────────────────────────────
const NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'; // KyberSwap native placeholder
const USDT_EVM = {
  eth: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  bnb: '0x55d398326f99059fF775485246999027B3197955',
  arb: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
};

// SOL mint addresses
const SOL_NATIVE_MINT = 'So11111111111111111111111111111111111111112';
const USDT_SOL_MINT   = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// TON Jetton master addresses
const TON_USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

// ─── Jupiter (SOL) ────────────────────────────────────────────────────────────

async function jupiterQuote(inputMint, outputMint, amountLamports) {
  const url = new URL('https://quote-api.jup.ag/v6/quote');
  url.searchParams.set('inputMint', inputMint);
  url.searchParams.set('outputMint', outputMint);
  url.searchParams.set('amount', amountLamports.toString());
  url.searchParams.set('slippageBps', '50'); // 0.5%
  url.searchParams.set('onlyDirectRoutes', 'false');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Jupiter quote failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function jupiterSwap({ fromSym, toSym, fromAmount, walletAddress, privateKeyHex }) {
  const { Connection, Keypair, VersionedTransaction } = await import('@solana/web3.js');

  const inputMint  = fromSym === 'SOL' ? SOL_NATIVE_MINT : USDT_SOL_MINT;
  const outputMint = toSym  === 'SOL' ? SOL_NATIVE_MINT : USDT_SOL_MINT;

  const inputDecimals = fromSym === 'SOL' ? 9 : 6;
  const amountSmallest = BigInt(Math.round(parseFloat(fromAmount) * 10 ** inputDecimals));

  const quote = await jupiterQuote(inputMint, outputMint, amountSmallest);

  const swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: walletAddress,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  });
  if (!swapRes.ok) throw new Error(`Jupiter swap failed: ${swapRes.status} ${await swapRes.text()}`);
  const { swapTransaction } = await swapRes.json();

  const connection = new Connection(RPC.sol(), 'confirmed');
  const pkBytes = Buffer.from(privateKeyHex, 'hex');
  const keypair = Keypair.fromSecretKey(pkBytes);

  const txBuf = Buffer.from(swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([keypair]);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

// ─── KyberSwap (EVM) — no API key required ───────────────────────────────────

/**
 * Get a KyberSwap route (quote).
 * Docs: https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator/aggregator-api-and-widget/aggregator-api
 */
async function kyberQuote({ chainSlug, fromToken, toToken, amountWei, walletAddress }) {
  const url = new URL(`https://aggregator-api.kyberswap.com/${chainSlug}/api/v1/routes`);
  url.searchParams.set('tokenIn', fromToken);
  url.searchParams.set('tokenOut', toToken);
  url.searchParams.set('amountIn', amountWei.toString());
  if (walletAddress) url.searchParams.set('to', walletAddress);

  const res = await fetch(url.toString(), {
    headers: { 'x-client-id': 'gemwallet-tma' },
  });
  if (!res.ok) throw new Error(`KyberSwap route failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`KyberSwap route error: ${data.message}`);
  return data.data;
}

/**
 * Build the swap calldata from a KyberSwap route.
 */
async function kyberBuildSwap({ chainSlug, route, walletAddress, slippageBps = 50 }) {
  const res = await fetch(
    `https://aggregator-api.kyberswap.com/${chainSlug}/api/v1/route/build`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': 'gemwallet-tma',
      },
      body: JSON.stringify({
        routeSummary: route.routeSummary,
        sender: walletAddress,
        recipient: walletAddress,
        slippageTolerance: slippageBps,
        deadline: Math.floor(Date.now() / 1000) + 1200, // 20 min
      }),
    }
  );
  if (!res.ok) throw new Error(`KyberSwap build failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`KyberSwap build error: ${data.message}`);
  return data.data;
}

async function kyberSwap({ network, fromSym, toSym, fromAmount, walletAddress, privateKeyHex }) {
  const chainSlug  = KYBER_CHAIN[network];
  const rpcUrl     = RPC[network]();

  const fromToken  = fromSym === 'USDT' ? USDT_EVM[network] : NATIVE_TOKEN;
  const toToken    = toSym   === 'USDT' ? USDT_EVM[network] : NATIVE_TOKEN;

  const fromDecimals = fromSym === 'USDT' ? 6 : 18;
  // Use BigInt arithmetic to avoid floating point precision issues
  const amountWei = BigInt(Math.round(parseFloat(fromAmount) * 10 ** fromDecimals));

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet   = new ethers.Wallet(privateKeyHex, provider);

  // If swapping ERC-20 (USDT), approve KyberSwap router first
  if (fromSym === 'USDT') {
    const route = await kyberQuote({ chainSlug, fromToken, toToken, amountWei, walletAddress });
    const routerAddress = route.routerAddress;

    const erc20 = new ethers.Contract(fromToken, [
      'function approve(address spender, uint256 amount) returns (bool)',
      'function allowance(address owner, address spender) view returns (uint256)',
    ], wallet);

    const allowance = await erc20.allowance(walletAddress, routerAddress);
    if (allowance < amountWei) {
      const approveTx = await erc20.approve(routerAddress, ethers.MaxUint256);
      await approveTx.wait(1);
    }
  }

  // Get route
  const route = await kyberQuote({ chainSlug, fromToken, toToken, amountWei, walletAddress });
  // Build calldata
  const built = await kyberBuildSwap({ chainSlug, route, walletAddress });

  const tx = await wallet.sendTransaction({
    to:       built.routerAddress,
    data:     built.data,
    value:    BigInt(built.value || '0'),
    gasLimit: BigInt(Math.ceil(Number(built.gas) * 1.2)),
  });
  await tx.wait(1);
  return tx.hash;
}

// ─── Ston.fi (TON) ────────────────────────────────────────────────────────────

async function stonfiSwap({ fromSym, toSym, fromAmount, walletAddress, privateKeyHex }) {
  const { TonClient, WalletContractV4, internal, beginCell, Address, toNano } = await import('@ton/ton');

  const ROUTER_ADDR = 'EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt';
  const tonRpc    = env('VITE_TON_RPC', 'https://toncenter.com/api/v2');
  const tonApiKey = env('VITE_TON_API_KEY', '');

  const client = new TonClient({
    endpoint: `${tonRpc}/jsonRPC`,
    apiKey: tonApiKey || undefined,
  });

  const secretKeyBytes = Buffer.from(privateKeyHex, 'hex');
  const keyPair = {
    secretKey: secretKeyBytes,
    publicKey: secretKeyBytes.slice(32),
  };

  const wallet   = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
  const contract = client.open(wallet);
  const seqno    = await contract.getSeqno();

  const PROXY_TON  = 'EQCM3B12QK1e4yZSf8GtBRT0aLMNyEsBc_9Qsof7cs3o63nT';
  const offerAddr  = fromSym === 'TON' ? PROXY_TON : TON_USDT_MASTER;
  const askAddr    = toSym   === 'TON' ? PROXY_TON : TON_USDT_MASTER;

  const offerDecimals = fromSym === 'TON' ? 9 : 6;
  const offerAmount   = BigInt(Math.round(parseFloat(fromAmount) * 10 ** offerDecimals));
  const minAskAmount  = (offerAmount * 99n) / 100n;

  const swapPayload = beginCell()
    .storeUint(0x25938561, 32)
    .storeUint(0, 64)
    .storeAddress(Address.parse(askAddr))
    .storeCoins(minAskAmount)
    .storeAddress(Address.parse(walletAddress))
    .endCell();

  let transferMsg;

  if (fromSym === 'TON') {
    transferMsg = internal({
      to:     ROUTER_ADDR,
      value:  toNano(String(parseFloat(fromAmount) + 0.3)),
      bounce: true,
      body:   beginCell()
        .storeUint(0x01f3835d, 32)
        .storeUint(0, 64)
        .storeCoins(offerAmount)
        .storeAddress(Address.parse(askAddr))
        .storeCoins(minAskAmount)
        .storeAddress(Address.parse(walletAddress))
        .endCell(),
    });
  } else {
    const jettonWalletRes = await fetch(
      `${tonRpc}/getWalletAddress?owner_address=${encodeURIComponent(walletAddress)}&jetton_master_address=${encodeURIComponent(offerAddr)}`,
      tonApiKey ? { headers: { 'X-API-Key': tonApiKey } } : {}
    );
    if (!jettonWalletRes.ok) throw new Error('Failed to get jetton wallet address');
    const { result: jettonWalletAddr } = await jettonWalletRes.json();

    transferMsg = internal({
      to:     jettonWalletAddr,
      value:  toNano('0.3'),
      bounce: true,
      body:   beginCell()
        .storeUint(0xf8a7ea5, 32)
        .storeUint(0, 64)
        .storeCoins(offerAmount)
        .storeAddress(Address.parse(ROUTER_ADDR))
        .storeAddress(Address.parse(walletAddress))
        .storeBit(0)
        .storeCoins(toNano('0.25'))
        .storeBit(1)
        .storeRef(swapPayload)
        .endCell(),
    });
  }

  await contract.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [transferMsg],
  });

  return `ton-swap-${Date.now()}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get a swap quote (output amount estimate).
 *
 * @param {object} params
 * @param {string} params.fromSym    — e.g. "SOL", "USDT", "ETH", "BNB", "ARB", "TON"
 * @param {string} params.toSym      — e.g. "USDT", "SOL"
 * @param {string} params.networkId  — "sol", "eth", "bnb", "arb", "ton"
 * @param {string} params.fromAmount — human-readable amount
 * @returns {Promise<{ toAmount: string, rate: string }>}
 */
export async function getSwapQuote({ fromSym, toSym, networkId, fromAmount }) {
  if (!fromAmount || parseFloat(fromAmount) <= 0) return { toAmount: '0', rate: '0' };

  try {
    if (networkId === 'sol') {
      const inputMint      = fromSym === 'SOL' ? SOL_NATIVE_MINT : USDT_SOL_MINT;
      const outputMint     = toSym   === 'SOL' ? SOL_NATIVE_MINT : USDT_SOL_MINT;
      const inputDecimals  = fromSym === 'SOL' ? 9 : 6;
      const outputDecimals = toSym   === 'SOL' ? 9 : 6;
      const amountSmallest = BigInt(Math.round(parseFloat(fromAmount) * 10 ** inputDecimals));
      const quote = await jupiterQuote(inputMint, outputMint, amountSmallest);
      const toAmount = (Number(quote.outAmount) / 10 ** outputDecimals).toFixed(6);
      const rate = (parseFloat(toAmount) / parseFloat(fromAmount)).toFixed(4);
      return { toAmount, rate };
    }

    if (networkId === 'ton') {
      // Ston.fi doesn't expose a simple quote endpoint without a wallet address
      return { toAmount: '~market', rate: '~' };
    }

    // EVM — KyberSwap
    const chainSlug      = KYBER_CHAIN[networkId];
    const fromToken      = fromSym === 'USDT' ? USDT_EVM[networkId] : NATIVE_TOKEN;
    const toToken        = toSym   === 'USDT' ? USDT_EVM[networkId] : NATIVE_TOKEN;
    const fromDecimals   = fromSym === 'USDT' ? 6 : 18;
    const outputDecimals = toSym   === 'USDT' ? 6 : 18;
    const amountWei      = BigInt(Math.round(parseFloat(fromAmount) * 10 ** fromDecimals));

    const route    = await kyberQuote({ chainSlug, fromToken, toToken, amountWei });
    const toAmount = (Number(route.routeSummary.amountOut) / 10 ** outputDecimals).toFixed(6);
    const rate     = (parseFloat(toAmount) / parseFloat(fromAmount)).toFixed(4);
    return { toAmount, rate };
  } catch (err) {
    console.warn('[swapAggregator] quote error:', err.message);
    return { toAmount: '0', rate: '0' };
  }
}

/**
 * Execute a swap.
 *
 * @param {object} params
 * @param {string} params.fromSym
 * @param {string} params.toSym
 * @param {string} params.networkId   — "sol" | "eth" | "bnb" | "arb" | "ton"
 * @param {string} params.fromAmount  — human-readable
 * @param {string} params.walletAddress
 * @param {string} params.privateKeyHex — hex-encoded private key
 * @returns {Promise<{ txHash: string }>}
 */
export async function executeSwap({ fromSym, toSym, networkId, fromAmount, walletAddress, privateKeyHex }) {
  let txHash;

  switch (networkId) {
    case 'sol':
      txHash = await jupiterSwap({ fromSym, toSym, fromAmount, walletAddress, privateKeyHex });
      break;

    case 'ton':
      txHash = await stonfiSwap({ fromSym, toSym, fromAmount, walletAddress, privateKeyHex });
      break;

    case 'eth':
    case 'bnb':
    case 'arb':
      txHash = await kyberSwap({ network: networkId, fromSym, toSym, fromAmount, walletAddress, privateKeyHex });
      break;

    default:
      throw new Error(`Unsupported swap network: ${networkId}`);
  }

  return { txHash };
}
