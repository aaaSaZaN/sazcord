import type { Socket } from 'socket.io-client';

export type User = {
  id: number;
  username: string | null;
  displayName?: string | null;
  avatarPath?: string | null;
  createdAt?: number;
  lastActivityAt?: number | null;
  online?: boolean;
  // away — юзер онлайн, но неактивен более 5 минут (idle на хотя бы
  // одном из своих клиентов — см. серверную presence.js с awayUsers Set'ом).
  // UI показывает жёлтый кружок вместо зелёного (при online=true).
  away?: boolean;
  deleted?: boolean;
  self?: boolean;
  isAdmin?: boolean;
  hideOnDelete?: boolean;
};

export type GroupMember = User & {
  role?: 'owner' | 'admin' | 'member' | string;
  joinedAt?: number;
};

export type Group = {
  id: number;
  name: string;
  avatarPath?: string | null;
  ownerId?: number;
  createdAt?: number;
  updatedAt?: number;
  members?: GroupMember[];
};

export type CallPayload = {
  callId?: string;
  withVideo?: boolean;
  status?: 'active' | 'waiting' | 'ended' | string;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  outcome?: 'completed' | 'missed' | 'rejected' | 'cancelled' | 'expired' | string;
  reconnectUntil?: number;
};

export type GroupCallPayload = {
  type?: 'groupcall';
  status?: 'active' | 'ended' | string;
  callId?: string;
  startedBy?: number;
  startedAt?: number;
  endedAt?: number;
  withVideo?: boolean;
};

export type SystemPayload = {
  type?: 'group_created' | 'member_added' | 'member_removed' | 'member_left' | string;
  actorId?: number;
  targetIds?: number[];
};

export type MessageKind =
  'text' | 'voice' | 'image' | 'video' | 'file' | 'call' | 'system' | 'groupcall';

export type MessageReaction = {
  emoji: string;
  count: number;
  users: number[];
};

// Статус доставки/прочтения для ИСХОДЯЩИХ сообщений (рендерим галочки только
// у своих). Для входящих поле игнорируется.
//   - 'sending'    — optimistic-плейсхолдер, ack от сервера ещё не пришёл;
//   - 'delivered'  — есть запись в БД (ack ok), получатель ещё не прочитал;
//   - 'read'       — получатель открыл чат (readAt проставлен сервером);
//   - 'error'      — socket ack вернул error или отвалилась отправка.
// Для multi-target рассылки (группа) используем только 'sending' / 'error':
// галочки в группах не показываем (см. серверный комментарий в dm:read).
export type MessageStatus = 'sending' | 'delivered' | 'read' | 'error';

export type Message = {
  id: number;
  senderId: number;
  receiverId: number | null;
  groupId: number | null;
  content: string;
  createdAt: number;
  editedAt: number | null;
  deleted: boolean;
  kind: MessageKind;
  attachmentPath: string | null;
  durationMs: number | null;
  attachmentName: string | null;
  attachmentSize: number | null;
  attachmentMime: string | null;
  payload: CallPayload | GroupCallPayload | SystemPayload | null;
  reactions?: MessageReaction[];
  // Отметка о прочтении получателем (DM 1:1). NULL для групп и для ещё не
  // прочитанных сообщений.
  readAt?: number | null;
  // UUID optimistic-плейсхолдера, ставится клиентом при отправке. Сервер
  // пропускает его обратно в dm:new / ack для сопоставления. На читающей
  // стороне отсутствует.
  clientId?: string;
  // UI-состояние отправки. Вычисляется клиентом, не хранится на сервере
  // (для прочитанных сообщений = f(readAt); для своих не-прочитанных с id =
  // 'delivered'; для optimistic без id = 'sending'; для ошибок = 'error').
  status?: MessageStatus;
  // Если сообщение переслано — ссылка на оригинал. senderId может быть null,
  // если автор оригинала удалил аккаунт (FK ON DELETE SET NULL). messageId
  // и createdAt — informational; UI ими не пользуется напрямую, кроме
  // подсказки времени оригинала в title-атрибуте плашки.
  forwardedFrom?: {
    senderId: number | null;
    messageId: number | null;
    createdAt: number | null;
  } | null;
  // Превью оригинального сообщения для функции «Ответить». Сервер сам
  // резолвит превью при выдаче истории и dm:new, чтобы UI мог отрисовать
  // мини-цитату в верху бабла без дополнительных запросов. null если
  // сообщение не является ответом или оригинал был жёстко удалён (FK
  // ON DELETE SET NULL). При soft-delete оригинала придёт превью с
  // deleted=true и пустым content — UI покажет «удалённое сообщение».
  replyTo?: {
    id: number;
    senderId: number;
    content: string;
    kind: MessageKind;
    deleted: boolean;
    attachmentPath: string | null;
  } | null;
};

export type AuthSession = {
  token: string;
  user: User;
};

