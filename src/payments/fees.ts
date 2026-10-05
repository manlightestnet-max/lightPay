import { Environment } from '../types/index.js';
import { feeSettings } from './fee-settings.js';

/**
 * Fees and minimums, per ledger, from the admin's settings (./fee-settings.ts). Nothing here
 * comes from the environment: the admin console is the only place they change.
 *
 * Deposits and mobile-money payments
 *   LightPay fee   max(deposit_lightpay_fee_min, ceil(amount × deposit_lightpay_fee_bps / 10 000)),
 *                  added on top, paid by the payer
 *   Operator fee   charged on top, per provider:
 *                  SasPay   its own fee (ADD_ON), shown as an estimate (deposit_operator_fee_bps)
 *                           until SasPay reports the exact amount debited
 *                  pawaPay  pawapay_deposit_fee_bps, asked on top by us (exact): it covers the
 *                           fee pawaPay takes out of our pawaPay balance
 *   The payee (or the wallet being topped up) always receives the requested amount.
 *
 * Payouts (withdrawals, refunds)
 *   Operator fee   SasPay: max(withdrawal_operator_fee_min, amount × withdrawal_operator_fee_bps);
 *                  pawaPay: amount × pawapay_payout_fee_bps. Paid from our provider balance
 *   LightPay fee   max(withdrawal_lightpay_fee_min, amount × withdrawal_lightpay_fee_bps)
 *   The person receives exactly the amount asked; the wallet is debited amount + both fees.
 *   Refunds carry no LightPay fee: the guest gets the largest amount the refund can cover.
 */

const ceilBps = (amount: bigint, bps: number) => (amount * BigInt(bps) + 9_999n) / 10_000n;
const atLeast = (byRate: bigint, min: number) => (byRate > BigInt(min) ? byRate : BigInt(min));

export function lightpayCollectionFee(env: Environment, amount: bigint): bigint {
  const s = feeSettings(env);
  return atLeast(ceilBps(amount, s.deposit_lightpay_fee_bps), s.deposit_lightpay_fee_min);
}

/** Estimated operator fee for a provider, on the amount it is asked to collect. */
export function providerFeeEstimate(env: Environment, provider: string, collected: bigint): bigint {
  if (provider === 'saspay') return ceilBps(collected, feeSettings(env).deposit_operator_fee_bps);
  if (provider === 'pawapay') return ceilBps(collected, feeSettings(env).pawapay_deposit_fee_bps);
  return 0n;
}

/** Smallest mobile-money deposit or payment accepted. */
export const minMobileMoneyAmount = (env: Environment): bigint => BigInt(feeSettings(env).deposit_min);

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

export function quote(env: Environment, amount: bigint, provider: string): FeeQuote {
  const lightpay = lightpayCollectionFee(env, amount);
  const operator = providerFeeEstimate(env, provider, amount + lightpay);
  return {
    amount: amount.toString(),
    lightpay_fee: lightpay.toString(),
    operator_fee: operator.toString(),
    total: (amount + lightpay + operator).toString(),
    minimum: minMobileMoneyAmount(env).toString(),
    // pawaPay's is exactly what we ask; SasPay's is only known once it reports it.
    estimated: provider === 'saspay' && operator > 0n,
  };
}

// ---------------------------------------------------------------- payouts (withdrawals, refunds)

/** Smallest withdrawal. */
export const minWithdrawalAmount = (env: Environment): bigint => BigInt(feeSettings(env).withdrawal_min);

export function lightpayPayoutFee(env: Environment, amount: bigint): bigint {
  const s = feeSettings(env);
  return atLeast(ceilBps(amount, s.withdrawal_lightpay_fee_bps), s.withdrawal_lightpay_fee_min);
}

/** Operator fee on a payout of `amount` (what the phone receives). */
export function providerPayoutFee(env: Environment, provider: string, amount: bigint): bigint {
  if (provider === 'pawapay') return ceilBps(amount, feeSettings(env).pawapay_payout_fee_bps);
  if (provider !== 'saspay') return 0n;
  const s = feeSettings(env);
  return atLeast(ceilBps(amount, s.withdrawal_operator_fee_bps), s.withdrawal_operator_fee_min);
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

export function withdrawalQuote(env: Environment, amount: bigint, provider: string, currency: string): WithdrawalQuote {
  const operator = providerPayoutFee(env, provider, amount);
  const lightpay = lightpayPayoutFee(env, amount);
  return {
    amount: amount.toString(),
    operator_fee: operator.toString(),
    lightpay_fee: lightpay.toString(),
    total: (amount + operator + lightpay).toString(),
    minimum: minWithdrawalAmount(env).toString(),
    currency,
    estimated: false,
  };
}

/**
 * Largest amount s ≥ 1 that can be sent with `total` once the operator fee is paid on top
 * (s + fee(s) ≤ total), or 0 when even the fee cannot be covered. s + fee(s) is strictly
 * increasing, so a binary search is exact.
 */
export function refundSendable(env: Environment, total: bigint, provider: string): bigint {
  let lo = 0n;
  let hi = total;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (mid + providerPayoutFee(env, provider, mid) <= total) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}
