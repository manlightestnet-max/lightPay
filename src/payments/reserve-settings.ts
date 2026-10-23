import { query } from '../db/pool.js';
import { Environment } from '../types/index.js';

/**
 * What the admin sets for the provider reserves, per ledger (table reserve_settings). Read from memory (loaded at
 * startup, re-read every minute and right after the admin saves), exactly like the controls; the defaults only cover
 * the moment before the first read. Amounts in whole FCFA.
 */
export interface ReserveLevels {
  /** Never counted as available for sending (kept at the provider whatever happens). */
  min: number;
  /** Below this, the wallet is shown in alert (and, later, a rebalancing is proposed). */
  low: number;
  /** The level a rebalancing brings the wallet back to. */
  target: number;
}

export interface ReserveSettings {
  /** A gap between the real balance and what LightPay expects above this is an alert (0: any gap). */
  gap_alert: number;
  /** LightPay reads the providers' balances by itself every N minutes (0: only on demand). */
  auto_check_minutes: number;
  /** Per provider wallet, keyed "provider:COUNTRY" (saspay:COG). Missing = all zero. */
  wallets: Record<string, ReserveLevels>;
}

export const DEFAULT_RESERVE_SETTINGS: Readonly<ReserveSettings> = Object.freeze({ gap_alert: 0, auto_check_minutes: 15, wallets: {} });
export const NO_LEVELS: Readonly<ReserveLevels> = Object.freeze({ min: 0, low: 0, target: 0 });

/** [min, max] of every number. */
export const RESERVE_RANGES = {
  gap_alert: [0, 100_000_000] as [number, number],
  auto_check_minutes: [0, 1_440] as [number, number],
  level: [0, 10_000_000_000] as [number, number],
};

const WALLET_KEY = /^[a-z0-9_-]{2,30}:[A-Z0-9]{2,3}$/;
export const walletKey = (provider: string, country: string) => `${provider.toLowerCase()}:${country.toUpperCase()}`;

const cache: Record<Environment, ReserveSettings> = {
  production: { ...DEFAULT_RESERVE_SETTINGS, wallets: {} },
  sandbox: { ...DEFAULT_RESERVE_SETTINGS, wallets: {} },
};

export const reserveSettings = (env: Environment): ReserveSettings => cache[env];
export const levelsOf = (env: Environment, provider: string, country: string): ReserveLevels => cache[env].wallets[walletKey(provider, country)] ?? NO_LEVELS;

export class ReserveSettingsError extends Error {
  code = 'INVALID_RESERVE_SETTINGS';
}

const whole = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const inRange = (n: number, [min, max]: [number, number]) => Number.isInteger(n) && n >= min && n <= max;

/** Whole numbers in range everywhere; per wallet min ≤ low ≤ target, unless the target is not set (0). */
export function validateReserveSettings(input: unknown): ReserveSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: ReserveSettings = { gap_alert: 0, auto_check_minutes: 0, wallets: {} };
  for (const k of ['gap_alert', 'auto_check_minutes'] as const) {
    const n = whole(raw[k]);
    if (!inRange(n, RESERVE_RANGES[k])) throw new ReserveSettingsError(`Valeur invalide pour ${k} (${RESERVE_RANGES[k][0]} à ${RESERVE_RANGES[k][1]}).`);
    out[k] = n;
  }
  const wallets = (raw.wallets && typeof raw.wallets === 'object' ? raw.wallets : {}) as Record<string, any>;
  for (const [key, levels] of Object.entries(wallets)) {
    if (!WALLET_KEY.test(key)) throw new ReserveSettingsError(`Wallet inconnu : ${key}.`);
    const l = {} as ReserveLevels;
    for (const k of ['min', 'low', 'target'] as const) {
      const n = whole(levels?.[k] ?? 0);
      if (!inRange(n, RESERVE_RANGES.level)) throw new ReserveSettingsError(`Montant invalide pour ${key} (${k}).`);
      l[k] = n;
    }
    if (l.low && l.low < l.min) throw new ReserveSettingsError('Le seuil bas ne peut pas être sous le minimum de sécurité.');
    if (l.target && l.target < l.low) throw new ReserveSettingsError('Le niveau cible ne peut pas être sous le seuil bas.');
    out.wallets[key] = l;
  }
  return out;
}

const normalize = (stored: unknown): ReserveSettings => {
  try {
    return validateReserveSettings({ ...DEFAULT_RESERVE_SETTINGS, ...((stored && typeof stored === 'object' ? stored : {}) as object) });
  } catch {
    return { ...DEFAULT_RESERVE_SETTINGS, wallets: {} };
  }
};

export async function loadReserveSettings(env: Environment): Promise<ReserveSettings> {
  const [row] = await query(`SELECT settings FROM reserve_settings WHERE id = 1`, [], env);
  if (row) cache[env] = normalize(row.settings);
  return cache[env];
}

export async function refreshReserveSettings() {
  for (const env of ['production', 'sandbox'] as Environment[]) {
    await loadReserveSettings(env).catch((err) => console.error('[RESERVES] settings not read', env, err?.message));
  }
}

/** Saves a full set (already validated) and applies it at once. Returns what it replaced. */
export async function saveReserveSettings(env: Environment, next: ReserveSettings, by: string) {
  const before = structuredClone(cache[env]);
  await query(
    `INSERT INTO reserve_settings (id, settings, updated_by, updated_at) VALUES (1, $1::jsonb, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [JSON.stringify(next), by],
    env
  );
  cache[env] = structuredClone(next);
  return { before, after: structuredClone(next) };
}
