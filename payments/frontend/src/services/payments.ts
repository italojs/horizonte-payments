export interface Account {
  availableMinor: number
  currency: string
}

export interface Bill {
  billRef: string
  beneficiaryRef: string
  name: string
  amountMinor: number
  currency: string
}

export interface Payment {
  id: string
  state: string
  amountMinor: number
  currency: string
  beneficiaryRef: string
  billRef: string
  createdAt: string
  receipt?: string | null
}

export interface PaymentEvent {
  eventType: string
  actor: string
  createdAt: string
}

export interface PaymentDetail extends Payment {
  events: PaymentEvent[]
}

export class ApiError extends Error {
  constructor(public status: number) { super('The request failed') }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body) headers.set('Content-Type', 'application/json')
  const response = await fetch('/api' + path, { ...init, headers, cache: 'no-store' })
  if (!response.ok) throw new ApiError(response.status)
  return response.json() as Promise<T>
}

export async function getOverview() {
  const [account, bills, payments] = await Promise.all([
    api<Account>('/account'),
    api<Bill[]>('/bills'),
    api<{ items: Payment[] }>('/payments'),
  ])
  return { account, bills, items: payments.items }
}

export const getPayment = (id: string) => api<PaymentDetail>('/payments/' + encodeURIComponent(id))
export const cancelPayment = (id: string) => api('/payments/' + encodeURIComponent(id) + '/cancel', { method: 'POST' })

export async function payBill(billRef: string) {
  const storageKey = 'horizonte/payment/' + billRef
  const key = sessionStorage.getItem(storageKey) || crypto.randomUUID()
  // Keep the intent across reloads and transport errors until the API acknowledges it.
  sessionStorage.setItem(storageKey, key)
  const result = await api<{ id: string }>('/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ billRef }),
  })
  sessionStorage.removeItem(storageKey)
  return result
}

export const money = (minor: number, currency = 'BRL') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100)

const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})
export const formatDate = (date: string) => dateFormat.format(new Date(date))
