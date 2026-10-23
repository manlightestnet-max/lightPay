import { Environment } from '../types/index.js';
import { providerByName, ProviderRate } from './mobile-money.js';
import { PROVIDERS_OF } from './provider-settings.js';

/**
 * What the providers announce on their API (SasPay /pricing/my-rates/; pawaPay has none). For the admin only:
 * shown beside its own operator fees, and imported into them on request (./provider-fees.ts). Never applied by
 * itself. Kept five minutes in memory; « Actualiser » reads them again.
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
