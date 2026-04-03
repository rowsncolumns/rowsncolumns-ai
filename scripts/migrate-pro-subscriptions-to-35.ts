import path from "node:path";

import { config as loadEnv } from "dotenv";
import postgres from "postgres";
import Stripe from "stripe";

loadEnv({
  path: path.resolve(process.cwd(), ".env.local"),
  override: false,
  quiet: true,
});

const requireEnv = (name: string, message: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(message);
  }
  return value;
};

const databaseUrl = requireEnv(
  "DATABASE_URL",
  "Missing required config: DATABASE_URL. Set it in .env.local.",
);

const stripeSecretKey = requireEnv(
  "STRIPE_SECRET_KEY",
  "Missing STRIPE_SECRET_KEY.",
);

const proLookupKey =
  process.env.STRIPE_PRICE_LOOKUP_KEY_PRO_MONTHLY?.trim() || "pro_monthly";
const apply = process.argv.includes("--apply");

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2026-03-25.dahlia",
});

type BillingProfileRow = {
  user_id: string;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
};

async function resolveTargetProPrice() {
  const response = await stripe.prices.list({
    lookup_keys: [proLookupKey],
    active: true,
    limit: 1,
  });

  const price = response.data[0];
  if (!price) {
    throw new Error(
      `Stripe price lookup key '${proLookupKey}' was not found in active prices.`,
    );
  }

  if ((price.unit_amount ?? 0) !== 3500) {
    throw new Error(
      `Target Pro price must be 3500 cents, got ${price.unit_amount ?? "null"} (${price.id}).`,
    );
  }

  if (price.recurring?.interval !== "month") {
    throw new Error(
      `Target Pro price must be monthly recurring, got ${price.recurring?.interval ?? "none"} (${price.id}).`,
    );
  }

  return price;
}

async function main() {
  const sql = postgres(databaseUrl, {
    prepare: false,
    ssl: "require",
  });

  const updated: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  try {
    const targetProPrice = await resolveTargetProPrice();
    console.log(
      `Using target Pro price ${targetProPrice.id} (${targetProPrice.unit_amount} cents).`,
    );
    console.log(
      apply
        ? "Running in APPLY mode: subscriptions will be updated."
        : "Running in DRY-RUN mode: no subscriptions will be changed. Pass --apply to execute.",
    );

    const rows = await sql<BillingProfileRow[]>`
      SELECT
        user_id,
        stripe_subscription_id,
        subscription_status
      FROM user_billing_profile
      WHERE plan_tier = 'pro'
        AND subscription_status IN ('active', 'canceling')
        AND stripe_subscription_id IS NOT NULL
      ORDER BY updated_at DESC
    `;

    console.log(`Found ${rows.length} candidate Pro billing profiles.`);

    for (const row of rows) {
      const subscriptionId = row.stripe_subscription_id;
      if (!subscriptionId) {
        continue;
      }

      try {
        const subscription =
          await stripe.subscriptions.retrieve(subscriptionId);
        const currentItem = subscription.items.data[0];

        if (!currentItem) {
          skipped.push(`${subscriptionId}:missing_subscription_item`);
          continue;
        }

        const currentPrice = currentItem.price;
        if (currentPrice.id === targetProPrice.id) {
          skipped.push(`${subscriptionId}:already_target_price`);
          continue;
        }

        const currentAmount = currentPrice.unit_amount ?? null;
        const currentInterval = currentPrice.recurring?.interval ?? null;

        if (currentInterval !== "month") {
          skipped.push(`${subscriptionId}:non_monthly_price`);
          continue;
        }

        if (currentAmount !== 3000 && currentAmount !== 3500) {
          skipped.push(
            `${subscriptionId}:unexpected_amount_${currentAmount ?? "null"}`,
          );
          continue;
        }

        if (!apply) {
          updated.push(subscriptionId);
          continue;
        }

        await stripe.subscriptions.update(subscription.id, {
          items: [
            {
              id: currentItem.id,
              price: targetProPrice.id,
            },
          ],
          proration_behavior: "none",
        });

        updated.push(subscriptionId);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown_error";
        failed.push(`${subscriptionId}:${message}`);
      }
    }

    console.log("");
    console.log(`Summary (${apply ? "APPLY" : "DRY-RUN"}):`);
    console.log(`  Will update / Updated: ${updated.length}`);
    console.log(`  Skipped: ${skipped.length}`);
    console.log(`  Failed: ${failed.length}`);

    if (updated.length > 0) {
      console.log("");
      console.log(`${apply ? "Updated" : "Would update"} subscriptions:`);
      for (const id of updated) {
        console.log(`  - ${id}`);
      }
    }

    if (skipped.length > 0) {
      console.log("");
      console.log("Skipped subscriptions:");
      for (const item of skipped) {
        console.log(`  - ${item}`);
      }
    }

    if (failed.length > 0) {
      console.log("");
      console.log("Failed subscriptions:");
      for (const item of failed) {
        console.log(`  - ${item}`);
      }
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
