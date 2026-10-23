import { Environment } from '../types/index.js';
import { feeFromTiers, providerByName, ProviderRate } from './mobile-money.js';
import { PROVIDERS_OF, RailKind } from './provider-settings.js';

/**
 * What the providers charge us right now, read from their API (SasPay /pricing/my-rates/; pawaPay has none).
 * For the admin only: it compares them with the fees it sets in « Frais et minimums » (which stay the ones people pay).
 * Kept five minutes in memory; « Actualiser » reads them again.
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
  const mine = (await providerRates(env)).find((p) => p.provider === provider);
  const rate = mine?.rates.find((r) => r.network === network);
  const side = rate ? (kind === 'collection' ? rate.collection : rate.payout) : null;
  return side && side.available ? feeFromTiers(amount, side.tiers) : null;
}
