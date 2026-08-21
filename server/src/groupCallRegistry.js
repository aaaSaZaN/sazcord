// In-memory реестр активных групповых звонков.
//
// Простая модель: максимум один звонок на группу одновременно.
// При старте первый участник создаёт "комнату" (groupcall). Остальные —
// присоединяются. При уходе последнего — комната разрушается.
//
// Состояние:
//   groupId -> {
//     callId,                       // уникальный id сессии
//     groupId,
//     withVideo,                    // признак "видео-по-умолчанию" (UI-hint)
//     startedAt,
//     startedBy,
//     participants: Map<userId, Set<socketId>>,
//   }
//
// Методы возвращают новое состояние и предупреждают о "бокевых" эффектах
// (появился новый пир / ушёл пир / ушёл хост).

const calls = new Map(); // groupId -> call

function makeCallId(groupId) {
  return `g${groupId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function getCall(groupId) {
  return calls.get(groupId) || null;
}

export function listParticipants(groupId) {
  const c = calls.get(groupId);
  if (!c) return [];
  return [...c.participants.keys()];
}

// Вход в групповой звонок. Если звонка ещё нет — создаёт.
// Возвращает { call, created, alreadyIn, peers } где peers — кто уже в звонке
// ДО нашего входа (нужно для клиента: с этими пирами начать mesh).
export function joinGroupCall({ groupId, userId, socketId, withVideo = false }) {
  let c = calls.get(groupId);
  let created = false;
  if (!c) {
    c = {
      callId: makeCallId(groupId),
      groupId,
      withVideo: !!withVideo,
      startedAt: Date.now(),
      startedBy: userId,
      participants: new Map(),
    };
    calls.set(groupId, c);
    created = true;
  }
  const existingPeers = [...c.participants.keys()].filter((id) => id !== userId);
  const alreadyIn = c.participants.has(userId);
  if (!c.participants.has(userId)) c.participants.set(userId, new Set());
  c.participants.get(userId).add(socketId);
  return { call: c, created, alreadyIn, peers: existingPeers };
}

// Выход из звонка конкретного сокета. Если у юзера не осталось сокетов —
// он полностью покидает call. Если в звонке никого не осталось — звонок разрушается.
// Возвращает { call, userLeft, callEnded }
export function leaveGroupCall({ groupId, userId, socketId }) {
  const c = calls.get(groupId);
  if (!c) return { call: null, userLeft: false, callEnded: false };
  const set = c.participants.get(userId);
  if (!set) return { call: c, userLeft: false, callEnded: false };
  set.delete(socketId);
  let userLeft = false;
  if (set.size === 0) {
    c.participants.delete(userId);
    userLeft = true;
  }
  const callEnded = c.participants.size === 0;
  if (callEnded) calls.delete(groupId);
  return { call: c, userLeft, callEnded };
}

// Полностью убрать все сокеты пользователя из всех групповых звонков.
// Используется в disconnect.
export function forceLeaveAll(socketId, userId) {
  const out = [];
  for (const [groupId, c] of calls.entries()) {
    const set = c.participants.get(userId);
    if (!set || !set.has(socketId)) continue;
    set.delete(socketId);
    let userLeft = false;
    if (set.size === 0) {
      c.participants.delete(userId);
      userLeft = true;
    }
    const callEnded = c.participants.size === 0;
    if (callEnded) calls.delete(groupId);
    out.push({
      groupId,
      userLeft,
      callEnded,
      callId: c.callId,
      messageId: c.messageId,
    });
  }
  return out;
}

// Привязать id системного сообщения к активному звонку (для последующего апдейта).
export function attachMessageId(groupId, messageId) {
  const c = calls.get(groupId);
  if (c) c.messageId = messageId;
}

// Для тестов.
export function _reset() {
  calls.clear();
}
