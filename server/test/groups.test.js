import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import db from '../src/db.js';
import { buildTestApp } from './appFactory.js';

let app;
const users = {};

async function registerUser(username) {
  const r = await request(app).post('/api/auth/register').send({ username, password: 'secret123' });
  return { token: r.body.token, id: r.body.user.id };
}

beforeAll(async () => {
  app = buildTestApp();
  users.alice = await registerUser('alice_grp');
  users.bob = await registerUser('bob_grp');
  users.carol = await registerUser('carol_grp');
  users.dave = await registerUser('dave_grp');
});

function auth(u) {
  return { Authorization: `Bearer ${u.token}` };
}

describe('groups CRUD', () => {
  it('creates a group with owner + two members', async () => {
    const res = await request(app)
      .post('/api/groups')
      .set(auth(users.alice))
      .send({ name: 'Team', memberIds: [users.bob.id, users.carol.id] });
    expect(res.status).toBe(200);
    const g = res.body.group;
    expect(g.name).toBe('Team');
    expect(g.ownerId).toBe(users.alice.id);
    const ids = g.members.map((m) => m.id).sort();
    expect(ids).toEqual([users.alice.id, users.bob.id, users.carol.id].sort());
    const owner = g.members.find((m) => m.id === users.alice.id);
    expect(owner.role).toBe('owner');
  });

  it('rejects creating a group without members', async () => {
    const res = await request(app)
      .post('/api/groups')
      .set(auth(users.alice))
      .send({ name: 'Solo', memberIds: [] });
    expect(res.status).toBe(400);
  });

  it('rejects creating a group with bad name', async () => {
    const res = await request(app)
      .post('/api/groups')
      .set(auth(users.alice))
      .send({ name: '   ', memberIds: [users.bob.id] });
    expect(res.status).toBe(400);
  });

  it('lists only groups where user is a member', async () => {
    const created = await request(app)
      .post('/api/groups')
      .set(auth(users.bob))
      .send({ name: 'Bobs', memberIds: [users.carol.id] });
    expect(created.status).toBe(200);
    const res = await request(app).get('/api/groups').set(auth(users.dave));
    expect(res.status).toBe(200);
    const names = res.body.groups.map((g) => g.name);
    expect(names).not.toContain('Bobs');
    expect(names).not.toContain('Team');
  });

  it('non-member is forbidden from fetching details', async () => {
    const c = await request(app)
      .post('/api/groups')
      .set(auth(users.alice))
      .send({ name: 'Closed', memberIds: [users.bob.id] });
    const gid = c.body.group.id;
    const res = await request(app).get(`/api/groups/${gid}`).set(auth(users.dave));
    expect(res.status).toBe(403);
  });

  it('owner can rename group, member cannot', async () => {
    const c = await request(app)
      .post('/api/groups')
      .set(auth(users.alice))
      .send({ name: 'Old', memberIds: [users.bob.id] });
    const gid = c.body.group.id;
    const bad = await request(app)
      .patch(`/api/groups/${gid}`)
      .set(auth(users.bob))
      .send({ name: 'Hacked' });
    expect(bad.status).toBe(403);
    const good = await request(app)
      .patch(`/api/groups/${gid}`)
      .set(auth(users.alice))
      .send({ name: 'New' });
    expect(good.status).toBe(200);
    expect(good.body.group.name).toBe('New');
  });

  it('owner can add members (up to limit)', async () => {
    const c = await request(app)
      .post('/api/groups')
      .set(auth(users.alice))
      .send({ name: 'Add', memberIds: [users.bob.id] });
    const gid = c.body.group.id;
    const res = await request(app)
      .post(`/api/groups/${gid}/members`)
      .set(auth(users.alice))
      .send({ memberIds: [users.carol.id, users.dave.id] });
    expect(res.status).toBe(200);
    const ids = res.body.group.members.map((m) => m.id).sort();
    expect(ids).toEqual([users.alice.id, users.bob.id, users.carol.id, users.dave.id].sort());
  });

  it('non-owner cannot add members', async () => {
    const c = await request(app)
      .post('/api/groups')
      .set(auth(users.alice))
      .send({ name: 'NoAdd', memberIds: [users.bob.id] });
    const gid = c.body.group.id;
    const res = await request(app)
      .post(`/api/groups/${gid}/members`)
      .set(auth(users.bob))
      .send({ memberIds: [users.carol.id] });
    expect(res.status).toBe(403);
  });

  it('member can leave (DELETE self)', async () => {
    const c = await request(app)
      .post('/api/groups')
      .set(auth(users.alice))
      .send({ name: 'Leave', memberIds: [users.bob.id, users.carol.id] });
    const gid = c.body.group.id;
    const res = await request(app)
      .delete(`/api/groups/${gid}/members/${users.bob.id}`)
      .set(auth(users.bob));
    expect(res.status).toBe(200);
    const list = await request(app).get(`/api/groups/${gid}`).set(auth(users.alice));
    const ids = list.body.group.members.map((m) => m.id);
    expect(ids).not.toContain(users.bob.id);
  });

  it('owner cannot be kicked', async () => {
    const c = await request(app)
      .post('/api/groups')
      .set(auth(users.alice))
      .send({ name: 'KickOwner', memberIds: [users.bob.id] });
    const gid = c.body.group.id;
    const res = await request(app)
      .delete(`/api/groups/${gid}/members/${users.alice.id}`)
      .set(auth(users.alice));
    expect(res.status).toBe(400);
  });

  it('owner can delete group; other members lose access', async () => {
    const c = await request(app)
      .post('/api/groups')
      .set(auth(users.alice))
      .send({ name: 'ToDelete', memberIds: [users.bob.id] });
    const gid = c.body.group.id;
    const del = await request(app).delete(`/api/groups/${gid}`).set(auth(users.alice));
    expect(del.status).toBe(200);
    const res = await request(app).get(`/api/groups/${gid}`).set(auth(users.bob));
    expect(res.status).toBe(404);
  });
});

