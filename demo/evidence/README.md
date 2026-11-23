# Recorded evidence

The first browser recording and both Grafana recordings follow payment `663025f9-d64e-85af-a4d7-9eb6c84fc657` under trace `c44464482054b4ef906234e81d180b5a`. Each browser run starts with an isolated account.

| Scenario | Recording | Evidence |
|---|---|---|
| The bank pays and loses its response | [Watch](explorations/01-provider-response-lost.mp4) | [Observations](explorations/01-provider-response-lost.json) |
| Cancellation while the bank is offline | [Watch](explorations/02-manual-cancellation.mp4) | [Observations](explorations/02-manual-cancellation.json) |
| Automatic cancellation before bank submission | [Watch](explorations/03-automatic-cancellation.mp4) | [Observations](explorations/03-automatic-cancellation.json) |
| The browser loses the acceptance response | [Watch](explorations/04-client-response-lost.mp4) | [Observations](explorations/04-client-response-lost.json) |
| Distributed payment trace | [Watch](telemetry/grafana-trace.mp4) | [Observations](telemetry/manifest.json) |
| Operation counters and correlated logs | [Watch](telemetry/grafana-metrics-logs.mp4) | [Observations](telemetry/manifest.json) |

## Executed checks

- [Accounts tests](tests/accounts.txt), [Banks tests](tests/banks.txt) and [Payments tests](tests/payments.txt) verify each project independently.
- [Browser suite](tests/browser.txt) and [two APIs and three workers](tests/scaling.txt).
- [Independent deployment proof](boundaries/independent-release.json) captures the provider container IDs before and after replacing the Payments workers.

The [manifest](manifest.json) contains file hashes and durations. The [resilience checks](resilience/checks.json) include actual worker crashes and a missing broker confirmation. The [ownership checks](boundaries/checks.json) probe database isolation from inside each application container. See [the test guide](../docs/testing.md) to reproduce the runs.
