import crypto from 'crypto';
import { query } from './pool.js';
import { LedgerEngine } from './ledger.js';
import { Environment } from '../types/index.js';
import { MobileNetwork, RailOperation, RailResult, providerByName, providerFor } from '../payments/mobile-money.js';
import { lightpayFeeWallet } from './fee-wallet.js';
import { isPersonWallet, logActivity, maskPhone, reasonFor, updateActivity } from './activity.js';

/**
 * Money leaving LightPay to a phone number (withdrawals, guest refunds).
 *
 *   1. ledger, one transaction (idempotent on `reference`):
 *        wallet --total--> SYSTEM outflow (amount + operator fee) + LIGHTPAY_FEES (LightPay fee)
 *      the provider sends exactly `amount`; its fee is paid on top from our provider balance
 *   2. payout row PENDING, then the provider is asked (idempotent on our payout id)
 *   3. SUCCEEDED -> done · FAILED -> the exact mirror is booked: the total comes back (once)
 *   PENDING payouts are resolved by the watcher, the provider webhook and the sweeper.
 */

export interface PayoutRow {
  id: string;
  environment: Environment;
  wallet_id: string;
  provider: string;
  network: MobileNetwork;
  msisdn: string;
  amount: string;
  currency: string;
  reason: 'WITHDRAWAL' | 'GUEST_REFUND';
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  transaction_id: string | null;
  failure_code: string | null;
  reference: string;
  provider_reference: string | null;
  operator_fee: string;
  lightpay_fee: string;
  total_debited: string | null;
  created_at: Date;
}

export interface SendPayoutInput {
  environment: Environment;
  appId: string;
  walletId: string;
  msisdn: string;
  network: MobileNetwork;
  /** What the phone receives. */
  amount: bigint;
  /** Provider fee, paid on top from our provider balance (covered by the wallet debit). */
  operatorFee?: bigint;
  /** LightPay's fee (credited to LIGHTPAY_FEES). */
  lightpayFee?: bigint;
  currency: string;
  reason: PayoutRow['reason'];
  /** Idempotency of the whole payout (e.g. withdraw:<uid>:<key>, refund:<hold id>). */
  reference: string;
  description: string;
  allowGuestDebit?: boolean;
  metadata?: Record<string, any>;
}

const railOf = (p: PayoutRow): RailOperation => ({
  id: p.id,
  environment: p.environment,
  msisdn: p.msisdn,
  amount: BigInt(p.amount),
  currency: p.currency,
  network: p.network,
  createdAt: new Date(p.created_at),
  providerReference: p.provider_reference,
  description: p.reason === 'GUEST_REFUND' ? 'Remboursement LightPay' : 'Retrait LightPay',
});

export async function sendPayout(input: SendPayoutInput): Promise<PayoutRow> {
  const env = input.environment;
  const [existing] = await query(`SELECT * FROM payouts WHERE reference = $1`, [input.reference], env);
  if (existing) return existing;

  const outflow = await LedgerEngine.getOrCreateGatewayInflow('mainapp', env, input.currency);
  const payoutId = `po_${crypto.randomBytes(18).toString('base64url')}`;
  const provider = providerFor(env, input.network, 'payout');
  // The simulator pays nobody: real money never "leaves" through it (nothing is debited).
  if (env === 'production' && provider.name === 'simulator') throw new Error('Le mobile money est indisponible pour le moment. Réessayez plus tard.');
  const operatorFee = input.operatorFee ?? 0n;
  const lightpayFee = input.lightpayFee ?? 0n;
  if (input.amount <= 0n || operatorFee < 0n || lightpayFee < 0n) throw new Error('Invalid payout amounts');
  const total = input.amount + operatorFee + lightpayFee;
  const feeWallet = lightpayFee > 0n ? await lightpayFeeWallet(env, input.currency) : null;
  const debit = await LedgerEngine.executeTransaction({
    appId: input.appId,
    environment: env,
    idempotencyKey: input.reference,
    type: 'PAYOUT',
    amount: total,
    feeAmount: operatorFee + lightpayFee,
    currency: input.currency,
    metadata: {
      ...(input.metadata ?? {}), payout: payoutId, reason: input.reason, network: input.network, provider: provider.name,
      sent: input.amount.toString(), operator_fee: operatorFee.toString(), lightpay_fee: lightpayFee.toString(),
    },
    allowGuestDebit: input.allowGuestDebit,
    skipQuotas: input.reason === 'GUEST_REFUND',
    postings: [
      { walletId: input.walletId, direction: 'DEBIT', amount: total, description: input.description },
      { walletId: outflow, direction: 'CREDIT', amount: input.amount + operatorFee, description: `Mobile money out [${input.network}] - ${payoutId}` },
      ...(feeWallet ? [{ walletId: feeWallet, direction: 'CREDIT' as const, amount: lightpayFee, description: `Frais LightPay - ${payoutId}` }] : []),
    ],
  });
  if (debit.duplicate) {
    // A concurrent request debited first: return its payout.
    const [again] = await query(`SELECT * FROM payouts WHERE reference = $1`, [input.reference], env);
    if (again) return again;
  }

  const [row] = await query(
    `INSERT INTO payouts (id, environment, wallet_id, provider, network, msisdn, amount, currency, reason, status, transaction_id, reference, operator_fee, lightpay_fee, total_debited)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', $10, $11, $12, $13, $14)
     ON CONFLICT DO NOTHING RETURNING *`,
    [payoutId, env, input.walletId, provider.name, input.network, input.msisdn, input.amount.toString(), input.currency, input.reason,
      (debit as any).transactionId ?? (debit as any).transaction?.id ?? null, input.reference, operatorFee.toString(), lightpayFee.toString(), total.toString()],
    env
  );
  if (row && (await isPersonWallet(env, input.walletId))) {
    await logActivity(env, {
      walletId: input.walletId, kind: input.reason === 'WITHDRAWAL' ? 'WITHDRAWAL' : 'REFUND', direction: 'OUT', status: 'PENDING',
      amount: input.amount, fees: operatorFee + lightpayFee, total, currency: input.currency,
      counterparty: `${input.network === 'AIRTEL_COG' ? 'Airtel Money' : 'MTN MoMo'} · ${maskPhone(input.msisdn)}`, refType: 'payout', refId: payoutId,
    });
  }
  let result: RailResult;
  try {
    result = await provider.requestPayout(railOf(row));
  } catch (err: any) {
    // Network or provider outage: stays PENDING; the idempotent request is retried later.
    console.error('[PAYOUT] request failed, will retry', payoutId, err?.message);
    watch(row);
    return row;
  }
  return applyResult(row, result);
}

