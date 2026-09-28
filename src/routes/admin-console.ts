import crypto from 'crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireUser } from './me.js';
import { isRecentSignIn } from '../security/user-token.js';
import { adminPage, hostedCsp } from '../pages/hosted.js';
import {
  AdminError,
  AdminUser,
  Period,
  getApp,
  getTransaction,
  getUser,
  issueFaucet,
  listApps,
  listAudit,
  listTransactions,
  listUsers,
  mainOverview,
  overview,
  rechargeMain,
  reserves,
  sendFromMain,
} from '../db/admin-console.js';
import { Environment } from '../types/index.js';

/**
 * Owner's admin console.
 *   GET  /admin                                 the console page (on ADMIN_BASE_URL's host when set)
 *   GET  /v1/admin-console/me                   am I an admin?
 *   GET  /v1/admin-console/overview?period=     revenue, volume, counts, 30-day series, ledger check
 *   GET  /v1/admin-console/reserves             per-provider reserves + client money coverage
 *   GET  /v1/admin-console/users[?q=&offset=]   LightPay users · /users/:walletId
 *   GET  /v1/admin-console/apps                 apps · /apps/:id (attached users)
 *   GET  /v1/admin-console/transactions[?type=&app=&q=&before=] · /transactions/:id (ledger entries)
 *   GET  /v1/admin-console/main                 wallet main + its movements
 *   POST /v1/admin-console/main/send            { to, amount, note }   recent sign-in + Idempotency-Key
 *   POST /v1/admin-console/main/recharge        { amount }             production: real deposit page
 *   POST /v1/admin-console/faucet/issue         { amount }             test only: issue test money into the faucet
 *   GET  /v1/admin-console/audit                admin actions log
 * Access: a LightPay sign-in whose uid is listed in ADMIN_UIDS. X-Environment picks the ledger.
 * There is no withdrawal route here, on purpose.
 */

const adminUids = () =>
  new Set(
    String(process.env.ADMIN_UIDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );

export const adminHost = (() => {
  try {
    return process.env.ADMIN_BASE_URL ? new URL(process.env.ADMIN_BASE_URL).host.toLowerCase() : null;
  } catch {
    return null;
  }
})();

const envOf = (request: FastifyRequest): Environment => (request.headers['x-environment'] === 'sandbox' ? 'sandbox' : 'production');
const adminOf = (request: FastifyRequest): AdminUser => ({ uid: request.lightpayUser!.uid, email: request.lightpayUser!.email });

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireUser(request, reply);
  if (reply.sent) return;
  if (!adminUids().has(request.lightpayUser!.uid)) {
    return reply.status(403).send({ error: 'NOT_ADMIN', message: 'Ce compte n’a pas accès à l’administration.' });
  }
}

const fail = (reply: FastifyReply, err: any) => {
  if (err instanceof AdminError) return reply.status(err.statusCode).send({ status: 'error', error: err.code, message: err.message });
  throw err;
};

const idem = (request: FastifyRequest, reply: FastifyReply) => {
  const key = String(request.headers['idempotency-key'] ?? '');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) {
    reply.status(400).send({ error: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Missing Idempotency-Key header' });
    return null;
  }
  return key;
};

const recent = (request: FastifyRequest, reply: FastifyReply) => {
  if (isRecentSignIn(request.lightpayUser!)) return true;
  reply.status(401).send({ error: 'RECENT_SIGN_IN_REQUIRED', message: 'Pour votre sécurité, confirmez votre mot de passe.' });
  return false;
};

const intParam = (v: unknown, def: number, max: number) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : def;
};

