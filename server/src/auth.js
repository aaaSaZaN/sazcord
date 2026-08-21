import jwt from 'jsonwebtoken';
import db from './db.js';

const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';

// В production требуем явный сильный секрет в .env. Падать на старте
// безопаснее, чем тихо использовать публично известный fallback.
// В dev разрешаем удобный шаблон, но шумно предупреждаем разработчика.
function resolveSecret() {
  const v = process.env.JWT_SECRET;
  if (v && v.length >= 16) return v;
  if (isProd) {
    throw new Error(
      'JWT_SECRET is required in production (min 16 chars). ' +
        "Generate one e.g. with `node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"` " +
        'and put it into server/.env',
    );
  }

  console.warn(
    '[auth] JWT_SECRET not set — using insecure dev fallback. DO NOT USE IN PRODUCTION.',
  );
  return 'dev-insecure-secret-change-me';
}

const SECRET = resolveSecret();
// По умолчанию токены БЕССРОЧНЫЕ — UX-приоритет (десктоп-приложение
// не должно требовать повторного логина без причины). Безопасность
// держится на:
//   - Секрете JWT_SECRET (компрометация = ротация секрета = разлогин всех).
//   - authRequired() проверяет users.deleted_at → удалённый аккаунт
//     мгновенно теряет доступ даже с валидным токеном.
//   - Юзер может вручную выйти из аккаунта.
//
// Если хочется ограниченный TTL — задай JWT_TTL=14d (или 1h, 7d, 30m;
// формат jsonwebtoken). Любое из значений 'never' | 'none' | '0' | ''
// означает «без срока».
const RAW_TTL = (process.env.JWT_TTL || 'never').trim().toLowerCase();
const TOKEN_TTL = ['never', 'none', '0', ''].includes(RAW_TTL) ? null : RAW_TTL;

export function signToken(user) {
  const opts = TOKEN_TTL ? { expiresIn: TOKEN_TTL } : {};
  return jwt.sign({ id: user.id, username: user.username }, SECRET, opts);
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'unauthorized' });

  // Аккаунт мог быть удалён уже после выдачи JWT — токен ещё валиден,
  // но дальнейшие запросы должны блокироваться.
  const row = db.prepare('SELECT deleted_at FROM users WHERE id = ?').get(payload.id);
  if (!row || row.deleted_at) {
    return res.status(401).json({ error: 'account-deleted' });
  }

  req.user = payload;
  next();
}
