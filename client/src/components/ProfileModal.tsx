import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { X, Phone, Video, Bell, BellOff } from 'lucide-react';
import Avatar from './Avatar';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useMutes } from '../context/MutesContext';
import { formatDate, getAvatarUrl, getDisplayName, hasCustomDisplayName } from '../utils/user';
import { modalVariants, overlayVariants, reducedVariants } from '../utils/motion';

export default function ProfileModal({ userId, onClose, onCallAudio, onCallVideo }) {
  const { auth } = useAuth();
  const { isMuted, toggle: toggleMute } = useMutes();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .user(auth.token, userId)
      .then((r) => {
        if (!cancelled) setUser(r.user);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, auth.token]);

  const reduce = useReducedMotion();
  if (!userId) return null;

  const displayName = getDisplayName(user);
  const isCustomName = hasCustomDisplayName(user);
  const avatarUrl = getAvatarUrl(user);
  const muted = isMuted(userId);
  const isSelf = userId === auth.user.id;

  const overlayV = reduce ? reducedVariants(overlayVariants) : overlayVariants;
  const panelV = reduce ? reducedVariants(modalVariants) : modalVariants;

  return (
    <motion.div
      key="profile-modal"
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm grid place-items-center p-4"
      onClick={onClose}
      variants={overlayV}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div
        className="card w-full max-w-sm overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        variants={panelV}
      >
        <div className="relative h-24 bg-gradient-to-br from-accent/40 to-accent/10">
          <button className="absolute top-2 right-2 btn-ghost" onClick={onClose} title="Закрыть">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pb-5 -mt-10">
          {loading && (
            <div className="flex flex-col items-center gap-3 pt-8 text-slate-400">Загрузка…</div>
          )}
          {error && <div className="text-sm text-danger pt-8">{error}</div>}
          {user && !loading && (
            <>
              <div className="flex flex-col items-center gap-2">
                <Avatar
                  name={displayName}
                  src={avatarUrl}
                  size={80}
                  online={user.online}
                  showStatus
                />
                <div className="text-center">
                  <div className="text-xl font-semibold leading-tight">{displayName}</div>
                  {isCustomName && (
                    <div className="text-sm text-slate-500 mt-0.5">@{user.username}</div>
                  )}
                  <div
                    className={`text-xs mt-1 ${user.online ? 'text-success' : 'text-slate-500'}`}
                  >
                    {user.online ? 'в сети' : 'не в сети'}
                  </div>
                </div>
              </div>

              <div className="mt-5 space-y-2 text-sm">
                <Row label="Логин" value={`@${user.username}`} />
                <Row label="Регистрация" value={formatDate(user.createdAt)} />
              </div>

              {!isSelf && (
                <div className="mt-5 grid grid-cols-3 gap-2">
                  <Action onClick={onCallAudio} title="Позвонить">
                    <Phone size={16} />
                    <span>Звонок</span>
                  </Action>
                  <Action onClick={onCallVideo} title="Видеозвонок">
                    <Video size={16} />
                    <span>Видео</span>
                  </Action>
                  <Action
                    onClick={() => toggleMute(user.id)}
                    title={muted ? 'Включить уведомления' : 'Отключить уведомления'}
                    danger={muted}
                  >
                    {muted ? <BellOff size={16} /> : <Bell size={16} />}
                    <span>{muted ? 'Размутить' : 'Мут'}</span>
                  </Action>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-border last:border-b-0">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-100 text-right truncate">{value}</span>
    </div>
  );
}

function Action({ children, onClick, title, danger = false }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex flex-col items-center justify-center gap-1 py-2.5 rounded-lg border border-border transition-colors
        ${danger ? 'bg-danger/20 hover:bg-danger/30 text-red-300' : 'bg-bg-3 hover:bg-bg-2 text-slate-100'}
      `}
    >
      {children}
    </button>
  );
}
