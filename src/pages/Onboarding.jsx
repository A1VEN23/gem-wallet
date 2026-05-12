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
        <div className="onboard-welcome">
          <div className="gem-logo">
            <div className="gem-shape">
              <span className="gem-inner">◈</span>
            </div>
          </div>
          <h1>Gem Wallet</h1>
          <p className="subtitle">Некастодиальный крипто-кошелёк<br />в Telegram</p>
          <div className="onboard-btns">
            <button className="btn-primary" onClick={() => setStep('create')}>
              Создать кошелёк
            </button>
            <button className="btn-secondary" onClick={() => setStep('import')}>
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
            {mnemonic.split(' ').map((word, i) => (
              <div key={i} className="mnemonic-word">
                <span className="word-num">{i + 1}</span>
                <span className="word-text">{word}</span>
              </div>
            ))}
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
            />
            Я записал(а) seed-фразу в безопасном месте
          </label>
          <button
            className="btn-primary"
            disabled={!confirmed}
            onClick={() => navigate('/wallet')}
          >
            Готово
          </button>
        </div>
      )}

      {step === 'import' && (
        <div className="onboard-form">
          <button className="back-btn" onClick={() => { setStep('welcome'); setError(''); }}>← Назад</button>
          <h2>Импорт кошелька</h2>
          <p className="hint">Введите 12 или 24 слова seed-фразы</p>
          <div className="form-group">
            <label>Seed-фраза</label>
            <textarea
              placeholder="слово1 слово2 слово3..."
              value={importPhrase}
              onChange={e => setImportPhrase(e.target.value)}
              rows={4}
            />
          </div>
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
          <button className="btn-primary" onClick={handleImport} disabled={loading}>
            {loading ? 'Импорт...' : 'Импортировать'}
          </button>
        </div>
      )}
    </div>
  );
}
