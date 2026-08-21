// Лендинг приглашения: /invite/<code>.
//
// Ссылка — обёртка над обычным кодом, отдельной сущности на сервере нет.
// Открытие страницы использование НЕ списывает (иначе одноразовый код
// сгорал бы от превью ссылки в мессенджере или от F5) — код уходит на
// сервер только вместе с формой регистрации.
//
// Публичный GET /api/invites/:code/info отдаёт лишь {valid, invitedBy}:
// человек, открывающий ссылку, аккаунта ещё не имеет, и знать про счётчик
// использований, срок и заметку ему незачем.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { UserPlus, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import PasswordInput from '../components/PasswordInput';
import { api } from '../api';

export default function Invite() {
  const { code = '' } = useParams();
  const { register } = useAuth();
  const t = useT();

  const [checking, setChecking] = useState(true);
  const [invite, setInvite] = useState({ valid: false, invitedBy: null });
  const [info, setInfo] = useState({
    disabled: false,
    inviteRequired: false,
    bootstrap: false,
    privacyEnabled: false,
    requirePrivacyConsent: false,
  });

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.inviteInfo(code).catch(() => ({ valid: false, invitedBy: null })),
      api.registrationInfo().catch(() => null),
    ]).then(([inv, reg]) => {
      if (cancelled) return;
      setInvite({ valid: !!inv?.valid, invitedBy: inv?.invitedBy || null });
      if (reg) setInfo(reg);
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (password !== password2) {
      setError(t('register.passwordMismatch'));
      return;
    }
    if (info.requirePrivacyConsent && !consent) {
      setError(t('register.consentRequired'));
      return;
    }
    setLoading(true);
    try {
      await register(username.trim(), password, code, {
        privacyConsent: consent,
        displayName: displayName.trim(),
        bio: bio.trim(),
      });
    } catch (err) {
      setError(err.message || t('register.error'));
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="auth-shell min-h-full grid place-items-center p-6 text-slate-400">
        {t('invite.checking')}
      </div>
    );
  }

  // Один и тот же экран для «кода нет», «отозван», «просрочен» и
  // «исчерпан»: сервер эти случаи наружу не различает намеренно.
  if (!invite.valid || info.disabled) {
    return (
      <div className="auth-shell min-h-full grid place-items-center p-6">
        <div className="auth-card card w-full max-w-sm p-6 space-y-4 text-center">
          <div className="flex flex-col items-center gap-2 mb-2">
            <div className="w-12 h-12 rounded-2xl bg-bg-2 grid place-items-center shadow-soft">
              <Lock size={22} />
            </div>
            <h1 className="text-xl font-semibold">{t('invite.invalidTitle')}</h1>
            <p className="text-slate-400 text-sm">{t('invite.invalidText')}</p>
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
          <h1 className="text-xl font-semibold">{t('invite.title')}</h1>
          <p className="text-slate-400 text-sm text-center">
            {invite.invitedBy ? t('invite.by', { name: invite.invitedBy }) : t('invite.valid')}
          </p>
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
          <p className="text-xs text-slate-500">{t('register.rules', { chars: '_ . -' })}</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-slate-300">{t('invite.displayName')}</label>
          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={48}
            placeholder={t('invite.optional')}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm text-slate-300">{t('invite.bio')}</label>
          <textarea
            className="input min-h-[72px] resize-y"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={300}
            placeholder={t('invite.optional')}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm text-slate-300">{t('common.password')}</label>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm text-slate-300">{t('common.passwordRepeat')}</label>
          <PasswordInput
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
          />
        </div>

        {info.requirePrivacyConsent && (
          <label className="flex items-start gap-2 text-xs text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              required
            />
            <span>
              {t('register.consent')}{' '}
              <a
                href="/privacy"
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent hover:underline"
              >
                {t('register.consentLink')}
              </a>{' '}
              (152-ФЗ).
            </span>
          </label>
        )}

        {error && <div className="text-sm text-danger">{error}</div>}

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? t('register.submitting') : t('invite.submit')}
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
