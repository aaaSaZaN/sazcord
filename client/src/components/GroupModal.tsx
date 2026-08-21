import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  X,
  Check,
  Trash2,
  Upload,
  UserPlus,
  UserMinus,
  Users as UsersIcon,
  MoreVertical,
  Shield,
  ShieldAlert,
} from 'lucide-react';
import Avatar from './Avatar';
import ContextMenu from './ContextMenu';
import InviteMembersModal from './InviteMembersModal';
import { getAvatarUrl, getDisplayName } from '../utils/user';
import { useGroups } from '../context/GroupsContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { modalVariants, overlayVariants, reducedVariants } from '../utils/motion';

const NAME_MAX = 64;
const MEMBER_LIMIT = 10;

/**
 * Модалка создания/редактирования группы.
 *  mode === 'create' — пустая форма; по успеху вызывает onCreated(group).
 *  mode === 'edit'   — редактирование существующей group. Только owner
 *                      может менять имя/аватар/участников.
 */
export default function GroupModal({
  mode = 'create',
  group = null,
  users = [], // весь список для выбора участников
  onClose,
  onCreated,
}) {
  const { auth } = useAuth();
  const toast = useToast();
  const g = useGroups();

  const isEdit = mode === 'edit' && group;
  const isOwner = isEdit && group.ownerId === auth.user.id;
  const isAdmin = isEdit && group.members.find((m) => m.id === auth.user.id)?.role === 'admin';
  const canEditGroup = isOwner || isAdmin;

  const [name, setName] = useState(isEdit ? group.name : '');
  const [selectedIds, setSelectedIds] = useState(() => {
    if (isEdit) return new Set(group.members.map((m) => m.id).filter((id) => id !== auth.user.id));
    return new Set();
  });
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [memberMenu, setMemberMenu] = useState(null); // { userId, x, y }
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const fileRef = useRef(null);

  // Реагируем на обновления группы извне (сокет-события).
  useEffect(() => {
    if (!isEdit || !group) return;
    setName(group.name);
  }, [group?.name, isEdit]);

  const candidates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = users.filter((u) => u.id !== auth.user.id);
    if (!needle) return list;
    return list.filter(
      (u) =>
        u.username.toLowerCase().includes(needle) ||
        (u.displayName || '').toLowerCase().includes(needle),
    );
  }, [users, search, auth.user.id]);

  const toggleMember = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size + 1 < MEMBER_LIMIT)
        next.add(id); // +1 т.к. owner
      else toast.info(`Максимум ${MEMBER_LIMIT} участников`);
      return next;
    });
  };

  const onPickAvatar = () => fileRef.current?.click();

  const onAvatarFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Выберите изображение');
      return;
    }
    if (isEdit && !canEditGroup) return;

    if (isEdit) {
      setBusy(true);
      try {
        await g.uploadAvatar(group.id, file);
        toast.info('Аватар обновлён');
      } catch (err) {
        toast.error(err?.message || 'Не удалось загрузить');
      } finally {
        setBusy(false);
      }
    } else {
      // Режим создания - сохраняем файл для предпросмотра и загрузки после создания
      setAvatarFile(file);
      const reader = new FileReader();
      reader.onload = () => setAvatarPreview(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const onRemoveAvatar = async () => {
    if (!isEdit || !canEditGroup || !group.avatarPath) return;
    setBusy(true);
    try {
      await g.deleteAvatar(group.id);
    } catch (err) {
      toast.error(err?.message || 'Не удалось удалить аватар');
    } finally {
      setBusy(false);
    }
  };

  const onRemoveNewAvatar = () => {
    setAvatarFile(null);
    setAvatarPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return toast.error('Введите название группы');
    if (trimmed.length > NAME_MAX) return toast.error(`Максимум ${NAME_MAX} символов`);

    setBusy(true);
    try {
      if (mode === 'create') {
        const ids = [...selectedIds];
        if (ids.length === 0) {
          toast.error('Добавьте хотя бы одного участника');
          setBusy(false);
          return;
        }
        const created = await g.createGroup(trimmed, ids);
        toast.info('Группа создана');

        // Загружаем аватарку если была выбрана
        if (avatarFile) {
          try {
            await g.uploadAvatar(created.id, avatarFile);
            toast.info('Аватар загружен');
          } catch (err) {
            toast.error(err?.message || 'Не удалось загрузить аватар');
          }
        }

        onCreated?.(created);
        onClose?.();
      } else if (isEdit && canEditGroup) {
        // В режиме редактирования меняем только имя и аватар
        // Управление участниками через отдельное модальное окно
        if (trimmed !== group.name) await g.updateGroup(group.id, { name: trimmed });
        toast.info('Группа обновлена');
        onClose?.();
      } else {
        onClose?.();
      }
    } catch (err) {
      toast.error(err?.message || 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!isEdit) return;
    if (!confirm('Выйти из группы?')) return;
    setBusy(true);
    try {
      await g.removeMember(group.id, auth.user.id);
      onClose?.();
    } catch (err) {
      toast.error(err?.message || 'Не удалось выйти');
    } finally {
      setBusy(false);
    }
  };

  const destroy = async () => {
    if (!isEdit || !isOwner) return;
    if (!confirm('Удалить группу для всех участников? Это действие необратимо.')) return;
    setBusy(true);
    try {
      await g.deleteGroup(group.id);
      onClose?.();
    } catch (err) {
      toast.error(err?.message || 'Не удалось удалить группу');
    } finally {
      setBusy(false);
    }
  };

  const onMemberContext = (e, member) => {
    e.preventDefault();
    // Проверяем права: owner и admin могут кикать, но только owner может управлять ролями
    const myRole = group.members.find((m) => m.id === auth.user.id)?.role;
    if (myRole !== 'owner' && myRole !== 'admin') return;
    // Нельзя управлять собой
    if (member.id === auth.user.id) return;
    // Админ не может кикнуть owner или другого админа
    if (myRole === 'admin' && (member.role === 'owner' || member.role === 'admin')) return;
    setMemberMenu({ userId: member.id, userRole: member.role, myRole, x: e.clientX, y: e.clientY });
  };

  const onPromoteMember = async (userId) => {
    setBusy(true);
    try {
      await g.updateGroupMemberRole(group.id, userId, 'admin');
      toast.info('Пользователь повышен до админа');
    } catch (err) {
      toast.error(err?.message || 'Не удалось изменить роль');
    } finally {
      setBusy(false);
    }
    setMemberMenu(null);
  };

  const onDemoteMember = async (userId) => {
    setBusy(true);
    try {
      await g.updateGroupMemberRole(group.id, userId, 'member');
      toast.info('Пользователь понижен до участника');
    } catch (err) {
      toast.error(err?.message || 'Не удалось изменить роль');
    } finally {
      setBusy(false);
    }
    setMemberMenu(null);
  };

  const onKickMember = async (userId) => {
    if (!confirm('Кикнуть пользователя из группы?')) return;
    setBusy(true);
    try {
      await g.removeMember(group.id, userId);
      toast.info('Пользователь кикнут');
    } catch (err) {
      toast.error(err?.message || 'Не удалось кикнуть пользователя');
    } finally {
      setBusy(false);
    }
    setMemberMenu(null);
  };

  const onInviteMembers = async (memberIds) => {
    await g.addMembers(group.id, memberIds);
  };

  const title =
    mode === 'create' ? 'Новая группа' : canEditGroup ? 'Редактировать группу' : 'Группа';

  const reduce = useReducedMotion();
  const overlayV = reduce ? reducedVariants(overlayVariants) : overlayVariants;
  const panelV = reduce ? reducedVariants(modalVariants) : modalVariants;

  return (
    <motion.div
      key="group-modal"
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm grid place-items-center p-4"
      variants={overlayV}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div
        className="w-full max-w-lg bg-bg-1 border border-border rounded-2xl shadow-soft overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        variants={panelV}
      >
        <header className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="btn-ghost" onClick={onClose} title="Закрыть">
            <X size={18} />
          </button>
        </header>

        <div className="p-4 space-y-4">
          {/* Аватар + имя */}
          <div className="flex items-center gap-3">
            <div className="relative">
              {isEdit ? (
                group?.avatarPath ? (
                  <Avatar name={name || 'Группа'} src={group.avatarPath} size={64} />
                ) : (
                  <div
                    className="avatar grid place-items-center bg-bg-3 text-slate-200"
                    style={{ width: 64, height: 64 }}
                  >
                    <UsersIcon size={28} />
                  </div>
                )
              ) : avatarPreview ? (
                <div
                  className="avatar grid place-items-center overflow-hidden"
                  style={{ width: 64, height: 64 }}
                >
                  <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div
                  className="avatar grid place-items-center bg-bg-3 text-slate-200"
                  style={{ width: 64, height: 64 }}
                >
                  <UsersIcon size={28} />
                </div>
              )}
              {(isEdit ? canEditGroup : true) ? (
                <button
                  onClick={onPickAvatar}
                  disabled={busy}
                  className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-accent text-white grid place-items-center border-2 border-bg-1 hover:bg-accent-hover"
                  title="Загрузить аватар"
                  type="button"
                >
                  <Upload size={14} />
                </button>
              ) : null}
              {!isEdit && avatarPreview && (
                <button
                  onClick={onRemoveNewAvatar}
                  disabled={busy}
                  className="absolute -bottom-1 -right-9 w-7 h-7 rounded-full bg-red-500 text-white grid place-items-center border-2 border-bg-1 hover:bg-red-600"
                  title="Удалить аватар"
                  type="button"
                >
                  <Trash2 size={12} />
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onAvatarFile}
              />
            </div>
            <div className="flex-1 min-w-0 space-y-1.5">
              <input
                className="input"
                placeholder="Название группы"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
                disabled={isEdit && !canEditGroup}
              />
              <div className="text-xs text-slate-500">
                {name.length}/{NAME_MAX}
              </div>
            </div>
            {isEdit && canEditGroup && group.avatarPath && (
              <button
                onClick={onRemoveAvatar}
                disabled={busy}
                className="btn-ghost"
                title="Удалить аватар"
                type="button"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>

          {/* Участники */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
                Участники{' '}
                {isEdit
                  ? `(${group.members.length}/${MEMBER_LIMIT})`
                  : `(${selectedIds.size + 1}/${MEMBER_LIMIT})`}
              </div>
              {isEdit &&
                (isOwner || group.members.find((m) => m.id === auth.user.id)?.role === 'admin') && (
                  <button
                    onClick={() => setShowInviteModal(true)}
                    disabled={busy || group.members.length >= MEMBER_LIMIT}
                    className="text-xs text-accent hover:text-accent-hover flex items-center gap-1"
                    type="button"
                  >
                    <UserPlus size={12} /> Пригласить
                  </button>
                )}
            </div>
            {isEdit ? (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {group.members.map((m) => {
                  const myRole = group.members.find((mem) => mem.id === auth.user.id)?.role;
                  const canManage = myRole === 'owner' || myRole === 'admin';
                  const canManageRoles = myRole === 'owner';
                  const isMe = m.id === auth.user.id;
                  const isOwner = m.role === 'owner';
                  return (
                    <div
                      key={m.id}
                      className="flex items-center gap-2 p-2 rounded bg-bg-2"
                      onContextMenu={(e) => onMemberContext(e, m)}
                    >
                      <Avatar name={getDisplayName(m)} src={m.avatarPath || null} size={28} />
                      <div className="flex-1 min-w-0 text-sm">
                        {getDisplayName(m)}
                        {isOwner && (
                          <span className="ml-1.5 text-[10px] uppercase text-accent font-semibold">
                            owner
                          </span>
                        )}
                        {m.role === 'admin' && (
                          <span className="ml-1.5 text-[10px] uppercase text-yellow-400 font-semibold">
                            admin
                          </span>
                        )}
                      </div>
                      {canManage &&
                        !isMe &&
                        !(myRole === 'admin' && (isOwner || m.role === 'admin')) && (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              onMemberContext(e, m);
                            }}
                            className="p-1 hover:bg-bg-3 rounded text-slate-400 hover:text-slate-200"
                            type="button"
                          >
                            <MoreVertical size={14} />
                          </button>
                        )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                <input
                  className="input mb-2"
                  placeholder="Поиск…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="space-y-1 max-h-56 overflow-y-auto">
                  {candidates.map((u) => {
                    const sel = selectedIds.has(u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggleMember(u.id)}
                        className={`w-full flex items-center gap-2 p-2 rounded-lg text-left ${
                          sel ? 'bg-accent/20 border border-accent/40' : 'hover:bg-bg-2'
                        }`}
                      >
                        <Avatar
                          name={getDisplayName(u)}
                          src={getAvatarUrl(u)}
                          size={28}
                          online={u.online}
                          showStatus
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-slate-100 truncate">{getDisplayName(u)}</div>
                          <div className="text-xs text-slate-500 truncate">@{u.username}</div>
                        </div>
                        {sel ? (
                          <UserMinus size={14} className="text-accent" />
                        ) : (
                          <UserPlus size={14} className="text-slate-500" />
                        )}
                      </button>
                    );
                  })}
                  {candidates.length === 0 && (
                    <div className="text-center text-slate-500 text-sm py-4">Никого не найдено</div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-2 p-4 border-t border-border bg-bg-0/40">
          {isEdit ? (
            <div className="flex items-center gap-2">
              {isOwner ? (
                <button
                  onClick={destroy}
                  disabled={busy}
                  className="btn-ghost text-red-400"
                  type="button"
                >
                  <Trash2 size={14} /> Удалить
                </button>
              ) : (
                <button
                  onClick={leave}
                  disabled={busy}
                  className="btn-ghost text-red-400"
                  type="button"
                >
                  <UserMinus size={14} /> Выйти
                </button>
              )}
            </div>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={busy} className="btn-ghost" type="button">
              Отмена
            </button>
            {(mode === 'create' || canEditGroup) && (
              <button
                onClick={submit}
                disabled={busy || !name.trim()}
                className="btn-primary"
                type="button"
              >
                <Check size={14} />
                {mode === 'create' ? 'Создать' : 'Сохранить'}
              </button>
            )}
          </div>
        </footer>

        {showInviteModal && (
          <InviteMembersModal
            group={group}
            users={users}
            onClose={() => setShowInviteModal(false)}
            onInvite={onInviteMembers}
          />
        )}

        {memberMenu && (
          <ContextMenu
            anchor={{ x: memberMenu.x, y: memberMenu.y }}
            onClose={() => setMemberMenu(null)}
            items={[
              ...(memberMenu.myRole === 'owner' && memberMenu.userRole === 'member'
                ? [
                    {
                      label: 'Повысить до админа',
                      icon: <Shield size={14} />,
                      onClick: () => onPromoteMember(memberMenu.userId),
                    },
                  ]
                : []),
              ...(memberMenu.myRole === 'owner' && memberMenu.userRole === 'admin'
                ? [
                    {
                      label: 'Понизить до участника',
                      icon: <ShieldAlert size={14} />,
                      onClick: () => onDemoteMember(memberMenu.userId),
                    },
                  ]
                : []),
              {
                label: 'Кикнуть из группы',
                icon: <UserMinus size={14} />,
                danger: true,
                onClick: () => onKickMember(memberMenu.userId),
              },
            ]}
          />
        )}
      </motion.div>
    </motion.div>
  );
}
