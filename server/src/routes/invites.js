// Приглашения.
//
// Код существует в двух видах одновременно: строка, которую можно
// продиктовать голосом, и ссылка вида <origin>/invite/<code>, по которой
// человек попадает сразу на форму регистрации с уже подставленным кодом
// и подписью «тебя пригласил такой-то». Ссылка — просто удобная обёртка
// над тем же кодом, отдельной сущности в базе нет.
//
// Кто может выпускать — INVITE_WHO_CAN_CREATE:
//
//   admins (по умолчанию) — только администраторы.
//   members — любой зарегистрированный, но ТОЛЬКО одноразовые и с
//     ограниченным сроком. Смысл в цепочке доверия: на домашнем инстансе
//     админ зовёт друзей, друзья зовут своих, и админу не приходится
//     работать швейцаром. Многоразовые коды остаются за админом — такой
//     код, утёкший в публичный чат, открывает сервер всем подряд.

import { Router } from 'express';
import { authRequired } from '../auth.js';
import { isAdminUser } from '../admin.js';
import { listCodes, createCode, revokeCode, codeInfo, membersMayInvite } from '../invites.js';

const router = Router();

// Сколько дней живёт код, выпущенный обычным участником. Бессрочные
// приглашения от не-админов — это тихо накапливающийся список ключей,
// про которые все забыли.
const MEMBER_CODE_TTL_DAYS = 7;

// --- Публичная часть -------------------------------------------------------
// Без авторизации: страница приглашения открывается человеком, у которого
// аккаунта ещё нет. Отдаём только «код рабочий» и имя пригласившего.
router.get('/:code/info', (req, res) => {
  res.json(codeInfo(req.params.code));
});

// --- Всё остальное — только для вошедших ----------------------------------
router.use(authRequired);

// Не-админа сюда пускаем, только когда участникам вообще разрешено
// приглашать. При INVITE_WHO_CAN_CREATE=admins (по умолчанию) раздел
// приглашений для него не существует — как и было.
function mayInvite(req, res, next) {
  if (isAdminUser(req.user) || membersMayInvite()) return next();
  res.status(403).json({ error: 'only admins can manage invites here' });
}

router.get('/', mayInvite, (req, res) => {
  const admin = isAdminUser(req.user);
  const all = listCodes();
  // Обычный участник видит только свои коды: чужие приглашения — не его
  // дело, а список всех кодов сервера тем более.
  res.json({ codes: admin ? all : all.filter((c) => c.createdBy === req.user.id) });
});

router.post('/', mayInvite, (req, res) => {
  const admin = isAdminUser(req.user);

  const { note, maxUses, expiresAt, code } = req.body || {};

  // Участнику — жёсткая рамка: одноразовый, срок ограничен, свой текст
  // кода задать нельзя (иначе можно занять красивый или предсказуемый).
  const limits = admin
    ? { maxUses, expiresAt, code }
    : {
        maxUses: 1,
        expiresAt: Date.now() + MEMBER_CODE_TTL_DAYS * 24 * 60 * 60 * 1000,
        code: undefined,
      };

  try {
    const created = createCode({
      createdBy: req.user.id,
      note,
      ...limits,
    });
    res.json({ code: created });
  } catch (e) {
    if (String(e?.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'code already exists' });
    }
    throw e;
  }
});

router.delete('/:code', mayInvite, (req, res) => {
  const admin = isAdminUser(req.user);
  if (!admin) {
    // Отозвать можно только собственное приглашение.
    const mine = listCodes().some((c) => c.code === req.params.code && c.createdBy === req.user.id);
    if (!mine) return res.status(404).json({ error: 'not found or already revoked' });
  }
  const ok = revokeCode(req.params.code);
  if (!ok) return res.status(404).json({ error: 'not found or already revoked' });
  res.json({ ok: true });
});

export default router;
