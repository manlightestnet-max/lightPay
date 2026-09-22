import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { Environment } from '../types/index.js';
import { checkRateLimit } from './quota-enforcer.js';

declare module 'fastify' {
  interface FastifyRequest {
    appData?: {
      id: string;
      name: string;
      environment: Environment;
      webhookUrl?: string | null;
      webhookSecret: string;
      maxAmountPerTx?: bigint;
      dailyVolumeLimit?: bigint;
      rateLimitRpm?: number;
    };
    idempotencyKey?: string;
  }
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Uses crypto.timingSafeEqual with length padding to avoid leaking string length via timing.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Perform dummy constant-time comparison against self to equalize execution time
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Valide que la requête provient d'une application enregistrée (X-App-Id + X-Api-Key)
 * ou possède la clé d'administration maîtresse (X-Master-Key).
 * Détecte automatiquement l'environnement ('sandbox' ou 'production') selon la clé fournie.
 */
export async function requireAppAuth(request: FastifyRequest, reply: FastifyReply) {
  const appId = request.headers['x-app-id'] as string;
  const apiKey = request.headers['x-api-key'] as string;
  const masterKey = request.headers['x-master-key'] as string;

  // Accès Super-Admin avec comparaison en temps constant (protection timing attack)
  if (masterKey && timingSafeCompare(masterKey, config.masterAdminKey)) {
    const envHeader = (request.headers['x-environment'] as string) || 'production';
    request.appData = {
      id: 'system_master',
      name: 'Master Admin',
      environment: envHeader === 'sandbox' ? 'sandbox' : 'production',
      webhookSecret: 'master_secret',
    };
    return;
  }

  if (!appId || !apiKey) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Missing required headers: X-App-Id and X-Api-Key',
    });
  }

  // Calcul du hash SHA-256 de la clé passée
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  // Récupération de l'application par ID uniquement avec ses quotas
  const apps = await query(
    'SELECT id, name, api_key_hash, test_api_key_hash, webhook_url, webhook_secret, is_active, max_amount_per_tx, daily_volume_limit, rate_limit_rpm FROM apps WHERE id = $1',
    [appId]
  );

  const dummyHash = '0000000000000000000000000000000000000000000000000000000000000000';
  const app = apps[0];
  const liveHash = app?.api_key_hash || dummyHash;
  const testHash = app?.test_api_key_hash || dummyHash;

  const isLiveMatch = timingSafeCompare(liveHash, keyHash);
  const isTestMatch = timingSafeCompare(testHash, keyHash);

  if (apps.length === 0 || !apps[0].is_active || (!isLiveMatch && !isTestMatch)) {
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'Invalid application credentials or application disabled',
    });
  }

  // Rate Limiting anti-abus strict par application (requêtes par minute)
  const rpmLimit = app.rate_limit_rpm || 60;
  const rateCheck = checkRateLimit(app.id, rpmLimit);
  if (!rateCheck.allowed) {
    return reply.status(429).send({
      error: 'Too Many Requests',
      message: `Rate limit exceeded: maximum ${rpmLimit} requests per minute for this application.`,
      retry_after_seconds: rateCheck.retryAfter,
    });
  }

  const environment: Environment = isTestMatch ? 'sandbox' : 'production';

  request.appData = {
    id: apps[0].id,
    name: apps[0].name,
    environment,
    webhookUrl: apps[0].webhook_url,
    webhookSecret: apps[0].webhook_secret,
    maxAmountPerTx: BigInt(apps[0].max_amount_per_tx || 250000),
    dailyVolumeLimit: BigInt(apps[0].daily_volume_limit || 2000000),
    rateLimitRpm: rpmLimit,
  };

  // Clé d'idempotence optionnelle ou obligatoire selon la méthode
  const idempotencyKey = request.headers['idempotency-key'] as string;
  if (idempotencyKey) {
    request.idempotencyKey = idempotencyKey;
  }
}

/**
 * Exige une clé d'idempotence pour les opérations d'écriture sensibles
 */
export async function requireIdempotency(request: FastifyRequest, reply: FastifyReply) {
  if (!request.idempotencyKey) {
    return reply.status(400).send({
      error: 'Bad Request',
      message: 'Missing required header: Idempotency-Key',
    });
  }
}
