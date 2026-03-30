import assert from "node:assert/strict";

import { INITIAL_CREDITS } from "../lib/credits/pricing";
import {
  chargeFromBuckets,
  getAvailableCredits,
  resolveDailyFreeBucketForDay,
} from "../lib/credits/buckets";

type TestCase = {
  name: string;
  run: () => void;
};

const tests: TestCase[] = [
  {
    name: "free users spend daily credits before paid balance",
    run: () => {
      const result = chargeFromBuckets({
        requestedCredits: 20,
        useDailyFreeBucket: true,
        buckets: {
          dailyFreeRemaining: 10,
          paidBalance: 50,
        },
      });

      assert.equal(result.chargedCredits, 20);
      assert.equal(result.chargedFromDailyFree, 10);
      assert.equal(result.chargedFromPaid, 10);
      assert.equal(result.buckets.dailyFreeRemaining, 0);
      assert.equal(result.buckets.paidBalance, 40);
      assert.equal(getAvailableCredits(result.buckets), 40);
    },
  },
  {
    name: "paid users spend only paid balance",
    run: () => {
      const result = chargeFromBuckets({
        requestedCredits: 20,
        useDailyFreeBucket: false,
        buckets: {
          dailyFreeRemaining: INITIAL_CREDITS,
          paidBalance: 50,
        },
      });

      assert.equal(result.chargedCredits, 20);
      assert.equal(result.chargedFromDailyFree, 0);
      assert.equal(result.chargedFromPaid, 20);
      assert.equal(result.buckets.dailyFreeRemaining, INITIAL_CREDITS);
      assert.equal(result.buckets.paidBalance, 30);
      assert.equal(
        getAvailableCredits(result.buckets),
        INITIAL_CREDITS + 30,
      );
    },
  },
  {
    name: "daily reset applies only to free bucket",
    run: () => {
      assert.equal(
        resolveDailyFreeBucketForDay({
          usesDailyFreeBucket: true,
          isSameCreditDay: false,
          currentDailyFreeRemaining: 0,
          freeDailyResetAmount: INITIAL_CREDITS,
        }),
        INITIAL_CREDITS,
      );

      assert.equal(
        resolveDailyFreeBucketForDay({
          usesDailyFreeBucket: false,
          isSameCreditDay: false,
          currentDailyFreeRemaining: 12,
          freeDailyResetAmount: INITIAL_CREDITS,
        }),
        0,
      );
    },
  },
];

const run = async () => {
  let passed = 0;

  for (const test of tests) {
    test.run();
    passed += 1;
    console.log(`PASS ${test.name}`);
  }

  console.log(`\n${passed}/${tests.length} credit-bucket tests passed`);
};

run().catch((error) => {
  console.error("FAIL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
