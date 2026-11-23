import { statusOf } from '../services/payment-states'
import { formatDate, money, type Payment } from '../services/payments'

export function PaymentList({ items, selected, onSelect, nameOf }: {
  items: Payment[]; selected: string; onSelect: (id: string) => void; nameOf: (payment: Payment) => string
}) {
  return <section aria-labelledby="recent">
    <h2 id="recent">Recent payments</h2>
    {items.length ? <ul className="payments">{items.map(payment => <li key={payment.id}>
      <button className="payment-row" aria-pressed={selected === payment.id} onClick={() => onSelect(payment.id)}>
        <span className="row-main"><strong>{nameOf(payment)}</strong><span>{money(payment.amountMinor, payment.currency)}</span></span>
        <span className="row-meta"><time dateTime={payment.createdAt}>{formatDate(payment.createdAt)}</time><span>{statusOf(payment.state).label}</span></span>
      </button>
    </li>)}</ul> : <p className="empty-list">Your payments will appear here.</p>}
  </section>
}
