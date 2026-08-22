import db from './db.js';

// Кто считается админом:
//   1. Пользователи с флагом is_admin = 1 в базе данных (назначаются через Rescue CLI).
//   2. Либо пользователи из переменной окружения ADMIN_USERNAMES (CSV).
//
// ID 1 больше НЕ является автоматическим администратором по умолчанию.
function adminUsernamesFromEnv() {
  const raw = process.env.ADMIN_USERNAMES;
  if (!raw) return null;
  const list = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? new Set(list) : null;
}

export function isAdminUser(user) {
  if (!user) return false;
  const fromEnv = adminUsernamesFromEnv();
  if (fromEnv && fromEnv.has(String(user.username || '').toLowerCase())) {
    return true;
  }
  if (user.is_admin === 1 || user.is_admin === true || user.isAdmin === true) {
    return true;
  }
  if (user.id) {
    const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id);
    return !!row && row.is_admin === 1;
  }
  return false;
}

// Express middleware: пропускает только админов. Должен идти ПОСЛЕ authRequired.
export function adminRequired(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  const row = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(req.user.id);
  if (!row || !isAdminUser(row)) {
    return res.status(403).json({ error: 'admin only' });
  }
  next();
}
