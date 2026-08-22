import { Router } from 'express';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { isAdminUser } from '../admin.js';
import { uploadAvatar, publicPathFor, absolutePathFor, sniff } from '../uploads.js';
import { MIN_PASSWORD_LENGTH } from '../config.js';
import { quotaPrecheck } from '../quota.js';
import { emitToUser, emitToAll } from '../ioHub.js';
import { visibleUserIds, isPrivateMode } from '../social.js';
import { softDeleteUser } from '../accountDeletion.js';

const router = Router();

const DISPLAY_RE = /^[\p{L}\p{N}\p{M} _.-]{1,32}$/u;

function broadcastUserUpdate(userId, user) {
  if (isPrivateMode()) {
    const audience = visibleUserIds(userId);
    if (audience) {
      for (const uid of audience) {
        if (uid !== userId) emitToUser(uid, 'user:update', { user });
      }
    }
  } else {
    emitToAll('user:update', { user });
  }
}

function readUser(id) {
  const row = db
    .prepare(
      `SELECT id, username, display_name, avatar_path, hide_on_delete, is_admin, created_at
       FROM users WHERE id = ?`,
    )
    .get(id);
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    avatarPath: row.avatar_path || null,
    hideOnDelete: !!row.hide_on_delete,
    createdAt: row.created_at,
    isAdmin: isAdminUser(row),
  };
}

router.get('/', authRequired, (req, res) => {
  const user = readUser(req.user.id);
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json({ user });
});

router.patch('/', authRequired, (req, res) => {
  const body = req.body || {};
  const { displayName, hideOnDelete } = body;

  if ('displayName' in body) {
    if (displayName === null || displayName === '') {
      db.prepare('UPDATE users SET display_name = NULL WHERE id = ?').run(req.user.id);
    } else if (typeof displayName === 'string') {
      const trimmed = displayName.trim();
      if (!DISPLAY_RE.test(trimmed)) {
        return res
          .status(400)
          .json({ error: 'displayName must be 1–32 chars (letters, digits, spaces, _ . -)' });
      }
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(trimmed, req.user.id);
    } else {
      return res.status(400).json({ error: 'bad displayName' });
    }
  }

  if ('hideOnDelete' in body) {
    if (typeof hideOnDelete !== 'boolean') {
      return res.status(400).json({ error: 'bad hideOnDelete' });
    }
    db.prepare('UPDATE users SET hide_on_delete = ? WHERE id = ?').run(
      hideOnDelete ? 1 : 0,
      req.user.id,
    );
  }

  const user = readUser(req.user.id);
  emitToUser(req.user.id, 'profile:self', user);
  broadcastUserUpdate(req.user.id, user);
  res.json({ user });
});

router.post(
  '/avatar',
  authRequired,
  quotaPrecheck,
  uploadAvatar.single('avatar'),
  sniff('image'),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file' });

    // Удалить старый аватар с диска, если был
    const old = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(req.user.id);
    if (old?.avatar_path) {
      const abs = absolutePathFor(old.avatar_path);
      if (abs)
        fs.promises.unlink(abs).catch(() => {
          /* ignore */
        });
    }

    const pubPath = publicPathFor(req.file.path);
    db.prepare('UPDATE users SET avatar_path = ? WHERE id = ?').run(pubPath, req.user.id);

    const user = readUser(req.user.id);
    emitToUser(req.user.id, 'profile:self', user);
    broadcastUserUpdate(req.user.id, user);
    res.json({ user });
  },
);

// Смена собственного пароля. Требует подтверждения текущим паролем —
// чтобы захвативший открытую сессию злоумышленник не сменил пароль и
// не выкинул владельца из аккаунта (старые JWT при этом не отзываются,
// но окно компрометации хотя бы не увеличивается).
router.post('/password', authRequired, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'currentPassword and newPassword required' });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: 'password must be at least 6 chars' });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'new password must differ from the current one' });
  }
  const row = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const ok = await bcrypt.compare(currentPassword, row.password || '');
  if (!ok) return res.status(403).json({ error: 'wrong password' });
  const hash = await bcrypt.hash(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ ok: true });
});

// Удаление собственного аккаунта. Требует подтверждения паролем — это
// необратимо, лучше дважды переспросить. Сообщения и звонки в истории
// у других участников остаются (имя/аватар клиент заменит на «Удалённый
// пользователь»). Метод идемпотентен относительно повторного вызова —
// уже удалённый аккаунт не может авторизоваться, поэтому второго раза
// не будет.
router.delete('/', authRequired, async (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'password required' });
  }
  const row = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'not found' });

  const ok = await bcrypt.compare(password, row.password || '');
  if (!ok) return res.status(403).json({ error: 'wrong password' });

  const result = softDeleteUser(req.user.id);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

// Выгрузка данных пользователя в JSON.
router.get('/data-export', authRequired, (req, res) => {
  const uid = req.user.id;
  const user = db
    .prepare(
      `SELECT id, username, display_name, avatar_path, hide_on_delete,
              created_at, deleted_at
       FROM users WHERE id = ?`,
    )
    .get(uid);
  if (!user) return res.status(404).json({ error: 'not found' });

  const sent = db
    .prepare(
      `SELECT id, receiver_id, group_id, content, created_at, edited_at,
              deleted, kind, attachment_path, attachment_name,
              attachment_size, attachment_mime, duration_ms, payload
       FROM messages
       WHERE sender_id = ?
       ORDER BY created_at ASC`,
    )
    .all(uid);

  const groups = db
    .prepare(
      `SELECT g.id, g.name, g.created_at, gm.role, gm.joined_at
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = ?`,
    )
    .all(uid);

  const invites = db
    .prepare(
      `SELECT code, max_uses, uses_count, expires_at, revoked_at, created_at
       FROM invite_codes WHERE created_by = ?`,
    )
    .all(uid);

  const mutes = db.prepare(`SELECT target_id, created_at FROM mutes WHERE user_id = ?`).all(uid);

  const exportedAt = Date.now();
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="sazcord-data-${user.username}-${exportedAt}.json"`,
  );
  res.json({
    exportedAt,
    schemaVersion: 1,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      avatarPath: user.avatar_path,
      hideOnDelete: !!user.hide_on_delete,
      createdAt: user.created_at,
      deletedAt: user.deleted_at,
    },
    messages: sent,
    groups,
    invitesIssued: invites,
    mutes,
  });
});

router.delete('/avatar', authRequired, (req, res) => {
  const old = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(req.user.id);
  if (old?.avatar_path) {
    const abs = absolutePathFor(old.avatar_path);
    if (abs)
      fs.promises.unlink(abs).catch(() => {
        /* ignore */
      });
  }
  db.prepare('UPDATE users SET avatar_path = NULL WHERE id = ?').run(req.user.id);
  const user = readUser(req.user.id);
  emitToUser(req.user.id, 'profile:self', user);
  broadcastUserUpdate(req.user.id, user);
  res.json({ user });
});

export default router;
