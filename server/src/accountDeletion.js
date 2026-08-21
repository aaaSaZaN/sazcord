import fs from 'node:fs';
import db from './db.js';
import { absolutePathFor } from './uploads.js';
import { finalize as finalizeCall, findActiveCallsForUser } from './callRegistry.js';
import { emitToUser, emitToGroup, disconnectUserSockets, leaveUserFromGroup } from './ioHub.js';

/**
 * Soft-delete пользователя: сохранить историю переписок (sender_id остаётся
 * валидным, FK не нарушаются), но:
 *   - запретить логин (deleted_at IS NOT NULL → 401);
 *   - убрать из всех групп (передать ownership при необходимости);
 *   - стереть аватар с диска;
 *   - удалить web push подписки и мьюты (его и на него);
 *   - финализировать активные 1:1 звонки;
 *   - принудительно разорвать все его сокет-соединения.
 *
 * Сообщения автора в БД остаются. Клиент при рендере должен подставить
 * «Удалённый пользователь» / дефолтный аватар (см. флаг `deleted` в API).
 *
 * Возвращает `{ ok: true }` или `{ ok: false, error }`.
 */
export function softDeleteUser(userId) {
  const user = db.prepare('SELECT id, avatar_path, deleted_at FROM users WHERE id = ?').get(userId);
  if (!user) return { ok: false, error: 'no such user' };
  if (user.deleted_at) return { ok: false, error: 'already deleted' };

  const now = Date.now();

  // 1. Снимаем юзера со всех групп. Если он owner — передаём ownership
  //    самому раннему вошедшему другому участнику; если других нет —
  //    группа удаляется (CASCADE снесёт group_members и messages).
  const memberships = db
    .prepare(
      `SELECT gm.group_id, g.owner_id
                FROM group_members gm
                JOIN groups g ON g.id = gm.group_id
               WHERE gm.user_id = ?`,
    )
    .all(userId);

  for (const m of memberships) {
    const groupId = m.group_id;
    if (m.owner_id === userId) {
      const heir = db
        .prepare(
          `SELECT user_id FROM group_members
                   WHERE group_id = ? AND user_id != ?
                   ORDER BY joined_at ASC LIMIT 1`,
        )
        .get(groupId, userId);
      if (heir) {
        db.prepare('UPDATE groups SET owner_id = ?, updated_at = ? WHERE id = ?').run(
          heir.user_id,
          now,
          groupId,
        );
        db.prepare(
          `UPDATE group_members SET role = 'owner'
                     WHERE group_id = ? AND user_id = ?`,
        ).run(groupId, heir.user_id);
        db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(
          groupId,
          userId,
        );
        // Сообщаем оставшимся участникам.
        emitToGroup(groupId, 'group:owner-changed', { groupId, ownerId: heir.user_id });
        emitToGroup(groupId, 'group:member-removed', { groupId, userId });
        try {
          leaveUserFromGroup(userId, groupId);
        } catch {
          /* */
        }
      } else {
        // Один в группе — удаляем целиком.
        db.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
        emitToGroup(groupId, 'group:deleted', { groupId });
      }
    } else {
      db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(
        groupId,
        userId,
      );
      emitToGroup(groupId, 'group:member-removed', { groupId, userId });
      try {
        leaveUserFromGroup(userId, groupId);
      } catch {
        /* */
      }
    }
  }

  // 2. Удалить аватар-файл (запись в users.avatar_path позже занулим).
  if (user.avatar_path) {
    const abs = absolutePathFor(user.avatar_path);
    if (abs)
      fs.promises.unlink(abs).catch(() => {
        /* */
      });
  }

  // 3. Подписки Web Push, мьюты (в обе стороны), invite_codes (created_by уже SET NULL).
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM mutes WHERE user_id = ? OR target_id = ?').run(userId, userId);

  // 4. Финализировать активные 1:1 звонки и уведомить второго участника.
  for (const c of findActiveCallsForUser(userId)) {
    const peerId = c.callerId === userId ? c.calleeId : c.callerId;
    finalizeCall(c.callId, c.status === 'active' ? 'completed' : 'cancelled');
    emitToUser(peerId, 'call:end', {
      callId: c.callId,
      from: userId,
      reason: 'peer-disconnected',
    });
  }
  // Групповые звонки: forceLeaveAll отрабатывает при дисконнекте сокетов
  // ниже — отдельно дёргать не нужно, см. socket.js disconnect-handler.

  // 5. Финальная запись в users — фиксируем удаление.
  //    password обнуляем спец-маркером, чтобы bcrypt.compare никогда не дал true.
  db.prepare(
    `
    UPDATE users
       SET deleted_at = ?,
           display_name = NULL,
           avatar_path = NULL,
           hide_on_delete = 0,
           password = ''
     WHERE id = ?
  `,
  ).run(now, userId);

  // 6. Разрываем все сокет-соединения юзера — текущие вкладки разлогинятся.
  try {
    disconnectUserSockets(userId, 'account-deleted');
  } catch {
    /* */
  }

  return { ok: true };
}
