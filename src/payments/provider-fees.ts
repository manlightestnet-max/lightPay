import { query } from '../db/pool.js';
import { Environment } from '../types/index.js';
import { providerRates } from './provider-rates.js';
import type { RailKind } from './provider-settings.js';

/**
 * What each provider charges, per operator, as the admin sets it (« Frais et minimums », table provider_fee_settings).
 * These are the operator fees people pay (./fees.ts). Nothing comes from a provider's API by itself: SasPay's prices
 * can be imported (importSasPayRates), then edited like the rest.
 *
 *   rate      { bps, fixed, min }   percent in basis points (320 = 3,2 %), fixed part in FCFA, minimum in FCFA
 *   on_total  the percent is taken on the total paid, fees included, rounded up: SasPay's way (23 October: a payout
 *             of 200 at 3,2 % cost 7 = 3,2 % of 207; a payment of 204 at 5,7 % cost 13 = 5,7 % of 217).
 *             Otherwise on the amount alone.
 *   default   used for an operator without its own rate (or without that side).
 * Read from memory (loaded at startup, re-read every minute and right after the admin saves).
 */
export interface OperatorRate {
  bps: number;
  fixed: number;
  min: number;
}
export interface ProviderFees {
  on_total: boolean;
  default: { collection: OperatorRate | null; payout: OperatorRate | null };
  /** Per operator (registry network, MTN_MOMO_COG): a side left out uses the default. */
  operators: Record<string, { collection?: OperatorRate | null; payout?: OperatorRate | null }>;
}
export type ProviderFeeSettings = Record<string, ProviderFees>;

export const FEE_PROVIDERS = ['saspay', 'pawapay'] as const;

const cache: Record<Environment, ProviderFeeSettings> = { production: {}, sandbox: {} };

export const providerFeeSettings = (env: Environment): ProviderFeeSettings => cache[env];

export class ProviderFeesError extends Error {
  code = 'INVALID_PROVIDER_FEES';
}

/** The rate a provider applies on this operator and side: its own, else the provider's default; null when none. */
export function rateFor(env: Environment, provider: string, network: string, kind: RailKind): OperatorRate | null {
  const p = cache[env][provider];
  if (!p) return null;
  const own = p.operators[network]?.[kind];
  return own !== undefined && own !== null ? own : p.default[kind];
}

/** The fee of a rate on an amount (whole FCFA, rounded up). */
export function feeOf(rate: OperatorRate, amount: bigint, onTotal: boolean): bigint {
  const bps = BigInt(rate.bps);
  const fixed = BigInt(rate.fixed);
  let fee: bigint;
  if (onTotal && bps < 10_000n) {
    // Smallest f with f ≥ (amount + f) × p + fixed.
    fee = (amount * bps + fixed * 10_000n + (10_000n - bps) - 1n) / (10_000n - bps);
  } else {
    fee = (amount * bps + 9_999n) / 10_000n + fixed;
  }
  return fee > BigInt(rate.min) ? fee : BigInt(rate.min);
}

/** What a provider charges on this amount through this operator, or null when the admin set no rate for it. */
export function operatorFee(env: Environment, provider: string, network: string, kind: RailKind, amount: bigint): bigint | null {
  const rate = rateFor(env, provider, network, kind);
  return rate ? feeOf(rate, amount, Boolean(cache[env][provider]?.on_total)) : null;
}

// ---------------------------------------------------------------- validation and storage

const whole = (v: unknown, max: number, what: string): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > max) throw new ProviderFeesError(`Valeur invalide : ${what}.`);
  return n;
};
const rateOf = (v: unknown, what: string): OperatorRate | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') throw new ProviderFeesError(`Tarif invalide : ${what}.`);
  const r = v as Record<string, unknown>;
  return { bps: whole(r.bps, 5_000, `${what} (pourcentage de 0 à 50)`), fixed: whole(r.fixed ?? 0, 1_000_000, `${what} (part fixe)`), min: whole(r.min ?? 0, 1_000_000, `${what} (minimum)`) };
};

