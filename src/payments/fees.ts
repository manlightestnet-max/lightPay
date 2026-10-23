import { Environment } from '../types/index.js';
import { DEFAULT_COUNTRY } from '../rails/registry.js';
import { feeSettings } from './fee-settings.js';
import { operatorFee } from './provider-fees.js';

/**
 * Fees and minimums, per ledger, all set by the admin in « Frais et minimums »: LightPay's own fees and the swap
 * (./fee-settings.ts), the operator fees of each provider per operator (./provider-fees.ts). Nothing comes from the
 * environment, nothing from a provider's API by itself.
 *
 * Deposits and mobile-money payments
 *   LightPay fee   max(deposit_lightpay_fee_min, ceil(amount × deposit_lightpay_fee_bps / 10 000)),
 *                  added on top, paid by the payer
 *   Operator fee   charged on top: the admin's rate of the provider for this operator.
 *                  SasPay   shown as an estimate until SasPay reports the exact amount debited
 *                  pawaPay  asked on top by us (exact): it covers the fee pawaPay takes out of our balance
 *   The payee (or the wallet being topped up) always receives the requested amount.
 *
 * Payouts (withdrawals, refunds)
 *   Operator fee   the admin's payout rate of the provider for this operator. Paid from our provider balance.
 *                  Without a rate (none for the operator, no default) LightPay refuses: it would pay the fee
 *   LightPay fee   max(withdrawal_lightpay_fee_min, amount × withdrawal_lightpay_fee_bps)
 *   The person receives exactly the amount asked; the wallet is debited amount + both fees.
 *   Refunds to a guest's phone carry the same two fees as a withdrawal (operator + LightPay), taken out
 *   of the refund itself: the guest gets the largest amount that, fees included, fits in what they paid.
 *
 * Swap (money that changes country): max(swap_fee_min, ceil(amount × swap_fee_bps / 10 000)), never inside a
 * country. Paid on top by the person who moves their money (withdrawal, deposit, send, move between their own
 * wallets); taken from what a seller of another country receives for a sale.
 */

const ceilBps = (amount: bigint, bps: number) => (amount * BigInt(bps) + 9_999n) / 10_000n;
const atLeast = (byRate: bigint, min: number) => (byRate > BigInt(min) ? byRate : BigInt(min));

export class FeeError extends Error {
  statusCode = 503;
  constructor(message: string, public code = 'OPERATOR_PRICE_UNAVAILABLE') {
    super(message);
  }
}

export function lightpayCollectionFee(env: Environment, amount: bigint): bigint {
  const s = feeSettings(env);
  return atLeast(ceilBps(amount, s.deposit_lightpay_fee_bps), s.deposit_lightpay_fee_min);
}

/** Operator fee for a provider, on the amount it is asked to collect through this operator (0 without a rate). */
export function providerFeeEstimate(env: Environment, provider: string, network: string, collected: bigint): bigint {
  if (provider === 'simulator') return 0n;
  return operatorFee(env, provider, network, 'collection', collected) ?? 0n;
}

/** Smallest mobile-money deposit or payment accepted. */
export const minMobileMoneyAmount = (env: Environment): bigint => BigInt(feeSettings(env).deposit_min);

export interface FeeQuote {
  amount: string;
  lightpay_fee: string;
  operator_fee: string;
  /** LightPay's swap fee: the money changes country (0 inside a country). */
  swap_fee: string;
  total: string;
  /** Smallest amount accepted by mobile money. */
  minimum: string;
  /** false once the provider reported the exact amount debited. */
  estimated: boolean;
}

export function quote(env: Environment, amount: bigint, provider: string, network: string, swap = 0n): FeeQuote {
  const lightpay = lightpayCollectionFee(env, amount);
  const operator = providerFeeEstimate(env, provider, network, amount + lightpay + swap);
  return {
    amount: amount.toString(),
    lightpay_fee: lightpay.toString(),
    operator_fee: operator.toString(),
    swap_fee: swap.toString(),
    total: (amount + lightpay + swap + operator).toString(),
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

/**
 * Operator fee on a payout of `amount` (what the phone receives) through this operator: the admin's rate. Refused
 * without one (LightPay would pay the fee out of its own balance).
 */
export function providerPayoutFee(env: Environment, provider: string, network: string, amount: bigint): bigint {
  if (provider === 'simulator') return 0n;
  const fee = operatorFee(env, provider, network, 'payout', amount);
  if (fee === null) throw new FeeError('Le tarif de l’opérateur n’est pas réglé. Réessayez plus tard.');
  return fee;
}

export interface WithdrawalQuote {
  /** What the phone receives. */
  amount: string;
  operator_fee: string;
  lightpay_fee: string;
  /** LightPay's swap fee: the number is in another country than the wallet (0 otherwise). */
  swap_fee: string;
  /** What leaves the wallet. */
  total: string;
  minimum: string;
  currency: string;
  estimated: boolean;
}

export function withdrawalQuote(env: Environment, amount: bigint, provider: string, network: string, currency: string, swap = 0n): WithdrawalQuote {
  const operator = providerPayoutFee(env, provider, network, amount);
  const lightpay = lightpayPayoutFee(env, amount);
  return {
    amount: amount.toString(),
    operator_fee: operator.toString(),
    lightpay_fee: lightpay.toString(),
    swap_fee: swap.toString(),
    total: (amount + operator + lightpay + swap).toString(),
    minimum: minWithdrawalAmount(env).toString(),
    currency,
    estimated: false,
  };
}

/**
 * Largest amount s ≥ 1 that can be sent with `total` once both payout fees are paid out of it
 * (s + operator fee(s) + LightPay fee(s) ≤ total), or 0 when even the fees cannot be covered.
 * The cost is strictly increasing in s, so a binary search is exact.
 */
export function refundSendable(env: Environment, total: bigint, provider: string, network: string): bigint {
  const cost = (s: bigint) => s + providerPayoutFee(env, provider, network, s) + lightpayPayoutFee(env, s);
  let lo = 0n;
  let hi = total;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (cost(mid) <= total) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

export interface RefundBreakdown {
  /** What the phone receives. */
  sent: bigint;
  operator_fee: bigint;
  lightpay_fee: bigint;
}

/**
 * A refund of `total` to a guest: what is sent and the two fees. The few francs left over by
 * rounding count as operator fee, so sent + operator_fee + lightpay_fee is exactly `total`.
 */
export function refundBreakdown(env: Environment, total: bigint, provider: string, network: string): RefundBreakdown {
  const sent = refundSendable(env, total, provider, network);
  if (sent <= 0n) return { sent: 0n, operator_fee: 0n, lightpay_fee: 0n };
  const lightpay = lightpayPayoutFee(env, sent);
  return { sent, operator_fee: total - sent - lightpay, lightpay_fee: lightpay };
}

/** LightPay's swap fee on an amount that changes country (never more than the amount). */
export function swapFee(env: Environment, amount: bigint): bigint {
  if (amount <= 0n) return 0n;
  const s = feeSettings(env);
  const fee = atLeast(ceilBps(amount, s.swap_fee_bps), s.swap_fee_min);
  return fee < amount ? fee : amount;
}

/** Two countries are the same one (a wallet or number without a country counts as Congo, like the routing). */
export const sameCountry = (a?: string | null, b?: string | null) => (a || DEFAULT_COUNTRY) === (b || DEFAULT_COUNTRY);

/** The swap fee when money goes from country `from` to country `to`: 0 inside a country. */
export const swapBetween = (env: Environment, from: string | null | undefined, to: string | null | undefined, amount: bigint): bigint =>
  sameCountry(from, to) ? 0n : swapFee(env, amount);
