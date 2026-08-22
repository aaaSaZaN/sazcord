import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { signToken } from '../auth.js';
import { isAdminUser } from '../admin.js';
import { consumeCode } from '../invites.js';
import { emitToAll, emitToUser } from '../ioHub.js';
import { MIN_PASSWORD_LENGTH } from '../config.js';
import { isPrivateMode } from '../social.js';

const router = Router();

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,24}$/;

function registrationDisabled() {
  const v = (process.env.REGISTRATION_DISABLED || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function registrationCode() {
  const v = (process.env.REGISTRATION_CODE || '').trim();
  return v || null;
}

function registrationInviteOnly() {
  const v = (process.env.REGISTRATION_OPEN || '').toLowerCase();
  if (v === '0' || v === 'false' || v === 'no') return true;
  const inv = (process.env.REGISTRATION_INVITE_ONLY || '').toLowerCase();
  return inv === '1' || inv === 'true' || inv === 'yes';
}

function hasActiveDbCodes() {
  const row = db
    .prepare(
      `
      SELECT 1 FROM invite_codes
       WHERE revoked_at IS NULL
         AND (max_uses IS NULL OR uses_count < max_uses)
         AND (expires_at IS NULL OR expires_at > ?)
       LIMIT 1
    `,
    )
    .get(Date.now());
  return !!row;
}

function inviteRequiredNow() {
  if (registrationCode()) return true;
  if (registrationInviteOnly()) return true;
  return false;
}

// Публичный endpoint, чтобы UI знал, что показывать на форме регистрации.
router.get('/registration-info', (_req, res) => {
  res.json({
    disabled: registrationDisabled(),
    inviteRequired: !registrationDisabled() && inviteRequiredNow(),
    bootstrap: false,
  });
});

function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

router.post('/register', async (req, res) => {
  if (registrationDisabled()) {
    return res.status(403).json({ error: 'registration is disabled on this server' });
  }

  const { username, password, invite, displayName, bio } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'username and password required' });
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'username must be 3-24 chars: letters, digits, _ . -' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: 'password must be at least 6 chars' });
  }

  const sharedCode = registrationCode();
  const provided = typeof invite === 'string' ? invite.trim() : '';
  const inviteNeeded = inviteRequiredNow();

  let inviterId = null;
  if (provided) {
    let accepted = false;
    if (sharedCode && provided === sharedCode) accepted = true;
    if (!accepted) {
      const r = consumeCode(provided);
      if (r.ok) {
        accepted = true;
        inviterId = r.createdBy || null;
      }
    }
    if (!accepted) {
      return res.status(403).json({ error: 'invalid invite code' });
    }
  } else if (inviteNeeded) {
    return res.status(400).json({ error: 'invite code required' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'username already taken' });

  const hash = await bcrypt.hash(password, 10);
  const info = db
    .prepare(
      `INSERT INTO users (username, password, display_name, bio, invited_by, is_admin)
       VALUES (?, ?, ?, ?, ?, 0)`,
    )
    .run(username, hash, cleanText(displayName, 48), cleanText(bio, 300), inviterId);
  const newUserId = Number(info.lastInsertRowid);

  if (inviterId && inviterId !== newUserId && isPrivateMode()) {
    try {
      db.prepare(
        `INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at)
         VALUES (?, ?, 'accepted', ?, ?)`,
      ).run(inviterId, newUserId, Date.now(), Date.now());
    } catch {
      // ignore
    }
  }

  const full = db
    .prepare(
      `SELECT id, username, display_name, avatar_path, hide_on_delete, is_admin, created_at
       FROM users WHERE id = ?`,
    )
    .get(newUserId);
  const user = publicUser(full);

  // Оповещаем онлайн-пользователей о новом пользователе
  if (isPrivateMode()) {
    if (inviterId) {
      emitToUser(inviterId, 'user:joined', { user });
      emitToUser(inviterId, 'users:update', { user });
      emitToUser(inviterId, 'friends:update', {});
    }
  } else {
    emitToAll('user:joined', { user });
  }

  const token = signToken({ id: user.id, username: user.username });
  res.json({ token, user });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'username and password required' });
  }
  const row = db
    .prepare(
      `SELECT id, username, password, display_name, avatar_path, hide_on_delete, is_admin, created_at, deleted_at
       FROM users WHERE username = ?`,
    )
    .get(username);
  if (!row) return res.status(401).json({ error: 'invalid credentials' });
  if (row.deleted_at) return res.status(401).json({ error: 'invalid credentials' });
  const ok = await bcrypt.compare(password, row.password || '');
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  const user = publicUser(row);
  const token = signToken({ id: user.id, username: user.username });
  res.json({ token, user });
});

function publicUser(row) {
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

export default router;
