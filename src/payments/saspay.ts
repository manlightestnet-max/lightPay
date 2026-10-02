import crypto from 'crypto';
import type { MobileMoneyProvider, MobileNetwork, RailOperation, RailResult } from './mobile-money.js';

/**
 * SasPay (https://docs.saspay.me) — Congo-Brazzaville only here (CG, XAF).
 *
 *   collect   POST /payments/softpay/            -> id, status PENDING (push on the phone)
 *   verify    GET  /payments/{id}/verify/        SUCCESS | PENDING | FAILED | CANCELLED
 *   payout    POST /payouts/initialize/          (API key needs PAYOUT scope + whitelisted IP)
 *   verify    GET  /payouts/{id}/verify/
 *   webhooks  X-Webhook-Signature = hex HMAC-SHA256(secret, "{X-Webhook-Timestamp}.{raw body}")
 *
 * Env: SASPAY_SECRET_KEY (sk_live_… / sk_test_…), SASPAY_WEBHOOK_SECRET, SASPAY_API_URL,
 *      SASPAY_COLLECTION_FEE_MODE (default ADD_ON: the payer pays the fee, we receive the amount)
 *      SASPAY_PAYOUT_FEE_MODE     (default ADD_ON: the phone receives the amount; the fee, already
 *                                  debited from the person's wallet, is taken from our SasPay balance)
 */

const NETWORK_CODES: Record<MobileNetwork, string> = {
  MTN_MOMO_COG: 'mtn_cg',
  AIRTEL_COG: 'airtel_cg',
};

const baseUrl = () => (process.env.SASPAY_API_URL || 'https://api.saspay.me/api/v1').replace(/\/$/, '');

/** Our ids (ca_…/po_…) are not UUIDs: derive a stable UUID for SasPay's Idempotency-Key. */
const idempotencyUuid = (id: string) => {
  const h = crypto.createHash('sha256').update(`lightpay:${id}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** SasPay needs a customer; guests have none, so we send a neutral, non-personal one. */
const customerOf = (op: RailOperation) => {
  const [first, ...rest] = String(op.customer?.name || 'Client LightPay').trim().split(/\s+/);
  return {
    email: op.customer?.email || `mobile+${op.msisdn}@lightpay.smlab.xyz`,
    first_name: first || 'Client',
    last_name: rest.join(' ') || 'LightPay',
    phone: op.msisdn,
  };
};

/** "213.00" -> 213n (XAF has no minor unit). */
const whole = (v: unknown): bigint | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? BigInt(Math.round(n)) : undefined;
};

const mapStatus = (status: string): RailResult['status'] => {
  const s = String(status || '').toUpperCase();
  if (s === 'SUCCESS' || s === 'SUCCEEDED' || s === 'COMPLETED') return 'SUCCEEDED';
  if (s === 'FAILED' || s === 'CANCELLED' || s === 'CANCELED' || s === 'EXPIRED' || s === 'REJECTED') return 'FAILED';
  return 'PENDING';
};

export class SasPayError extends Error {
  constructor(message: string, public httpStatus: number, public code?: string) {
    super(message);
  }
}

export class SasPayProvider implements MobileMoneyProvider {
  name = 'saspay';

  private async call(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string) {
    const key = process.env.SASPAY_SECRET_KEY;
    if (!key) throw new SasPayError('SASPAY_SECRET_KEY is not configured', 500, 'not_configured');
    const res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      const err = json?.error ?? {};
      // SasPay's own words, for the server logs (its error object never carries our key).
      console.error('[SASPAY]', method, path, `HTTP ${res.status}`, JSON.stringify(json?.error ?? json));
      throw new SasPayError(typeof err.message === 'string' ? err.message : `SasPay HTTP ${res.status}`, res.status, err.code);
    }
    // Some endpoints wrap in { success, data }, others return the object directly.
    return json?.data && typeof json.data === 'object' && !Array.isArray(json.data) ? json.data : json;
  }

  private collectBody(op: RailOperation) {
    return {
      amount: `${op.amount.toString()}.00`,
      currency: op.currency,
      country: 'CG',
      network: NETWORK_CODES[op.network],
      customer: customerOf(op),
      description: op.description || 'Paiement LightPay',
      fee_charge_mode: process.env.SASPAY_COLLECTION_FEE_MODE || 'ADD_ON',
      metadata: { lightpay_id: op.id },
    };
  }

  async requestCollection(op: RailOperation): Promise<RailResult> {
    try {
      const r = await this.call('POST', '/payments/softpay/', this.collectBody(op), idempotencyUuid(op.id));
      return { status: mapStatus(r.status), providerReference: r.id, failureCode: mapStatus(r.status) === 'FAILED' ? 'PROVIDER_FAILED' : undefined };
    } catch (err) {
      // A refused request (4xx) is a final failure; a network error stays PENDING only if SasPay may have it.
      if (err instanceof SasPayError && err.httpStatus >= 400 && err.httpStatus < 500) return { status: 'FAILED', failureCode: (err.code || 'PROVIDER_REFUSED').toUpperCase() };
      throw err;
    }
  }

  async collectionStatus(op: RailOperation): Promise<RailResult> {
    if (!op.providerReference) return { status: 'PENDING' };
    const r = await this.call('GET', `/payments/${encodeURIComponent(op.providerReference)}/verify/`);
    const status = mapStatus(r.status);
    return {
      status,
      providerReference: r.id ?? op.providerReference,
      failureCode: status === 'FAILED' ? `PROVIDER_${String(r.status).toUpperCase()}` : undefined,
      providerFee: whole(r.client_fee ?? r.amounts?.fee),
      charged: whole(r.debited_amount ?? r.amounts?.charged),
    };
  }

  async requestPayout(op: RailOperation): Promise<RailResult> {
    try {
      const r = await this.call(
        'POST',
        '/payouts/initialize/',
        {
          amount: `${op.amount.toString()}.00`,
          currency: op.currency,
          country: 'CG',
          method: NETWORK_CODES[op.network],
          recipient: { msisdn: op.msisdn },
          customer: customerOf(op),
          description: op.description || 'Retrait LightPay',
          fee_charge_mode: process.env.SASPAY_PAYOUT_FEE_MODE || 'ADD_ON',
          metadata: { lightpay_id: op.id },
        },
        idempotencyUuid(op.id)
      );
      return { status: mapStatus(r.status), providerReference: r.id };
    } catch (err) {
      if (err instanceof SasPayError && err.httpStatus >= 400 && err.httpStatus < 500) return { status: 'FAILED', failureCode: (err.code || 'PROVIDER_REFUSED').toUpperCase() };
      throw err;
    }
  }

  async payoutStatus(op: RailOperation): Promise<RailResult> {
    if (!op.providerReference) return { status: 'PENDING' };
    const r = await this.call('GET', `/payouts/${encodeURIComponent(op.providerReference)}/verify/`);
    const status = mapStatus(r.status);
    return { status, providerReference: r.id ?? op.providerReference, failureCode: status === 'FAILED' ? `PROVIDER_${String(r.status).toUpperCase()}` : undefined };
  }
}

/** Webhook authenticity: HMAC over "{timestamp}.{raw body}", constant-time, max 5 minutes old. */
export function verifySasPayWebhook(rawBody: string, signature: string | undefined, timestamp: string | undefined, secret = process.env.SASPAY_WEBHOOK_SECRET) {
  if (!secret || !signature || !timestamp || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const given = signature.trim().toLowerCase();
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
