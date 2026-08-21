import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { adminRequired } from '../admin.js';
import { getOnlineUserIds } from '../presence.js';
import { softDeleteUser } from '../accountDeletion.js';
import { filterVisible, canInteract } from '../social.js';

const router = Router();

function publicUser(row, online) {
  const deleted = !!row.deleted_at;
  return {
    id: row.id,
    // Для удалённых имя не светим — клиент сам подставит «Удалённый
    // пользователь». Username тоже зануляем, чтобы он нигде случайно
    // не отрисовался.
    username: deleted ? null : row.username,
    displayName: deleted ? null : row.display_name || row.username,
    avatarPath: deleted ? null : row.avatar_path || null,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at ?? null,
    online: deleted ? false : online,
    deleted,
  };
}

router.get('/', authRequired, (req, res) => {
  // Возвращаем всех, включая удалённых, чтобы фронт смог отрисовать
  // авторов исторических сообщений и контакты из старых DM. У удалённых
  // публичные поля занулены, флаг `deleted: true` — клиент сам решит,
  // показывать в списке для звонков/писем или нет.
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_path, u.created_at, u.deleted_at,
              (
                SELECT MAX(m.created_at)
                FROM messages m
                WHERE m.group_id IS NULL
                  AND (
                    (m.sender_id = ? AND m.receiver_id = u.id)
                    OR (m.sender_id = u.id AND m.receiver_id = ?)
                  )
              ) AS last_activity_at
       FROM users u
       ORDER BY COALESCE(u.display_name, u.username) COLLATE NOCASE`,
    )
    .all(req.user.id, req.user.id);
  const online = getOnlineUserIds();
  // В private-режиме список сужается до друзей и соучастников групп.
  // Удалённые проходят фильтр всегда — иначе фронт не отрисует авторов
  // исторических сообщений (публичные поля у них и так занулены).
  const users = filterVisible(rows, req.user.id).map((u) => ({
    ...publicUser(u, online.has(u.id)),
    self: u.id === req.user.id,
  }));
  res.json({ users });
});

router.get('/:id', authRequired, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
  const row = db
    .prepare(
      `SELECT id, username, display_name, avatar_path, created_at, deleted_at
       FROM users WHERE id = ?`,
    )
    .get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  // Тот же 404, что и для несуществующего: иначе эндпоинт становится
  // оракулом «есть ли на сервере пользователь с таким id».
  if (!row.deleted_at && !canInteract(req.user.id, row.id)) {
    return res.status(404).json({ error: 'not found' });
  }
  const online = getOnlineUserIds();
  res.json({ user: publicUser(row, online.has(row.id)) });
});

// Админ может удалить чужой аккаунт (например, когда юзер потерял пароль
// и просит). Логика идентична самостоятельному удалению — те же чистки,
// тот же дисконнект сокетов. Самого себя через этот эндпоинт сносить
// нельзя: для своего аккаунта используется DELETE /api/me с пароль-
// подтверждением, чтобы случайно не выпилиться.
router.delete('/:id', authRequired, adminRequired, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
  if (id === req.user.id) {
    return res.status(400).json({ error: 'use DELETE /api/me to delete your own account' });
  }
  const result = softDeleteUser(id);
  if (!result.ok) {
    const status = result.error === 'no such user' ? 404 : 400;
    return res.status(status).json({ error: result.error });
  }
  res.json({ ok: true });
});

export default router;
