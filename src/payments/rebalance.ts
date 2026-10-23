import crypto from 'crypto';
import { query } from '../db/pool.js';
import { LedgerEngine } from '../db/ledger.js';
import { Environment } from '../types/index.js';
import { providerByName, TransferOperation, TransferResult } from './mobile-money.js';
import { PROVIDERS_OF } from './provider-settings.js';
import { reserveAvailable } from './reserve-watch.js';
import { levelsOf, reserveSettings } from './reserve-settings.js';
import { countryByCode, countryOfNetwork, DEFAULT_COUNTRY } from '../rails/registry.js';
import { controlSettings } from './control-settings.js';

/**
 * Rebalancing: LightPay moves its own money from one country wallet of a provider to another (SasPay
 * wallet-transfers) so that every country can keep sending. People's wallets never move: only the provider's
 * wallets do, and the transfer's cost (provider fee + what the rate or rounding lost) is booked as a provider cost
 * (SYSTEM_PROVIDER_COSTS), attributed to the country that received.
 *
 * One transfer at a time per provider (SasPay refuses a second while one waits): transfers wait in a queue
 * (provider_transfers, QUEUED), the next one is asked as soon as the previous one ends. A withdrawal to a country
 * short of funds is programmed and waits for the transfer that refills it (payouts.waiting_transfer).
 * pawaPay has no API for it: its wallets are never rebalanced by LightPay.
 */

export interface TransferRow {
  id: string;
  environment: Environment;
  provider: string;
  from_country: string;
  to_country: string;
  amount: string;
  status: 'QUEUED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  provider_reference: string | null;
  received: string | null;
  received_currency: string | null;
  rate: string | null;
  fee: string | null;
  failure_code: string | null;
  reason: 'manual' | 'low' | 'payout';
  requested_by: string | null;
  cost_transaction_id: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export class RebalanceError extends Error {
  constructor(message: string, public code = 'INVALID_TRANSFER', public statusCode = 400) {
    super(message);
  }
}

/** The provider can move money between its country wallets, with its keys on this ledger. */
export const canTransfer = (env: Environment, provider: string) => {
  if (!(PROVIDERS_OF[env] as readonly string[]).includes(provider)) return false;
  const p = providerByName(provider);
  return Boolean(p.transfer && p.transferStatus) && p.configured(env);
};

const opOf = (t: TransferRow): TransferOperation => ({
  id: t.id,
  environment: t.environment,
  fromCountry: t.from_country,
  toCountry: t.to_country,
  amount: BigInt(t.amount),
  providerReference: t.provider_reference,
});

const max = (a: bigint, b: bigint) => (a > b ? a : b);

// ---------------------------------------------------------------- planning

/** The countries where a provider holds a wallet LightPay knows of (it was read or typed at least once). */
async function walletCountries(env: Environment, provider: string): Promise<string[]> {
  const rows = await query(`SELECT DISTINCT COALESCE(country, $3) AS country FROM provider_balance_checks WHERE environment = $1 AND provider = $2`, [env, provider, DEFAULT_COUNTRY], env);
  return rows.map((r) => String(r.country).trim());
}

/** Money already on its way to (or leaving) a country: transfers queued or asked. */
async function inFlight(env: Environment, provider: string, country: string, side: 'to' | 'from'): Promise<bigint> {
  const [r] = await query(
    `SELECT COALESCE(SUM(amount), 0)::text AS amount FROM provider_transfers
     WHERE environment = $1 AND provider = $2 AND ${side === 'to' ? 'to_country' : 'from_country'} = $3 AND status IN ('QUEUED', 'PENDING')`,
    [env, provider, country],
    env
  );
  return BigInt(r.amount);
}

export interface TransferPlan {
  from: string;
  amount: bigint;
  /** What the source can give above its own target. */
  surplus: bigint;
}

export interface Candidate {
  country: string;
  available: bigint | null;
  surplus: bigint;
}

/** The other wallets of a provider and what each can give: available − transfers leaving − its own target (or low threshold). */
export async function transferSources(env: Environment, provider: string, to: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const country of await walletCountries(env, provider)) {
    if (country === to) continue;
    const available = await reserveAvailable(env, provider, country);
    const levels = levelsOf(env, provider, country);
    const keep = BigInt(Math.max(levels.target, levels.low));
    const surplus = available === null ? 0n : available - (await inFlight(env, provider, country, 'from')) - keep;
    out.push({ country, available, surplus: surplus > 0n ? surplus : 0n });
  }
  const currency = countryByCode(to)?.currency;
  // Same currency first (no rate, no rounding), then the largest surplus.
  return out.sort((a, b) => Number(countryByCode(b.country)?.currency === currency) - Number(countryByCode(a.country)?.currency === currency) || (b.surplus > a.surplus ? 1 : b.surplus < a.surplus ? -1 : 0));
}

