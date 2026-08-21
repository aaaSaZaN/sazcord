import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './appFactory.js';
import db from '../src/db.js';

let app;

beforeAll(() => {
  app = buildTestApp();
});

async function register(username, password = 'secret123') {
  const r = await request(app).post('/api/auth/register').send({ username, password });
  expect(r.status).toBe(200);
  return { token: r.body.token, user: r.body.user };
}

describe('account deletion', () => {
  it('refuses without password', async () => {
    const { token } = await register('del_no_pass');
    const res = await request(app)
      .delete('/api/me')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('refuses with wrong password', async () => {
    const { token } = await register('del_wrong_pass');
    const res = await request(app)
      .delete('/api/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'nope' });
    expect(res.status).toBe(403);
  });

  it('soft-deletes user, blocks login and authed routes', async () => {
    const { token, user } = await register('del_happy');
    const res = await request(app)
      .delete('/api/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'secret123' });
    expect(res.status).toBe(200);

    // deleted_at теперь стоит.
    const row = db
      .prepare('SELECT deleted_at, display_name, avatar_path FROM users WHERE id = ?')
      .get(user.id);
    expect(row.deleted_at).toBeTruthy();
    expect(row.display_name).toBeNull();
    expect(row.avatar_path).toBeNull();

    // Токен больше не работает.
    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(401);

    // Логин прежним паролем отклонён.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'del_happy', password: 'secret123' });
    expect(login.status).toBe(401);
  });

  it('messages survive deletion; peer sees author as deleted', async () => {
    const alice = await register('del_alice');
    const bob = await register('del_bob');

    // alice пишет bob'у через прямую запись в БД — REST для текстовых
    // сообщений идёт через socket, поэтому проще вставить через db.
    const now = Date.now();
    const info = db
      .prepare(
        `INSERT INTO messages (sender_id, receiver_id, content, created_at, kind)
       VALUES (?, ?, 'hello', ?, 'text')`,
      )
      .run(alice.user.id, bob.user.id, now);

    // alice удаляет аккаунт.
    const del = await request(app)
      .delete('/api/me')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ password: 'secret123' });
    expect(del.status).toBe(200);

    // Сообщение осталось.
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
    expect(msg).toBeTruthy();
    expect(msg.content).toBe('hello');
    expect(msg.sender_id).toBe(alice.user.id);

    // bob запрашивает историю — сообщение всё ещё там.
    const history = await request(app)
      .get(`/api/messages/${alice.user.id}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(history.status).toBe(200);
    expect(history.body.messages.find((m) => m.id === info.lastInsertRowid)).toBeTruthy();

    // Запрос профиля удалённого юзера отдаёт deleted=true без имени.
    const profile = await request(app)
      .get(`/api/users/${alice.user.id}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(profile.status).toBe(200);
    expect(profile.body.user.deleted).toBe(true);
    expect(profile.body.user.displayName).toBeNull();
    expect(profile.body.user.avatarPath).toBeNull();
  });

  it('transfers group ownership when owner deletes account', async () => {
    const owner = await register('del_owner');
    const heir = await register('del_heir');

    const gr = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'my group', memberIds: [heir.user.id] });
    expect(gr.status).toBe(200);
    const groupId = gr.body.group.id;

    const del = await request(app)
      .delete('/api/me')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ password: 'secret123' });
    expect(del.status).toBe(200);

    // Группа жива, owner переехал на heir, прежний владелец — не member.
    const row = db.prepare('SELECT owner_id FROM groups WHERE id = ?').get(groupId);
    expect(row.owner_id).toBe(heir.user.id);

    const members = db
      .prepare('SELECT user_id, role FROM group_members WHERE group_id = ? ORDER BY user_id')
      .all(groupId);
    expect(members.some((m) => m.user_id === owner.user.id)).toBe(false);
    const heirRow = members.find((m) => m.user_id === heir.user.id);
    expect(heirRow?.role).toBe('owner');
  });

  it('deletes group when owner has no other members', async () => {
    const solo = await register('del_solo');

    // API не даёт создать группу с одним участником (нужно ≥1 «другого»).
    // Симулируем кейс «все остальные вышли»: вставляем группу руками.
    const now = Date.now();
    const info = db
      .prepare('INSERT INTO groups (name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('solo', solo.user.id, now, now);
    const groupId = info.lastInsertRowid;
    db.prepare(
      `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)`,
    ).run(groupId, solo.user.id, now);

    const del = await request(app)
      .delete('/api/me')
      .set('Authorization', `Bearer ${solo.token}`)
      .send({ password: 'secret123' });
    expect(del.status).toBe(200);

    const row = db.prepare('SELECT id FROM groups WHERE id = ?').get(groupId);
    expect(row).toBeUndefined();
  });

  it('admin can delete another user; non-admin gets 403; cannot delete self via admin route', async () => {
    // Явно фиксируем админа через env — чтобы не зависеть от того, кто
    // оказался id=1 в этом тестовом процессе. ADMIN_USERNAMES читается
    // динамически в admin.js, поэтому переопределение здесь работает.
    const prevAdmins = process.env.ADMIN_USERNAMES;
    process.env.ADMIN_USERNAMES = 'admin_root';
    try {
      const admin = await register('admin_root');
      const victim = await register('admin_victim');
      const stranger = await register('admin_stranger');

      // Не-админ не может удалить чужого.
      const forbidden = await request(app)
        .delete(`/api/users/${victim.user.id}`)
        .set('Authorization', `Bearer ${stranger.token}`);
      expect(forbidden.status).toBe(403);

      // Админ может.
      const ok = await request(app)
        .delete(`/api/users/${victim.user.id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(ok.status).toBe(200);

      const row = db.prepare('SELECT deleted_at FROM users WHERE id = ?').get(victim.user.id);
      expect(row.deleted_at).toBeTruthy();

      // Себя через admin-route — нельзя, отдельный код 400.
      const self = await request(app)
        .delete(`/api/users/${admin.user.id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(self.status).toBe(400);
    } finally {
      if (prevAdmins === undefined) delete process.env.ADMIN_USERNAMES;
      else process.env.ADMIN_USERNAMES = prevAdmins;
    }
  });

  it('users list hides deleted accounts but /:id still serves them', async () => {
    const a = await register('list_a');
    const b = await register('list_b');

    await request(app)
      .delete('/api/me')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ password: 'secret123' });

    const list = await request(app).get('/api/users').set('Authorization', `Bearer ${b.token}`);
    expect(list.status).toBe(200);
    // В общем списке удалённые с deleted=true; клиент сам их отфильтрует
    // для UI, а API отдаёт всё для рендера истории.
    const rec = list.body.users.find((u) => u.id === a.user.id);
    expect(rec).toBeTruthy();
    expect(rec.deleted).toBe(true);
    expect(rec.username).toBeNull();
  });
});
