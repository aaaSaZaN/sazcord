import { Server as IOServer } from 'socket.io';
import { MESSAGE_MAX_CHARS } from './config.js';
import { canInteract, visibleUserIds } from './social.js';
import db from './db.js';
import { verifyToken } from './auth.js';
import {
  addUserSocket,
  removeUserSocket,
  getOnlineUserIds,
  setAway,
  getAwayUserIds,
  isAway,
} from './presence.js';
import { setIO, roomOf } from './ioHub.js';
import {
  registerInvite,
  markActive,
  finalize,
  getCall,
  findActiveCallsBetween,
  findActiveCallsForUser,
  rebindForRejoin,
} from './callRegistry.js';
import {
  joinGroupCall,
  leaveGroupCall,
  getCall as getGroupCall,
  forceLeaveAll as forceLeaveAllGroupCalls,
  attachMessageId as attachGroupCallMessageId,
} from './groupCallRegistry.js';
import { pushToUser, pushToUsers } from './push.js';
import { buildSocketCorsOptions } from './security.js';
// validateReplyTo — общая проверка для DM/group reply. rowToMessage и
// MSG_COLS — единый формат сообщения с replyTo/forwardedFrom для UI.
import { validateReplyTo, rowToMessage, MSG_COLS } from './routes/messages.js';

// Presence раньше уходил в io.emit, то есть КАЖДОМУ подключённому. В
// private-режиме это утечка: по одним только «зашёл/вышел» можно было бы
// собрать список всех аккаунтов сервера, ни одного из них не видя в
// контактах. Рассылаем только тем, кто и так вправе видеть этого юзера.
function broadcastPresence(io, userId, payload) {
  const audience = visibleUserIds(userId);
  if (!audience) {
    io.emit('presence', payload);
    return;
  }
  for (const uid of audience) io.to(roomOf(uid)).emit('presence', payload);
}

