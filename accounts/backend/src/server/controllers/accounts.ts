import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { findAvailable } from '../../db/repositories/accounts.ts';
import { applyReservation } from '../../services/accounts.ts';
import type { AccountAction } from '../../services/reservation.ts';
import type { Operation } from '../../types/operation.ts';

export function getAccount(pool: Pool) {
  return async (request: FastifyRequest<{ Params: { company: string } }>, reply: FastifyReply) => {
    const account = await findAvailable(pool, request.params.company);
    return account ?? reply.code(404).send({ error: 'Unknown account' });
  };
}

export function changeReservation(pool: Pool, action: AccountAction) {
  return async (request: FastifyRequest<{ Body: Operation }>, reply: FastifyReply) => {
    const result = await applyReservation(pool, action, request.body);
    return reply.code(result.code).send({ status: result.status });
  };
}
