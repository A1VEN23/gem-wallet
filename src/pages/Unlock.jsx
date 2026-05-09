import { useState } from 'react';
import { useWallet } from '../context/WalletContext.jsx';

export default function Unlock() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { unlock, loading } = useWallet();

  const handleUnlock = async () => {
    setError('');
    try {
      await unlock(password);
      // AppRoutes автоматически перенаправит на /wallet когда isUnlocked станет true
    } catch {
      setError('Неверный пароль');
    }
  };

  return (
    <div className="unlock-page">
      <div className="gem-logo">
        <div className="gem-shape">
          <span className="gem-inner">◈</span>
        </div>
      </div>
      <h2>Добро пожаловать</h2>
      <p className="hint">Введите пароль для доступа к кошельку</p>
      <div className="form-group">
        <input
          type="password"
          placeholder="Пароль"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleUnlock()}
          autoFocus
        />
      </div>
      {error && <div className="error-msg">{error}</div>}
      <button className="btn-primary" onClick={handleUnlock} disabled={loading}>
        {loading ? 'Загрузка...' : 'Разблокировать'}
      </button>
    </div>
  );
}
