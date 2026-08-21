import db from './db.js';
import { emitToPair } from './ioHub.js';

/**
 * Конечный автомат звонков на сервере + системные сообщения в чате.
 *
 *  Состояния:
 *    pending  — приглашение отправлено, никто не принял
 *    active   — обе стороны на связи
 *    waiting  — один из участников отвалился, у второго есть 5 минут
 *               чтобы принять обратно (через кнопку "Подключиться")
 *    ended    — финальное состояние:
 *               outcome ∈ { completed | missed | rejected | cancelled | expired }
 *
 *  В чат пишется ровно одно системное сообщение kind='call' с payload:
 *    { callId, withVideo, status, startedAt?, endedAt?, durationMs?, outcome? }
 *  Сообщение апдейтится через dm:update по мере смены состояния.
 *
 *  Поскольку звонок без второго участника по требованию длится ещё 5 минут
 *  и у обоих в чате видна возможность подключиться — это окно реализовано
 *  через таймер reconnectTimer на сервере. Сам peer-connection не держится:
 *  при rejoin клиент инициирует новый offer/answer.
 */

import { CALL_RECONNECT_MS, CALL_RING_TIMEOUT_MS } from './config.js';
const RECONNECT_MS = CALL_RECONNECT_MS;
const PENDING_TIMEOUT_MS = CALL_RING_TIMEOUT_MS;

const calls = new Map();

function makeCall({ callId, callerId, calleeId, withVideo, messageId }) {
  return {
    callId,
    callerId,
    calleeId,
    withVideo: !!withVideo,
    messageId,
    status: 'pending',
    startedAt: null,
    endedAt: null,
    pendingTimer: null,
    reconnectTimer: null,
  };
}

function clearTimer(c, key) {
  if (c[key]) {
    clearTimeout(c[key]);
    c[key] = null;
  }
}

function nowTs() {
  return Date.now();
}

function pairOf(c) {
  return [c.callerId, c.calleeId];
}

function getMessage(id) {
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
}

function emitMessageUpdate(messageId) {
  const row = getMessage(messageId);
  if (!row) return;
  let payload = null;
  try {
    payload = row.payload ? JSON.parse(row.payload) : null;
  } catch {
    /* ignore */
  }
  const msg = {
    id: row.id,
    senderId: row.sender_id,
    receiverId: row.receiver_id,
    content: row.content || '',
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
    deleted: !!row.deleted,
    kind: row.kind || 'text',
    attachmentPath: row.attachment_path || null,
    durationMs: row.duration_ms || null,
    attachmentName: row.attachment_name || null,
    attachmentSize: row.attachment_size || null,
    attachmentMime: row.attachment_mime || null,
    payload,
  };
  emitToPair(row.sender_id, row.receiver_id, 'dm:update', msg);
}

function writePayload(messageId, payload) {
  db.prepare('UPDATE messages SET payload = ? WHERE id = ?').run(
    JSON.stringify(payload),
    messageId,
  );
}

function insertCallMessage({ callerId, calleeId, withVideo, callId }) {
  const now = nowTs();
  const payload = {
    callId,
    withVideo: !!withVideo,
    status: 'pending',
    startedAt: null,
    endedAt: null,
    durationMs: null,
    outcome: null,
  };
  const info = db
    .prepare(
      `INSERT INTO messages (sender_id, receiver_id, content, created_at, kind, payload)
       VALUES (?, ?, '', ?, 'call', ?)`,
    )
    .run(callerId, calleeId, now, JSON.stringify(payload));
  const row = getMessage(info.lastInsertRowid);
  return {
    id: row.id,
    senderId: row.sender_id,
    receiverId: row.receiver_id,
    content: '',
    createdAt: row.created_at,
    editedAt: null,
    deleted: false,
    kind: 'call',
    attachmentPath: null,
    durationMs: null,
    attachmentName: null,
    attachmentSize: null,
    attachmentMime: null,
    payload,
  };
}

function isMuted(by, target) {
  const row = db.prepare('SELECT 1 FROM mutes WHERE user_id = ? AND target_id = ?').get(by, target);
  return !!row;
}

