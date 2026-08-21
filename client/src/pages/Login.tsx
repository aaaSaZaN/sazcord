import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import PasswordInput from '../components/PasswordInput';

export default function Login() {
  const { login } = useAuth();
  const t = useT();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message || t('login.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell min-h-full grid place-items-center p-6">
      <form onSubmit={onSubmit} className="auth-card card w-full max-w-sm p-6 space-y-4">
        <div className="flex flex-col items-center gap-2 mb-2">
          <div className="brand-glow w-12 h-12 rounded-2xl bg-accent grid place-items-center shadow-soft">
            <LogIn size={22} />
          </div>
          <h1 className="text-xl font-semibold">{t('login.title')}</h1>
          <p className="text-slate-400 text-sm text-center">{t('login.subtitle')}</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-slate-300">{t('common.username')}</label>
          <input
            className="input"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm text-slate-300">{t('common.password')}</label>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {error && <div className="text-sm text-danger">{error}</div>}

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? t('login.submitting') : t('common.login')}
        </button>

        <div className="text-sm text-slate-400 text-center">
          {t('login.noAccount')}{' '}
          <Link to="/register" className="text-accent hover:underline">
            {t('login.register')}
          </Link>
        </div>
      </form>
    </div>
  );
}
