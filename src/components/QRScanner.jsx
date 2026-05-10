import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Scan } from 'lucide-react';

export default function QRScanner({ onScan, onClose }) {
  const scannerRef = useRef(null);
  const [error, setError] = useState(null);
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    let html5QrCode = null;

    const startScanner = async () => {
      try {
        html5QrCode = new Html5Qrcode("qr-reader");
        
        const cameras = await Html5Qrcode.getCameras();
        if (cameras && cameras.length > 0) {
          setIsScanning(true);
          await html5QrCode.start(
            cameras[0].id,
            {
              fps: 10,
              qrbox: { width: 250, height: 250 },
            },
            (decodedText) => {
              // QR Code detected
              onScan(decodedText);
              onClose();
            },
            (errorMessage) => {
              // QR Code scan error (ignore continuous scan errors)
            }
          );
        } else {
          setError('No camera found');
        }
      } catch (err) {
        setError('Camera access denied or not available');
        console.error('QR Scanner error:', err);
      }
    };

    startScanner();

    return () => {
      if (html5QrCode) {
        html5QrCode.stop().catch(console.error);
      }
    };
  }, [onScan, onClose]);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.95)',
      zIndex: 10000,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{
        position: 'absolute',
        top: 20,
        right: 20,
        cursor: 'pointer',
        padding: 10,
        borderRadius: 10,
        background: 'rgba(255,255,255,0.1)'
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
          <div 
            id="qr-reader" 
            style={{ 
              width: 300, 
              height: 300, 
              borderRadius: 20, 
              overflow: 'hidden',
              border: '2px solid #2563eb'
            }} 
          />
          <p style={{ color: 'rgba(255,255,255,0.5)', marginTop: 20, fontSize: 14 }}>
            Point camera at QR code
          </p>
        </>
      )}
    </div>
  );
}