export type Settings = {
  inputDeviceId: string;
  outputDeviceId: string;
  inputVolume: number;
  outputVolume: number;
  soundsEnabled: boolean;
  soundMessage: boolean;
  soundIncoming: boolean;
  soundOutgoing: boolean;
  soundConnect: boolean;
  soundDisconnect: boolean;
  soundMicMute: boolean;
  soundDeafen: boolean;
  uiVolume: number;
  userVolumes?: Record<number, number>;
  streamVolumes?: Record<number, number>;
  screenQuality?: string;
  // Карта десктоп-биндингов. Применяется только в Electron-обёртке;
  // в браузере поля просто хранятся в localStorage.
  keybinds?: {
    toggleMute?: string | null;
    toggleDeafen?: string | null;
  };
};

export type ChatSelection = { kind: 'user'; id: number } | { kind: 'group'; id: number };

export type UnreadMap = Record<string, number>;
export type UserIdMap<T> = Record<number, T>;

export type ApiOk = { ok: true };
export type ApiErrorBody = { error?: string };
export type ApiAck<T = unknown> = ({ ok: true } & T) | ({ error: string } & Partial<T>);

export type IceServerConfig = { iceServers: RTCIceServer[] };

export type MediaState = {
  mic: boolean;
  camera: boolean;
  screen: boolean;
  // true когда аудио-сендер сейчас транслирует звук экрана, а не микрофон.
  // Получатель смотрит на этот флаг, чтобы deafen глушил только голоса,
  // а для входящего трека применялась громкость стрима.
  screenAudio?: boolean;
  // true когда отправитель «оглушил» себя (mute наушников). На WebRTC-
  // стороне это ничего не меняет (микрофон продолжает идти в эфир, входящий
  // трек просто не воспроизводится локально), но получателям полезно знать
  // — UI рисует значок глушителя у пира, чтобы было понятно, что собеседник
  // тебя сейчас не слышит. Discord делает то же самое.
  deafened?: boolean;
};

export type CallState = 'idle' | 'calling' | 'incoming' | 'connecting' | 'in-call' | 'waiting';
export type GroupCallState = 'idle' | 'joining' | 'in-call';

export type ClientToServerEvents = {
  'chat:typing': (payload: { to?: number; groupId?: number; typing: boolean }) => void;
  'dm:send': (
    payload: {
      to?: number;
      groupId?: number;
      content: string;
      clientId?: string;
      replyToId?: number | null;
    },
    ack?: (ack: ApiAck<{ message?: Message }>) => void,
  ) => void;
  // Отметить сообщения DM «прочитанными»: в ленте с peerId все сообщения
  // (sender=peerId, receiver=me) c id <= lastMessageId получают read_at=now.
  'dm:read': (payload: { peerId: number; lastMessageId: number }) => void;
  'call:invite': (payload: { to: number; callId: string; withVideo: boolean }) => void;
  'call:accept': (payload: { to: number; callId: string }) => void;
  'call:reject': (payload: { to: number; callId: string; reason?: string }) => void;
  'call:cancel': (payload: { to: number; callId: string }) => void;
  'call:end': (payload: { to: number; callId: string; reason?: string }) => void;
  'call:terminate': (payload: { to: number; callId: string }) => void;
  'rtc:offer': (payload: {
    to: number;
    callId: string;
    groupId?: number;
    sdp: RTCSessionDescription | null;
  }) => void;
  'rtc:answer': (payload: {
    to: number;
    callId: string;
    groupId?: number;
    sdp: RTCSessionDescription | null;
  }) => void;
  'rtc:ice': (payload: {
    to: number;
    callId: string;
    groupId?: number;
    candidate: RTCIceCandidate;
  }) => void;
  'media:state': (payload: { to: number; callId: string; state: MediaState }) => void;
  'groupcall:media:state': (payload: {
    groupId: number;
    callId: string;
    state: MediaState;
  }) => void;
  'groupcall:join': (
    payload: { groupId: number; withVideo: boolean },
    ack?: (
      ack: ApiAck<{ callId: string; peers: number[]; withVideo: boolean; startedBy: number }>,
    ) => void,
  ) => void;
  'groupcall:leave': (payload: { groupId: number }, ack?: (ack: ApiAck) => void) => void;
  // Idle/away: клиент шлёт presence:away после 5 мин неактивности и
  // presence:active при любой активности (mousemove/keydown/...). Сервер
  // агрегирует и бродкастит всем в presence с полем away.
  'presence:away': () => void;
  'presence:active': () => void;
  'groupcall:state': (
    payload: { groupId: number },
    ack?: (
      ack:
        | { active: false }
        | {
            active: true;
            callId: string;
            withVideo: boolean;
            startedAt: number;
            startedBy: number;
            participants: number[];
          }
        | ApiErrorBody,
    ) => void,
  ) => void;
};

