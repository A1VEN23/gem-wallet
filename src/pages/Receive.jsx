import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext.jsx';

// Simple QR code via API
function QRCode({ value, size = 200 }) {
  return (
    <img
      src={`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&bgcolor=1a1a2e&color=ffffff&margin=10`}
      alt="QR Code"
      width={size}
      height={size}
      className="qr-image"
    />
  );
}

export default function Receive() {
  const { addresses, networks, activeNetwork, setActiveNetwork } = useWallet();
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  const net = networks[activeNetwork];
  const address = addresses[activeNetwork] || '';

  const handleCopy = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="receive-page">
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate('/wallet')}>← Назад</button>
        <h2>Получить</h2>
        <div />
      </div>

      {/* Network Selector */}
      <div className="net-selector-scroll">
        {Object.values(networks).map(n => (
          <button
            key={n.id}
            className={`net-chip ${activeNetwork === n.id ? 'active' : ''}`}
            onClick={() => setActiveNetwork(n.id)}
            style={{ '--nc': n.color }}
          >
            {n.symbol}
          </button>
        ))}
      </div>

      <div className="qr-card">
        <div className="qr-net-label">
          <span style={{ color: net?.color }}>●</span> {net?.name}
        </div>
        {address ? (
          <QRCode value={address} size={200} />
        ) : (
          <div className="qr-placeholder">Адрес недоступен</div>
        )}
        <div className="qr-address" onClick={handleCopy}>
          <span className="addr-full">{address}</span>
          <button className="copy-btn">{copied ? '✓ Скопировано' : '⎘ Копировать'}</button>
        </div>
      </div>

      <p className="receive-hint">
        Отправляйте только <strong>{net?.symbol}</strong> на этот адрес.<br />
        Отправка других монет может привести к потере средств.
      </p>
    </div>
  );
}
