import { context, propagation } from '@horizonte/payments-runtime/telemetry';
import type { Reply, Status } from '../domain/payment.ts';

export async function request(base: string, path: string, timeout: number, payload?: object) {
  const headers: Record<string, string> = {};
  if (payload) headers['content-type'] = 'application/json';
  propagation.inject(context.active(), headers);
  return fetch(new URL(path, base), {
    method: payload ? 'POST' : 'GET',
    headers,
    signal: AbortSignal.timeout(timeout),
    body: payload ? JSON.stringify(payload) : undefined,
  });
}
export async function readReply(response: Response, allowed: readonly Status[]): Promise<Reply> {
  const data = (await response.json()) as Reply;
  if (!allowed.includes(data.status) || (data.receipt != null && typeof data.receipt !== 'string'))
    throw new Error('Invalid provider reply');
  if (data.status === 'PAID' && !data.receipt) throw new Error('Missing payment receipt');
  return { status: data.status, receipt: data.receipt || undefined };
}
