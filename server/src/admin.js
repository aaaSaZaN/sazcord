import db from './db.js';

// Кто считается админом:
//   1. Если задан env ADMIN_USERNAMES (CSV) — только эти пользователи.
//   2. Иначе админом считается пользователь с id=1 (первый созданный).
//      Это «root by convention» — удобно для маленьких инсталляций.
//
// Username сравнивается без учёта регистра (как и в БД).
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
  if (fromEnv) {
    return fromEnv.has(String(user.username || '').toLowerCase());
  }
  return Number(user.id) === 1;
}

// Express middleware: пропускает только админов. Должен идти ПОСЛЕ authRequired.
export function adminRequired(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  // req.user.username приходит из JWT. Но юзер мог быть переименован через
  // PATCH /api/me (display_name), username в users неизменяем — так что JWT
  // достаточно. На всякий случай подтянем строку из БД.
  const row = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.user.id);
  if (!row || !isAdminUser(row)) {
    return res.status(403).json({ error: 'admin only' });
  }
  next();
}
