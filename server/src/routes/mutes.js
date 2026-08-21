import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { emitToUser } from '../ioHub.js';

const router = Router();

function listMutedIds(userId) {
  return db
    .prepare('SELECT target_id FROM mutes WHERE user_id = ?')
    .all(userId)
    .map((r) => r.target_id);
}

router.get('/', authRequired, (req, res) => {
  res.json({ ids: listMutedIds(req.user.id) });
});

router.post('/:targetId', authRequired, (req, res) => {
  const targetId = Number(req.params.targetId);
  if (!Number.isInteger(targetId) || targetId === req.user.id) {
    return res.status(400).json({ error: 'bad target' });
  }
  const peer = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!peer) return res.status(404).json({ error: 'no such user' });

  db.prepare('INSERT OR IGNORE INTO mutes (user_id, target_id) VALUES (?, ?)').run(
    req.user.id,
    targetId,
  );

  const ids = listMutedIds(req.user.id);
  emitToUser(req.user.id, 'mutes:update', { ids });
  res.json({ ids });
});

router.delete('/:targetId', authRequired, (req, res) => {
  const targetId = Number(req.params.targetId);
  if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'bad target' });
  db.prepare('DELETE FROM mutes WHERE user_id = ? AND target_id = ?').run(req.user.id, targetId);
  const ids = listMutedIds(req.user.id);
  emitToUser(req.user.id, 'mutes:update', { ids });
  res.json({ ids });
});

export default router;
