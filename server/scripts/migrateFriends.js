#!/usr/bin/env node
//
// Превратить существующие переписки во взаимные дружбы.
//
// Нужен ровно один раз — при переключении живого инстанса с
// SAZCORD_SOCIAL_MODE=local на private. В local-режиме дружб не
// существует как понятия, поэтому таблица friendships пуста; включив
// private без миграции, все разом обнаружат пустой список контактов и
// недоступную историю переписки, хотя данные никуда не делись.
//
// Что считается основанием для дружбы: хотя бы одно личное сообщение
// между двумя аккаунтами в любую сторону. Групповые сообщения не в счёт —
// общая группа и так даёт видимость (см. src/social.js), заводить из-за
// неё ещё и дружбу незачем.
//
// Запуск:
//   npm run migrate:friends            # показать, что будет сделано
//   npm run migrate:friends -- --apply # записать
//
// По умолчанию — сухой прогон: скрипт правит боевую базу, и «случайно
// запустил не глядя» не должно ничего менять.

import db from '../src/db.js';

const apply = process.argv.includes('--apply');

// Пары, между которыми была личная переписка. Нормализуем порядок через
// MIN/MAX, иначе A→B и B→A дадут две разные пары.
const pairs = db
  .prepare(
    `SELECT DISTINCT
            MIN(sender_id, receiver_id) AS a,
            MAX(sender_id, receiver_id) AS b
       FROM messages
      WHERE receiver_id IS NOT NULL
        AND group_id IS NULL
        AND sender_id <> receiver_id`,
  )
  .all();

// Уже существующие связи (на случай повторного запуска или частично
// заполненной таблицы) — их пропускаем, а не пытаемся вставить поверх.
const known = new Set(
  db
    .prepare(
      `SELECT MIN(requester_id, addressee_id) AS a, MAX(requester_id, addressee_id) AS b
         FROM friendships`,
    )
    .all()
    .map((r) => `${r.a}:${r.b}`),
);

// Удалённые аккаунты не оживляем: дружба с ними ничего не даст, а в
// списке контактов они и так отображаются особым образом.
const alive = new Set(
  db
    .prepare('SELECT id FROM users WHERE deleted_at IS NULL')
    .all()
    .map((r) => r.id),
);

const todo = pairs.filter((p) => alive.has(p.a) && alive.has(p.b) && !known.has(`${p.a}:${p.b}`));

console.log(`пар с личной перепиской: ${pairs.length}`);
console.log(`уже есть связей:         ${known.size}`);
console.log(`будет создано дружб:     ${todo.length}`);

if (!todo.length) {
  console.log('нечего делать');
  process.exit(0);
}

if (!apply) {
  console.log('\nсухой прогон, ничего не записано. Повтори с --apply.');
  process.exit(0);
}

const now = Date.now();
const insert = db.prepare(
  `INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at)
   VALUES (?, ?, 'accepted', ?, ?)`,
);
const tx = db.transaction((rows) => {
  for (const p of rows) insert.run(p.a, p.b, now, now);
});
tx(todo);

console.log(`\nготово: создано ${todo.length} дружб.`);
console.log('Теперь можно выставить SAZCORD_SOCIAL_MODE=private и перезапустить сервер.');
