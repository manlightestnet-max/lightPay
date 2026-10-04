import crypto from 'crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Abuse limits, in memory (one Render instance). Fixed windows per key:
 *
 *   every request         600 / min per client IP          (floods)
 *   with a Bearer token  1200 / min per token               (an app's own server, one IP for all)
 *   money and push        15 / min per client IP           deposits, transfers, withdrawals,
 *                                                           checkout payments, Connect approval,
 *                                                           admin money moves
 *   push to a phone        5 / 10 min per number            no one can flood a number with prompts
 *                          6 / 10 min per checkout session
 *
 * Health checks and provider webhooks are not limited (the provider retries; its signature is
 * checked). Over the limit: 429 with Retry-After. This is the application's own guard: a
 * volumetric DDoS is stopped upstream (Cloudflare in front of the API), not here.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const MAX_KEYS = 100_000;

/** true when `key` is still within `limit` hits per `ms`. */
function hit(key: string, limit: number, ms: number, now = Date.now()) {
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    if (windows.size >= MAX_KEYS) windows.clear(); // never let the table itself become the attack
    w = { count: 0, resetAt: now + ms };
    windows.set(key, w);
  }
  w.count++;
  return { ok: w.count <= limit, retryAfter: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
}, 60_000).unref();

/** The visitor's address: Cloudflare's header when present, else the last proxy hop (Render's). */
export function clientIp(request: FastifyRequest) {
  const cf = request.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.length <= 64) return cf.trim();
  const xff = request.headers['x-forwarded-for'];
  const hops = (Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return hops[hops.length - 1] ?? request.ip;
}

const SENSITIVE = [
  /^\/v1\/me\/(deposits|transfers|withdrawals)$/,
  /^\/v1\/me\/connect\/approve$/,
  /^\/v1\/checkout\/public\/sessions\/[^/]+\/(mobile-money|wallet)$/,
  /^\/v1\/admin-console\/(main\/send|main\/recharge|faucet\/issue)$/,
  /^\/v1\/admin-console\/fees$/,
];
const EXEMPT = (url: string) => url === '/health' || url.startsWith('/v1/providers/');

function tooMany(reply: FastifyReply, retryAfter: number) {
  return reply
    .status(429)
    .header('Retry-After', String(retryAfter))
    .send({ error: 'RATE_LIMITED', message: 'Trop de demandes. Patientez un instant puis réessayez.' });
}

export function registerRateLimits(server: FastifyInstance) {
  // Local test suites send bursts from one address; production always keeps the limits.
  if (process.env.RATE_LIMITS === 'off' && process.env.NODE_ENV !== 'production') return;
  // Before anything is parsed or looked up: the cheapest place to refuse.
  server.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') return;
    const url = request.url.split('?')[0];
    if (EXEMPT(url)) return;
    const ip = clientIp(request);

    let r = hit(`ip:${ip}`, 600, 60_000);
    if (!r.ok) return tooMany(reply, r.retryAfter);

    const auth = request.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const id = crypto.createHash('sha256').update(auth.slice(7)).digest('hex').slice(0, 24);
      r = hit(`tok:${id}`, 1200, 60_000);
      if (!r.ok) return tooMany(reply, r.retryAfter);
    }

    if (request.method !== 'GET' && SENSITIVE.some((re) => re.test(url))) {
      r = hit(`money:${ip}`, 15, 60_000);
      if (!r.ok) return tooMany(reply, r.retryAfter);
    }
  });

  // Once the body is read: a phone number or a checkout session cannot be pushed over and over.
  server.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'POST') return;
    const m = request.url.split('?')[0].match(/^\/v1\/checkout\/public\/sessions\/([^/]+)\/mobile-money$/);
    if (!m) return;
    let r = hit(`push-session:${m[1]}`, 6, 10 * 60_000);
    if (!r.ok) return tooMany(reply, r.retryAfter);
    const digits = String((request.body as any)?.msisdn ?? '').replace(/\D/g, '').slice(-9);
    if (digits.length === 9) {
      r = hit(`push-msisdn:${digits}`, 5, 10 * 60_000);
      if (!r.ok) return tooMany(reply, r.retryAfter);
    }
  });
}

/** Test hook: forget every counter. */
export const resetRateLimits = () => windows.clear();
