import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAppAuth } from '../middleware/app-auth.js';
import { CheckoutError, CheckoutMethod, cancelSession, createDepositSession, createSession, getSession } from '../db/checkout.js';
import {
  ConnectError,
  charge,
  connectionBalance,
  connectionView,
  exchangeCode,
  getConnection,
  requireScope,
  setRedirectUris,
  walletStatement,
} from '../db/connect.js';
import { EscrowError } from '../db/escrow.js';

const context = (request: FastifyRequest) => ({
  appId: request.appData!.id,
  environment: request.appData!.environment || 'production',
});

const idempotencyOf = (request: FastifyRequest) => (request.headers['idempotency-key'] as string) || request.idempotencyKey;

const fail = (reply: FastifyReply, err: any) => {
  const known = err instanceof CheckoutError || err instanceof ConnectError || err instanceof EscrowError;
  const insufficient = String(err?.message ?? '').startsWith('Insufficient funds');
  return reply.status(known ? err.statusCode : insufficient ? 402 : err.statusCode || 400).send({
    status: 'error',
    error: insufficient ? 'INSUFFICIENT_FUNDS' : err.code || 'REQUEST_ERROR',
    message: err.message,
  });
};

/** Where payers land: CHECKOUT_BASE_URL (https://checkout.smlab.xyz), else PUBLIC_BASE_URL, else the host called. */
const baseUrl = (request: FastifyRequest) =>
  (
    process.env.CHECKOUT_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    `${request.headers['x-forwarded-proto'] || request.protocol}://${request.headers.host}`
  ).replace(/\/$/, '');

const sessionView = (request: FastifyRequest, s: any) => ({
  id: s.id,
  kind: s.kind,
  status: s.status,
  environment: s.environment,
  amount: s.amount,
  fee_amount: s.fee_amount,
  currency: s.currency,
  reference: s.reference,
  description: s.description,
  escrow: s.escrow,
  methods: s.methods,
  payee: s.payee_connection_id,
  hold_id: s.hold_id,
  payment_transaction_id: s.payment_transaction_id,
  payer: s.payer_type ? { type: s.payer_type === 'USER' ? 'lightpay' : 'guest' } : null,
  metadata: s.metadata,
  checkout_url: `${baseUrl(request)}/pay/${s.id}`,
  expires_at: s.expires_at,
  completed_at: s.completed_at,
  created_at: s.created_at,
});

/**
 * App-side API (secret key, from the app's server).
 *
 *   PUT  /v1/apps/redirect-uris                  where LightPay may send people back
 *   POST /v1/connect/token                       code + PKCE verifier -> connection
 *   GET  /v1/connections/:id                     scopes, account
 *   GET  /v1/connections/:id/balance             balance:read
 *   GET  /v1/connections/:id/transactions        balance:read
 *   POST /v1/connections/:id/deposits            deposit  -> checkout_url
 *   POST /v1/connections/:id/charges             charge   (within the person's limit)
 *   POST /v1/checkout/sessions                   payment to a connected seller -> checkout_url
 *   GET  /v1/checkout/sessions/:id | POST …/cancel
 */
