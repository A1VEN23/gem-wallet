import * as bip39 from 'bip39';
import { HDNodeWallet, ethers } from 'ethers';

export const NETWORKS = {
  ethereum: { id:'ethereum', name:'Ethereum', symbol:'ETH', decimals:18, color:'#627EEA', icon:'⟠', rpc:'https://eth.llamarpc.com', explorer:'https://etherscan.io', type:'evm', chainId:1, derivationPath:"m/44'/60'/0'/0/0" },
  bsc:      { id:'bsc',      name:'BNB Chain', symbol:'BNB', decimals:18, color:'#F3BA2F', icon:'⬡', rpc:'https://bsc-dataseed.binance.org', explorer:'https://bscscan.com', type:'evm', chainId:56, derivationPath:"m/44'/60'/0'/0/0" },
  arbitrum: { id:'arbitrum', name:'Arbitrum', symbol:'ETH', decimals:18, color:'#12AAFF', icon:'⬡', rpc:'https://arb1.arbitrum.io/rpc', explorer:'https://arbiscan.io', type:'evm', chainId:42161, derivationPath:"m/44'/60'/0'/0/0" },
  solana:   { id:'solana',   name:'Solana',   symbol:'SOL', decimals:9,  color:'#9945FF', icon:'◎', rpc:'https://api.mainnet-beta.solana.com', explorer:'https://solscan.io', type:'solana', derivationPath:"m/44'/501'/0'/0'" },
  ton:      { id:'ton',      name:'TON',      symbol:'TON', decimals:9,  color:'#0088CC', icon:'💎', rpc:'https://toncenter.com/api/v2', explorer:'https://tonscan.org', type:'ton', derivationPath:null },
  litecoin: { id:'litecoin', name:'Litecoin', symbol:'LTC', decimals:8,  color:'#BFBBBB', icon:'Ł', rpc:null, explorer:'https://blockchair.com/litecoin', type:'litecoin', derivationPath:"m/44'/2'/0'/0/0" },
};

export function generateMnemonic() { return bip39.generateMnemonic(128); }
export function validateMnemonic(m) { return bip39.validateMnemonic(m.trim().toLowerCase()); }

export async function deriveAddresses(mnemonic) {
  const seed = await bip39.mnemonicToSeed(mnemonic.trim());
  // Ensure seed is a Uint8Array (not Buffer) for browser compatibility
  const seedBytes = seed instanceof Uint8Array ? seed : new Uint8Array(seed);
  const addresses = {};
  let root = null;
  try { root = HDNodeWallet.fromSeed(seedBytes); } catch(e) { return addresses; }

  for (const [netId, net] of Object.entries(NETWORKS)) {
    try {
      if (net.type === 'evm') {
        const child = root.derivePath(net.derivationPath);
        addresses[netId] = child.address;
      } else if (net.type === 'bitcoin') {
        // Use standard EVM-compatible derivation for display
        const child = root.derivePath("m/44'/0'/0'/0/0");
        addresses[netId] = child.address;
      } else if (net.type === 'solana') {
        // Use ETH-style derivation as a placeholder (real SOL needs ed25519)
        const child = root.derivePath("m/44'/60'/0'/0/1");
        addresses[netId] = child.address;
      } else if (net.type === 'tron') {
        const child = root.derivePath(net.derivationPath);
        addresses[netId] = child.address;
      }
    } catch(e) { addresses[netId] = null; }
  }
  return addresses;
}

export async function encryptMnemonic(mnemonic, password) {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.deriveKey({ name:'PBKDF2', salt, iterations:100000, hash:'SHA-256' }, km, { name:'AES-GCM', length:256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, enc.encode(mnemonic));
  return { salt:Array.from(salt), iv:Array.from(iv), data:Array.from(new Uint8Array(encrypted)) };
}

export async function decryptMnemonic(stored, password) {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name:'PBKDF2', salt:new Uint8Array(stored.salt), iterations:100000, hash:'SHA-256' }, km, { name:'AES-GCM', length:256 }, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name:'AES-GCM', iv:new Uint8Array(stored.iv) }, key, new Uint8Array(stored.data));
  return new TextDecoder().decode(decrypted);
}

export async function fetchEvmBalance(address, rpcUrl) {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const balance = await provider.getBalance(address);
    return ethers.formatEther(balance);
  } catch { return '0'; }
}

export async function sendEvmTransaction({ mnemonic, network, toAddress, amount }) {
  const seed = await bip39.mnemonicToSeed(mnemonic.trim());
  const seedBytes = seed instanceof Uint8Array ? seed : new Uint8Array(seed);
  const root = HDNodeWallet.fromSeed(seedBytes);
  const child = root.derivePath(network.derivationPath);
  const provider = new ethers.JsonRpcProvider(network.rpc);
  const wallet = child.connect(provider);
  const tx = await wallet.sendTransaction({ to: toAddress, value: ethers.parseEther(amount.toString()) });
  return tx.hash;
}
