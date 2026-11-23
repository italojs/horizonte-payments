CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY, company_id text NOT NULL UNIQUE, currency text NOT NULL,
  balance_minor bigint NOT NULL CHECK (balance_minor >= 0),
  reserved_minor bigint NOT NULL DEFAULT 0 CHECK (reserved_minor >= 0 AND reserved_minor <= balance_minor)
);
CREATE TABLE IF NOT EXISTS reservations (
  payment_id uuid PRIMARY KEY, account_id text NOT NULL REFERENCES accounts, amount_minor bigint NOT NULL CHECK(amount_minor>=0),
  status text NOT NULL CHECK(status IN ('HELD','CAPTURED','RELEASED'))
);
CREATE TABLE IF NOT EXISTS account_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, account_id text NOT NULL REFERENCES accounts,
  payment_id uuid NOT NULL, kind text NOT NULL, balance_delta bigint NOT NULL, reserved_delta bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(payment_id,kind)
);
INSERT INTO accounts (id,company_id,currency,balance_minor) VALUES
 ('acc-horizonte','horizonte','BRL',1000000) ON CONFLICT DO NOTHING;