/** Every provider of FEE_PROVIDERS, rates in range; an unknown operator code is refused. */
export function validateProviderFees(input: unknown, networks: readonly string[]): ProviderFeeSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
  const out: ProviderFeeSettings = {};
  for (const name of FEE_PROVIDERS) {
    const p = raw[name] && typeof raw[name] === 'object' ? raw[name] : {};
    const operators: ProviderFees['operators'] = {};
    for (const [network, sides] of Object.entries((p.operators && typeof p.operators === 'object' ? p.operators : {}) as Record<string, any>)) {
      if (!networks.includes(network)) throw new ProviderFeesError(`Opérateur inconnu : ${network}.`);
      const s = sides && typeof sides === 'object' ? sides : {};
      const collection = rateOf(s.collection, `${name} ${network} encaissement`);
      const payout = rateOf(s.payout, `${name} ${network} envoi`);
      if (collection || payout) operators[network] = { ...(collection ? { collection } : {}), ...(payout ? { payout } : {}) };
    }
    out[name] = {
      on_total: p.on_total === true,
      default: { collection: rateOf(p.default?.collection, `${name} encaissement par défaut`), payout: rateOf(p.default?.payout, `${name} envoi par défaut`) },
      operators,
    };
  }
  return out;
}

const normalize = (stored: unknown): ProviderFeeSettings => {
  try {
    const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, any>;
    const networks = FEE_PROVIDERS.flatMap((n) => Object.keys(s[n]?.operators ?? {}));
    return validateProviderFees(stored, networks);
  } catch (err: any) {
    console.error('[PROVIDER FEES] stored settings unreadable', err?.message);
    return {};
  }
};

export async function loadProviderFees(env: Environment): Promise<ProviderFeeSettings> {
  const [row] = await query(`SELECT settings FROM provider_fee_settings WHERE id = 1`, [], env);
  if (row) cache[env] = normalize(row.settings);
  return cache[env];
}

export async function refreshProviderFees() {
  for (const env of ['production', 'sandbox'] as Environment[]) {
    await loadProviderFees(env).catch((err) => console.error('[PROVIDER FEES] not read', env, err?.message));
  }
}

/** Saves a full set (already validated) and applies it at once. Returns what it replaced. */
export async function saveProviderFees(env: Environment, next: ProviderFeeSettings, by: string) {
  const before = cache[env];
  await query(
    `INSERT INTO provider_fee_settings (id, settings, updated_by, updated_at) VALUES (1, $1::jsonb, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [JSON.stringify(next), by],
    env
  );
  cache[env] = next;
  return { before, after: next };
}

/**
 * SasPay's prices read on its API, as SasPay rates for each operator of the registry: the percent of each side.
 * The API's « fixed » part is not taken (a payout of 200 with « 3,2 % + 50 » cost 7, not 57): the admin adds one by
 * hand if SasPay really charges it. Returns the settings to save and what was left aside.
 */
export async function importSasPayRates(env: Environment, current: ProviderFeeSettings) {
  const [saspay] = (await providerRates(env, { refresh: true })).filter((p) => p.provider === 'saspay');
  if (!saspay || saspay.error || saspay.rates.length === 0) throw new ProviderFeesError(saspay?.error ? `SasPay ne répond pas : ${saspay.error}` : 'SasPay ne donne pas ses tarifs sur ce compte.');
  const base = current.saspay ?? { on_total: true, default: { collection: null, payout: null }, operators: {} };
  const operators = { ...base.operators };
  const ignored: { network: string; side: RailKind; fixed: number }[] = [];
  let imported = 0;
  for (const r of saspay.rates) {
    if (!r.network) continue;
    const entry = { ...(operators[r.network] ?? {}) };
    for (const side of ['collection', 'payout'] as RailKind[]) {
      const s = side === 'collection' ? r.collection : r.payout;
      const tier = s.available ? s.tiers[0] : null;
      if (!tier) continue;
      entry[side] = { bps: Math.round(tier.percent * 100), fixed: 0, min: 0 };
      if (tier.fixed) ignored.push({ network: r.network, side, fixed: tier.fixed });
      imported++;
    }
    operators[r.network] = entry;
  }
  return { settings: { ...current, saspay: { ...base, operators } }, imported, ignored };
}
