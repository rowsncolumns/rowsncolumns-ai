CREATE TABLE IF NOT EXISTS user_billing_profile (
  user_id TEXT PRIMARY KEY,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  plan_tier TEXT NOT NULL DEFAULT 'free',
  subscription_status TEXT,
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  trial_grant_issued BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_billing_profile_plan_tier_check
    CHECK (plan_tier IN ('free', 'pro', 'max'))
);

CREATE INDEX IF NOT EXISTS user_billing_profile_plan_tier_idx
  ON user_billing_profile (plan_tier);

CREATE INDEX IF NOT EXISTS user_billing_profile_stripe_customer_idx
  ON user_billing_profile (stripe_customer_id);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_credits
  ADD COLUMN IF NOT EXISTS daily_free_remaining INTEGER;

UPDATE user_credits
SET
  daily_free_remaining = LEAST(balance, 30),
  balance = GREATEST(balance - LEAST(balance, 30), 0)
WHERE daily_free_remaining IS NULL;

ALTER TABLE user_credits
  ALTER COLUMN balance SET DEFAULT 0;

ALTER TABLE user_credits
  ALTER COLUMN daily_free_remaining SET DEFAULT 30;

ALTER TABLE user_credits
  ALTER COLUMN daily_free_remaining SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_credits_daily_free_non_negative'
  ) THEN
    ALTER TABLE user_credits
      ADD CONSTRAINT user_credits_daily_free_non_negative
      CHECK (daily_free_remaining >= 0);
  END IF;
END$$;
