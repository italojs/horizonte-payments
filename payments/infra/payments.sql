CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY,
  company_id text NOT NULL,
  account_id text NOT NULL,
  beneficiary_ref text NOT NULL,
  bill_ref text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL,
  state text NOT NULL CHECK (state IN ('RESERVATION_PENDING','AWAITING_SUBMISSION',
    'AWAITING_CONFIRMATION','DEBIT_PENDING','CANCELLATION_PENDING','CANCEL_RELEASE_PENDING',
    'FAILURE_RELEASE_PENDING','PAID','CANCELLED','FAILED')),
  idempotency_key text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  attempt integer NOT NULL DEFAULT 0,
  submission_intent boolean NOT NULL DEFAULT false,
  review_required boolean NOT NULL DEFAULT false,
  provider_ref text,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, idempotency_key),
  UNIQUE(company_id, id)
);
-- If this schema is applied over an earlier worker, legacy rows may have sent a
-- bank request. Only payments created under the durable-intent protocol start false.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_attribute WHERE attrelid='payments'::regclass AND attname='submission_intent' AND NOT attisdropped) THEN
    ALTER TABLE payments ADD COLUMN submission_intent boolean NOT NULL DEFAULT true;
    ALTER TABLE payments ALTER COLUMN submission_intent SET DEFAULT false;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS payments_company_created ON payments(company_id, created_at DESC, id);
CREATE TABLE IF NOT EXISTS payment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id text NOT NULL,
  payment_id uuid NOT NULL,
  event_type text NOT NULL,
  actor text NOT NULL,
  state text,
  version integer,
  detail text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(company_id,payment_id) REFERENCES payments(company_id,id)
);
CREATE INDEX IF NOT EXISTS payment_events_by_payment ON payment_events(company_id,payment_id,id);
-- Immutable input decisions permit replay of a lost publication after redelivery.
-- No sender scans this table. The current broker delivery drives the hand-off.
CREATE TABLE IF NOT EXISTS command_receipts (
  company_id text NOT NULL,
  command_id text NOT NULL,
  payment_id uuid NOT NULL,
  input jsonb NOT NULL,
  successor jsonb,
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,command_id)
);
CREATE TABLE IF NOT EXISTS early_cancellations (
  company_id text NOT NULL,
  payment_id uuid NOT NULL,
  actor text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,payment_id)
);
CREATE TABLE IF NOT EXISTS bank_breaker (
  name text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  open_until timestamptz,
  probe uuid,
  probe_until timestamptz,
  generation bigint NOT NULL DEFAULT 0
);
INSERT INTO bank_breaker(name) VALUES ('provider') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS worker_failpoints (
  name text PRIMARY KEY CHECK (name IN ('after-provider','after-commit')),
  payment_id uuid,
  expires_at timestamptz NOT NULL
);
