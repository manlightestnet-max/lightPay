/**
 * What LightPay knows of each country and each way of paying in it (tables countries and rails, migration 027).
 * Adding a country or an operator is rows, not code: the admin enables them.
 *
 * Read from memory: loaded at startup, re-read every minute. One list for both ledgers, read from the production
 * database (like identities). Until the first load, and if the database cannot be read, the built-in list below
 * serves: it is exactly the migration's seed (Congo, MTN and Airtel), so nothing breaks while it loads.
 */
import { query } from '../db/pool.js';

export type RailAuth = 'push' | 'otp' | 'redirect';

export interface Country {
  /** ISO 3166-1 alpha-3: COG, CMR, CIV, TGO. */
  code: string;
  /** ISO alpha-2, what SasPay uses: CG, CM, CI, TG. */
  iso2: string;
  name: string;
  /** 242 */
  dialCode: string;
  currency: string;
  /** The national number (without the dial code). */
  nationalPattern: RegExp;
  /** How a national number is written there: "06 512 44 81". */
  example: string;
  enabled: boolean;
}

export interface Rail {
  /** Our code, the only one apps and people see: mtn_cg. */
  method: string;
  country: string;
  /** The code the ledger stores on attempts and payouts: MTN_MOMO_COG. */
  network: string;
  name: string;
  /** National prefixes that belong to this operator: 06. */
  prefixes: string[];
  auth: RailAuth;
  /** Each provider's code for this rail: { saspay: 'mtn_cg', pawapay: 'MTN_MOMO_COG' }. */
  providerCodes: Record<string, string>;
  enabled: boolean;
  position: number;
}

const BUILT_IN = {
  countries: [{ code: 'COG', iso2: 'CG', name: 'Congo-Brazzaville', dialCode: '242', currency: 'XAF', nationalPattern: /^0[4-6][0-9]{7}$/, example: '06 512 44 81', enabled: true }] as Country[],
  rails: [
    { method: 'mtn_cg', country: 'COG', network: 'MTN_MOMO_COG', name: 'MTN MoMo', prefixes: ['06'], auth: 'push', providerCodes: { saspay: 'mtn_cg', pawapay: 'MTN_MOMO_COG' }, enabled: true, position: 1 },
    { method: 'airtel_cg', country: 'COG', network: 'AIRTEL_COG', name: 'Airtel Money', prefixes: ['05', '04'], auth: 'push', providerCodes: { saspay: 'airtel_cg', pawapay: 'AIRTEL_COG' }, enabled: true, position: 2 },
  ] as Rail[],
};

let state = BUILT_IN;

export const DEFAULT_COUNTRY = 'COG';

// ---------------------------------------------------------------- reading

export const allCountries = (): Country[] => state.countries;
export const allRails = (): Rail[] => state.rails;
export const countryByCode = (code: string) => state.countries.find((c) => c.code === code);
/** A country from its ISO alpha-2 code (SasPay's): CG → COG. */
export const countryByIso2 = (iso2: string) => state.countries.find((c) => c.iso2 === String(iso2).toUpperCase());
export const railByNetwork = (network: string) => state.rails.find((r) => r.network === network);
export const railByMethod = (method: string) => state.rails.find((r) => r.method === method);

/** Ways of validating a payment LightPay has a waiting screen for (OTP and operator pages come later). */
export const SUPPORTED_AUTH: readonly RailAuth[] = ['push'];

/** Display order of the countries: Congo first (where every wallet started, the forms' default), then by name. */
const countryOrder = (a: Country, b: Country) => Number(b.code === DEFAULT_COUNTRY) - Number(a.code === DEFAULT_COUNTRY) || a.name.localeCompare(b.name, 'fr');

/** The rails people can use now (enabled, in an enabled country), in display order. */
export function enabledRails(country?: string): Rail[] {
  const open = state.countries.filter((c) => c.enabled).sort(countryOrder).map((c) => c.code);
  return state.rails
    .filter((r) => r.enabled && open.includes(r.country) && (!country || r.country === country))
    .sort((a, b) => (a.country === b.country ? a.position - b.position : open.indexOf(a.country) - open.indexOf(b.country)));
}

/**
 * A number in its international form (dial code + national number), or null when it is not a valid number of
 * that country: "06 512 44 81", "+242 06…", "24206…" → "242065124481".
 */
export function normalizeMsisdn(input: string, countryCode = DEFAULT_COUNTRY): string | null {
  const country = countryByCode(countryCode);
  if (!country) return null;
  const digits = String(input ?? '').replace(/\D/g, '');
  const national = digits.startsWith(country.dialCode) ? digits.slice(country.dialCode.length) : digits;
  return country.nationalPattern.test(national) ? `${country.dialCode}${national}` : null;
}

/** The rail a number (international form) belongs to, from its country's dial code and the operator prefixes. */
export function railOfMsisdn(msisdn: string): Rail | null {
  for (const country of state.countries) {
    if (!msisdn.startsWith(country.dialCode)) continue;
    const national = msisdn.slice(country.dialCode.length);
    if (!country.nationalPattern.test(national)) continue;
    const rail = state.rails.find((r) => r.country === country.code && r.prefixes.some((p) => national.startsWith(p)));
    if (rail) return rail;
  }
  return null;
}

