import type { PaymentEvent } from './payments'

interface Status { label: string; description: string; tone: 'working' | 'success' | 'ended' }

const states: Record<string, Status> = {
  RESERVATION_PENDING: { label: 'Request received', description: 'We’re checking the available balance.', tone: 'working' },
  AWAITING_SUBMISSION: { label: 'Preparing payment', description: 'Your bill is ready to send to the bank.', tone: 'working' },
  AWAITING_CONFIRMATION: { label: 'Awaiting bank confirmation', description: 'This page updates when the bank responds.', tone: 'working' },
  DEBIT_PENDING: { label: 'Completing payment', description: 'The bank confirmed payment. We’re updating your account.', tone: 'working' },
  CANCELLATION_PENDING: { label: 'Cancellation requested', description: 'We’re checking the outcome with the bank.', tone: 'working' },
  CANCEL_RELEASE_PENDING: { label: 'Completing cancellation', description: 'We’re updating your available balance.', tone: 'working' },
  FAILURE_RELEASE_PENDING: { label: 'Updating balance', description: 'The payment failed. We’re returning the funds to your available balance.', tone: 'working' },
  PAID: { label: 'Paid', description: 'The bank confirmed payment. Your receipt is available below.', tone: 'success' },
  CANCELLED: { label: 'Cancelled', description: 'Your payment was cancelled. You can check your available balance above.', tone: 'ended' },
  FAILED: { label: 'Payment failed', description: 'Check the payment history for the reason.', tone: 'ended' },
}
const fallback: Status = { label: 'Processing payment', description: 'Follow this payment in its history.', tone: 'working' }
export const statusOf = (state: string) => states[state] ?? fallback
export const canCancel = (state: string) => ['RESERVATION_PENDING', 'AWAITING_SUBMISSION', 'AWAITING_CONFIRMATION'].includes(state)

const eventLabels: Record<string, string> = {
  PAYMENT_CREATED: 'Payment requested',
  FUNDS_RESERVED: 'Available balance updated',
  INSUFFICIENT_FUNDS: 'Insufficient funds to pay this bill',
  PROVIDER_PROCESSING: 'Bank is processing the bill',
  PROVIDER_CONFIRMED_PAID: 'Bank confirmed payment',
  PROVIDER_REJECTED: 'Bank declined payment',
  PROVIDER_CONFIRMED_CANCELLED: 'Bank confirmed cancellation',
  DEBIT_CAPTURED: 'Payment completed',
  CANCELLATION_REQUESTED: 'Cancellation requested',
  RESERVATION_RELEASED: 'Funds returned to available balance',
  AUTOMATIC_CANCELLATION_SCHEDULED: 'Confirmation attempts exhausted',
  CANCELLED_BEFORE_SUBMISSION: 'Cancelled before reaching the bank',
  RETRY_SCHEDULED: 'Waiting to retry confirmation',
  RECONCILIATION_STARTED: 'Checking the bank’s records',
  RECONCILIATION_DEFERRED: 'Bank confirmation deferred',
  BANK_CIRCUIT_OPEN: 'Waiting for the bank to recover',
  OPERATOR_REVIEW_REQUIRED: 'Payment under review',
}

export function eventLabel(event: PaymentEvent) {
  const label = eventLabels[event.eventType]
  if (event.eventType === 'CANCELLATION_REQUESTED' && event.actor === 'payments-worker') {
    return 'Cancellation requested automatically'
  }
  if (['PAYMENT_CREATED', 'CANCELLATION_REQUESTED'].includes(event.eventType) && event.actor && event.actor !== 'payments-api') {
    return label + ' by ' + event.actor
  }
  return label
}
