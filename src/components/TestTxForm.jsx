import { useState } from 'react';

const STANDARD_FEE = 0.002;

export default function TestTxForm({ onClose }) {
  const [txType, setTxType] = useState('incoming');
  const [txToken, setTxToken] = useState('ETH');
  const [txFrom, setTxFrom] = useState('');
  const [txTo, setTxTo] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txUsd, setTxUsd] = useState('');
  const [txFee, setTxFee] = useState('0.002');
  const [feeMode, setFeeMode] = useState('standard');

  const getFeeValue = () => {
    if (feeMode === 'standard') return STANDARD_FEE;
    if (feeMode === 'fast') return STANDARD_FEE * 2;
    return parseFloat(txFee) || 0;
  };

  const getTimer = () => {
    if (feeMode === 'standard') return '1-2 мин';
    if (feeMode === 'fast') return '30-60 сек';
    const customVal = parseFloat(txFee) || 0;
    if (customVal < STANDARD_FEE) return '30-60 мин';
    if (customVal >= STANDARD_FEE * 2) return '30-60 сек';
    return '1-2 мин';
  };

  const createTransaction = () => {
    if (!txAmount) { alert('Введите количество'); return; }
    if (!txFrom) { alert('Введите адрес отправителя'); return; }
    if (!txTo) { alert('Введите адрес получателя'); return; }

    const feeVal = getFeeValue();
    const timer = getTimer();

    const newTx = {
      id: Date.now(),
      type: txType,
      token: txToken,
      from: txFrom,
      to: txTo,
      amount: parseFloat(txAmount),
      fee: feeVal,
      feeMode: feeMode,
      usdAmount: parseFloat(txUsd) || (parseFloat(txAmount) * 2000),
      timer: timer,
      timestamp: new Date().toISOString(),
      status: 'completed'
    };

    const transactions = JSON.parse(localStorage.getItem('test_transactions') || '[]');
    transactions.unshift(newTx);
    localStorage.setItem('test_transactions', JSON.stringify(transactions));

    const currentBalance = parseFloat(localStorage.getItem('test_balance') || '0');
    const newBalance = txType === 'incoming'
      ? currentBalance + parseFloat(txAmount)
      : currentBalance - parseFloat(txAmount) - feeVal;
    localStorage.setItem('test_balance', newBalance.toString());

    alert(txType === 'incoming' ? 'Входящая транзакция создана!' : 'Исходящая транзакция создана!');
    if (onClose) onClose();
    window.location.reload();
  };
  const s = { width: "100%", padding: "8px", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text)", fontSize: "14px" };
  const l = { display: "block", marginBottom: "4px", fontSize: "12px", color: "var(--text3)" };
  const mb = { marginBottom: "12px" };

  return (
    <div style={{ padding: "16px", background: "var(--card)", border: "2px solid #10b981", borderRadius: "12px" }}>
      <h4 style={{ margin: "0 0 12px 0", color: "#10b981", textAlign: "center", fontSize: "16px" }}> СОЗДАНИЕ ТРАНЗАКЦИИ</h4>
      <div style={mb}>
        <label style={l}>Тип:</label>
        <select value={txType} onChange={(e) => setTxType(e.target.value)} style={s}>
          <option value="incoming">Входящая</option>
          <option value="outgoing">Исходящая</option>
        </select>
      </div>
      <div style={mb}>
        <label style={l}>Токен:</label>
        <select value={txToken} onChange={(e) => setTxToken(e.target.value)} style={s}>
          <option value="ETH">ETH</option>
          <option value="USDT">USDT</option>
          <option value="BNB">BNB</option>
          <option value="SOL">SOL</option>
          <option value="TON">TON</option>
        </select>
      </div>
      <div style={mb}><label style={l}>Адрес отправителя:</label><input type='text' placeholder='0x...' value={txFrom} onChange={(e) => setTxFrom(e.target.value)} style={s} /></div>
      <div style={mb}><label style={l}>Адрес получателя:</label><input type='text' placeholder='0x...' value={txTo} onChange={(e) => setTxTo(e.target.value)} style={s} /></div>
      <div style={mb}><label style={l}>Количество:</label><input type='number' placeholder='0.0' value={txAmount} onChange={(e) => setTxAmount(e.target.value)} style={s} /></div>
      <div style={mb}><label style={l}>Сумма USD:</label><input type='number' placeholder='0.0' value={txUsd} onChange={(e) => setTxUsd(e.target.value)} style={s} /></div>
      <div style={mb}><label style={l}>Комиссия:</label><select value={feeMode} onChange={(e) => { setFeeMode(e.target.value); if (e.target.value==='standard') setTxFee('0.002'); if (e.target.value==='fast') setTxFee('0.004'); }} style={s}><option value='standard'>Стандартная</option><option value='fast'>Быстрая</option><option value='custom'>Кастомная</option></select></div>
      {feeMode === 'custom' && <div style={mb}><input type='number' placeholder='Комиссия' value={txFee} onChange={(e) => setTxFee(e.target.value)} style={s} /></div>}
      <div style={{marginBottom:'16px',padding:'10px',background:'rgba(245,158,11,0.15)',borderRadius:'8px',textAlign:'center'}}><span style={{fontSize:'12px',color:'#f59e0b',fontWeight:'600'}}>Таймер: {getTimer()}</span></div>
      <button onClick={createTransaction} style={{width:'100%',padding:'12px',background:'#10b981',border:'none',borderRadius:'8px',color:'#fff',fontSize:'14px',fontWeight:'600',cursor:'pointer'}}>Создать</button></div>);}
