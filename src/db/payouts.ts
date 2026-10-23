import crypto from 'crypto';
import { query } from './pool.js';
import { LedgerEngine } from './ledger.js';
import { Environment } from '../types/index.js';
import { numberFitsNetwork } from '../rails/registry.js';
import { releaseIfTransferEnded, transferForPayout } from '../payments/rebalance.js';
import { MobileNetwork, networkName, providerByName, providerFor, RailOperation, RailResult } from '../payments/mobile-money.js';
import { lightpayFeeWallet, settlePayoutFee } from './fee-wallet.js';
import { isPersonWallet, logActivity, maskPhone, reasonFor, updateActivity } from './activity.js';
import { controlSettings } from '../payments/control-settings.js';
import { withdrawalsClosed } from '../security/lockdown.js';

/**
 * Money leaving LightPay to a phone number (withdrawals, guest refunds).
 *
 *   1. ledger, one transaction (idempotent on `reference`):
 *        wallet --total--> SYSTEM outflow (amount + operator fee) + LIGHTPAY_FEES (LightPay fee)
 *      the provider sends exactly `amount`; its fee is paid on top from our provider balance
 *   2. payout row PENDING, then the provider is asked (idempotent on our payout id)
 *   3. SUCCEEDED -> the LightPay fee leaves LIGHTPAY_FEES (pending) for the main wallet (once)
 *      FAILED    -> the exact mirror is booked: the total comes back (once)
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
  /** SCHEDULED: waiting for release_at · HELD: kept by the admin · PENDING: asked to the provider. */
  status: 'SCHEDULED' | 'HELD' | 'PENDING' | 'SUCCEEDED' | 'FAILED';
  release_at: Date | null;
  hold_kind: 'DISPUTE' | 'SUPPORT' | 'OTHER' | null;
  hold_reason: string | null;
  held_by: string | null;
  held_at: Date | null;
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
  /** LightPay's fee; includes the swap fee when there is one (same road: pending, returned on failure). */
  lightpayFee?: bigint;
  /** The part of lightpayFee that is the swap fee (the money changes country). */
  swapFee?: bigint;
  currency: string;
  reason: PayoutRow['reason'];
  /** Idempotency of the whole payout (e.g. withdraw:<uid>:<key>, refund:<hold id>). */
  reference: string;
  description: string;
  allowGuestDebit?: boolean;
  metadata?: Record<string, any>;
  /** The provider chosen by the routing rules (the one whose fee was quoted); default: the admin's payout provider. */
  provider?: string;
  /** The rule that chose it (admin only). */
  routingRule?: string | null;
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
  // Never send to a number of another operator (the provider would fail or misroute it).
  if (!numberFitsNetwork(input.msisdn, input.network)) throw new Error(`Ce numéro n’est pas un numéro ${networkName(input.network)}.`);
  const provider = input.provider ? providerByName(input.provider) : providerFor(env, input.network, 'payout');
  // The simulator pays nobody: real money never "leaves" through it (nothing is debited).
  if (env === 'production' && provider.name === 'simulator') throw new Error('Le mobile money est indisponible pour le moment. Réessayez plus tard.');
  const operatorFee = input.operatorFee ?? 0n;
  const lightpayFee = input.lightpayFee ?? 0n;
  const swapFee = input.swapFee ?? 0n;
  if (input.amount <= 0n || operatorFee < 0n || lightpayFee < 0n || swapFee < 0n || swapFee > lightpayFee) throw new Error('Invalid payout amounts');
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
      ...(swapFee > 0n ? { swap_fee: swapFee.toString() } : {}),
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

  // The admin's delay: the money is debited now, but only leaves for the phone once the delay has passed (and is not held).
  // While the emergency brake keeps payouts closed, a refund is still booked but waits until they reopen.
  const settings = controlSettings(env);
  const delayMinutes = input.reason === 'WITHDRAWAL' ? settings.withdrawal_delay_minutes : settings.refund_delay_minutes;
  // Not enough money at the provider in that country: the payout waits for a transfer from another of its wallets
  // (released when it arrives, src/payments/rebalance.ts). Programmed for a day at most meanwhile.
  const waitingTransfer = await transferForPayout(env, provider.name, input.network, input.amount + operatorFee).catch((err) => {
    console.error('[PAYOUT] rebalancing not asked', payoutId, err?.message);
    return null;
  });
  const scheduled = delayMinutes > 0 || withdrawalsClosed() || waitingTransfer !== null;
  const [row] = await query(
    `INSERT INTO payouts (id, environment, wallet_id, provider, network, msisdn, amount, currency, reason, status, transaction_id, reference, operator_fee, lightpay_fee, total_debited, release_at, routing_rule, waiting_transfer, swap_fee)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $15::varchar, $10, $11, $12, $13, $14,
             CASE WHEN $18::varchar IS NOT NULL THEN NOW() + interval '1 day' WHEN $15::varchar = 'SCHEDULED' THEN NOW() + make_interval(mins => $16::int) END, $17, $18, $19)
     ON CONFLICT DO NOTHING RETURNING *`,
    [payoutId, env, input.walletId, provider.name, input.network, input.msisdn, input.amount.toString(), input.currency, input.reason,
      (debit as any).transactionId ?? (debit as any).transaction?.id ?? null, input.reference, operatorFee.toString(), lightpayFee.toString(), total.toString(),
      scheduled ? 'SCHEDULED' : 'PENDING', delayMinutes, input.routingRule ?? null, waitingTransfer, swapFee.toString()],
    env
  );
  // The transfer may have ended before this row existed (an instant answer): the payout must not wait a day for it.
  if (row && waitingTransfer) {
    await releaseIfTransferEnded(env, waitingTransfer).catch((err) => console.error('[PAYOUT] release after transfer failed', payoutId, err?.message));
  }
  if (row && (await isPersonWallet(env, input.walletId))) {
    await logActivity(env, {
      walletId: input.walletId, kind: input.reason === 'WITHDRAWAL' ? 'WITHDRAWAL' : 'REFUND', direction: 'OUT', status: 'PENDING',
      amount: input.amount, fees: operatorFee + lightpayFee, total, currency: input.currency,
      counterparty: `${networkName(input.network)} · ${maskPhone(input.msisdn)}`, refType: 'payout', refId: payoutId,
      metadata: swapFee > 0n ? { swap_fee: swapFee.toString() } : undefined,
    });
  }
  // Waiting: the sweeper sends it at release_at (dispatchDuePayouts).
  if (row.status === 'SCHEDULED') return row;
  return dispatch(row);
}

