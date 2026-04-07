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

CREATE TABLE IF NOT EXISTS organization_billing_profile (
  organization_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  plan_tier TEXT NOT NULL DEFAULT 'free',
  subscription_status TEXT,
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  trial_grant_issued BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_billing_profile_plan_tier_check
    CHECK (plan_tier IN ('free', 'pro', 'max'))
);

CREATE INDEX IF NOT EXISTS organization_billing_profile_plan_tier_idx
  ON organization_billing_profile (plan_tier);

CREATE INDEX IF NOT EXISTS organization_billing_profile_owner_user_idx
  ON organization_billing_profile (owner_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS organization_billing_profile_stripe_customer_idx
  ON organization_billing_profile (stripe_customer_id);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS organization_credits
  ADD COLUMN IF NOT EXISTS daily_free_remaining INTEGER;

DO $$
BEGIN
  IF to_regclass('public.organization_credits') IS NOT NULL THEN
    UPDATE organization_credits
    SET
      daily_free_remaining = LEAST(balance, 30),
      balance = GREATEST(balance - LEAST(balance, 30), 0)
    WHERE daily_free_remaining IS NULL;
  END IF;
END$$;

ALTER TABLE IF EXISTS organization_credits
  ALTER COLUMN balance SET DEFAULT 0;

ALTER TABLE IF EXISTS organization_credits
  ALTER COLUMN daily_free_remaining SET DEFAULT 30;

ALTER TABLE IF EXISTS organization_credits
  ALTER COLUMN daily_free_remaining SET NOT NULL;

DO $$
BEGIN
  IF to_regclass('public.organization_credits') IS NOT NULL
    AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organization_credits_daily_free_non_negative'
  ) THEN
    ALTER TABLE organization_credits
      ADD CONSTRAINT organization_credits_daily_free_non_negative
      CHECK (daily_free_remaining >= 0);
  END IF;
END$$;
