# Payments frontend

A React account page for paying bills in Brazilian reais. Open the account directly, select a bill, review its payee and amount, and confirm the payment. The page polls the current balance, list and selected payment. Its history shows retries, cancellations and bank decisions. A paid bill includes a receipt.

## Run the interface

Use Node.js 24 or later and pnpm 10.25.0. Run these commands in the frontend directory.

```sh
pnpm install --frozen-lockfile
API_PROXY=http://localhost:3010 pnpm dev
```

Open [the account](http://localhost:5173). Vite forwards requests under `/api` to the local payments API. To use the production asset server locally, run the following commands.

```sh
pnpm build
API_PROXY=http://localhost:3010 pnpm start
```

The standalone image builds the same assets. It listens on `5173` and defaults to `API_PROXY=http://payments-api:3010`. Set `PORT` or `API_PROXY` at runtime to change either value. Its proxy preserves the public `/api` path and the browser's idempotency key. All replicas serve the same static build. An outstanding creation key stays in the browser tab across retries and page refreshes until the API acknowledges the payment.

```sh
docker build -t horizonte-payments-web:local .
```

## Browser tests

Bring up the isolated combined test stack using the project runbook. The scenarios share its simulated bank and must run serially. Use the accelerated retry intervals from that stack so the third automatic retry fits the browser test timeout. Install Chromium and the video encoder once with Playwright.

```sh
pnpm exec playwright install chromium ffmpeg
pnpm typecheck
```

In the combined checkout, open a shell at its top level. The test environment selects the isolated Compose project, operator CLI, browser origin on port 15173 and evidence directory.

```sh
. ./demo/test-env.sh
docker compose up -d --build --wait
pnpm --dir payments/frontend e2e
```

For a separately deployed test stack, set `DEMO_CLI`, `E2E_BASE_URL` and `EVIDENCE_DIR` in the shell that runs the tests. The combined checkout supplies `demo/scripts/operator.ts` as `DEMO_CLI`. It is a JavaScript or TypeScript entry point launched as `node "$DEMO_CLI" ...`. The suite calls `reset --test`, `bank mode normal|pending|offline|reject|lose-response`, `bank inspect ID` and `payment inspect ID`. The last command emits the payment summary and accounts reservation on consecutive JSON lines.

`E2E_RESET=1` resets the isolated fixture before each scenario. The browser defaults to `http://localhost:5173`. The default evidence path is `evidence/explorations` under this directory. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to select an installed Chromium executable. Set `E2E_TELEMETRY_GRACE_MS` to allow the exporter extra time after the first recording. If you want a separate collection for each run, use a fresh `EVIDENCE_DIR`.

Run only the four recorded scenarios with `pnpm explore`. Each passing scenario writes a 1280 × 850 WebM and a paired JSON record using these basenames.

| Basename | Observations |
| --- | --- |
| `01-provider-response-lost` | Drop the bank response after payment, watch retries and reconciliation, reopen the receipt, and match one bank payment to one account capture. The JSON `id` correlates this payment with its traces and logs. |
| `02-manual-cancellation` | Request cancellation while the bank is offline, bring it back, and verify the hold is released. |
| `03-automatic-cancellation` | Let three retries expire before submission. Check the cancellation history, restored balance and empty bank ledger. |
| `04-client-response-lost` | Drop the first real HTTP 202 only on its way to the browser. Reload, examine what the account shows, resubmit the same bill, and compare both key fingerprints, payment IDs, ledger counts and the receipt. The JSON includes the observed sequence. |

The full `pnpm e2e` suite also pays Ipe Workshop on a mobile viewport, reloads its receipt, and exercises a declined payment with full restoration of the balance. These two tests read the API and ledgers for cross-checks. `pnpm e2e --list` shows all six cases.
