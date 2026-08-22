import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import PasswordInput from '../components/PasswordInput';
import { api } from '../api';

export default function Register() {
  const { register } = useAuth();
  const t = useT();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [invite, setInvite] = useState('');
  const [info, setInfo] = useState({
    disabled: false,
    inviteRequired: false,
    bootstrap: false,
  });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // Узнаём режим регистрации у сервера: открыта/закрыта, нужен ли код.
  useEffect(() => {
    let cancelled = false;
    api
      .registrationInfo()
      .then((r) => {
        if (!cancelled) setInfo(r);
      })
      .catch(() => {
        /* серверу плохо — оставим дефолты */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (password !== password2) {
      setError(t('register.passwordMismatch'));
      return;
    }
    setLoading(true);
    try {
      await register(username.trim(), password, invite.trim() || undefined);
    } catch (err) {
      setError(err.message || t('register.error'));
    } finally {
      setLoading(false);
    }
  };

  if (info.disabled) {
    return (
      <div className="auth-shell min-h-full grid place-items-center p-6">
        <div className="auth-card card w-full max-w-sm p-6 space-y-4 text-center">
          <div className="flex flex-col items-center gap-2 mb-2">
            <div className="w-12 h-12 rounded-2xl bg-bg-2 grid place-items-center shadow-soft">
              <Lock size={22} />
            </div>
            <h1 className="text-xl font-semibold">{t('register.closedTitle')}</h1>
            <p className="text-slate-400 text-sm">{t('register.closedText')}</p>
          </div>
          <Link to="/login" className="btn-primary w-full inline-block text-center">
            {t('common.login')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell min-h-full grid place-items-center p-6">
      <form onSubmit={onSubmit} className="auth-card card w-full max-w-sm p-6 space-y-4">
        <div className="flex flex-col items-center gap-2 mb-2">
          <div className="brand-glow w-12 h-12 rounded-2xl bg-accent grid place-items-center shadow-soft">
            <UserPlus size={22} />
          </div>
          <h1 className="text-xl font-semibold">{t('register.title')}</h1>
          <p className="text-slate-400 text-sm text-center">
            {t('register.rules', { chars: '_ . -' })}
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-slate-300">{t('common.username')}</label>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
            minLength={3}
            maxLength={24}
            autoComplete="username"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm text-slate-300">{t('common.password')}</label>
          <PasswordInput
            value={password}
            onChange={setPassword}
            required
            minLength={6}
            autoComplete="new-password"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm text-slate-300">{t('register.repeatPassword')}</label>
          <PasswordInput
            value={password2}
            onChange={setPassword2}
            required
            minLength={6}
            autoComplete="new-password"
          />
        </div>

        {info.bootstrap && (
          <p className="text-xs text-emerald-400/90 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-3 py-2">
            {t('register.bootstrapHint')}
          </p>
        )}

        {info.inviteRequired && (
          <div className="space-y-2">
            <label className="text-sm text-slate-300">{t('register.inviteLabel')}</label>
            <input
              className="input"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              placeholder={t('register.invitePlaceholder')}
              required
            />
            <p className="text-xs text-slate-500">{t('register.inviteHint')}</p>
          </div>
        )}

        {error && <div className="text-sm text-danger">{error}</div>}

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? t('register.submitting') : t('register.submit')}
        </button>

        <div className="text-sm text-slate-400 text-center">
          {t('register.haveAccount')}{' '}
          <Link to="/login" className="text-accent hover:underline">
            {t('common.login')}
          </Link>
        </div>
      </form>
    </div>
  );
}
