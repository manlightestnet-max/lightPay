import crypto from 'crypto';
import { query } from './pool.js';
import { LedgerEngine } from './ledger.js';
import { logActivity } from './activity.js';
import { minMobileMoneyAmount } from '../payments/fees.js';
import { Environment } from '../types/index.js';
import { allCountries, countryByCode, DEFAULT_COUNTRY, railByNetwork } from '../rails/registry.js';
import { providerByName } from '../payments/mobile-money.js';
import { PROVIDERS_OF } from '../payments/provider-settings.js';
import { levelsOf, reserveSettings, walletKey } from '../payments/reserve-settings.js';
import { FCFA } from '../payments/reserve-watch.js';
import { canTransfer } from '../payments/rebalance.js';

/**
 * LightPay admin console (owner only). Reads the ledger as it is, never rewrites it:
 *   - revenue: LightPay's fees (deposit, payment, withdrawal), credited to the main wallet; a payout's fee waits in
 *     LIGHTPAY_FEES until the operator confirms the send (./fee-wallet.ts);
 *   - provider reserves: per provider wallet (provider + country), money collected minus money paid out through the
 *     transit account, i.e. what should be sitting there (to compare with its balance, read automatically or typed);
 *   - wallet main (SYSTEM_MAIN_TREASURY): the owner's own funds, separate from client money.
 * Money moves only through the ledger engine: sending from the main wallet (which can never go
 * below zero) and recharging it with a real mobile-money deposit. No withdrawal from here.
 * In the test ledger the same wallet is the faucet: the owner issues test money into it (balanced
 * against SANDBOX_FAUCET_ISSUE, whose negative balance is all the test money ever issued) and
 * sends it to whoever tests. Issuing is refused in production.
 */

const CURRENCY = 'XAF';

export class AdminError extends Error {
  constructor(message: string, public code: string, public statusCode = 400) {
    super(message);
  }
}

export interface AdminUser {
  uid: string;
  email: string | null;
}

export type Period = 'day' | 'week' | 'month' | 'all';
const since = (p: Period) =>
  p === 'day' ? "NOW() - INTERVAL '1 day'" : p === 'week' ? "NOW() - INTERVAL '7 days'" : p === 'month' ? "NOW() - INTERVAL '30 days'" : "'epoch'::timestamptz";

const SYSTEM_LABELS: Record<string, string> = {
  SYSTEM_GATEWAY_INFLOW: 'Réserve providers',
  SYSTEM_MAIN_TREASURY: 'Wallet main',
  LIGHTPAY_FEES: 'Frais en attente',
  SYSTEM_PROVIDER_COSTS: 'Frais fournisseurs (transferts)',
  SANDBOX_FAUCET_ISSUE: 'Émission du faucet',
};
/** The test ledger names the main wallet after what it is there: the faucet. */
const labelsFor = (env: Environment) => (env === 'sandbox' ? { ...SYSTEM_LABELS, SYSTEM_MAIN_TREASURY: 'Faucet' } : SYSTEM_LABELS);

const maskPhone = (p: string) => (p.length > 4 ? `${p.slice(0, 2)} ••• ${p.slice(-2)}` : p);

/** How a wallet is named in the console. */
export const walletLabel = (w: { account_id: string; account_type: string; app_id: string; metadata?: any }, env: Environment = 'production') => {
  const labels = labelsFor(env);
  if (labels[w.account_id]) return labels[w.account_id];
  if (w.account_type === 'USER') return w.metadata?.name || w.metadata?.email || 'Utilisateur LightPay';
  if (w.account_type === 'GUEST') return `Invité ${maskPhone(String(w.metadata?.msisdn ?? w.account_id.replace(/^guest:/, '')))}`;
  if (w.account_type === 'MERCHANT') return `App ${w.app_id}`;
  return `${w.app_id} · ${w.account_id}`;
};

/** The main wallet if it exists (reading never creates it). */
const findMain = async (env: Environment): Promise<string | null> =>
  (await query(`SELECT id FROM wallets WHERE app_id = 'mainapp' AND account_id = 'SYSTEM_MAIN_TREASURY' AND currency = $1`, [CURRENCY], env))[0]?.id ?? null;
const mainBalance = async (env: Environment) => {
  const id = await findMain(env);
  return id ? (await query(`SELECT available_balance::text FROM wallets WHERE id = $1`, [id], env))[0].available_balance : '0';
};

// ---------------------------------------------------------------- overview (revenue first)

/**
 * A payout the provider refused is debited, then given back whole by a REFUND carrying
 * metadata.payout: both cancel out and are left out of revenue, volumes and counts.
 * A payout fee given back afterwards (REFUND with metadata.payout_id) lowers what was paid out.
 */
const NOT_CANCELLED = `NOT (t.type = 'REFUND' AND t.metadata ? 'payout')
  AND t.id NOT IN (SELECT transaction_id FROM payouts WHERE status = 'FAILED' AND transaction_id IS NOT NULL)`;
const FEE_GIVEN_BACK = `(t.type = 'REFUND' AND t.metadata ? 'payout_id')`;
/** Shown status: a refused payout is "annulé", its give-back "restitution". */
const SHOWN_STATUS = `CASE
    WHEN t.type = 'PAYOUT' AND EXISTS (SELECT 1 FROM payouts p WHERE p.transaction_id = t.id AND p.status = 'FAILED') THEN 'REVERSED'
    WHEN t.type = 'REFUND' AND t.metadata ? 'payout' THEN 'GIVEN_BACK'
    ELSE t.status END`;

