import crypto from 'crypto';
import { query } from './pool.js';
import { LedgerEngine } from './ledger.js';
import { Environment } from '../types/index.js';
import { MobileNetwork, RailOperation, RailResult, providerByName, providerFor } from '../payments/mobile-money.js';

/**
 * Money leaving LightPay to a phone number (withdrawals, guest refunds).
 *
 *   1. ledger: wallet --amount--> SYSTEM outflow (idempotent on `reference`)
 *   2. payout row PENDING, then the provider is asked (idempotent on our payout id)
 *   3. SUCCEEDED -> done · FAILED -> the amount is credited back to the wallet (once)
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
  created_at: Date;
}

export interface SendPayoutInput {
  environment: Environment;
  appId: string;
  walletId: string;
  msisdn: string;
  network: MobileNetwork;
  amount: bigint;
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
  const provider = providerFor(input.network);
  const debit = await LedgerEngine.executeTransaction({
    appId: input.appId,
    environment: env,
    idempotencyKey: input.reference,
    type: 'PAYOUT',
    amount: input.amount,
    currency: input.currency,
    metadata: { ...(input.metadata ?? {}), payout: payoutId, reason: input.reason, network: input.network, provider: provider.name },
    allowGuestDebit: input.allowGuestDebit,
    skipQuotas: input.reason === 'GUEST_REFUND',
    postings: [
      { walletId: input.walletId, direction: 'DEBIT', amount: input.amount, description: input.description },
      { walletId: outflow, direction: 'CREDIT', amount: input.amount, description: `Mobile money out [${input.network}] - ${payoutId}` },
    ],
  });
  if (debit.duplicate) {
    // A concurrent request debited first: return its payout.
    const [again] = await query(`SELECT * FROM payouts WHERE reference = $1`, [input.reference], env);
    if (again) return again;
  }

  const [row] = await query(
    `INSERT INTO payouts (id, environment, wallet_id, provider, network, msisdn, amount, currency, reason, status, transaction_id, reference)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', $10, $11)
     ON CONFLICT DO NOTHING RETURNING *`,
    [payoutId, env, input.walletId, provider.name, input.network, input.msisdn, input.amount.toString(), input.currency, input.reason,
      (debit as any).transactionId ?? (debit as any).transaction?.id ?? null, input.reference],
    env
  );
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
    // Money comes back to the wallet it left (idempotent), then the payout is closed.
    await LedgerEngine.executeTransaction({
      appId: 'mainapp',
      environment: env,
      idempotencyKey: `${p.reference}:reversal`,
      type: 'REFUND',
      amount: BigInt(p.amount),
      currency: p.currency,
      skipQuotas: true,
      metadata: { payout: p.id, reason: `${p.reason}_FAILED`, failure: r.failureCode },
      postings: [
        { walletId: (await LedgerEngine.getOrCreateGatewayInflow('mainapp', env, p.currency)), direction: 'DEBIT', amount: BigInt(p.amount), description: `Envoi annulé - ${p.id}` },
        { walletId: p.wallet_id, direction: 'CREDIT', amount: BigInt(p.amount), description: 'Envoi mobile money échoué, montant restitué' },
      ],
    });
  }
  const [row] = await query(
    `UPDATE payouts SET status = $2, failure_code = $3, provider_reference = COALESCE($4, provider_reference), updated_at = NOW()
     WHERE id = $1 AND status = 'PENDING' RETURNING *`,
    [p.id, r.status, r.failureCode ?? null, r.providerReference ?? null],
    env
  );
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