export async function checkoutRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAppAuth);

  fastify.put('/apps/redirect-uris', async (request, reply) => {
    try {
      const uris = await setRedirectUris(context(request).appId, (request.body as any)?.redirect_uris);
      return { status: 'success', redirect_uris: uris };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post('/connect/token', async (request, reply) => {
    const { appId, environment } = context(request);
    const { code, redirect_uri, code_verifier } = (request.body ?? {}) as any;
    try {
      return { status: 'success', connection: await exchangeCode(appId, environment, String(code ?? ''), String(redirect_uri ?? ''), String(code_verifier ?? '')) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get('/connections/:id', async (request, reply) => {
    const { appId, environment } = context(request);
    try {
      return { status: 'success', connection: await connectionView(await getConnection(appId, environment, (request.params as any).id)) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get('/connections/:id/balance', async (request, reply) => {
    const { appId, environment } = context(request);
    try {
      const c = await getConnection(appId, environment, (request.params as any).id);
      requireScope(c, 'balance:read');
      return { status: 'success', balance: await connectionBalance(c) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get('/connections/:id/transactions', async (request, reply) => {
    const { appId, environment } = context(request);
    try {
      const c = await getConnection(appId, environment, (request.params as any).id);
      requireScope(c, 'balance:read');
      return { status: 'success', entries: await walletStatement(environment, c.wallet_id, Number((request.query as any).limit ?? 50)) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post('/connections/:id/deposits', async (request, reply) => {
    const { appId, environment } = context(request);
    const idempotencyKey = idempotencyOf(request);
    if (!idempotencyKey) return reply.status(400).send({ error: 'Missing required header: Idempotency-Key' });
    const b = (request.body ?? {}) as any;
    if (!b.amount) return reply.status(400).send({ error: 'amount is required' });
    try {
      const { session, duplicate } = await createDepositSession(appId, environment, idempotencyKey, (request.params as any).id, {
        amount: BigInt(b.amount),
        currency: b.currency,
        returnUrl: b.return_url,
        cancelUrl: b.cancel_url,
        reference: b.reference,
      });
      return reply.status(duplicate ? 200 : 201).send({ status: 'success', duplicate, session: sessionView(request, session) });
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post('/connections/:id/charges', async (request, reply) => {
    const { appId, environment } = context(request);
    const idempotencyKey = idempotencyOf(request);
    if (!idempotencyKey) return reply.status(400).send({ error: 'Missing required header: Idempotency-Key' });
    const b = (request.body ?? {}) as any;
    if (!b.amount) return reply.status(400).send({ error: 'amount is required' });
    try {
      const result = await charge(appId, environment, (request.params as any).id, idempotencyKey, {
        amount: BigInt(b.amount),
        feeAmount: BigInt(b.fee_amount ?? 0),
        reference: b.reference,
        description: b.description,
        payeeConnectionId: b.payee,
        escrow: b.escrow !== false,
        metadata: b.metadata,
      });
      return reply.status(result.duplicate ? 200 : 201).send({ status: 'success', ...result });
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post('/checkout/sessions', async (request, reply) => {
    const { appId, environment } = context(request);
    const idempotencyKey = idempotencyOf(request);
    if (!idempotencyKey) return reply.status(400).send({ error: 'Missing required header: Idempotency-Key' });
    const b = (request.body ?? {}) as any;
    if (!b.amount || !b.payee) return reply.status(400).send({ error: 'Missing required fields: amount, payee (conn_… of a connected seller)' });
    try {
      const { session, duplicate } = await createSession(appId, environment, idempotencyKey, {
        amount: BigInt(b.amount),
        feeAmount: BigInt(b.fee_amount ?? 0),
        currency: b.currency ?? 'XAF',
        reference: b.reference,
        description: b.description,
        payeeConnectionId: String(b.payee),
        escrow: b.escrow !== false,
        methods: (Array.isArray(b.methods) ? b.methods : ['mobile_money', 'lightpay_wallet']) as CheckoutMethod[],
        returnUrl: b.return_url,
        cancelUrl: b.cancel_url,
        expiresInMinutes: Number(b.expires_in_minutes ?? 30),
        metadata: b.metadata,
      });
      return reply.status(duplicate ? 200 : 201).send({ status: 'success', duplicate, session: sessionView(request, session) });
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get('/checkout/sessions/:id', async (request, reply) => {
    const session = await getSession((request.params as any).id, context(request).appId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    return { status: 'success', session: sessionView(request, session) };
  });

  fastify.post('/checkout/sessions/:id/cancel', async (request, reply) => {
    try {
      const session = await cancelSession((request.params as any).id, context(request).appId);
      return { status: 'success', session: sessionView(request, session) };
    } catch (err) {
      return fail(reply, err);
    }
  });
}
