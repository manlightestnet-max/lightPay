import crypto from 'crypto';
import { Environment } from '../types/index.js';
import type { MobileMoneyProvider, RailOperation, RailResult } from './mobile-money.js';
import { providerFeeEstimate } from './fees.js';

/**
 * pawaPay Merchant API v2 (https://docs.pawapay.io/v2) — Congo-Brazzaville here
 * (MTN_MOMO_COG, AIRTEL_COG, XAF without decimals, numbers 242…). Our network codes are
 * pawaPay's provider codes.
 *
 *   collect   POST /v2/deposits           { depositId, payer, amount, currency, … }
 *                                          -> ACCEPTED | DUPLICATE_IGNORED | REJECTED (+ failureReason)
 *   status    GET  /v2/deposits/{id}      -> { status: FOUND | NOT_FOUND, data: { status, amount, failureReason } }
 *                                          ACCEPTED · PROCESSING · IN_RECONCILIATION -> COMPLETED | FAILED
 *   payout    POST /v2/payouts            { payoutId, recipient, amount, currency, … }
 *   status    GET  /v2/payouts/{id}       … ENQUEUED too, then COMPLETED | FAILED
 *   callbacks POST /v1/providers/pawapay/callback (deposits and payouts, final states only):
 *             only a hint, the status is re-read from the API before any money moves.
 *
 * pawaPay ids are UUIDs: derived from ours (ca_… / po_…), so a resend is deduplicated
 * (DUPLICATE_IGNORED) and the id is known even if the first answer was lost.
 *
 * Ledgers: the sandbox ledger talks to pawaPay's sandbox, the real one to production.
 *   PAWAPAY_API_TOKEN          production token          PAWAPAY_API_URL           (default https://api.pawapay.io)
 *   PAWAPAY_SANDBOX_API_TOKEN  sandbox token             PAWAPAY_SANDBOX_API_URL   (default https://api.sandbox.pawapay.io)
 *
 * Fees: pawaPay takes its fee out of our pawaPay balance. The payer covers it with the
 * operator fee the admin sets for pawaPay (pawapay_deposit_fee_bps), asked on top of the
 * amount; a payout's fee (pawapay_payout_fee_bps) is debited from the person's wallet.
 */

const CONFIG: Record<Environment, { token: () => string | undefined; url: () => string }> = {
  production: { token: () => process.env.PAWAPAY_API_TOKEN, url: () => process.env.PAWAPAY_API_URL || 'https://api.pawapay.io' },
  sandbox: { token: () => process.env.PAWAPAY_SANDBOX_API_TOKEN, url: () => process.env.PAWAPAY_SANDBOX_API_URL || 'https://api.sandbox.pawapay.io' },
};