export function registerInvite({ callId, callerId, calleeId, withVideo }) {
  // Если уже есть активный звонок с таким id — игнор.
  if (calls.has(callId)) return null;

  const sysMsg = insertCallMessage({ callerId, calleeId, withVideo, callId });
  const c = makeCall({
    callId,
    callerId,
    calleeId,
    withVideo,
    messageId: sysMsg.id,
  });
  calls.set(callId, c);

  // Таймер на missed (если никто не принял за 30 секунд).
  //
  // Раньше здесь только правился payload системного сообщения, а сокет-
  // событие никому не уходило. У звонящего окно оставалось в состоянии
  // 'calling' с гудками НАВСЕГДА (пока он сам не нажмёт «Отбой»), хотя на
  // сервере звонка уже не существовало — выглядело как «звонок не
  // работает». Теперь явно закрываем звонок у обеих сторон.
  c.pendingTimer = setTimeout(() => {
    const cur = calls.get(callId);
    if (!cur || cur.status !== 'pending') return;
    finalize(callId, 'missed');
    emitToPair(callerId, calleeId, 'call:end', { callId, reason: 'missed' });
  }, PENDING_TIMEOUT_MS);

  // Эмитим dm:new обоим (системное сообщение)
  emitToPair(callerId, calleeId, 'dm:new', sysMsg);

  // Если callee замутил каллера — модалку не показываем (только сообщение).
  const muted = isMuted(calleeId, callerId);

  return { call: c, message: sysMsg, calleeMuted: muted };
}

export function markActive(callId) {
  const c = calls.get(callId);
  if (!c) return null;
  // Защита: если звонок уже завершён (например, пир нажал
  // End, пока в полёте был старый call:accept) — НЕ воскрешаем.
  // Иначе в чате после 'ended' сообщение внезапно становится
  // 'active' с outcome=null, а следующий call:end запишет 'cancelled'.
  if (c.status === 'ended') return c;
  if (c.status === 'active') return c;
  c.status = 'active';
  // При реджойне startedAt уже проставлен — сохраняем, чтобы длительность
  // считалась от начала ПЕРВОГО сеанса, а не обнулялась с момента выхода
  // первого участника.
  if (!c.startedAt) c.startedAt = nowTs();
  clearTimer(c, 'pendingTimer');
  clearTimer(c, 'reconnectTimer');
  writePayload(c.messageId, {
    callId: c.callId,
    withVideo: c.withVideo,
    status: 'active',
    startedAt: c.startedAt,
    endedAt: null,
    durationMs: null,
    outcome: null,
  });
  emitMessageUpdate(c.messageId);
  return c;
}

export function markWaiting(callId) {
  const c = calls.get(callId);
  if (!c) return null;
  if (c.status === 'ended') return c;
  c.status = 'waiting';
  clearTimer(c, 'reconnectTimer');
  c.reconnectTimer = setTimeout(() => {
    const cur = calls.get(callId);
    if (!cur || cur.status !== 'waiting') return;
    finalize(callId, 'expired');
  }, RECONNECT_MS);
  const reconnectUntil = nowTs() + RECONNECT_MS;
  writePayload(c.messageId, {
    callId: c.callId,
    withVideo: c.withVideo,
    status: 'waiting',
    startedAt: c.startedAt,
    endedAt: null,
    durationMs: null,
    outcome: null,
    reconnectUntil,
  });
  emitMessageUpdate(c.messageId);
  return c;
}

export function finalize(callId, outcome /* completed|missed|rejected|cancelled|expired */) {
  const c = calls.get(callId);
  if (!c) return null;
  if (c.status === 'ended') return c;
  c.status = 'ended';
  c.endedAt = nowTs();
  clearTimer(c, 'pendingTimer');
  clearTimer(c, 'reconnectTimer');
  const durationMs = c.startedAt ? Math.max(0, c.endedAt - c.startedAt) : 0;
  writePayload(c.messageId, {
    callId: c.callId,
    withVideo: c.withVideo,
    status: 'ended',
    startedAt: c.startedAt,
    endedAt: c.endedAt,
    durationMs,
    outcome,
  });
  emitMessageUpdate(c.messageId);
  // Отдадим память через минуту (на случай поздних событий)
  setTimeout(() => calls.delete(callId), 60_000);
  return c;
}

