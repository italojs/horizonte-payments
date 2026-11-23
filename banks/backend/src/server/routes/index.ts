import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { changePayment, getPayment } from '../controllers/bankPayments.ts';
import { bodySchema, uuidPattern } from '../operation.ts';

export function registerRoutes(app: FastifyInstance, pool: Pool) {
  for (const action of ['submit', 'cancel'] as const) {
    app.post('/' + action, { schema: { body: bodySchema } }, changePayment(pool, action));
  }
  app.get(
    '/payments/:id',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', pattern: uuidPattern } } },
      },
    },
    getPayment(pool),
  );
}
