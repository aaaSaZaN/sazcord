import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './appFactory.js';
import db from '../src/db.js';
import { socialMode } from '../src/social.js';

let app;
let ann;
let bob;
let eve;

beforeAll(async () => {
  app = buildTestApp();
  ann = await register('soc_ann');
  bob = await register('soc_bob');
  eve = await register('soc_eve');
});

afterAll(() => {
  delete process.env.SAZCORD_SOCIAL_MODE;
});

beforeEach(() => {
  // Каждый тест сам объявляет режим и стартует с чистым графом.
  delete process.env.SAZCORD_SOCIAL_MODE;
  db.prepare('DELETE FROM friendships').run();
});

async function register(username, password = 'secret123') {
  const r = await request(app).post('/api/auth/register').send({ username, password });
  expect(r.status).toBe(200);
  return { token: r.body.token, user: r.body.user };
}

const auth = (u) => ({ Authorization: `Bearer ${u.token}` });

function listUsers(u) {
  return request(app).get('/api/users').set(auth(u));
}

function seesIds(body) {
  return body.users.map((x) => x.id);
}

describe('social mode: local (default)', () => {
  it('shows everyone to everyone', async () => {
    const r = await listUsers(ann);
    expect(r.status).toBe(200);
    expect(seesIds(r.body)).toEqual(expect.arrayContaining([bob.user.id, eve.user.id]));
  });

  it('defaults to local when the variable is unset or malformed', () => {
    expect(socialMode()).toBe('local');
    process.env.SAZCORD_SOCIAL_MODE = 'nonsense';
    expect(socialMode()).toBe('local');
    process.env.SAZCORD_SOCIAL_MODE = ' PRIVATE ';
    expect(socialMode()).toBe('private');
    delete process.env.SAZCORD_SOCIAL_MODE;
  });

  it('refuses friend endpoints, so no dead UI appears', async () => {
    const r = await request(app).get('/api/friends').set(auth(ann));
    expect(r.status).toBe(409);
  });
});

describe('social mode: private', () => {
  beforeEach(() => {
    process.env.SAZCORD_SOCIAL_MODE = 'private';
  });

  it('hides everyone from a user with no connections', async () => {
    const r = await listUsers(ann);
    expect(r.status).toBe(200);
    expect(seesIds(r.body)).toEqual([ann.user.id]); // только себя
  });

  it('blocks a direct message to a stranger', async () => {
    const r = await request(app).get(`/api/messages/${bob.user.id}`).set(auth(ann));
    expect(r.status).toBe(403);
  });

  it('answers 404, not 403, for a stranger profile', async () => {
    // 403 подтвердил бы существование аккаунта и превратил эндпоинт в
    // оракул для перебора id.
    const r = await request(app).get(`/api/users/${bob.user.id}`).set(auth(ann));
    expect(r.status).toBe(404);
  });

  it('makes both sides visible once a request is accepted', async () => {
    const sent = await request(app)
      .post('/api/friends')
      .set(auth(ann))
      .send({ username: 'soc_bob' });
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe('pending_out');

    // До принятия — всё ещё не видно.
    expect(seesIds((await listUsers(ann)).body)).toEqual([ann.user.id]);

    const incoming = await request(app).get('/api/friends').set(auth(bob));
    expect(incoming.body.incoming.map((x) => x.id)).toEqual([ann.user.id]);

    const ok = await request(app).post(`/api/friends/${ann.user.id}/accept`).set(auth(bob));
    expect(ok.status).toBe(200);

    expect(seesIds((await listUsers(ann)).body)).toEqual(
      expect.arrayContaining([ann.user.id, bob.user.id]),
    );
    expect(seesIds((await listUsers(bob)).body)).toEqual(
      expect.arrayContaining([ann.user.id, bob.user.id]),
    );
    // Третий по-прежнему вне графа.
    expect(seesIds((await listUsers(ann)).body)).not.toContain(eve.user.id);
  });

  it('treats a counter-request as mutual consent', async () => {
    await request(app).post('/api/friends').set(auth(ann)).send({ username: 'soc_bob' });
    const back = await request(app)
      .post('/api/friends')
      .set(auth(bob))
      .send({ username: 'soc_ann' });
    expect(back.status).toBe(200);
    expect(back.body.status).toBe('friends');
  });

  it('rejects a duplicate request', async () => {
    await request(app).post('/api/friends').set(auth(ann)).send({ username: 'soc_bob' });
    const again = await request(app)
      .post('/api/friends')
      .set(auth(ann))
      .send({ username: 'soc_bob' });
    expect(again.status).toBe(409);
  });

  it('refuses a request to yourself', async () => {
    const r = await request(app).post('/api/friends').set(auth(ann)).send({ username: 'soc_ann' });
    expect(r.status).toBe(400);
  });

  it('answers 404 for an unknown username without leaking whether it exists', async () => {
    const r = await request(app)
      .post('/api/friends')
      .set(auth(ann))
      .send({ username: 'nobody_here' });
    expect(r.status).toBe(404);
  });

  it('lets only the addressee accept', async () => {
    await request(app).post('/api/friends').set(auth(ann)).send({ username: 'soc_bob' });
    // Отправитель не может «принять» собственную заявку.
    const r = await request(app).post(`/api/friends/${bob.user.id}/accept`).set(auth(ann));
    expect(r.status).toBe(404);
  });

  it('hides the peer again after unfriending', async () => {
    await request(app).post('/api/friends').set(auth(ann)).send({ username: 'soc_bob' });
    await request(app).post(`/api/friends/${ann.user.id}/accept`).set(auth(bob));
    expect(seesIds((await listUsers(ann)).body)).toContain(bob.user.id);

    const gone = await request(app).delete(`/api/friends/${bob.user.id}`).set(auth(ann));
    expect(gone.status).toBe(200);
    expect(seesIds((await listUsers(ann)).body)).not.toContain(bob.user.id);
  });

  it('grants visibility through a shared group, without any friendship', async () => {
    const g = await request(app)
      .post('/api/groups')
      .set(auth(ann))
      .send({ name: 'shared', memberIds: [eve.user.id] });
    expect(g.status).toBe(200);

    // Дружбы между ними нет, но общая группа даёт и видимость, и право
    // писать — это второе правило режима.
    expect(seesIds((await listUsers(ann)).body)).toContain(eve.user.id);
    const hist = await request(app).get(`/api/messages/${eve.user.id}`).set(auth(ann));
    expect(hist.status).toBe(200);

    // Уборка: группа влияет на остальные тесты в этом файле.
    await request(app).delete(`/api/groups/${g.body.group.id}`).set(auth(ann));
  });
});
