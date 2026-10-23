import { Environment } from '../types/index.js';
import { feeFromTiers, providerByName, ProviderRate } from './mobile-money.js';
import { PROVIDERS_OF, RailKind } from './provider-settings.js';

/**
 * What the providers charge right now, read from their API (SasPay /pricing/my-rates/; pawaPay has none).
 * These are the operator fees people pay (./fees.ts): nobody types them in « Frais et minimums » any more.
 * Read again every five minutes in the background (startProviderRatesWatch); « Actualiser » in the admin reads
 * them at once. The last good reading stays in use while the provider does not answer.
 */
export interface ProviderRates {
  provider: string;
  fetched_at: string | null;
  rates: ProviderRate[];
  error?: string;
}

const KEEP_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: ProviderRates }>();

/** Every provider of this ledger that reports its prices (its keys in place). */
export async function providerRates(env: Environment, opts: { refresh?: boolean } = {}): Promise<ProviderRates[]> {
  const out: ProviderRates[] = [];
  for (const name of PROVIDERS_OF[env]) {
    const provider = providerByName(name);
    if (!provider.rates || !provider.configured(env)) continue;
    const key = `${env}:${name}`;
    const hit = cache.get(key);
    if (!opts.refresh && hit && Date.now() - hit.at < KEEP_MS) {
      out.push(hit.value);
      continue;
    }
    try {
      const value = { provider: name, fetched_at: new Date().toISOString(), rates: await provider.rates(env) };
      cache.set(key, { at: Date.now(), value });
      out.push(value);
    } catch (err: any) {
      // The last good reading stays shown, with the error beside it.
      out.push({ ...(hit?.value ?? { provider: name, fetched_at: null, rates: [] }), error: err?.message ?? String(err) });
    }
  }
  return out;
}

/** What a provider really charges on this amount for this operator and direction, or null when unknown. */
export async function realProviderFee(env: Environment, provider: string, network: string, kind: RailKind, amount: bigint): Promise<bigint | null> {
  await ensureProviderRates(env);
  return knownProviderFee(env, provider, network, kind, amount);
}

/**
 * Same, from the last reading in memory (synchronous: fee computations need it at once). Null when this provider
 * was never read, does not serve this operator, or no band of its tiers covers the amount.
 */
export function knownProviderFee(env: Environment, provider: string, network: string, kind: RailKind, amount: bigint): bigint | null {
  const rate = cache.get(`${env}:${provider}`)?.value.rates.find((r) => r.network === network);
  const side = rate ? (kind === 'collection' ? rate.collection : rate.payout) : null;
  return side && side.available ? feeFromTiers(amount, side.tiers) : null;
}

/** Reads the providers that were never read yet (an operation needs their price before the first background reading). */
export async function ensureProviderRates(env: Environment): Promise<void> {
  if (PROVIDERS_OF[env].some((name) => !cache.has(`${env}:${name}`) && providerByName(name).rates && providerByName(name).configured(env))) {
    await providerRates(env).catch(() => undefined);
  }
}

/** At startup, then every five minutes: the prices are always at hand when someone pays or withdraws. */
export function startProviderRatesWatch(): void {
  const tick = () => {
    for (const env of ['production', 'sandbox'] as Environment[]) {
      void providerRates(env, { refresh: true }).catch((err) => console.error('[RATES] not read', env, err?.message));
    }
  };
  tick();
  setInterval(tick, KEEP_MS).unref();
}
