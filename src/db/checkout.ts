import crypto from 'crypto';
import { LedgerEngine } from './ledger.js';
import { Escrow, HoldRecord } from './escrow.js';
import { query } from './pool.js';
import { Environment } from '../types/index.js';
import { MOBILE_NETWORKS, MobileNetwork, NETWORK_NAMES, RailOperation, RailResult, networkOfMsisdn, normalizeCongoMsisdn, providerByName, providerFor } from '../payments/mobile-money.js';
import { PayoutRow, sendPayout } from './payouts.js';
import { lightpayFeeWallet } from './fee-wallet.js';
import { appName, failureOf, logActivity, reasonFor, updateActivity } from './activity.js';
import { enforceAppQuotas } from '../middleware/quota-enforcer.js';
import { FeeQuote, lightpayCollectionFee, minMobileMoneyAmount, providerPayoutFee, quote, refundSendable } from '../payments/fees.js';
import { dispatchWebhook } from '../webhooks/dispatch.js';
import { LightPayUser } from '../security/user-token.js';
import { getConnection, payeeWallet, requireScope, userWallet } from './connect.js';

/**
 * CHECKOUT — an app asks LightPay for a payment (server side, secret key); the payer pays
 * on the LightPay page. As a guest with mobile money:
 *
 *   MoMo collection  SYSTEM_GATEWAY_INFLOW --> guest wallet (bound to the paying number)
 *   escrow hold      guest wallet --> payee LOCKED          (or direct payment if escrow=false)
 *   refund           payee LOCKED --> guest wallet --> payout to the same number
 *
 * A signed-in LightPay user can pay from their own wallet instead. A DEPOSIT session
 * credits the person's own wallet (mobile money in, no escrow). Payees are always LightPay
 * users connected to the app with the "payee" scope.
 *
 * Every step has a deterministic idempotency key, so resolving an attempt twice (poll +
 * timer, or after a crash) never moves money twice.
 */

export class CheckoutError extends Error {
  constructor(message: string, public code: string, public statusCode = 400) {
    super(message);
  }
}

export type CheckoutMethod = 'mobile_money' | 'lightpay_wallet';
const METHODS: CheckoutMethod[] = ['mobile_money', 'lightpay_wallet'];

export interface CheckoutSession {
  id: string;
  app_id: string;
  environment: Environment;
  status: 'OPEN' | 'PROCESSING' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED';
  kind: 'PAYMENT' | 'DEPOSIT';
  amount: string;
  fee_amount: string;
  currency: string;
  reference: string | null;
  description: string | null;
  payee_wallet_id: string;
  payee_connection_id: string | null;
  payer_type: 'GUEST' | 'USER' | null;
  escrow: boolean;
  methods: CheckoutMethod[];
  return_url: string | null;
  cancel_url: string | null;
  payer_wallet_id: string | null;
  payer_msisdn: string | null;
  hold_id: string | null;
  payment_transaction_id: string | null;
  metadata: Record<string, any>;
  expires_at: Date;
  completed_at: Date | null;
  created_at: Date;
}

interface Attempt {
  id: string;
  session_id: string;
  environment: Environment;
  provider: string;
  network: MobileNetwork;
  msisdn: string;
  amount: string;
  currency: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  failure_code: string | null;
  provider_reference: string | null;
  lightpay_fee: string;
  provider_fee: string | null;
  charged_amount: string | null;
  created_at: Date;
}

export const environmentOfSession = (id: string): Environment | null =>
  id.startsWith('cs_test_') ? 'sandbox' : id.startsWith('cs_live_') ? 'production' : null;

const newId = (prefix: string) => `${prefix}${crypto.randomBytes(18).toString('base64url')}`;

/** "242065124481" -> "+242 06 ••• •• 81" (never the full number outside the ledger). */
export const maskMsisdn = (msisdn: string) => `+242 ${msisdn.slice(3, 5)} ••• •• ${msisdn.slice(-2)}`;

// ---------------------------------------------------------------- wallets

