import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '../api';
import { useAuth } from './AuthContext';
import { getSocket } from '../socket';

const GroupsContext = createContext(null);

/**
 * GroupsProvider — хранит список групп юзера, синхронизируется с сервером
 * через сокет-события group:new / group:update / group:delete.
 *
 * Публичное API контекста:
 *   groups                — массив групп (id, name, avatarPath, members[], ...)
 *   getGroup(id)          — из кэша по id
 *   createGroup(...)      — POST /api/groups
 *   updateGroup(...)      — PATCH
 *   deleteGroup(id)       — DELETE (owner → удалит для всех; member → "выйти")
 *   addMembers(id, ids)   — добавить участников
 *   removeMember(id, uid) — кикнуть / выйти (если uid === me)
 *   uploadAvatar(id, f)   — загрузить аватарку
 *   deleteAvatar(id)      — удалить аватарку
 *   refresh()             — принудительно перечитать с сервера
 */
export function GroupsProvider({ children }) {
  const { auth } = useAuth();
  const token = auth?.token;
  const [groups, setGroups] = useState([]);
  const [ready, setReady] = useState(false);

  const socketRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const { groups: list } = await api.listGroups(token);
      setGroups(list || []);
    } catch {
      /* silent */
    } finally {
      setReady(true);
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setGroups([]);
      setReady(false);
      return;
    }
    refresh();
  }, [token, refresh]);

  // Подписка на сокет-события. Ждём, пока сокет появится.
  useEffect(() => {
    if (!token) return undefined;
    let stopped = false;
    let offFns = [];

    const tryAttach = () => {
      if (stopped) return;
      const s = getSocket();
      if (!s) {
        setTimeout(tryAttach, 200);
        return;
      }
      socketRef.current = s;

      const onNew = (g) => {
        setGroups((prev) => {
          if (prev.some((x) => x.id === g.id)) {
            return prev.map((x) => (x.id === g.id ? g : x));
          }
          return [g, ...prev];
        });
      };
      const onUpdate = (g) => {
        setGroups((prev) => prev.map((x) => (x.id === g.id ? g : x)));
      };
      const onDelete = ({ id }) => {
        setGroups((prev) => prev.filter((x) => x.id !== id));
      };

      s.on('group:new', onNew);
      s.on('group:update', onUpdate);
      s.on('group:delete', onDelete);
      s.on('connect', refresh);

      offFns = [
        () => s.off('group:new', onNew),
        () => s.off('group:update', onUpdate),
        () => s.off('group:delete', onDelete),
        () => s.off('connect', refresh),
      ];
    };

    tryAttach();
    return () => {
      stopped = true;
      offFns.forEach((fn) => fn());
    };
  }, [token, refresh]);

  const getGroup = useCallback((id) => groups.find((g) => g.id === id) || null, [groups]);

  const createGroup = useCallback(
    async (name, memberIds) => {
      const { group } = await api.createGroup(token, name, memberIds);
      setGroups((prev) => (prev.some((x) => x.id === group.id) ? prev : [group, ...prev]));
      return group;
    },
    [token],
  );

  const updateGroup = useCallback(
    async (id, patch) => {
      const { group } = await api.updateGroup(token, id, patch);
      setGroups((prev) => prev.map((x) => (x.id === id ? group : x)));
      return group;
    },
    [token],
  );

  const deleteGroup = useCallback(
    async (id) => {
      await api.deleteGroup(token, id);
      setGroups((prev) => prev.filter((x) => x.id !== id));
    },
    [token],
  );

  const addMembers = useCallback(
    async (id, memberIds) => {
      const { group } = await api.addGroupMembers(token, id, memberIds);
      setGroups((prev) => prev.map((x) => (x.id === id ? group : x)));
      return group;
    },
    [token],
  );

  const myId = auth?.user?.id ?? null;
  const removeMember = useCallback(
    async (id, userId) => {
      await api.removeGroupMember(token, id, userId);
      // сервер пришлёт group:update или group:delete — локально можно ничего не делать,
      // но на всякий случай перечитаем группу, если это был кик.
      if (userId !== myId) {
        try {
          const { group } = await api.getGroup(token, id);
          setGroups((prev) => prev.map((x) => (x.id === id ? group : x)));
        } catch {
          /* ignore */
        }
      }
    },
    [myId, token],
  );

  const uploadAvatar = useCallback(
    async (id, file) => {
      const { group } = await api.uploadGroupAvatar(token, id, file);
      setGroups((prev) => prev.map((x) => (x.id === id ? group : x)));
      return group;
    },
    [token],
  );

  const deleteAvatar = useCallback(
    async (id) => {
      const { group } = await api.deleteGroupAvatar(token, id);
      setGroups((prev) => prev.map((x) => (x.id === id ? group : x)));
      return group;
    },
    [token],
  );

  const updateGroupMemberRole = useCallback(
    async (id, userId, role) => {
      const { group } = await api.updateGroupMemberRole(token, id, userId, role);
      setGroups((prev) => prev.map((x) => (x.id === id ? group : x)));
      return group;
    },
    [token],
  );

  const value = useMemo(
    () => ({
      groups,
      ready,
      getGroup,
      createGroup,
      updateGroup,
      deleteGroup,
      addMembers,
      removeMember,
      uploadAvatar,
      deleteAvatar,
      updateGroupMemberRole,
      refresh,
    }),
    [
      groups,
      ready,
      getGroup,
      createGroup,
      updateGroup,
      deleteGroup,
      addMembers,
      removeMember,
      uploadAvatar,
      deleteAvatar,
      updateGroupMemberRole,
      refresh,
    ],
  );

  return <GroupsContext.Provider value={value}>{children}</GroupsContext.Provider>;
}

export function useGroups() {
  const ctx = useContext(GroupsContext);
  if (!ctx) throw new Error('useGroups must be used within GroupsProvider');
  return ctx;
}
