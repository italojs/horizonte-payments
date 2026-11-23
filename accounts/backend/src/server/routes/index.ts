import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { changeReservation, getAccount } from '../controllers/accounts.ts';
import { bodySchema } from '../operation.ts';

export function registerRoutes(app: FastifyInstance, pool: Pool) {
  app.get('/accounts/:company', getAccount(pool));
  for (const action of ['reserve', 'capture', 'release'] as const) {
    app.post('/' + action, { schema: { body: bodySchema } }, changeReservation(pool, action));
  }
}
