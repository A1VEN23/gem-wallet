/**
 * balanceFetcher.js
 * Multi-chain balance fetching for all supported assets.
 *
 * Supported:
 *   ETH  — native via JSON-RPC
 *   BNB  — native via JSON-RPC
 *   ARB  — native via JSON-RPC
 *   SOL  — native via @solana/web3.js
 *   TON  — native via TonCenter REST API
 *   LTC  — native via BlockCypher REST API
 *   USDT — ERC-20 (ETH), BEP-20 (BNB), ARB ERC-20, SPL (SOL), Jetton (TON)
 */

import { ethers } from 'ethers';

// ─── ERC-20 / BEP-20 minimal ABI ─────────────────────────────────────────────
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// ─── USDT contract addresses per chain (TESTNET) ───────────────────────────
const USDT_CONTRACTS = {
  ETH: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06', // Sepolia USDT
  BNB: '0xaB1a4d4f1D656d2450692d237fdD6C7f9146e814', // BSC Testnet USDT
  ARB: '0x5F2A69A2418e94d6d9F0F44A9d8B8b6b6b6b6b6b', // Arbitrum Sepolia USDT
};

// ─── TON USDT Jetton master address ──────────────────────────────────────────
const TON_USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

// ─── Solana USDT mint ─────────────────────────────────────────────────────────
const SOL_USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// ─── RPC helpers ─────────────────────────────────────────────────────────────
function getRpc(envKey, fallback) {
  return (typeof import.meta !== 'undefined' && import.meta.env?.[envKey]) || fallback;
}

const RPCS = {
  ETH: () => getRpc('VITE_ETH_RPC', 'https://sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161'),
  BNB: () => getRpc('VITE_BNB_RPC', 'https://data-seed-prebsc-1-s1.binance.org:8545'),
  ARB: () => getRpc('VITE_ARB_RPC', 'https://sepolia-rollup.arbitrum.io/rpc'),
  SOL: () => getRpc('VITE_SOL_RPC', 'https://api.devnet.solana.com'),
  TON: () => getRpc('VITE_TON_RPC', 'https://toncenter.com/api/v2'),
};

// ─── EVM native balance ───────────────────────────────────────────────────────
async function fetchEvmNative(address, rpcUrl) {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const bal = await provider.getBalance(address);
    return parseFloat(ethers.formatEther(bal));
  } catch {
    return 0;
  }
}

// ─── ERC-20 token balance ─────────────────────────────────────────────────────
async function fetchErc20(address, contractAddress, rpcUrl) {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const contract = new ethers.Contract(contractAddress, ERC20_ABI, provider);
    const [bal, decimals] = await Promise.all([
      contract.balanceOf(address),
      contract.decimals(),
    ]);
    return parseFloat(ethers.formatUnits(bal, decimals));
  } catch {
    return 0;
  }
}

// ─── Solana native balance ────────────────────────────────────────────────────
async function fetchSolNative(address, rpcUrl) {
  try {
    const { Connection, PublicKey } = await import('@solana/web3.js');
    const conn = new Connection(rpcUrl, 'confirmed');
    const lamports = await conn.getBalance(new PublicKey(address));
    return lamports / 1e9;
  } catch {
    return 0;
  }
}

// ─── Solana SPL token balance (USDT) ─────────────────────────────────────────
async function fetchSolSpl(walletAddress, mintAddress, rpcUrl) {
  try {
    const { Connection, PublicKey } = await import('@solana/web3.js');
    const conn = new Connection(rpcUrl, 'confirmed');
    const mint = new PublicKey(mintAddress);
    const owner = new PublicKey(walletAddress);
    const accounts = await conn.getParsedTokenAccountsByOwner(owner, { mint });
    if (!accounts.value.length) return 0;
    const info = accounts.value[0].account.data.parsed.info.tokenAmount;
    return parseFloat(info.uiAmountString || '0');
  } catch {
    return 0;
  }
}

