import { query } from '../db/pool.js';
import { Environment } from '../types/index.js';

/**
 * Delays and withdrawal limits, per ledger, set by the admin (table control_settings). Read from memory (loaded at
 * startup, re-read every minute and right after the admin saves), exactly like the fees; the defaults only cover the
 * moment before the first read. Delays in minutes.
 */
export interface ControlSettings {
  /** A withdrawal waits this long before it is sent to the phone (0 = sent at once). */
  withdrawal_delay_minutes: number;
  /** A refund to a guest's phone waits this long before it is sent. */
  refund_delay_minutes: number;
  /** Withdrawal attempts allowed in the window before the account is suspended (0 = no limit). */
  withdrawal_max_attempts: number;
  /** The window those attempts are counted in. */
  withdrawal_attempt_window_minutes: number;
  /** How long the account cannot withdraw or send after too many attempts. */
  withdrawal_suspension_minutes: number;
}

export const DEFAULT_CONTROL_SETTINGS: Readonly<ControlSettings> = Object.freeze({
  withdrawal_delay_minutes: 0,
  refund_delay_minutes: 5,
  withdrawal_max_attempts: 5,
  withdrawal_attempt_window_minutes: 10,
  withdrawal_suspension_minutes: 30,
});

const KEYS = Object.keys(DEFAULT_CONTROL_SETTINGS) as (keyof ControlSettings)[];
/** [min, max] of every key. */
export const RANGES: Record<keyof ControlSettings, [number, number]> = {
  withdrawal_delay_minutes: [0, 1_440],
  refund_delay_minutes: [0, 1_440],
  withdrawal_max_attempts: [0, 100],
  withdrawal_attempt_window_minutes: [1, 1_440],
  withdrawal_suspension_minutes: [1, 10_080],
};

const cache: Record<Environment, ControlSettings> = {
  production: { ...DEFAULT_CONTROL_SETTINGS },
  sandbox: { ...DEFAULT_CONTROL_SETTINGS },
};

export const controlSettings = (env: Environment): ControlSettings => cache[env];

export class ControlSettingsError extends Error {
  code = 'INVALID_CONTROL_SETTINGS';
}

/** Whole numbers in range for every key. */
export function validateControlSettings(input: unknown): ControlSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out = {} as ControlSettings;
  for (const k of KEYS) {
    const v = raw[k];
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    const [min, max] = RANGES[k];
    if (!Number.isInteger(n) || n < min || n > max) throw new ControlSettingsError(`Valeur invalide pour ${k} (${min} à ${max}).`);
    out[k] = n;
  }
  return out;
}

const normalize = (stored: unknown): ControlSettings => {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_CONTROL_SETTINGS };
  for (const k of KEYS) {
    const [min, max] = RANGES[k];
    if (Number.isInteger(s[k]) && (s[k] as number) >= min && (s[k] as number) <= max) out[k] = s[k] as number;
  }
  return out;
};

export async function loadControlSettings(env: Environment): Promise<ControlSettings> {
  const [row] = await query(`SELECT settings FROM control_settings WHERE id = 1`, [], env);
  if (row) cache[env] = normalize(row.settings);
  return cache[env];
}

export async function refreshControlSettings() {
  for (const env of ['production', 'sandbox'] as Environment[]) {
    await loadControlSettings(env).catch((err) => console.error('[CONTROLS] settings not read', env, err?.message));
  }
}

/** Saves a full set (already validated) and applies it at once. Returns what it replaced. */
export async function saveControlSettings(env: Environment, next: ControlSettings, by: string) {
  const before = { ...cache[env] };
  await query(
    `INSERT INTO control_settings (id, settings, updated_by, updated_at) VALUES (1, $1::jsonb, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [JSON.stringify(next), by],
    env
  );
  cache[env] = { ...next };
  return { before, after: { ...next } };
}