export async function overview(env: Environment, period: Period) {
  const from = since(period);
  const [revenue, flows, counts, daily, ledger, main, byProvider] = await Promise.all([
    // LightPay's own revenue: what its fee wallet kept, by what produced it.
    query(
      `SELECT CASE
                WHEN t.type = 'PAYOUT' OR ${FEE_GIVEN_BACK} THEN 'withdrawal'
                WHEN t.type = 'COLLECTION' AND (t.metadata->>'deposit') = 'true' THEN 'deposit'
                WHEN t.type = 'COLLECTION' THEN 'payment'
                ELSE 'other' END AS source,
              COALESCE(SUM(CASE WHEN le.direction = 'CREDIT' THEN le.amount ELSE -le.amount END), 0)::text AS amount,
              COUNT(*) FILTER (WHERE le.direction = 'CREDIT')::int AS count
       FROM ledger_entries le
       JOIN wallets w ON w.id = le.wallet_id AND w.account_id IN ('LIGHTPAY_FEES', 'SYSTEM_MAIN_TREASURY') AND w.currency = $1 AND le.description LIKE 'Frais LightPay%'
       JOIN transactions t ON t.id = le.transaction_id AND t.status = 'SUCCESS'
       WHERE le.created_at >= ${from} AND ${NOT_CANCELLED}
       GROUP BY 1`,
      [CURRENCY],
      env
    ),
    // Money in from / out to the providers (the transit account's movements).
    query(
      `SELECT COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'DEBIT' AND NOT ${FEE_GIVEN_BACK}), 0)::text AS money_in,
              (COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'CREDIT'), 0)
                - COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'DEBIT' AND ${FEE_GIVEN_BACK}), 0))::text AS money_out,
              COUNT(*) FILTER (WHERE le.direction = 'DEBIT' AND NOT ${FEE_GIVEN_BACK})::int AS ins,
              COUNT(*) FILTER (WHERE le.direction = 'CREDIT')::int AS outs
       FROM ledger_entries le
       JOIN wallets w ON w.id = le.wallet_id AND w.account_id = 'SYSTEM_GATEWAY_INFLOW' AND w.currency = $1
       JOIN transactions t ON t.id = le.transaction_id
       WHERE le.created_at >= ${from} AND ${NOT_CANCELLED}`,
      [CURRENCY],
      env
    ),
    query(
      `SELECT (SELECT COUNT(*) FROM transactions t WHERE t.status = 'SUCCESS' AND t.created_at >= ${from} AND ${NOT_CANCELLED})::int AS transactions,
              (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE status = 'SUCCESS' AND type IN ('PAYMENT', 'HOLD') AND created_at >= ${from})::text AS payments_volume,
              (SELECT COUNT(*) FROM transactions WHERE status = 'SUCCESS' AND type IN ('PAYMENT', 'HOLD') AND created_at >= ${from})::int AS payments,
              (SELECT COUNT(*) FROM wallets WHERE account_type = 'USER' AND app_id = 'mainapp' AND is_default)::int AS users,
              (SELECT COUNT(*) FROM wallets WHERE account_type = 'USER' AND app_id = 'mainapp' AND is_default AND created_at >= ${from})::int AS new_users,
              (SELECT COUNT(*) FROM wallets WHERE account_type = 'GUEST')::int AS guests,
              (SELECT COUNT(*) FROM apps WHERE id <> 'mainapp' AND is_active = TRUE)::int AS apps,
              (SELECT COUNT(*) FROM connections WHERE status = 'ACTIVE')::int AS connections`,
      [],
      env
    ),
    // Last 30 days, one bar per day: successful transactions and revenue.
    query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day,
              (SELECT COUNT(*) FROM transactions t WHERE t.status = 'SUCCESS' AND t.created_at >= d AND t.created_at < d + INTERVAL '1 day' AND ${NOT_CANCELLED})::int AS transactions,
              (SELECT COALESCE(SUM(CASE WHEN le.direction = 'CREDIT' THEN le.amount ELSE -le.amount END), 0)
                 FROM ledger_entries le JOIN wallets w ON w.id = le.wallet_id AND w.account_id IN ('LIGHTPAY_FEES', 'SYSTEM_MAIN_TREASURY') AND w.currency = $1 AND le.description LIKE 'Frais LightPay%'
                 JOIN transactions t ON t.id = le.transaction_id
                WHERE le.created_at >= d AND le.created_at < d + INTERVAL '1 day' AND ${NOT_CANCELLED})::text AS revenue
       FROM generate_series(date_trunc('day', NOW()) - INTERVAL '29 days', date_trunc('day', NOW()), INTERVAL '1 day') AS d
       ORDER BY d`,
      [CURRENCY],
      env
    ),
    query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'DEBIT'), 0)::text AS debit,
              COALESCE(SUM(amount) FILTER (WHERE direction = 'CREDIT'), 0)::text AS credit
       FROM ledger_entries`,
      [],
      env
    ),
    mainBalance(env),
    providerStats(env, period),
  ]);
  // Transactions whose debits and credits differ (only the sandbox faucet's initial test money).
  const unbalanced =
    ledger[0].debit === ledger[0].credit
      ? []
      : await query(
          `SELECT t.id, t.type, t.created_at, SUM(CASE WHEN le.direction = 'CREDIT' THEN le.amount ELSE -le.amount END)::text AS gap
           FROM transactions t JOIN ledger_entries le ON le.transaction_id = t.id
           GROUP BY t.id HAVING SUM(CASE WHEN le.direction = 'CREDIT' THEN le.amount ELSE -le.amount END) <> 0
           ORDER BY t.created_at LIMIT 10`,
          [],
          env
        );

  const bySource = Object.fromEntries(['deposit', 'payment', 'withdrawal', 'other'].map((s) => [s, { amount: '0', count: 0 }])) as Record<string, { amount: string; count: number }>;
  for (const r of revenue) bySource[r.source] = { amount: r.amount, count: r.count };
  const revenueTotal = Object.values(bySource).reduce((sum, r) => sum + BigInt(r.amount), 0n);

  return {
    period,
    currency: CURRENCY,
    revenue: { total: revenueTotal.toString(), by_source: bySource },
    money_in: flows[0].money_in,
    money_out: flows[0].money_out,
    deposits_count: flows[0].ins,
    payouts_count: flows[0].outs,
    ...counts[0],
    daily,
    ledger: { debit: ledger[0].debit, credit: ledger[0].credit, balanced: ledger[0].debit === ledger[0].credit, unbalanced },
    main_balance: main,
    by_provider: byProvider,
  };
}

