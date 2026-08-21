// Таб «Профиль»: смена displayName, аватар, удаление аккаунта.
// DeleteAccountModal живёт здесь же, потому что используется только отсюда
// (вытаскивать в отдельный файл нет смысла — всего ~110 строк, плотно
// связаны с ProfileTab.logout).

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Upload, Trash2, AlertTriangle, UserX } from 'lucide-react';
import { modalVariants, overlayVariants, reducedVariants } from '../../utils/motion';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { api } from '../../api';
import { getAvatarUrl, getDisplayName } from '../../utils/user';
import Avatar from '../Avatar';

export function ProfileTab() {
  const { auth, updateUser, logout } = useAuth();
  const toast = useToast();
  const user = auth?.user;
  const [displayDraft, setDisplayDraft] = useState(getDisplayName(user));
  const [savingName, setSavingName] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const avatarUrl = getAvatarUrl(user);
  const currentName = getDisplayName(user);
  const nameDirty = (displayDraft || '').trim() !== currentName;

  useEffect(() => {
    setDisplayDraft(getDisplayName(user));
  }, [user]);

  const saveName = async () => {
    const next = (displayDraft || '').trim();
    if (!next) {
      toast.error('Ник не может быть пустым');
      return;
    }
    setSavingName(true);
    try {
      const { user: u } = await api.updateMe(auth.token, { displayName: next });
      updateUser(u);
      toast.success('Ник обновлён');
    } catch (e: any) {
      toast.error(e.message || 'Не удалось обновить ник');
    } finally {
      setSavingName(false);
    }
  };

  const resetName = async () => {
    setSavingName(true);
    try {
      const { user: u } = await api.updateMe(auth.token, { displayName: null });
      updateUser(u);
      setDisplayDraft(u.displayName || u.username);
      toast.info('Ник сброшен к логину');
    } catch (e: any) {
      toast.error(e.message || 'Не удалось сбросить ник');
    } finally {
      setSavingName(false);
    }
  };

  const onPickAvatar = () => fileRef.current?.click();

  const onAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      toast.error('Файл больше 3 МБ');
      return;
    }
    if (!/^image\//.test(file.type)) {
      toast.error('Нужна картинка');
      return;
    }
    setUploadingAvatar(true);
    try {
      const { user: u } = await api.uploadAvatar(auth.token, file);
      updateUser(u);
      toast.success('Аватарка обновлена');
    } catch (err: any) {
      toast.error(err.message || 'Не удалось загрузить');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const removeAvatar = async () => {
    if (!avatarUrl) return;
    setUploadingAvatar(true);
    try {
      const { user: u } = await api.deleteAvatar(auth.token);
      updateUser(u);
      toast.info('Аватарка удалена');
    } catch (err: any) {
      toast.error(err.message || 'Не удалось удалить');
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-4">
        <Avatar name={currentName} src={avatarUrl} size={80} />
        <div className="flex flex-col gap-1.5">
          <button
            className="btn-primary text-sm h-8 px-3"
            onClick={onPickAvatar}
            disabled={uploadingAvatar}
            type="button"
          >
            <Upload size={14} className="mr-1" />
            {uploadingAvatar ? 'Загрузка…' : 'Загрузить фото'}
          </button>
          {avatarUrl && (
            <button
              className="text-xs text-slate-400 hover:text-red-400 flex items-center gap-1"
              onClick={removeAvatar}
              disabled={uploadingAvatar}
              type="button"
            >
              <Trash2 size={12} /> Удалить
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onAvatarChange}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-slate-400 uppercase tracking-wider">
          Отображаемое имя (ник)
        </label>
        <div className="flex gap-2">
          <input
            className="input"
            value={displayDraft}
            onChange={(e) => setDisplayDraft(e.target.value)}
            maxLength={32}
            placeholder={user?.username}
          />
          <button
            onClick={saveName}
            disabled={!nameDirty || savingName}
            className="btn-primary h-10 px-4 shrink-0"
            type="button"
          >
            {savingName ? '…' : 'Сохранить'}
          </button>
        </div>
        <div className="text-[11px] text-slate-500 flex items-center justify-between">
          <span>
            Логин: <span className="text-slate-300">@{user?.username}</span>
          </span>
          {currentName !== user?.username && (
            <button onClick={resetName} className="hover:text-slate-200" type="button">
              сбросить к логину
            </button>
          )}
        </div>
      </div>

      {/* Опасная зона: удаление аккаунта. */}
      <div className="h-px bg-border" />
      <div className="space-y-2">
        <div className="text-xs text-red-400 uppercase tracking-wider flex items-center gap-1.5">
          <AlertTriangle size={12} /> Опасная зона
        </div>
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2">
          <div className="text-sm font-medium">Удалить аккаунт</div>
          <p className="text-xs text-slate-400">
            Логин будет заблокирован, аватар и ник стёрты. Сообщения, которые ты отправлял,
            останутся в истории у собеседников, но твоё имя в них будет заменено на «Удалённый
            пользователь». Это действие необратимо.
          </p>
          <button
            type="button"
            className="h-9 px-3 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 text-sm inline-flex items-center gap-2"
            onClick={() => setDeleteOpen(true)}
          >
            <UserX size={14} /> Удалить аккаунт…
          </button>
        </div>
      </div>

      <DeleteAccountModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        token={auth?.token}
        onDeleted={() => {
          toast.info('Аккаунт удалён');
          setDeleteOpen(false);
          logout();
        }}
      />
    </section>
  );
}

function DeleteAccountModal({
  open,
  onClose,
  token,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  token: string | undefined;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const reduce = useReducedMotion();
  const overlayV = reduce ? reducedVariants(overlayVariants) : overlayVariants;
  const panelV = reduce ? reducedVariants(modalVariants) : modalVariants;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setPassword('');
      setConfirm('');
      setBusy(false);
    }
  }, [open]);

  const canSubmit = password.length > 0 && confirm.trim().toUpperCase() === 'УДАЛИТЬ' && !busy;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      await api.deleteMe(token, password);
      onDeleted?.();
    } catch (err: any) {
      toast.error(err?.message || 'Не удалось удалить аккаунт');
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="delete-account"
          className="fixed inset-0 z-[60] grid place-items-center bg-black/60 backdrop-blur-sm p-4"
          onClick={onClose}
          variants={overlayV}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <motion.form
            className="card w-full max-w-md p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
            onSubmit={onSubmit}
            variants={panelV}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 grid place-items-center text-red-400 shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div>
                <div className="text-base font-semibold">Удалить аккаунт навсегда?</div>
                <div className="text-xs text-slate-400 mt-0.5">Восстановить будет невозможно.</div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">Текущий пароль</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">
                Чтобы подтвердить, напиши <span className="text-red-300 font-mono">УДАЛИТЬ</span>
              </label>
              <input
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="УДАЛИТЬ"
                autoComplete="off"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                className="btn-ghost h-9 px-3"
                onClick={onClose}
                disabled={busy}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="h-9 px-4 rounded-lg bg-red-500/80 hover:bg-red-500 text-white text-sm inline-flex items-center gap-2 disabled:opacity-50"
                disabled={!canSubmit}
              >
                <UserX size={14} />
                {busy ? 'Удаление…' : 'Удалить навсегда'}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
