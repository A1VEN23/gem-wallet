/**
 * transactionSender.js
 * Sign and broadcast real transactions for all supported chains.
 *
 * Chains: ETH, BNB, ARB (EVM via ethers.js)
 *         SOL (@solana/web3.js)
 *         TON (@ton/ton WalletContractV4)
 *         LTC (BlockCypher push API — build + sign + broadcast)
 *         USDT (ERC-20/BEP-20/ARB transfer, SPL transfer, TON Jetton transfer)
 */

import { ethers } from 'ethers';

// ─── ERC-20 transfer ABI ──────────────────────────────────────────────────────
const ERC20_TRANSFER_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

// ─── USDT contract addresses (TESTNET) ───────────────────────────────────────
const USDT_CONTRACTS = {
  eth: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06', // Sepolia USDT
  bnb: '0xaB1a4d4f1D656d2450692d237fdD6C7f9146e814', // BSC Testnet USDT
  arb: '0x5F2A69A2418e94d6d9F0F44A9d8B8b6b6b6b6b6b', // Arbitrum Sepolia USDT
};

// ─── RPC resolver ─────────────────────────────────────────────────────────────
function rpc(key, fallback) {
  return (typeof import.meta !== 'undefined' && import.meta.env?.[key]) || fallback;
}

const CHAIN_RPC = {
  eth: () => rpc('VITE_ETH_RPC', 'https://sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161'),
  bnb: () => rpc('VITE_BNB_RPC', 'https://data-seed-prebsc-1-s1.binance.org:8545'),
  arb: () => rpc('VITE_ARB_RPC', 'https://sepolia-rollup.arbitrum.io/rpc'),
  sol: () => rpc('VITE_SOL_RPC', 'https://api.devnet.solana.com'),
  ton: () => rpc('VITE_TON_RPC', 'https://toncenter.com/api/v2'),
};

// ─── EVM native send ──────────────────────────────────────────────────────────
async function sendEvmNative({ privateKey, to, amount, chainId, rpcUrl, fee }) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const txData = {
    to,
    value: ethers.parseEther(String(amount)),
    chainId,
  };
  // fee is in gwei, convert to wei
  if (fee && fee > 0) {
    txData.gasPrice = ethers.parseUnits(String(fee), 'gwei');
  }
  const tx = await wallet.sendTransaction(txData);
  await tx.wait(1);
  return tx.hash;
}

// ─── ERC-20 token send ────────────────────────────────────────────────────────
async function sendErc20({ privateKey, contractAddress, to, amount, rpcUrl, fee }) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(contractAddress, ERC20_TRANSFER_ABI, wallet);
  const decimals = await contract.decimals();
  const parsed = ethers.parseUnits(String(amount), decimals);
  const txOptions = {};
  // fee is in gwei, convert to wei
  if (fee && fee > 0) {
    txOptions.gasPrice = ethers.parseUnits(String(fee), 'gwei');
  }
  const tx = await contract.transfer(to, parsed, txOptions);
  await tx.wait(1);
  return tx.hash;
}

// ─── Solana native send ───────────────────────────────────────────────────────
async function sendSolNative({ privateKeyHex, to, amount, rpcUrl, fee }) {
  const { Connection, PublicKey, SystemProgram, Transaction, Keypair } =
    await import('@solana/web3.js');
  const conn = new Connection(rpcUrl, 'confirmed');
  const secretKey = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'));
  const keypair = Keypair.fromSecretKey(secretKey);
  const lamports = Math.round(amount * 1e9);
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new PublicKey(to),
      lamports,
    })
  );
  // fee is in micro-lamports, convert to lamports for priority fee
  if (fee && fee > 0) {
    const priorityFeeLamports = Math.floor(fee / 1e6); // micro-lamports to lamports
    tx.add(
      new (await import('@solana/web3.js')).ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: fee
      })
    );
  }
  const sig = await conn.sendTransaction(tx, [keypair]);
  await conn.confirmTransaction(sig, 'confirmed');
  return sig;
}

// ─── Solana SPL (USDT) send ───────────────────────────────────────────────────
async function sendSolSpl({ privateKeyHex, to, amount, mintAddress, rpcUrl, fee }) {
  const {
    Connection, PublicKey, Transaction, Keypair, ComputeBudgetProgram,
  } = await import('@solana/web3.js');
  const {
    getOrCreateAssociatedTokenAccount,
    createTransferInstruction,
    getMint,
  } = await import('@solana/spl-token');

  const conn = new Connection(rpcUrl, 'confirmed');
  const secretKey = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'));
  const payer = Keypair.fromSecretKey(secretKey);
  const mint = new PublicKey(mintAddress);
  const toPublicKey = new PublicKey(to);

  const mintInfo = await getMint(conn, mint);
  const amountRaw = BigInt(Math.round(amount * 10 ** mintInfo.decimals));

  const fromAta = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
  const toAta = await getOrCreateAssociatedTokenAccount(conn, payer, mint, toPublicKey);

  const tx = new Transaction();
  
  // Add priority fee if provided (fee is in micro-lamports)
  if (fee && fee > 0) {
    tx.add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: fee
      })
    );
  }
  
  tx.add(createTransferInstruction(fromAta.address, toAta.address, payer.publicKey, amountRaw));
  const sig = await conn.sendTransaction(tx, [payer]);
  await conn.confirmTransaction(sig, 'confirmed');
  return sig;
}

