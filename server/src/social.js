// Кто кого видит.
//
// SAZCORD_SOCIAL_MODE=local (по умолчанию)
//   Все видят всех. Новый зарегистрировавшийся сразу появляется в списке
//   у каждого. Это исходное поведение Sazcord и правильный режим для
//   домашнего инстанса на несколько знакомых.
//
// SAZCORD_SOCIAL_MODE=private
//   Видно только тех, с кем есть связь: принятые друзья ЛИБО участие в
//   общей группе. Оба правила работают одновременно, объединением — как
//   в Discord, где список друзей и участники сервера дают видимость
//   независимо друг от друга. Новый пользователь не видит никого и не
//   виден никому, пока связь не появится.
//
// Что даёт видимость, то и даёт право на действие: личные сообщения,
// звонки, чтение истории. Отдельного «можно писать, но не видно» нет —
// такое состояние только путало бы.
//
// Режим — рантайм-настройка, не миграция: таблица friendships существует
// всегда, в режиме local просто не используется. Переключать туда-обратно
// можно рестартом, данные не теряются. Но при переходе local → private на
// живом инстансе дружб в базе ещё нет, и все разом потеряют контакты —
// для этого есть `npm run migrate:friends` (server/scripts/migrateFriends.js),
// который превращает существующие переписки во взаимные дружбы.

import db from './db.js';

export function socialMode() {
  const v = String(process.env.SAZCORD_SOCIAL_MODE || 'local')
    .trim()
    .toLowerCase();
  return v === 'private' ? 'private' : 'local';
}

export function isPrivateMode() {
  return socialMode() === 'private';
}

/**
 * Множество id, которые пользователь имеет право видеть.
 *
 * Возвращает null, если ограничений нет (режим local) — вызывающему это
 * означает «не фильтровать». Отдельное значение вместо множества со всеми
 * id базы: строить его на каждый запрос было бы бессмысленной работой.
 */
export function visibleUserIds(userId) {
  if (!isPrivateMode()) return null;

  const ids = new Set([userId]); // себя видно всегда

  const friends = db
    .prepare(
      `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS id
         FROM friendships
        WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`,
    )
    .all(userId, userId, userId);
  for (const r of friends) ids.add(r.id);

  const mates = db
    .prepare(
      `SELECT DISTINCT gm.user_id AS id
         FROM group_members gm
        WHERE gm.group_id IN (SELECT group_id FROM group_members WHERE user_id = ?)`,
    )
    .all(userId);
  for (const r of mates) ids.add(r.id);

  return ids;
}

/**
 * Может ли `me` писать/звонить/читать историю с `other`.
 *
 * Точечная проверка вместо visibleUserIds(): на горячем пути (каждое
 * сообщение, каждый звонок) дешевле два индексных EXISTS, чем сборка
 * всего множества контактов.
 */
export function canInteract(me, other) {
  if (!isPrivateMode()) return true;
  if (me === other) return true;

  const friend = db
    .prepare(
      `SELECT 1 FROM friendships
        WHERE status = 'accepted'
          AND ((requester_id = ? AND addressee_id = ?)
            OR (requester_id = ? AND addressee_id = ?))
        LIMIT 1`,
    )
    .get(me, other, other, me);
  if (friend) return true;

  const shared = db
    .prepare(
      `SELECT 1 FROM group_members a
         JOIN group_members b ON a.group_id = b.group_id
        WHERE a.user_id = ? AND b.user_id = ?
        LIMIT 1`,
    )
    .get(me, other);
  return !!shared;
}

/** Состояние дружбы глазами `me`. */
export function friendState(me, other) {
  const row = db
    .prepare(
      `SELECT requester_id, status FROM friendships
        WHERE (requester_id = ? AND addressee_id = ?)
           OR (requester_id = ? AND addressee_id = ?)
        LIMIT 1`,
    )
    .get(me, other, other, me);
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friends';
  return row.requester_id === me ? 'pending_out' : 'pending_in';
}

/**
 * Ограничить список пользователей теми, кого видно.
 *
 * Удалённые аккаунты пропускаем всегда: без них фронт не сможет
 * отрисовать авторов исторических сообщений, а публичные поля у них и
 * так занулены (см. publicUser в routes/users.js).
 */
export function filterVisible(rows, userId, idOf = (r) => r.id) {
  const allowed = visibleUserIds(userId);
  if (!allowed) return rows;
  return rows.filter((r) => allowed.has(idOf(r)) || r.deleted_at);
}