export function attachSocket(httpServer) {
  const io = new IOServer(httpServer, {
    cors: buildSocketCorsOptions(),
    maxHttpBufferSize: 1e6,
  });
  setIO(io);

  // Каждый юзер имеет персональную "комнату" user:<id>, чтобы легко адресовать
  // сообщения всем его подключениям сразу (ПК + телефон). Формула одна на
  // весь сервер и живёт в ioHub — локальная копия разъезжалась бы с ней.

  // Параллельно держим карту "сокеты участников" — нужна для прокидывания
  // signaling и для определения "ушёл ли один из участников".
  // callId -> { caller: socketId|null, callee: socketId|null }
  const sockets = new Map();

  function setSocketFor(callId, role, socketId) {
    if (!sockets.has(callId)) sockets.set(callId, { caller: null, callee: null });
    sockets.get(callId)[role] = socketId;
  }
  function dropSockets(callId) {
    sockets.delete(callId);
  }

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const payload = token && verifyToken(token);
    if (!payload) return next(new Error('unauthorized'));
    socket.data.user = payload;
    next();
  });

  const groupRoomOf = (gid) => `group:${gid}`;

  // --- Системные сообщения о групповом звонке -----------------------------
  // payload.status: 'active' | 'ended'
  function insertGroupCallSystemMsg(groupId, actorId, callId, withVideo) {
    const now = Date.now();
    const payload = {
      type: 'groupcall',
      status: 'active',
      callId,
      startedBy: actorId,
      startedAt: now,
      withVideo: !!withVideo,
    };
    const info = db
      .prepare(
        `INSERT INTO messages (sender_id, group_id, content, created_at, kind, payload)
         VALUES (?, ?, '', ?, 'groupcall', ?)`,
      )
      .run(actorId, groupId, now, JSON.stringify(payload));
    db.prepare('UPDATE groups SET updated_at = ? WHERE id = ?').run(now, groupId);
    const msg = {
      id: info.lastInsertRowid,
      senderId: actorId,
      receiverId: null,
      groupId,
      content: '',
      createdAt: now,
      editedAt: null,
      deleted: false,
      kind: 'groupcall',
      attachmentPath: null,
      durationMs: null,
      attachmentName: null,
      attachmentSize: null,
      attachmentMime: null,
      payload,
    };
    io.to(groupRoomOf(groupId)).emit('dm:new', msg);
    return msg;
  }

  function endGroupCallSystemMsg(groupId, messageId) {
    if (!messageId) return;
    const row = db.prepare('SELECT payload FROM messages WHERE id = ?').get(messageId);
    if (!row) return;
    let payload = {};
    try {
      payload = JSON.parse(row.payload || '{}');
    } catch {
      /* */
    }
    payload.status = 'ended';
    payload.endedAt = Date.now();
    db.prepare('UPDATE messages SET payload = ? WHERE id = ?').run(
      JSON.stringify(payload),
      messageId,
    );
    const fresh = db
      .prepare(
        `SELECT id, sender_id, receiver_id, group_id, content, created_at, edited_at,
                deleted, kind, attachment_path, duration_ms, attachment_name,
                attachment_size, attachment_mime, payload
           FROM messages WHERE id = ?`,
      )
      .get(messageId);
    if (!fresh) return;
    const msg = {
      id: fresh.id,
      senderId: fresh.sender_id,
      receiverId: fresh.receiver_id,
      groupId: fresh.group_id,
      content: fresh.content || '',
      createdAt: fresh.created_at,
      editedAt: fresh.edited_at,
      deleted: !!fresh.deleted,
      kind: fresh.kind,
      attachmentPath: fresh.attachment_path,
      durationMs: fresh.duration_ms,
      attachmentName: fresh.attachment_name,
      attachmentSize: fresh.attachment_size,
      attachmentMime: fresh.attachment_mime,
      payload,
    };
    io.to(groupRoomOf(groupId)).emit('dm:update', msg);
  }

  io.on('connection', (socket) => {
    const me = socket.data.user;
    socket.join(roomOf(me.id));

    // Автоматически подпишем сокет на все группы, где этот юзер участвует.
    const myGroupIds = db
      .prepare('SELECT group_id FROM group_members WHERE user_id = ?')
      .all(me.id)
      .map((r) => r.group_id);
    for (const gid of myGroupIds) socket.join(groupRoomOf(gid));

    const becameOnline = addUserSocket(me.id);
    if (becameOnline) {
      // Новый инстанс юзера всегда active (away снимем при оффлайне,
      // но для свежего коннекта явно флажок away: false в пайлоаде).
      broadcastPresence(io, me.id, { userId: me.id, online: true, away: false });
    } else if (isAway(me.id)) {
      // Юзер был away на другом девайсе, и открыл второй таб/клиент — это явный
      // сигнал «я снова здесь». Снимаем away и бродкастим.
      if (setAway(me.id, false)) {
        broadcastPresence(io, me.id, { userId: me.id, online: true, away: false });
      }
    }

    // Отправляем клиенту начальный список онлайнов + away
    // Начальный список тоже сужаем: иначе всё, что сэкономлено на
    // broadcastPresence, утекало бы одним пакетом при подключении.
    const canSee = visibleUserIds(me.id);
    const onlyVisible = (ids) => (canSee ? ids.filter((id) => canSee.has(id)) : ids);
    socket.emit('presence:list', {
      online: onlyVisible([...getOnlineUserIds()]),
      away: onlyVisible([...getAwayUserIds()]),
    });

    // --- Idle/away бинды ---
    // Клиент шлет presence:away после 5 мин неактивности и presence:active
    // при любой активности (mousemove/keydown/...). Сервер просто агрегирует
    // в awayUsers + бродкастит всем. setAway() возвращает true только при реальном
    // изменении — повторные presence:away от одного клиента не флудят сокеты.
    socket.on('presence:away', () => {
      if (setAway(me.id, true)) {
        broadcastPresence(io, me.id, { userId: me.id, online: true, away: true });
      }
    });
    socket.on('presence:active', () => {
      if (setAway(me.id, false)) {
        broadcastPresence(io, me.id, { userId: me.id, online: true, away: false });
      }
    });

    // Список текущих мьютов клиенту, чтобы UI отрисовался корректно при коннекте.
    const muteRows = db
      .prepare('SELECT target_id FROM mutes WHERE user_id = ?')
      .all(me.id)
      .map((r) => r.target_id);
    socket.emit('mutes:update', { ids: muteRows });

    // --- Re-emit pending invites адресату на reconnect ---------------------
    // Сценарий: пользователю звонят (status=pending), он перезагружает
    // страницу или у него обрывается сеть. Прежде эта переподписка
    // приводила к тому, что нотификация исчезала: новый сокет не помнил,
    // что для него висит invite, а сервер call:invite повторно не слал.
    // 30-секундный pendingTimeout всё ещё работает (на сервере), значит
    // если callee успевает вернуться в окне, мы можем ему просто заново
    // отдать payload приглашения. Если callee замутил каллера — повторно
    // не дёргаем модалку, как и при изначальном invite.
    try {
      const pendingForMe = findActiveCallsForUser(me.id).filter(
        (c) => c.status === 'pending' && c.calleeId === me.id,
      );
      for (const c of pendingForMe) {
        const isMutedRow = db
          .prepare('SELECT 1 FROM mutes WHERE user_id = ? AND target_id = ?')
          .get(me.id, c.callerId);
        if (isMutedRow) continue;
        const callerRow = db
          .prepare('SELECT username, display_name, avatar_path FROM users WHERE id = ?')
          .get(c.callerId);
        if (!callerRow) continue;
        const callerName = callerRow.display_name || callerRow.username;
        socket.emit('call:invite', {
          callId: c.callId,
          withVideo: !!c.withVideo,
          from: c.callerId,
          fromUsername: callerRow.username,
          fromDisplayName: callerName,
          fromAvatarPath: callerRow.avatar_path || null,
        });
      }
    } catch {
      /* лучше тихо проглотить, чем сорвать handshake */
    }

    // --- Direct/group сообщения ---------------------------------------------
    // to — peer-id (DM) ИЛИ groupId — один из двух должен быть указан.
    socket.on('chat:typing', (payload) => {
      const { to, groupId, typing } = payload || {};
      if (typeof typing !== 'boolean') return;

      const toGroup = typeof groupId === 'number';
      const toUser = typeof to === 'number';
      if (toGroup === toUser) return;

      if (toUser) {
        if (to === me.id) return;
        const peer = db.prepare('SELECT id FROM users WHERE id = ?').get(to);
        if (!peer) return;
        if (!canInteract(me.id, to)) return;
        io.to(roomOf(to)).emit('chat:typing', { from: me.id, typing });
        return;
      }

      const membership = db
        .prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?')
        .get(groupId, me.id);
      if (!membership) return;

      const memberIds = db
        .prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?')
        .all(groupId, me.id)
        .map((r) => r.user_id);
      for (const uid of memberIds) {
        io.to(roomOf(uid)).emit('chat:typing', { from: me.id, groupId, typing });
      }
    });

    socket.on('dm:send', ({ to, groupId, content, clientId, replyToId }, ack) => {
      if (typeof content !== 'string') return ack?.({ error: 'bad payload' });
      const trimmed = content.trim();
      if (!trimmed) return ack?.({ error: 'empty' });
      if (trimmed.length > MESSAGE_MAX_CHARS) return ack?.({ error: 'too long' });
      // clientId — опциональный UUID от клиента для связки optimistic-плейсхолдера
      // с реальной записью. Пропускаем обратно в dm:new/ack. Длину ограничиваем,
      // чтобы не тащить ерунду в трансляцию.
      const safeClientId =
        typeof clientId === 'string' && clientId.length > 0 && clientId.length <= 64
          ? clientId
          : null;

      const toGroup = typeof groupId === 'number';
      const toUser = typeof to === 'number';
      if (toGroup === toUser) return ack?.({ error: 'need exactly one target' });

      // replyToId — опционален. Проверяем валидность ДО INSERT, чтобы не
      // плодить мусор. ctx зависит от типа чата: для группы — groupId,
      // для DM — me+peer.
      const replyCtx = toGroup ? { groupId, me: me.id } : { me: me.id, peerId: to };
      const replyCheck = validateReplyTo(
        replyToId === undefined || replyToId === null ? null : Number(replyToId),
        replyCtx,
      );
      if (replyCheck.error) return ack?.({ error: replyCheck.error });
      const resolvedReplyId = replyCheck.id;

      const now = Date.now();

      if (toGroup) {
        const membership = db
          .prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?')
          .get(groupId, me.id);
        if (!membership) return ack?.({ error: 'not a member' });
        const info = db
          .prepare(
            `INSERT INTO messages (sender_id, group_id, content, created_at, kind, reply_to_message_id)
             VALUES (?, ?, ?, ?, 'text', ?)`,
          )
          .run(me.id, groupId, trimmed, now, resolvedReplyId);
        db.prepare('UPDATE groups SET updated_at = ? WHERE id = ?').run(now, groupId);
        const fullRow = db
          .prepare(`SELECT ${MSG_COLS} FROM messages WHERE id = ?`)
          .get(info.lastInsertRowid);
        const msg = {
          ...rowToMessage(fullRow),
          ...(safeClientId ? { clientId: safeClientId } : {}),
        };
        // Все участники подписаны на group:<id> при connect и при join,
        // поэтому одного emit достаточно. Дублирование в личные комнаты
        // приводило к тому, что у клиента счётчик непрочитанных рос на 2.
        io.to(groupRoomOf(groupId)).emit('dm:new', msg);

        // Web Push всем участникам группы, кроме отправителя.
        const groupRow = db.prepare('SELECT name FROM groups WHERE id = ?').get(groupId);
        const memberIds = db
          .prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?')
          .all(groupId, me.id)
          .map((r) => r.user_id);
        if (memberIds.length) {
          pushToUsers(memberIds, {
            kind: 'group',
            title: groupRow?.name || 'Группа',
            body: `${me.username}: ${trimmed.slice(0, 120)}`,
            tag: `group:${groupId}`,
            url: `/?group=${groupId}`,
          }).catch(() => {});
        }
        return ack?.({ ok: true, message: msg });
      }

      // DM 1:1
      const peer = db.prepare('SELECT id FROM users WHERE id = ?').get(to);
      if (!peer) return ack?.({ error: 'no such user' });
      // В private-режиме писать можно только по существующей связи.
      if (!canInteract(me.id, to)) return ack?.({ error: 'not allowed' });

      const info = db
        .prepare(
          `INSERT INTO messages (sender_id, receiver_id, content, created_at, kind, reply_to_message_id)
           VALUES (?, ?, ?, ?, 'text', ?)`,
        )
        .run(me.id, to, trimmed, now, resolvedReplyId);
      const fullRow = db
        .prepare(`SELECT ${MSG_COLS} FROM messages WHERE id = ?`)
        .get(info.lastInsertRowid);
      const msg = {
        ...rowToMessage(fullRow),
        ...(safeClientId ? { clientId: safeClientId } : {}),
      };

      io.to(roomOf(to)).emit('dm:new', msg);
      io.to(roomOf(me.id)).emit('dm:new', msg);
      ack?.({ ok: true, message: msg });

      // Web Push получателю. Содержимое не несём в payload, только мета —
      // SW сам отрисует «N: текст». Это и приватнее, и проще.
      pushToUser(to, {
        kind: 'dm',
        title: me.username,
        body: trimmed.slice(0, 140),
        tag: `dm:${me.id}`,
        url: `/?dm=${me.id}`,
      }).catch(() => {
        /* logged inside */
      });
    });

    // --- Галочки «прочитано» (read receipts) для DM 1:1 --------------------
    //
    // Клиент шлёт `dm:read { peerId, lastMessageId }` когда открывает чат
    // с peerId и хочет пометить все его сообщения (id <= lastMessageId)
    // как прочитанные. Сервер:
    //   1) проставляет read_at = now для таких сообщений (где sender=peerId,
    //      receiver=me, read_at IS NULL);
    //   2) уведомляет отправителя (peerId), какой максимальный id теперь
    //      прочитан, чтобы UI у него перевёл галочки в «две галки».
    //
    // Группы сознательно не поддерживаются: per-user read матрица стоит
    // отдельной таблицы, и UX галочек для N>2 участников не стандартен.
    socket.on('dm:read', (payload) => {
      const peerId = payload?.peerId;
      const lastMessageId = payload?.lastMessageId;
      if (typeof peerId !== 'number') return;
      if (typeof lastMessageId !== 'number' || lastMessageId <= 0) return;
      const now = Date.now();
      const info = db
        .prepare(
          `UPDATE messages
             SET read_at = ?
           WHERE sender_id = ?
             AND receiver_id = ?
             AND group_id IS NULL
             AND id <= ?
             AND read_at IS NULL`,
        )
        .run(now, peerId, me.id, lastMessageId);
      // Если ничего не обновилось (всё уже прочитано) — не шумим в эфир:
      // клиент-отправитель и так уже в состоянии «read».
      if (info.changes === 0) return;
      // Уведомляем отправителя (peerId) в его личной комнате. Кому-то ещё
      // (включая нас самих на другом устройстве) читающему этот чат — тоже
      // полезно, но это делается через соседний emit в свою комнату: так
      // multi-device сессии синхронизируются.
      const payloadOut = { peerId: me.id, lastMessageId, readAt: now };
      io.to(roomOf(peerId)).emit('dm:read', payloadOut);
      // В свою комнату — чтобы все наши открытые сессии тоже обнулили
      // локальный счётчик непрочитанных в этом DM. peerId в payload для
      // отправителя = наш id, а для «другого моего устройства» это id
      // собеседника — перепутать нельзя, потому что шлём разные события:
      io.to(roomOf(me.id)).emit('dm:read:self', { peerId, lastMessageId, readAt: now });
    });

    // --- WebRTC сигналинг ---------------------------------------------------
    //
    // Проверяем, что отправитель и получатель действительно участвуют в
    // указанном `callId` (1:1 или группа). Без этого любой авторизованный
    // юзер мог бы подбросить SDP/ICE любому другому, имитируя звонок —
    // это позволяло слать «фейковые» offer'ы и DoS-ить клиента.
    const forward = (event) => (payload) => {
      const to = payload?.to;
      const callId = payload?.callId;
      const groupId = payload?.groupId;
      if (typeof to !== 'number') return;
      if (typeof callId !== 'string' || !callId) return;
      // Группа: callId зарегистрирован в groupCallRegistry, оба должны быть в нём.
      if (groupId != null) {
        const gc = getGroupCall(groupId);
        if (!gc || gc.callId !== callId) return;
        if (!gc.participants.has(me.id) || !gc.participants.has(to)) return;
      } else {
        // 1:1: callId — в callRegistry, и {caller,callee} == {me, to}.
        const c = getCall(callId);
        if (!c || c.status === 'ended') return;
        const pair = new Set([c.callerId, c.calleeId]);
        if (!pair.has(me.id) || !pair.has(to)) return;
      }
      io.to(roomOf(to)).emit(event, { ...payload, from: me.id, fromUsername: me.username });
    };

    // call:invite — обновлённая логика:
    // 1) пишем системное сообщение в чат у обеих сторон через registerInvite()
    // 2) если callee НЕ замутил каллера — поднимаем модалку (как раньше)
    socket.on('call:invite', (payload) => {
      const { callId, to, withVideo } = payload || {};
      if (typeof callId !== 'string' || typeof to !== 'number') return;
      const peer = db.prepare('SELECT id FROM users WHERE id = ?').get(to);
      if (!peer) return;
      if (!canInteract(me.id, to)) return;

      // Между этими двумя может висеть незакрытый звонок:
      //   - waiting: был полноценный разговор, один ушёл, второй вернулся
      //              через кнопку «Подключиться» → это реджойн, НЕ новое
      //              сообщение. Переиспользуем messageId и сохраняем
      //              startedAt, чтобы в чате не было «завершён + новый»,
      //              и таймер не обнулялся.
      //   - pending/active: аномалия (дубликат invite, зависший звонок).
      //                     Тихо финалим без создания нового сообщения.
      const existing = findActiveCallsBetween(me.id, to);
      const waitingCall = existing.find((c) => c.status === 'waiting');

      let result;
      if (waitingCall) {
        // Забираем сокет-маппинг со старого callId и выкидываем остальных
        // «зависших» (не должны существовать, но на всякий случай).
        for (const c of existing) {
          if (c.callId === waitingCall.callId) continue;
          if (c.status !== 'ended') finalize(c.callId, c.startedAt ? 'completed' : 'cancelled');
          dropSockets(c.callId);
        }
        dropSockets(waitingCall.callId);

        const rebound = rebindForRejoin(waitingCall.callId, callId, !!withVideo, me.id);
        if (!rebound) return; // внезапно ended — игнор
        // Узнать, замучен ли callee, тут нужно локально (isMuted в registry
        // не экспортирован). db уже в scope.
        const mutedRow = db
          .prepare('SELECT 1 FROM mutes WHERE user_id = ? AND target_id = ?')
          .get(to, me.id);
        result = { call: rebound, calleeMuted: !!mutedRow, reused: true };
      } else {
        // Чистим мусор: pending/active без waiting — дубликат или баг.
        for (const c of existing) {
          if (c.status !== 'ended') finalize(c.callId, c.startedAt ? 'completed' : 'cancelled');
          dropSockets(c.callId);
        }
        result = registerInvite({
          callId,
          callerId: me.id,
          calleeId: to,
          withVideo: !!withVideo,
        });
        if (!result) return; // дубликат
      }

      setSocketFor(callId, 'caller', socket.id);

      if (!result.calleeMuted) {
        const row = db
          .prepare('SELECT display_name, avatar_path FROM users WHERE id = ?')
          .get(me.id);
        const callerName = row?.display_name || me.username;
        io.to(roomOf(to)).emit('call:invite', {
          callId,
          withVideo: !!withVideo,
          from: me.id,
          fromUsername: me.username,
          fromDisplayName: callerName,
          fromAvatarPath: row?.avatar_path || null,
        });

        // Web Push: входящий звонок. Tag единый, чтобы повторные invite
        // обновляли уведомление, а не плодили его. requireInteraction —
        // чтобы оставалось, пока юзер не отреагирует.
        pushToUser(to, {
          kind: 'call',
          title: `${callerName} звонит`,
          body: withVideo ? 'Видеозвонок' : 'Голосовой звонок',
          tag: `call:${me.id}`,
          url: `/?dm=${me.id}`,
          requireInteraction: true,
          renotify: true,
        }).catch(() => {});
      }
      // Подтверждение каллеру (для совместимости со state-машиной useCall)
      socket.emit('call:invite:sent', { callId, calleeMuted: !!result.calleeMuted });
    });

    // Multi-device: invite прилетает во ВСЕ устройства адресата (комната
    // user:<id>). Когда он принял/отклонил звонок на одном из них,
    // остальные обязаны прекратить звонить — иначе на ноуте продолжает
    // разрываться рингтон, хотя разговор уже идёт с телефона.
    // socket.to(...) шлёт всем в комнате, КРОМЕ текущего сокета.
    function notifyMyOtherDevices(callId, action) {
      socket.to(roomOf(me.id)).emit('call:handled', { callId, action, by: me.id });
    }

    socket.on('call:accept', (payload) => {
      const { callId } = payload || {};
      const c = getCall(callId);
      if (!c) return;
      if (c.calleeId !== me.id) return; // принять может только адресат
      setSocketFor(callId, 'callee', socket.id);
      markActive(callId);
      notifyMyOtherDevices(callId, 'accepted');
      forward('call:accept')(payload);
    });

    socket.on('call:reject', (payload) => {
      const { callId } = payload || {};
      const c = getCall(callId);
      if (c) finalize(callId, 'rejected');
      dropSockets(callId);
      notifyMyOtherDevices(callId, 'rejected');
      forward('call:reject')(payload);
    });

    socket.on('call:cancel', (payload) => {
      const { callId } = payload || {};
      const c = getCall(callId);
      if (c) finalize(callId, 'cancelled');
      dropSockets(callId);
      forward('call:cancel')(payload);
    });

    socket.on('call:end', (payload) => {
      const { callId, to, reason } = payload || {};
      if (typeof callId !== 'string' || typeof to !== 'number') return;
      const c = getCall(callId);
      if (!c) return;
      // Звонок в registry ещё 60 сек висит после finalize (грейс-период
      // на поздние события). Повторный call:end от клиента в это окно
      // игнорируем, чтобы не слать пиру дубль.
      if (c.status === 'ended') return;
      // Валидация пары (аналог forward): оба участника события — члены звонка.
      const pair = new Set([c.callerId, c.calleeId]);
      if (!pair.has(me.id) || !pair.has(to)) return;

      let outboundReason = reason;
      // Waiting-режим убран: раньше уход из активного звонка переводил его
      // в 'waiting' на 5 минут, окно у обеих сторон висело и мешало зайти
      // в групповой звонок. Теперь любой call:end финализирует звонок.
      if (c.status !== 'ended') {
        if (!outboundReason || outboundReason === 'hangup') {
          outboundReason = 'peer-leaving';
        }
        // Случай «ВТОРОЙ жмёт End из waiting»: c.status='waiting', пир
        // уже в waiting с selfLeft=true. Финалим и шлём явный call:end
        // второй стороне — её клиент выйдет из waiting в idle (окно
        // закроется). ВАЖНО: НЕ используем forward() ниже — он проверяет
        // c.status !== 'ended', а finalize выставляет именно 'ended',
        // и событие отбрасывалось. Из-за этого у первого отключившегося
        // окно оставалось висеть до 5-мин таймаута.
        finalize(callId, c.startedAt ? 'completed' : 'cancelled');
      }

      // Шлём напрямую, минуя forward: c.status мог стать 'ended' выше.
      io.to(roomOf(to)).emit('call:end', {
        ...payload,
        reason: outboundReason,
        from: me.id,
        fromUsername: me.username,
      });
    });

    // Полное завершение по обоюдному согласию (или таймауту)
    socket.on('call:terminate', (payload) => {
      const { callId } = payload || {};
      finalize(callId, 'completed');
      dropSockets(callId);
      forward('call:terminate')(payload);
    });

    // call:rejoin удалён — клиент теперь использует обычный call.start
    // (или эквивалентный rejoinAsCaller из waiting), а сервер автоматически
    // финализирует «висящие» звонки между той же парой при новом invite.

    socket.on('rtc:offer', forward('rtc:offer')); // { to, callId, sdp }
    socket.on('rtc:answer', forward('rtc:answer')); // { to, callId, sdp }
    socket.on('rtc:ice', forward('rtc:ice')); // { to, callId, candidate }
    socket.on('media:state', forward('media:state')); // { to, callId, state }

    // Групповая mesh-широковещалка media-state: один emit от участника
    // дозволенно расходится по всем остальным в `groupcall:{groupId}`.
    // Использовать одиночный forward() с per-peer циклом было бы избыточно
    // (N эмитов вместо одного) — UI же дёргает media:state часто.
    socket.on('groupcall:media:state', (payload) => {
      const { groupId, callId, state } = payload || {};
      if (typeof groupId !== 'number') return;
      if (typeof callId !== 'string' || !callId) return;
      const gc = getGroupCall(groupId);
      if (!gc || gc.callId !== callId) return;
      if (!gc.participants.has(me.id)) return;
      socket.to(`groupcall:${groupId}`).emit('groupcall:media:state', {
        from: me.id,
        callId,
        groupId,
        state,
      });
    });

    // --- Групповые звонки (mesh WebRTC) ------------------------------------
    //
    // Клиент инициирует / присоединяется:
    //   groupcall:join { groupId, withVideo? }
    // Сервер возвращает { callId, peers: [userId…] } — тех, кто уже внутри.
    // Плюс рассылает "groupcall:peer-joined" оставшимся участникам и
    // "groupcall:active" всем участникам группы (чтобы UI показал "звонок идёт").
    socket.on('groupcall:join', (payload, ack) => {
      const { groupId, withVideo } = payload || {};
      if (typeof groupId !== 'number') return ack?.({ error: 'bad groupId' });
      const isMember = !!db
        .prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?')
        .get(groupId, me.id);
      if (!isMember) return ack?.({ error: 'not a member' });

      const { call, created, alreadyIn, peers } = joinGroupCall({
        groupId,
        userId: me.id,
        socketId: socket.id,
        withVideo: !!withVideo,
      });
      // Привяжем сокет к комнате звонка.
      const callRoom = `groupcall:${groupId}`;
      socket.join(callRoom);

      // Уведомляем группу, что звонок активен (или только что стартовал).
      if (created) {
        io.to(groupRoomOf(groupId)).emit('groupcall:active', {
          groupId,
          callId: call.callId,
          startedBy: me.id,
          withVideo: call.withVideo,
          startedAt: call.startedAt,
        });
        // Системное сообщение в чате — «X начал(а) групповой звонок» с
        // payload.status='active'. Кнопка «Подключиться» в UI работает,
        // пока звонок активен. Привязываем messageId к звонку для апдейта.
        const sysMsg = insertGroupCallSystemMsg(groupId, me.id, call.callId, call.withVideo);
        attachGroupCallMessageId(groupId, sysMsg.id);

        // Web Push всем остальным участникам группы.
        const groupRow = db.prepare('SELECT name FROM groups WHERE id = ?').get(groupId);
        const otherIds = db
          .prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?')
          .all(groupId, me.id)
          .map((r) => r.user_id);
        if (otherIds.length) {
          pushToUsers(otherIds, {
            kind: 'groupcall',
            title: `${groupRow?.name || 'Группа'} — звонок`,
            body: `${me.username} начал(а) ${call.withVideo ? 'видеозвонок' : 'звонок'}`,
            tag: `groupcall:${groupId}`,
            url: `/?group=${groupId}`,
            requireInteraction: true,
            renotify: true,
          }).catch(() => {});
        }
      }
      // Уведомляем уже присутствующих, что пришёл новый пир.
      if (!alreadyIn) {
        socket.to(callRoom).emit('groupcall:peer-joined', {
          groupId,
          callId: call.callId,
          userId: me.id,
        });
      }

      ack?.({
        ok: true,
        callId: call.callId,
        peers, // массив userId, которые уже внутри (до нас)
        withVideo: call.withVideo,
        startedBy: call.startedBy,
      });
    });

    socket.on('groupcall:leave', (payload, ack) => {
      const { groupId } = payload || {};
      if (typeof groupId !== 'number') return ack?.({ error: 'bad groupId' });
      const prev = getGroupCall(groupId);
      const { call, userLeft, callEnded } = leaveGroupCall({
        groupId,
        userId: me.id,
        socketId: socket.id,
      });
      const callRoom = `groupcall:${groupId}`;
      socket.leave(callRoom);

      if (userLeft && prev) {
        io.to(callRoom).emit('groupcall:peer-left', {
          groupId,
          callId: prev.callId,
          userId: me.id,
        });
      }
      if (callEnded && prev) {
        io.to(groupRoomOf(groupId)).emit('groupcall:ended', {
          groupId,
          callId: prev.callId,
        });
        // Закрываем системное сообщение — кнопка «Подключиться» уйдёт.
        endGroupCallSystemMsg(groupId, prev.messageId);
      }
      ack?.({ ok: true });

      void call;
    });

    // Запрос списка активных групповых звонков (при коннекте — для UI-индикации).
    socket.on('groupcall:state', (payload, ack) => {
      const { groupId } = payload || {};
      if (typeof groupId !== 'number') return ack?.({ error: 'bad groupId' });
      const c = getGroupCall(groupId);
      if (!c) return ack?.({ active: false });
      ack?.({
        active: true,
        callId: c.callId,
        withVideo: c.withVideo,
        startedAt: c.startedAt,
        startedBy: c.startedBy,
        participants: [...c.participants.keys()],
      });
    });

    // --- Отключение ---------------------------------------------------------
    socket.on('disconnect', () => {
      // Если этот сокет был участником активного звонка — переводим в waiting (5мин)
      // или финализируем (если другой стороны нет).
      for (const [callId, pair] of sockets.entries()) {
        if (pair.caller !== socket.id && pair.callee !== socket.id) continue;
        const isCaller = pair.caller === socket.id;
        const otherSocketId = isCaller ? pair.callee : pair.caller;
        const c = getCall(callId);
        if (!c) {
          sockets.delete(callId);
          continue;
        }
        if (c.status === 'active' && otherSocketId) {
          // Обрыв связи в активном звонке — звонок закрываем сразу.
          // Раньше он уходил в waiting на 5 минут; теперь такого режима
          // нет, и «повисших» звонков после закрытия вкладки не остаётся.
          io.to(otherSocketId).emit('call:end', {
            from: me.id,
            fromUsername: me.username,
            callId,
            reason: 'peer-disconnected',
          });
          finalize(callId, c.startedAt ? 'completed' : 'cancelled');
        } else if (c.status === 'waiting') {
          // КРИТИЧЕСКИ ВАЖНО: не финализируем waiting-звонок и не шлём
          // повторный call:end. Иначе сценарий «пользователь A нажал F5»
          // ломал звонок целиком: сначала beforeunload каллбэк A слал
          // call:end (peer-leaving), сервер переводил звонок в waiting и
          // нотифицировал B → B входил в waiting. Затем сразу же
          // disconnect handler видел status='waiting' и попадал в
          // прежнюю else-ветку, которая делала finalize() и слала B
          // ВТОРОЙ call:end (peer-disconnected). У B onEnd с этим
          // reason'ом в state='waiting' (а не in-call/connecting) уходил
          // в cleanup → idle → пира тоже выкидывало из звонка.
          //
          // Здесь ровно ничего не делаем: либо пир уже знает (got
          // peer-leaving), либо это второй обрыв подряд, и состояние
          // waiting уже корректно стоит. 5-минутный pendingTimeout сам
          // финализирует звонок, если никто не вернётся.
        } else {
          // pending / уже ended / прочие промежутки — cleanup как раньше.
          finalize(callId, c.startedAt ? 'completed' : 'cancelled');
          if (otherSocketId) {
            io.to(otherSocketId).emit('call:end', {
              from: me.id,
              fromUsername: me.username,
              callId,
              reason: 'peer-disconnected',
            });
          }
        }
        // Чистим только наш слот в pair, чтобы вторая сторона осталась
        if (isCaller) pair.caller = null;
        else pair.callee = null;
        if (!pair.caller && !pair.callee) sockets.delete(callId);
      }

      // Выведем этот сокет из всех групповых звонков и разошлём peer-left / ended.
      const removals = forceLeaveAllGroupCalls(socket.id, me.id);
      for (const r of removals) {
        const callRoom = `groupcall:${r.groupId}`;
        if (r.userLeft) {
          io.to(callRoom).emit('groupcall:peer-left', {
            groupId: r.groupId,
            callId: r.callId,
            userId: me.id,
          });
        }
        if (r.callEnded) {
          io.to(groupRoomOf(r.groupId)).emit('groupcall:ended', {
            groupId: r.groupId,
            callId: r.callId,
          });
          endGroupCallSystemMsg(r.groupId, r.messageId);
        }
      }

      const wentOffline = removeUserSocket(me.id);
      if (wentOffline) broadcastPresence(io, me.id, { userId: me.id, online: false, away: false });
    });
  });

  return io;
}
