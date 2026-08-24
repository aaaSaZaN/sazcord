import type {
  AdminStats,
  ApiOk,
  AuthSession,
  FriendEntry,
  Group,
  IceServerConfig,
  Message,
  User,
} from './types';

const BASE = '';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// AuthContext регистрирует здесь обработчик 401, чтобы при истечении/отзыве
// JWT клиент сам выкинул пользователя на экран логина и не зацикливался на
// «HTTP 401» в тостах. Регистрируется один раз — повторные вызовы заменяют.
let onAuthExpired: ((body: unknown) => void) | null = null;
export function setAuthExpiredHandler(fn: ((body: unknown) => void) | null) {
  onAuthExpired = typeof fn === 'function' ? fn : null;
}

function isErrorBody(body: unknown): body is { error?: string } {
  return !!body && typeof body === 'object' && 'error' in body;
}

function handle401(path: string, status: number, body: unknown) {
  if (status !== 401) return;
  // /auth/login и /auth/register отдают 401 как нормальный сценарий
  // «неверные креды», а не как «токен истёк». Их игнорируем.
  if (path.startsWith('/api/auth/')) return;
  if (onAuthExpired) {
    try {
      onAuthExpired(body);
    } catch {
      /* */
    }
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
};

// Таймаут на каждый HTTP-запрос. Без него «чёрная дыра» в сети (например,
// кривой hairpin NAT, когда домен сервера резолвится в публичный IP,
// недостижимый из локалки) подвешивает fetch на минуты: /api/me никогда
// не отвечает — AuthContext навсегда ready=false — юзер смотрит на синий
// экран «Загрузка…» без единого сообщения об ошибке.
const REQUEST_TIMEOUT_MS = 15_000;

async function request<T>(
  path: string,
  { method = 'GET', body, token }: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    if (ctrl.signal.aborted) {
      throw new ApiError('Сервер не отвечает (таймаут)', 0);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    handle401(path, res.status, data);
    throw new ApiError((isErrorBody(data) && data.error) || `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

export type UploadProgressCallback = (percent: number, loaded: number, total: number) => void;

function requestMultipart<T>(
  path: string,
  {
    token,
    formData,
    method = 'POST',
    onProgress,
    signal,
  }: {
    token?: string | null;
    formData: FormData;
    method?: string;
    onProgress?: UploadProgressCallback;
    signal?: AbortSignal;
  },
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${BASE}${path}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) {
          const pct = Math.round((e.loaded / e.total) * 100);
          onProgress(pct, e.loaded, e.total);
        }
      };
    }

    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Upload aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', () => {
        xhr.abort();
        reject(new DOMException('Upload aborted', 'AbortError'));
      });
    }

    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* no body */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T);
      } else {
        handle401(path, xhr.status, data);
        reject(new ApiError((isErrorBody(data) && data.error) || `HTTP ${xhr.status}`, xhr.status));
      }
    };

    xhr.onerror = () => {
      reject(new ApiError('Network error during upload', 0));
    };

    xhr.onabort = () => {
      reject(new DOMException('Upload aborted', 'AbortError'));
    };

    xhr.send(formData);
  });
}

// Расширение по фактическому контейнеру blob'а: Safari пишет audio/mp4,
// Firefox — audio/ogg, Chrome — audio/webm. Сервер всё равно переименует
// файл по magic-байтам, но честное имя упрощает отладку логов.
function voiceFileName(blob: Blob) {
  const type = (blob.type || '').split(';')[0];
  const ext = type === 'audio/mp4' ? 'm4a' : type === 'audio/ogg' ? 'ogg' : 'webm';
  return `voice-${Date.now()}.${ext}`;
}

export const api = {
  register: (
    username: string,
    password: string,
    invite?: string,
    opts: { displayName?: string; bio?: string } = {},
  ) =>
    request<AuthSession>('/api/auth/register', {
      method: 'POST',
      body: {
        username,
        password,
        invite: invite || undefined,
        displayName: opts.displayName || undefined,
        bio: opts.bio || undefined,
      },
    }),
  login: (username: string, password: string) =>
    request<AuthSession>('/api/auth/login', { method: 'POST', body: { username, password } }),
  registrationInfo: () =>
    request<{
      disabled: boolean;
      inviteRequired: boolean;
      bootstrap: boolean;
    }>('/api/auth/registration-info'),
  me: (token: string) => request<{ user: User }>('/api/me', { token }),
  updateMe: (token: string, patch: Partial<User>) =>
    request<{ user: User }>('/api/me', { method: 'PATCH', body: patch, token }),
  uploadAvatar: (token: string, file: File, onProgress?: UploadProgressCallback, signal?: AbortSignal) => {
    const fd = new FormData();
    fd.append('avatar', file);
    return requestMultipart<{ user: User }>('/api/me/avatar', { token, formData: fd, onProgress, signal });
  },
  deleteAvatar: (token: string) =>
    request<{ user: User }>('/api/me/avatar', { method: 'DELETE', token }),
  users: (token: string) => request<{ users: User[] }>('/api/users', { token }),
  user: (token: string, id: number) => request<{ user: User }>(`/api/users/${id}`, { token }),
  history: (token: string, peerId: number) =>
    request<{ messages: Message[] }>(`/api/messages/${peerId}`, { token }),
  sendVoice: (
    token: string,
    to: number,
    blob: Blob,
    durationMs: number,
    replyToId?: number | null,
    onProgress?: UploadProgressCallback,
    signal?: AbortSignal,
  ) => {
    const fd = new FormData();
    fd.append('to', String(to));
    fd.append('durationMs', String(durationMs || 0));
    fd.append('voice', blob, voiceFileName(blob));
    if (replyToId != null) fd.append('replyToId', String(replyToId));
    return requestMultipart<{ ok: true; message: Message }>('/api/messages/voice', {
      token,
      formData: fd,
      onProgress,
      signal,
    });
  },
  editMessage: (token: string, id: number, content: string) =>
    request<{ ok: true; message: Message }>(`/api/messages/${id}`, {
      method: 'PATCH',
      body: { content },
      token,
    }),
  deleteMessage: (token: string, id: number) =>
    request<{ ok: true; message?: Message; removed?: boolean }>(`/api/messages/${id}`, {
      method: 'DELETE',
      token,
    }),
  // Переслать сообщение в DM (target.kind='user') или в группу (target.kind='group').
  // Сервер копирует content/attachment в новый чат и проставляет forwarded_from_*.
  forwardMessage: (
    token: string,
    id: number,
    target: { kind: 'user'; id: number } | { kind: 'group'; id: number },
  ) =>
    request<{ ok: true; message: Message }>(`/api/messages/${id}/forward`, {
      method: 'POST',
      body: target.kind === 'user' ? { to: target.id } : { groupId: target.id },
      token,
    }),
  sendFile: (
    token: string,
    to: number,
    files: File | File[],
    content = '',
    replyToId?: number | null,
    onProgress?: UploadProgressCallback,
    signal?: AbortSignal,
  ) => {
    const fd = new FormData();
    fd.append('to', String(to));
    if (content) fd.append('content', content);
    if (replyToId != null) fd.append('replyToId', String(replyToId));
    if (Array.isArray(files)) {
      for (const file of files) {
        fd.append('files', file, file.name);
      }
    } else {
      fd.append('files', files, files.name);
    }
    return requestMultipart<{ ok: true; message: Message }>('/api/messages/file', {
      token,
      formData: fd,
      onProgress,
      signal,
    });
  },
  listMutes: (token: string) => request<{ ids: number[] }>('/api/mutes', { token }),
  addMute: (token: string, targetId: number) =>
    request<{ ids: number[] }>(`/api/mutes/${targetId}`, { method: 'POST', token }),
  removeMute: (token: string, targetId: number) =>
    request<{ ids: number[] }>(`/api/mutes/${targetId}`, { method: 'DELETE', token }),
  iceServers: () => request<IceServerConfig>('/api/ice'),
  config: () =>
    request<{
      maxUploadBytes: number;
      // 'local' — все видят всех; 'private' — только друзья и соучастники
      // групп. По этому полю клиент решает, показывать ли раздел «Друзья».
      socialMode?: 'local' | 'private';
      // INVITE_WHO_CAN_CREATE=members — раздел «Приглашения» виден не только
      // админу. Право всё равно проверяется на каждом запросе к /api/invites.
      invitesByMembers?: boolean;
      registrationDisabled?: boolean;
      privacyRequired?: boolean;
    }>('/api/config'),

  // --- Группы -------------------------------------------------------------
  listGroups: (token: string) => request<{ groups: Group[] }>('/api/groups', { token }),
  createGroup: (token: string, name: string, memberIds: number[]) =>
    request<{ group: Group }>('/api/groups', { method: 'POST', body: { name, memberIds }, token }),
  getGroup: (token: string, id: number) =>
    request<{ group: Group }>(`/api/groups/${id}`, { token }),
  updateGroup: (token: string, id: number, patch: Partial<Group>) =>
    request<{ group: Group }>(`/api/groups/${id}`, { method: 'PATCH', body: patch, token }),
  deleteGroup: (token: string, id: number) =>
    request<ApiOk & { deleted?: true; left?: true }>(`/api/groups/${id}`, {
      method: 'DELETE',
      token,
    }),
  addGroupMembers: (token: string, id: number, memberIds: number[]) =>
    request<{ group: Group }>(`/api/groups/${id}/members`, {
      method: 'POST',
      body: { memberIds },
      token,
    }),
  removeGroupMember: (token: string, id: number, userId: number) =>
    request<ApiOk & { group?: Group }>(`/api/groups/${id}/members/${userId}`, {
      method: 'DELETE',
      token,
    }),
  updateGroupMemberRole: (
    token: string,
    id: number,
    userId: number,
    role: 'owner' | 'admin' | 'member',
  ) =>
    request<{ ok: true; group: Group }>(`/api/groups/${id}/members/${userId}/role`, {
      method: 'PATCH',
      body: { role },
      token,
    }),
  uploadGroupAvatar: (
    token: string,
    id: number,
    file: File,
    onProgress?: UploadProgressCallback,
    signal?: AbortSignal,
  ) => {
    const fd = new FormData();
    fd.append('avatar', file);
    return requestMultipart<{ group: Group }>(`/api/groups/${id}/avatar`, {
      token,
      formData: fd,
      onProgress,
      signal,
    });
  },
  deleteGroupAvatar: (token: string, id: number) =>
    request<{ group: Group }>(`/api/groups/${id}/avatar`, { method: 'DELETE', token }),
  groupHistory: (token: string, id: number) =>
    request<{ messages: Message[] }>(`/api/groups/${id}/messages`, { token }),

  // Удалить собственный аккаунт (требует пароль).
  deleteMe: (token: string, password: string) =>
    request<ApiOk>('/api/me', { method: 'DELETE', body: { password }, token }),

  // Сменить собственный пароль (требует текущий + новый).
  changePassword: (token: string, currentPassword: string, newPassword: string) =>
    request<ApiOk>('/api/me/password', {
      method: 'POST',
      body: { currentPassword, newPassword },
      token,
    }),

  // Выгрузка данных пользователя в JSON.
  dataExport: async (token: string): Promise<Blob> => {
    const res = await fetch(`${BASE}/api/me/data-export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        msg = (isErrorBody(body) && body.error) || msg;
      } catch {
        /* */
      }
      throw new ApiError(msg, res.status);
    }
    return res.blob();
  },

  // --- Web Push -----------------------------------------------------------
  pushConfig: () => request<{ enabled: boolean; publicKey?: string }>('/api/push/config'),
  pushSubscribe: (token: string, subscription: PushSubscriptionJSON) =>
    request<ApiOk>('/api/push/subscribe', { method: 'POST', body: { subscription }, token }),
  pushUnsubscribe: (token: string, endpoint: string) =>
    request<ApiOk>('/api/push/unsubscribe', { method: 'POST', body: { endpoint }, token }),

  // --- Панель сервера (admin only) ----------------------------------------
  adminStats: (token: string) => request<AdminStats>('/api/admin/stats', { token }),

  // --- Друзья (только при socialMode === 'private') ------------------------
  listFriends: (token: string) =>
    request<{ friends: FriendEntry[]; incoming: FriendEntry[]; outgoing: FriendEntry[] }>(
      '/api/friends',
      { token },
    ),
  addFriend: (token: string, username: string) =>
    request<{ ok: true; status: string }>('/api/friends', {
      method: 'POST',
      body: { username },
      token,
    }),
  acceptFriend: (token: string, userId: number) =>
    request<ApiOk>(`/api/friends/${userId}/accept`, { method: 'POST', token }),
  removeFriend: (token: string, userId: number) =>
    request<ApiOk>(`/api/friends/${userId}`, { method: 'DELETE', token }),

  // --- Инвайт-коды (admin only) -------------------------------------------
  listInvites: (token: string) =>
    request<{
      codes: Array<{
        code: string;
        note?: string;
        maxUses?: number | null;
        usesCount: number;
        remaining?: number | null;
        expiresAt?: number | null;
        createdAt?: number;
        createdBy?: number;
        createdByUsername?: string;
        revokedAt?: number | null;
      }>;
    }>('/api/invites', { token }),
  createInvite: (token: string, body: Record<string, unknown>) =>
    request<{ code: { code: string } }>('/api/invites', {
      method: 'POST',
      body: body || {},
      token,
    }),
  // Публично: страницу /invite/<code> открывает человек без аккаунта.
  // Открытие ссылки использование НЕ списывает.
  inviteInfo: (code: string) =>
    request<{ valid: boolean; invitedBy?: string | null }>(
      `/api/invites/${encodeURIComponent(code)}/info`,
    ),
  revokeInvite: (token: string, code: string) =>
    request<ApiOk>(`/api/invites/${encodeURIComponent(code)}`, { method: 'DELETE', token }),
  sendGroupVoice: (
    token: string,
    id: number,
    blob: Blob,
    durationMs: number,
    replyToId?: number | null,
    onProgress?: UploadProgressCallback,
    signal?: AbortSignal,
  ) => {
    const fd = new FormData();
    fd.append('durationMs', String(durationMs || 0));
    fd.append('voice', blob, voiceFileName(blob));
    if (replyToId != null) fd.append('replyToId', String(replyToId));
    return requestMultipart<{ ok: true; message: Message }>(`/api/groups/${id}/messages/voice`, {
      token,
      formData: fd,
      onProgress,
      signal,
    });
  },
  sendGroupFile: (
    token: string,
    id: number,
    files: File | File[],
    content = '',
    replyToId?: number | null,
    onProgress?: UploadProgressCallback,
    signal?: AbortSignal,
  ) => {
    const fd = new FormData();
    if (content) fd.append('content', content);
    if (replyToId != null) fd.append('replyToId', String(replyToId));
    if (Array.isArray(files)) {
      for (const file of files) {
        fd.append('files', file, file.name);
      }
    } else {
      fd.append('files', files, files.name);
    }
    return requestMultipart<{ ok: true; message: Message }>(`/api/groups/${id}/messages/file`, {
      token,
      formData: fd,
      onProgress,
      signal,
    });
  },
  // Реакции на сообщения
  addReaction: (token: string, messageId: number, emoji: string, groupId?: number) => {
    const url = groupId
      ? `/api/groups/${groupId}/messages/${messageId}/reaction`
      : `/api/messages/${messageId}/reaction`;
    return request<{
      ok: true;
      reactions: Array<{ emoji: string; count: number; users: number[] }>;
    }>(url, {
      token,
      method: 'POST',
      body: { emoji },
    });
  },
  getReactions: (token: string, messageId: number, groupId?: number) => {
    const url = groupId
      ? `/api/groups/${groupId}/messages/${messageId}/reactions`
      : `/api/messages/${messageId}/reactions`;
    return request<{ reactions: Array<{ emoji: string; count: number; users: number[] }> }>(url, {
      token,
    });
  },
};
