/**
 * Which provider serves an operation, decided by the admin's rules (table routing_settings, per ledger).
 *
 * The rules are an ordered list: the first enabled rule that matches the operation and whose provider can serve it
 * wins. A payout rule may ask "only if this provider's reserve in that country is enough" (src/payments/reserve-watch.ts);
 * otherwise the next rule is tried. Without a matching rule, the provider chosen in "Fournisseurs" serves
 * (providerFor). Read from memory: loaded at startup, re-read every minute and right after the admin saves.
 *
 * Providers are LightPay's business only: the rule that routed an operation is kept for the admin, never shown.
 */
import { query } from '../db/pool.js';
import { Environment } from '../types/index.js';
import { MobileMoneyProvider, providerByName, providerFor } from '../payments/mobile-money.js';
import { PROVIDER_NAMES, ProviderName, RailKind, servesLedger } from '../payments/provider-settings.js';
import { reserveAvailable } from '../payments/reserve-watch.js';
import { DEFAULT_COUNTRY, railByNetwork } from './registry.js';

export const OPERATION_TYPES = ['deposit', 'payment', 'withdrawal', 'refund'] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];
/** Which kind of rail each operation uses. */
export const KIND_OF: Record<OperationType, RailKind> = { deposit: 'collection', payment: 'collection', withdrawal: 'payout', refund: 'payout' };
const MAX_RULES = 50;

export interface RoutingRule {
  id: string;
  /** The admin's words for it ("Congo → Congo par pawaPay"). */
  name: string;
  kind: RailKind;
  /** Operations it applies to (empty: every operation of its kind). */
  types: OperationType[];
  /** Countries of the phone's operator: the payer's for a collection, the recipient's for a payout (empty: all). */
  countries: string[];
  /** Operators (network codes) of that phone (empty: all). */
  networks: string[];
  /** Country of the wallet the money goes to (a collection) or comes from (a payout) (empty: all). */
  destinations: string[];
  /** Apps it applies to (empty: all, LightPay's own account included). */
  apps: string[];
  provider: ProviderName;
  /** Payouts only: use this provider only if its reserve in that country covers the amount. */
  require_reserve: boolean;
  enabled: boolean;
}

export interface RouteInput {
  env: Environment;
  type: OperationType;
  /** The phone's operator (network code). */
  network: string;
  /** Country of the wallet the money goes to or comes from (default: Congo, where every wallet was until now). */
  destination?: string | null;
  appId?: string | null;
  amount?: bigint;
}

export interface RouteStep {
  rule: string;
  name: string;
  /** Why this rule did not choose (null: it chose). */
  skipped: string | null;
}

export interface RouteDecision {
  provider: MobileMoneyProvider;
  /** The rule that chose, or null when the default provider serves. */
  rule: RoutingRule | null;
  /** Every rule looked at, in order (the simulator shows it). */
  steps: RouteStep[];
}

const cache: Record<Environment, RoutingRule[]> = { production: [], sandbox: [] };
export const routingRules = (env: Environment): RoutingRule[] => cache[env];

export class RoutingError extends Error {
  code = 'INVALID_ROUTING_RULES';
}

// ---------------------------------------------------------------- deciding

const country = (network: string) => railByNetwork(network)?.country ?? null;

/** Why a rule does not apply to this operation, or null when it does (the provider's checks come after). */
function mismatch(rule: RoutingRule, input: RouteInput): string | null {
  if (!rule.enabled) return 'désactivée';
  if (rule.kind !== KIND_OF[input.type]) return rule.kind === 'collection' ? 'règle d’encaissement' : 'règle d’envoi';
  if (rule.types.length && !rule.types.includes(input.type)) return 'autre type d’opération';
  if (rule.networks.length && !rule.networks.includes(input.network)) return 'autre opérateur';
  if (rule.countries.length && !rule.countries.includes(country(input.network) ?? '')) return 'autre pays';
  if (rule.destinations.length && !rule.destinations.includes(input.destination || DEFAULT_COUNTRY)) return 'autre pays de destination';
  if (rule.apps.length && !rule.apps.includes(input.appId ?? '')) return 'autre app';
  return null;
}

/** The provider of an operation, and the path through the rules that led to it. */
export async function route(input: RouteInput): Promise<RouteDecision> {
  const steps: RouteStep[] = [];
  for (const rule of cache[input.env]) {
    const why = mismatch(rule, input);
    if (why) {
      steps.push({ rule: rule.id, name: rule.name, skipped: why });
      continue;
    }
    const provider = providerByName(rule.provider);
    if (!servesLedger(input.env, rule.provider) || !provider.configured(input.env)) {
      steps.push({ rule: rule.id, name: rule.name, skipped: 'fournisseur pas configuré ici' });
      continue;
    }
    if (rule.kind === 'payout' && rule.require_reserve && input.amount !== undefined) {
      const available = await reserveAvailable(input.env, rule.provider, country(input.network) ?? DEFAULT_COUNTRY);
      if (available === null) {
        steps.push({ rule: rule.id, name: rule.name, skipped: 'réserve jamais relevée' });
        continue;
      }
      if (available < input.amount) {
        steps.push({ rule: rule.id, name: rule.name, skipped: `réserve insuffisante (${available} FCFA disponibles)` });
        continue;
      }
    }
    steps.push({ rule: rule.id, name: rule.name, skipped: null });
    return { provider, rule, steps };
  }
  return { provider: providerFor(input.env, input.network, KIND_OF[input.type]), rule: null, steps };
}

