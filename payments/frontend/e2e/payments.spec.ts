import { expect, test } from '@playwright/test'
import { balance, createPayment, demo, detail, initialize, inspect, money, origin, receipt, status } from './fixtures'

test.beforeEach(initialize)
test.afterEach(async () => { await demo('bank', 'mode', 'normal') })

test('open the account on mobile, pay a bill and reopen its receipt', async ({ page, request }) => {
  const account = await request.get('/api/account')
  expect(account.status()).toBe(200)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(origin)
  await expect(page.getByRole('heading', { name: 'Payments', exact: true })).toBeVisible()
  const opening = await balance(page)
  const id = await createPayment(page, 'ipe-192')
  await expect(status(page)).toHaveText('Paid')
  await page.reload()
  await page.getByRole('button', { name: /Ipe Workshop/ }).first().click()
  const reference = await receipt(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByTestId('balance')).toHaveText(money(opening - 85000))
  const result = await request.get('/api/payments/' + id)
  expect(result.status()).toBe(200)
  expect(await result.json()).toMatchObject({ id, billRef: 'ipe-192', state: 'PAID', receipt: reference })
})

test('display a bank rejection and restore the available balance', async ({ page }) => {
  await demo('bank', 'mode', 'reject')
  await page.goto(origin)
  const opening = await balance(page)
  const id = await createPayment(page)
  await expect(status(page)).toHaveText('Payment failed')
  await expect(detail(page).getByText('Bank declined payment')).toBeVisible()
  await expect(detail(page).getByText('View receipt')).toHaveCount(0)
  await expect(page.getByTestId('balance')).toHaveText(money(opening))
  const { account, bank } = await inspect(id)
  expect(account).toMatchObject({ status: 'RELEASED', captures: 0 })
  expect(bank).toMatchObject({ status: 'REJECTED', receipt: null, paidEvents: 0 })
})
