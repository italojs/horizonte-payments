export interface Payment {
  id: string;
  company_id: string;
  account_id: string;
  bill_ref: string;
  amount_minor: string;
  beneficiary_ref: string;
  currency: string;
  idempotency_key: string;
  state: State;
  provider_ref: string | null;
  cancel_reason: string | null;
  version: number;
  attempt: number;
  review_required: boolean;
  submission_intent: boolean;
}
export type State =
  | 'RESERVATION_PENDING'
  | 'AWAITING_SUBMISSION'
  | 'AWAITING_CONFIRMATION'
  | 'DEBIT_PENDING'
  | 'CANCELLATION_PENDING'
  | 'CANCEL_RELEASE_PENDING'
  | 'FAILURE_RELEASE_PENDING'
  | 'PAID'
  | 'CANCELLED'
  | 'FAILED';

export type Status =
  | 'HELD'
  | 'CAPTURED'
  | 'RELEASED'
  | 'PAID'
  | 'CANCELLED'
  | 'REJECTED'
  | 'PROCESSING'
  | 'ABSENT'
  | 'INSUFFICIENT';
export interface Reply {
  status: Status;
  receipt?: string;
}
export class Uncertain extends Error {}
export class CircuitOpen extends Uncertain {
  due: number;
  constructor(due: number) {
    super('bank circuit is open');
    this.due = due;
  }
}
