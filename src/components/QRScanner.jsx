import React, { useEffect, useRef, useState } from 'react';
import { X, Scan } from 'lucide-react';

// Lazy-load html5-qrcode only when the scanner is actually opened.
// Static import would cause html5-qrcode to fetch ZXing from unpkg.com (cross-origin)
// immediately on bundle parse, triggering "Script error." in the global error handler.
async function loadHtml5Qrcode() {
  const mod = await import('html5-qrcode');
  return mod.Html5Qrcode;
}

export default function QRScanner({ onScan, onClose }) {
  const scannerRef = useRef(null);
  const [error, setError] = useState(null);
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    let html5QrCode = null;
    let cancelled = false;

    const startScanner = async () => {
      try {
        const Html5Qrcode = await loadHtml5Qrcode();
        if (cancelled) return;

        html5QrCode = new Html5Qrcode('qr-reader');
        const cameras = await Html5Qrcode.getCameras();
        if (cancelled) return;

        if (cameras && cameras.length > 0) {
          setIsScanning(true);
          await html5QrCode.start(
            cameras[0].id,
            { fps: 10, qrbox: { width: 250, height: 250 } },
            (decodedText) => { onScan(decodedText); onClose(); },
            () => {}
          );
        } else {
          setError('No camera found');
        }
      } catch (err) {
        if (!cancelled) setError('Camera access denied or not available');
        console.warn('QR Scanner error:', err);
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      if (html5QrCode) {
        html5QrCode.stop().catch(() => {});
      }
    };
  }, [onScan, onClose]);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.95)', zIndex: 10000,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '20px'
    }}>
      <div style={{
        position: 'absolute', top: 20, right: 20, cursor: 'pointer',
        padding: 10, borderRadius: 10, background: 'rgba(255,255,255,0.1)'
      }} onClick={onClose}>
        <X size={24} color="#fff" />
      </div>

      <h3 style={{ color: '#fff', marginBottom: 20, fontSize: 18 }}>
        <Scan size={20} style={{ marginRight: 8, verticalAlign: 'middle' }} />
        Scan QR Code
      </h3>

      {error ? (
        <div style={{ color: '#ef4444', textAlign: 'center', padding: 20 }}>
          <p>{error}</p>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 10 }}>
            Please allow camera access or enter address manually
          </p>
        </div>
      ) : (
        <>
          <div id="qr-reader" style={{
            width: 300, height: 300, borderRadius: 20,
            overflow: 'hidden', border: '2px solid #2563eb'
          }} />
          <p style={{ color: 'rgba(255,255,255,0.5)', marginTop: 20, fontSize: 14 }}>
            Point camera at QR code
          </p>
        </>
      )}
    </div>
  );
}