export type ServerToClientEvents = {
  connect: () => void;
  // Начальный снапшот при коннекте: онлайн-id и подмножество тех, кто away.
  // Поле away опционально для совместимости со старым сервером (до 0.8.11).
  // Звонок обработан на ДРУГОМ устройстве этого же пользователя
  // (принят или отклонён). Остальные его клиенты должны перестать звонить.
  'call:handled': (payload: {
    callId: string;
    action: 'accepted' | 'rejected';
    by: number;
  }) => void;
  'presence:list': (payload: { online: number[]; away?: number[] }) => void;
  // Изменение presence одного юзера. away=true/false валидно только
  // при online=true; при оффлайне сервер всегда шлёт away=false.
  presence: (payload: { userId: number; online: boolean; away?: boolean }) => void;
  'dm:new': (message: Message) => void;
  'dm:update': (message: Message) => void;
  'dm:delete': (payload: {
    id: number;
    senderId: number;
    receiverId: number | null;
    groupId: number | null;
  }) => void;
  'dm:remove': (payload: {
    id: number;
    senderId: number;
    receiverId: number | null;
    groupId: number | null;
  }) => void;
  'dm:reaction': (payload: { messageId: number; reactions: MessageReaction[] }) => void;
  // Пир прочитал наши сообщения в DM до lastMessageId включительно (см. dm:read).
  // peerId здесь = id пира (кто прочитал), readAt — timestamp сервера.
  'dm:read': (payload: { peerId: number; lastMessageId: number; readAt: number }) => void;
  // Эхо нашего собственного dm:read с другого устройства этого же юзера.
  // peerId здесь = id собеседника (кого мы прочитали). Используется для
  // синхронизации счётчика непрочитанных между сессиями.
  'dm:read:self': (payload: { peerId: number; lastMessageId: number; readAt: number }) => void;
  'chat:typing': (payload: { from: number; groupId?: number; typing: boolean }) => void;
  'profile:self': (user: User) => void;
  'mutes:update': (payload: { ids: number[] }) => void;
  'account:deleted': () => void;
  'group:new': (group: Group) => void;
  'group:update': (group: Group) => void;
  'group:delete': (payload: { id: number }) => void;
  'call:invite': (payload: {
    callId: string;
    withVideo: boolean;
    from: number;
    fromUsername: string;
    fromDisplayName?: string;
    fromAvatarPath?: string | null;
  }) => void;
  'call:invite:sent': (payload: { callId: string; calleeMuted: boolean }) => void;
  'call:accept': (payload: { from: number; callId: string }) => void;
  'call:reject': (payload: { from: number; callId: string; reason?: string }) => void;
  'call:cancel': (payload: { from: number; callId: string }) => void;
  'call:end': (payload: { from: number; callId: string; reason?: string }) => void;
  'call:terminate': (payload: { from: number; callId: string }) => void;
  'rtc:offer': (payload: {
    from: number;
    callId: string;
    groupId?: number;
    sdp: RTCSessionDescriptionInit;
  }) => void;
  'rtc:answer': (payload: {
    from: number;
    callId: string;
    groupId?: number;
    sdp: RTCSessionDescriptionInit;
  }) => void;
  'rtc:ice': (payload: {
    from: number;
    callId: string;
    groupId?: number;
    candidate: RTCIceCandidateInit;
  }) => void;
  'media:state': (payload: { from: number; callId: string; state: MediaState }) => void;
  'groupcall:media:state': (payload: {
    from: number;
    groupId: number;
    callId: string;
    state: MediaState;
  }) => void;
  'groupcall:active': (payload: {
    groupId: number;
    callId: string;
    startedBy: number;
    withVideo: boolean;
    startedAt: number;
  }) => void;
  'groupcall:ended': (payload: { groupId: number; callId: string }) => void;
  // Дельты нет намеренно: у каждой стороны своя проекция связи
  // (входящая/исходящая), проще перечитать список целиком.
  'friends:update': (payload: Record<string, never>) => void;
  'groupcall:peer-joined': (payload: { groupId: number; callId: string; userId: number }) => void;
  'groupcall:peer-left': (payload: { groupId: number; callId: string; userId: number }) => void;
};

export type SazcordSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// --- Друзья (режим socialMode === 'private', см. server/src/social.js) -----
export type FriendEntry = {
  id: number;
  username: string | null;
  displayName: string | null;
  avatarPath: string | null;
  online: boolean;
  deleted: boolean;
  since?: number;
};

// --- Панель сервера (admin only, GET /api/admin/stats) ---------------------
// Поля, которые сервер не может посчитать на этой платформе, приходят null
// (например loadavg на Windows) — рисовать их нулём было бы враньём.
export type AdminStats = {
  server: {
    version: string;
    uptimeSec: number;
    node: string;
    platform: string;
    socialMode: 'local' | 'private';
    retention: string;
  };
  host: {
    loadavg: number[] | null;
    cpus: number;
    memTotalBytes: number;
    memFreeBytes: number;
  };
  process: { rssBytes: number; heapUsedBytes: number };
  storage: {
    diskFreeBytes: number | null;
    dbBytes: number;
    attachmentBytes: number;
    quotaTotalBytes: number | null;
    quotaPerUserBytes: number | null;
    minFreeBytes: number | null;
  };
  counts: {
    users: number;
    usersDeleted: number;
    online: number;
    away: number;
    messages: number;
    groups: number;
    attachments: number;
    pushSubscriptions: number;
  };
};
