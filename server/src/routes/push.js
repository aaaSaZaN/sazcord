import { Router } from 'express';
import { authRequired } from '../auth.js';
import { pushEnabled, publicVapidKey, saveSubscription, deleteSubscription } from '../push.js';

const router = Router();

// Публичная конфигурация: фронту нужен только publicKey, чтобы подписаться.
router.get('/config', (_req, res) => {
  res.json({ enabled: pushEnabled(), publicKey: publicVapidKey() });
});

router.post('/subscribe', authRequired, (req, res) => {
  if (!pushEnabled()) return res.status(503).json({ error: 'push not configured' });
  const { subscription } = req.body || {};
  try {
    saveSubscription({
      userId: req.user.id,
      sub: subscription,
      ua: req.headers['user-agent'],
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e?.message || 'bad subscription' });
  }
});

router.post('/unsubscribe', authRequired, (req, res) => {
  const { endpoint } = req.body || {};
  if (typeof endpoint !== 'string' || !endpoint) {
    return res.status(400).json({ error: 'endpoint required' });
  }
  deleteSubscription(endpoint);
  res.json({ ok: true });
});

export default router;
