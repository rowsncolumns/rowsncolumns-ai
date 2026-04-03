import path from "node:path";

import { config as loadEnv } from "dotenv";
import Stripe from "stripe";

loadEnv({
  path: path.resolve(process.cwd(), ".env.local"),
  override: false,
  quiet: true,
});

const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
if (!stripeSecretKey) {
  throw new Error("Missing STRIPE_SECRET_KEY.");
}

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2026-03-25.dahlia",
});

const PRODUCT_NAME = "RowsnColumns AI Credits";

const catalog = [
  {
    kind: "pro" as const,
    lookupKey: process.env.STRIPE_PRICE_LOOKUP_KEY_PRO_MONTHLY ?? "pro_monthly",
    unitAmount: 3500,
    recurring: { interval: "month" as const },
    nickname: "Pro monthly ($35 / 500 credits)",
  },
  {
    kind: "max" as const,
    lookupKey: process.env.STRIPE_PRICE_LOOKUP_KEY_MAX_MONTHLY ?? "max_monthly",
    unitAmount: 20000,
    recurring: { interval: "month" as const },
    nickname: "Max monthly (3500 credits)",
  },
  {
    kind: "topup" as const,
    lookupKey: process.env.STRIPE_PRICE_LOOKUP_KEY_TOPUP_50 ?? "topup_50",
    unitAmount: 5000,
    recurring: null,
    nickname: "Top-up pack ($50 / 800 credits)",
  },
];

const ensureProduct = async () => {
  const products = await stripe.products.list({
    active: true,
    limit: 100,
  });

  const existing = products.data.find((product) => product.name === PRODUCT_NAME);
  if (existing) {
    return existing;
  }

  return stripe.products.create({
    name: PRODUCT_NAME,
    description: "Subscription and top-up pricing for RowsnColumns AI credits.",
    metadata: {
      app: "rowsncolumns-ai",
      type: "credits",
    },
  });
};

const ensurePrice = async (input: {
  productId: string;
  lookupKey: string;
  unitAmount: number;
  recurring: { interval: "month" } | null;
  nickname: string;
}) => {
  const existing = await stripe.prices.list({
    lookup_keys: [input.lookupKey],
    active: true,
    limit: 1,
  });

  if (existing.data[0]) {
    const current = existing.data[0];
    const hasRecurringMismatch =
      (current.recurring?.interval ?? null) !==
      (input.recurring?.interval ?? null);
    const hasAmountMismatch = (current.unit_amount ?? null) !== input.unitAmount;
    const hasCurrencyMismatch = current.currency !== "usd";

    if (hasRecurringMismatch || hasAmountMismatch || hasCurrencyMismatch) {
      return stripe.prices.create({
        currency: "usd",
        product: input.productId,
        unit_amount: input.unitAmount,
        lookup_key: input.lookupKey,
        transfer_lookup_key: true,
        nickname: input.nickname,
        ...(input.recurring ? { recurring: input.recurring } : {}),
        metadata: {
          app: "rowsncolumns-ai",
          lookup_key: input.lookupKey,
        },
      });
    }

    if (current.nickname !== input.nickname) {
      return stripe.prices.update(current.id, {
        nickname: input.nickname,
      });
    }
    return current;
  }

  return stripe.prices.create({
    currency: "usd",
    product: input.productId,
    unit_amount: input.unitAmount,
    lookup_key: input.lookupKey,
    transfer_lookup_key: true,
    nickname: input.nickname,
    ...(input.recurring ? { recurring: input.recurring } : {}),
    metadata: {
      app: "rowsncolumns-ai",
      lookup_key: input.lookupKey,
    },
  });
};

async function main() {
  const product = await ensureProduct();
  console.log(`Using product: ${product.id} (${product.name})`);

  for (const item of catalog) {
    const price = await ensurePrice({
      productId: product.id,
      lookupKey: item.lookupKey,
      unitAmount: item.unitAmount,
      recurring: item.recurring,
      nickname: item.nickname,
    });
    console.log(
      `${item.kind}: ${price.id} (lookup_key=${item.lookupKey}, amount=${item.unitAmount})`,
    );
  }

  console.log("Stripe billing catalog is ready.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
