import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { CheckoutError, payWithWallet, publicView, startMobileMoney } from '../db/checkout.js';
import { ConnectError, validateAuthorizeRequest } from '../db/connect.js';
import { EscrowError } from '../db/escrow.js';
import { requireUser } from './me.js';
import { accountPage, connectPage, hostedCsp, payPage } from '../pages/hosted.js';

/** Per-IP brake on payment requests (each one rings a phone). */
const hits = new Map<string, number[]>();
const allow = (ip: string, max = 10, windowMs = 60_000) => {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) return false;
  recent.push(now);
  hits.set(ip, recent);
  return true;
};

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9_-]{16,40}$/;

/**
 * Public side of the checkout. The session id is an unguessable capability; nothing here
 * exposes wallet ids, balances or full phone numbers.
 *   GET  /pay/:id | /account | /connect               hosted pages
 *   GET  /v1/checkout/public/authorize                validate an app authorization request
 *   POST /v1/checkout/public/sessions/:id/wallet      pay with a LightPay wallet (signed in)
 *   GET  /v1/checkout/public/sessions/:id             what the page shows (polled)
 *   POST /v1/checkout/public/sessions/:id/mobile-money   { msisdn, network }
 */
export async function checkoutPublicRoutes(fastify: FastifyInstance) {
  fastify.get('/v1/checkout/public/sessions/:id', async (request, reply) => {
    const { id } = request.params as any;
    if (!SESSION_ID.test(id)) return reply.status(404).send({ error: 'Session not found' });
    const view = await publicView(id);
    if (!view) return reply.status(404).send({ error: 'Session not found' });
    reply.header('Cache-Control', 'no-store');
    return { status: 'success', session: view };
  });

  fastify.post('/v1/checkout/public/sessions/:id/mobile-money', async (request, reply) => {
    const { id } = request.params as any;
    if (!SESSION_ID.test(id)) return reply.status(404).send({ error: 'Session not found' });
    if (!allow(request.ip)) return reply.status(429).send({ error: 'TOO_MANY_REQUESTS', message: 'Trop de tentatives, réessayez dans une minute.' });
    const { msisdn, network } = (request.body ?? {}) as any;
    try {
      return { status: 'success', attempt: await startMobileMoney(id, String(msisdn ?? ''), String(network ?? '')) };
    } catch (err: any) {
      return reply.status(err instanceof CheckoutError ? err.statusCode : 400).send({ status: 'error', error: err.code || 'CHECKOUT_ERROR', message: err.message });
    }
  });

  // Is this authorization request valid? (consent page, before sign-in)
  fastify.get('/v1/checkout/public/authorize', async (request, reply) => {
    const q = request.query as any;
    const environment = q.environment === 'sandbox' ? 'sandbox' : 'production';
    try {
      return await validateAuthorizeRequest(environment, {
        appId: String(q.app_id ?? ''),
        scopes: String(q.scope ?? '').split(/[\s,]+/).filter(Boolean),
        redirectUri: String(q.redirect_uri ?? ''),
        codeChallenge: String(q.code_challenge ?? ''),
      });
    } catch (err: any) {
      return reply.status(err instanceof ConnectError ? err.statusCode : 400).send({ error: err.code || 'INVALID_REQUEST', message: err.message });
    }
  });

  // Signed-in LightPay user pays from their wallet.
  fastify.post('/v1/checkout/public/sessions/:id/wallet', { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as any;
    if (!SESSION_ID.test(id)) return reply.status(404).send({ error: 'Session not found' });
    if (!allow(request.ip)) return reply.status(429).send({ error: 'TOO_MANY_REQUESTS', message: 'Trop de tentatives, réessayez dans une minute.' });
    try {
      return { status: 'success', session: await payWithWallet(id, request.lightpayUser!) };
    } catch (err: any) {
      const known = err instanceof CheckoutError || err instanceof EscrowError;
      return reply.status(known ? err.statusCode : 400).send({ status: 'error', error: err.code || 'CHECKOUT_ERROR', message: err.message });
    }
  });

  const html = (reply: any, render: (nonce: string) => string) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .header('Content-Security-Policy', hostedCsp(nonce));
    return render(nonce);
  };

  fastify.get('/pay/:id', async (request, reply) => {
    const { id } = request.params as any;
    const valid = SESSION_ID.test(id);
    return html(reply, (nonce) => payPage(nonce, valid ? id : '', valid && id.startsWith('cs_test_') ? 'sandbox' : 'production'));
  });

  fastify.get('/account', async (request, reply) =>
    html(reply, (nonce) => accountPage(nonce, (request.query as any).env === 'sandbox' ? 'sandbox' : 'production'))
  );

  fastify.get('/connect', async (request, reply) =>
    html(reply, (nonce) => connectPage(nonce, (request.query as any).environment === 'sandbox' ? 'sandbox' : 'production'))
  );
}