// ─── TON native balance ───────────────────────────────────────────────────────
async function fetchTonNative(address, apiBase) {
  try {
    const apiKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TON_API_KEY) || '';
    const url = `${apiBase}/getAddressBalance?address=${encodeURIComponent(address)}${apiKey ? `&api_key=${apiKey}` : ''}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok) return 0;
    return parseInt(data.result, 10) / 1e9;
  } catch {
    return 0;
  }
}

// ─── TON Jetton (USDT) balance ────────────────────────────────────────────────
async function fetchTonJetton(walletAddress, jettonMaster, apiBase) {
  try {
    const apiKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TON_API_KEY) || '';
    const url = `${apiBase}/getTokenData?address=${encodeURIComponent(jettonMaster)}${apiKey ? `&api_key=${apiKey}` : ''}`;
    // Use the jetton wallet address lookup
    const walletUrl = `${apiBase}/runGetMethod?address=${encodeURIComponent(jettonMaster)}&method=get_wallet_address&stack=[["tvm.Slice","${walletAddress}"]]${apiKey ? `&api_key=${apiKey}` : ''}`;
    const res = await fetch(walletUrl);
    const data = await res.json();
    if (!data.ok) return 0;
    // Parse jetton wallet address from result
    const jettonWalletAddr = data.result?.stack?.[0]?.[1]?.object?.data?.b64;
    if (!jettonWalletAddr) return 0;
    const balUrl = `${apiBase}/getAddressBalance?address=${encodeURIComponent(jettonWalletAddr)}${apiKey ? `&api_key=${apiKey}` : ''}`;
    const balRes = await fetch(balUrl);
    const balData = await balRes.json();
    if (!balData.ok) return 0;
    return parseInt(balData.result, 10) / 1e6; // USDT has 6 decimals on TON
  } catch {
    return 0;
  }
}

// ─── LTC balance via BlockCypher ──────────────────────────────────────────────
async function fetchLtcBalance(address) {
  try {
    const token = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BLOCKCYPHER_TOKEN) || '';
    const url = `https://api.blockcypher.com/v1/ltc/main/addrs/${address}/balance${token ? `?token=${token}` : ''}`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.balance || 0) / 1e8;
  } catch {
    return 0;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetch all balances for a wallet.
 * @param {{ ETH, BNB, ARB, SOL, TON, LTC }} addresses
 * @returns {Promise<{ ETH, BNB, ARB, SOL, TON, LTC, USDT }>}
 */
export async function fetchAllBalances(addresses) {
  const ethRpc = RPCS.ETH();
  const bnbRpc = RPCS.BNB();
  const arbRpc = RPCS.ARB();
  const solRpc = RPCS.SOL();
  const tonApi = RPCS.TON();

  const [
    ethBal,
    bnbBal,
    arbBal,
    solBal,
    tonBal,
    ltcBal,
    usdtEth,
    usdtBnb,
    usdtArb,
    usdtSol,
    usdtTon,
  ] = await Promise.allSettled([
    addresses.ETH ? fetchEvmNative(addresses.ETH, ethRpc) : Promise.resolve(0),
    addresses.BNB ? fetchEvmNative(addresses.BNB, bnbRpc) : Promise.resolve(0),
    addresses.ARB ? fetchEvmNative(addresses.ARB, arbRpc) : Promise.resolve(0),
    addresses.SOL ? fetchSolNative(addresses.SOL, solRpc) : Promise.resolve(0),
    addresses.TON ? fetchTonNative(addresses.TON, tonApi) : Promise.resolve(0),
    addresses.LTC ? fetchLtcBalance(addresses.LTC) : Promise.resolve(0),
    addresses.ETH ? fetchErc20(addresses.ETH, USDT_CONTRACTS.ETH, ethRpc) : Promise.resolve(0),
    addresses.BNB ? fetchErc20(addresses.BNB, USDT_CONTRACTS.BNB, bnbRpc) : Promise.resolve(0),
    addresses.ARB ? fetchErc20(addresses.ARB, USDT_CONTRACTS.ARB, arbRpc) : Promise.resolve(0),
    addresses.SOL ? fetchSolSpl(addresses.SOL, SOL_USDT_MINT, solRpc) : Promise.resolve(0),
    addresses.TON ? fetchTonJetton(addresses.TON, TON_USDT_MASTER, tonApi) : Promise.resolve(0),
  ]);

  const val = (r) => (r.status === 'fulfilled' ? r.value : 0);

  // USDT: sum across all networks (or use the highest single balance)
  // For display purposes we show the total USDT across all chains
  const usdtTotal = val(usdtEth) + val(usdtBnb) + val(usdtArb) + val(usdtSol) + val(usdtTon);

  return {
    ETH:  val(ethBal),
    BNB:  val(bnbBal),
    ARB:  val(arbBal),
    SOL:  val(solBal),
    TON:  val(tonBal),
    LTC:  val(ltcBal),
    USDT: usdtTotal,
    // Per-network USDT breakdown (useful for send/collect)
    _usdtByNetwork: {
      eth: val(usdtEth),
      bnb: val(usdtBnb),
      arb: val(usdtArb),
      sol: val(usdtSol),
      ton: val(usdtTon),
    },
  };
}

/**
 * Fetch balance for a single asset on a specific network.
 * @param {string} sym  e.g. 'ETH', 'USDT'
 * @param {string} networkId  e.g. 'eth', 'bnb', 'sol'
 * @param {string} address
 * @returns {Promise<number>}
 */
export async function fetchSingleBalance(sym, networkId, address) {
  if (!address) return 0;
  try {
    if (sym === 'USDT') {
      if (networkId === 'eth') return fetchErc20(address, USDT_CONTRACTS.ETH, RPCS.ETH());
      if (networkId === 'bnb') return fetchErc20(address, USDT_CONTRACTS.BNB, RPCS.BNB());
      if (networkId === 'arb') return fetchErc20(address, USDT_CONTRACTS.ARB, RPCS.ARB());
      if (networkId === 'sol') return fetchSolSpl(address, SOL_USDT_MINT, RPCS.SOL());
      if (networkId === 'ton') return fetchTonJetton(address, TON_USDT_MASTER, RPCS.TON());
    }
    if (sym === 'ETH') return fetchEvmNative(address, RPCS.ETH());
    if (sym === 'BNB') return fetchEvmNative(address, RPCS.BNB());
    if (sym === 'ARB') return fetchEvmNative(address, RPCS.ARB());
    if (sym === 'SOL') return fetchSolNative(address, RPCS.SOL());
    if (sym === 'TON') return fetchTonNative(address, RPCS.TON());
    if (sym === 'LTC') return fetchLtcBalance(address);
  } catch {
    return 0;
  }
  return 0;
}
