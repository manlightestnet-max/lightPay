import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LightPayUser, UserTokenError, verifyUserToken } from '../security/user-token.js';
import { ConnectError, approve, listUserConnections, revokeConnection, userWallet, walletStatement } from '../db/connect.js';
import { Environment } from '../types/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    lightpayUser?: LightPayUser;
  }
}

const envOf = (request: FastifyRequest): Environment => (request.headers['x-environment'] === 'sandbox' ? 'sandbox' : 'production');

/** Signed-in person (Firebase ID token in Authorization: Bearer). */
export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return reply.status(401).send({ error: 'SIGN_IN_REQUIRED', message: 'Connectez-vous à LightPay.' });
  try {
    request.lightpayUser = await verifyUserToken(token);
  } catch (err) {
    return reply.status(401).send({ error: 'SIGN_IN_REQUIRED', message: err instanceof UserTokenError ? err.message : 'Session expirée, reconnectez-vous.' });
  }
}

const fail = (reply: FastifyReply, err: any) =>
  reply.status(err instanceof ConnectError ? err.statusCode : 400).send({ status: 'error', error: err.code || 'REQUEST_ERROR', message: err.message });

/**
 * The person's own LightPay space (used by the hosted account and consent pages).
 *   GET    /v1/me                         profile + wallet balances (creates the wallet)
 *   GET    /v1/me/transactions            wallet history
 *   GET    /v1/me/connections             apps I authorized
 *   DELETE /v1/me/connections/:id         revoke an app
 *   POST   /v1/me/connect/approve         approve an app's request -> redirect URL with code
 * X-Environment: sandbox | production (default production).
 */
export async function meRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireUser);

  fastify.get('/', async (request) => {
    const user = request.lightpayUser!;
    const wallet = await userWallet(envOf(request), user);
    return {
      status: 'success',
      user: { uid: user.uid, email: user.email, name: user.name, email_verified: user.emailVerified },
      wallet: {
        currency: wallet.currency,
        available_balance: String(wallet.available_balance),
        locked_balance: String(wallet.locked_balance),
        status: wallet.status,
      },
      environment: envOf(request),
    };
  });

  fastify.get('/transactions', async (request) => {
    const wallet = await userWallet(envOf(request), request.lightpayUser!);
    return { status: 'success', entries: await walletStatement(envOf(request), wallet.id, Number((request.query as any).limit ?? 50)) };
  });

  fastify.get('/connections', async (request) => ({ status: 'success', connections: await listUserConnections(envOf(request), request.lightpayUser!) }));

  fastify.delete('/connections/:id', async (request, reply) => {
    try {
      await revokeConnection(envOf(request), request.lightpayUser!, (request.params as any).id);
      return { status: 'success' };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post('/connect/approve', async (request, reply) => {
    const b = (request.body ?? {}) as any;
    try {
      const result = await approve(envOf(request), request.lightpayUser!, {
        appId: String(b.app_id ?? ''),
        scopes: String(b.scope ?? '').split(/[\s,]+/).filter(Boolean),
        redirectUri: String(b.redirect_uri ?? ''),
        state: b.state ? String(b.state).slice(0, 512) : undefined,
        codeChallenge: String(b.code_challenge ?? ''),
        chargeLimit: b.charge_limit ? BigInt(b.charge_limit) : undefined,
      });
      return { status: 'success', ...result };
    } catch (err) {
      return fail(reply, err);
    }
  });
}
