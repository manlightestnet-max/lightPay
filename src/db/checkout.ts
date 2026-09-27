import crypto from 'crypto';
import { LedgerEngine } from './ledger.js';
import { Escrow, HoldRecord } from './escrow.js';
import { query } from './pool.js';
import { Environment } from '../types/index.js';
import { MOBILE_NETWORKS, MobileNetwork, RailOperation, mobileMoneyProvider, normalizeCongoMsisdn } from '../payments/mobile-money.js';
import { dispatchWebhook } from '../webhooks/dispatch.js';

/**
 * CHECKOUT — an app asks LightPay for a payment (server side, secret key); the payer pays
 * on the LightPay page. As a guest with mobile money:
 *
 *   MoMo collection  SYSTEM_GATEWAY_INFLOW --> guest wallet (bound to the paying number)
 *   escrow hold      guest wallet --> payee LOCKED          (or direct payment if escrow=false)
 *   refund           payee LOCKED --> guest wallet --> payout to the same number
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
  amount: string;
  fee_amount: string;
  currency: string;
  reference: string | null;
  description: string | null;
  payee_wallet_id: string;
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

/** A seller of the app. Receives locked funds; withdraws only what is available. */
export async function upsertPayee(appId: string, environment: Environment, externalId: string, displayName: string, currency = 'XAF') {
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(externalId)) throw new CheckoutError('external_id: 1-80 chars, letters, digits, _ . : -', 'INVALID_PAYEE_ID');
  const wallet = await getOrCreateWallet(environment, appId, `payee:${externalId}`, 'PAYEE', currency, { display_name: displayName, external_id: externalId });
  if (wallet.account_type !== 'PAYEE') throw new CheckoutError('This id belongs to another kind of account', 'PAYEE_CONFLICT', 409);
  await query(`UPDATE wallets SET metadata = metadata || $2 WHERE id = $1`, [wallet.id, JSON.stringify({ display_name: displayName })], environment);
  return { ...wallet, metadata: { ...wallet.metadata, display_name: displayName } };
}

export async function getPayee(appId: string, environment: Environment, externalId: string, currency = 'XAF') {
  return (
    await query(`SELECT * FROM wallets WHERE app_id = $1 AND account_id = $2 AND currency = $3 AND environment = $4 AND account_type = 'PAYEE'`, [
      appId,
      `payee:${externalId}`,
      currency,
      environment,
    ], environment)
  )[0];
}

const guestWallet = (environment: Environment, msisdn: string, currency: string) =>
  getOrCreateWallet(environment, 'mainapp', `guest:${msisdn}`, 'GUEST', currency, { msisdn });

// ---------------------------------------------------------------- sessions

export interface CreateSessionInput {
  amount: bigint;
  feeAmount: bigint;
  currency: string;
  reference?: string;
  description?: string;
  payeeExternalId: string;
  escrow: boolean;
  methods: CheckoutMethod[];
  returnUrl?: string;
  cancelUrl?: string;
  expiresInMinutes: number;
  metadata?: Record<string, any>;
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
  const payee = await getPayee(appId, environment, input.payeeExternalId, input.currency);
  if (!payee) throw new CheckoutError(`Unknown payee "${input.payeeExternalId}" (create it with PUT /v1/payees/:external_id)`, 'PAYEE_NOT_FOUND', 404);