// ---------------------------------------------------------------- mobile money per provider

/**
 * Collections and payouts per provider over the period (admin only: people and apps never
 * see which provider served them). Collected = what the provider brought in for us (amount +
 * LightPay's fee); sent = what reached the phones.
 */
export async function providerStats(env: Environment, period: Period) {
  const from = since(period);
  const stats = (table: string) =>
    query(
      `SELECT provider,
              COUNT(*) FILTER (WHERE status = 'SUCCEEDED')::int AS succeeded,
              COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
              COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
              COALESCE(SUM(amount) FILTER (WHERE status = 'SUCCEEDED'), 0)::text AS amount
       FROM ${table} WHERE created_at >= ${from} GROUP BY provider`,
      [],
      env
    );
  const [ins, outs] = await Promise.all([stats('collection_attempts'), stats('payouts')]);
  const empty = { succeeded: 0, failed: 0, pending: 0, amount: '0' };
  const names = [...new Set([...ins, ...outs].map((r) => r.provider))].sort();
  return names.map((provider) => {
    const pick = (rows: any[]) => {
      const r = rows.find((x) => x.provider === provider);
      return r ? { succeeded: r.succeeded, failed: r.failed, pending: r.pending, amount: r.amount } : { ...empty };
    };
    return { provider, collections: pick(ins), payouts: pick(outs) };
  });
}

// ---------------------------------------------------------------- provider reserves

/**
 * Which provider moved the money of a transit entry: the transaction says so, else its payout (a failed payout's give-back
 * carries only the payout id), else its collection attempt. Old entries with neither stay "autre".
 */
const ENTRY_PROVIDER = `upper(COALESCE(NULLIF(t.metadata->>'provider', ''),
    (SELECT p.provider FROM payouts p WHERE p.id = COALESCE(t.metadata->>'payout', t.metadata->>'payout_id')),
    (SELECT a.provider FROM collection_attempts a WHERE a.id = t.metadata->>'attempt'),
    'autre'))`;
/** The operator (network) of the same entry, which gives its country: the provider wallet the money is in. */
const ENTRY_NETWORK = `COALESCE(NULLIF(t.metadata->>'network', ''),
    (SELECT p.network FROM payouts p WHERE p.id = COALESCE(t.metadata->>'payout', t.metadata->>'payout_id')),
    (SELECT a.network FROM collection_attempts a WHERE a.id = t.metadata->>'attempt'))`;
/** Before several countries, every movement was in Congo: an entry without operator (nor country) is counted there. */
const countryOfNetwork = (network: string | null) => (network && railByNetwork(network)?.country) || DEFAULT_COUNTRY;

export type ReserveState = 'unchecked' | 'gap' | 'low' | 'ok';

/**
 * Per provider wallet (provider + country), what should be sitting there, to compare with its real balance:
 *   collected   money brought in (amount + LightPay fee), refused payouts and their give-backs left out (nothing moved);
 *   sent        payouts booked (amount + operator fee);
 *   waiting     booked payouts not sent yet: programmed or held (still in the available balance), asked (reserved there);
 *   expected    collected − sent + waiting = what the provider should show (available + reserved);
 *   checked     the last reading (automatic or typed by the owner) and the gap with expected;
 *   available   what can still be sent from there: the real balance − programmed or held payouts − safety minimum.
 *   transfers   rebalancing between the provider's own wallets: out of one country, into another (its cost is a transit
 *               entry of the receiving country); a transfer still asked counts as gone from its source.
 * State: gap above the admin's tolerance, available under the low threshold, never read, or fine.
 * And the check that all client money is covered: the transit account equals every other wallet together.
 */
