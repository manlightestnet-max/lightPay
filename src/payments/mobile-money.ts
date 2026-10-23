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
import { RailKind, providerSettings, servesLedger } from './provider-settings.js';
import { railByNetwork, railOfMsisdn, usableRails } from '../rails/registry.js';

/** A rail's network code (MTN_MOMO_COG…), from the registry (src/rails/registry.ts). */
export type MobileNetwork = string;
/** The networks people can use now (usable rails of the open countries), in display order. */
export const mobileNetworks = (): MobileNetwork[] => usableRails().map((r) => r.network);

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

  // Optional: what a provider offers beyond collecting and paying out. Absent = it does not do it.
  /** What it serves for this ledger (countries, operators, limits, state), to fill the registry. */
  sync?(env: Environment): Promise<ProviderRailInfo[]>;
  /** The real balance of each of its country wallets (reserve inspection). */
  balances?(env: Environment): Promise<ProviderBalance[]>;
  /** What it charges us right now, per operator and direction (the admin compares it with the fees it sets). */
  rates?(env: Environment): Promise<ProviderRate[]>;
  /** Moves our money between two of its country wallets (rebalancing); SasPay only, pawaPay has no API for it. */
  transfer?(op: TransferOperation): Promise<TransferResult>;
  transferStatus?(op: TransferOperation): Promise<TransferResult>;
  /** Gives a collection back to the payer natively (pawaPay), instead of a payout. */
  refund?(op: RailOperation & { collectionReference: string }): Promise<RailResult>;
}

/** One operator a provider serves, as it reports it. */
export interface ProviderRailInfo {
  /** ISO alpha-3 country. */
  country: string;
  currency: string;
  /** The provider's own code for the operator (mtn_cg, MTN_MOMO_COG). */
  providerCode: string;
  collection: boolean;
  payout: boolean;
  minAmount?: bigint;
  maxAmount?: bigint;
  /** OPERATIONAL, DELAYED, CLOSED… when the provider reports it. */
  state?: string;
}

/** One band of a provider's price: from min to max (whole units), percent + fixed, kept between floor and cap. */
export interface RateTier {
  min: number;
  max: number | null;
  percent: number;
  fixed: number;
  floor: number;
  cap: number | null;
  /** ADD_ON: paid on top by the customer · DEDUCTED: taken from the amount. */
  mode: string | null;
}

export interface RateSide {
  available: boolean;
  tiers: RateTier[];
  otpRequired?: boolean;
  otpInstructions?: string | null;
}

/** A provider's price for one operator, as it reports it. */
export interface ProviderRate {
  /** ISO alpha-3 country (the provider's code when the registry does not know it). */
  country: string;
  currency: string;
  /** The provider's code (mtn_cg) and ours when the registry knows it (MTN_MOMO_COG). */
  providerCode: string;
  network: string | null;
  name: string;
  collection: RateSide;
  payout: RateSide;
}

/** What a provider's tiers charge on an amount (rounded up, between floor and cap); null when no band covers it. */
export function feeFromTiers(amount: bigint, tiers: RateTier[]): bigint | null {
  const a = Number(amount);
  const tier = tiers.find((t) => a >= t.min && (t.max === null || a <= t.max));
  if (!tier) return null;
  let fee = Math.ceil((a * tier.percent) / 100 + tier.fixed);
  if (tier.floor > 0) fee = Math.max(fee, Math.ceil(tier.floor));
  if (tier.cap !== null && tier.cap > 0) fee = Math.min(fee, Math.ceil(tier.cap));
  return BigInt(Math.max(fee, 0));
}

/** One of our wallets at a provider (one per country, sometimes per currency). */
export interface ProviderBalance {
  /** ISO alpha-3 country. */
  country: string;
  currency: string;
  /** What can be used now, in whole units. */
  available: bigint;
  /** Reserved by operations not finished yet, when the provider reports it. */
  pending?: bigint;
  frozen?: boolean;
}

export interface TransferOperation {
  /** Our id (tr_…), also the provider's idempotency key. */
  id: string;
  environment: Environment;
  /** ISO alpha-3 countries. */
  fromCountry: string;
  toCountry: string;
  /** In the source wallet's currency. */
  amount: bigint;
  providerReference?: string | null;
}

export interface TransferResult {
  status: RailStatus;
  providerReference?: string;
  /** What arrived in the destination wallet, its currency, the rate and the provider's fee (destination currency). */
  received?: bigint;
  receivedCurrency?: string;
  rate?: string;
  fee?: bigint;
  failureCode?: string;
}

/** The operator of a number (international form), from the registry's prefixes. A number only works with its own operator. */
export const networkOfMsisdn = (msisdn: string): MobileNetwork | null => railOfMsisdn(msisdn)?.network ?? null;
/** What people call a network: "MTN MoMo". */
export const networkName = (network: MobileNetwork) => railByNetwork(network)?.name ?? network;

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
  const chosen = providerSettings(env)?.[kind];
  const name = chosen && servesLedger(env, chosen) ? chosen : routes()[network] || process.env.MOBILE_MONEY_PROVIDER || 'simulator';
  // A provider that does not serve this ledger is never used: the test ledger falls back to the
  // simulator (SasPay has no test mode), the real one stays refused (simulator check at the call).
  return providerByName(servesLedger(env, name) ? name : env === 'sandbox' ? 'simulator' : name);
}