/** The rails people can use now and LightPay can follow (enabled and a supported way of validating). */
export const usableRails = (country?: string): Rail[] => enabledRails(country).filter((r) => SUPPORTED_AUTH.includes(r.auth));
/** The countries with at least one usable rail. */
export const usableCountries = (): Country[] => {
  const used = new Set(usableRails().map((r) => r.country));
  return state.countries.filter((c) => c.enabled && used.has(c.code)).sort(countryOrder);
};
export const countryOfNetwork = (network: string) => railByNetwork(network)?.country ?? null;
/** The money the provider moves for this rail (XAF in Congo and Cameroon, XOF in Côte d'Ivoire and Togo: the same franc inside LightPay). */
export const currencyOfNetwork = (network: string) => countryByCode(countryOfNetwork(network) ?? '')?.currency ?? null;

/**
 * Does this number (international form) work with this operator: right country, and one of its prefixes (an
 * operator without prefixes, like Wave, takes any number of its country).
 */
export function numberFitsNetwork(msisdn: string, network: string): boolean {
  const rail = railByNetwork(network);
  const country = rail && countryByCode(rail.country);
  if (!rail || !country || !msisdn.startsWith(country.dialCode)) return false;
  const national = msisdn.slice(country.dialCode.length);
  return country.nationalPattern.test(national) && (rail.prefixes.length === 0 || rail.prefixes.some((p) => national.startsWith(p)));
}

/** "Numéro invalide : par exemple 06 512 44 81." in the country of this operator. */
export const invalidNumberMessage = (network: string) => {
  const country = countryByCode(countryOfNetwork(network) ?? DEFAULT_COUNTRY);
  return country ? `Numéro invalide : un numéro ${country.name}, par exemple ${country.example}.` : 'Numéro invalide.';
};

/** What the payment pages need to offer the countries and operators open now (no provider names). */
export function publicRegistry() {
  return {
    countries: usableCountries().map((c) => ({ code: c.code, name: c.name, dial: c.dialCode, pattern: c.nationalPattern.source, example: c.example, currency: c.currency })),
    rails: usableRails().map((r) => ({
      network: r.network,
      method: r.method,
      name: r.name,
      country: r.country,
      prefixes: r.prefixes,
      // Brand pictures LightPay ships; the others show their initial.
      logo: r.method.startsWith('mtn') ? 'mtn' : r.method.startsWith('airtel') ? 'airtel' : null,
    })),
  };
}

/** "242065124481" → "+242 06 ••• •• 81", "237671234567" → "+237 67 ••• •• 67": never the full number outside the ledger. */
export function maskNumber(msisdn: string): string {
  const country = state.countries.find((c) => msisdn.startsWith(c.dialCode) && c.nationalPattern.test(msisdn.slice(c.dialCode.length)));
  const dial = country?.dialCode ?? msisdn.slice(0, 3);
  const national = msisdn.slice(dial.length);
  return `+${dial} ${national.slice(0, 2)} ••• •• ${national.slice(-2)}`;
}

/** A provider's code for a rail (what goes in its API), or undefined when it does not serve it. */
export const providerCode = (provider: string, network: string) => railByNetwork(network)?.providerCodes?.[provider];

// ---------------------------------------------------------------- loading

const toCountry = (r: any): Country | null => {
  try {
    return {
      code: String(r.code).trim(),
      iso2: String(r.iso2).trim(),
      name: r.name,
      dialCode: String(r.dial_code),
      currency: r.currency,
      nationalPattern: new RegExp(r.national_pattern),
      example: r.example ?? '',
      enabled: r.enabled === true,
    };
  } catch {
    console.error('[RAILS] invalid national_pattern for', r.code);
    return null;
  }
};

const toRail = (r: any): Rail => ({
  method: r.method,
  country: String(r.country).trim(),
  network: r.network,
  name: r.name,
  prefixes: Array.isArray(r.prefixes) ? r.prefixes : [],
  auth: r.auth,
  providerCodes: r.provider_codes && typeof r.provider_codes === 'object' ? r.provider_codes : {},
  enabled: r.enabled === true,
  position: Number(r.position) || 0,
});

export async function loadRegistry() {
  const [countryRows, railRows] = await Promise.all([
    query(`SELECT * FROM countries ORDER BY code`, [], 'production'),
    query(`SELECT * FROM rails ORDER BY country, position`, [], 'production'),
  ]);
  const countries = countryRows.map(toCountry).filter((c): c is Country => c !== null);
  // An empty read (tables not migrated yet) never replaces what works.
  if (countries.length) state = { countries, rails: railRows.map(toRail) };
  return state;
}

export async function refreshRegistry() {
  await loadRegistry().catch((err) => console.error('[RAILS] registry not read', err?.message));
}
