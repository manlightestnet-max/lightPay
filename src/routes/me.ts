import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LightPayUser, UserTokenError, isRecentSignIn, verifyUserToken } from '../security/user-token.js';
import { ConnectError, SCOPE_LABELS, approve, listUserConnections, revokeConnection, userWallet, walletStatement } from '../db/connect.js';
import { closeAccount, listWithdrawals, quoteWithdrawal, selfDeposit, sendMoney, updateConnection, withdraw } from '../db/account.js';
import { quote } from '../payments/fees.js';
import { getActivity, listActivity } from '../db/activity.js';
import { MOBILE_NETWORKS, providerFor } from '../payments/mobile-money.js';
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

const fail = (reply: FastifyReply, err: any) => {
  const insufficient = String(err?.message ?? '').startsWith('Insufficient funds');
  return reply.status(err instanceof ConnectError ? err.statusCode : insufficient ? 402 : 400).send({
    status: 'error',
    error: insufficient ? 'INSUFFICIENT_FUNDS' : err.code || 'REQUEST_ERROR',
    message: insufficient ? 'Solde disponible insuffisant (frais compris).' : err.message,
  });
};

/** Money moves need an Idempotency-Key (a double tap never pays twice). */
const idem = (request: FastifyRequest, reply: FastifyReply) => {
  const key = String(request.headers['idempotency-key'] ?? '');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) {
    reply.status(400).send({ error: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Missing Idempotency-Key header' });
    return null;
  }
  return key;
};

/** Sensitive actions: password entered in the last 10 minutes. */
const recent = (request: FastifyRequest, reply: FastifyReply) => {
  if (isRecentSignIn(request.lightpayUser!)) return true;
  reply.status(401).send({ error: 'RECENT_SIGN_IN_REQUIRED', message: 'Pour votre sécurité, confirmez votre mot de passe.' });
  return false;
};

/**
 * The person's own LightPay space (used by the hosted account and consent pages).
 *   GET    /v1/me                         profile + wallet balances (creates the wallet)
 *   GET    /v1/me/transactions            ledger statement (money that moved)
 *   GET    /v1/me/activity[/:id]          history of every operation: state + reason of a refusal
 *   GET    /v1/me/connections             apps I authorized
 *   DELETE /v1/me/connections/:id         revoke an app
 *   POST   /v1/me/connect/approve         approve an app's request -> redirect URL with code
 *   PATCH  /v1/me/connections/:id         remove permissions / change the charge limit
 *   POST   /v1/me/deposits                top up by mobile money -> hosted page
 *   POST   /v1/me/transfers               send to another LightPay user (recent sign-in)
 *   POST   /v1/me/withdrawals             withdraw to mobile money (recent sign-in)
 *   GET    /v1/me/withdrawals             my withdrawals
 *   GET    /v1/me/withdrawals/quote       ?amount&network -> amount received, fees, total debited
 *   GET    /v1/me/deposits/quote          ?amount -> what the phone pays, per operator
 *   DELETE /v1/me                         close my account (recent sign-in, everything at zero)
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
      recent_sign_in: isRecentSignIn(user),
    };
  });

  fastify.get('/transactions', async (request) => {
    const wallet = await userWallet(envOf(request), request.lightpayUser!);
    return { status: 'success', entries: await walletStatement(envOf(request), wallet.id, Number((request.query as any).limit ?? 50)) };
  });

  fastify.get('/activity', async (request) => {
    const wallet = await userWallet(envOf(request), request.lightpayUser!);
    return { status: 'success', activity: await listActivity(envOf(request), wallet.id, Number((request.query as any).limit ?? 50)) };
  });

  fastify.get('/activity/:id', async (request, reply) => {
    const wallet = await userWallet(envOf(request), request.lightpayUser!);
    const item = await getActivity(envOf(request), wallet.id, String((request.params as any).id));
    if (!item) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Opération introuvable.' });
    return { status: 'success', activity: item };
  });

  fastify.get('/connections', async (request) => ({
    status: 'success',
    scope_labels: SCOPE_LABELS,
    connections: await listUserConnections(envOf(request), request.lightpayUser!),
  }));

  fastify.patch('/connections/:id', async (request, reply) => {
    try {
      return { status: 'success', connection: await updateConnection(envOf(request), request.lightpayUser!, (request.params as any).id, (request.body ?? {}) as any) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post('/deposits', async (request, reply) => {
    const key = idem(request, reply);
    if (!key) return;
    try {
      return { status: 'success', ...(await selfDeposit(envOf(request), request.lightpayUser!, (request.body as any)?.amount, key)) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post('/transfers', async (request, reply) => {
    const key = idem(request, reply);
    if (!key || !recent(request, reply)) return;
    try {
      return { status: 'success', transfer: await sendMoney(envOf(request), request.lightpayUser!, (request.body ?? {}) as any, key) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post('/withdrawals', async (request, reply) => {
    const key = idem(request, reply);
    if (!key || !recent(request, reply)) return;
    try {
      return { status: 'success', withdrawal: await withdraw(envOf(request), request.lightpayUser!, (request.body ?? {}) as any, key) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get('/withdrawals', async (request) => ({ status: 'success', withdrawals: await listWithdrawals(envOf(request), request.lightpayUser!) }));

  fastify.get('/withdrawals/quote', async (request, reply) => {
    const q = request.query as any;
    try {
      return { status: 'success', quote: quoteWithdrawal(q.amount, q.network) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get('/deposits/quote', async (request, reply) => {
    const raw = String((request.query as any).amount ?? '');
    if (!/^\d{1,12}$/.test(raw) || BigInt(raw) <= 0n) return reply.status(400).send({ error: 'INVALID_AMOUNT', message: 'Montant invalide.' });
    const amount = BigInt(raw);
    return { status: 'success', quotes: Object.fromEntries(MOBILE_NETWORKS.map((n) => [n, quote(amount, providerFor(n).name)])) };
  });

  fastify.delete('/', async (request, reply) => {
    if (!recent(request, reply)) return;
    try {
      return { status: 'success', ...(await closeAccount(request.lightpayUser!)) };
    } catch (err) {
      return fail(reply, err);
    }
  });

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
        acceptTerms: b.accept_terms === true,
      });
      return { status: 'success', ...result };
    } catch (err) {
      return fail(reply, err);
    }
  });
}
