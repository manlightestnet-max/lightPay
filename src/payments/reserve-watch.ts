import { query } from '../db/pool.js';
import { Environment } from '../types/index.js';
import { providerByName } from './mobile-money.js';
import { PROVIDERS_OF } from './provider-settings.js';
import { levelsOf, reserveSettings } from './reserve-settings.js';
import { allRails, DEFAULT_COUNTRY } from '../rails/registry.js';

/**
 * Reads the real balance of every country wallet at the providers that report it (SasPay /merchant-balances/,
 * pawaPay /v2/wallet-balances) and keeps it in provider_balance_checks, beside the readings the admin types in.
 * A note only: no money moves. Automatic readings (checked_by 'auto') are kept when the balance changed or the
 * last one is more than an hour old, so the history stays readable.
 */

/** XAF and XOF are the same franc inside LightPay (same fixed parity with the euro): both are reserves. */
export const FCFA = ['XAF', 'XOF'];
const KEEP_UNCHANGED_MS = 60 * 60_000;

export interface ReadResult {
  provider: string;
  ok: boolean;
  /** Country wallets read. */
  wallets: number;
  error?: string;
}

export async function readProviderBalances(env: Environment, by: string, opts: { force?: boolean } = {}): Promise<ReadResult[]> {
  const results: ReadResult[] = [];
  for (const name of PROVIDERS_OF[env]) {
    const provider = providerByName(name);
    if (!provider.balances || !provider.configured(env)) continue;
    try {
      const list = (await provider.balances(env)).filter((b) => FCFA.includes(b.currency));
      for (const b of list) {
        const [last] = await query(
          `SELECT balance::text, pending::text, checked_at FROM provider_balance_checks
           WHERE environment = $1 AND provider = $2 AND COALESCE(country, 'COG') = $3 ORDER BY checked_at DESC LIMIT 1`,
          [env, name, b.country],
          env
        );
        const same = last && last.balance === b.available.toString() && (last.pending ?? null) === (b.pending?.toString() ?? null);
        if (!opts.force && same && Date.now() - new Date(last.checked_at).getTime() < KEEP_UNCHANGED_MS) continue;
        await query(
          `INSERT INTO provider_balance_checks (environment, provider, country, currency, balance, pending, note, checked_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [env, name, b.country, b.currency, b.available.toString(), b.pending?.toString() ?? null, b.frozen ? 'Gelé chez le fournisseur' : null, by],
          env
        );
      }
      results.push({ provider: name, ok: true, wallets: list.length });
    } catch (err: any) {
      results.push({ provider: name, ok: false, wallets: 0, error: err?.message ?? String(err) });
    }
  }
  return results;
}

const lastAuto: Record<Environment, number> = { production: 0, sandbox: 0 };

/** Every minute: reads the balances of a ledger when its admin-set interval has passed (0 = never on its own). */
export function startReserveWatch() {
  const tick = () => {
    for (const env of ['production', 'sandbox'] as Environment[]) {
      const minutes = reserveSettings(env).auto_check_minutes;
      if (!minutes || Date.now() - lastAuto[env] < minutes * 60_000) continue;
      lastAuto[env] = Date.now();
      readProviderBalances(env, 'auto')
        .then((r) => r.filter((x) => !x.ok).forEach((x) => console.warn('[RESERVES] balance not read', env, x.provider, x.error)))
        .catch((err) => console.warn('[RESERVES] balances not read', env, err?.message));
    }
  };
  setInterval(tick, 60_000).unref();
}

/**
 * What a provider wallet can still send now (whole FCFA), or null when it was never read: its last balance, minus
 * the payouts programmed or held there, minus those asked or sent since that reading, minus the safety minimum.
 * Money collected since the reading is not counted (it errs on the safe side). Used by routing rules that only send
 * through a provider "if its reserve is enough".
 */
export async function reserveAvailable(env: Environment, provider: string, country: string): Promise<bigint | null> {
  const [last] = await query(
    `SELECT balance::text, checked_at FROM provider_balance_checks
     WHERE environment = $1 AND provider = $2 AND COALESCE(country, $3) = $4 AND currency = ANY($5)
     ORDER BY checked_at DESC LIMIT 1`,
    [env, provider, DEFAULT_COUNTRY, country, FCFA],
    env
  );
  if (!last) return null;
  const networks = allRails().filter((r) => r.country === country).map((r) => r.network);
  const [out] = await query(
    `SELECT COALESCE(SUM(amount + COALESCE(operator_fee, 0)) FILTER (WHERE status IN ('SCHEDULED', 'HELD')), 0)::text AS waiting,
            COALESCE(SUM(amount + COALESCE(operator_fee, 0)) FILTER (WHERE status IN ('PENDING', 'SUCCEEDED') AND created_at > $3), 0)::text AS since
     FROM payouts WHERE provider = $1 AND network = ANY($2)`,
    [provider, networks, last.checked_at],
    env
  );
  return BigInt(last.balance) - BigInt(out.waiting) - BigInt(out.since) - BigInt(levelsOf(env, provider, country).min);
}