// ---------------------------------------------------------------- the admin's list

const list = (v: unknown, ok: (x: string) => boolean, what: string): string[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new RoutingError(`${what} : une liste attendue.`);
  const out = [...new Set(v.map((x) => String(x).trim()).filter(Boolean))];
  const bad = out.find((x) => !ok(x));
  if (bad) throw new RoutingError(`${what} inconnu : ${bad}.`);
  return out;
};

/** A full list of rules, checked: known providers allowed on this ledger, known types, lists of codes. */
export function validateRoutingRules(env: Environment, input: unknown): RoutingRule[] {
  if (!Array.isArray(input)) throw new RoutingError('Une liste de règles attendue.');
  if (input.length > MAX_RULES) throw new RoutingError(`${MAX_RULES} règles au plus.`);
  const ids = new Set<string>();
  return input.map((raw: any, i) => {
    const n = i + 1;
    const kind = raw?.kind === 'payout' ? 'payout' : raw?.kind === 'collection' ? 'collection' : null;
    if (!kind) throw new RoutingError(`Règle ${n} : encaissement ou envoi ?`);
    const provider = String(raw?.provider ?? '');
    if (!(PROVIDER_NAMES as readonly string[]).includes(provider)) throw new RoutingError(`Règle ${n} : fournisseur inconnu.`);
    if (!servesLedger(env, provider)) throw new RoutingError(`Règle ${n} : ${provider} ne sert pas ${env === 'sandbox' ? 'le compte de test' : 'le compte réel'}.`);
    const types = list(raw?.types, (t) => (OPERATION_TYPES as readonly string[]).includes(t), `Règle ${n} : type`) as OperationType[];
    if (types.some((t) => KIND_OF[t] !== kind)) throw new RoutingError(`Règle ${n} : un ${kind === 'collection' ? 'encaissement' : 'envoi'} ne couvre pas ce type d’opération.`);
    const code = (x: string) => /^[A-Z]{3}$/.test(x);
    const id = /^r_[A-Za-z0-9_-]{4,30}$/.test(String(raw?.id ?? '')) && !ids.has(raw.id) ? String(raw.id) : `r_${Math.random().toString(36).slice(2, 10)}`;
    ids.add(id);
    return {
      id,
      name: String(raw?.name ?? '').trim().slice(0, 80) || `Règle ${n}`,
      kind,
      types,
      countries: list(raw?.countries, code, `Règle ${n} : pays`),
      networks: list(raw?.networks, (x) => /^[A-Z0-9_]{3,30}$/.test(x), `Règle ${n} : opérateur`),
      destinations: list(raw?.destinations, code, `Règle ${n} : pays de destination`),
      apps: list(raw?.apps, (x) => /^[A-Za-z0-9_-]{2,50}$/.test(x), `Règle ${n} : app`),
      provider: provider as ProviderName,
      require_reserve: kind === 'payout' && raw?.require_reserve === true,
      enabled: raw?.enabled !== false,
    };
  });
}

const normalize = (env: Environment, stored: unknown): RoutingRule[] => {
  try {
    return validateRoutingRules(env, stored ?? []);
  } catch (err: any) {
    console.error('[ROUTING] stored rules ignored', env, err?.message);
    return [];
  }
};

export async function loadRoutingRules(env: Environment): Promise<RoutingRule[]> {
  const [row] = await query(`SELECT rules FROM routing_settings WHERE id = 1`, [], env);
  if (row) cache[env] = normalize(env, row.rules);
  return cache[env];
}

export async function refreshRoutingRules() {
  for (const env of ['production', 'sandbox'] as Environment[]) {
    await loadRoutingRules(env).catch((err) => console.error('[ROUTING] rules not read', env, err?.message));
  }
}

/** Saves a full list (already validated) and applies it at once. Returns what it replaced. */
export async function saveRoutingRules(env: Environment, next: RoutingRule[], by: string) {
  const before = structuredClone(cache[env]);
  await query(
    `INSERT INTO routing_settings (id, rules, updated_by, updated_at) VALUES (1, $1::jsonb, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET rules = EXCLUDED.rules, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [JSON.stringify(next), by],
    env
  );
  cache[env] = structuredClone(next);
  return { before, after: structuredClone(next) };
}
