import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { signToken } from '../auth.js';
import { isAdminUser } from '../admin.js';
import { consumeCode } from '../invites.js';
import { privacyConfig } from '../privacy.js';

import { MIN_PASSWORD_LENGTH } from '../config.js';
import { isPrivateMode } from '../social.js';
const router = Router();

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,24}$/;

// --- Контроль регистрации через переменные окружения ---------------------
//
// По умолчанию сервер ЗАКРЫТ. Раньше было наоборот: пустой .env означал
// «регистрируйся кто хочешь», и любой инстанс, поднятый по умолчанию,
// оказывался открытым для всего интернета — а типовой хозяин домашнего
// сервера про REGISTRATION_CODE не знает и не читает .env.example.
//
// Порядок такой:
//   1. Пока в базе нет ни одного пользователя, регистрация открыта —
//      ровно на один аккаунт. Первый зарегистрировавшийся получает id=1,
//      то есть становится админом (см. admin.js). Это «захват владельца»:
//      его нужно сделать сразу после установки, до того как адрес узнают
//      посторонние.
//   2. Дальше нужен инвайт: общий REGISTRATION_CODE из .env или
//      персональная ссылка, выпущенная из настроек («Приглашения»).
//   3. REGISTRATION_OPEN=1 — осознанно вернуть свободную регистрацию
//      для всех. Публичный инстанс, открытое сообщество — валидный
//      сценарий, но теперь это решение, а не случайность.
//   4. REGISTRATION_DISABLED=1 — закрыто наглухо, даже с кодом.
//
// REGISTRATION_CODE переиспользуемый: одного кода хватает на несколько
// новых аккаунтов из одной группы. Ротация — правка .env + рестарт.
function registrationDisabled() {
  const v = (process.env.REGISTRATION_DISABLED || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}
function registrationCode() {
  const v = (process.env.REGISTRATION_CODE || '').trim();
  return v || null;
}
function registrationOpen() {
  const v = (process.env.REGISTRATION_OPEN || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

// Инстанс ещё не «занят» — в базе нет ни одного аккаунта. Проверка
// дешёвая (LIMIT 1 по первичному ключу) и вызывается только на регистрации.
function noUsersYet() {
  return !db.prepare('SELECT 1 FROM users LIMIT 1').get();
}

// Помощник: есть ли активные коды в БД? Дёшево, чтобы не делать SELECT *.
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

// Нужен ли инвайт прямо сейчас. Единая точка правды и для формы
// регистрации, и для самого POST /register — иначе они рано или поздно
// разъедутся, и UI начнёт врать про то, что примет сервер.
//
// Порядок проверок важен: заданный код и живые приглашения сильнее, чем
// REGISTRATION_OPEN. Иначе выпущенная одноразовая ссылка молча перестала
// бы что-либо значить, а хозяин инстанса об этом бы не узнал.
function inviteRequiredNow() {
  if (registrationCode()) return true;
  if (hasActiveDbCodes()) return true;
  if (registrationOpen()) return false;
  // Пустой сервер: один аккаунт можно завести без ничего, он же владелец.
  if (noUsersYet()) return false;
  return true;
}

// Публичный endpoint, чтобы UI знал, что показывать на форме регистрации.
router.get('/registration-info', (_req, res) => {
  // inviteRequired = true, если задан общий ENV-код ИЛИ есть активные
  // одноразовые коды в БД. В обоих случаях форме нужно показать поле.
  const pc = privacyConfig();
  const bootstrap = !registrationDisabled() && noUsersYet() && !inviteRequiredNow();
  res.json({
    disabled: registrationDisabled(),
    inviteRequired: !registrationDisabled() && inviteRequiredNow(),
    // Первый аккаунт на пустом сервере: форма показывает, что он станет
    // владельцем, и не спрашивает код, которого ещё неоткуда взять.
    bootstrap,
    // Дублируем флаги политики из /api/config — на странице регистрации
    // нужны и они, чтобы не делать второй запрос. Если оператор не задан
    // в .env, requireConsent=false и фронт не показывает чекбокс.
    privacyEnabled: pc.enabled,
    requirePrivacyConsent: pc.requireConsent,
  });
});

// Обрезаем и нормализуем свободный текст из формы регистрации. Пустая
// строка превращается в null, чтобы в базе не было «пусто, но не NULL».
function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

router.post('/register', async (req, res) => {
  if (registrationDisabled()) {
    return res.status(403).json({ error: 'registration is disabled on this server' });
  }

  const { username, password, invite, privacyConsent, displayName, bio } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'username and password required' });
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'username must be 3-24 chars: letters, digits, _ . -' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: 'password must be at least 6 chars' });
  }

  // 152-ФЗ: если сервер настроен требовать согласие — клиент обязан
  // прислать `privacyConsent: true`. Без этого регистрация не пройдёт,
  // и факт согласия дальше пишется в users.privacy_consent_at для
  // последующего compliance-аудита.
  const pc = privacyConfig();
  if (pc.requireConsent && privacyConsent !== true) {
    return res.status(400).json({ error: 'privacy policy consent is required' });
  }

  // Проверка инвайт-кода. Алгоритм:
  //   1. Если клиент прислал invite — он ОБЯЗАН быть валидным
  //      (общий ENV-код или активная запись в invite_codes). Иначе 403.
  //      Это закрывает кейс «использовал код, потом он стал недействителен,
  //      продолжает регистрироваться без кода».
  //   2. Если invite не прислан — пускаем только когда инвайт не нужен:
  //      REGISTRATION_OPEN=1 или это самый первый аккаунт на сервере.
  const sharedCode = registrationCode();
  const provided = typeof invite === 'string' ? invite.trim() : '';
  const inviteNeeded = inviteRequiredNow();

  // Кто позвал. Остаётся null для общего ENV-кода: он ничей.
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
  // Если согласие требовалось и было получено — фиксируем timestamp.
  // Если модуль выключен или клиент не отправил флаг — оставляем NULL.
  const consentAt = pc.requireConsent && privacyConsent === true ? Date.now() : null;
  const info = db
    .prepare(
      `INSERT INTO users (username, password, privacy_consent_at, display_name, bio, invited_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(username, hash, consentAt, cleanText(displayName, 48), cleanText(bio, 300), inviterId);
  const newUserId = Number(info.lastInsertRowid);

  // В private-режиме новичок иначе не увидит вообще никого — включая того,
  // кто его позвал. Ссылка-приглашение и есть акт знакомства, так что
  // заводим дружбу сразу принятой, без формального обмена заявками.
  // В local-режиме дружбы ни на что не влияют, и трогать их незачем.
  if (inviterId && inviterId !== newUserId && isPrivateMode()) {
    try {
      db.prepare(
        `INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at)
         VALUES (?, ?, 'accepted', ?, ?)`,
      ).run(inviterId, newUserId, Date.now(), Date.now());
    } catch {
      // Уникальный индекс по паре: связь уже есть — это не ошибка.
    }
  }

  const full = db
    .prepare(
      `SELECT id, username, display_name, avatar_path, hide_on_delete, created_at
       FROM users WHERE id = ?`,
    )
    .get(newUserId);
  const user = publicUser(full);
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
      `SELECT id, username, password, display_name, avatar_path, hide_on_delete, created_at, deleted_at
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
