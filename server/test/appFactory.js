import express from 'express';
import authRoutes from '../src/routes/auth.js';
import userRoutes from '../src/routes/users.js';
import messageRoutes from '../src/routes/messages.js';
import meRoutes from '../src/routes/me.js';
import muteRoutes from '../src/routes/mutes.js';
import groupRoutes from '../src/routes/groups.js';
import inviteRoutes from '../src/routes/invites.js';
import healthRoutes from '../src/routes/health.js';
import friendRoutes from '../src/routes/friends.js';
import adminRoutes from '../src/routes/admin.js';

/**
 * Поднимает HTTP-приложение (без socket.io), идентичное продовому,
 * но изолированное — для supertest. Логика аутентификации, роутов
 * и БД — те же модули.
 */
export function buildTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/me', meRoutes);
  app.use('/api/mutes', muteRoutes);
  app.use('/api/groups', groupRoutes);
  app.use('/api/invites', inviteRoutes);
  app.use('/api/health', healthRoutes);
  app.use('/api/friends', friendRoutes);
  app.use('/api/admin', adminRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err?.status || 400).json({ error: err?.message || 'bad request' });
  });
  return app;
}
