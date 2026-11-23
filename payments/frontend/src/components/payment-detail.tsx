import { canCancel, eventLabel, statusOf } from '../services/payment-states'
import { formatDate, money, type PaymentDetail } from '../services/payments'

export function PaymentDetails({ payment, name, onCancel }: {
  payment: PaymentDetail; name: string; onCancel: () => void
}) {
  const status = statusOf(payment.state)
  return <>
    <span className="type">Bill · {payment.billRef}</span>
    <div className="detail-head"><h2>{name}</h2><strong>{money(payment.amountMinor, payment.currency)}</strong></div>
    <div aria-live="polite" aria-atomic="true" className="state">
      <span className={'flag ' + status.tone} data-testid="payment-status"><i aria-hidden="true" />{status.label}</span>
      <p>{status.description}</p>
    </div>
    <h3>History</h3>
    <ol className="timeline" aria-label="Payment history">{payment.events.map((event, index) => {
      const label = eventLabel(event)
      return label && <li key={event.createdAt + event.eventType + index}>
        <span>{label}</span><time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time>
      </li>
    })}</ol>
    {canCancel(payment.state) && <button className="secondary" onClick={onCancel}>Request cancellation</button>}
    {payment.state === 'PAID' && payment.receipt && <details className="receipt"><summary>View receipt</summary><dl>
      <dt>Payee</dt><dd>{name}</dd>
      <dt>Amount paid</dt><dd>{money(payment.amountMinor, payment.currency)}</dd>
      <dt>Bank reference</dt><dd data-testid="receipt">{payment.receipt}</dd>
    </dl></details>}
    <div className="payment-id">Payment ID <span data-testid="payment-id">{payment.id}</span></div>
  </>
}
