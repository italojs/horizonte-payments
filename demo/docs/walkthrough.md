# End-to-end presentation

## Diagram-only recording

Open the [presentation diagram](payment-architecture.html) in a browser and choose **Present fullscreen**. Start on the overview and follow the main row from Ana’s request to the SAGA worker. Introduce Accounts when the worker needs to reserve funds, then introduce Banks when the worker needs a settlement result.

Use **↑ / ↓** to choose a use case and **← / →** to move between its steps. The component positions stay fixed. The highlighted arrows, payment state and available balance follow the selected scenario. Each case starts from the same BRL 10,000 account with a BRL 3,000 bill.

Show a successful payment first, then a lost bank response. Pause on the automatic cancellation *before* submission, and compare it with Ana’s cancellation *after* possible submission. Show both bank outcomes and finish with worker redelivery. The state and balance figures are illustrative walkthroughs of the implemented rules.

## Live-demo reference

Use a browser for the customer experience, Grafana in a second tab, and two terminals at the directory containing all three projects. Source `demo/env.sh` in both terminals. Commands below target the ordinary demo. Monetary examples assume a freshly seeded account and the sequence below. Read the actual starting balance before recording. A payment uses integer minor units on the wire and BRL on screen.

## 1. Introduce the ownership problem

Show the account page, available balance and **Pay a bill**. Explain that Accounts owns funds and Banks decides whether a transfer settled. Their teams can independently release their services. Payments only knows their HTTP contracts. Open the top-level architecture diagram and the three project directories. Show the API route and the worker state machine in Payments. Then show the two provider databases and the separate Payments broker.

```sh
docker compose ps
node demo/scripts/operator.ts queues
node demo/scripts/operator.ts breaker
```

For a shorter failure demonstration, configure the following **before** the demo and recreate only its worker. Default product delays are 5 seconds, 1 minute and 10 minutes.

```sh
export RETRY_MS=1500,4000,8000 BREAKER_COOLDOWN_MS=2500 RECONCILE_MS=2500
docker compose up -d --no-deps payments-worker
```

## 2. Complete a payment

```sh
node demo/scripts/operator.ts bank mode normal
```

Pay **Ipe Workshop** (BRL 850). The UI moves to **Paid**, makes the receipt available and shows BRL 9,150. Copy the payment ID into `ID` in the terminal. Display the customer history first, then the owner's observations.

```sh
ID='replace-with-the-payment-uuid'
node demo/scripts/operator.ts payment inspect "$ID"
node demo/scripts/operator.ts bank inspect "$ID"
node demo/scripts/operator.ts payment routes "$ID"
```

The first command prints the Payments decision and Accounts reservation as separate JSON records. Compare the bank receipt with the UI. Look for one settlement and one capture. The API's 202 marked broker acceptance. The receipt marks the bank result.

## 3. Lose the response after settlement

```sh
node demo/scripts/operator.ts bank mode lose-response
```

Pay **Atlas Supplies** (BRL 3,000). Banks saves settlement and drops its first response. Payments queries the same provider reference until it learns the result and captures once. In the history show the scheduled confirmation, the bank result and the receipt. The available balance reaches BRL 6,150. Repeat the two inspection commands using this payment's ID. Save that ID for Grafana.

## 4. Cancel during an ambiguous outcome

```sh
node demo/scripts/operator.ts bank mode pending
```

Pay **Ipe Workshop**. Wait for the provider to record **PROCESSING** (`bank inspect`) before simulating the outage.

```sh
node demo/scripts/operator.ts bank mode offline
```

Click **Request cancellation** and confirm. Available funds remain BRL 5,300 while the worker cannot establish the bank outcome. Then restore the provider in pending mode during cancellation so the worker can obtain a definitive cancellation.

```sh
node demo/scripts/operator.ts bank mode pending
```

Wait for **Cancelled** and BRL 6,150. Show the account release and zero captures. A provider that already settled would require capture. A cancellation request by itself cannot justify releasing funds.

## 5. Stop the external bank before submission

```sh
node demo/scripts/operator.ts bank mode normal
docker compose stop bank-simulator
```

Pay **Atlas Supplies**. Available balance briefly falls to BRL 3,150 while the funds are reserved. Leave the page open. In the other terminal, inspect the payment history and the shared bank breaker. Use Ctrl+C to stop a watch.

```sh
node demo/scripts/operator.ts breaker --watch
node demo/scripts/operator.ts payment inspect "$ID" --watch
```

Set `ID` to the new payment before the second command. After the three scheduled retries, the worker routes an automatic cancellation. Since submission never began, the available balance returns to BRL 6,150 even while the provider is stopped. Use `payment routes` to show the retry and cancellation destinations.

```sh
docker compose start bank-simulator
```

## 6. Trace a real operation and demonstrate recovery

Open Grafana Explore, select Tempo and use `{ span.payment.id = "YOUR-PAID-UUID" }`. Follow API acceptance, RabbitMQ publish and consume, the bank call and the Accounts capture. Copy the trace ID into Loki. In Prometheus, inspect the payment, accounts and banks operation counters. The [recordings](../evidence/README.md) show these steps with a verified payment ID.

Use the [test guide](testing.md) in a separate terminal to demonstrate worker termination after bank settlement, broker loss and replays. Point to command receipts for recovery, the audit for customer-visible progress and the two external ledgers for financial effects. Show the same payment using replicas of the API and worker. Close on the external contracts that make it safe to retry or compensate.
