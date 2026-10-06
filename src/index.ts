import Fastify from 'fastify';
import { config } from './config/index.js';
import { walletRoutes } from './routes/wallets.js';
import { paymentRoutes } from './routes/payments.js';
import { holdRoutes } from './routes/holds.js';
import { checkoutRoutes } from './routes/checkout.js';
import { checkoutPublicRoutes } from './routes/checkout-public.js';
import { meRoutes } from './routes/me.js';
import { developerRoutes } from './routes/developer.js';
import { providerRoutes } from './routes/providers.js';
import { sweepPendingCollections } from './db/checkout.js';
import { pendingPayouts, resolvePayout } from './db/payouts.js';
import { MAINAPP_KEY_PREFIX, verifyMainappKey } from './security/app-identity.js';
import { externalMoneyRoutes } from './routes/external.js';
import { adminRoutes } from './routes/admin.js';
import { sdkDistributionRoutes } from './routes/sdk.js';
import { merchantRoutes } from './routes/merchant.js';
import { faucetRoutes } from './routes/faucet.js';
import { adminConsoleRoutes, adminHost } from './routes/admin-console.js';
import { pool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { refreshFeeSettings } from './payments/fee-settings.js';
import { refreshProviderSettings } from './payments/provider-settings.js';
import { timingSafeCompare } from './middleware/app-auth.js';
import { registerRateLimits } from './security/rate-limit.js';
import crypto from 'crypto';
import { query } from './db/pool.js';

const server = Fastify({
  logger: {
    level: config.isProduction ? 'info' : 'debug',
  },
  // Abuse guards: small bodies (no endpoint takes files), and a slow client cannot hold a
  // connection open forever while sending its request (live streams are responses, not requests).
  bodyLimit: 256 * 1024,
  requestTimeout: 30_000,
  connectionTimeout: 60_000,
});

registerRateLimits(server);

// Never show the inside of the server: an unexpected error answers a generic message (the
// details stay in the logs), and a database or network message never reaches a response.
const INTERNAL = /violates|syntax error|invalid input syntax|relation "|column "|duplicate key|null value in column|out of range|deadlock|could not serialize|current transaction is aborted|ECONN|ETIMEDOUT|EAI_AGAIN|getaddrinfo|terminating connection|Connection terminated|password authentication|SSL|at [\w.<>]+ \(/i;
const GENERIC = 'Une erreur est survenue. Réessayez dans un instant.';
server.setErrorHandler((err: any, request, reply) => {
  const status = typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
  if (status >= 500) request.log.error({ err }, 'unhandled error');
  const message = status >= 500 || INTERNAL.test(String(err?.message ?? '')) ? GENERIC : String(err?.message ?? GENERIC);
  return reply.status(status).send({ status: 'error', error: status >= 500 ? 'INTERNAL_ERROR' : err?.code || 'REQUEST_ERROR', message });
});
server.addHook('onSend', async (request, reply, payload) => {
  if (reply.statusCode < 400 || typeof payload !== 'string' || !INTERNAL.test(payload)) return payload;
  try {
    const body = JSON.parse(payload);
    for (const k of ['message', 'details', 'error']) {
      if (typeof body?.[k] === 'string' && INTERNAL.test(body[k])) {
        request.log.warn({ field: k, value: body[k] }, 'internal message hidden from response');
        body[k] = k === 'error' ? 'REQUEST_ERROR' : GENERIC;
      }
    }
    return JSON.stringify(body);
  } catch {
    return payload;
  }
});

// Support des requêtes JSON avec corps vide sans erreur 400 (FST_ERR_CTP_EMPTY_JSON_BODY)
server.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  // Raw body kept for signature checks on provider webhooks.
  (req as any).rawBody = body;
  if (!body || (typeof body === 'string' && body.trim() === '')) {
    done(null, {});
    return;
  }
  try {
    done(null, JSON.parse(body as string));
  } catch {
    const err: any = new Error('Corps de requête JSON invalide.');
    err.statusCode = 400;
    err.code = 'INVALID_JSON';
    done(err, undefined);
  }
});
server.addContentTypeParser(['application/x-www-form-urlencoded', 'text/html', 'text/plain'], { parseAs: 'buffer' }, (req, body, done) => {
  done(null, body);
});

// 1. Healthcheck probe (Indispensable pour Render / Cloudflare / Uptime)
server.get('/health', async () => {
  return {
    status: 'healthy',
    service: 'LightPay Core Engine',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };
});

// 2. En-têtes CORS & Prévol pour les applications clientes
server.addHook('onRequest', async (request, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-App-Id, X-Api-Key, X-Environment, X-Master-Key, Idempotency-Key, *');
  if (request.method === 'OPTIONS') {
    return reply.status(204).send();
  }
});

// 3. En-têtes de sécurité HTTP standards
server.addHook('onSend', async (request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  // The payment dialog (lightpay.js) is framed only by the app's declared sites, set by its CSP.
  if (!(request as any).framingAllowed) reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
});