export async function adminConsoleRoutes(fastify: FastifyInstance) {
  fastify.get('/admin', async (request, reply) => {
    const env = (request.query as any)?.env === 'sandbox' ? 'sandbox' : 'production';
    const nonce = crypto.randomBytes(16).toString('base64');
    reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .header('Content-Security-Policy', hostedCsp(nonce));
    return adminPage(nonce, env);
  });

  fastify.register(
    async (api) => {
      api.addHook('preHandler', requireAdmin);
      api.addHook('onSend', async (_request, reply) => {
        reply.header('Cache-Control', 'no-store');
      });

      api.get('/me', async (request) => ({ status: 'success', admin: { uid: request.lightpayUser!.uid, email: request.lightpayUser!.email } }));

      api.get('/overview', async (request) => {
        const p = String((request.query as any)?.period ?? 'month');
        const period: Period = p === 'day' || p === 'week' || p === 'all' ? p : 'month';
        return { status: 'success', overview: await overview(envOf(request), period) };
      });

      api.get('/reserves', async (request) => ({ status: 'success', reserves: await reserves(envOf(request)) }));

      api.get('/users', async (request) => {
        const q = request.query as any;
        return { status: 'success', users: await listUsers(envOf(request), String(q?.q ?? '').slice(0, 80), intParam(q?.limit, 50, 200), intParam(q?.offset, 0, 100000)) };
      });
      api.get('/users/:id', async (request, reply) => {
        try { return { status: 'success', ...(await getUser(envOf(request), String((request.params as any).id))) }; } catch (e) { return fail(reply, e); }
      });

      api.get('/apps', async (request) => ({ status: 'success', apps: await listApps(envOf(request)) }));
      api.get('/apps/:id', async (request, reply) => {
        try { return { status: 'success', ...(await getApp(envOf(request), String((request.params as any).id))) }; } catch (e) { return fail(reply, e); }
      });

      api.get('/transactions', async (request) => {
        const q = request.query as any;
        return {
          status: 'success',
          transactions: await listTransactions(envOf(request), {
            type: q?.type ? String(q.type) : undefined,
            appId: q?.app ? String(q.app).slice(0, 50) : undefined,
            search: String(q?.q ?? '').slice(0, 100),
            before: q?.before ? String(q.before) : undefined,
            limit: intParam(q?.limit, 50, 200),
          }),
        };
      });
      api.get('/transactions/:id', async (request, reply) => {
        try { return { status: 'success', ...(await getTransaction(envOf(request), String((request.params as any).id))) }; } catch (e) { return fail(reply, e); }
      });

      api.get('/main', async (request) => ({ status: 'success', ...(await mainOverview(envOf(request))) }));

      api.post('/main/send', async (request, reply) => {
        if (!recent(request, reply)) return;
        const key = idem(request, reply);
        if (!key) return;
        try { return { status: 'success', ...(await sendFromMain(envOf(request), adminOf(request), (request.body ?? {}) as any, key)) }; } catch (e) { return fail(reply, e); }
      });

      api.post('/main/recharge', async (request, reply) => {
        if (!recent(request, reply)) return;
        const key = idem(request, reply);
        if (!key) return;
        const env = envOf(request);
        const back = process.env.ADMIN_BASE_URL ? `${process.env.ADMIN_BASE_URL.replace(/\/$/, '')}/admin${env === 'sandbox' ? '?env=sandbox' : ''}#/main` : null;
        const checkout = (process.env.CHECKOUT_BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
        try {
          const r = await rechargeMain(env, adminOf(request), (request.body as any)?.amount, key, back);
          return { status: 'success', ...r, checkout_url: `${checkout}${r.checkout_path}` };
        } catch (e) { return fail(reply, e); }
      });

      api.post('/faucet/issue', async (request, reply) => {
        if (!recent(request, reply)) return;
        const key = idem(request, reply);
        if (!key) return;
        try { return { status: 'success', ...(await issueFaucet(envOf(request), adminOf(request), (request.body as any)?.amount, key)) }; } catch (e) { return fail(reply, e); }
      });

      api.get('/audit', async (request) => ({ status: 'success', audit: await listAudit(envOf(request), intParam((request.query as any)?.limit, 100, 500)) }));
    },
    { prefix: '/v1/admin-console' }
  );
}
