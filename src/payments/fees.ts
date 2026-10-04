/**
 * Fees shown to the payer before a mobile-money payment, and taken by LightPay.
 *
 *   LightPay fee   max(LIGHTPAY_MOMO_FEE_MIN, ceil(amount × LIGHTPAY_MOMO_FEE_BPS / 10 000))
 *                  default: 5 FCFA minimum, 0 % — added on top, paid by the payer
 *   Operator fee   charged by the provider on top (SasPay ADD_ON). Shown as an estimate
 *                  (SASPAY_COLLECTION_FEE_BPS, default 650 = 6,5 %) until the provider
 *                  reports the exact amount debited.
 *
 * The payee (or the wallet being topped up) always receives the requested amount.
 */

const int = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

const ceilBps = (amount: bigint, bps: number) => (amount * BigInt(bps) + 9_999n) / 10_000n;

export function lightpayCollectionFee(amount: bigint): bigint {
  const min = BigInt(int(process.env.LIGHTPAY_MOMO_FEE_MIN, 5));
  const byRate = ceilBps(amount, int(process.env.LIGHTPAY_MOMO_FEE_BPS, 0));
  return byRate > min ? byRate : min;
}

/** Estimated operator fee for a provider, on the amount it is asked to collect. */
export function providerFeeEstimate(provider: string, collected: bigint): bigint {
  if (provider === 'saspay') return ceilBps(collected, int(process.env.SASPAY_COLLECTION_FEE_BPS, 650));
  return 0n;
}

/** Smallest mobile-money payment accepted (SasPay itself accepts 200 XAF; we ask 1 000). */
export const minMobileMoneyAmount = (): bigint => BigInt(int(process.env.MOMO_MIN_AMOUNT, 1000));

export interface FeeQuote {
  amount: string;
  lightpay_fee: string;
  operator_fee: string;
  total: string;
  /** Smallest amount accepted by mobile money. */
  minimum: string;
  /** false once the provider reported the exact amount debited. */
  estimated: boolean;
}

export function quote(amount: bigint, provider: string): FeeQuote {
  const lightpay = lightpayCollectionFee(amount);
  const operator = providerFeeEstimate(provider, amount + lightpay);
  return {
    amount: amount.toString(),
    lightpay_fee: lightpay.toString(),
    operator_fee: operator.toString(),
    total: (amount + lightpay + operator).toString(),
    minimum: minMobileMoneyAmount().toString(),
    estimated: operator > 0n,
  };
}

// ---------------------------------------------------------------- payouts (withdrawals, refunds)
//
//   Operator fee   SasPay Congo: 4 % of the amount, charged on top from our SasPay balance (ADD_ON)
//                  — SASPAY_PAYOUT_FEE_BPS (400) / SASPAY_PAYOUT_FEE_MIN (0). Measured on a real
//                  payout (500 XAF -> 20 XAF fee): the 700 XAF floor on their pricing page is not applied.
//   LightPay fee   max(LIGHTPAY_PAYOUT_FEE_MIN (5), amount × LIGHTPAY_PAYOUT_FEE_BPS (0))
//   The person receives exactly the amount asked; the wallet is debited amount + both fees.
//   Refunds carry no LightPay fee: the guest gets the largest amount the refund can cover.

/** Smallest withdrawal (SasPay's own payout minimum is 200 XAF). */
export const minWithdrawalAmount = (): bigint => BigInt(int(process.env.WITHDRAWAL_MIN_AMOUNT, 200));

export function lightpayPayoutFee(amount: bigint): bigint {
  const min = BigInt(int(process.env.LIGHTPAY_PAYOUT_FEE_MIN, 5));
  const byRate = ceilBps(amount, int(process.env.LIGHTPAY_PAYOUT_FEE_BPS, 0));
  return byRate > min ? byRate : min;
}

/** Operator fee on a payout of `amount` (what the phone receives). */
export function providerPayoutFee(provider: string, amount: bigint): bigint {
  if (provider !== 'saspay') return 0n;
  const byRate = ceilBps(amount, int(process.env.SASPAY_PAYOUT_FEE_BPS, 400));
  const min = BigInt(int(process.env.SASPAY_PAYOUT_FEE_MIN, 0));
  return byRate > min ? byRate : min;
}

export interface WithdrawalQuote {
  /** What the phone receives. */
  amount: string;
  operator_fee: string;
  lightpay_fee: string;
  /** What leaves the wallet. */
  total: string;
  minimum: string;
  currency: string;
  estimated: boolean;
}

export function withdrawalQuote(amount: bigint, provider: string, currency: string): WithdrawalQuote {
  const operator = providerPayoutFee(provider, amount);
  const lightpay = lightpayPayoutFee(amount);
  return {
    amount: amount.toString(),
    operator_fee: operator.toString(),
    lightpay_fee: lightpay.toString(),
    total: (amount + operator + lightpay).toString(),
    minimum: minWithdrawalAmount().toString(),
    currency,
    estimated: false,
  };
}

/**
 * Largest amount s ≥ 1 that can be sent with `total` once the operator fee is paid on top
 * (s + fee(s) ≤ total), or 0 when even the fee cannot be covered. s + fee(s) is strictly
 * increasing, so a binary search is exact.
 */
export function refundSendable(total: bigint, provider: string): bigint {
  let lo = 0n;
  let hi = total;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (mid + providerPayoutFee(provider, mid) <= total) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}