// 3'. Domaine de paiement (CHECKOUT_BASE_URL, ex. checkout.smlab.xyz) : il ne sert QUE la
//     page de paiement et son API publique. Tout le reste y répond 404.
const checkoutHost = (() => {
  try {
    return process.env.CHECKOUT_BASE_URL ? new URL(process.env.CHECKOUT_BASE_URL).host.toLowerCase() : null;
  } catch {
    return null;
  }
})();

server.addHook('onRequest', async (request, reply) => {
  if (!checkoutHost || String(request.headers.host ?? '').toLowerCase() !== checkoutHost) return;
  const url = request.url.split('?')[0];
  if (
    url === '/health' ||
    url.startsWith('/pay/') ||
    url === '/lightpay.js' ||
    url.startsWith('/v1/checkout/public/') ||
    url === '/account' ||
    url === '/account/console' ||
    url === '/connect' ||
    url === '/v1/me' ||
    url.startsWith('/v1/me/') ||
    url.startsWith('/__/auth/') ||
    url.startsWith('/__/firebase/') ||
    request.method === 'OPTIONS'
  ) return;
  return reply.status(404).send({ error: 'Not Found' });
});

// 3''. Console d'administration (ADMIN_BASE_URL, ex. admin.smlab.xyz) : ce domaine ne sert QUE la
//      console et son API ; ailleurs, la console n'existe pas. Sans ADMIN_BASE_URL : /admin sur l'API.
const isAdminPath = (url: string) => url === '/admin' || url.startsWith('/v1/admin-console/');
server.addHook('onRequest', async (request, reply) => {
  if (!adminHost) return;
  const url = request.url.split('?')[0];
  const onAdminHost = String(request.headers.host ?? '').toLowerCase() === adminHost;
  if (!onAdminHost) {
    if (isAdminPath(url)) return reply.status(404).send({ error: 'Not Found' });
    return;
  }
  if (url === '/') return reply.redirect('/admin');
  if (url === '/health' || isAdminPath(url) || url.startsWith('/__/auth/') || url.startsWith('/__/firebase/') || request.method === 'OPTIONS') return;
  return reply.status(404).send({ error: 'Not Found' });
});

// 4. ⛔ VERROU GLOBAL D'AUTHENTIFICATION (AUCUNE ENTRÉE SANS BEARER OU CLÉ OFFICIELLE)
server.addHook('onRequest', async (request, reply) => {
  const url = request.url.split('?')[0];

  // Exceptions publiques strictes :
  // - /health pour le monitoring du container
  // - /v1/sdk/* pour la distribution du SDK client
  // - /v1/merchant/apps/register pour l'onboarding autonome d'application grossiste
  if (
    url === '/health' ||
    // Provider notifications (verified in the route: signature, or status re-read from the provider).
    url.startsWith('/v1/providers/') ||
    url.startsWith('/v1/sdk') ||
    url === '/v1/merchant/apps/register' ||
    // Hosted payment page and its public API: the session id (unguessable) is the capability.
    url.startsWith('/pay/') ||
    url === '/lightpay.js' ||
    url.startsWith('/v1/checkout/public/') ||
    // LightPay user space: authenticated by the person's own token (checked in its routes).
    url === '/account' ||
    url === '/account/console' ||
    url === '/connect' ||
    url === '/v1/me' ||
    url.startsWith('/v1/me/') ||
    // Firebase Auth redirect helper routes (same origin proxying to firebaseapp.com)
    url.startsWith('/__/auth/') ||
    url.startsWith('/__/firebase/') ||
    // Owner's admin console: LightPay sign-in + ADMIN_UIDS, checked in its routes.
    isAdminPath(url)
  ) {
    return;
  }

  const authHeader = request.headers['authorization'];
  let bearerToken = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    bearerToken = authHeader.substring(7).trim();
  }

  const masterKey = (request.headers['x-master-key'] as string) || (bearerToken === config.masterAdminKey ? bearerToken : '');

  // A. Vérification Master Key
  if (masterKey && timingSafeCompare(masterKey, config.masterAdminKey)) {
    return;
  }

  // A'. MainApp : clé sec_main_ vérifiée contre l'empreinte scrypt de l'environnement
  const presentedKey = bearerToken || (request.headers['x-api-key'] as string) || '';
  if (presentedKey.startsWith(MAINAPP_KEY_PREFIX)) {
    if (verifyMainappKey(presentedKey) === 'ok') return;
    return reply.status(403).send({ error: 'Forbidden', message: 'Invalid application credentials' });
  }

  // B. Vérification Bearer Token (API Key application)
  if (bearerToken) {
    const keyHash = crypto.createHash('sha256').update(bearerToken).digest('hex');
    const apps = await query(
      'SELECT id FROM apps WHERE (api_key_hash = $1 OR test_api_key_hash = $1) AND is_active = TRUE',
      [keyHash]
    );
    if (apps.length > 0) {
      return;
    }
  }

  // C. Vérification Headers X-App-Id + X-Api-Key
  const appId = request.headers['x-app-id'] as string;
  const apiKey = request.headers['x-api-key'] as string;
  if (appId && apiKey) {
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const apps = await query(
      'SELECT id, api_key_hash, test_api_key_hash, is_active FROM apps WHERE id = $1',
      [appId]
    );
    if (apps.length > 0 && apps[0].is_active) {
      const isLiveMatch = timingSafeCompare(apps[0].api_key_hash || '', keyHash);
      const isTestMatch = timingSafeCompare(apps[0].test_api_key_hash || '', keyHash);
      if (isLiveMatch || isTestMatch) {
        return;
      }
    }
  }

  // ⛔ REFUS SYSTÉMATIQUE — AUCUN ACCÈS EN CLAIR
  return reply.status(401).send({
    error: 'Access Denied',
    message: 'Authentication required. Provide a valid Bearer token (Authorization: Bearer <key>) or API credentials.',
  });
});

