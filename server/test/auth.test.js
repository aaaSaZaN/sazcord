import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './appFactory.js';

let app;

beforeAll(() => {
  app = buildTestApp();
});

describe('auth', () => {
  it('register creates a user and returns token', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.username).toBe('alice');
    expect(res.body.user.hideOnDelete).toBe(false);
  });

  it('register rejects duplicate username', async () => {
    await request(app).post('/api/auth/register').send({ username: 'bob', password: 'secret123' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'bob', password: 'other123' });
    expect(res.status).toBe(409);
  });

  it('register rejects bad username/password', async () => {
    const a = await request(app)
      .post('/api/auth/register')
      .send({ username: 'no', password: 'secret123' });
    expect(a.status).toBe(400);
    const b = await request(app)
      .post('/api/auth/register')
      .send({ username: 'good_one', password: '12345' });
    expect(b.status).toBe(400);
  });

  it('login succeeds with correct password', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'carol', password: 'secret123' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'carol', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('login fails with bad password', async () => {
    await request(app).post('/api/auth/register').send({ username: 'dave', password: 'secret123' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'dave', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('me returns the user when authenticated', async () => {
    const r = await request(app)
      .post('/api/auth/register')
      .send({ username: 'eve', password: 'secret123' });
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${r.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('eve');
  });

  it('me requires auth', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });

  it('PATCH /api/me updates displayName and hideOnDelete', async () => {
    const r = await request(app)
      .post('/api/auth/register')
      .send({ username: 'frank', password: 'secret123' });
    const token = r.body.token;
    const upd = await request(app)
      .patch('/api/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'Frankie', hideOnDelete: true });
    expect(upd.status).toBe(200);
    expect(upd.body.user.displayName).toBe('Frankie');
    expect(upd.body.user.hideOnDelete).toBe(true);
  });
});
