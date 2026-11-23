import { useEffect, useRef, useState } from 'react'
import { Modal } from '../../components/modal'
import { PaymentDetails } from '../../components/payment-detail'
import { PaymentList } from '../../components/payment-list'
import { ApiError, cancelPayment, getOverview, getPayment, money, payBill, type Payment, type PaymentDetail } from '../../services/payments'

const company = 'Horizonte Ltd.'

export function PaymentsPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getOverview>>>()
  const [selected, setSelected] = useState('')
  const [detail, setDetail] = useState<PaymentDetail>()
  const [detailError, setDetailError] = useState(false)
  const [acceptedId, setAcceptedId] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [readError, setReadError] = useState(false)
  const [modal, setModal] = useState<'pay' | 'cancel' | null>(null)
  const [billRef, setBillRef] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [mutationError, setMutationError] = useState('')
  const panel = useRef<HTMLElement>(null)
  const refreshNow = () => setRefresh(value => value + 1)

  useEffect(() => {
    let active = true
    let timeout: ReturnType<typeof setTimeout>
    async function load() {
      try {
        const overview = await getOverview()
        if (active) {
          setData(overview)
          setReadError(false)
          setSelected(old => old || overview.items[0]?.id || '')
        }
      } catch { if (active) setReadError(true) }
      if (active) timeout = setTimeout(load, 1500)
    }
    void load()
    return () => { active = false; clearTimeout(timeout) }
  }, [refresh])

  useEffect(() => {
    if (!selected) return
    let active = true
    let timeout: ReturnType<typeof setTimeout>
    async function load() {
      try {
        const record = await getPayment(selected)
        if (active) {
          setDetail(record)
          setDetailError(false)
          setAcceptedId('')
        }
      } catch (error) {
        // A queued creation command can be accepted before the read model appears.
        const queued = acceptedId === selected && error instanceof ApiError && error.status === 404
        if (active) setDetailError(!queued)
      }
      if (active) timeout = setTimeout(load, 1000)
    }
    setDetailError(false)
    void load()
    return () => { active = false; clearTimeout(timeout) }
  }, [selected, refresh, acceptedId])

  function close() {
    if (submittingRef.current) return
    setModal(null)
    setMutationError('')
  }

  function selectPayment(id: string) {
    setSelected(id)
    if (matchMedia('(max-width: 720px)').matches) panel.current?.scrollIntoView({ block: 'start' })
  }

  function newPayment() {
    setBillRef(data?.bills[0]?.billRef ?? '')
    setMutationError('')
    setModal('pay')
  }

  async function submit() {
    if (submittingRef.current || !modal || (modal === 'pay' && !billRef)) return
    submittingRef.current = true
    setSubmitting(true)
    setMutationError('')
    try {
      if (modal === 'pay') {
        const { id } = await payBill(billRef)
        setAcceptedId(id)
        selectPayment(id)
      } else {
        await cancelPayment(selected)
      }
      setModal(null)
    } catch (error) {
      const message = error instanceof ApiError && error.status === 409
        ? 'The payment status changed. Close this window and check its history.'
        : 'We couldn’t confirm your request. Try again to check the same request.'
      setMutationError(message)
    } finally {
      refreshNow()
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const current = detail?.id === selected ? detail : undefined
  const nameOf = (payment: Payment) => data?.bills.find(bill => bill.billRef === payment.billRef)?.name ?? payment.beneficiaryRef
  const bill = data?.bills.find(item => item.billRef === billRef)

  return <>
    <header className="mast"><div className="mast-inner">
      <div className="brand"><img src="/brand.svg" alt="" width="34" height="34" />Horizonte</div>
    </div></header>
    <main>
      <div className="hero">
        <div><div className="company">{company}</div><h1>Payments</h1></div>
        {data && <button className="primary" disabled={!data.bills.length} onClick={newPayment}><span aria-hidden="true">＋</span> Pay a bill</button>}
      </div>
      {readError && <div className="alert" role="alert">We couldn’t refresh your account. <button className="link" onClick={refreshNow}>Try again</button></div>}
      {data ? <>
        <section className="balance" aria-label="Account balance">
          <span>Available balance</span><strong data-testid="balance">{money(data.account.availableMinor, data.account.currency)}</strong>
        </section>
        <div className="columns">
          <PaymentList items={data.items} selected={selected} onSelect={selectPayment} nameOf={nameOf} />
          <section className="detail" aria-label="Payment details" ref={panel}>
            {current ? <PaymentDetails key={current.id} payment={current} name={nameOf(current)}
              onCancel={() => { setMutationError(''); setModal('cancel') }} />
            : <div className="empty-detail">
              <span aria-hidden="true" className="bill-icon"/>
              <h3>{selected ? acceptedId === selected ? 'Request received' : 'Loading payment…' : 'Payment details'}</h3>
              {!selected && <p>Pay a bill to track its progress and view your receipt.</p>}
            </div>}
            {detailError && <div role="alert" className="alert">We couldn’t refresh the payment history. <button className="link" onClick={refreshNow}>Refresh</button></div>}
          </section>
        </div>
      </> : !readError && <p role="status">Loading your account…</p>}
    </main>
    {modal === 'pay' && <Modal title="Review bill" close={close}>
      <label className="field-label" htmlFor="bill">Payee and bill</label>
      <select id="bill" value={billRef} onChange={event => setBillRef(event.target.value)} disabled={submitting}>
        {data?.bills.map(item => <option value={item.billRef} key={item.billRef}>{item.name} · {item.billRef}</option>)}
      </select>
      {bill && <div className="ticket">
        <div className="ticket-top"><span>Bill amount</span><strong>{money(bill.amountMinor, bill.currency)}</strong></div>
        <div className="ticket-bottom"><span>Pay from</span><strong>{company}</strong></div>
      </div>}
      {mutationError && <p role="alert" className="alert">{mutationError}</p>}
      <div className="dialog-actions">
        <button className="secondary" disabled={submitting} onClick={close}>Back</button>
        <button className="primary" disabled={submitting || !bill} onClick={() => void submit()}>{submitting ? 'Sending…' : 'Confirm payment'}</button>
      </div>
    </Modal>}
    {modal === 'cancel' && current && <Modal title="Request cancellation?" close={close}>
      <p>Cancel the payment of {money(current.amountMinor, current.currency)} to {nameOf(current)}?</p>
      <p>If the bank has already paid this bill, the payment will complete.</p>
      {mutationError && <p role="alert" className="alert">{mutationError}</p>}
      <div className="dialog-actions">
        <button className="secondary" disabled={submitting} onClick={close}>Back</button>
        <button className="primary" disabled={submitting} onClick={() => void submit()}>{submitting ? 'Sending…' : 'Confirm cancellation'}</button>
      </div>
    </Modal>}
  </>
}
