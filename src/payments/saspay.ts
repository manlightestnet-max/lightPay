import crypto from 'crypto';
import type { MobileMoneyProvider, ProviderBalance, ProviderRate, RailOperation, RailResult, RateSide, RateTier, TransferOperation, TransferResult } from './mobile-money.js';
import { allRails, countryByCode, countryByIso2, currencyOfNetwork, providerCode, railByNetwork } from '../rails/registry.js';
import type { Environment } from '../types/index.js';

/**
 * SasPay (https://docs.saspay.me) — country and method codes come from the registry (src/rails/registry.ts).
 *
 *   collect   POST /payments/softpay/            -> id, status PENDING (push on the phone)
 *   verify    GET  /payments/{id}/verify/        SUCCESS | PENDING | FAILED | CANCELLED
 *   payout    POST /payouts/initialize/          (API key needs PAYOUT scope + whitelisted IP)
 *   verify    GET  /payouts/{id}/verify/
 *   balances  GET  /merchant-balances/     one wallet per country: available_amount, pending_amount, is_frozen
 *   rates     GET  /pricing/my-rates/       per operator: payin / payout tiers (percent, fixed, floor, cap), OTP
 *   transfer  POST /wallet-transfers/      { from_country, to_country, from_amount } -> COMPLETED | PENDING (SasPay's approval) | REJECTED
 *             GET  /wallet-transfers/{id}/  one transfer at a time per merchant (transfer_already_pending)
 *   webhooks  X-Webhook-Signature = hex HMAC-SHA256(secret, "{X-Webhook-Timestamp}.{raw body}")
 *
 * Env: SASPAY_SECRET_KEY (sk_live_… / sk_test_…), SASPAY_WEBHOOK_SECRET, SASPAY_API_URL,
 *      SASPAY_COLLECTION_FEE_MODE (default ADD_ON: the payer pays the fee, we receive the amount)
 *      SASPAY_PAYOUT_FEE_MODE     (default ADD_ON: the phone receives the amount; the fee, already
 *                                  debited from the person's wallet, is taken from our SasPay balance)
 */

