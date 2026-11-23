import type { FastifyRequest, FastifyReply } from 'fastify';
import type { PaymentService } from '../../services/payments.ts';

type ById = { Params: { id: string } };
type Create = { Body: { billRef: string } };

export function paymentController(service: PaymentService) {
  return {
    bills: async () => service.bills(),
    account: async () => service.account(),
    list: async () => service.list(),
    detail: async (request: FastifyRequest<ById>) => service.detail(request.params.id),
    async create(request: FastifyRequest<Create>, reply: FastifyReply) {
      const result = await service.create(request.body.billRef, request.headers['idempotency-key']);
      return reply
        .code(202)
        .header('Location', '/api/payments/' + result.id)
        .send(result);
    },
    async cancel(request: FastifyRequest<ById>, reply: FastifyReply) {
      return reply.code(202).send(await service.cancel(request.params.id));
    },
  };
}
