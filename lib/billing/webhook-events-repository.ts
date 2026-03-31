import { db } from "@/lib/db/postgres";

type StripeWebhookEventRow = {
  event_id: string;
};

let ensureStripeWebhookSchemaPromise: Promise<void> | null = null;

const ensureStripeWebhookSchemaReady = async () => {
  if (ensureStripeWebhookSchemaPromise) {
    await ensureStripeWebhookSchemaPromise;
    return;
  }

  ensureStripeWebhookSchemaPromise = (async () => {
    await db`
      CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
  })();

  try {
    await ensureStripeWebhookSchemaPromise;
  } catch (error) {
    ensureStripeWebhookSchemaPromise = null;
    throw error;
  }
};

export async function hasProcessedStripeWebhookEvent(eventId: string) {
  await ensureStripeWebhookSchemaReady();
  const rows = await db<StripeWebhookEventRow[]>`
    SELECT event_id
    FROM public.stripe_webhook_events
    WHERE event_id = ${eventId}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function markStripeWebhookEventProcessed(input: {
  eventId: string;
  eventType: string;
  payload: unknown;
}) {
  await ensureStripeWebhookSchemaReady();
  await db`
    INSERT INTO public.stripe_webhook_events (
      event_id,
      event_type,
      payload
    )
    VALUES (
      ${input.eventId},
      ${input.eventType},
      ${JSON.stringify(input.payload ?? {})}::jsonb
    )
    ON CONFLICT (event_id) DO NOTHING
  `;
}
