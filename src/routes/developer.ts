import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isRecentSignIn } from '../security/user-token.js';
import { requireUser } from './me.js';
import {
  DeveloperError,
  appBalance,
  appOverview,
  appTransferToOwner,
  appSessions,
  appWebhookLogs,
  claimApp,
  createApp,
  listOwnedApps,
  ownedApp,
  rotateKeys,
  sendTestWebhook,
  updateApp,
} from '../db/developer.js';
import { Environment } from '../types/index.js';
import { isDeveloper } from '../db/identity.js';

const envOf = (request: FastifyRequest): Environment => (request.headers['x-environment'] === 'sandbox' ? 'sandbox' : 'production');

const fail = (reply: FastifyReply, err: any) => {
  if (err instanceof DeveloperError) return reply.status(err.statusCode).send({ error: err.code, message: err.message });
  console.error('[developer]', err?.message ?? err);
  return reply.status(500).send({ error: 'SERVER_ERROR', message: 'Erreur du serveur. Réessayez dans un instant.' });
};

/** Keys and secrets: signed in (Google) in the last 10 minutes. */
const recent = (request: FastifyRequest, reply: FastifyReply) => {
  if (isRecentSignIn(request.lightpayUser!)) return true;
  reply.status(401).send({ error: 'RECENT_SIGN_IN_REQUIRED', message: 'Pour votre sécurité, reconnectez-vous avec votre compte Google.' });
  return false;
};

/**
 * Developer space of the signed-in LightPay account (the apps it owns):
 *   GET    /v1/me/developer/apps                      owned apps
 *   POST   /v1/me/developer/apps                      create { id, name } -> keys shown once   (recent sign-in)
 *   POST   /v1/me/developer/apps/claim                attach an existing app { secret_key }     (recent sign-in)
 *   GET    /v1/me/developer/apps/:id                  app
 *   PATCH  /v1/me/developer/apps/:id                  { name?, webhook_url?, redirect_uris?, embed_origins? } (recent sign-in except name)
 *   POST   /v1/me/developer/apps/:id/rotate-keys      new keys shown once                       (recent sign-in)
 *   GET    /v1/me/developer/apps/:id/overview         balances + last 30 days (X-Environment)
 *   GET    /v1/me/developer/apps/:id/sessions         checkout sessions (X-Environment)
 *   GET    /v1/me/developer/apps/:id/webhooks         webhook deliveries (X-Environment)
 *   POST   /v1/me/developer/apps/:id/webhooks/test    signed `ping` to the webhook URL
 *   GET    /v1/me/developer/apps/:id/balance          the app's wallet: balance and movements (X-Environment)
 *   POST   /v1/me/developer/apps/:id/transfer         { amount } to the owner's own LightPay wallet (recent sign-in + Idempotency-Key)
 *                                                      — never straight to an operator: the owner withdraws from their account
 */
export async function developerRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireUser);
  // The advanced mode is granted by the LightPay admin; without it the developer space does not exist.
  fastify.addHook('preHandler', async (request, reply) => {
    if (reply.sent) return;
    if (!(await isDeveloper(request.lightpayUser!.uid))) {
      return reply.status(403).send({ error: 'DEVELOPER_ACCESS_REQUIRED', message: 'Demandez l’accès au mode avancé depuis votre compte.' });
    }
  });

  fastify.get('/apps', async (request, reply) => {
    try {
      return { apps: await listOwnedApps(request.lightpayUser!.uid) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post('/apps', async (request, reply) => {
    if (!recent(request, reply)) return;
    const body = (request.body ?? {}) as any;
    try {
      return reply.status(201).send(await createApp(request.lightpayUser!.uid, request.lightpayUser!.email, { id: body.id, name: body.name }));
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post('/apps/claim', async (request, reply) => {
    if (!recent(request, reply)) return;
    try {
      return { app: await claimApp(request.lightpayUser!.uid, (request.body as any)?.secret_key) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get('/apps/:id', async (request, reply) => {
    try {
      return { app: await ownedApp(request.lightpayUser!.uid, (request.params as any).id) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.patch('/apps/:id', async (request, reply) => {
    const body = (request.body ?? {}) as any;
    // Where LightPay sends events and people: changing it is sensitive.
    if ((body.webhook_url !== undefined || body.redirect_uris !== undefined || body.embed_origins !== undefined) && !recent(request, reply)) return;
    try {
      return { app: await updateApp(request.lightpayUser!.uid, (request.params as any).id, body) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post('/apps/:id/rotate-keys', async (request, reply) => {
    if (!recent(request, reply)) return;
    try {
      return await rotateKeys(request.lightpayUser!.uid, (request.params as any).id);
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get('/apps/:id/overview', async (request, reply) => {
    try {
      return await appOverview(request.lightpayUser!.uid, (request.params as any).id, envOf(request));
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get('/apps/:id/sessions', async (request, reply) => {
    try {
      return { sessions: await appSessions(request.lightpayUser!.uid, (request.params as any).id, envOf(request), Number((request.query as any).limit ?? 50)) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get('/apps/:id/webhooks', async (request, reply) => {
    try {
      return { deliveries: await appWebhookLogs(request.lightpayUser!.uid, (request.params as any).id, envOf(request), Number((request.query as any).limit ?? 50)) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post('/apps/:id/webhooks/test', async (request, reply) => {
    try {
      return await sendTestWebhook(request.lightpayUser!.uid, (request.params as any).id, envOf(request));
    } catch (err) {
      return fail(reply, err);
    }
  });

  // The app's own wallet: its commissions and what it collected for itself.
  fastify.get('/apps/:id/balance', async (request, reply) => {
    try {
      return await appBalance(request.lightpayUser!.uid, (request.params as any).id, envOf(request));
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post('/apps/:id/transfer', async (request, reply) => {
    if (!recent(request, reply)) return;
    const key = String(request.headers['idempotency-key'] ?? '');
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) return reply.status(400).send({ error: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Missing Idempotency-Key header' });
    try {
      return { transfer: await appTransferToOwner(request.lightpayUser!, (request.params as any).id, envOf(request), (request.body as any)?.amount, key) };
    } catch (err) {
      return fail(reply, err);
    }
  });
}