const getOrCreateWallet = async (environment: Environment, appId: string, accountId: string, accountType: string, currency: string, metadata: Record<string, any>) =>
  (
    await query(
      `INSERT INTO wallets (app_id, account_id, account_type, currency, environment, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (app_id, account_id, currency, environment) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [appId, accountId, accountType, currency, environment, JSON.stringify(metadata)],
      environment
    )
  )[0];

const guestWallet = (environment: Environment, msisdn: string, currency: string) =>
  getOrCreateWallet(environment, 'mainapp', `guest:${msisdn}`, 'GUEST', currency, { msisdn });

// ---------------------------------------------------------------- sessions

export interface CreateSessionInput {
  amount: bigint;
  feeAmount: bigint;
  currency: string;
  reference?: string;
  description?: string;
  /** conn_… of a seller connected with the "payee" scope. */
  payeeConnectionId: string;
  escrow: boolean;
  methods: CheckoutMethod[];
  returnUrl?: string;
  cancelUrl?: string;
  expiresInMinutes: number;
  metadata?: Record<string, any>;
  kind?: 'PAYMENT' | 'DEPOSIT';
}

const safeUrl = (value?: string) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1' ? url.toString() : null;
  } catch {
    return null;
  }
};

export async function createSession(appId: string, environment: Environment, idempotencyKey: string, input: CreateSessionInput): Promise<{ session: CheckoutSession; duplicate: boolean }> {
  const existing = (await query(`SELECT * FROM checkout_sessions WHERE app_id = $1 AND environment = $2 AND idempotency_key = $3`, [appId, environment, idempotencyKey], environment))[0];
  if (existing) return { session: existing, duplicate: true };

  if (input.amount <= 0n) throw new CheckoutError('amount must be greater than zero', 'INVALID_AMOUNT');
  if (input.feeAmount < 0n || input.feeAmount >= input.amount) throw new CheckoutError('fee_amount must be >= 0 and < amount', 'INVALID_FEE');
  if (!input.methods.length || input.methods.some((m) => !METHODS.includes(m))) throw new CheckoutError(`methods: ${METHODS.join(', ')}`, 'INVALID_METHODS');
  for (const [name, value] of [['return_url', input.returnUrl], ['cancel_url', input.cancelUrl]] as const) {
    if (value && !safeUrl(value)) throw new CheckoutError(`${name} must be an https URL`, 'INVALID_URL');
  }
  const payee = await payeeWallet(appId, environment, input.payeeConnectionId);

  const id = newId(environment === 'sandbox' ? 'cs_test_' : 'cs_live_');
  const minutes = Math.min(Math.max(input.expiresInMinutes, 5), 24 * 60);
  const rows = await query(
    `INSERT INTO checkout_sessions (id, app_id, environment, idempotency_key, amount, fee_amount, currency, reference, description, payee_wallet_id, escrow, methods, return_url, cancel_url, metadata, expires_at, payee_connection_id, kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW() + ($16 || ' minutes')::interval, $17, $18)
     ON CONFLICT (app_id, environment, idempotency_key) DO NOTHING
     RETURNING *`,
    [
      id, appId, environment, idempotencyKey, input.amount.toString(), input.feeAmount.toString(), input.currency, input.reference ?? null,
      input.description ?? null, payee.wallet_id, input.escrow, JSON.stringify(input.methods), safeUrl(input.returnUrl), safeUrl(input.cancelUrl),
      JSON.stringify(input.metadata ?? {}), String(minutes), payee.id, input.kind ?? 'PAYMENT',
    ],
    environment
  );
  if (rows.length === 0) return createSession(appId, environment, idempotencyKey, input); // lost a race: return the winner
  return { session: rows[0], duplicate: false };
}

export async function getSession(id: string, appId?: string): Promise<CheckoutSession | undefined> {
  const environment = environmentOfSession(id);
  if (!environment) return undefined;
  const session = (await query(`SELECT * FROM checkout_sessions WHERE id = $1 ${appId ? 'AND app_id = $2' : ''}`, appId ? [id, appId] : [id], environment))[0];
  if (!session) return undefined;
  await refresh(session);
  return (await query(`SELECT * FROM checkout_sessions WHERE id = $1`, [id], environment))[0];
}

/** Expires stale sessions and resolves the attempt in flight (lazy, on every read). */
async function refresh(session: CheckoutSession) {
  const environment = session.environment;
  const pending = (await query(`SELECT * FROM collection_attempts WHERE session_id = $1 AND status = 'PENDING'`, [session.id], environment))[0];
  // A read never fails because of a resolution error: the background watch retries.
  if (pending) await resolveAttempt(pending).catch((err) => console.error('[CHECKOUT] resolve on read failed', pending.id, err?.message));
  if (session.status === 'OPEN' && new Date(session.expires_at).getTime() < Date.now()) {
    await query(`UPDATE checkout_sessions SET status = 'EXPIRED', updated_at = NOW() WHERE id = $1 AND status = 'OPEN'`, [session.id], environment);
  }
}

export async function cancelSession(id: string, appId: string) {
  const environment = environmentOfSession(id);
  if (!environment) throw new CheckoutError('Session not found', 'SESSION_NOT_FOUND', 404);
  const rows = await query(
    `UPDATE checkout_sessions SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1 AND app_id = $2 AND status = 'OPEN' RETURNING *`,
    [id, appId],
    environment
  );
  if (rows.length === 0) throw new CheckoutError('Only an open session can be cancelled', 'SESSION_NOT_OPEN', 409);
  return rows[0] as CheckoutSession;
}

/** What the payment page may show: no wallet ids, no full phone numbers. */
export async function publicView(id: string) {
  const session = await getSession(id);
  if (!session) return undefined;
  const environment = session.environment;
  const [app] = await query(`SELECT name FROM apps WHERE id = $1`, [session.app_id], environment);
  const [payee] = await query(`SELECT metadata FROM wallets WHERE id = $1`, [session.payee_wallet_id], environment);
  const payeeName = payee?.metadata?.name ?? payee?.metadata?.display_name ?? null;
  const [attempt] = await query(
    `SELECT status, failure_code, network, msisdn, created_at, amount, lightpay_fee, provider_fee, charged_amount FROM collection_attempts WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [session.id],
    environment
  );
  return {
    id: session.id,
    environment,
    kind: session.kind,
    status: session.status,
    amount: session.amount,
    currency: session.currency,
    reference: session.reference,
    description: session.description,
    merchant: app?.name ?? session.app_id,
    payee: payeeName,
    escrow: session.escrow,
    methods: session.methods,
    return_url: session.status === 'COMPLETED' ? session.return_url : null,
    cancel_url: session.cancel_url,
    expires_at: session.expires_at,
    // What the payer will pay by mobile money, per network (exact once the operator reports it).
    fees: Object.fromEntries(MOBILE_NETWORKS.map((n) => [n, quote(session.environment, BigInt(session.amount), providerFor(session.environment, n).name)])) as Record<MobileNetwork, FeeQuote>,
    last_attempt: attempt
      ? {
          status: attempt.status,
          failure_code: attempt.failure_code,
          reason: attempt.failure_code ? reasonFor(attempt.failure_code) : null,
          network: attempt.network,
          msisdn: maskMsisdn(attempt.msisdn),
          at: attempt.created_at,
          lightpay_fee: String(attempt.lightpay_fee),
          operator_fee: attempt.provider_fee === null ? null : String(attempt.provider_fee),
          charged: attempt.charged_amount === null ? null : String(attempt.charged_amount),
        }
      : null,
  };
}

