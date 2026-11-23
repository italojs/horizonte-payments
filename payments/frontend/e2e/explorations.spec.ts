import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, test } from '@playwright/test'
import {
  balance, createPayment, demo, detail, initialize, inspect, money, readingPause, receipt, recordScenario, reviewBill, status, timeline,
} from './fixtures'

test.beforeEach(initialize)
test.afterEach(async () => { await demo('bank', 'mode', 'normal') })

test('lost bank response reconciles to a single receipt and debit', async ({ browser }) => {
  await demo('bank', 'mode', 'lose-response')
  await recordScenario(browser, '01-provider-response-lost', async page => {
    const openingMinor = await balance(page)
    expect(openingMinor).toBeGreaterThanOrEqual(300000)
    const id = await createPayment(page)
    await expect(status(page)).toHaveText('Paid')
    const history = timeline(page)
    await expect(history.getByText('Waiting to retry confirmation').first()).toBeVisible()
    await expect(history.getByText('Checking the bank’s records').first()).toBeVisible()
    const reference = await receipt(page)
    await readingPause(page)
    await page.reload()
    await expect(page.getByTestId('payment-id')).toHaveText(id)
    expect(await receipt(page)).toBe(reference)
    await expect(page.getByTestId('balance')).toHaveText(money(openingMinor - 300000))
    const { bank, account } = await inspect(id)
    expect(bank).toMatchObject({ status: 'PAID', paidEvents: 1, receipt: reference })
    expect(account).toMatchObject({ status: 'CAPTURED', captures: 1 })
    return { id, receipt: reference, openingMinor, finalMinor: await balance(page), history: await history.getByRole('listitem').allInnerTexts(), bank, account }
  })
  await delay(Number(process.env.E2E_TELEMETRY_GRACE_MS ?? 0))
})

test('cancel while the bank is offline, then recover and return the funds', async ({ browser }) => {
  await demo('bank', 'mode', 'pending')
  await recordScenario(browser, '02-manual-cancellation', async page => {
    const openingMinor = await balance(page)
    const id = await createPayment(page)
    const panel = detail(page)
    await expect(status(page)).toHaveText('Awaiting bank confirmation')
    await expect(page.getByTestId('balance')).toHaveText(money(openingMinor - 300000))
    const pendingMinor = await balance(page)
    await expect(timeline(page).getByText('Bank is processing the bill').first()).toBeVisible()
    await demo('bank', 'mode', 'offline')
    const requestCancellation = panel.getByRole('button', { name: 'Request cancellation' })
    await requestCancellation.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('If the bank has already paid this bill')
    await dialog.getByRole('button', { name: 'Back' }).click()
    await requestCancellation.click()
    await dialog.getByRole('button', { name: 'Confirm cancellation' }).click()
    await expect(status(page)).toHaveText('Cancellation requested')
    await expect(page.getByTestId('balance')).toHaveText(money(pendingMinor))
    await readingPause(page)
    await demo('bank', 'mode', 'pending')
    await expect(status(page)).toHaveText('Cancelled')
    await expect(page.getByTestId('balance')).toHaveText(money(openingMinor))
    await expect(panel.getByText('View receipt')).toHaveCount(0)
    const { bank, account } = await inspect(id)
    expect(bank).toMatchObject({ status: 'CANCELLED', paidEvents: 0, receipt: null })
    expect(account).toMatchObject({ status: 'RELEASED', captures: 0 })
    return { id, openingMinor, pendingMinor, finalMinor: await balance(page), history: await timeline(page).getByRole('listitem').allInnerTexts(), bank, account }
  })
})

test('automatically cancel after all three bank retries expire', async ({ browser }) => {
  await demo('bank', 'mode', 'offline')
  await recordScenario(browser, '03-automatic-cancellation', async page => {
    const openingMinor = await balance(page)
    const id = await createPayment(page)
    await expect(page.getByTestId('balance')).toHaveText(money(openingMinor - 300000))
    const pendingMinor = await balance(page)
    await expect(status(page)).toHaveText('Cancelled')
    await expect(page.getByTestId('balance')).toHaveText(money(openingMinor))
    await expect(detail(page).getByText('View receipt')).toHaveCount(0)
    const { bank, payment, account } = await inspect(id)
    const retries = payment.events.filter(event => event.eventType === 'RETRY_SCHEDULED')
    const scheduled = payment.events.find(event => event.eventType === 'AUTOMATIC_CANCELLATION_SCHEDULED')
    const cancelled = payment.events.find(event => event.eventType === 'CANCELLED_BEFORE_SUBMISSION')
    expect(retries).toHaveLength(3)
    expect(scheduled?.createdAt).toBeTruthy()
    expect(cancelled?.createdAt).toBeTruthy()
    expect(bank).toMatchObject({ status: null, paidEvents: 0, receipt: null })
    expect(account).toMatchObject({ status: 'RELEASED', captures: 0 })
    await timeline(page).getByText('Cancelled before reaching the bank').scrollIntoViewIfNeeded()
    return {
      id, openingMinor, pendingMinor, finalMinor: await balance(page), scheduledRetries: retries.map(event => event.createdAt),
      cancellationScheduledAt: scheduled?.createdAt, cancellationBeforeSubmissionAt: cancelled?.createdAt,
      history: await timeline(page).getByRole('listitem').allInnerTexts(), bank, account,
    }
  })
})

