import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAppAuth } from '../middleware/app-auth.js';
import { CheckoutError, CheckoutMethod, cancelSession, createSession, getPayee, getSession, upsertPayee } from '../db/checkout.js';
import { query } from '../db/pool.js';

const context = (request: FastifyRequest) => ({
  appId: request.appData!.id,
  environment: request.appData!.environment || 'production',
});

const fail = (reply: FastifyReply, err: any) =>
  reply.status(err instanceof CheckoutError ? err.statusCode : err.statusCode || 400).send({
    status: 'error',
    error: err.code || 'CHECKOUT_ERROR',
    message: err.message,
  });

/** Public base URL of the payment page (PUBLIC_BASE_URL, else the host that was called). */
const baseUrl = (request: FastifyRequest) =>
  (process.env.PUBLIC_BASE_URL || `${request.headers['x-forwarded-proto'] || request.protocol}://${request.headers.host}`).replace(/\/$/, '');

const sessionView = (request: FastifyRequest, s: any) => ({
  id: s.id,
  status: s.status,
  environment: s.environment,
  amount: s.amount,
  fee_amount: s.fee_amount,
  currency: s.currency,
  reference: s.reference,
  description: s.description,
  escrow: s.escrow,
  methods: s.methods,
  hold_id: s.hold_id,
  payment_transaction_id: s.payment_transaction_id,
  payer: s.payer_wallet_id ? { type: 'guest', wallet_id: s.payer_wallet_id } : null,
  metadata: s.metadata,
  checkout_url: `${baseUrl(request)}/pay/${s.id}`,
  expires_at: s.expires_at,
  completed_at: s.completed_at,
  created_at: s.created_at,
});

/**
 * App-side checkout API (secret key, from the app's server).
 *   PUT  /v1/payees/:external_id          declare a seller
 *   GET  /v1/payees/:external_id          seller balances (available / locked)
 *   POST /v1/checkout/sessions            ask for a payment -> checkout_url
 *   GET  /v1/checkout/sessions/:id        state (the webhook is the push version)
 *   POST /v1/checkout/sessions/:id/cancel cancel an open session
 */
export async function checkoutRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAppAuth);

  fastify.put('/payees/:external_id', async (request, reply) => {
    const { appId, environment } = context(request);
    const { display_name, currency = 'XAF' } = (request.body ?? {}) as any;
    if (!display_name) return reply.status(400).send({ error: 'display_name is required' });
    try {
      const wallet = await upsertPayee(appId, environment, (request.params as any).external_id, String(display_name).slice(0, 120), currency);
      return { status: 'success', payee: payeeView(wallet) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get('/payees/:external_id', async (request, reply) => {
    const { appId, environment } = context(request);
    const { currency = 'XAF' } = request.query as any;
    const wallet = await getPayee(appId, environment, (request.params as any).external_id, currency);
    if (!wallet) return reply.status(404).send({ error: 'Payee not found' });
    const holds = await query(
      `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::text AS amount FROM holds WHERE wallet_id = $1 GROUP BY status`,
      [wallet.id],
      environment
    );
    return { status: 'success', payee: payeeView(wallet), holds };
  });

  fastify.post('/checkout/sessions', async (request, reply) => {
    const { appId, environment } = context(request);
    const idempotencyKey = (request.headers['idempotency-key'] as string) || request.idempotencyKey;
    if (!idempotencyKey) return reply.status(400).send({ error: 'Missing required header: Idempotency-Key' });
    const b = (request.body ?? {}) as any;
    if (!b.amount || !b.payee) return reply.status(400).send({ error: 'Missing required fields: amount, payee' });
    try {
      const { session, duplicate } = await createSession(appId, environment, idempotencyKey, {
        amount: BigInt(b.amount),
        feeAmount: BigInt(b.fee_amount ?? 0),
        currency: b.currency ?? 'XAF',
        reference: b.reference,
        description: b.description,
        payeeExternalId: String(b.payee),
        escrow: b.escrow !== false,
        methods: (Array.isArray(b.methods) ? b.methods : ['mobile_money']) as CheckoutMethod[],
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

const payeeView = (w: any) => ({
  external_id: w.metadata?.external_id ?? String(w.account_id).replace(/^payee:/, ''),
  display_name: w.metadata?.display_name ?? null,
  wallet_id: w.id,
  currency: w.currency,
  available_balance: String(w.available_balance),
  locked_balance: String(w.locked_balance),
  status: w.status,
});