async function applyResult(p: PayoutRow, r: RailResult): Promise<PayoutRow> {
  const env = p.environment;
  if (r.status === 'PENDING') {
    const [row] = await query(
      `UPDATE payouts SET provider_reference = COALESCE($2, provider_reference), updated_at = NOW() WHERE id = $1 RETURNING *`,
      [p.id, r.providerReference ?? null],
      env
    );
    watch(row);
    return row;
  }
  if (r.status === 'FAILED') {
    // Exact mirror of the debit (idempotent): the whole total comes back to the wallet.
    const sent = BigInt(p.amount);
    const operatorFee = BigInt(p.operator_fee ?? 0);
    const lightpayFee = BigInt(p.lightpay_fee ?? 0);
    const total = sent + operatorFee + lightpayFee;
    const feeWallet = lightpayFee > 0n ? await lightpayFeeWallet(env, p.currency) : null;
    await LedgerEngine.executeTransaction({
      appId: 'mainapp',
      environment: env,
      idempotencyKey: `${p.reference}:reversal`,
      type: 'REFUND',
      amount: total,
      currency: p.currency,
      skipQuotas: true,
      metadata: { payout: p.id, reason: `${p.reason}_FAILED`, failure: r.failureCode },
      postings: [
        { walletId: (await LedgerEngine.getOrCreateGatewayInflow('mainapp', env, p.currency)), direction: 'DEBIT', amount: sent + operatorFee, description: `Envoi annulé - ${p.id}` },
        ...(feeWallet ? [{ walletId: feeWallet, direction: 'DEBIT' as const, amount: lightpayFee, description: `Frais LightPay remboursés - ${p.id}` }] : []),
        { walletId: p.wallet_id, direction: 'CREDIT', amount: total, description: 'Envoi mobile money échoué, montant et frais restitués' },
      ],
    });
  }
  const [row] = await query(
    `UPDATE payouts SET status = $2, failure_code = $3, provider_reference = COALESCE($4, provider_reference), updated_at = NOW()
     WHERE id = $1 AND status = 'PENDING' RETURNING *`,
    [p.id, r.status, r.failureCode ?? null, r.providerReference ?? null],
    env
  );
  if (row) {
    await updateActivity(env, 'payout', p.id, {
      status: r.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
      reasonCode: r.failureCode ?? null,
      reason: r.status === 'FAILED' ? `${reasonFor(r.failureCode ?? 'PROVIDER_FAILED', 'L’opérateur a refusé l’envoi.')} Montant et frais restitués sur votre wallet.` : null,
    });
  }
  return row ?? (await query(`SELECT * FROM payouts WHERE id = $1`, [p.id], env))[0];
}

const resolving = new Set<string>();

/** Asks the provider where a pending payout stands (or re-sends it if it never got an id). */
export async function resolvePayout(p: PayoutRow): Promise<PayoutRow> {
  if (p.status !== 'PENDING' || resolving.has(p.id)) return p;
  resolving.add(p.id);
  try {
    const provider = providerByName(p.provider);
    const r = p.provider_reference ? await provider.payoutStatus(railOf(p)) : await provider.requestPayout(railOf(p));
    return await applyResult(p, r);
  } finally {
    resolving.delete(p.id);
  }
}

function watch(p: PayoutRow, tries = 0) {
  if (!p || tries > 20) return;
  setTimeout(async () => {
    try {
      const [fresh] = await query(`SELECT * FROM payouts WHERE id = $1`, [p.id], p.environment);
      if (fresh?.status !== 'PENDING') return;
      await resolvePayout(fresh);
      watch(fresh, tries + 1);
    } catch (err: any) {
      console.error('[PAYOUT] resolve failed', p.id, err?.message);
      watch(p, tries + 1);
    }
  }, Math.min(5_000 * 2 ** Math.min(tries, 5), 120_000));
}

export async function findPayoutByProviderReference(providerReference: string): Promise<PayoutRow | undefined> {
  for (const env of ['production', 'sandbox'] as Environment[]) {
    const [p] = await query(`SELECT * FROM payouts WHERE provider_reference = $1`, [providerReference], env);
    if (p) return p;
  }
  return undefined;
}

export const pendingPayouts = (env: Environment) =>
  query<PayoutRow>(`SELECT * FROM payouts WHERE status = 'PENDING' AND created_at < NOW() - interval '20 seconds' ORDER BY created_at LIMIT 50`, [], env);
