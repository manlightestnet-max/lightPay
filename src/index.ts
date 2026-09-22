import Fastify from 'fastify';
import { config } from './config/index.js';
import { walletRoutes } from './routes/wallets.js';
import { paymentRoutes } from './routes/payments.js';
import { externalMoneyRoutes } from './routes/external.js';
import { adminRoutes } from './routes/admin.js';
import { pool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';

const server = Fastify({
  logger: {
    level: config.isProduction ? 'info' : 'debug',
  },
});

// Healthcheck pour Fly.io et monitoring
server.get('/health', async () => {
  return {
    status: 'healthy',
    service: 'LightWallet Core Engine',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };
});

// En-têtes CORS & Prévol pour permettre l'accès depuis l'Explorer Web et vos applications clientes
server.addHook('onRequest', async (request, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-App-Id, X-Api-Key, X-Master-Key, Idempotency-Key');
  if (request.method === 'OPTIONS') {
    return reply.status(204).send();
  }
});

// En-têtes de sécurité HTTP standards
server.addHook('onSend', async (request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
});

import fs from 'fs';
import path from 'path';
import { explorerApiRoutes } from './routes/explorer-api.js';
import { gatewayRoutes } from './routes/gateways.js';
import { sdkDistributionRoutes } from './routes/sdk.js';

// Enregistrement des modules API
server.register(walletRoutes, { prefix: '/v1/wallets' });
server.register(paymentRoutes, { prefix: '/v1/payments' });
server.register(externalMoneyRoutes, { prefix: '/v1' });
server.register(adminRoutes, { prefix: '/v1/admin' });
server.register(explorerApiRoutes, { prefix: '/v1/explorer' });
server.register(sdkDistributionRoutes, { prefix: '/v1/sdk' });
server.register(gatewayRoutes, { prefix: '/v1/gateways' });
server.register(miniAppRoutes, { prefix: '/v1/mini-app' });

// ==========================================================
// LIGHTWALLET MINI-APP, EXPLORER & MAINAPP TREASURY
// ==========================================================
import { getExplorerHtml } from './explorer/index.js';
import { getMiniAppHtml, miniAppRoutes } from './mini-app/index.js';

// Redirection de la racine vers l'Application
server.get('/', async (request, reply) => {
  return reply.redirect('/app');
});

// Interface utilisateur de démonstration Mini-App (Gestion Utilisateurs, Dépôts, Envois)
server.get('/app', async (request, reply) => {
  reply.type('text/html; charset=utf-8');
  return getMiniAppHtml();
});

// Interface interactive de l'Explorer Comptable (100% Read-Only)
server.get('/explorer', async (request, reply) => {
  reply.type('text/html; charset=utf-8');
  return getExplorerHtml();
});

// Interface Super-Admin Trésorerie : MainApp (100% Backed Reserve & Distribution)
server.get('/mainapp', async (request, reply) => {
  reply.type('text/html; charset=utf-8');
  const mainAppPath = path.resolve(process.cwd(), 'public/mainapp.html');
  if (fs.existsSync(mainAppPath)) {
    return fs.readFileSync(mainAppPath, 'utf8');
  }
  return '<h1>MainApp</h1><p>public/mainapp.html introuvable</p>';
});

async function start() {
  try {
    console.log('[STARTUP] Initializing LightWallet...');

    // Application du schéma PostgreSQL au démarrage
    await runMigrations();

    await server.listen({
      port: config.port,
      host: config.host,
    });

    console.log(`[READY] LightWallet Engine listening on http://${config.host}:${config.port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

// Gestion de l'arrêt propre (Graceful shutdown)
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