describe('group messages', () => {
  let gid;
  beforeAll(async () => {
    const c = await request(app)
      .post('/api/groups')
      .set(auth(users.alice))
      .send({ name: 'Chat', memberIds: [users.bob.id] });
    gid = c.body.group.id;
  });

  it('member can post text message', async () => {
    const res = await request(app)
      .post(`/api/groups/${gid}/messages/text`)
      .set(auth(users.alice))
      .send({ content: 'hello group' });
    expect(res.status).toBe(200);
    expect(res.body.message.content).toBe('hello group');
    expect(res.body.message.groupId).toBe(gid);
    expect(res.body.message.receiverId).toBeNull();
  });

  it('non-member cannot post or read history', async () => {
    const post = await request(app)
      .post(`/api/groups/${gid}/messages/text`)
      .set(auth(users.carol))
      .send({ content: 'sneak' });
    expect(post.status).toBe(403);
    const hist = await request(app).get(`/api/groups/${gid}/messages`).set(auth(users.carol));
    expect(hist.status).toBe(403);
  });

  it('GET messages returns all messages for group', async () => {
    const res = await request(app).get(`/api/groups/${gid}/messages`).set(auth(users.bob));
    expect(res.status).toBe(200);
    expect(res.body.messages.some((m) => m.content === 'hello group')).toBe(true);
  });

  it('owner (sender) can edit own group message', async () => {
    const sent = await request(app)
      .post(`/api/groups/${gid}/messages/text`)
      .set(auth(users.alice))
      .send({ content: 'typo' });
    const id = sent.body.message.id;
    const res = await request(app)
      .patch(`/api/messages/${id}`)
      .set(auth(users.alice))
      .send({ content: 'fixed' });
    expect(res.status).toBe(200);
    expect(res.body.message.content).toBe('fixed');
    expect(res.body.message.groupId).toBe(gid);
  });

  it('non-author cannot edit group message', async () => {
    const sent = await request(app)
      .post(`/api/groups/${gid}/messages/text`)
      .set(auth(users.alice))
      .send({ content: 'mine' });
    const id = sent.body.message.id;
    const res = await request(app)
      .patch(`/api/messages/${id}`)
      .set(auth(users.bob))
      .send({ content: 'stolen' });
    expect(res.status).toBe(403);
  });

  it('enforces group_id persists to DB', () => {
    const row = db
      .prepare('SELECT group_id FROM messages WHERE group_id = ? ORDER BY id DESC LIMIT 1')
      .get(gid);
    expect(row.group_id).toBe(gid);
  });
});