  const id = newId(environment === 'sandbox' ? 'cs_test_' : 'cs_live_');
  const minutes = Math.min(Math.max(input.expiresInMinutes, 5), 24 * 60);
  const rows = await query(
    `INSERT INTO checkout_sessions (id, app_id, environment, idempotency_key, amount, fee_amount, currency, reference, description, payee_wallet_id, escrow, methods, return_url, cancel_url, metadata, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW() + ($16 || ' minutes')::interval)
     ON CONFLICT (app_id, environment, idempotency_key) DO NOTHING
     RETURNING *`,
    [
      id, appId, environment, idempotencyKey, input.amount.toString(), input.feeAmount.toString(), input.currency, input.reference ?? null,
      input.description ?? null, payee.id, input.escrow, JSON.stringify(input.methods), safeUrl(input.returnUrl), safeUrl(input.cancelUrl),
      JSON.stringify(input.metadata ?? {}), String(minutes),
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
  const [attempt] = await query(
    `SELECT status, failure_code, network, msisdn, created_at FROM collection_attempts WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [session.id],
    environment
  );
  return {
    id: session.id,
    environment,
    status: session.status,
    amount: session.amount,
    currency: session.currency,
    reference: session.reference,
    description: session.description,
    merchant: app?.name ?? session.app_id,
    payee: payee?.metadata?.display_name ?? null,
    escrow: session.escrow,
    methods: session.methods,
    return_url: session.status === 'COMPLETED' ? session.return_url : null,
    cancel_url: session.cancel_url,
    expires_at: session.expires_at,
    last_attempt: attempt
      ? { status: attempt.status, failure_code: attempt.failure_code, network: attempt.network, msisdn: maskMsisdn(attempt.msisdn), at: attempt.created_at }
      : null,
  };
}

// ---------------------------------------------------------------- mobile money

const railOp = (a: Attempt): RailOperation => ({
  id: a.id,
  msisdn: a.msisdn,
  amount: BigInt(a.amount),
  currency: a.currency,
  network: a.network,
  createdAt: new Date(a.created_at),
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

  const provider = mobileMoneyProvider();
  let attempt: Attempt;
  try {
    attempt = (
      await query(
        `INSERT INTO collection_attempts (id, session_id, environment, provider, network, msisdn, amount, currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [newId('ca_'), session.id, environment, provider.name, network, msisdn, session.amount, session.currency],
        environment
      )
    )[0];
  } catch (err: any) {
    if (err.code === '23505') throw new CheckoutError('Un paiement est déjà en cours : validez-le sur votre téléphone.', 'ATTEMPT_IN_PROGRESS', 409);
    throw err;
  }
  await query(`UPDATE checkout_sessions SET status = 'PROCESSING', updated_at = NOW() WHERE id = $1 AND status = 'OPEN'`, [session.id], environment);

  const sent = await provider.requestCollection(railOp(attempt));
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

async function resolveAttempt(attempt: Attempt) {
  if (attempt.status !== 'PENDING' || resolving.has(attempt.id)) return;
  resolving.add(attempt.id);
  try {
    const result = await mobileMoneyProvider().collectionStatus(railOp(attempt));
    if (result.status === 'PENDING') return;
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
  const amount = BigInt(attempt.amount);
  const fee = BigInt(session.fee_amount);
  const payer = await guestWallet(env, attempt.msisdn, attempt.currency);
  const inflow = await LedgerEngine.getOrCreateGatewayInflow('mainapp', env, attempt.currency);

  // 1. Money arrives from the mobile network into the guest wallet.
  await LedgerEngine.executeTransaction({
    appId: session.app_id,
    environment: env,
    idempotencyKey: `collect:${attempt.id}`,
    type: 'COLLECTION',
    amount,
    currency: attempt.currency,
    reference: session.reference ?? session.id,
    metadata: { checkout_session: session.id, attempt: attempt.id, provider: attempt.provider, network: attempt.network, provider_reference: providerReference },
    postings: [
      { walletId: inflow, direction: 'DEBIT', amount, description: `Mobile money in [${attempt.network}] - ${attempt.id}` },
      { walletId: payer.id, direction: 'CREDIT', amount, description: `Guest top-up for ${session.id}` },
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
        { walletId: session.payee_wallet_id, direction: 'CREDIT', amount: amount - fee },
        ...(fee > 0n ? [{ walletId: merchant, direction: 'CREDIT' as const, amount: fee }] : []),
      ],
    });
    paymentTx = (paid as any).transactionId ?? (paid as any).transaction?.id ?? null;
  }

  // 3. Close: only the first resolver flips the states and notifies.
  const closed = await query(
    `UPDATE collection_attempts SET status = 'SUCCEEDED', provider_reference = COALESCE($2, provider_reference), updated_at = NOW() WHERE id = $1 AND status = 'PENDING' RETURNING id`,
    [attempt.id, providerReference ?? null],
    env
  );
  if (closed.length === 0) return;
  await query(
    `UPDATE checkout_sessions SET status = 'COMPLETED', payer_wallet_id = $2, payer_msisdn = $3, hold_id = $4, payment_transaction_id = $5, completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [session.id, payer.id, attempt.msisdn, holdId, paymentTx],
    env
  );
  void dispatchWebhook(session.app_id, env, 'checkout.completed', {
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
  const existing = (await query(`SELECT * FROM payouts WHERE reference = $1 AND reason = 'GUEST_REFUND'`, [`refund:${hold.id}`], env))[0];
  if (existing) return existing;

  const [attempt] = await query(
    `SELECT a.* FROM collection_attempts a JOIN checkout_sessions s ON s.id = a.session_id
     WHERE s.hold_id = $1 AND a.status = 'SUCCEEDED' ORDER BY a.created_at DESC LIMIT 1`,
    [hold.id],
    env
  );
  const msisdn: string = attempt?.msisdn ?? payer.metadata?.msisdn;
  const network: MobileNetwork = attempt?.network ?? 'MTN_MOMO_COG';
  const amount = BigInt(hold.amount);
  const outflow = await LedgerEngine.getOrCreateGatewayInflow('mainapp', env, hold.currency);
  const payoutId = newId('po_');

  const tx = await LedgerEngine.executeTransaction({
    appId: hold.app_id,
    environment: env,
    idempotencyKey: `refund:${hold.id}`,
    type: 'PAYOUT',
    amount,
    currency: hold.currency,
    reference: hold.reference ?? hold.id,
    metadata: { hold_id: hold.id, payout: payoutId, reason: 'GUEST_REFUND' },
    allowGuestDebit: true,
    skipQuotas: true,
    postings: [
      { walletId: payer.id, direction: 'DEBIT', amount, description: `Guest refund to ${maskMsisdn(msisdn)}` },
      { walletId: outflow, direction: 'CREDIT', amount, description: `Mobile money out [${network}] - ${payoutId}` },
    ],
  });

  const provider = mobileMoneyProvider();
  const sent = await provider.requestPayout({ id: payoutId, msisdn, amount, currency: hold.currency, network, createdAt: new Date() });
  const [payout] = await query(
    `INSERT INTO payouts (id, environment, wallet_id, provider, network, msisdn, amount, currency, reason, status, transaction_id, failure_code, reference)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'GUEST_REFUND', $9, $10, $11, $12) RETURNING *`,
    [
      payoutId, env, payer.id, provider.name, network, msisdn, amount.toString(), hold.currency, sent.status,
      (tx as any).transactionId ?? (tx as any).transaction?.id ?? null, sent.failureCode ?? null, `refund:${hold.id}`,
    ],
    env
  );
  void dispatchWebhook(hold.app_id, env, 'refund.sent', {
    hold_id: hold.id,
    reference: hold.reference,
    amount: hold.amount,
    currency: hold.currency,
    to: maskMsisdn(msisdn),
    network,
    status: sent.status,
  });
  return payout;
}
