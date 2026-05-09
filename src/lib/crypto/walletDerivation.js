/**
 * walletDerivation.js
 * Real BIP39 mnemonic generation + HD key derivation for all supported chains.
 * Chains: ETH, BNB, ARB (EVM m/44'/60'/0'/0/0), SOL (ed25519 m/44'/501'/0'/0'),
 *         TON (@ton/crypto mnemonicToPrivateKey), LTC (m/44'/2'/0'/0/0 P2PKH).
 *
 * Private keys are NEVER persisted — callers must hold them in memory only.
 */

import * as bip39 from 'bip39';
import { HDNodeWallet, ethers } from 'ethers';
import bs58 from 'bs58';

// ─── TON: lazy-loaded to avoid SSR issues ────────────────────────────────────
let _tonCrypto = null;
async function getTonCrypto() {
  if (!_tonCrypto) _tonCrypto = await import('@ton/crypto');
  return _tonCrypto;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hexToBytes(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function sha256Bytes(data) {
  const hex = ethers.sha256(data instanceof Uint8Array ? data : new Uint8Array(data));
  return hexToBytes(hex);
}

// ─── Minimal RIPEMD-160 (pure JS) ─────────────────────────────────────────────
function ripemd160(msg) {
  const rol32 = (n, l) => ((n << l) | (n >>> (32 - l))) >>> 0;

  function f(j, x, y, z) {
    if (j < 16) return (x ^ y ^ z) >>> 0;
    if (j < 32) return ((x & y) | (~x & z)) >>> 0;
    if (j < 48) return ((x | ~y) ^ z) >>> 0;
    if (j < 64) return ((x & z) | (y & ~z)) >>> 0;
    return (x ^ (y | ~z)) >>> 0;
  }

  const K  = [0x00000000, 0x5A827999, 0x6ED9EBA1, 0x8F1BBCDC, 0xA953FD4E];
  const KK = [0x50A28BE6, 0x5C4DD124, 0x6D703EF3, 0x7A6D76E9, 0x00000000];

  const r  = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,
              7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8,
              3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12,
              1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2,
              4,0,5,9,7,12,2,10,14,1,3,8,11,6,15,13];
  const rr = [5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12,
              6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2,
              15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13,
              8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14,
              12,15,10,4,1,5,8,7,6,2,13,14,0,3,9,11];
  const s  = [11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8,
              7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12,
              11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5,
              11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12,
              9,15,5,11,6,8,13,12,5,12,13,14,11,8,5,6];
  const ss = [8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6,
              9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11,
              9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5,
              15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8,
              8,5,12,9,12,5,14,6,8,13,6,5,15,13,11,11];

  const m = Array.from(msg);
  const bitLen = m.length * 8;
  m.push(0x80);
  while (m.length % 64 !== 56) m.push(0);
  for (let i = 0; i < 8; i++) m.push((bitLen >>> (i * 8)) & 0xff);

  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE,
      h3 = 0x10325476, h4 = 0xC3D2E1F0;

  for (let i = 0; i < m.length; i += 64) {
    const X = [];
    for (let j = 0; j < 16; j++) {
      X[j] = (m[i+j*4]) | (m[i+j*4+1]<<8) | (m[i+j*4+2]<<16) | (m[i+j*4+3]<<24);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    let aa = h0, bb = h1, cc = h2, dd = h3, ee = h4;

    for (let j = 0; j < 80; j++) {
      const jj = Math.floor(j / 16);
      let T = (rol32((a + f(j, b, c, d) + X[r[j]] + K[jj]) | 0, s[j]) + e) | 0;
      a = e; e = d; d = rol32(c, 10); c = b; b = T;
      T = (rol32((aa + f(79 - j, bb, cc, dd) + X[rr[j]] + KK[jj]) | 0, ss[j]) + ee) | 0;
      aa = ee; ee = dd; dd = rol32(cc, 10); cc = bb; bb = T;
    }
    const T = (h1 + c + dd) | 0;
    h1 = (h2 + d + ee) | 0;
    h2 = (h3 + e + aa) | 0;
    h3 = (h4 + a + bb) | 0;
    h4 = (h0 + b + cc) | 0;
    h0 = T;
  }

  const out = new Uint8Array(20);
  const view = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => view.setUint32(i * 4, h >>> 0, true));
  return out;
}

// ─── LTC P2PKH address encoder ────────────────────────────────────────────────
// LTC mainnet P2PKH version byte = 0x30 (48)
function ltcP2PKH(pubKeyBytes) {
  const hash160 = ripemd160(sha256Bytes(pubKeyBytes));
  const versioned = new Uint8Array(21);
  versioned[0] = 0x30;
  versioned.set(hash160, 1);
  const checksum = sha256Bytes(sha256Bytes(versioned)).slice(0, 4);
  const full = new Uint8Array(25);
  full.set(versioned);
  full.set(checksum, 21);
  return bs58.encode(full);
}

// ─── Compressed secp256k1 public key from private key hex ────────────────────
function compressedPubKey(privKeyHex) {
  const sk = new ethers.SigningKey(privKeyHex);
  // publicKey is "0x04<x><y>" (65 bytes uncompressed)
  const uncompressed = hexToBytes(sk.publicKey);
  // uncompressed[0] === 0x04, x = [1..32], y = [33..64]
  const x = uncompressed.slice(1, 33);
  const y = uncompressed.slice(33, 65);
  const prefix = (y[31] & 1) === 0 ? 0x02 : 0x03;
  const compressed = new Uint8Array(33);
  compressed[0] = prefix;
  compressed.set(x, 1);
  return compressed;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a fresh BIP39 12-word mnemonic.
 * @returns {string} space-separated mnemonic
 */
export function generateMnemonic() {
  return bip39.generateMnemonic(128); // 128 bits = 12 words
}

/**
 * Validate a mnemonic string.
 * @param {string} phrase
 * @returns {boolean}
 */
export function validateMnemonic(phrase) {
  return bip39.validateMnemonic(phrase.trim().toLowerCase());
}

/**
 * Derive all wallet addresses and private keys from a mnemonic.
 * Returns { addresses, privateKeys } — privateKeys must stay in memory only.
 *
 * @param {string|string[]} mnemonicOrWords
 * @returns {Promise<{ addresses: Object, privateKeys: Object }>}
 */
export async function deriveWallet(mnemonicOrWords) {
  const phrase = Array.isArray(mnemonicOrWords)
    ? mnemonicOrWords.join(' ')
    : mnemonicOrWords;

  const seed = await bip39.mnemonicToSeed(phrase.trim());
  const seedBytes = seed instanceof Uint8Array ? seed : new Uint8Array(seed);

  const root = HDNodeWallet.fromSeed(seedBytes);
  const addresses = {};
  const privateKeys = {};

  // ── EVM chains (ETH, BNB, ARB share same derivation path) ──────────────────
  const evmPath = "m/44'/60'/0'/0/0";
  const evmChild = root.derivePath(evmPath);
  const evmAddress = evmChild.address;
  const evmPrivKey = evmChild.privateKey;

  addresses.ETH = evmAddress;
  addresses.BNB = evmAddress;
  addresses.ARB = evmAddress;
  privateKeys.ETH = evmPrivKey;
  privateKeys.BNB = evmPrivKey;
  privateKeys.ARB = evmPrivKey;

  // ── Solana (ed25519, m/44'/501'/0'/0') ─────────────────────────────────────
  try {
    const { Keypair } = await import('@solana/web3.js');
    const { HDKey } = await import('@scure/bip32');
    const hdKey = HDKey.fromMasterSeed(seedBytes);
    const solChild = hdKey.derive("m/44'/501'/0'/0'");
    const solKeypair = Keypair.fromSeed(solChild.privateKey.slice(0, 32));
    addresses.SOL = solKeypair.publicKey.toBase58();
    // Store full 64-byte secret key as hex for signing
    privateKeys.SOL = Buffer.from(solKeypair.secretKey).toString('hex');
  } catch (e) {
    console.warn('SOL derivation failed:', e.message);
    addresses.SOL = null;
    privateKeys.SOL = null;
  }

  // ── TON (mnemonicToPrivateKey from @ton/crypto) ─────────────────────────────
  try {
    const { mnemonicToPrivateKey } = await getTonCrypto();
    const { WalletContractV4 } = await import('@ton/ton');
    const words = phrase.trim().split(/\s+/);
    const tonKeyPair = await mnemonicToPrivateKey(words);
    const tonWallet = WalletContractV4.create({
      workchain: 0,
      publicKey: tonKeyPair.publicKey,
    });
    addresses.TON = tonWallet.address.toString({ bounceable: false, urlSafe: true });
    privateKeys.TON = Buffer.from(tonKeyPair.secretKey).toString('hex');
  } catch (e) {
    console.warn('TON derivation failed:', e.message);
    addresses.TON = null;
    privateKeys.TON = null;
  }

  // ── LTC (m/44'/2'/0'/0/0, P2PKH with version byte 0x30) ───────────────────
  try {
    const ltcPath = "m/44'/2'/0'/0/0";
    const ltcChild = root.derivePath(ltcPath);
    const ltcPrivHex = ltcChild.privateKey;
    const pubKey = compressedPubKey(ltcPrivHex);
    addresses.LTC = ltcP2PKH(pubKey);
    privateKeys.LTC = ltcPrivHex;
  } catch (e) {
    console.warn('LTC derivation failed:', e.message);
    addresses.LTC = null;
    privateKeys.LTC = null;
  }

  return { addresses, privateKeys };
}

/**
 * Get only the private key for a specific chain from a mnemonic.
 * @param {string|string[]} mnemonicOrWords
 * @param {string} chain  e.g. 'ETH', 'SOL', 'TON', 'LTC'
 * @returns {Promise<string|null>}
 */
export async function getPrivateKey(mnemonicOrWords, chain) {
  const { privateKeys } = await deriveWallet(mnemonicOrWords);
  return privateKeys[chain] || null;
}
