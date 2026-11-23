import Fastify, { LogController } from 'fastify';
import type { Pool } from 'pg';
import { registerRoutes } from './routes/index.ts';

export function createServer(pool: Pool) {
  const app = Fastify({
    bodyLimit: 32768,
    logger: { level: 'warn', redact: ['req.headers'] },
    logController: new LogController({ disableRequestLogging: true }),
  });
  app.get('/health', async () => ({ ok: true }));
  registerRoutes(app, pool);
  return app;
}
