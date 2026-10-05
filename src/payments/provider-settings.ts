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

/**
 * Who may serve each ledger. SasPay has no test mode: the test ledger never reaches it
 * (pawaPay's sandbox or the simulator instead). The simulator invents money: never real.
 */
export const PROVIDERS_OF: Record<Environment, readonly ProviderName[]> = {
  production: ['saspay', 'pawapay'],
  sandbox: ['pawapay', 'simulator'],
};
export const servesLedger = (env: Environment, name: string) => (PROVIDERS_OF[env] as readonly string[]).includes(name);
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

/** Both kinds required, each a provider allowed on this ledger (PROVIDERS_OF). */
export function validateProviderSettings(env: Environment, input: unknown): ProviderSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (!isName(raw.collection) || !isName(raw.payout)) throw new ProviderSettingsError(`Fournisseur inconnu : ${PROVIDER_NAMES.join(', ')}.`);
  const refused = [raw.collection, raw.payout].find((n) => !servesLedger(env, n));
  if (refused) throw new ProviderSettingsError(env === 'sandbox' ? `${refused} ne sert pas le compte de test.` : `${refused} ne sert pas le compte réel.`);
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
