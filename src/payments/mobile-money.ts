/**
 * Mobile-money rails (collections and payouts). The checkout only talks to this
 * interface; pawaPay (or MTN/Airtel direct) plugs in later without touching the ledger.
 */

export type MobileNetwork = 'MTN_MOMO_COG' | 'AIRTEL_COG';
export const MOBILE_NETWORKS: MobileNetwork[] = ['MTN_MOMO_COG', 'AIRTEL_COG'];

export type RailStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

export interface RailOperation {
  id: string;
  msisdn: string;
  amount: bigint;
  currency: string;
  network: MobileNetwork;
  createdAt: Date;
}

export interface RailResult {
  status: RailStatus;
  failureCode?: string;
  providerReference?: string;
}

export interface MobileMoneyProvider {
  name: string;
  /** Sends the payment request to the payer's phone. */
  requestCollection(op: RailOperation): Promise<RailResult>;
  /** Current state of a collection (polling; providers also call back). */
  collectionStatus(op: RailOperation): Promise<RailResult>;
  /** Sends money to a phone number. */
  requestPayout(op: RailOperation): Promise<RailResult>;
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
 * Stateless: the outcome only depends on the number and the time elapsed.
 */
export class SimulatorProvider implements MobileMoneyProvider {
  name = 'SIMULATOR';
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
}

/** Active rail. MOBILE_MONEY_PROVIDER=simulator until pawaPay is plugged in. */
export function mobileMoneyProvider(): MobileMoneyProvider {
  const name = (process.env.MOBILE_MONEY_PROVIDER || 'simulator').toLowerCase();
  if (name === 'simulator') return simulator;
  throw new Error(`Mobile money provider "${name}" is not available yet`);
}

const simulator = new SimulatorProvider(
  Number(process.env.SIMULATOR_APPROVE_MS || 4_000),
  Number(process.env.SIMULATOR_TIMEOUT_MS || 20_000)
);