export function getCall(callId) {
  return calls.get(callId) || null;
}

/**
 * Возвращает callId для реконнекта (если такой существует, активен и не истёк).
 */
export function tryRejoinable(callId, byUserId) {
  const c = calls.get(callId);
  if (!c) return null;
  if (![c.callerId, c.calleeId].includes(byUserId)) return null;
  if (c.status === 'ended') return null;
  return c;
}

export function isCalleeMuted(callerId, calleeId) {
  return isMuted(calleeId, callerId);
}

/**
 * Найти все НЕ-ended звонки между двумя юзерами (любая роль).
 * Используется при создании нового invite, чтобы отфиналить «висящие»
 * waiting-сессии и не оставлять в чате две системные плашки одновременно.
 */
export function findActiveCallsForUser(userId) {
  const out = [];
  for (const c of calls.values()) {
    if (c.status === 'ended') continue;
    if (c.callerId === userId || c.calleeId === userId) out.push(c);
  }
  return out;
}

export function findActiveCallsBetween(userA, userB) {
  const out = [];
  for (const c of calls.values()) {
    if (c.status === 'ended') continue;
    const pair = new Set([c.callerId, c.calleeId]);
    if (pair.has(userA) && pair.has(userB)) out.push(c);
  }
  return out;
}

/**
 * Переиспользует существующий waiting-звонок под новый callId при реджойне.
 * Это критически важно, чтобы НЕ плодить в чате «завершён» + «новый звонок»
 * при каждом нажатии «Подключиться». В результате:
 *   - тот же messageId продолжает обновляться (одно системное сообщение);
 *   - startedAt сохраняется — длительность звонка продолжает тикать
 *     от первого ответа, а не от рестарта;
 *   - callId меняется, т.к. у клиента при rejoin он свежий.
 * Возвращает обновлённый call (уже под новым id) или null, если исходный
 * не найден / не в waiting.
 */
export function rebindForRejoin(oldCallId, newCallId, withVideo, newCallerId) {
  const c = calls.get(oldCallId);
  if (!c) return null;
  if (c.status === 'ended') return null;
  calls.delete(oldCallId);
  c.callId = newCallId;
  c.status = 'pending';
  c.withVideo = !!withVideo;
  // Реджойн может инициировать ЛЮБАЯ из сторон через кнопку
  // «Подключиться» в waiting-окне. Тот, кто прислал новый call:invite,
  // теперь является caller'ом этого сеанса; вторая сторона — callee.
  // Без свопа call:accept от исходного callerId отбрасывался проверкой
  // c.calleeId !== me.id (см. socket.js → call:accept), и реджойн
  // оставался в pending до 30 сек, после чего finalize'ился как
  // 'missed' — в чате появлялась плашка «конец звонка».
  if (typeof newCallerId === 'number' && newCallerId === c.calleeId) {
    const tmp = c.callerId;
    c.callerId = c.calleeId;
    c.calleeId = tmp;
  }
  clearTimer(c, 'reconnectTimer');
  clearTimer(c, 'pendingTimer');
  // 30 сек на ответ второй стороны, иначе — missed с сохранением
  // прежнего startedAt (durationMs всё равно посчитается корректно).
  c.pendingTimer = setTimeout(() => {
    const cur = calls.get(newCallId);
    if (!cur || cur.status !== 'pending') return;
    // Если до реджойна звонок уже был успешным (startedAt выставлен
    // при первом markActive) — это не «пропущенный», а «завершённый»
    // звонок, у которого переподключение не удалось.
    finalize(newCallId, cur.startedAt ? 'completed' : 'missed');
    emitToPair(cur.callerId, cur.calleeId, 'call:end', {
      callId: newCallId,
      reason: 'missed',
    });
  }, PENDING_TIMEOUT_MS);
  calls.set(newCallId, c);
  writePayload(c.messageId, {
    callId: newCallId,
    withVideo: c.withVideo,
    status: 'pending',
    startedAt: c.startedAt,
    endedAt: null,
    durationMs: null,
    outcome: null,
  });
  emitMessageUpdate(c.messageId);
  return c;
}
