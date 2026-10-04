import { query } from '../db/pool.js';
import { Environment } from '../types/index.js';

/**
 * Every fee and minimum LightPay applies, per ledger, set by the admin (table fee_settings).
 * Amounts in FCFA, rates in basis points (100 = 1 %). Read from memory (loaded at startup,
 * re-read every minute and right after the admin saves); the defaults only cover the moment
 * before the first read.
 */
export interface FeeSettings {
  /** Smallest mobile-money deposit or payment. */
  deposit_min: number;
  deposit_lightpay_fee_min: number;
  deposit_lightpay_fee_bps: number;
  /** Operator fee shown before a deposit (estimate until the operator reports it). */
  deposit_operator_fee_bps: number;
  withdrawal_min: number;
  withdrawal_lightpay_fee_min: number;
  withdrawal_lightpay_fee_bps: number;
  withdrawal_operator_fee_bps: number;
  withdrawal_operator_fee_min: number;
}

export const DEFAULT_FEE_SETTINGS: Readonly<FeeSettings> = Object.freeze({
  deposit_min: 1000,
  deposit_lightpay_fee_min: 5,
  deposit_lightpay_fee_bps: 0,
  deposit_operator_fee_bps: 650,
  withdrawal_min: 200,
  withdrawal_lightpay_fee_min: 5,
  withdrawal_lightpay_fee_bps: 0,
  withdrawal_operator_fee_bps: 400,
  withdrawal_operator_fee_min: 0,
});

const KEYS = Object.keys(DEFAULT_FEE_SETTINGS) as (keyof FeeSettings)[];
/** Rates up to 50 %, amounts up to 1 000 000 FCFA. */
const maxOf = (k: keyof FeeSettings) => (k.endsWith('_bps') ? 5_000 : 1_000_000);

const cache: Record<Environment, FeeSettings> = {
  production: { ...DEFAULT_FEE_SETTINGS },
  sandbox: { ...DEFAULT_FEE_SETTINGS },
};

export const feeSettings = (env: Environment): FeeSettings => cache[env];

export class FeeSettingsError extends Error {
  code = 'INVALID_FEE_SETTINGS';
}

/** Whole numbers in range for every key; a minimum of 0 is refused for deposits and withdrawals. */
export function validateFeeSettings(input: unknown): FeeSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out = {} as FeeSettings;
  for (const k of KEYS) {
    const v = raw[k];
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (!Number.isInteger(n) || n < 0 || n > maxOf(k)) throw new FeeSettingsError(`Valeur invalide pour ${k}.`);
    out[k] = n;
  }
  if (out.deposit_min < 1 || out.withdrawal_min < 1) throw new FeeSettingsError('Les minimums doivent être d’au moins 1 FCFA.');
  return out;
}

/** Stored values, completed with the defaults for any key missing. */
const normalize = (stored: unknown): FeeSettings => {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_FEE_SETTINGS };
  for (const k of KEYS) if (Number.isInteger(s[k]) && (s[k] as number) >= 0) out[k] = s[k] as number;
  return out;
};

export async function loadFeeSettings(env: Environment): Promise<FeeSettings> {
  const [row] = await query(`SELECT settings FROM fee_settings WHERE id = 1`, [], env);
  if (row) cache[env] = normalize(row.settings);
  return cache[env];
}

export async function refreshFeeSettings() {
  for (const env of ['production', 'sandbox'] as Environment[]) {
    await loadFeeSettings(env).catch((err) => console.error('[FEES] settings not read', env, err?.message));
  }
}

/** Saves a full set (already validated) and applies it at once. Returns what it replaced. */
export async function saveFeeSettings(env: Environment, next: FeeSettings, by: string) {
  const before = { ...cache[env] };
  await query(
    `INSERT INTO fee_settings (id, settings, updated_by, updated_at) VALUES (1, $1::jsonb, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [JSON.stringify(next), by],
    env
  );
  cache[env] = { ...next };
  return { before, after: { ...next } };
}