test('retry a lost client acknowledgement across a reload without a duplicate debit', async ({ browser }) => {
  await recordScenario(browser, '04-client-response-lost', async page => {
    const openingMinor = await balance(page)
    const originalCount = await page.getByRole('region', { name: 'Recent payments' }).getByRole('button').count()
    const requests: { id: string; status: number; keyFingerprint: string; clientReceived: boolean }[] = []
    const transcript: { at: string; observation: string }[] = []
    const note = (observation: string) => transcript.push({ at: new Date().toISOString(), observation })
    await page.route('**/api/payments', async route => {
      if (route.request().method() !== 'POST') return route.continue()
      const key = await route.request().headerValue('idempotency-key')
      expect(key).toBeTruthy()
      const result = await route.fetch()
      expect(result.status()).toBe(202)
      const { id } = await result.json() as { id: string }
      const drop = requests.length === 0
      requests.push({ id, status: result.status(), keyFingerprint: createHash('sha256').update(key!).digest('hex').slice(0, 12), clientReceived: !drop })
      if (drop) await route.abort('connectionreset')
      else await route.fulfill({ response: result })
      await result.dispose()
    })
    const dialog = await reviewBill(page)
    await dialog.getByRole('button', { name: 'Confirm payment' }).click()
    await expect(dialog.getByRole('alert')).toHaveText(/Try again to check the same request/)
    note('The API accepted the request, but the browser showed a retry prompt after the connection closed.')
    await readingPause(page)
    await page.reload()
    await expect(page.getByTestId('balance')).toBeVisible()
    const acceptedId = requests[0].id
    const visibleId = await page.getByTestId('payment-id').textContent({ timeout: 1200 }).catch(() => null)
    let previouslyViewedReceipt: string | undefined
    if (visibleId === acceptedId) {
      const visibleState = await status(page).innerText()
      note('The accepted payment was visible after reload. Its status was ' + visibleState + '.')
      if (visibleState === 'Paid') {
        previouslyViewedReceipt = await receipt(page)
        note('Opened the settled receipt to compare it with the acknowledgement after retry.')
        await readingPause(page)
        await detail(page).getByText('View receipt', { exact: true }).click()
      } else {
        await timeline(page).scrollIntoViewIfNeeded()
        note('Inspected the visible payment history while the bank decision was pending.')
        await readingPause(page)
      }
    } else {
      note('The accepted payment was missing from the selected details after reload. Retrying the original bill will resolve the outcome.')
    }
    const replayedId = await createPayment(page)
    expect(replayedId).toBe(acceptedId)
    expect(requests).toHaveLength(2)
    expect(requests[0].keyFingerprint).toBe(requests[1].keyFingerprint)
    expect(requests.map(attempt => attempt.clientReceived)).toEqual([false, true])
    await expect(status(page)).toHaveText('Paid')
    const reference = await receipt(page)
    await expect(page.getByTestId('balance')).toHaveText(money(openingMinor - 300000))
    await expect(page.getByRole('region', { name: 'Recent payments' }).getByRole('button')).toHaveCount(originalCount + 1)
    if (previouslyViewedReceipt) expect(reference).toBe(previouslyViewedReceipt)
    const { bank, payment, account } = await inspect(acceptedId)
    expect(bank).toMatchObject({ status: 'PAID', paidEvents: 1, receipt: reference })
    expect(account).toMatchObject({ status: 'CAPTURED', captures: 1 })
    note('The acknowledgement and both ledgers agree on one paid bill, one receipt and one debit.')
    return { id: acceptedId, receipt: reference, openingMinor, finalMinor: await balance(page), requests, payment, bank, account, transcript }
  })
})
