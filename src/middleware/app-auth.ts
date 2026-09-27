import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { Environment } from '../types/index.js';
import { checkRateLimit } from './quota-enforcer.js';
import { MAINAPP_KEY_PREFIX, isReservedAppId, verifyMainappKey } from '../security/app-identity.js';

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

export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Valide l'authentification de toute requête :
 * Supporte :
 * 1. Authorization: Bearer <token> (Master Key ou API Key)
 * 2. X-Master-Key: <key>
 * 3. X-App-Id + X-Api-Key
 */
export async function requireAppAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers['authorization'];
  let bearerToken = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    bearerToken = authHeader.substring(7).trim();
  }

  const masterKey = (request.headers['x-master-key'] as string) || (bearerToken === config.masterAdminKey ? bearerToken : '');

  // 1. Accès Super-Admin (Master Key)
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

  // 2. MAINAPP : uniquement avec sa clé sec_main_…, vérifiée contre l'empreinte scrypt de
  //    l'environnement (MAINAPP_KEY_HASH). Aucune clé en base ne peut ouvrir mainapp.
  const presentedKey = bearerToken || (request.headers['x-api-key'] as string) || '';
  if (presentedKey.startsWith(MAINAPP_KEY_PREFIX)) {
    const verdict = verifyMainappKey(presentedKey);
    if (verdict === 'throttled') {
      return reply.status(429).send({ error: 'Too Many Requests', message: 'Too many failed attempts. Retry in a minute.' });
    }
    if (verdict !== 'ok') {
      return reply.status(403).send({ error: 'Forbidden', message: 'Invalid application credentials or application disabled' });
    }
    request.appData = {
      id: 'mainapp',
      name: 'LightPay MainApp',
      environment: request.headers['x-environment'] === 'sandbox' ? 'sandbox' : 'production',
      webhookSecret: '',
    };
    const idempotencyKey = request.headers['idempotency-key'] as string;
    if (idempotencyKey) request.idempotencyKey = idempotencyKey;
    return;
  }

  // 3. Accès Application via Bearer API Key directe (jamais une identité réservée)
  if (bearerToken) {
    const keyHash = crypto.createHash('sha256').update(bearerToken).digest('hex');
    const apps = await query(
      'SELECT id, name, api_key_hash, test_api_key_hash, webhook_url, webhook_secret, is_active, max_amount_per_tx, daily_volume_limit, rate_limit_rpm FROM apps WHERE (api_key_hash = $1 OR test_api_key_hash = $1) AND is_active = TRUE',
      [keyHash]
    );

    if (apps.length > 0 && !isReservedAppId(apps[0].id)) {
      const app = apps[0];
      const isTest = timingSafeCompare(app.test_api_key_hash || '', keyHash);
      const rpmLimit = app.rate_limit_rpm || 60;
      const rateCheck = checkRateLimit(app.id, rpmLimit);
      if (!rateCheck.allowed) {
        return reply.status(429).send({
          error: 'Too Many Requests',
          message: `Rate limit exceeded: maximum ${rpmLimit} requests per minute for this application.`,
          retry_after_seconds: rateCheck.retryAfter,
        });
      }

      request.appData = {
        id: app.id,
        name: app.name,
        environment: isTest ? 'sandbox' : 'production',
        webhookUrl: app.webhook_url,
        webhookSecret: app.webhook_secret,
        maxAmountPerTx: BigInt(app.max_amount_per_tx || 250000),
        dailyVolumeLimit: BigInt(app.daily_volume_limit || 2000000),
        rateLimitRpm: rpmLimit,
      };

      const idempotencyKey = request.headers['idempotency-key'] as string;
      if (idempotencyKey) request.idempotencyKey = idempotencyKey;
      return;
    }
  }

  // 4. Accès Application via X-App-Id + X-Api-Key (jamais une identité réservée)
  const appId = request.headers['x-app-id'] as string;
  const apiKey = request.headers['x-api-key'] as string;

  if (appId && apiKey) {
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
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

    if (apps.length === 0 || isReservedAppId(apps[0].id) || !apps[0].is_active || (!isLiveMatch && !isTestMatch)) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Invalid application credentials or application disabled',
      });
    }

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

    const idempotencyKey = request.headers['idempotency-key'] as string;
    if (idempotencyKey) request.idempotencyKey = idempotencyKey;
    return;
  }

  // Refus systématique si aucun identifiant valide n'est fourni
  return reply.status(401).send({
    error: 'Access Denied',
    message: 'Valid Bearer token (Authorization: Bearer <key>) or X-Master-Key required',
  });
}

export async function requireIdempotency(request: FastifyRequest, reply: FastifyReply) {
  if (!request.idempotencyKey) {
    return reply.status(400).send({
      error: 'Bad Request',
      message: 'Missing required header: Idempotency-Key',
    });
  }
}
