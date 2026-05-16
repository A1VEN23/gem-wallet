import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext.jsx';

export default function Settings() {
  const { lock, deleteWallet, getMnemonic } = useWallet();
  const [showSeed, setShowSeed] = useState(false);
  const [seedPassword, setSeedPassword] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [seedError, setSeedError] = useState('');
  const navigate = useNavigate();

  const handleLock = () => {
    lock();
    // AppRoutes автоматически покажет Unlock когда isUnlocked станет false
  };

  const handleShowSeed = async () => {
    setSeedError('');
    try {
      const m = await getMnemonic(seedPassword);
      setMnemonic(m);
    } catch {
      setSeedError('Неверный пароль');
    }
  };

  const handleDelete = () => {
    deleteWallet();
    navigate('/');
  };

  return (
    <div className="settings-page">
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate('/wallet')}>← Назад</button>
        <h2>Настройки</h2>
        <div />
      </div>

      <div className="settings-section">
        <div className="settings-item" onClick={handleLock}>
          <span className="s-icon">🔒</span>
          <div className="s-info">
            <span className="s-title">Заблокировать</span>
            <span className="s-sub">Закрыть кошелёк</span>
          </div>
          <span className="s-arrow">›</span>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-item" onClick={() => setShowSeed(s => !s)}>
          <span className="s-icon">🔑</span>
          <div className="s-info">
            <span className="s-title">Показать seed-фразу</span>
            <span className="s-sub">Просмотр резервной копии</span>
          </div>
          <span className="s-arrow">{showSeed ? '∨' : '›'}</span>
        </div>

        {showSeed && !mnemonic && (
          <div className="settings-sub-form">
            <p className="hint warn">⚠️ Никому не показывайте seed-фразу</p>
            <input
              type="password"
              placeholder="Введите пароль"
              value={seedPassword}
              onChange={e => setSeedPassword(e.target.value)}
            />
            {seedError && <div className="error-msg">{seedError}</div>}
            <button className="btn-secondary" onClick={handleShowSeed}>Показать</button>
          </div>
        )}

        {mnemonic && (
          <div className="settings-sub-form">
            <div className="mnemonic-grid small">
              {mnemonic.split(' ').map((word, i) => (
                <div key={i} className="mnemonic-word">
                  <span className="word-num">{i + 1}</span>
                  <span className="word-text">{word}</span>
                </div>
              ))}
            </div>
            <button className="btn-secondary" onClick={() => { setMnemonic(''); setSeedPassword(''); }}>
              Скрыть
            </button>
          </div>
        )}
      </div>



      <div className="settings-section danger-section">
        {!confirmDelete ? (
          <div className="settings-item danger-item" onClick={() => setConfirmDelete(true)}>
            <span className="s-icon">🗑</span>
            <div className="s-info">
              <span className="s-title">Удалить кошелёк</span>
              <span className="s-sub">Удалить с этого устройства</span>
            </div>
            <span className="s-arrow">›</span>
          </div>
        ) : (
          <div className="settings-sub-form">
            <p className="hint warn">❗ Удаление необратимо. Убедитесь, что у вас есть seed-фраза!</p>
            <div className="confirm-btns">
              <button className="btn-danger-full" onClick={handleDelete}>Удалить</button>
              <button className="btn-secondary" onClick={() => setConfirmDelete(false)}>Отмена</button>
            </div>
          </div>
        )}
      </div>

      <div className="settings-footer">
        <span>Gem Wallet TMA v1.0</span>
        <span>GPL-3.0 License</span>
      </div>
    </div>
  );
}
