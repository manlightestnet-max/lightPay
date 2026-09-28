import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { CheckoutError, payWithWallet, publicView, startMobileMoney } from '../db/checkout.js';
import { ConnectError, findUserWallet, validateAuthorizeRequest } from '../db/connect.js';
import { EscrowError } from '../db/escrow.js';
import { requireUser } from './me.js';
import { accountPage, connectPage, consolePage, hostedCsp, lightpaySdk, payPage } from '../pages/hosted.js';
import { embedOriginFor } from '../db/developer.js';

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
 *   GET  /pay/:id | /account | /account/console | /connect   hosted pages
 *        /pay/:id?embed=1&origin=…  payment dialog (framed by the app's declared sites only)
 *   GET  /lightpay.js                                 script that opens the payment dialog
 *   GET  /v1/checkout/public/authorize                validate an app authorization request
 *   POST /v1/checkout/public/sessions/:id/wallet      pay with a LightPay wallet (signed in)
 *   GET  /v1/checkout/public/sessions/:id             what the page shows (polled)
 *   POST /v1/checkout/public/sessions/:id/mobile-money   { msisdn, network }
 *   GET  /v1/checkout/public/sessions/:id/payer          signed in: has a LightPay wallet? (never opens one)
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

  // Does this signed-in person already have a LightPay wallet? (never opens one)
  fastify.get('/v1/checkout/public/sessions/:id/payer', { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as any;
    if (!SESSION_ID.test(id)) return reply.status(404).send({ error: 'Session not found' });
    const w = await findUserWallet(id.startsWith('cs_test_') ? 'sandbox' : 'production', request.lightpayUser!);
    reply.header('Cache-Control', 'no-store');
    return { status: 'success', has_wallet: Boolean(w && w.status === 'ACTIVE') };
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

  const html = (reply: any, render: (nonce: string) => string, frameAncestors?: string) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .header('Content-Security-Policy', hostedCsp(nonce, frameAncestors));
    return render(nonce);
  };

  fastify.get('/pay/:id', async (request, reply) => {
    const { id } = request.params as any;
    const q = request.query as any;
    const valid = SESSION_ID.test(id);
    const env = valid && id.startsWith('cs_test_') ? 'sandbox' : 'production';
    // Dialog: only for a site the app declared; anywhere else the page refuses to be framed.
    const embedOrigin = valid && q.embed === '1' && typeof q.origin === 'string' ? await embedOriginFor(id, q.origin) : null;
    if (embedOrigin) (request as any).framingAllowed = true;
    return html(
      reply,
      (nonce) => payPage(nonce, valid ? id : '', env, { embedOrigin }),
      embedOrigin ?? undefined
    );
  });

  fastify.get('/lightpay.js', async (request, reply) => {
    const origin = (
      process.env.CHECKOUT_BASE_URL ||
      process.env.PUBLIC_BASE_URL ||
      `${request.headers['x-forwarded-proto'] || request.protocol}://${request.headers.host}`
    ).replace(/\/$/, '');
    reply
      .header('Content-Type', 'text/javascript; charset=utf-8')
      .header('Cache-Control', 'public, max-age=300')
      .header('Cross-Origin-Resource-Policy', 'cross-origin');
    return lightpaySdk(new URL(origin).origin);
  });

  fastify.get('/account', async (request, reply) =>
    html(reply, (nonce) => accountPage(nonce, (request.query as any).env === 'sandbox' ? 'sandbox' : 'production'))
  );

  // Advanced mode: console with the developer space (opt-in from the simple account).
  fastify.get('/account/console', async (request, reply) =>
    html(reply, (nonce) => consolePage(nonce, (request.query as any).env === 'sandbox' ? 'sandbox' : 'production'))
  );

  fastify.get('/connect', async (request, reply) =>
    html(reply, (nonce) => connectPage(nonce, (request.query as any).environment === 'sandbox' ? 'sandbox' : 'production'))
  );
}
