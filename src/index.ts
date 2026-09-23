import Fastify from 'fastify';
import { config } from './config/index.js';
import { walletRoutes } from './routes/wallets.js';
import { paymentRoutes } from './routes/payments.js';
import { externalMoneyRoutes } from './routes/external.js';
import { adminRoutes } from './routes/admin.js';
import { gatewayRoutes } from './routes/gateways.js';
import { sdkDistributionRoutes } from './routes/sdk.js';
import { merchantRoutes } from './routes/merchant.js';
import { faucetRoutes } from './routes/faucet.js';
import { pool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { timingSafeCompare } from './middleware/app-auth.js';
import crypto from 'crypto';
import { query } from './db/pool.js';

const server = Fastify({
  logger: {
    level: config.isProduction ? 'info' : 'debug',
  },
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
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
});

// 4. ⛔ VERROU GLOBAL D'AUTHENTIFICATION (AUCUNE ENTRÉE SANS BEARER OU CLÉ OFFICIELLE)
server.addHook('onRequest', async (request, reply) => {
  const url = request.url.split('?')[0];

  // Exceptions publiques strictes :
  // - /health pour le monitoring du container
  // - /v1/gateways/webhook/* pour les notifications certifiées des agrégateurs externes
  // - /v1/sdk/* pour la distribution du SDK client
  // - /v1/merchant/apps/register pour l'onboarding autonome d'application grossiste
  if (
    url === '/health' ||
    url.startsWith('/v1/gateways/webhook') ||
    url.startsWith('/v1/sdk') ||
    url === '/v1/merchant/apps/register'
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
server.register(externalMoneyRoutes, { prefix: '/v1' });
server.register(adminRoutes, { prefix: '/v1/admin' });
server.register(gatewayRoutes, { prefix: '/v1/gateways' });
server.register(sdkDistributionRoutes, { prefix: '/v1/sdk' });
server.register(merchantRoutes, { prefix: '/v1/merchant' });
server.register(faucetRoutes);

async function start() {
  try {
    console.log('[STARTUP] Initializing LightPay Headless Core Engine...');
    await runMigrations();

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
