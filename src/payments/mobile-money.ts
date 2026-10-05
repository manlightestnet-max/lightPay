/**
 * Mobile-money rails (collections and payouts), pluggable.
 *
 * The ledger never talks to a provider directly: checkout, deposits, refunds and
 * withdrawals go through this registry. The provider of new operations is chosen per ledger
 * by the admin (./provider-settings.ts: one for collections, one for payouts). Without a
 * saved choice:
 *
 *   MOBILE_MONEY_ROUTES="MTN_MOMO_COG=saspay,AIRTEL_COG=saspay"   (per network)
 *   MOBILE_MONEY_PROVIDER=simulator                                 (default for the rest)
 *
 * An operation keeps the provider it started with (providerByName). Providers are LightPay's
 * business: people and apps only ever see "mobile money".
 * Adding a provider = one file implementing MobileMoneyProvider + one line in PROVIDERS.
 */
import { Environment } from '../types/index.js';
import { SasPayProvider } from './saspay.js';
import { PawaPayProvider } from './pawapay.js';
import { RailKind, providerSettings } from './provider-settings.js';

export type MobileNetwork = 'MTN_MOMO_COG' | 'AIRTEL_COG';
export const MOBILE_NETWORKS: MobileNetwork[] = ['MTN_MOMO_COG', 'AIRTEL_COG'];

export type RailStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

export interface RailOperation {
  /** Our id (ca_… / po_…), also sent as the provider's idempotency key. */
  id: string;
  /** The ledger: a provider may use separate accounts (pawaPay sandbox / live). */
  environment: Environment;
  msisdn: string;
  amount: bigint;
  currency: string;
  network: MobileNetwork;
  createdAt: Date;
  /** Provider-side id, once known (needed to check the status). */
  providerReference?: string | null;
  description?: string;
  customer?: { name?: string | null; email?: string | null };
}

export interface RailResult {
  status: RailStatus;
  failureCode?: string;
  providerReference?: string;
  /** Operator fee and exact amount debited from the payer, when the provider reports them. */
  providerFee?: bigint;
  charged?: bigint;
}

export interface MobileMoneyProvider {
  name: string;
  /** Keys present for this ledger (shown in the admin before choosing it). */
  configured(env: Environment): boolean;
  /** Sends the payment request to the payer's phone. */
  requestCollection(op: RailOperation): Promise<RailResult>;
  /** Current state of a collection (webhooks only trigger this check). */
  collectionStatus(op: RailOperation): Promise<RailResult>;
  /** Sends money to a phone number. */
  requestPayout(op: RailOperation): Promise<RailResult>;
  /** Current state of a payout. */
  payoutStatus(op: RailOperation): Promise<RailResult>;
}

/** Congo numbers: "06 512 44 81", "+242 06…", "24206…" → "242065124481". */
export function normalizeCongoMsisdn(input: string): string | null {
  const digits = String(input ?? '').replace(/\D/g, '');
  const national = digits.startsWith('242') ? digits.slice(3) : digits;
  return /^0[4-6]\d{7}$/.test(national) ? `242${national}` : null;
}

/**
 * SIMULATOR — deterministic by the last digit of the number (like pawaPay test numbers):
 *   …0 → FAILED  INSUFFICIENT_BALANCE      …1 → FAILED PAYER_DECLINED
 *   …2 → FAILED  PAYER_TIMEOUT (after 20 s) otherwise → SUCCEEDED (after 4 s)
 * Payouts always succeed. Stateless: the outcome only depends on the number and time.
 */
export class SimulatorProvider implements MobileMoneyProvider {
  name = 'simulator';
  configured(env: Environment) {
    return env === 'sandbox';
  }
  constructor(private approveAfterMs = 4_000, private timeoutAfterMs = 20_000) {}

  async requestCollection(op: RailOperation): Promise<RailResult> {
    return { status: 'PENDING', providerReference: `SIM-${op.id}` };
  }

  async collectionStatus(op: RailOperation): Promise<RailResult> {
    const elapsed = Date.now() - op.createdAt.getTime();
    const last = op.msisdn.slice(-1);
    if (last === '0' && elapsed >= this.approveAfterMs) return { status: 'FAILED', failureCode: 'INSUFFICIENT_BALANCE' };
    if (last === '1' && elapsed >= this.approveAfterMs) return { status: 'FAILED', failureCode: 'PAYER_DECLINED' };
    if (last === '2') return elapsed >= this.timeoutAfterMs ? { status: 'FAILED', failureCode: 'PAYER_TIMEOUT' } : { status: 'PENDING' };
    return elapsed >= this.approveAfterMs ? { status: 'SUCCEEDED', providerReference: `SIM-${op.id}` } : { status: 'PENDING' };
  }

  async requestPayout(op: RailOperation): Promise<RailResult> {
    return { status: 'SUCCEEDED', providerReference: `SIM-PO-${op.id}` };
  }

  async payoutStatus(op: RailOperation): Promise<RailResult> {
    return { status: 'SUCCEEDED', providerReference: op.providerReference ?? `SIM-PO-${op.id}` };
  }
}

const PROVIDERS: Record<string, () => MobileMoneyProvider> = {
  simulator: () => new SimulatorProvider(Number(process.env.SIMULATOR_APPROVE_MS || 4_000), Number(process.env.SIMULATOR_TIMEOUT_MS || 20_000)),
  saspay: () => new SasPayProvider(),
  pawapay: () => new PawaPayProvider(),
};

const instances = new Map<string, MobileMoneyProvider>();

/** A provider by name (the one recorded on an attempt or payout keeps handling it). */
export function providerByName(name: string): MobileMoneyProvider {
  const key = name.toLowerCase();
  const make = PROVIDERS[key];
  if (!make) throw new Error(`Mobile money provider "${name}" is not available`);
  if (!instances.has(key)) instances.set(key, make());
  return instances.get(key)!;
}

const routes = (): Record<string, string> =>
  Object.fromEntries(
    String(process.env.MOBILE_MONEY_ROUTES || '')
      .split(',')
      .map((pair) => pair.split('=').map((s) => s.trim()))
      .filter(([network, provider]) => network && provider)
  );

/** The provider that takes new collections (or payouts) on this ledger today. */
export function providerFor(env: Environment, network: MobileNetwork, kind: RailKind = 'collection'): MobileMoneyProvider {
  const chosen = providerSettings(env);
  if (chosen) return providerByName(chosen[kind]);
  return providerByName(routes()[network] || process.env.MOBILE_MONEY_PROVIDER || 'simulator');
}