// ---------------------------------------------------------------- mobile money

const railOp = (a: Attempt): RailOperation => ({
  id: a.id,
  environment: a.environment,
  msisdn: a.msisdn,
  amount: BigInt(a.amount),
  currency: a.currency,
  network: a.network,
  createdAt: new Date(a.created_at),
  providerReference: a.provider_reference,
  description: 'Paiement LightPay',
});

export async function startMobileMoney(id: string, msisdnInput: string, network: string) {
  const session = await getSession(id);
  if (!session) throw new CheckoutError('Session not found', 'SESSION_NOT_FOUND', 404);
  const environment = session.environment;
  if (session.status !== 'OPEN') throw new CheckoutError(`This payment is ${session.status.toLowerCase()}`, 'SESSION_NOT_OPEN', 409);
  if (!session.methods.includes('mobile_money')) throw new CheckoutError('Mobile money is not accepted for this payment', 'METHOD_NOT_ALLOWED');
  if (!MOBILE_NETWORKS.includes(network as MobileNetwork)) throw new CheckoutError(`network: ${MOBILE_NETWORKS.join(', ')}`, 'INVALID_NETWORK');
  const msisdn = normalizeCongoMsisdn(msisdnInput);
  if (!msisdn) throw new CheckoutError('Numéro invalide : 9 chiffres, par exemple 06 512 44 81', 'INVALID_MSISDN');
  if (networkOfMsisdn(msisdn) !== network) throw new CheckoutError(`Ce numéro n’est pas un numéro ${NETWORK_NAMES[network as MobileNetwork]}.`, 'NETWORK_MISMATCH');
  if (BigInt(session.amount) < minMobileMoneyAmount(environment)) {
    throw new CheckoutError(`Le mobile money accepte au minimum ${minMobileMoneyAmount(environment)} FCFA.`, 'BELOW_MOBILE_MONEY_MINIMUM');
  }

  // App quotas are checked BEFORE the phone is asked to pay: money already collected must
  // never be blocked by a quota afterwards (the collection itself skips quotas).
  try {
    await enforceAppQuotas(session.app_id, environment, BigInt(session.amount));
  } catch (err: any) {
    throw new CheckoutError(err.message, err.code || 'QUOTA_EXCEEDED', 403);
  }
  const provider = providerFor(environment, network as MobileNetwork);
  // The simulator invents money: it never collects for the real ledger.
  if (environment === 'production' && provider.name === 'simulator') {
    throw new CheckoutError('Le mobile money est indisponible pour le moment. Réessayez plus tard.', 'PROVIDER_NOT_CONFIGURED', 503);
  }
  const lightpayFee = lightpayCollectionFee(environment, BigInt(session.amount));
  let attempt: Attempt;
  try {
    attempt = (
      await query(
        `INSERT INTO collection_attempts (id, session_id, environment, provider, network, msisdn, amount, currency, lightpay_fee)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        // The provider collects the amount + LightPay's fee; the operator fee comes on top.
        [newId('ca_'), session.id, environment, provider.name, network, msisdn, (BigInt(session.amount) + lightpayFee).toString(), session.currency, lightpayFee.toString()],
        environment
      )
    )[0];
  } catch (err: any) {
    if (err.code === '23505') throw new CheckoutError('Un paiement est déjà en cours : validez-le sur votre téléphone.', 'ATTEMPT_IN_PROGRESS', 409);
    throw err;
  }
  await query(`UPDATE checkout_sessions SET status = 'PROCESSING', updated_at = NOW() WHERE id = $1 AND status = 'OPEN'`, [session.id], environment);

  // Journal: a top-up line for the person, or a payment line for the paying number (guest).
  const via = `${network === 'AIRTEL_COG' ? 'Airtel Money' : 'MTN MoMo'} · ${maskMsisdn(msisdn)}`;
  if (session.kind === 'DEPOSIT') {
    await logActivity(environment, {
      walletId: session.payee_wallet_id, kind: 'DEPOSIT', direction: 'IN', status: 'PENDING', amount: session.amount, fees: lightpayFee,
      currency: session.currency, counterparty: via, refType: 'collection', refId: attempt.id, metadata: { session: session.id },
    });
  } else {
    const guest = await guestWallet(environment, msisdn, session.currency);
    await logActivity(environment, {
      walletId: guest.id, kind: 'PAYMENT', direction: 'OUT', status: 'PENDING', amount: session.amount, fees: lightpayFee,
      currency: session.currency, counterparty: await appName(environment, session.app_id), refType: 'collection', refId: attempt.id,
      metadata: { session: session.id, reference: session.reference, via },
    });
  }

  let sent;
  try {
    sent = await provider.requestCollection(railOp(attempt));
  } catch (err: any) {
    // Provider unreachable: the attempt stays PENDING and the (idempotent) request is retried.
    console.error('[CHECKOUT] collection request failed, will retry', attempt.id, err?.message);
    watch(attempt);
    return { attempt_id: attempt.id, status: 'PENDING', msisdn: maskMsisdn(msisdn), network };
  }
  if (sent.status === 'FAILED') {
    await failAttempt(attempt, sent.failureCode ?? 'REQUEST_FAILED');
  } else {
    await query(`UPDATE collection_attempts SET provider_reference = $2 WHERE id = $1`, [attempt.id, sent.providerReference ?? null], environment);
    watch(attempt);
  }
  return { attempt_id: attempt.id, status: sent.status === 'FAILED' ? 'FAILED' : 'PENDING', msisdn: maskMsisdn(msisdn), network };
}

/** Background resolution while the payer confirms on the phone (reads also resolve lazily). */
function watch(attempt: Attempt, tries = 0) {
  if (tries > 60) return;
  setTimeout(async () => {
    try {
      const [fresh] = await query(`SELECT * FROM collection_attempts WHERE id = $1`, [attempt.id], attempt.environment);
      if (fresh?.status !== 'PENDING') return;
      await resolveAttempt(fresh);
      watch(attempt, tries + 1);
    } catch (err) {
      console.error('[CHECKOUT] resolve failed', attempt.id, err);
      watch(attempt, tries + 1);
    }
  }, 2_000);
}

// One resolver per attempt at a time in this process (page polling + background watch).
const resolving = new Set<string>();

/**
 * A payer who never validates on the phone: past this, the attempt is closed on our side
 * (PAYER_TIMEOUT) and the session reopens, so nothing stays "en cours" forever. The provider is
 * still asked for LATE_SUCCESS_HOURS: if it reports the money arrived after all, it is credited.
 */
const COLLECTION_TIMEOUT_MS = Number(process.env.COLLECTION_TIMEOUT_MINUTES || 5) * 60_000;
const LATE_SUCCESS_HOURS = 24;
const TIMED_OUT = 'PAYER_TIMEOUT';

async function resolveAttempt(attempt: Attempt) {
  if (attempt.status !== 'PENDING' || resolving.has(attempt.id)) return;
  resolving.add(attempt.id);
  try {
    const provider = providerByName(attempt.provider);
    const expired = Date.now() - new Date(attempt.created_at).getTime() > COLLECTION_TIMEOUT_MS;
    let result: RailResult;
    try {
      // No provider id yet (request lost): re-send it, the provider deduplicates on our id.
      result = attempt.provider_reference ? await provider.collectionStatus(railOp(attempt)) : await provider.requestCollection(railOp(attempt));
      if (!attempt.provider_reference && result.providerReference) {
        await query(`UPDATE collection_attempts SET provider_reference = $2 WHERE id = $1`, [attempt.id, result.providerReference], attempt.environment);
        if (result.status === 'PENDING') result = await provider.collectionStatus({ ...railOp(attempt), providerReference: result.providerReference });
      }
    } catch (err) {
      // Provider unreachable past the deadline: closed on our side too (the late check follows up).
      if (expired) return await failAttempt(attempt, TIMED_OUT);
      throw err;
    }
    if (result.providerFee !== undefined || result.charged !== undefined) {
      await query(
        `UPDATE collection_attempts SET provider_fee = COALESCE($2, provider_fee), charged_amount = COALESCE($3, charged_amount), updated_at = NOW() WHERE id = $1`,
        [attempt.id, result.providerFee?.toString() ?? null, result.charged?.toString() ?? null],
        attempt.environment
      );
    }
    if (result.status === 'PENDING') {
      if (expired) await failAttempt(attempt, TIMED_OUT);
      return;
    }
    if (result.status === 'FAILED') return await failAttempt(attempt, result.failureCode ?? 'FAILED');
    return await completeCollection(attempt, result.providerReference);
  } finally {
    resolving.delete(attempt.id);
  }
}

async function failAttempt(attempt: Attempt, failureCode: string) {
  const env = attempt.environment;
  const done = await query(
    `UPDATE collection_attempts SET status = 'FAILED', failure_code = $2, updated_at = NOW() WHERE id = $1 AND status = 'PENDING' RETURNING id`,
    [attempt.id, failureCode],
    env
  );
  if (done.length === 0) return;
  await updateActivity(env, 'collection', attempt.id, { status: 'FAILED', reasonCode: failureCode });
  const [session] = await query(
    `UPDATE checkout_sessions SET status = 'OPEN', updated_at = NOW() WHERE id = $1 AND status = 'PROCESSING' RETURNING *`,
    [attempt.session_id],
    env
  );
  if (session) {
    void dispatchWebhook(session.app_id, env, 'checkout.payment_failed', {
      session_id: session.id,
      reference: session.reference,
      failure_code: failureCode,
      network: attempt.network,
    });
  }
}

/** Collection confirmed: fund the guest wallet, pay the payee (locked or not), close the session. */
async function completeCollection(attempt: Attempt, providerReference?: string) {
  const env = attempt.environment;
  const [session] = await query(`SELECT * FROM checkout_sessions WHERE id = $1`, [attempt.session_id], env);
  const gross = BigInt(attempt.amount);
  const lightpayFee = BigInt(attempt.lightpay_fee ?? 0);
  const amount = gross - lightpayFee; // what the payee / wallet receives
  const fee = BigInt(session.fee_amount);
  const inflow = await LedgerEngine.getOrCreateGatewayInflow('mainapp', env, attempt.currency);
  const lightpayFees = lightpayFee > 0n ? await lightpayFeeWallet(env, attempt.currency) : null;
  const feePosting = lightpayFees
    ? [{ walletId: lightpayFees, direction: 'CREDIT' as const, amount: lightpayFee, description: `Frais LightPay - ${attempt.id}` }]
    : [];

  if (session.kind === 'DEPOSIT') {
    const deposit = await LedgerEngine.executeTransaction({
      appId: session.app_id,
      environment: env,
      idempotencyKey: `deposit:${attempt.id}`,
      skipQuotas: true,
      type: 'COLLECTION',
      amount,
      currency: attempt.currency,
      reference: session.reference ?? session.id,
      metadata: { checkout_session: session.id, attempt: attempt.id, provider: attempt.provider, network: attempt.network, provider_reference: providerReference, deposit: true },
      postings: [
        { walletId: inflow, direction: 'DEBIT', amount: gross, description: `Mobile money in [${attempt.network}] - ${attempt.id}` },
        { walletId: session.payee_wallet_id, direction: 'CREDIT', amount, description: 'Dépôt sur le wallet' },
        ...feePosting,
      ],
    });
    return closeSession(session, attempt, providerReference, { payerWalletId: null, payerType: 'GUEST', holdId: null, paymentTx: (deposit as any).transactionId ?? (deposit as any).transaction?.id ?? null });
  }

  const payer = await guestWallet(env, attempt.msisdn, attempt.currency);

  // 1. Money arrives from the mobile network into the guest wallet.
  await LedgerEngine.executeTransaction({
    appId: session.app_id,
    environment: env,
    idempotencyKey: `collect:${attempt.id}`,
    skipQuotas: true,
    type: 'COLLECTION',
    amount,
    currency: attempt.currency,
    reference: session.reference ?? session.id,
    metadata: { checkout_session: session.id, attempt: attempt.id, provider: attempt.provider, network: attempt.network, provider_reference: providerReference },
    postings: [
      { walletId: inflow, direction: 'DEBIT', amount: gross, description: `Mobile money in [${attempt.network}] - ${attempt.id}` },
      { walletId: payer.id, direction: 'CREDIT', amount, description: `Guest top-up for ${session.id}` },
      ...feePosting,
    ],
  });

  // 2. The guest pays the payee: locked (escrow) or directly available.
  let holdId: string | null = null;
  let paymentTx: string | null = null;
  if (session.escrow) {
    const held = await Escrow.create({
      appId: session.app_id,
      environment: env,
      idempotencyKey: `hold:${session.id}`,
      payerWalletId: payer.id,
      beneficiaryWalletId: session.payee_wallet_id,
      amount,
      feeAmount: fee,
      currency: attempt.currency,
      reference: session.reference ?? session.id,
      metadata: { checkout_session: session.id },
      allowGuestDebit: true,
      skipQuotas: true,
    });
    holdId = held.hold?.id ?? null;
    paymentTx = held.hold?.hold_transaction_id ?? null;
  } else {
    const merchant = await merchantWallet(session.app_id, env, attempt.currency);
    const paid = await LedgerEngine.executeTransaction({
      appId: session.app_id,
      environment: env,
      idempotencyKey: `pay:${session.id}`,
      type: 'PAYMENT',
      amount,
      feeAmount: fee,
      currency: attempt.currency,
      reference: session.reference ?? session.id,
      metadata: { checkout_session: session.id },
      allowGuestDebit: true,
      skipQuotas: true,
      postings: [
        { walletId: payer.id, direction: 'DEBIT', amount },
        ...salePostings(session.payee_wallet_id, merchant, amount, fee, await appName(env, session.app_id), session.reference ?? session.id),
      ],
    });
    paymentTx = (paid as any).transactionId ?? (paid as any).transaction?.id ?? null;
  }

  return closeSession(session, attempt, providerReference, { payerWalletId: payer.id, payerType: 'GUEST', holdId, paymentTx });
}

/** Only the first resolver flips the states and notifies. */
async function closeSession(
  session: CheckoutSession,
  attempt: Attempt,
  providerReference: string | undefined,
  outcome: { payerWalletId: string | null; payerType: 'GUEST' | 'USER'; holdId: string | null; paymentTx: string | null }
) {
  const env = attempt.environment;
  const closed = await query(
    `UPDATE collection_attempts SET status = 'SUCCEEDED', provider_reference = COALESCE($2, provider_reference), updated_at = NOW() WHERE id = $1 AND status = 'PENDING' RETURNING id`,
    [attempt.id, providerReference ?? null],
    env
  );
  if (closed.length === 0) return;
  await query(
    `UPDATE checkout_sessions SET status = 'COMPLETED', payer_wallet_id = $2, payer_msisdn = $3, hold_id = $4, payment_transaction_id = $5, payer_type = $6, completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [session.id, outcome.payerWalletId, attempt.msisdn, outcome.holdId, outcome.paymentTx, outcome.payerType],
    env
  );
  const { holdId } = outcome;
  await updateActivity(env, 'collection', attempt.id, { status: 'SUCCEEDED', total: attempt.charged_amount ?? undefined });
  void dispatchWebhook(session.app_id, env, session.kind === 'DEPOSIT' ? 'deposit.completed' : 'checkout.completed', {
    kind: session.kind,
    session_id: session.id,
    reference: session.reference,
    amount: session.amount,
    fee_amount: session.fee_amount,
    currency: session.currency,
    escrow: session.escrow,
    hold_id: holdId,
    payer: { type: 'guest', msisdn: maskMsisdn(attempt.msisdn), network: attempt.network },
    metadata: session.metadata,
  });
}

// ---------------------------------------------------------------- settlement helpers

/**
 * A direct sale on the payee's statement: the full amount in, then the app's commission out as its
 * own line (credit first on the same wallet: postings keep this order).
 */
const salePostings = (payee: string, appWallet: string, amount: bigint, fee: bigint, app: string, ref: string) => [
  { walletId: payee, direction: 'CREDIT' as const, amount, description: `Vente · Réf ${ref}` },
  ...(fee > 0n
    ? [
        { walletId: payee, direction: 'DEBIT' as const, amount: fee, description: `Commission ${app} · Réf ${ref}` },
        { walletId: appWallet, direction: 'CREDIT' as const, amount: fee, description: `Commission · Réf ${ref}` },
      ]
    : []),
];

export async function merchantWallet(appId: string, environment: Environment, currency: string): Promise<string> {
  const wallet = await getOrCreateWallet(environment, appId, appId, 'MERCHANT', currency, { role: 'merchant_root' });
  return wallet.id;
}

/**
 * After a hold is released to a guest payer: send the money back to the number that paid,
 * never anywhere else. Idempotent per hold.
 */
export async function refundGuestPayer(hold: HoldRecord) {
  const env = hold.environment;
  const [payer] = await query(`SELECT * FROM wallets WHERE id = $1`, [hold.payer_wallet_id], env);
  if (payer?.account_type !== 'GUEST') return null;

  const [attempt] = await query(
    `SELECT a.* FROM collection_attempts a JOIN checkout_sessions s ON s.id = a.session_id
     WHERE s.hold_id = $1 AND a.status = 'SUCCEEDED' ORDER BY a.created_at DESC LIMIT 1`,
    [hold.id],
    env
  );
  const msisdn: string = attempt?.msisdn ?? payer.metadata?.msisdn;
  const network: MobileNetwork = attempt?.network ?? 'MTN_MOMO_COG';
  // The operator fee of a refund is paid out of the refund itself (LightPay takes nothing):
  // the guest gets the largest amount that, fee included, fits in what they paid.
  const total = BigInt(hold.amount);
  const provider = providerFor(env, network, 'payout').name;
  const sendable = refundSendable(env, total, provider);
  if (sendable <= 0n) {
    // Nothing can be sent without losing money: the amount stays in the guest wallet (bound to
    // this number) and the app is told, so it can settle with the customer another way.
    void dispatchWebhook(hold.app_id, env, 'refund.failed', {
      hold_id: hold.id,
      reference: hold.reference,
      amount: hold.amount,
      currency: hold.currency,
      to: maskMsisdn(msisdn),
      network,
      failure_code: 'REFUND_BELOW_FEES',
      operator_fee: providerPayoutFee(env, provider, 1n).toString(),
    });
    return { status: 'FAILED', failure_code: 'REFUND_BELOW_FEES', amount: '0', operator_fee: '0', total: hold.amount, to: maskMsisdn(msisdn), network };
  }
  const payout: PayoutRow = await sendPayout({
    environment: env,
    appId: hold.app_id,
    walletId: payer.id,
    msisdn,
    network,
    amount: sendable,
    operatorFee: total - sendable,
    currency: hold.currency,
    reason: 'GUEST_REFUND',
    reference: `refund:${hold.id}`,
    description: `Remboursement vers ${maskMsisdn(msisdn)}`,
    allowGuestDebit: true,
    metadata: { hold_id: hold.id },
  });
  void dispatchWebhook(hold.app_id, env, 'refund.sent', {
    hold_id: hold.id,
    reference: hold.reference,
    paid: hold.amount,
    sent: payout.amount,
    operator_fee: payout.operator_fee,
    currency: hold.currency,
    to: maskMsisdn(msisdn),
    network,
    status: payout.status,
  });
  return { id: payout.id, status: payout.status, amount: String(payout.amount), operator_fee: String(payout.operator_fee), total: String(payout.total_debited ?? payout.amount), to: maskMsisdn(msisdn), network };
}

// ---------------------------------------------------------------- LightPay wallet & deposits

/** A signed-in LightPay user pays from their own wallet (escrow or direct). */
export async function payWithWallet(id: string, user: LightPayUser) {
  const session = await getSession(id);
  if (!session) throw new CheckoutError('Session not found', 'SESSION_NOT_FOUND', 404);
  const env = session.environment;
  if (session.kind !== 'PAYMENT') throw new CheckoutError('Only payments can be paid with a wallet', 'METHOD_NOT_ALLOWED');
  if (!session.methods.includes('lightpay_wallet')) throw new CheckoutError('LightPay wallet is not accepted for this payment', 'METHOD_NOT_ALLOWED');
  const payer = await userWallet(env, user, session.currency);
  const merchantName = await appName(env, session.app_id);
  const journal = (status: 'SUCCEEDED' | 'FAILED', err?: any) => {
    const f = err ? failureOf(err) : null;
    return logActivity(env, {
      walletId: payer.id, kind: 'PAYMENT', direction: 'OUT', status, amount: session.amount, total: session.amount, currency: session.currency,
      counterparty: merchantName, reasonCode: f?.code, reason: f?.message, refType: 'checkout', refId: session.id,
      metadata: { reference: session.reference, escrow: session.escrow },
    });
  };
  if (payer.id === session.payee_wallet_id) {
    const err = new CheckoutError('Vous ne pouvez pas vous payer vous-même.', 'SAME_WALLET');
    await journal('FAILED', err);
    throw err;
  }

  const locked = await query(
    `UPDATE checkout_sessions SET status = 'PROCESSING', updated_at = NOW() WHERE id = $1 AND status = 'OPEN' AND expires_at > NOW() RETURNING id`,
    [session.id],
    env
  );
  if (locked.length === 0) throw new CheckoutError('Ce paiement n’est plus disponible.', 'SESSION_NOT_OPEN', 409);

  const amount = BigInt(session.amount);
  const fee = BigInt(session.fee_amount);
  let holdId: string | null = null;
  let paymentTx: string | null = null;
  try {
    if (session.escrow) {
      const held = await Escrow.create({
        appId: session.app_id, environment: env, idempotencyKey: `hold:${session.id}`,
        payerWalletId: payer.id, beneficiaryWalletId: session.payee_wallet_id, amount, feeAmount: fee,
        currency: session.currency, reference: session.reference ?? session.id, metadata: { checkout_session: session.id },
      });
      holdId = held.hold?.id ?? null;
      paymentTx = held.hold?.hold_transaction_id ?? null;
    } else {
      const merchant = await merchantWallet(session.app_id, env, session.currency);
      const paid = await LedgerEngine.executeTransaction({
        appId: session.app_id, environment: env, idempotencyKey: `pay:${session.id}`, type: 'PAYMENT', amount, feeAmount: fee,
        currency: session.currency, reference: session.reference ?? session.id, metadata: { checkout_session: session.id },
        postings: [
          { walletId: payer.id, direction: 'DEBIT', amount },
          ...salePostings(session.payee_wallet_id, merchant, amount, fee, await appName(env, session.app_id), session.reference ?? session.id),
        ],
      });
      paymentTx = (paid as any).transactionId ?? (paid as any).transaction?.id ?? null;
    }
  } catch (err: any) {
    await query(`UPDATE checkout_sessions SET status = 'OPEN', updated_at = NOW() WHERE id = $1 AND status = 'PROCESSING'`, [session.id], env);
    await journal('FAILED', err);
    if (String(err.message).startsWith('Insufficient funds')) throw new CheckoutError('Solde LightPay insuffisant. Déposez sur votre wallet ou payez par mobile money.', 'INSUFFICIENT_FUNDS', 402);
    throw err;
  }

  await query(
    `UPDATE checkout_sessions SET status = 'COMPLETED', payer_wallet_id = $2, payer_type = 'USER', hold_id = $3, payment_transaction_id = $4, completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [session.id, payer.id, holdId, paymentTx],
    env
  );
  await journal('SUCCEEDED');
  void dispatchWebhook(session.app_id, env, 'checkout.completed', {
    kind: session.kind,
    session_id: session.id,
    reference: session.reference,
    amount: session.amount,
    fee_amount: session.fee_amount,
    currency: session.currency,
    escrow: session.escrow,
    hold_id: holdId,
    payer: { type: 'lightpay' },
    metadata: session.metadata,
  });
  return publicView(session.id);
}

/** An app offers a connected person a top-up of their own wallet (scope deposit). */
export async function createDepositSession(
  appId: string,
  environment: Environment,
  idempotencyKey: string,
  connectionId: string,
  input: { amount: bigint; currency?: string; returnUrl?: string; cancelUrl?: string; reference?: string }
) {
  const person = await getConnection(appId, environment, connectionId);
  requireScope(person, 'deposit');
  const existing = (await query(`SELECT * FROM checkout_sessions WHERE app_id = $1 AND environment = $2 AND idempotency_key = $3`, [appId, environment, idempotencyKey], environment))[0];
  if (existing) return { session: existing as CheckoutSession, duplicate: true };
  if (input.amount <= 0n) throw new CheckoutError('amount must be greater than zero', 'INVALID_AMOUNT');
  const id = newId(environment === 'sandbox' ? 'cs_test_' : 'cs_live_');
  const [session] = await query(
    `INSERT INTO checkout_sessions (id, app_id, environment, idempotency_key, kind, amount, fee_amount, currency, reference, description, payee_wallet_id, payee_connection_id, escrow, methods, return_url, cancel_url, expires_at)
     VALUES ($1, $2, $3, $4, 'DEPOSIT', $5, 0, $6, $7, 'Dépôt sur le wallet LightPay', $8, $9, FALSE, '["mobile_money"]'::jsonb, $10, $11, NOW() + interval '30 minutes')
     RETURNING *`,
    [id, appId, environment, idempotencyKey, input.amount.toString(), input.currency ?? 'XAF', input.reference ?? null, person.wallet_id, person.id, safeUrl(input.returnUrl), safeUrl(input.cancelUrl)],
    environment
  );
  return { session: session as CheckoutSession, duplicate: false };
}

/** Provider notification: re-check this collection with the provider (never trust the payload). */
export async function resolveCollectionByProviderReference(providerReference: string) {
  for (const env of ['production', 'sandbox'] as Environment[]) {
    const [attempt] = await query(`SELECT * FROM collection_attempts WHERE provider_reference = $1`, [providerReference], env);
    if (attempt) {
      await resolveAttempt(attempt);
      return true;
    }
  }
  return false;
}

/** Sweeper: collections still pending after a while (lost webhooks, restarts). */
export async function sweepPendingCollections() {
  for (const env of ['production', 'sandbox'] as Environment[]) {
    const pending = await query(
      `SELECT * FROM collection_attempts WHERE status = 'PENDING' AND created_at < NOW() - interval '20 seconds' ORDER BY created_at LIMIT 50`,
      [],
      env
    );
    for (const attempt of pending) await resolveAttempt(attempt).catch((err) => console.error('[SWEEP] collection', attempt.id, err?.message));
    // Closed by our timeout: still asked to the provider for a day, in case it went through late.
    const late = await query(
      `SELECT * FROM collection_attempts WHERE status = 'FAILED' AND failure_code = $1 AND created_at > NOW() - make_interval(hours => $2) ORDER BY created_at LIMIT 50`,
      [TIMED_OUT, LATE_SUCCESS_HOURS],
      env
    );
    for (const attempt of late) await resolveLate(attempt).catch((err) => console.error('[SWEEP] late collection', attempt.id, err?.message));
  }
}

/** An attempt closed by our timeout that the provider finally settles. */
async function resolveLate(attempt: Attempt) {
  if (resolving.has(attempt.id)) return;
  resolving.add(attempt.id);
  try {
    const env = attempt.environment;
    const result = await providerByName(attempt.provider).collectionStatus(railOp(attempt));
    if (result.status === 'PENDING') return;
    if (result.status === 'FAILED') {
      // Final at the provider too: keep its reason and stop asking.
      await query(`UPDATE collection_attempts SET failure_code = $2, updated_at = NOW() WHERE id = $1 AND status = 'FAILED' AND failure_code = $3`, [attempt.id, result.failureCode ?? 'FAILED', TIMED_OUT], env);
      await updateActivity(env, 'collection', attempt.id, { status: 'FAILED', reasonCode: result.failureCode ?? 'FAILED' });
      return;
    }
    // The money arrived late. A payment already settled by another attempt is not paid twice:
    // left to the admin (the payer is refunded by hand), loudly logged.
    const [session] = await query(`SELECT * FROM checkout_sessions WHERE id = $1`, [attempt.session_id], env);
    if (session?.status === 'COMPLETED' && session.kind !== 'DEPOSIT') {
      console.error('[CHECKOUT] late collection on a settled payment, refund by hand', attempt.id, session.id);
      return;
    }
    const reopened = await query(
      `UPDATE collection_attempts SET status = 'PENDING', failure_code = NULL, updated_at = NOW() WHERE id = $1 AND status = 'FAILED' AND failure_code = $2 RETURNING *`,
      [attempt.id, TIMED_OUT],
      env
    ).catch((err) => {
      // Another attempt of the same session is pending (one at a time): retried next sweep.
      if (err.code === '23505') return [];
      throw err;
    });
    if (!reopened.length) return;
    if (result.providerFee !== undefined || result.charged !== undefined) {
      await query(`UPDATE collection_attempts SET provider_fee = COALESCE($2, provider_fee), charged_amount = COALESCE($3, charged_amount) WHERE id = $1`, [attempt.id, result.providerFee?.toString() ?? null, result.charged?.toString() ?? null], env);
    }
    await completeCollection(reopened[0], result.providerReference);
  } finally {
    resolving.delete(attempt.id);
  }
}