export async function reserves(env: Environment) {
  const [perWallet, waitingRows, checks, balances, transfers, [failedTransfers]] = await Promise.all([
    query(
      `SELECT ${ENTRY_PROVIDER} AS provider, ${ENTRY_NETWORK} AS network, NULLIF(t.metadata->>'country', '') AS entry_country,
              COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'DEBIT'), 0)::text AS money_in,
              COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'CREDIT'), 0)::text AS money_out,
              COUNT(*)::int AS movements, MAX(le.created_at) AS last_at
       FROM ledger_entries le
       JOIN wallets w ON w.id = le.wallet_id AND w.account_id = 'SYSTEM_GATEWAY_INFLOW' AND w.currency = $1
       JOIN transactions t ON t.id = le.transaction_id
       WHERE ${NOT_CANCELLED}
       GROUP BY 1, 2, 3`,
      [CURRENCY],
      env
    ),
    query(
      `SELECT upper(provider) AS provider, network, status = 'PENDING' AS asked, COUNT(*)::int AS count,
              COALESCE(SUM(amount + COALESCE(operator_fee, 0)), 0)::text AS amount
       FROM payouts WHERE currency = $1 AND status IN ('SCHEDULED', 'HELD', 'PENDING') GROUP BY 1, 2, 3`,
      [CURRENCY],
      env
    ),
    query(
      `SELECT DISTINCT ON (provider, COALESCE(country, $3)) upper(provider) AS provider, COALESCE(country, $3) AS country,
              balance::text, pending::text, note, checked_by, checked_at
       FROM provider_balance_checks WHERE environment = $1 AND currency = ANY($2)
       ORDER BY provider, COALESCE(country, $3), checked_at DESC`,
      [env, FCFA, DEFAULT_COUNTRY],
      env
    ).catch(() => [] as any[]),
    query(
      `SELECT CASE
                WHEN account_id = 'SYSTEM_GATEWAY_INFLOW' THEN 'reserve'
                WHEN account_id = 'SYSTEM_MAIN_TREASURY' THEN 'main'
                WHEN account_id = 'LIGHTPAY_FEES' THEN 'revenue'
                WHEN account_id = 'SANDBOX_FAUCET_ISSUE' THEN 'issued'
                WHEN account_type = 'USER' THEN 'users'
                WHEN account_type = 'GUEST' THEN 'guests'
                WHEN account_type = 'MERCHANT' THEN 'apps'
                ELSE 'other' END AS bucket,
              COALESCE(SUM(available_balance), 0)::text AS available,
              COALESCE(SUM(locked_balance), 0)::text AS locked
       FROM wallets WHERE currency = $1 GROUP BY 1`,
      [CURRENCY],
      env
    ),
    query(
      `SELECT upper(provider) AS provider, from_country, to_country, status, COALESCE(SUM(amount), 0)::text AS amount
       FROM provider_transfers WHERE environment = $1 AND status IN ('PENDING', 'SUCCEEDED') GROUP BY 1, 2, 3, 4`,
      [env],
      env
    ).catch(() => [] as any[]),
    query(`SELECT COUNT(*)::int AS n FROM provider_transfers WHERE environment = $1 AND status = 'FAILED' AND updated_at > NOW() - INTERVAL '1 day'`, [env], env).catch(() => [{ n: 0 }]),
  ]);

  interface Acc {
    provider: string; country: string; money_in: bigint; money_out: bigint; movements: number; last_at: Date | null;
    scheduled: bigint; asked: bigint; waiting_count: number; transfers_in: bigint; transfers_out: bigint; in_transit: bigint;
  }
  const acc = new Map<string, Acc>();
  const get = (provider: string, country: string) => {
    const key = walletKey(provider, country);
    if (!acc.has(key)) acc.set(key, { provider, country, money_in: 0n, money_out: 0n, movements: 0, last_at: null, scheduled: 0n, asked: 0n, waiting_count: 0, transfers_in: 0n, transfers_out: 0n, in_transit: 0n });
    return acc.get(key)!;
  };
  for (const r of perWallet) {
    const a = get(r.provider, r.entry_country || countryOfNetwork(r.network));
    a.money_in += BigInt(r.money_in);
    a.money_out += BigInt(r.money_out);
    a.movements += r.movements;
    if (r.last_at && (!a.last_at || new Date(r.last_at) > a.last_at)) a.last_at = new Date(r.last_at);
  }
  for (const r of waitingRows) {
    const a = get(r.provider, countryOfNetwork(r.network));
    if (r.asked) a.asked += BigInt(r.amount);
    else a.scheduled += BigInt(r.amount);
    a.waiting_count += r.count;
  }
  for (const r of transfers) {
    const amount = BigInt(r.amount);
    const from = get(r.provider, String(r.from_country).trim());
    from.transfers_out += amount;
    if (r.status === 'PENDING') from.in_transit += amount;
    else get(r.provider, String(r.to_country).trim()).transfers_in += amount;
  }
  for (const c of checks) get(c.provider, c.country);

  const settings = reserveSettings(env);
  const wallets = [...acc.values()]
    .sort((x, y) => x.provider.localeCompare(y.provider) || x.country.localeCompare(y.country))
    .map((a) => {
      const c = checks.find((x) => x.provider === a.provider && x.country === a.country);
      const reserveLedger = a.money_in - a.money_out + a.transfers_in - a.transfers_out;
      const waiting = a.scheduled + a.asked;
      const expected = reserveLedger + waiting;
      const levels = levelsOf(env, a.provider, a.country);
      const real = c ? BigInt(c.balance) + BigInt(c.pending ?? 0) : null;
      const gap = real === null ? null : real - expected;
      const available = c ? BigInt(c.balance) - a.scheduled - BigInt(levels.min) : null;
      const state: ReserveState =
        gap === null || available === null
          ? 'unchecked'
          : (gap < 0n ? -gap : gap) > BigInt(settings.gap_alert)
            ? 'gap'
            : levels.low && available < BigInt(levels.low)
              ? 'low'
              : 'ok';
      return {
        key: walletKey(a.provider, a.country),
        provider: a.provider,
        country: a.country,
        country_name: countryByCode(a.country)?.name ?? a.country,
        money_in: a.money_in.toString(),
        money_out: a.money_out.toString(),
        movements: a.movements,
        last_at: a.last_at,
        reserve: reserveLedger.toString(),
        waiting: waiting.toString(),
        waiting_scheduled: a.scheduled.toString(),
        waiting_asked: a.asked.toString(),
        waiting_count: a.waiting_count,
        transfers_in: a.transfers_in.toString(),
        transfers_out: a.transfers_out.toString(),
        in_transit: a.in_transit.toString(),
        expected: expected.toString(),
        checked: c ? { balance: c.balance, pending: c.pending, note: c.note, by: c.checked_by, at: c.checked_at, gap: (gap ?? 0n).toString() } : null,
        available: available === null ? null : available.toString(),
        levels,
        state,
      };
    });

  const b = Object.fromEntries(balances.map((r) => [r.bucket, { available: r.available, locked: r.locked }])) as Record<string, { available: string; locked: string }>;
  const total = (k: string) => (b[k] ? BigInt(b[k].available) + BigInt(b[k].locked) : 0n);
  const reserve = -total('reserve');
  // Test money issued by the faucet came in without a provider: it is set aside from the comparison.
  const covered = ['main', 'revenue', 'users', 'guests', 'apps', 'other', 'issued'].reduce((s, k) => s + total(k), 0n);
  return {
    currency: CURRENCY,
    wallets,
    alerts: wallets.filter((w) => w.state === 'gap' || w.state === 'low').length + Number(failedTransfers?.n ?? 0),
    failed_transfers: Number(failedTransfers?.n ?? 0),
    /** Providers that can move money between their country wallets here (SasPay). */
    transferable: PROVIDERS_OF[env].filter((n) => canTransfer(env, n)),
    settings: { gap_alert: settings.gap_alert, auto_check_minutes: settings.auto_check_minutes },
    /** Countries LightPay knows, for a reading typed by hand. */
    countries: allCountries().map((c) => ({ code: c.code, name: c.name })),
    /** Providers LightPay can read by itself on this ledger. */
    readable: PROVIDERS_OF[env].filter((n) => {
      const p = providerByName(n);
      return Boolean(p.balances) && p.configured(env);
    }),
    reserve_total: reserve.toString(),
    expected_total: wallets.reduce((s, w) => s + BigInt(w.expected), 0n).toString(),
    held: {
      main: total('main').toString(),
      revenue: total('revenue').toString(),
      users: total('users').toString(),
      guests: total('guests').toString(),
      apps: total('apps').toString(),
      other: total('other').toString(),
      issued: (-total('issued')).toString(),
      locked: Object.values(b).reduce((s, x) => s + BigInt(x.locked), 0n).toString(),
    },
    // Every franc in a wallet came in through a provider: both sides must be equal.
    covered: covered.toString(),
    balanced: covered === reserve,
  };
}

