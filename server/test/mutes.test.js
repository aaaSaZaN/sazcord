import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './appFactory.js';

let app;
let aliceToken;
let bobId;

beforeAll(async () => {
  app = buildTestApp();
  const a = await request(app)
    .post('/api/auth/register')
    .send({ username: 'alice_m', password: 'secret123' });
  aliceToken = a.body.token;
  const b = await request(app)
    .post('/api/auth/register')
    .send({ username: 'bob_m', password: 'secret123' });
  bobId = b.body.user.id;
});

describe('mutes', () => {
  it('list initially empty', async () => {
    const res = await request(app).get('/api/mutes').set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ids).toEqual([]);
  });

  it('add and remove a mute', async () => {
    const add = await request(app)
      .post(`/api/mutes/${bobId}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(add.status).toBe(200);
    expect(add.body.ids).toContain(bobId);

    const list = await request(app).get('/api/mutes').set('Authorization', `Bearer ${aliceToken}`);
    expect(list.body.ids).toContain(bobId);

    const del = await request(app)
      .delete(`/api/mutes/${bobId}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(del.status).toBe(200);
    expect(del.body.ids).not.toContain(bobId);
  });

  it('rejects muting yourself', async () => {
    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${aliceToken}`);
    const res = await request(app)
      .post(`/api/mutes/${me.body.user.id}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(400);
  });

  it('rejects muting an unknown user', async () => {
    const res = await request(app)
      .post('/api/mutes/999999')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(404);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/mutes');
    expect(res.status).toBe(401);
  });
});
