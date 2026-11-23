import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, type Browser, type Page } from '@playwright/test'

export const origin = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
const evidenceDir = path.resolve(process.env.EVIDENCE_DIR ?? 'evidence/explorations')
const execute = promisify(execFile)

export async function demo(...args: string[]) {
  if (!process.env.DEMO_CLI) throw new Error('Set DEMO_CLI to the operator CLI for the isolated test stack.')
  const { stdout } = await execute(process.execPath, [process.env.DEMO_CLI, ...args], { timeout: 100_000 })
  return stdout.trim()
}

export async function initialize() {
  if (process.env.E2E_RESET === '1') await demo('reset', '--test')
  await demo('bank', 'mode', 'normal')
}

interface InspectedEvent { eventType: string; createdAt: string }
interface InspectedPayment { state: string; events: InspectedEvent[] }
interface Reservation { status: string; captures: number; amountMinor: number }
interface BankRecord { status: string | null; paidEvents: number; receipt: string | null }

export async function inspect(id: string) {
  const [bankLine, ledgerLines] = await Promise.all([demo('bank', 'inspect', id), demo('payment', 'inspect', id)])
  const [paymentLine, accountLine] = ledgerLines.split('\n')
  return {
    bank: JSON.parse(bankLine) as BankRecord,
    payment: JSON.parse(paymentLine) as InspectedPayment,
    account: JSON.parse(accountLine) as Reservation,
  }
}

export const detail = (page: Page) => page.getByRole('region', { name: 'Payment details' })
export const timeline = (page: Page) => detail(page).getByRole('list', { name: 'Payment history' })
export const status = (page: Page) => page.getByTestId('payment-status')
export const money = (minor: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'BRL' }).format(minor / 100)

export async function balance(page: Page) {
  const raw = await page.getByTestId('balance').innerText()
  return Number(raw.replace(/[^\d-]/g, ''))
}

export async function reviewBill(page: Page, billRef = 'atlas-483') {
  await page.getByRole('button', { name: 'Pay a bill' }).click()
  const dialog = page.getByRole('dialog', { name: 'Review bill' })
  await dialog.getByLabel('Payee and bill').selectOption(billRef)
  await expect(dialog).toContainText(money(billRef === 'atlas-483' ? 300000 : 85000))
  return dialog
}

export async function createPayment(page: Page, billRef = 'atlas-483') {
  const dialog = await reviewBill(page, billRef)
  const responsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/payments' && response.request().method() === 'POST')
  await dialog.getByRole('button', { name: 'Confirm payment' }).click()
  const response = await responsePromise
  expect(response.status()).toBe(202)
  const { id } = await response.json() as { id: string }
  await expect(page.getByTestId('payment-id')).toHaveText(id)
  return id
}

export async function receipt(page: Page) {
  await detail(page).getByText('View receipt', { exact: true }).click()
  const reference = page.getByTestId('receipt')
  await expect(reference).toHaveText(/^B-\S+$/)
  return reference.innerText()
}

// Keep the observed screen in the video long enough for a viewer to read it.
export const readingPause = (page: Page) => page.waitForTimeout(1200)

export async function recordScenario(
  browser: Browser, name: string, scenario: (page: Page) => Promise<Record<string, unknown>>,
) {
  await mkdir(evidenceDir, { recursive: true })
  const size = { width: 1280, height: 850 }
  const context = await browser.newContext({
    viewport: size, locale: 'en-US', timezoneId: 'America/Sao_Paulo',
    recordVideo: { dir: path.resolve('test-results/recordings'), size },
  })
  const page = await context.newPage()
  const video = page.video()!
  let evidence: Record<string, unknown>
  try {
    await page.goto(origin)
    await expect(page.getByTestId('balance')).toBeVisible()
    evidence = await scenario(page)
    await readingPause(page)
  } finally {
    await context.close()
  }
  await video.saveAs(path.join(evidenceDir, name + '.webm'))
  const report = { observedAt: new Date().toISOString(), ...evidence }
  await writeFile(path.join(evidenceDir, name + '.json'), JSON.stringify(report, null, 2) + '\n')
}
