import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './appFactory.js';
import db from '../src/db.js';

let app;

beforeAll(() => {
  app = buildTestApp();
});

async function register(username) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'secret123' });
  expect(res.status).toBe(200);
  return { token: res.body.token, user: res.body.user };
}

describe('users', () => {
  it('returns lastActivityAt for direct messages and calls', async () => {
    const suffix = Math.round(Math.random() * 100000).toString(36);
    const alice = await register(`ua_${suffix}`);
    const bob = await register(`ub_${suffix}`);
    const cara = await register(`uc_${suffix}`);

    const base = Date.now() - 10_000;
    const bobOld = base + 1000;
    const caraLast = base + 2000;
    const bobLast = base + 3000;

    db.prepare(
      `INSERT INTO messages (sender_id, receiver_id, content, created_at, kind)
       VALUES (?, ?, 'old dm', ?, 'text')`,
    ).run(bob.user.id, alice.user.id, bobOld);
    db.prepare(
      `INSERT INTO messages (sender_id, receiver_id, content, created_at, kind)
       VALUES (?, ?, 'unrelated dm', ?, 'text')`,
    ).run(cara.user.id, bob.user.id, base + 4000);
    db.prepare(
      `INSERT INTO messages (sender_id, receiver_id, content, created_at, kind)
       VALUES (?, ?, 'cara dm', ?, 'text')`,
    ).run(cara.user.id, alice.user.id, caraLast);
    db.prepare(
      `INSERT INTO messages (sender_id, receiver_id, content, created_at, kind)
       VALUES (?, ?, '', ?, 'call')`,
    ).run(alice.user.id, bob.user.id, bobLast);

    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(200);

    const bobRow = res.body.users.find((u) => u.id === bob.user.id);
    const caraRow = res.body.users.find((u) => u.id === cara.user.id);
    expect(bobRow.lastActivityAt).toBe(bobLast);
    expect(caraRow.lastActivityAt).toBe(caraLast);
  });
});