/** Asks the provider to send a payout (idempotent on our payout id). An outage leaves it PENDING, retried by the sweeper. */
async function dispatch(row: PayoutRow): Promise<PayoutRow> {
  let result: RailResult;
  try {
    result = await providerByName(row.provider).requestPayout(railOf(row));
  } catch (err: any) {
    console.error('[PAYOUT] request failed, will retry', row.id, err?.message);
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
  if (row?.status === 'SUCCEEDED') {
    // Confirmed: the fee is LightPay's for good. A failure here is caught up by scripts/settle-fees-to-main.ts.
    await settlePayoutFee(row).catch((err) => console.error('[PAYOUT] fee not moved to the main wallet yet', row.id, err?.message));
  }
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
  query<PayoutRow>(`SELECT * FROM payouts WHERE status = 'PENDING' AND updated_at < NOW() - interval '20 seconds' ORDER BY created_at LIMIT 50`, [], env);

// ---------------------------------------------------------------- delays and holds (the admin's control)

export class PayoutControlError extends Error {
  constructor(message: string, public code: string, public statusCode = 409) {
    super(message);
  }
}

/** Sends every payout whose delay has passed (called every few seconds). Nothing leaves while the emergency brake keeps payouts closed. */
export async function dispatchDuePayouts(env: Environment): Promise<number> {
  if (withdrawalsClosed()) return 0;
  const due = await query<PayoutRow>(
    `UPDATE payouts SET status = 'PENDING', updated_at = NOW()
     WHERE id IN (SELECT id FROM payouts WHERE status = 'SCHEDULED' AND release_at <= NOW() ORDER BY release_at LIMIT 20 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [],
    env
  );
  for (const row of due) await dispatch(row).catch((err) => console.error('[PAYOUT] release failed', row.id, err?.message));
  return due.length;
}

export const HOLD_KINDS = ['DISPUTE', 'SUPPORT', 'OTHER'] as const;
export type HoldKind = (typeof HOLD_KINDS)[number];

/** The admin keeps a waiting payout (a dispute, a support case…): it does not leave until released or cancelled. */
export async function holdPayout(env: Environment, id: string, kind: unknown, reason: unknown, by: string): Promise<PayoutRow> {
  if (!(HOLD_KINDS as readonly string[]).includes(String(kind))) throw new PayoutControlError('Motif inconnu : litige, support ou autre.', 'INVALID_HOLD_KIND', 400);
  const note = String(reason ?? '').trim().slice(0, 300);
  if (!note) throw new PayoutControlError('Indiquez la raison : elle reste dans le journal.', 'REASON_REQUIRED', 400);
  const [row] = await query<PayoutRow>(
    `UPDATE payouts SET status = 'HELD', hold_kind = $2, hold_reason = $3, held_by = $4, held_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'SCHEDULED' RETURNING *`,
    [id, kind, note, by],
    env
  );
  if (!row) throw new PayoutControlError('Seul un envoi programmé, pas encore parti, peut être retenu.', 'NOT_SCHEDULED');
  return row;
}

/** `now`: a held or waiting payout is sent at the next pass (within seconds). */
export async function releasePayout(env: Environment, id: string): Promise<PayoutRow> {
  const [row] = await query<PayoutRow>(
    `UPDATE payouts SET status = 'SCHEDULED', release_at = NOW(), waiting_transfer = NULL, hold_kind = NULL, hold_reason = NULL, held_by = NULL, held_at = NULL, updated_at = NOW()
     WHERE id = $1 AND status IN ('SCHEDULED', 'HELD') RETURNING *`,
    [id],
    env
  );
  if (!row) throw new PayoutControlError('Cet envoi n’est ni programmé ni retenu.', 'NOT_WAITING');
  return row;
}

/** The admin cancels a waiting payout: the wallet gets the total back (amount and fees), the person is told it was refused. */
export async function cancelWaitingPayout(env: Environment, id: string): Promise<PayoutRow> {
  const [row] = await query<PayoutRow>(
    `UPDATE payouts SET status = 'PENDING', updated_at = NOW() WHERE id = $1 AND status IN ('SCHEDULED', 'HELD') RETURNING *`,
    [id],
    env
  );
  if (!row) throw new PayoutControlError('Cet envoi n’est ni programmé ni retenu.', 'NOT_WAITING');
  try {
    return await applyResult(row, { status: 'FAILED', failureCode: 'CANCELLED_BY_ADMIN' });
  } catch (err) {
    // The money could not be given back (brake on, outage): keep it held, never let the sweeper send it.
    await query(`UPDATE payouts SET status = 'HELD', hold_kind = COALESCE(hold_kind, 'OTHER'), hold_reason = COALESCE(hold_reason, 'Annulation à reprendre'), updated_at = NOW() WHERE id = $1 AND status = 'PENDING' AND provider_reference IS NULL`, [id], env);
    throw err;
  }
}

const ADMIN_COLUMNS = `p.id, p.status, p.reason, p.amount::text, p.operator_fee::text, p.lightpay_fee::text, p.swap_fee::text, p.total_debited::text, p.currency, p.network, p.msisdn, p.provider,
  p.failure_code, p.reference, p.created_at, p.updated_at, p.release_at, p.hold_kind, p.hold_reason, p.held_by, p.held_at, p.waiting_transfer,
  w.account_type AS owner_type, w.metadata->>'name' AS owner_name, w.metadata->>'email' AS owner_email`;
const adminView = (r: any) => ({ ...r, msisdn: maskPhone(r.msisdn) });

/** Withdrawals and refunds for the admin. `upcoming`: waiting or held · `all`: the latest 100. */
export async function listPayoutsAdmin(env: Environment, filter: string) {
  const where = filter === 'held' ? `p.status = 'HELD'` : filter === 'upcoming' ? `p.status IN ('SCHEDULED', 'HELD')` : 'TRUE';
  const rows = await query(
    `SELECT ${ADMIN_COLUMNS} FROM payouts p JOIN wallets w ON w.id = p.wallet_id WHERE ${where}
     ORDER BY ${filter === 'all' ? 'p.created_at DESC' : "p.release_at ASC NULLS LAST, p.created_at ASC"} LIMIT 100`,
    [],
    env
  );
  return rows.map(adminView);
}

/** How long payouts really took from the request to the end, over the last 30 days (what the admin watches to set the delays). */
export const payoutTimings = (env: Environment) =>
  query(
    `SELECT reason, COUNT(*)::int AS n,
            COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at))), 0)::int AS avg_seconds,
            COALESCE(MAX(EXTRACT(EPOCH FROM (updated_at - created_at))), 0)::int AS max_seconds
     FROM payouts WHERE status = 'SUCCEEDED' AND created_at > NOW() - INTERVAL '30 days' GROUP BY reason`,
    [],
    env
  );

export async function getPayoutAdmin(env: Environment, id: string) {
  const [row] = await query(`SELECT ${ADMIN_COLUMNS} FROM payouts p JOIN wallets w ON w.id = p.wallet_id WHERE p.id = $1`, [id], env);
  return row ? adminView(row) : null;
}
