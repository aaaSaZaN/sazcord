import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './appFactory.js';
import db from '../src/db.js';

let app;

beforeAll(() => {
  app = buildTestApp();
});

describe('registration and admin assignment', () => {
  it('allows user registration and assigns admin via is_admin column', async () => {
    const info = await request(app).get('/api/auth/registration-info');
    expect(info.body).toMatchObject({ disabled: false, inviteRequired: false });

    const owner = await request(app)
      .post('/api/auth/register')
      .send({ username: 'owner', password: 'secret123' });
    expect(owner.status).toBe(200);
    expect(owner.body.user.isAdmin).toBe(false);

    // Make admin explicitly
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(owner.body.user.id);

    const me = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${owner.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.isAdmin).toBe(true);
  });
});