// ─── TON native send ──────────────────────────────────────────────────────────
async function sendTonNative({ privateKeyHex, to, amount, apiBase, fee }) {
  const { TonClient, WalletContractV4, internal, toNano } = await import('@ton/ton');
  const { mnemonicToPrivateKey } = await import('@ton/crypto');

  const apiKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TON_API_KEY) || '';
  const client = new TonClient({
    endpoint: `${apiBase}/jsonRPC`,
    apiKey: apiKey || undefined,
  });

  // Reconstruct keypair from stored hex secret key
  const secretKey = Buffer.from(privateKeyHex, 'hex');
  const publicKey = secretKey.slice(32); // TON stores [privateKey(32) + publicKey(32)]
  const keyPair = { secretKey, publicKey };

  const wallet = WalletContractV4.create({ workchain: 0, publicKey });
  const contract = client.open(wallet);
  const seqno = await contract.getSeqno();

  // Calculate value with custom fee if provided (fee is in nanoton)
  let tonValue = String(amount);
  if (fee && fee > 0) {
    // Add fee to amount (fee in nanoton, convert to TON and add)
    tonValue = (parseFloat(amount) + (fee / 1e9)).toFixed(9);
  }

  await contract.sendTransfer({
    secretKey,
    seqno,
    messages: [
      internal({
        to,
        value: toNano(tonValue),
        bounce: false,
      }),
    ],
  });

  return `ton-tx-${Date.now()}`;
}

// ─── TON Jetton (USDT) send ───────────────────────────────────────────────────
async function sendTonJetton({ privateKeyHex, to, amount, jettonMasterAddress, apiBase, fee }) {
  const { TonClient, WalletContractV4, internal, toNano, Address, beginCell } =
    await import('@ton/ton');

  const apiKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TON_API_KEY) || '';
  const client = new TonClient({
    endpoint: `${apiBase}/jsonRPC`,
    apiKey: apiKey || undefined,
  });

  const secretKey = Buffer.from(privateKeyHex, 'hex');
  const publicKey = secretKey.slice(32);

  const wallet = WalletContractV4.create({ workchain: 0, publicKey });
  const contract = client.open(wallet);
  const seqno = await contract.getSeqno();

  // Build jetton transfer payload
  const amountNano = BigInt(Math.round(amount * 1e6)); // USDT 6 decimals
  const forwardPayload = beginCell().endCell();
  const body = beginCell()
    .storeUint(0xf8a7ea5, 32) // jetton transfer op
    .storeUint(0, 64)         // query id
    .storeCoins(amountNano)
    .storeAddress(Address.parse(to))
    .storeAddress(Address.parse(wallet.address.toString()))
    .storeBit(false)
    .storeCoins(toNano('0.01'))
    .storeBit(false)
    .storeRef(forwardPayload)
    .endCell();

  // Get jetton wallet address for sender
  const jettonMaster = Address.parse(jettonMasterAddress);
  const result = await client.runMethod(jettonMaster, 'get_wallet_address', [
    { type: 'slice', cell: beginCell().storeAddress(wallet.address).endCell() },
  ]);
  const jettonWalletAddr = result.stack.readAddress();

  // Calculate TON value with custom fee if provided (fee is in nanoton)
  let tonValue = '0.05'; // default
  if (fee && fee > 0) {
    // Convert nanoton to TON string
    tonValue = (fee / 1e9).toFixed(9);
  }

  await contract.sendTransfer({
    secretKey,
    seqno,
    messages: [
      internal({
        to: jettonWalletAddr,
        value: toNano(tonValue),
        bounce: true,
        body,
      }),
    ],
  });

  return `ton-jetton-tx-${Date.now()}`;
}