/**
 * Where to take money from, and how much, to bring a provider wallet back to its target level, or at least to cover
 * `need` (a withdrawal waiting). A margin (admin setting) covers the provider's fee and rounding on the way, and an
 * automatic transfer is never smaller than the admin's minimum (a tiny transfer loses most of itself to the fee and the
 * rounding). Null when nothing is missing or no other wallet can give enough.
 */
export async function planTransfer(env: Environment, provider: string, to: string, need = 0n): Promise<TransferPlan | null> {
  const available = (await reserveAvailable(env, provider, to)) ?? 0n;
  const coming = await inFlight(env, provider, to, 'to');
  const short = need - available - coming;
  const wanted = max(short, BigInt(levelsOf(env, provider, to).target) - available - coming);
  if (wanted <= 0n) return null;
  const marginBps = BigInt(reserveSettings(env).transfer_margin_bps);
  const withMargin = (x: bigint) => x + (x * marginBps + 9_999n) / 10_000n;
  const floor = BigInt(reserveSettings(env).transfer_min);
  const [best] = (await transferSources(env, provider, to)).filter((c) => c.surplus > 0n && c.surplus >= floor);
  if (!best) return null;
  const ask = max(withMargin(wanted), floor);
  const amount = ask < best.surplus ? ask : best.surplus;
  // A withdrawal needs its whole amount: a smaller transfer would leave it stuck.
  if (short > 0n && amount < withMargin(short)) return null;
  return { from: best.country, amount, surplus: best.surplus };
}

// ---------------------------------------------------------------- the queue