/** Stable UUID for one of our ids (pawaPay requires UUIDs as deposit / payout ids). */
export const pawaPayId = (id: string) => {
  const h = crypto.createHash('sha256').update(`lightpay:pawapay:${id}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** Shown in the customer's SMS / history: 4 to 22 letters, digits or spaces. */
const CUSTOMER_MESSAGE = 'LightPay';
/** A payment pawaPay has never heard of after this long was never created: nothing was taken. */
const NOT_FOUND_AFTER_MS = 10 * 60_000;

/** "1071" or "1071.00" -> 1071n (XAF has no minor unit). */
const whole = (v: unknown): bigint | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? BigInt(Math.round(n)) : undefined;
};

/** pawaPay's failure codes, in the words our pages already explain. */
const failureOf = (reason: any): string => {
  const code = String(reason?.failureCode || 'UNSPECIFIED_FAILURE').toUpperCase();
  if (code === 'PAYMENT_NOT_APPROVED') return 'PAYER_DECLINED';
  if (code === 'INSUFFICIENT_BALANCE') return 'INSUFFICIENT_BALANCE';
  return `PROVIDER_${code}`;
};

const PENDING_STATES = new Set(['ACCEPTED', 'ENQUEUED', 'PROCESSING', 'IN_RECONCILIATION', 'SUBMITTED']);

export class PawaPayError extends Error {
  constructor(message: string, public httpStatus: number, public code?: string) {
    super(message);
  }
}

export class PawaPayProvider implements MobileMoneyProvider {
  name = 'pawapay';

  configured(env: Environment) {
    return Boolean(CONFIG[env].token());
  }

  private async call(env: Environment, method: 'GET' | 'POST', path: string, body?: unknown) {
    const token = CONFIG[env].token();
    if (!token) throw new PawaPayError(`pawaPay token missing for the ${env} ledger`, 500, 'NOT_CONFIGURED');
    const res = await fetch(`${CONFIG[env].url().replace(/\/$/, '')}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      // pawaPay's own words for the server logs (its answers never carry our token).
      console.error('[PAWAPAY]', env, method, path, `HTTP ${res.status}`, JSON.stringify(json?.failureReason ?? json));
      throw new PawaPayError(json?.failureReason?.failureMessage || `pawaPay HTTP ${res.status}`, res.status, json?.failureReason?.failureCode);
    }
    return json;
  }

  /** Initiation answer: accepted (or already accepted) = pending; rejected = final failure. */
  private initiated(json: any, id: string): RailResult {
    const status = String(json?.status || '').toUpperCase();
    if (status === 'REJECTED') return { status: 'FAILED', failureCode: failureOf(json.failureReason), providerReference: id };
    return { status: 'PENDING', providerReference: id };
  }

  private async initiate(op: RailOperation, path: string, body: Record<string, unknown>): Promise<RailResult> {
    try {
      return this.initiated(await this.call(op.environment, 'POST', path, body), pawaPayId(op.id));
    } catch (err) {
      // A refused request (4xx: token, parameters) is final; a network error or 5xx stays pending
      // and is re-sent (same id, deduplicated by pawaPay).
      if (err instanceof PawaPayError && err.httpStatus >= 400 && err.httpStatus < 500) return { status: 'FAILED', failureCode: `PROVIDER_${err.code || 'REFUSED'}` };
      throw err;
    }
  }

  private async status(op: RailOperation, path: string): Promise<RailResult & { amount?: bigint }> {
    const json = await this.call(op.environment, 'GET', path);
    if (String(json?.status).toUpperCase() === 'NOT_FOUND') {
      return Date.now() - op.createdAt.getTime() > NOT_FOUND_AFTER_MS ? { status: 'FAILED', failureCode: 'PROVIDER_NOT_FOUND' } : { status: 'PENDING' };
    }
    const data = json?.data ?? {};
    const state = String(data.status || '').toUpperCase();
    // Our reference stays pawaPay's id (callbacks are matched on it), not the operator's.
    if (state === 'COMPLETED') return { status: 'SUCCEEDED', providerReference: pawaPayId(op.id), amount: whole(data.amount) };
    if (state === 'FAILED') return { status: 'FAILED', failureCode: failureOf(data.failureReason), providerReference: pawaPayId(op.id) };
    if (!PENDING_STATES.has(state)) console.warn('[PAWAPAY] unknown status', state, op.id);
    return { status: 'PENDING' };
  }

  // ------------------------------------------------------------ collections (deposits)

  async requestCollection(op: RailOperation): Promise<RailResult> {
    // The payer covers pawaPay's fee: asked on top, exactly the operator fee quoted to them.
    const fee = providerFeeEstimate(op.environment, this.name, op.amount);
    return this.initiate(op, '/v2/deposits', {
      depositId: pawaPayId(op.id),
      payer: { type: 'MMO', accountDetails: { phoneNumber: op.msisdn, provider: op.network } },
      amount: (op.amount + fee).toString(),
      currency: op.currency,
      clientReferenceId: op.id,
      customerMessage: CUSTOMER_MESSAGE,
      metadata: [{ lightpayId: op.id }],
    });
  }

  async collectionStatus(op: RailOperation): Promise<RailResult> {
    const r = await this.status(op, `/v2/deposits/${pawaPayId(op.id)}`);
    if (r.status !== 'SUCCEEDED' || r.amount === undefined) return r;
    // What the phone paid, and the part above what we asked for (the operator fee).
    return { status: r.status, providerReference: r.providerReference, charged: r.amount, providerFee: r.amount > op.amount ? r.amount - op.amount : 0n };
  }

  // ------------------------------------------------------------ payouts

  async requestPayout(op: RailOperation): Promise<RailResult> {
    return this.initiate(op, '/v2/payouts', {
      payoutId: pawaPayId(op.id),
      recipient: { type: 'MMO', accountDetails: { phoneNumber: op.msisdn, provider: op.network } },
      amount: op.amount.toString(),
      currency: op.currency,
      clientReferenceId: op.id,
      customerMessage: CUSTOMER_MESSAGE,
      metadata: [{ lightpayId: op.id }],
    });
  }

  async payoutStatus(op: RailOperation): Promise<RailResult> {
    const r = await this.status(op, `/v2/payouts/${pawaPayId(op.id)}`);
    return { status: r.status, failureCode: r.failureCode, providerReference: pawaPayId(op.id) };
  }
}
