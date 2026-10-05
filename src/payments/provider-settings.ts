import { query } from '../db/pool.js';
import { Environment } from '../types/index.js';

/**
 * Which mobile-money provider handles new operations, per ledger, set by the admin
 * (table provider_settings). Read from memory (loaded at startup, re-read every minute and
 * right after the admin saves). Without a saved choice: MOBILE_MONEY_ROUTES / MOBILE_MONEY_PROVIDER.
 * Providers are LightPay's business only: people and apps never see which one served them.
 */
export const PROVIDER_NAMES = ['saspay', 'pawapay', 'simulator'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];
export type RailKind = 'collection' | 'payout';

export interface ProviderSettings {
  /** Deposits and mobile-money payments. */
  collection: ProviderName;
  /** Withdrawals and refunds. */
  payout: ProviderName;
}

const cache: Record<Environment, ProviderSettings | null> = { production: null, sandbox: null };

/** The admin's choice, or null when none was saved yet. */
export const providerSettings = (env: Environment): ProviderSettings | null => cache[env];

export class ProviderSettingsError extends Error {
  code = 'INVALID_PROVIDER_SETTINGS';
}

const isName = (v: unknown): v is ProviderName => typeof v === 'string' && (PROVIDER_NAMES as readonly string[]).includes(v);

/** Both kinds required; the simulator never serves the real ledger (it invents money). */
export function validateProviderSettings(env: Environment, input: unknown): ProviderSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (!isName(raw.collection) || !isName(raw.payout)) throw new ProviderSettingsError(`Fournisseur inconnu : ${PROVIDER_NAMES.join(', ')}.`);
  if (env === 'production' && (raw.collection === 'simulator' || raw.payout === 'simulator')) {
    throw new ProviderSettingsError('Le simulateur ne sert que le compte de test.');
  }
  return { collection: raw.collection, payout: raw.payout };
}

const normalize = (stored: unknown): ProviderSettings | null => {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  return isName(s.collection) && isName(s.payout) ? { collection: s.collection, payout: s.payout } : null;
};

export async function loadProviderSettings(env: Environment) {
  const [row] = await query(`SELECT settings FROM provider_settings WHERE id = 1`, [], env);
  cache[env] = row ? normalize(row.settings) : null;
  return cache[env];
}

export async function refreshProviderSettings() {
  for (const env of ['production', 'sandbox'] as Environment[]) {
    await loadProviderSettings(env).catch((err) => console.error('[PROVIDERS] settings not read', env, err?.message));
  }
}

/** Saves a validated choice and applies it at once. Returns what it replaced. */
export async function saveProviderSettings(env: Environment, next: ProviderSettings, by: string) {
  const before = cache[env];
  await query(
    `INSERT INTO provider_settings (id, settings, updated_by, updated_at) VALUES (1, $1::jsonb, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [JSON.stringify(next), by],
    env
  );
  cache[env] = { ...next };
  return { before, after: { ...next } };
}