/** One provider wallet: its line of reserves(), its levels and the history of its readings. */
export async function reserveWallet(env: Environment, key: string) {
  const all = await reserves(env);
  const wallet = all.wallets.find((w) => w.key === key);
  if (!wallet) throw new AdminError('Réserve introuvable.', 'NOT_FOUND', 404);
  const history = await query(
    `SELECT id, balance::text, pending::text, currency, note, checked_by, checked_at FROM provider_balance_checks
     WHERE environment = $1 AND provider = $2 AND COALESCE(country, $4) = $3 ORDER BY checked_at DESC LIMIT 100`,
    [env, wallet.provider.toLowerCase(), wallet.country, DEFAULT_COUNTRY],
    env
  );
  return { wallet, history, settings: all.settings, transferable: canTransfer(env, wallet.provider.toLowerCase()) };
}

/** The owner read the real balance of a provider wallet (its dashboard): kept to compare with what LightPay expects there. */
export async function recordProviderBalance(env: Environment, admin: AdminUser, input: { provider: unknown; country?: unknown; balance: unknown; note?: unknown }) {
  const provider = String(input.provider ?? '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,30}$/.test(provider)) throw new AdminError('Fournisseur invalide.', 'BAD_PROVIDER');
  const country = countryByCode(String(input.country ?? DEFAULT_COUNTRY).trim().toUpperCase());
  if (!country) throw new AdminError('Pays inconnu.', 'BAD_COUNTRY');
  const raw = String(input.balance ?? '').replace(/[\s  ]/g, '');
  if (!/^-?\d{1,15}$/.test(raw)) throw new AdminError('Solde en FCFA entiers.', 'BAD_BALANCE');
  const note = String(input.note ?? '').trim().slice(0, 200) || null;
  const [row] = await query(
    `INSERT INTO provider_balance_checks (environment, provider, country, currency, balance, note, checked_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, provider, country, balance::text, note, checked_by, checked_at`,
    [env, provider, country.code, country.currency, raw, note, admin.email ?? admin.uid],
    env
  );
  return row;
}

// ---------------------------------------------------------------- users

export async function listUsers(env: Environment, search: string, limit: number, offset: number) {
  const q = search.trim().toLowerCase();
  const rows = await query(
    `SELECT w.id, w.account_id, w.metadata->>'name' AS name, w.metadata->>'email' AS email, w.status,
            w.available_balance::text, w.locked_balance::text, w.created_at,
            (SELECT COUNT(*) FROM connections c WHERE c.wallet_id = w.id AND c.status = 'ACTIVE')::int AS apps,
            (SELECT MAX(le.created_at) FROM ledger_entries le WHERE le.wallet_id = w.id) AS last_move_at
     FROM wallets w
     WHERE w.app_id = 'mainapp' AND w.account_type = 'USER' AND w.currency = $1 AND w.is_default
       AND ($2 = '' OR lower(w.metadata->>'email') LIKE '%' || $2 || '%' OR lower(w.metadata->>'name') LIKE '%' || $2 || '%')
     ORDER BY w.created_at DESC LIMIT $3 OFFSET $4`,
    [CURRENCY, q, limit, offset],
    env
  );
  return rows;
}

export async function getUser(env: Environment, walletId: string) {
  const [w] = await query(
    `SELECT id, account_id, metadata->>'name' AS name, metadata->>'email' AS email, status, available_balance::text, locked_balance::text, created_at
     FROM wallets WHERE id = $1 AND app_id = 'mainapp' AND account_type = 'USER'`,
    [walletId],
    env
  );
  if (!w) throw new AdminError('Utilisateur introuvable.', 'NOT_FOUND', 404);
  const [apps, moves, wallets] = await Promise.all([
    query(
      `SELECT c.id, c.app_id, a.name AS app_name, c.scopes, c.status, c.created_at, c.revoked_at
       FROM connections c JOIN apps a ON a.id = c.app_id WHERE c.wallet_id = $1 ORDER BY c.created_at DESC`,
      [walletId],
      env
    ),
    walletMoves(env, walletId, 30),
    // Every wallet of the same person (the default first).
    query(
      `SELECT o.id, o.label, o.country, o.currency, o.available_balance::text, o.locked_balance::text, o.status, o.is_default, o.created_at
       FROM wallets o JOIN wallets me ON me.id = $1 AND o.owner_id = me.owner_id AND o.app_id = me.app_id AND o.environment = me.environment
       WHERE o.account_type = 'USER' ORDER BY o.is_default DESC, o.created_at`,
      [walletId],
      env
    ),
  ]);
  return { user: w, apps, moves, wallets };
}

const walletMoves = (env: Environment, walletId: string, limit: number) =>
  query(
    `SELECT le.transaction_id, le.direction, le.amount::text, le.balance_after::text, le.description, le.created_at, t.type, t.app_id, t.reference
     FROM ledger_entries le JOIN transactions t ON t.id = le.transaction_id
     WHERE le.wallet_id = $1 ORDER BY le.created_at DESC LIMIT $2`,
    [walletId, limit],
    env
  );

// ---------------------------------------------------------------- apps

export async function listApps(env: Environment) {
  return query(
    `SELECT a.id, a.name, a.is_active, a.owner_uid, a.created_at,
            (SELECT metadata->>'email' FROM wallets o WHERE o.app_id = 'mainapp' AND o.account_type = 'USER' AND o.owner_id = 'user:' || a.owner_uid AND o.is_default LIMIT 1) AS owner_email,
            (SELECT COUNT(*) FROM connections c WHERE c.app_id = a.id AND c.status = 'ACTIVE')::int AS users,
            (SELECT COALESCE(SUM(amount), 0) FROM transactions t WHERE t.app_id = a.id AND t.status = 'SUCCESS' AND t.type IN ('PAYMENT', 'HOLD') AND t.created_at >= NOW() - INTERVAL '30 days')::text AS volume_30d,
            (SELECT COUNT(*) FROM transactions t WHERE t.app_id = a.id AND t.status = 'SUCCESS')::int AS transactions
     FROM apps a WHERE a.id <> 'mainapp' ORDER BY a.created_at DESC`,
    [],
    env
  );
}

export async function getApp(env: Environment, appId: string) {
  const [app] = (await listApps(env)).filter((a) => a.id === appId);
  if (!app) throw new AdminError('Application introuvable.', 'NOT_FOUND', 404);
  const [users, wallets] = await Promise.all([
    query(
      `SELECT c.id, c.wallet_id, w.metadata->>'name' AS name, w.metadata->>'email' AS email, c.scopes, c.status, c.created_at, w.available_balance::text, w.locked_balance::text
       FROM connections c JOIN wallets w ON w.id = c.wallet_id WHERE c.app_id = $1 ORDER BY c.created_at DESC LIMIT 500`,
      [appId],
      env
    ),
    query(
      `SELECT id, account_id, account_type, currency, available_balance::text, locked_balance::text FROM wallets WHERE app_id = $1 AND account_type <> 'USER' ORDER BY created_at`,
      [appId],
      env
    ),
  ]);
  return { app, users, wallets };
}

// ---------------------------------------------------------------- movements

const TYPE_FILTERS: Record<string, string[]> = {
  deposits: ['COLLECTION'],
  payments: ['PAYMENT', 'HOLD', 'HOLD_CAPTURE', 'HOLD_RELEASE'],
  transfers: ['TRANSFER'],
  payouts: ['PAYOUT', 'REFUND'],
};

export async function listTransactions(env: Environment, f: { type?: string; appId?: string; search?: string; limit: number; before?: string }) {
  const types = f.type && TYPE_FILTERS[f.type] ? TYPE_FILTERS[f.type] : null;
  const before = f.before && !Number.isNaN(Date.parse(f.before)) ? f.before : null;
  return query(
    `SELECT t.id, t.app_id, t.type, t.amount::text, t.fee_amount::text, t.currency, ${SHOWN_STATUS} AS status, t.reference, t.created_at,
            t.metadata->>'provider' AS provider, t.metadata->>'network' AS network
     FROM transactions t
     WHERE ($1::text[] IS NULL OR t.type = ANY($1))
       AND ($2::text IS NULL OR t.app_id = $2)
       AND ($3 = '' OR t.reference ILIKE '%' || $3 || '%' OR t.id::text = $3)
       AND ($4::timestamptz IS NULL OR t.created_at < $4)
     ORDER BY t.created_at DESC LIMIT $5`,
    [types, f.appId || null, (f.search ?? '').trim(), before, f.limit],
    env
  );
}

export async function getTransaction(env: Environment, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AdminError('Transaction introuvable.', 'NOT_FOUND', 404);
  const [tx] = await query(`SELECT t.*, t.amount::text, t.fee_amount::text, ${SHOWN_STATUS} AS status FROM transactions t WHERE t.id = $1`, [id], env);
  if (!tx) throw new AdminError('Transaction introuvable.', 'NOT_FOUND', 404);
  const entries = await query(
    `SELECT le.id, le.wallet_id, le.direction, le.amount::text, le.balance_before::text, le.balance_after::text, le.description,
            w.account_id, w.account_type, w.app_id, w.metadata
     FROM ledger_entries le JOIN wallets w ON w.id = le.wallet_id WHERE le.transaction_id = $1 ORDER BY le.direction DESC, le.amount DESC`,
    [id],
    env
  );
  return {
    transaction: tx,
    entries: entries.map(({ metadata, ...e }) => ({ ...e, label: walletLabel({ ...e, metadata }, env) })),
    breakdown: await moneyBreakdown(env, tx),
  };
}

/**
 * What the person paid or received around this transaction, outside the ledger too: the phone's
 * side of a collection (amount + LightPay fee + operator fee) or of a payout.
 */
async function moneyBreakdown(env: Environment, tx: any) {
  const m = tx.metadata || {};
  if (m.attempt) {
    const [a] = await query(
      `SELECT provider, network, amount::text, lightpay_fee::text, swap_fee::text, provider_fee::text, charged_amount::text, status FROM collection_attempts WHERE id = $1`,
      [m.attempt],
      env
    );
    if (!a) return null;
    const received = BigInt(a.amount) - BigInt(a.lightpay_fee ?? 0);
    return {
      kind: 'collection', provider: a.provider, network: a.network,
      // lightpay_fee holds the swap fee too (same road): shown apart.
      paid: a.charged_amount, operator_fee: a.provider_fee, lightpay_fee: (BigInt(a.lightpay_fee ?? 0) - BigInt(a.swap_fee ?? 0)).toString(), swap_fee: a.swap_fee, received: received.toString(),
    };
  }
  if (m.payout) {
    const [p] = await query(
      `SELECT provider, network, amount::text, operator_fee::text, lightpay_fee::text, swap_fee::text, total_debited::text, status FROM payouts WHERE id = $1`,
      [m.payout],
      env
    );
    if (!p) return null;
    return {
      kind: 'payout', provider: p.provider, network: p.network, sent: p.amount, operator_fee: p.operator_fee,
      lightpay_fee: (BigInt(p.lightpay_fee ?? 0) - BigInt(p.swap_fee ?? 0)).toString(), swap_fee: p.swap_fee, debited: p.total_debited,
    };
  }
  return null;
}

// ---------------------------------------------------------------- wallet main

export async function mainOverview(env: Environment) {
  const id = await findMain(env);
  if (!id) return { wallet: { id: null, available_balance: '0', locked_balance: '0', currency: CURRENCY }, moves: [] };
  const [[w], moves] = await Promise.all([
    query(`SELECT id, available_balance::text, locked_balance::text, currency FROM wallets WHERE id = $1`, [id], env),
    walletMoves(env, id, 50),
  ]);
  return { wallet: w, moves };
}

export const auditAction = (env: Environment, admin: AdminUser, action: string, target: string | null, amount: bigint | null, detail: Record<string, unknown>) =>
  query(
    `INSERT INTO admin_audit (id, environment, admin_uid, admin_email, action, target, amount, currency, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [`adm_${crypto.randomBytes(12).toString('base64url')}`, env, admin.uid, admin.email, action, target, amount?.toString() ?? null, CURRENCY, JSON.stringify(detail)],
    env
  );

export const listAudit = (env: Environment, limit: number) =>
  query(`SELECT id, admin_email, action, target, amount::text, currency, detail, created_at FROM admin_audit ORDER BY created_at DESC LIMIT $1`, [limit], env);

const positive = (v: unknown) => {
  const s = String(v ?? '').trim();
  if (!/^\d{1,12}$/.test(s) || BigInt(s) <= 0n) throw new AdminError('Montant invalide.', 'INVALID_AMOUNT');
  return BigInt(s);
};

/** From the main wallet to a LightPay user (by e-mail). The main wallet never goes below zero. */
export async function sendFromMain(env: Environment, admin: AdminUser, input: { to: unknown; amount: unknown; note?: unknown }, idempotencyKey: string) {
  const amount = positive(input.amount);
  const to = String(input.to ?? '').trim().toLowerCase();
  const note = String(input.note ?? '').trim().slice(0, 140) || undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new AdminError('Adresse e-mail du destinataire invalide.', 'INVALID_RECIPIENT');
  const [recipient] = await query(
    `SELECT id, metadata FROM wallets WHERE app_id = 'mainapp' AND account_type = 'USER' AND currency = $1 AND status = 'ACTIVE' AND is_default AND lower(metadata->>'email') = $2 LIMIT 1`,
    [CURRENCY, to],
    env
  );
  if (!recipient) throw new AdminError('Aucun compte LightPay avec cet e-mail.', 'RECIPIENT_NOT_FOUND', 404);
  const main = await findMain(env);
  if (!main) throw new AdminError('Solde du wallet main insuffisant.', 'INSUFFICIENT_FUNDS', 402);
  const ref = `admin-send:${idempotencyKey}`;
  let result;
  try {
    result = await LedgerEngine.executeTransaction({
      appId: 'mainapp',
      environment: env,
      idempotencyKey: ref,
      type: 'TRANSFER',
      amount,
      currency: CURRENCY,
      skipQuotas: true,
      metadata: { kind: 'ADMIN_SEND', admin_uid: admin.uid, to_email: to, note },
      postings: [
        { walletId: main, direction: 'DEBIT', amount, description: `Envoi à ${recipient.metadata?.name || to}${note ? ` · ${note}` : ''}` },
        { walletId: recipient.id, direction: 'CREDIT', amount, description: `${env === 'sandbox' ? 'Reçu du faucet' : 'Reçu de LightPay'}${note ? ` · ${note}` : ''}` },
      ],
    });
  } catch (err: any) {
    if (String(err?.message ?? '').startsWith('INSUFFICIENT_TREASURY_LIQUIDITY')) throw new AdminError('Solde du wallet main insuffisant.', 'INSUFFICIENT_FUNDS', 402);
    throw err;
  }
  if (!result.duplicate) {
    await logActivity(env, {
      walletId: recipient.id, kind: 'TRANSFER', direction: 'IN', status: 'SUCCEEDED', amount, total: amount, currency: CURRENCY,
      counterparty: 'LightPay', refType: 'transfer', refId: ref, metadata: { note },
    });
    await auditAction(env, admin, 'MAIN_SEND', to, amount, { note, transaction: (result as any).transactionId ?? (result as any).transaction?.id ?? null });
  }
  return { duplicate: result.duplicate, to: { email: to, name: recipient.metadata?.name ?? null }, amount: amount.toString() };
}

/**
 * Test ledger only: the owner issues test money into the faucet. Balanced like any movement:
 * SANDBOX_FAUCET_ISSUE goes negative by what is issued, the faucet is credited.
 */
export async function issueFaucet(env: Environment, admin: AdminUser, amountInput: unknown, idempotencyKey: string) {
  if (env !== 'sandbox') throw new AdminError('Le faucet n’existe que dans l’environnement de test.', 'FAUCET_TEST_ONLY', 403);
  const amount = positive(amountInput);
  if (amount > 100_000_000n) throw new AdminError('100 000 000 FCFA maximum par émission.', 'AMOUNT_TOO_LARGE');
  const faucet = await LedgerEngine.getOrCreateMainTreasury('mainapp', env, CURRENCY);
  const [issue] = await query(
    `INSERT INTO wallets (app_id, account_id, account_type, currency, environment, metadata)
     VALUES ('mainapp', 'SANDBOX_FAUCET_ISSUE', 'SYSTEM', $1, 'sandbox', '{"role":"faucet_issue"}')
     ON CONFLICT (app_id, account_id, currency, environment) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [CURRENCY],
    env
  );
  const result = await LedgerEngine.executeTransaction({
    appId: 'mainapp',
    environment: env,
    idempotencyKey: `faucet-issue:${idempotencyKey}`,
    type: 'FAUCET',
    amount,
    currency: CURRENCY,
    skipQuotas: true,
    metadata: { kind: 'FAUCET_ISSUE', admin_uid: admin.uid },
    postings: [
      { walletId: issue.id, direction: 'DEBIT', amount, description: 'Émission d’argent de test' },
      { walletId: faucet, direction: 'CREDIT', amount, description: 'Réserve du faucet' },
    ],
  });
  if (!result.duplicate) await auditAction(env, admin, 'FAUCET_ISSUE', null, amount, {});
  return { duplicate: result.duplicate, amount: amount.toString() };
}