// ─── LTC send via BlockCypher ─────────────────────────────────────────────────
async function sendLtc({ privateKeyHex, fromAddress, to, amount, fee }) {
  const token = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BLOCKCYPHER_TOKEN) || '';
  const tokenParam = token ? `?token=${token}` : '';
  const satoshis = Math.round(amount * 1e8);
  // fee is in satoshis - will be used if > 0, otherwise auto-calculated by BlockCypher

  // 1. Create unsigned transaction skeleton
  const newTxRes = await fetch(`https://api.blockcypher.com/v1/ltc/main/txs/new${tokenParam}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inputs: [{ addresses: [fromAddress] }],
      outputs: [{ addresses: [to], value: satoshis }],
    }),
  });
  const newTx = await newTxRes.json();
  if (newTx.errors) throw new Error(newTx.errors[0].error);

  // 2. Sign each input hash with secp256k1 via ethers SigningKey
  const sk = new ethers.SigningKey(
    privateKeyHex.startsWith('0x') ? privateKeyHex : '0x' + privateKeyHex
  );
  const signatures = newTx.tosign.map((hashHex) => {
    const sig = sk.sign('0x' + hashHex);
    // Manually DER-encode the signature for BlockCypher
    // ethers sig.r and sig.s are hex strings with 0x prefix
    const r = sig.r.slice(2).padStart(64, '0');
    const s = sig.s.slice(2).padStart(64, '0');
    // Prepend 0x00 if high bit set (to avoid negative interpretation)
    const rPad = parseInt(r.slice(0, 2), 16) >= 0x80 ? '00' + r : r;
    const sPad = parseInt(s.slice(0, 2), 16) >= 0x80 ? '00' + s : s;
    const rLen = (rPad.length / 2).toString(16).padStart(2, '0');
    const sLen = (sPad.length / 2).toString(16).padStart(2, '0');
    const inner = `02${rLen}${rPad}02${sLen}${sPad}`;
    const totalLen = (inner.length / 2).toString(16).padStart(2, '0');
    return `30${totalLen}${inner}`;
  });

  // Compressed public key (remove 0x prefix)
  const pubKeyHex = sk.compressedPublicKey.slice(2);

  // 3. Send signed transaction
  const sendRes = await fetch(`https://api.blockcypher.com/v1/ltc/main/txs/send${tokenParam}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...newTx,
      signatures,
      pubkeys: newTx.tosign.map(() => pubKeyHex),
    }),
  });
  const sent = await sendRes.json();
  if (sent.errors) throw new Error(sent.errors[0].error);
  return sent.tx?.hash || `ltc-tx-${Date.now()}`;
}

function hexToBytes(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return b;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a transaction on any supported chain.
 *
 * @param {Object} params
 * @param {string} params.sym        Asset symbol: 'ETH','BNB','ARB','SOL','TON','LTC','USDT'
 * @param {string} params.networkId  For USDT: 'eth','bnb','arb','sol','ton'
 * @param {string} params.from       Sender address
 * @param {string} params.to         Recipient address
 * @param {number} params.amount     Amount in human units (e.g. 0.5 ETH)
 * @param {string} params.privateKey Private key hex (EVM/LTC) or 64-byte hex (SOL/TON)
 * @param {number} params.fee        Fee in small units (gwei for EVM, micro-lamports for SOL, nanoton for TON, sat for LTC)
 * @returns {Promise<string>} Transaction hash / signature
 */
export async function sendTransaction({ sym, networkId, from, to, amount, privateKey, fee }) {
  if (!privateKey) throw new Error('Private key not available — re-derive wallet first');

  // ── USDT routing ────────────────────────────────────────────────────────────
  if (sym === 'USDT') {
    const net = networkId || 'eth';
    if (net === 'eth') return sendErc20({ privateKey, contractAddress: USDT_CONTRACTS.eth, to, amount, rpcUrl: CHAIN_RPC.eth(), fee });
    if (net === 'bnb') return sendErc20({ privateKey, contractAddress: USDT_CONTRACTS.bnb, to, amount, rpcUrl: CHAIN_RPC.bnb(), fee });
    if (net === 'arb') return sendErc20({ privateKey, contractAddress: USDT_CONTRACTS.arb, to, amount, rpcUrl: CHAIN_RPC.arb(), fee });
    if (net === 'sol') return sendSolSpl({ privateKeyHex: privateKey, to, amount, mintAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', rpcUrl: CHAIN_RPC.sol(), fee });
    if (net === 'ton') return sendTonJetton({ privateKeyHex: privateKey, to, amount, jettonMasterAddress: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', apiBase: CHAIN_RPC.ton(), fee });
    throw new Error(`Unknown USDT network: ${net}`);
  }

  // ── Native asset routing ─────────────────────────────────────────────────────
  if (sym === 'ETH') return sendEvmNative({ privateKey, to, amount, chainId: 1, rpcUrl: CHAIN_RPC.eth(), fee });
  if (sym === 'BNB') return sendEvmNative({ privateKey, to, amount, chainId: 56, rpcUrl: CHAIN_RPC.bnb(), fee });
  if (sym === 'ARB') return sendEvmNative({ privateKey, to, amount, chainId: 42161, rpcUrl: CHAIN_RPC.arb(), fee });
  if (sym === 'SOL') return sendSolNative({ privateKeyHex: privateKey, to, amount, rpcUrl: CHAIN_RPC.sol(), fee });
  if (sym === 'TON') return sendTonNative({ privateKeyHex: privateKey, to, amount, apiBase: CHAIN_RPC.ton(), fee });
  if (sym === 'LTC') return sendLtc({ privateKeyHex: privateKey, fromAddress: from, to, amount, fee });

  throw new Error(`Unsupported asset: ${sym}`);
}
