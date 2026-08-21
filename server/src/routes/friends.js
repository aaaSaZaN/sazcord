// Заявки в друзья. Имеют смысл только при SAZCORD_SOCIAL_MODE=private —
// в режиме local все и так видят всех, и роуты отвечают 409, чтобы клиент
// не рисовал бесполезный UI.
//
// Адресация по id ДРУГОГО пользователя, а не по id строки в friendships:
// клиент всегда знает, с кем имеет дело, и ему не приходится держать у
// себя идентификаторы связей.

import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { getOnlineUserIds } from '../presence.js';
import { isPrivateMode, friendState } from '../social.js';
import { emitToUser } from '../ioHub.js';

const router = Router();

function publicUser(row, online) {
  const deleted = !!row.deleted_at;
  return {
    id: row.id,
    username: deleted ? null : row.username,
    displayName: deleted ? null : row.display_name || row.username,
    avatarPath: deleted ? null : row.avatar_path || null,
    online: deleted ? false : online,
    deleted,
  };
}

// Общий предохранитель: в local-режиме дружб не существует как понятия.
function privateOnly(_req, res, next) {
  if (!isPrivateMode()) {
    return res.status(409).json({ error: 'friends are disabled in local mode' });
  }
  next();
}

const USER_COLS = 'u.id, u.username, u.display_name, u.avatar_path, u.deleted_at';

router.get('/', authRequired, privateOnly, (req, res) => {
  const me = req.user.id;
  const online = getOnlineUserIds();

  const rows = db
    .prepare(
      `SELECT ${USER_COLS}, f.status, f.requester_id, f.created_at
         FROM friendships f
         JOIN users u
           ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
        WHERE f.requester_id = ? OR f.addressee_id = ?
        ORDER BY COALESCE(u.display_name, u.username) COLLATE NOCASE`,
    )
    .all(me, me, me);

  const friends = [];
  const incoming = [];
  const outgoing = [];
  for (const r of rows) {
    const entry = { ...publicUser(r, online.has(r.id)), since: r.created_at };
    if (r.status === 'accepted') friends.push(entry);
    else if (r.requester_id === me) outgoing.push(entry);
    else incoming.push(entry);
  }

  res.json({ friends, incoming, outgoing });
});

// Отправить заявку. Ищем по ТОЧНОМУ username: перебирать базу подстрокой
// в приватном режиме нельзя — это свело бы весь режим на нет.
router.post('/', authRequired, privateOnly, (req, res) => {
  const me = req.user.id;
  const username = String(req.body?.username || '').trim();
  if (!username) return res.status(400).json({ error: 'username required' });

  const target = db
    .prepare(`SELECT id, deleted_at FROM users WHERE username = ? COLLATE NOCASE`)
    .get(username);
  // Одинаковый ответ для «нет такого» и «аккаунт удалён»: иначе эндпоинт
  // превращается в оракул для перебора имён.
  if (!target || target.deleted_at) return res.status(404).json({ error: 'no such user' });
  if (target.id === me) return res.status(400).json({ error: 'cannot add yourself' });

  const state = friendState(me, target.id);
  if (state === 'friends') return res.status(409).json({ error: 'already friends' });
  if (state === 'pending_out') return res.status(409).json({ error: 'request already sent' });
  // Встречная заявка = обоюдное согласие. Заставлять второго ещё раз
  // жать «принять» было бы бессмысленной формальностью.
  if (state === 'pending_in') {
    db.prepare(
      `UPDATE friendships SET status = 'accepted', responded_at = ?
        WHERE requester_id = ? AND addressee_id = ?`,
    ).run(Date.now(), target.id, me);
    notifyBoth(me, target.id);
    return res.json({ ok: true, status: 'friends' });
  }

  db.prepare(
    `INSERT INTO friendships (requester_id, addressee_id, status, created_at)
     VALUES (?, ?, 'pending', ?)`,
  ).run(me, target.id, Date.now());
  notifyBoth(me, target.id);
  res.json({ ok: true, status: 'pending_out' });
});

router.post('/:id/accept', authRequired, privateOnly, (req, res) => {
  const me = req.user.id;
  const other = Number(req.params.id);
  if (!Number.isInteger(other)) return res.status(400).json({ error: 'bad id' });

  // Принять можно только ВХОДЯЩУЮ заявку — отсюда жёсткое условие на
  // requester_id, иначе отправитель мог бы «принять» свою собственную.
  const info = db
    .prepare(
      `UPDATE friendships SET status = 'accepted', responded_at = ?
        WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`,
    )
    .run(Date.now(), other, me);
  if (!info.changes) return res.status(404).json({ error: 'no pending request' });

  notifyBoth(me, other);
  res.json({ ok: true });
});

// Отклонить входящую, отменить исходящую или удалить из друзей — одно и
// то же действие над строкой связи, разница только в её прежнем статусе.
router.delete('/:id', authRequired, privateOnly, (req, res) => {
  const me = req.user.id;
  const other = Number(req.params.id);
  if (!Number.isInteger(other)) return res.status(400).json({ error: 'bad id' });

  const info = db
    .prepare(
      `DELETE FROM friendships
        WHERE (requester_id = ? AND addressee_id = ?)
           OR (requester_id = ? AND addressee_id = ?)`,
    )
    .run(me, other, other, me);
  if (!info.changes) return res.status(404).json({ error: 'not found' });

  notifyBoth(me, other);
  res.json({ ok: true });
});

// Обеим сторонам говорим «перечитай список». Присылать дельту не стоит:
// у каждой стороны своя проекция (входящая/исходящая), и собрать её
// правильно проще на сервере при следующем GET.
function notifyBoth(a, b) {
  emitToUser(a, 'friends:update', {});
  emitToUser(b, 'friends:update', {});
}

export default router;
