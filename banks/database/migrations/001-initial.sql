CREATE TABLE IF NOT EXISTS bank_payments (
  payment_id uuid PRIMARY KEY, company_id text NOT NULL, amount_minor bigint, currency text, beneficiary_ref text,
  status text NOT NULL CHECK(status IN ('PAID','PROCESSING','CANCELLED','REJECTED')), receipt text UNIQUE
);
CREATE TABLE IF NOT EXISTS bank_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, payment_id uuid NOT NULL REFERENCES bank_payments,
  event_type text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(payment_id,event_type)
);
-- Control plane: only the CLI changes the simulator's mode.
CREATE TABLE IF NOT EXISTS simulator_control (id boolean PRIMARY KEY CHECK(id), mode text NOT NULL CHECK(mode IN ('normal','offline','lose-response','pending','reject')));
INSERT INTO simulator_control VALUES (true,'normal') ON CONFLICT DO NOTHING;
