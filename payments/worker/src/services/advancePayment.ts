import { CircuitOpen, Uncertain, type Payment, type Reply, type State } from '../domain/payment.ts';
import type { Services } from '../clients/providers.ts';
import { positiveEnv } from '../config.ts';

export type Decision = {
  state: State;
  event: string;
  receipt?: string;
  detail?: string;
  attempt?: number;
  review?: boolean;
  delay?: number;
  authorizeSubmit?: boolean;
  autoCancel?: boolean;
};
export type AfterProvider = (paymentId: string) => Promise<void>;
export function retryDelays() {
  const delays = (process.env.RETRY_MS ?? '5000,60000,600000').split(',').map(Number);
  if (delays.length !== 3 || delays.some((n) => !Number.isSafeInteger(n) || n <= 0))
    throw new Error('RETRY_MS requires three positive millisecond intervals');
  return delays;
}
function retry(p: Payment, state: State, err: Uncertain): Decision {
  if (err instanceof CircuitOpen)
    return {
      state,
      event: 'BANK_CIRCUIT_OPEN',
      attempt: p.attempt,
      delay: Math.max(1, err.due - Date.now()),
      detail: 'waiting for provider probe',
    };
  const delays = retryDelays();
  if (p.attempt >= delays.length) {
    if (state === 'AWAITING_SUBMISSION' || state === 'AWAITING_CONFIRMATION')
      return {
        state,
        event: 'AUTOMATIC_CANCELLATION_SCHEDULED',
        autoCancel: true,
        detail: err.message,
      };
    if (state === 'CANCELLATION_PENDING')
      return {
        state,
        event: 'RECONCILIATION_DEFERRED',
        detail: err.message,
        attempt: delays.length,
        delay: Math.max(positiveEnv('RECONCILE_MS', 5000), delays.at(-1)!),
      };
    return {
      state,
      event: 'OPERATOR_REVIEW_REQUIRED',
      review: true,
      detail: err.message,
      attempt: 0,
    };
  }
  return {
    state,
    event: 'RETRY_SCHEDULED',
    detail: err.message,
    attempt: p.attempt + 1,
    delay: delays[p.attempt],
  };
}
function outcome(p: Payment, reply: Reply, cancelled: boolean): Decision {
  if (reply.status === 'PAID')
    return { state: 'DEBIT_PENDING', event: 'PROVIDER_CONFIRMED_PAID', receipt: reply.receipt };
  if (reply.status === 'REJECTED')
    return { state: 'FAILURE_RELEASE_PENDING', event: 'PROVIDER_REJECTED' };
  if (reply.status === 'CANCELLED')
    return { state: 'CANCEL_RELEASE_PENDING', event: 'PROVIDER_CONFIRMED_CANCELLED' };
  if (reply.status === 'PROCESSING')
    return {
      state: cancelled ? 'CANCELLATION_PENDING' : 'AWAITING_CONFIRMATION',
      event: 'PROVIDER_PROCESSING',
      delay: positiveEnv('RECONCILE_MS', 5000),
    };
  throw new Uncertain('unexpected provider status at ' + p.state);
}

export async function advance(
  p: Payment,
  services: Services,
  afterProvider: AfterProvider,
): Promise<Decision> {
  try {
    if (p.state === 'RESERVATION_PENDING') {
      const r = await services.accounts('reserve', p);
      if (r.status === 'HELD') return { state: 'AWAITING_SUBMISSION', event: 'FUNDS_RESERVED' };
      if (r.status === 'INSUFFICIENT') return { state: 'FAILED', event: 'INSUFFICIENT_FUNDS' };
      throw new Uncertain('reservation requires reconciliation');
    }
    if (
      p.state === 'AWAITING_SUBMISSION' ||
      p.state === 'AWAITING_CONFIRMATION' ||
      p.state === 'CANCELLATION_PENDING'
    ) {
      const cancel = p.state === 'CANCELLATION_PENDING';
      if (cancel && !p.submission_intent)
        return { state: 'CANCEL_RELEASE_PENDING', event: 'CANCELLED_BEFORE_SUBMISSION' };
      // No submit may begin until its intent has committed and a separate command
      // with the new version is delivered. This survives process and network failure.
      const r = await services.bank('status', p);
      if (p.state === 'AWAITING_SUBMISSION' && r.status === 'ABSENT')
        return {
          state: 'AWAITING_CONFIRMATION',
          event: 'PROVIDER_SUBMISSION_AUTHORIZED',
          authorizeSubmit: true,
        };
      if (r.status === 'ABSENT' || (cancel && r.status === 'PROCESSING')) {
        if (!p.submission_intent) throw new Error('Missing durable submission intent');
        const result = await services.bank(cancel ? 'cancel' : 'submit', p);
        await afterProvider(p.id);
        return outcome(p, result, cancel);
      }
      return { ...outcome(p, r, cancel), authorizeSubmit: true };
    }
    if (p.state === 'DEBIT_PENDING') {
      const r = await services.accounts('capture', p);
      if (r.status === 'CAPTURED') return { state: 'PAID', event: 'DEBIT_CAPTURED' };
      throw new Uncertain('capture requires reconciliation');
    }
    if (p.state === 'CANCEL_RELEASE_PENDING' || p.state === 'FAILURE_RELEASE_PENDING') {
      const r = await services.accounts('release', p);
      if (r.status === 'RELEASED')
        return {
          state: p.state === 'CANCEL_RELEASE_PENDING' ? 'CANCELLED' : 'FAILED',
          event: 'RESERVATION_RELEASED',
        };
      throw new Uncertain('release requires reconciliation');
    }
    throw new Error('Terminal state has no successor');
  } catch (err) {
    if (!(err instanceof Uncertain)) throw err;
    return retry(p, p.state, err);
  }
}
