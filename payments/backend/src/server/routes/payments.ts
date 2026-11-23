import type { FastifyInstance } from 'fastify';
import { paymentController } from '../controllers/payments.ts';
import type { PaymentService } from '../../services/payments.ts';

const params = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
};
const body = {
  type: 'object',
  required: ['billRef'],
  additionalProperties: false,
  properties: { billRef: { type: 'string', minLength: 1, maxLength: 100 } },
};
export function registerPaymentRoutes(api: FastifyInstance, service: PaymentService) {
  const controller = paymentController(service);
  api.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });
  api.get('/bills', controller.bills);
  api.get('/account', controller.account);
  api.get('/payments', controller.list);
  api.get('/payments/:id', { schema: { params } }, controller.detail);
  api.post('/payments', { schema: { body } }, controller.create);
  api.post('/payments/:id/cancel', { schema: { params } }, controller.cancel);
}
