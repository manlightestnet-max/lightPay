/**
 * The admin's hand on the registry (Administration > Pays et opérateurs): open or close a country, switch an
 * operator on or off, correct its number prefixes and each provider's code for it. One list for both ledgers
 * (production database, like the registry itself); applied at once.
 */
import { query } from '../db/pool.js';
import { allCountries, allRails, loadRegistry, SUPPORTED_AUTH } from './registry.js';

export class RegistryError extends Error {
  constructor(message: string, public code = 'INVALID_REGISTRY', public statusCode = 400) {
    super(message);
  }
}

/** Providers that can serve a rail (the simulator serves any rail of the test ledger). */
const CODE_PROVIDERS = ['saspay', 'pawapay'];

/** Every country and operator, open or not, with the providers' codes (admin only). */
export function registryForAdmin() {
  return {
    countries: allCountries().map((c) => ({
      code: c.code,
      name: c.name,
      dial: c.dialCode,
      currency: c.currency,
      example: c.example,
      enabled: c.enabled,
      rails: allRails()
        .filter((r) => r.country === c.code)
        .sort((a, b) => a.position - b.position)
        .map((r) => ({ method: r.method, network: r.network, name: r.name, prefixes: r.prefixes, auth: r.auth, supported: SUPPORTED_AUTH.includes(r.auth), provider_codes: r.providerCodes, enabled: r.enabled })),
    })),
    providers: CODE_PROVIDERS,
  };
}

export async function updateCountry(code: string, input: { enabled?: unknown; example?: unknown }) {
  const country = allCountries().find((c) => c.code === code);
  if (!country) throw new RegistryError('Pays inconnu.', 'NOT_FOUND', 404);
  const enabled = input.enabled === undefined ? country.enabled : input.enabled === true;
  const example = input.example === undefined ? country.example : String(input.example).trim().slice(0, 30);
  if (!example) throw new RegistryError('Donnez un exemple de numéro.');
  await query(`UPDATE countries SET enabled = $2, example = $3, updated_at = NOW() WHERE code = $1`, [code, enabled, example], 'production');
  await loadRegistry();
  return { before: { enabled: country.enabled, example: country.example }, after: { enabled, example } };
}

export async function updateRail(method: string, input: { enabled?: unknown; prefixes?: unknown; provider_codes?: unknown; name?: unknown }) {
  const rail = allRails().find((r) => r.method === method);
  if (!rail) throw new RegistryError('Opérateur inconnu.', 'NOT_FOUND', 404);
  const enabled = input.enabled === undefined ? rail.enabled : input.enabled === true;
  if (enabled && !SUPPORTED_AUTH.includes(rail.auth)) {
    throw new RegistryError(rail.auth === 'otp' ? 'Cet opérateur demande un code avant de payer : son écran arrive plus tard.' : 'Cet opérateur passe par sa propre page : son écran arrive plus tard.');
  }
  const name = input.name === undefined ? rail.name : String(input.name).trim().slice(0, 40);
  if (!name) throw new RegistryError('Nom de l’opérateur manquant.');
  let prefixes = rail.prefixes;
  if (input.prefixes !== undefined) {
    const raw = Array.isArray(input.prefixes) ? input.prefixes : String(input.prefixes).split(/[\s,;]+/);
    prefixes = [...new Set(raw.map((p) => String(p).trim()).filter(Boolean))];
    if (prefixes.some((p) => !/^\d{1,4}$/.test(p))) throw new RegistryError('Préfixes : 1 à 4 chiffres chacun, séparés par des virgules.');
  }
  let codes = rail.providerCodes;
  if (input.provider_codes !== undefined) {
    const raw = (input.provider_codes && typeof input.provider_codes === 'object' ? input.provider_codes : {}) as Record<string, unknown>;
    codes = {};
    for (const [provider, value] of Object.entries(raw)) {
      const v = String(value ?? '').trim();
      if (!v) continue;
      if (!CODE_PROVIDERS.includes(provider)) throw new RegistryError(`Fournisseur inconnu : ${provider}.`);
      if (!/^[A-Za-z0-9_]{2,40}$/.test(v)) throw new RegistryError(`Code ${provider} invalide : lettres, chiffres et « _ ».`);
      codes[provider] = v;
    }
  }
  if (enabled && !Object.keys(codes).length) throw new RegistryError('Indiquez le code d’au moins un fournisseur avant d’activer cet opérateur.');
  await query(
    `UPDATE rails SET enabled = $2, name = $3, prefixes = $4, provider_codes = $5::jsonb, updated_at = NOW() WHERE method = $1`,
    [method, enabled, name, prefixes, JSON.stringify(codes)],
    'production'
  );
  await loadRegistry();
  return {
    before: { enabled: rail.enabled, name: rail.name, prefixes: rail.prefixes, provider_codes: rail.providerCodes },
    after: { enabled, name, prefixes, provider_codes: codes },
  };
}
