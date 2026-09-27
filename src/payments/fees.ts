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

export interface FeeQuote {
  amount: string;
  lightpay_fee: string;
  operator_fee: string;
  total: string;
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
    estimated: operator > 0n,
  };
}
