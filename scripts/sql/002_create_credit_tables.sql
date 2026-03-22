CREATE TABLE IF NOT EXISTS user_credits (
  user_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 30,
  credit_day DATE NOT NULL DEFAULT ((NOW() AT TIME ZONE 'UTC')::date),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_credits_balance_non_negative CHECK (balance >= 0)
);

ALTER TABLE user_credits
  ADD COLUMN IF NOT EXISTS credit_day DATE;

UPDATE user_credits
SET credit_day = COALESCE(credit_day, (NOW() AT TIME ZONE 'UTC')::date);

ALTER TABLE user_credits
  ALTER COLUMN credit_day SET DEFAULT ((NOW() AT TIME ZONE 'UTC')::date);

ALTER TABLE user_credits
  ALTER COLUMN credit_day SET NOT NULL;

CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  run_id TEXT,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  balance_after INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_ledger_balance_after_non_negative CHECK (balance_after >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_user_run_reason_unique_idx
  ON credit_ledger (user_id, run_id, reason)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS credit_ledger_user_created_idx
  ON credit_ledger (user_id, created_at DESC);