/** A real mobile-money deposit into the main wallet: a LightPay payment page for this amount. */
export async function rechargeMain(env: Environment, admin: AdminUser, amountInput: unknown, idempotencyKey: string, returnUrl: string | null) {
  if (env !== 'production') throw new AdminError('En test, le faucet se remplit par émission.', 'USE_FAUCET', 400);
  const amount = positive(amountInput);
  if (amount < minMobileMoneyAmount(env)) throw new AdminError(`Dépôt minimum : ${minMobileMoneyAmount(env)} FCFA.`, 'BELOW_MOBILE_MONEY_MINIMUM');
  const main = await LedgerEngine.getOrCreateMainTreasury('mainapp', env, CURRENCY);
  const key = `admin-recharge:${idempotencyKey}`;
  const [existing] = await query(`SELECT id FROM checkout_sessions WHERE app_id = 'mainapp' AND environment = $1 AND idempotency_key = $2`, [env, key], env);
  if (existing) return { session_id: existing.id, checkout_path: `/pay/${existing.id}` };
  const id = `cs_live_${crypto.randomBytes(18).toString('base64url')}`;
  await query(
    `INSERT INTO checkout_sessions (id, app_id, environment, idempotency_key, kind, amount, fee_amount, currency, description, payee_wallet_id, escrow, methods, return_url, expires_at)
     VALUES ($1, 'mainapp', $2, $3, 'DEPOSIT', $4, 0, $5, 'Dépôt sur le wallet main', $6, FALSE, '["mobile_money"]'::jsonb, $7, NOW() + interval '30 minutes')`,
    [id, env, key, amount.toString(), CURRENCY, main, returnUrl],
    env
  );
  await auditAction(env, admin, 'MAIN_RECHARGE', id, amount, {});
  return { session_id: id, checkout_path: `/pay/${id}` };
}
