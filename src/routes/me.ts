import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LightPayUser, UserTokenError, isRecentSignIn, verifyUserToken } from '../security/user-token.js';
import { ConnectError, SCOPE_LABELS, approve, listUserConnections, revokeConnection, userWallet, walletStatement } from '../db/connect.js';
import { closeAccount, listWithdrawals, quoteWithdrawal, selfDeposit, sendMoney, updateConnection, withdraw } from '../db/account.js';
import { minMobileMoneyAmount, minWithdrawalAmount, quote } from '../payments/fees.js';
import { getActivity, listActivity } from '../db/activity.js';
import { MOBILE_NETWORKS, providerFor } from '../payments/mobile-money.js';
import { Environment } from '../types/index.js';
import { onWalletChange } from '../realtime.js';

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
/** Open live streams per person (a few tabs at most). */
const streams = new Map<string, number>();
const MAX_STREAMS = 6;

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
      // Minimums set by the admin, shown before anything is typed.
      limits: { deposit_min: minMobileMoneyAmount(envOf(request)).toString(), withdrawal_min: minWithdrawalAmount(envOf(request)).toString() },
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

  // Live signal for the person's open pages: "event: change" whenever their wallet moves (a
  // payment, a webhook, a payout settled). No data in it; the page re-reads through this API.
  // Closed after 10 minutes so the page reconnects with a fresh token.
  fastify.get('/stream', async (request, reply) => {
    const user = request.lightpayUser!;
    if ((streams.get(user.uid) ?? 0) >= MAX_STREAMS) return reply.status(429).send({ error: 'TOO_MANY_STREAMS', message: 'Trop de pages ouvertes.' });
    const wallet = await userWallet(envOf(request), user);
    streams.set(user.uid, (streams.get(user.uid) ?? 0) + 1);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': open\n\n');
    let pending: NodeJS.Timeout | null = null;
    const off = onWalletChange(envOf(request), wallet.id, () => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; res.write('event: change\ndata: {}\n\n'); }, 250);
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    const end = setTimeout(() => res.end(), 10 * 60_000);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      off();
      clearInterval(ping);
      clearTimeout(end);
      if (pending) clearTimeout(pending);
      const n = (streams.get(user.uid) ?? 1) - 1;
      if (n > 0) streams.set(user.uid, n); else streams.delete(user.uid);
    };
    request.raw.on('close', close);
    res.on('close', close);
  });

  fastify.get('/withdrawals', async (request) => ({ status: 'success', withdrawals: await listWithdrawals(envOf(request), request.lightpayUser!) }));

  fastify.get('/withdrawals/quote', async (request, reply) => {
    const q = request.query as any;
    try {
      return { status: 'success', quote: quoteWithdrawal(envOf(request), q.amount, q.network) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get('/deposits/quote', async (request, reply) => {
    const raw = String((request.query as any).amount ?? '');
    if (!/^\d{1,12}$/.test(raw) || BigInt(raw) <= 0n) return reply.status(400).send({ error: 'INVALID_AMOUNT', message: 'Montant invalide.' });
    const amount = BigInt(raw);
    return { status: 'success', quotes: Object.fromEntries(MOBILE_NETWORKS.map((n) => [n, quote(envOf(request), amount, providerFor(n).name)])) };
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