export async function requestTransfer(
  env: Environment,
  input: { provider: string; from: string; to: string; amount: bigint; reason: TransferRow['reason']; by: string }
): Promise<TransferRow> {
  const provider = input.provider.toLowerCase();
  if (!canTransfer(env, provider)) throw new RebalanceError('Ce fournisseur ne peut pas transférer entre ses wallets ici.', 'TRANSFER_NOT_SUPPORTED');
  if (!countryByCode(input.from) || !countryByCode(input.to)) throw new RebalanceError('Pays inconnu.', 'BAD_COUNTRY');
  if (input.from === input.to) throw new RebalanceError('Choisissez deux pays différents.', 'SAME_COUNTRY');
  if (input.amount <= 0n) throw new RebalanceError('Montant en FCFA entiers, plus grand que zéro.', 'BAD_AMOUNT');
  const [row] = await query<TransferRow>(
    `INSERT INTO provider_transfers (id, environment, provider, from_country, to_country, amount, reason, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [`tr_${crypto.randomBytes(12).toString('base64url')}`, env, provider, input.from, input.to, input.amount.toString(), input.reason, input.by],
    env
  );
  await pumpTransfers(env, provider).catch((err) => console.error('[REBALANCE] pump failed', env, err?.message));
  const [now] = await query<TransferRow>(`SELECT * FROM provider_transfers WHERE id = $1`, [row.id], env);
  return now;
}

/** The admin withdraws a transfer still waiting in the queue (never one already asked to the provider). */
export async function cancelTransfer(env: Environment, id: string): Promise<TransferRow> {
  const [row] = await query<TransferRow>(
    `UPDATE provider_transfers SET status = 'CANCELLED', updated_at = NOW(), completed_at = NOW() WHERE id = $1 AND status = 'QUEUED' RETURNING *`,
    [id],
    env
  );
  if (!row) throw new RebalanceError('Seul un transfert encore en file peut être annulé.', 'NOT_CANCELLABLE', 409);
  await releaseWaiting(env, row.id);
  return row;
}

/** Asks the next queued transfer of a provider, when none is waiting for the provider's answer. */
export async function pumpTransfers(env: Environment, provider: string): Promise<void> {
  const [next] = await query<TransferRow>(
    `UPDATE provider_transfers SET status = 'PENDING', updated_at = NOW()
     WHERE id = (SELECT id FROM provider_transfers WHERE environment = $1 AND provider = $2 AND status = 'QUEUED' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
       AND NOT EXISTS (SELECT 1 FROM provider_transfers WHERE environment = $1 AND provider = $2 AND status = 'PENDING')
     RETURNING *`,
    [env, provider],
    env
  );
  if (next) await ask(next);
}

/** Sends (or re-sends: same idempotency key) a transfer to its provider and applies the answer. */
async function ask(t: TransferRow): Promise<void> {
  let result: TransferResult;
  try {
    result = await providerByName(t.provider).transfer!(opOf(t));
  } catch (err: any) {
    // No answer: it may have arrived. It stays PENDING without reference and is asked again (idempotent).
    console.error('[REBALANCE] transfer request failed, will retry', t.id, err?.message);
    return;
  }
  if (result.status === 'PENDING' && result.failureCode === 'ALREADY_PENDING') {
    // Another transfer is waiting at the provider (made from its dashboard): ours goes back in line.
    await query(`UPDATE provider_transfers SET status = 'QUEUED', updated_at = NOW() WHERE id = $1 AND status = 'PENDING'`, [t.id], t.environment);
    return;
  }
  await apply(t, result);
}

/** Records the provider's answer; a final one books the cost, frees the withdrawals waiting and asks the next. */
async function apply(t: TransferRow, r: TransferResult): Promise<void> {
  const env = t.environment;
  if (r.status === 'PENDING') {
    if (r.providerReference && r.providerReference !== t.provider_reference) {
      await query(`UPDATE provider_transfers SET provider_reference = $2, updated_at = NOW() WHERE id = $1`, [t.id, r.providerReference], env);
    }
    return;
  }
  if (r.status === 'FAILED') {
    const [row] = await query<TransferRow>(
      `UPDATE provider_transfers SET status = 'FAILED', failure_code = $2, provider_reference = COALESCE($3, provider_reference), updated_at = NOW(), completed_at = NOW()
       WHERE id = $1 AND status = 'PENDING' RETURNING *`,
      [t.id, (r.failureCode ?? 'PROVIDER_FAILED').slice(0, 60), r.providerReference ?? null],
      env
    );
    if (row) console.warn('[REBALANCE] transfer refused', t.id, r.failureCode);
  } else {
    const [row] = await query<TransferRow>(
      `UPDATE provider_transfers SET status = 'SUCCEEDED', provider_reference = COALESCE($2, provider_reference), received = $3, received_currency = $4, rate = $5, fee = $6,
              updated_at = NOW(), completed_at = NOW()
       WHERE id = $1 AND status = 'PENDING' RETURNING *`,
      [t.id, r.providerReference ?? null, (r.received ?? BigInt(t.amount)).toString(), r.receivedCurrency ?? null, r.rate ?? null, (r.fee ?? 0n).toString()],
      env
    );
    if (row) await bookCost(row);
  }
  // Arrived or refused, the withdrawals waiting for it leave now (a refusal: they are tried as before, refunded if they fail).
  await releaseWaiting(env, t.id);
  await pumpTransfers(env, t.provider);
}

const costsWallet = async (env: Environment) =>
  (
    await query(
      `INSERT INTO wallets (app_id, account_id, account_type, currency, environment, metadata)
       VALUES ('mainapp', 'SYSTEM_PROVIDER_COSTS', 'SYSTEM', 'XAF', $1, '{"role":"provider_costs","desc":"Ce que les fournisseurs ont pris pour les transferts entre pays"}')
       ON CONFLICT (app_id, account_id, currency, environment) DO UPDATE SET updated_at = NOW() RETURNING id`,
      [env],
      env
    )
  )[0].id as string;

/**
 * What the transfer cost at the provider: sent − received. SasPay's to_amount is what stays in the receiving wallet
 * once its fee is taken (23 October: 5 XOF sent, +4 XAF then −1 fee in its dashboard, to_amount 3), so the fee is
 * already inside the difference. It left the provider's wallets: booked out of the transit account, against the
 * provider costs, in the receiving country.
 */
async function bookCost(t: TransferRow): Promise<void> {
  const cost = BigInt(t.amount) - BigInt(t.received ?? t.amount);
  if (cost <= 0n || t.cost_transaction_id) return;
  const env = t.environment;
  const transit = await LedgerEngine.getOrCreateGatewayInflow('mainapp', env, 'XAF');
  const result: any = await LedgerEngine.executeTransaction({
    appId: 'mainapp',
    environment: env,
    idempotencyKey: `transfer-cost:${t.id}`,
    type: 'DISBURSEMENT',
    amount: cost,
    currency: 'XAF',
    skipQuotas: true,
    metadata: { provider: t.provider, transfer: t.id, country: t.to_country, from_country: t.from_country, sent: t.amount, received: t.received, fee: t.fee },
    postings: [
      { walletId: transit, direction: 'CREDIT', amount: cost, description: `Frais fournisseur - transfert ${t.id}` },
      { walletId: await costsWallet(env), direction: 'DEBIT', amount: cost, description: `Frais fournisseur - transfert ${t.id}` },
    ],
  });
  const txId = result?.transactionId ?? result?.transaction?.id ?? null;
  if (txId) await query(`UPDATE provider_transfers SET cost_transaction_id = $2 WHERE id = $1`, [t.id, txId], env);
}

/**
 * A payout written after its transfer already ended (SasPay can answer COMPLETED at once, before the payout row
 * exists): released now instead of waiting a day.
 */
export async function releaseIfTransferEnded(env: Environment, transferId: string): Promise<void> {
  const [t] = await query(`SELECT status FROM provider_transfers WHERE id = $1`, [transferId], env);
  if (t && t.status !== 'QUEUED' && t.status !== 'PENDING') await releaseWaiting(env, transferId);
}

/** The withdrawals and refunds waiting for this transfer leave once their own delay has passed. */
async function releaseWaiting(env: Environment, transferId: string): Promise<void> {
  const s = controlSettings(env);
  await query(
    `UPDATE payouts SET waiting_transfer = NULL, updated_at = NOW(),
            release_at = GREATEST(created_at + make_interval(mins => CASE WHEN reason = 'WITHDRAWAL' THEN $2::int ELSE $3::int END), NOW())
     WHERE waiting_transfer = $1 AND status = 'SCHEDULED'`,
    [transferId, s.withdrawal_delay_minutes, s.refund_delay_minutes],
    env
  );
}

/** Follows the transfers asked to the providers (every minute, and on their notifications), then asks the next ones. */
export async function sweepTransfers(env: Environment): Promise<void> {
  const pending = await query<TransferRow>(`SELECT * FROM provider_transfers WHERE environment = $1 AND status = 'PENDING' ORDER BY created_at`, [env], env);
  for (const t of pending) {
    try {
      if (!t.provider_reference) await ask(t);
      else await apply(t, await providerByName(t.provider).transferStatus!(opOf(t)));
    } catch (err: any) {
      console.error('[REBALANCE] transfer not checked', t.id, err?.message);
    }
  }
  for (const provider of PROVIDERS_OF[env]) if (canTransfer(env, provider)) await pumpTransfers(env, provider).catch(() => undefined);
}

/** A provider notification about a transfer: the state is re-read from the provider before anything changes. */
export async function resolveTransferByReference(reference: string): Promise<boolean> {
  for (const env of ['production', 'sandbox'] as Environment[]) {
    const [t] = await query<TransferRow>(`SELECT * FROM provider_transfers WHERE provider_reference = $1`, [reference], env);
    if (!t) continue;
    if (t.status === 'PENDING') await apply(t, await providerByName(t.provider).transferStatus!(opOf(t)));
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- when to rebalance by itself

/**
 * A withdrawal of `total` (amount + operator fee) through this provider to this operator's country: the transfer it
 * must wait for, or null when it can leave as usual (enough money there, never read, no transfer possible).
 */
export async function transferForPayout(env: Environment, provider: string, network: string, total: bigint): Promise<string | null> {
  if (!reserveSettings(env).rebalance_payouts || !canTransfer(env, provider)) return null;
  const country = countryOfNetwork(network) ?? DEFAULT_COUNTRY;
  // Only toward a wallet the admin manages (its target level set): never on its own initiative elsewhere.
  if (levelsOf(env, provider, country).target <= 0) return null;
  const available = await reserveAvailable(env, provider, country);
  if (available === null || available >= total) return null;
  if (available + (await inFlight(env, provider, country, 'to')) >= total) {
    const [open] = await query(
      `SELECT id FROM provider_transfers WHERE environment = $1 AND provider = $2 AND to_country = $3 AND status IN ('QUEUED', 'PENDING') ORDER BY created_at DESC LIMIT 1`,
      [env, provider, country],
      env
    );
    return open?.id ?? null;
  }
  const plan = await planTransfer(env, provider, country, total);
  if (!plan) return null;
  return (await requestTransfer(env, { provider, from: plan.from, to: country, amount: plan.amount, reason: 'payout', by: 'auto' })).id;
}

/** Every wallet below its low threshold, with a target set and nothing on its way, is refilled (admin setting, off by default). */
export async function rebalanceLowWallets(env: Environment): Promise<number> {
  if (!reserveSettings(env).rebalance_low) return 0;
  let asked = 0;
  for (const provider of PROVIDERS_OF[env]) {
    if (!canTransfer(env, provider)) continue;
    for (const country of await walletCountries(env, provider)) {
      const levels = levelsOf(env, provider, country);
      if (!levels.low || !levels.target) continue;
      const available = await reserveAvailable(env, provider, country);
      if (available === null || available >= BigInt(levels.low) || (await inFlight(env, provider, country, 'to')) > 0n) continue;
      const plan = await planTransfer(env, provider, country);
      if (!plan) continue;
      await requestTransfer(env, { provider, from: plan.from, to: country, amount: plan.amount, reason: 'low', by: 'auto' });
      asked++;
    }
  }
  return asked;
}

// ---------------------------------------------------------------- reading (admin)

export const listTransfers = (env: Environment, limit = 50) =>
  query<TransferRow>(`SELECT * FROM provider_transfers WHERE environment = $1 ORDER BY created_at DESC LIMIT $2`, [env, Math.min(Math.max(limit, 1), 200)], env);

export async function getTransfer(env: Environment, id: string) {
  const [t] = await query<TransferRow>(`SELECT * FROM provider_transfers WHERE id = $1 AND environment = $2`, [id, env], env);
  if (!t) throw new RebalanceError('Transfert introuvable.', 'NOT_FOUND', 404);
  const waiting = await query(`SELECT id, amount::text, status, created_at FROM payouts WHERE waiting_transfer = $1 ORDER BY created_at`, [id], env);
  return { transfer: t, waiting };
}