/** SasPay's country (ISO2) and method code for an operation's rail; refused when SasPay does not serve it. */
const railCodes = (op: RailOperation) => {
  const method = providerCode('saspay', op.network);
  const country = countryByCode(railByNetwork(op.network)?.country ?? '')?.iso2;
  if (!method || !country) throw new SasPayError(`SasPay does not serve ${op.network}`, 400, 'unsupported_network');
  return { country, method };
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

/** A wallet transfer as SasPay reports it: arrived (with what arrived, the rate and its fee), waiting, or refused. */
const transferResult = (r: any): TransferResult => {
  const s = String(r?.status ?? '').toUpperCase();
  const status = s === 'COMPLETED' ? 'SUCCEEDED' : s === 'REJECTED' ? 'FAILED' : 'PENDING';
  return {
    status,
    providerReference: r?.id ? String(r.id) : undefined,
    received: whole(r?.to_amount),
    receivedCurrency: r?.to_currency ? String(r.to_currency) : undefined,
    rate: r?.exchange_rate !== undefined && r?.exchange_rate !== null ? String(r.exchange_rate) : undefined,
    fee: whole(r?.fee_amount),
    failureCode: status === 'FAILED' ? `PROVIDER_REJECTED${r?.rejection_reason ? `: ${String(r.rejection_reason).slice(0, 40)}` : ''}` : undefined,
  };
};

export class SasPayError extends Error {
  constructor(message: string, public httpStatus: number, public code?: string) {
    super(message);
  }
}

export class SasPayProvider implements MobileMoneyProvider {
  name = 'saspay';
  // Real ledger only: SasPay has no test mode.
  configured(env: Environment) {
    return env === 'production' && Boolean(process.env.SASPAY_SECRET_KEY);
  }

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
      currency: currencyOfNetwork(op.network) ?? op.currency,
      country: railCodes(op).country,
      network: railCodes(op).method,
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
          currency: currencyOfNetwork(op.network) ?? op.currency,
          country: railCodes(op).country,
          method: railCodes(op).method,
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

  /** Moves our money between two of our SasPay country wallets (rebalancing). XAF ↔ XOF should come at 1 for 1. */
  async transfer(op: TransferOperation): Promise<TransferResult> {
    const iso2 = (code: string) => countryByCode(code)?.iso2 ?? code;
    try {
      const r = await this.call(
        'POST',
        '/wallet-transfers/',
        { from_country: iso2(op.fromCountry), to_country: iso2(op.toCountry), from_amount: `${op.amount.toString()}.00` },
        idempotencyUuid(op.id)
      );
      return transferResult(r);
    } catch (err) {
      if (err instanceof SasPayError && err.code === 'transfer_already_pending') return { status: 'PENDING', failureCode: 'ALREADY_PENDING' };
      // Refused (same country, frozen wallet, not enough money…): nothing moved.
      if (err instanceof SasPayError && err.httpStatus >= 400 && err.httpStatus < 500) return { status: 'FAILED', failureCode: (err.code || 'PROVIDER_REFUSED').toUpperCase() };
      throw err;
    }
  }

  async transferStatus(op: TransferOperation): Promise<TransferResult> {
    if (!op.providerReference) return { status: 'PENDING' };
    return transferResult(await this.call('GET', `/wallet-transfers/${encodeURIComponent(op.providerReference)}/`));
  }

  /** Our price, per operator and direction, as SasPay applies it now. Operators are matched to our rails by their SasPay code. */
  async rates(env: Environment): Promise<ProviderRate[]> {
    if (!this.configured(env)) return [];
    const r = await this.call('GET', '/pricing/my-rates/');
    const list: any[] = Array.isArray(r) ? r : Array.isArray(r?.results) ? r.results : Array.isArray(r?.data) ? r.data : [];
    const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
    const tier = (t: any): RateTier => ({
      min: num(t?.min_amount) ?? 0,
      max: num(t?.max_amount),
      percent: num(t?.percent) ?? 0,
      fixed: num(t?.fixed) ?? 0,
      floor: Math.max(num(t?.floor_amount) ?? 0, 0),
      cap: num(t?.cap_amount),
      mode: t?.fee_charge_mode ?? null,
    });
    const side = (s: any): RateSide => ({
      available: s?.available !== false && Array.isArray(s?.tiers) && s.tiers.length > 0,
      tiers: Array.isArray(s?.tiers) ? s.tiers.map(tier) : [],
      otpRequired: s?.otp_required === true,
      otpInstructions: s?.otp_instructions || null,
    });
    return list.map((x) => {
      const code = String(x.network_code ?? '');
      const rail = allRails().find((rl) => rl.providerCodes.saspay === code);
      const iso2 = String(x.country_code ?? '').toUpperCase();
      return {
        country: countryByIso2(iso2)?.code ?? iso2,
        currency: String(x.currency ?? ''),
        providerCode: code,
        network: rail?.network ?? null,
        name: String(x.network_name ?? code),
        collection: side(x.payin),
        payout: side(x.payout),
      };
    });
  }

  /** Our wallet in each country (paginated, 100 per page). A country unknown to the registry keeps SasPay's code. */
  async balances(env: Environment): Promise<ProviderBalance[]> {
    if (!this.configured(env)) return [];
    const out: ProviderBalance[] = [];
    for (let page = 1; page <= 20; page++) {
      const r = await this.call('GET', `/merchant-balances/?page=${page}&page_size=100`);
      const list: any[] = Array.isArray(r) ? r : Array.isArray(r?.results) ? r.results : Array.isArray(r?.data) ? r.data : [];
      for (const b of list) {
        const iso2 = String(b.country ?? '').toUpperCase();
        out.push({
          country: countryByIso2(iso2)?.code ?? iso2,
          currency: String(b.currency ?? ''),
          available: whole(b.available_amount) ?? 0n,
          pending: whole(b.pending_amount),
          frozen: b.is_frozen === true,
        });
      }
      if (!r?.next) break;
    }
    return out;
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
