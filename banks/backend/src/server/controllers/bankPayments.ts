import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { perform } from '../../services/bankPayments.ts';
import type { Operation } from '../../types/operation.ts';

export function changePayment(pool: Pool, action: 'submit' | 'cancel') {
  return async (request: FastifyRequest<{ Body: Operation }>, reply: FastifyReply) => {
    const result = await perform(pool, action, request.body);
    if (result.lost) {
      // The database has committed. Simulate a dropped connection before any HTTP response.
      reply.hijack();
      reply.raw.destroy();
      return;
    }
    return reply.code(result.code).send({ status: result.status, receipt: result.receipt });
  };
}

export function getPayment(pool: Pool) {
  return async (
    request: FastifyRequest<{ Params: { id: string }; Querystring: { companyId: string } }>,
    reply: FastifyReply,
  ) => {
    const result = await perform(pool, 'query', {
      paymentId: request.params.id,
      companyId: request.query.companyId,
    });
    return reply.code(result.code).send({ status: result.status, receipt: result.receipt });
  };
}
