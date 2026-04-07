CREATE TABLE IF NOT EXISTS organization_credits (
  organization_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 30,
  credit_day DATE NOT NULL DEFAULT ((NOW() AT TIME ZONE 'UTC')::date),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_credits_balance_non_negative CHECK (balance >= 0)
);

ALTER TABLE organization_credits
  ADD COLUMN IF NOT EXISTS credit_day DATE;

UPDATE organization_credits
SET credit_day = COALESCE(credit_day, (NOW() AT TIME ZONE 'UTC')::date);

ALTER TABLE organization_credits
  ALTER COLUMN credit_day SET DEFAULT ((NOW() AT TIME ZONE 'UTC')::date);

ALTER TABLE organization_credits
  ALTER COLUMN credit_day SET NOT NULL;

CREATE TABLE IF NOT EXISTS organization_credit_ledger (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  run_id TEXT,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  balance_after INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_credit_ledger_balance_after_non_negative CHECK (balance_after >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_credit_ledger_org_run_reason_unique_idx
  ON organization_credit_ledger (organization_id, run_id, reason)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS organization_credit_ledger_org_created_idx
  ON organization_credit_ledger (organization_id, created_at DESC);