// 5. Racine '/' sécurisée (Accessible UNIQUEMENT avec authentification)
server.get('/', async (request, reply) => {
  return {
    service: 'LightPay Core Engine',
    status: 'operational',
    version: '1.0.0',
    mode: 'headless_api_only',
    authenticated: true,
  };
});

// 6. Enregistrement des modules API Core Engine (100% JSON)
server.register(walletRoutes, { prefix: '/v1/wallets' });
server.register(paymentRoutes, { prefix: '/v1/payments' });
server.register(holdRoutes, { prefix: '/v1/holds' });
server.register(checkoutRoutes, { prefix: '/v1' });
server.register(checkoutPublicRoutes);
server.register(meRoutes, { prefix: '/v1/me' });
server.register(developerRoutes, { prefix: '/v1/me/developer' });
server.register(providerRoutes, { prefix: '/v1/providers' });

// Sweeper: pending collections and payouts are re-checked with their provider every minute
// (lost webhooks, restarts). Each operation is idempotent, so overlaps are harmless.
const sweep = async () => {
  try {
    await sweepPendingCollections();
    for (const env of ['production', 'sandbox'] as const) {
      for (const payout of await pendingPayouts(env)) await resolvePayout(payout).catch((err) => console.error('[SWEEP] payout', payout.id, err?.message));
    }
  } catch (err: any) {
    console.error('[SWEEP] failed', err?.message);
  }
};
setInterval(() => void sweep(), 60_000).unref();
server.register(externalMoneyRoutes, { prefix: '/v1' });
server.register(adminRoutes, { prefix: '/v1/admin' });
server.register(sdkDistributionRoutes, { prefix: '/v1/sdk' });
server.register(merchantRoutes, { prefix: '/v1/merchant' });
server.register(faucetRoutes);
server.register(adminConsoleRoutes);

// Relais transparent Firebase Auth (permet signInWithRedirect sur notre propre domaine)
const FIREBASE_AUTH_DOMAIN = process.env.LIGHTPAY_FIREBASE_AUTH_DOMAIN || 'lightpay-a5f01.firebaseapp.com';
const proxyFirebaseAuth = async (request: any, reply: any) => {
  const targetUrl = `https://${FIREBASE_AUTH_DOMAIN}${request.raw.url}`;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(request.headers)) {
    const lk = k.toLowerCase();
    if (lk === 'host') {
      headers['host'] = FIREBASE_AUTH_DOMAIN;
    } else if (lk !== 'content-length' && typeof v === 'string') {
      headers[k] = v;
    }
  }
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : request.body;
  try {
    const res = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: body ? (Buffer.isBuffer(body) ? new Uint8Array(body) : typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      redirect: 'manual',
    });
    reply.status(res.status);
    for (const [hk, hv] of res.headers.entries()) {
      const lk = hk.toLowerCase();
      if (lk !== 'content-encoding' && lk !== 'content-length') {
        reply.header(hk, hv);
      }
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return reply.send(buf);
  } catch (err: any) {
    server.log.error({ err, url: request.raw.url }, 'Échec du relais Firebase Auth');
    return reply.status(502).send('Bad Gateway');
  }
};

server.all('/__/auth/*', proxyFirebaseAuth);
server.all('/__/firebase/*', proxyFirebaseAuth);

async function start() {
  try {
    console.log('[STARTUP] Initializing LightPay Headless Core Engine...');
    await runMigrations();
    // Fees and minimums come from the admin's settings; re-read every minute.
    await refreshFeeSettings();
    await refreshProviderSettings();
    setInterval(() => { void refreshFeeSettings(); void refreshProviderSettings(); }, 60_000).unref();

    await server.listen({
      port: config.port,
      host: config.host,
    });

    console.log(`[READY] LightPay Engine listening on http://${config.host}:${config.port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) => {
  process.on(signal, async () => {
    console.log(`[SHUTDOWN] Signal ${signal} received. Closing gracefully...`);
    await server.close();
    await pool.end();
    process.exit(0);
  });
});

start();
