export type CreditBuckets = {
  dailyFreeRemaining: number;
  paidBalance: number;
};

export type ChargeBucketsInput = {
  requestedCredits: number;
  buckets: CreditBuckets;
  useDailyFreeBucket: boolean;
};

export type ChargedBucketsResult = {
  chargedCredits: number;
  chargedFromDailyFree: number;
  chargedFromPaid: number;
  buckets: CreditBuckets;
};

const clampNonNegativeInteger = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
};

export const resolveDailyFreeBucketForDay = (input: {
  usesDailyFreeBucket: boolean;
  isSameCreditDay: boolean;
  currentDailyFreeRemaining: number;
  freeDailyResetAmount: number;
}) => {
  if (!input.usesDailyFreeBucket) {
    return 0;
  }

  if (input.isSameCreditDay) {
    return clampNonNegativeInteger(input.currentDailyFreeRemaining);
  }

  return clampNonNegativeInteger(input.freeDailyResetAmount);
};

export const getAvailableCredits = (buckets: CreditBuckets) =>
  clampNonNegativeInteger(buckets.dailyFreeRemaining) +
  clampNonNegativeInteger(buckets.paidBalance);

export const chargeFromBuckets = (
  input: ChargeBucketsInput,
): ChargedBucketsResult => {
  const requested = clampNonNegativeInteger(input.requestedCredits);
  const dailyFreeRemaining = clampNonNegativeInteger(
    input.buckets.dailyFreeRemaining,
  );
  const paidBalance = clampNonNegativeInteger(input.buckets.paidBalance);

  if (requested <= 0) {
    return {
      chargedCredits: 0,
      chargedFromDailyFree: 0,
      chargedFromPaid: 0,
      buckets: {
        dailyFreeRemaining,
        paidBalance,
      },
    };
  }

  const chargedFromDailyFree = input.useDailyFreeBucket
    ? Math.min(dailyFreeRemaining, requested)
    : 0;
  const remainingRequested = requested - chargedFromDailyFree;
  const chargedFromPaid = Math.min(paidBalance, remainingRequested);
  const chargedCredits = chargedFromDailyFree + chargedFromPaid;

  return {
    chargedCredits,
    chargedFromDailyFree,
    chargedFromPaid,
    buckets: {
      dailyFreeRemaining: dailyFreeRemaining - chargedFromDailyFree,
      paidBalance: paidBalance - chargedFromPaid,
    },
  };
};
