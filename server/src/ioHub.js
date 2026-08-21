// Единая точка доступа к io-инстансу из HTTP-роутов.
// Устанавливается из socket.js при старте, используется из routes/messages.js
// и routes/groups.js для публикации событий после HTTP-операций.

let io = null;

export function setIO(instance) {
  io = instance;
}

export function roomOf(userId) {
  return `user:${userId}`;
}

export function groupRoomOf(groupId) {
  return `group:${groupId}`;
}

export function emitToUser(userId, event, payload) {
  if (!io) return;
  io.to(roomOf(userId)).emit(event, payload);
}

export function emitToPair(a, b, event, payload) {
  if (!io) return;
  io.to(roomOf(a)).emit(event, payload);
  if (a !== b) io.to(roomOf(b)).emit(event, payload);
}

// Отправить событие в групповую комнату. Подписаны все онлайн-участники.
export function emitToGroup(groupId, event, payload) {
  if (!io) return;
  io.to(groupRoomOf(groupId)).emit(event, payload);
}

// Явная доставка каждому участнику в его user-комнату — используется для
// "управляющих" событий (добавили в группу, удалили из группы), когда юзер
// может быть ещё не подписан на groupRoom.
export function emitToUsers(userIds, event, payload) {
  if (!io) return;
  for (const uid of userIds) io.to(roomOf(uid)).emit(event, payload);
}

// Принудительное добавление всех сокетов данного юзера в комнату группы
// (при создании/приглашении — пользователю нужно сразу начать получать
// события чата, не дожидаясь реконнекта).
export function joinUserToGroup(userId, groupId) {
  if (!io) return;
  const sockets = io.sockets.adapter.rooms.get(roomOf(userId));
  if (!sockets) return;
  for (const sid of sockets) {
    const s = io.sockets.sockets.get(sid);
    if (s) s.join(groupRoomOf(groupId));
  }
}

export function leaveUserFromGroup(userId, groupId) {
  if (!io) return;
  const sockets = io.sockets.adapter.rooms.get(roomOf(userId));
  if (!sockets) return;
  for (const sid of sockets) {
    const s = io.sockets.sockets.get(sid);
    if (s) s.leave(groupRoomOf(groupId));
  }
}

// Принудительно разорвать все сокет-соединения пользователя — нужен при
// удалении аккаунта, чтобы текущие подключённые вкладки разлогинились.
export function disconnectUserSockets(userId, reason = 'account-deleted') {
  if (!io) return;
  const room = io.sockets.adapter.rooms.get(roomOf(userId));
  if (!room) return;
  for (const sid of [...room]) {
    const s = io.sockets.sockets.get(sid);
    if (!s) continue;
    try {
      s.emit('account:deleted', { reason });
    } catch {
      /* */
    }
    try {
      s.disconnect(true);
    } catch {
      /* */
    }
  }
}
