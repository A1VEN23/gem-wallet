import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext.jsx';
import { validateMnemonic } from '../lib/wallet.js';

export default function Onboarding() {
  const [step, setStep] = useState('welcome'); // welcome | create | import | backup | setpin
  const [mnemonic, setMnemonic] = useState('');
  const [importPhrase, setImportPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const { createWallet, importWallet, loading } = useWallet();
  const navigate = useNavigate();

  const handleCreate = async () => {
    setError('');
    if (password.length < 6) { setError('Пароль минимум 6 символов'); return; }
    if (password !== password2) { setError('Пароли не совпадают'); return; }
    try {
      const m = await createWallet(password);
      setMnemonic(m);
      setStep('backup');
    } catch (e) {
      setError(e.message);
    }
  };

  const handleImport = async () => {
    setError('');
    if (!validateMnemonic(importPhrase)) { setError('Неверная seed-фраза'); return; }
    if (password.length < 6) { setError('Пароль минимум 6 символов'); return; }
    if (password !== password2) { setError('Пароли не совпадают'); return; }
    try {
      await importWallet(importPhrase, password);
      navigate('/wallet');
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="onboarding">
      {step === 'welcome' && (
        <div className="onboard-welcome" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '20px' }}>
          <div className="gem-logo" style={{ marginBottom: '40px' }}>
            <div className="gem-shape" style={{ width: '120px', height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', borderRadius: '24px', boxShadow: '0 10px 40px rgba(102, 126, 234, 0.4)' }}>
              <span className="gem-inner" style={{ fontSize: '60px', color: '#fff' }}>◈</span>
            </div>
          </div>
          <div className="onboard-btns" style={{ width: '100%', maxWidth: '280px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <button className="btn-primary" onClick={() => setStep('create')} style={{ padding: '16px', fontSize: '16px', fontWeight: 600, borderRadius: '12px', background: '#10b981', color: '#fff', border: 'none', cursor: 'pointer' }}>
              Создать кошелёк
            </button>
            <button className="btn-secondary" onClick={() => setStep('import')} style={{ padding: '16px', fontSize: '16px', fontWeight: 600, borderRadius: '12px', background: 'transparent', color: '#fff', border: '2px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>
              Импортировать
            </button>
          </div>
        </div>
      )}

      {step === 'create' && (
        <div className="onboard-form">
          <button className="back-btn" onClick={() => { setStep('welcome'); setError(''); }}>← Назад</button>
          <h2>Новый кошелёк</h2>
          <p className="hint">Придумайте пароль для защиты кошелька на этом устройстве</p>
          <div className="form-group">
            <label>Пароль</label>
            <input
              type="password"
              placeholder="Минимум 6 символов"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Повторите пароль</label>
            <input
              type="password"
              placeholder="Повторите пароль"
              value={password2}
              onChange={e => setPassword2(e.target.value)}
            />
          </div>
          {error && <div className="error-msg">{error}</div>}
          <button className="btn-primary" onClick={handleCreate} disabled={loading}>
            {loading ? 'Создание...' : 'Создать'}
          </button>
        </div>
      )}

      {step === 'backup' && (
        <div className="onboard-form">
          <h2>Сохраните seed-фразу</h2>
          <p className="hint warn">⚠️ Запишите эти 12 слов. Они дают полный доступ к кошельку. Никому не показывайте!</p>
          <div className="mnemonic-grid">
            {(mnemonic || '').split(' ').filter(Boolean).map((word, i) => (
              <div key={i} className="mnemonic-word">
                <span className="word-num">{i + 1}</span>
                <span className="word-text">{word}</span>
              </div>
            ))}
            {(!mnemonic || mnemonic.split(' ').filter(Boolean).length === 0) && (
              <div style={{gridColumn: '1/-1', textAlign: 'center', padding: '20px', color: 'rgba(255,255,255,0.5)'}}>
                Генерация фразы...
              </div>
            )}
          </div>
          <label className="checkbox-label">
            <input
