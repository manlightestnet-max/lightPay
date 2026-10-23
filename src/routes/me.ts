import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LightPayUser, UserTokenError, isRecentSignIn, verifyUserToken } from '../security/user-token.js';
import { ConnectError, SCOPE_LABELS, approve, listUserConnections, revokeConnection, walletStatement } from '../db/connect.js';
import { closeWallet, findDefaultWallet, listWallets, openWallet, renameWallet, setDefaultWallet, userWallet, walletOf, WalletRow } from '../wallets/index.js';
import { controlSettings } from '../payments/control-settings.js';
import { cancelCountryRequest, chooseCountry, countryChangeQuote, mustChooseCountry, requestCountryChange } from '../wallets/country.js';
import { countryByCode } from '../rails/registry.js';

/** The pending request of each wallet, or its last decision of the past week (shown on the wallet). */
async function countryRequestsOf(env: Environment, wallets: WalletRow[]) {
  if (!wallets.length) return new Map<string, any>();
  const rows = await query(
    `SELECT DISTINCT ON (wallet_id) wallet_id, status, to_country, decision_note, created_at, decided_at FROM wallet_country_requests
     WHERE wallet_id = ANY($1) AND (status = 'PENDING' OR (status IN ('APPROVED', 'REJECTED') AND decided_at > NOW() - INTERVAL '7 days'))
     ORDER BY wallet_id, created_at DESC`,
    [wallets.map((w) => w.id)],
    env
  );
  return new Map(rows.map((r: any) => [r.wallet_id, { status: r.status, to_country: r.to_country, to_country_name: countryByCode(r.to_country)?.name ?? r.to_country, note: r.decision_note, created_at: r.created_at, decided_at: r.decided_at }]));
}

/** What the person's pages see of a wallet (never the internal account id). */
const walletView = (w: WalletRow, requests?: Map<string, any>) => ({
  id: w.id,
  label: w.label ?? 'Principal',
  country: w.country,
  country_name: (w.country && countryByCode(w.country)?.name) || null,
  currency: w.currency,
  available_balance: String(w.available_balance),
  locked_balance: String(w.locked_balance),
  status: w.status,
  is_default: w.is_default,
  country_request: requests?.get(w.id) ?? null,
  created_at: w.created_at,
});
import { closeAccount, listWithdrawals, moveBetweenWallets, quoteWithdrawal, selfDeposit, sendMoney, updateConnection, withdraw } from '../db/account.js';
import { minMobileMoneyAmount, minWithdrawalAmount, quote } from '../payments/fees.js';
import { getActivity, listActivity } from '../db/activity.js';
import { mobileNetworks } from '../payments/mobile-money.js';
import { route as routeOperation } from '../rails/routing.js';
import { Environment } from '../types/index.js';
import { query } from '../db/pool.js';
import { onWalletChange } from '../realtime.js';
import { developerAccess, findRecipient, getUsername, requestDeveloperAccess, setUsername } from '../db/identity.js';
import { noteSignIn, notifyAccount, registerDevice, removeAllDevices, removeDevice } from '../notify/index.js';
import { ACCOUNT } from '../notify/catalog.js';
import { appLogos, setPhotoVisible } from '../db/avatars.js';
import { PinError, hasPin, removePin, setPin, verifyPin } from '../db/pin.js';

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
    // A sign-in from a device the person never used: « Nouvelle connexion » (notify/).
    noteSignIn(envOf(request), request.lightpayUser, request.headers['user-agent']);
  } catch (err) {
    return reply.status(401).send({ error: 'SIGN_IN_REQUIRED', message: err instanceof UserTokenError ? err.message : 'Session expirée, reconnectez-vous.' });
  }
}

const fail = (reply: FastifyReply, err: any) => {
  const insufficient = String(err?.message ?? '').startsWith('Insufficient funds');
  return reply.status(err instanceof ConnectError || err?.code === 'LOCKED' ? err.statusCode : insufficient ? 402 : 400).send({
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

/**
 * Money leaving the wallet: the person's 6-digit LightPay code, in the X-LightPay-Pin header
 * (db/pin.ts: hashed, 5 wrong codes lock it 15 minutes). Asked when the person confirms, so a
 * burst of taps never sends twice and a stolen session alone cannot move money.
 */
export async function pinOk(request: FastifyRequest, reply: FastifyReply) {
  try {
    await verifyPin(request.lightpayUser!.uid, request.headers['x-lightpay-pin']);
    return true;
  } catch (err) {
    if (err instanceof PinError) {
      reply.status(err.statusCode).send({ status: 'error', error: err.code, message: err.message, ...err.extra });
      return false;
    }
    throw err;
  }
}

/** Sensitive actions: signed in (Google) in the last 10 minutes. */
const recent = (request: FastifyRequest, reply: FastifyReply) => {
  if (isRecentSignIn(request.lightpayUser!)) return true;
  reply.status(401).send({ error: 'RECENT_SIGN_IN_REQUIRED', message: 'Pour votre sécurité, reconnectez-vous avec votre compte Google.' });
  return false;
};

/**
 * The person's own LightPay space (used by the hosted account and consent pages).
 *   GET    /v1/me                         profile + default wallet + every wallet (creates the default one)
 *   GET    /v1/me/wallets                 my wallets (default first)
 *   POST   /v1/me/wallets                 { label, country? }  open another wallet (up to the admin's maximum)
 *   PATCH  /v1/me/wallets/:id             { label }  rename
 *   POST   /v1/me/wallets/:id/default     receives what names no wallet (transfers to @username, connections…)
 *   DELETE /v1/me/wallets/:id             close (empty, nothing pending, not the default)
 *   POST   /v1/me/wallets/move            { from, to, amount }  between my wallets, free (X-LightPay-Pin)
 *   PUT    /v1/me/country                 { country }  the first wallet's country, chosen once (choose_country in /v1/me)
 *   GET    /v1/me/wallets/:id/country-quote   what moving this wallet to another country would cost now (swap fee)
 *   POST   /v1/me/wallets/:id/country     { country, reason? }  ask to move it (decided by LightPay's admin) · DELETE cancels
 *   GET    /v1/me/transactions            ledger statement (money that moved)      ?wallet_id (default: the default wallet)
 *   GET    /v1/me/activity[/:id]          history of every operation: state + reason of a refusal   ?wallet_id
 *   GET    /v1/me/connections             apps I authorized
 *   DELETE /v1/me/connections/:id         revoke an app
 *   POST   /v1/me/connect/approve         approve an app's request -> redirect URL with code
 *   PATCH  /v1/me/connections/:id         remove permissions / change the charge limit
 *   POST   /v1/me/deposits                top up by mobile money -> hosted page        { amount, wallet_id? }
 *   POST   /v1/me/transfers               send to another LightPay user (X-LightPay-Pin)   { to, amount, note?, wallet_id? }
 *   POST   /v1/me/withdrawals             withdraw to mobile money (X-LightPay-Pin)    { amount, msisdn, network, wallet_id? }
 *   PUT    /v1/me/pin                     { pin, current_pin? }  choose / change the 6-digit code
 *                                          (forgotten: recent Google sign-in instead of current_pin)
 *   GET    /v1/me/withdrawals             my withdrawals
 *   GET    /v1/me/withdrawals/quote       ?amount&network -> amount received, fees, total debited
 *   GET    /v1/me/deposits/quote          ?amount -> what the phone pays, per operator
 *   DELETE /v1/me                         close my account (recent sign-in, everything at zero)
 *   PUT    /v1/me/username                { username }  my @username (required to use the wallet)
 *   GET    /v1/me/recipient               ?to=@name|e-mail -> who a transfer would reach (name, @username)
 *   GET    /v1/me/developer-access        my advanced-mode request: NONE | PENDING | APPROVED | REJECTED
 *   POST   /v1/me/developer-access        { project, website, use_case }  ask for the advanced mode
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
    const wallets = await listWallets(envOf(request), user.uid);
    const requests = await countryRequestsOf(envOf(request), wallets);
    return {
      status: 'success',
      user: {
        uid: user.uid, email: user.email, name: user.name, email_verified: user.emailVerified,
        // The Google photo, and whether the people this person pays or is paid by may see it.
        picture: wallet.metadata?.picture ?? user.picture ?? null,
        show_photo: wallet.metadata?.hide_photo !== true,
      },
      wallet: {
        id: wallet.id,
        currency: wallet.currency,
        available_balance: String(wallet.available_balance),
        locked_balance: String(wallet.locked_balance),
        status: wallet.status,
      },
      wallets: wallets.map((w) => walletView(w, requests)),
      max_wallets: controlSettings(envOf(request)).max_wallets,
      // The first wallet's country is chosen once, before using it (when several countries are open).
      choose_country: mustChooseCountry(wallet),
      // Minimums set by the admin, shown before anything is typed.
      limits: { deposit_min: minMobileMoneyAmount(envOf(request)).toString(), withdrawal_min: minWithdrawalAmount(envOf(request)).toString() },
      environment: envOf(request),
      recent_sign_in: isRecentSignIn(user),
      username: await getUsername(user.uid),
      // The 6-digit code is mandatory: chosen right after the @username.
      pin_set: await hasPin(user.uid),
      developer: (await developerAccess(user.uid)).status,
    };
  });

  /** The wallet a reading is about: ?wallet_id (one of mine), else the default one. */
  const readWallet = (request: FastifyRequest) => {
    const id = (request.query as any)?.wallet_id;
    return id ? walletOf(envOf(request), request.lightpayUser!.uid, { id: String(id) }) : userWallet(envOf(request), request.lightpayUser!);
  };

  fastify.get('/transactions', async (request, reply) => {
    try {
      const wallet = await readWallet(request);
      return { status: 'success', entries: await walletStatement(envOf(request), wallet.id, Number((request.query as any).limit ?? 50)) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get('/activity', async (request, reply) => {
    try {
      const wallet = await readWallet(request);
      return { status: 'success', activity: await listActivity(envOf(request), wallet.id, Number((request.query as any).limit ?? 50)) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get('/activity/:id', async (request, reply) => {
    try {
      const id = String((request.params as any).id);
      // Without ?wallet_id, the operation is looked for in every wallet of the person (the default first).
      const wallets = (request.query as any)?.wallet_id ? [await readWallet(request)] : await listWallets(envOf(request), request.lightpayUser!.uid, { includeClosed: true });
      let item = null;
      for (const wallet of wallets) if (!item) item = await getActivity(envOf(request), wallet.id, id);
      if (!item) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Opération introuvable.' });
      return { status: 'success', activity: item };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // ---------------------------------------------------------------- my wallets
  fastify.get('/wallets', async (request) => {
    const wallets = await listWallets(envOf(request), request.lightpayUser!.uid);
    const requests = await countryRequestsOf(envOf(request), wallets);
    return { status: 'success', wallets: wallets.map((w) => walletView(w, requests)), max_wallets: controlSettings(envOf(request)).max_wallets };
  });
  // The first wallet's country, chosen once.
  fastify.put('/country', async (request, reply) => {
    try {
      return { status: 'success', wallet: walletView(await chooseCountry(envOf(request), request.lightpayUser!, ((request.body ?? {}) as any).country)) };
    } catch (err) {
      return fail(reply, err);
    }
  });
  // Moving a wallet to another country: asked here, decided by LightPay's admin (swap fee on approval).
  fastify.get('/wallets/:id/country-quote', async (request, reply) => {
    try {
      const wallet = await walletOf(envOf(request), request.lightpayUser!.uid, { id: String((request.params as any).id) });
      return { status: 'success', quote: countryChangeQuote(envOf(request), wallet) };
    } catch (err) {
      return fail(reply, err);
    }
  });
  fastify.post('/wallets/:id/country', async (request, reply) => {
    const body = (request.body ?? {}) as any;
    try {
      const r = await requestCountryChange(envOf(request), request.lightpayUser!, String((request.params as any).id), body.country, body.reason);
      return { status: 'success', request: { status: r.status, to_country: r.to_country, created_at: r.created_at } };
    } catch (err) {
      return fail(reply, err);
    }
  });
  fastify.delete('/wallets/:id/country', async (request, reply) => {
    try {
      const r = await cancelCountryRequest(envOf(request), request.lightpayUser!, String((request.params as any).id));
      return { status: 'success', request: { status: r.status } };
    } catch (err) {
      return fail(reply, err);
    }
  });
  fastify.post('/wallets', async (request, reply) => {
    const body = (request.body ?? {}) as any;
    const country = body.country ? String(body.country).toUpperCase() : undefined;
    if (country && !countryByCode(country)) return reply.status(400).send({ status: 'error', error: 'BAD_COUNTRY', message: 'Pays inconnu.' });
    try {
      const wallet = await openWallet(envOf(request), request.lightpayUser!, { label: body.label, country }, controlSettings(envOf(request)).max_wallets);
      return { status: 'success', wallet: walletView(wallet) };
    } catch (err) {
      return fail(reply, err);
    }
  });
  fastify.post('/wallets/move', async (request, reply) => {
    const key = idem(request, reply);
    if (!key || !(await pinOk(request, reply))) return;
    try {
      return { status: 'success', move: await moveBetweenWallets(envOf(request), request.lightpayUser!, (request.body ?? {}) as any, key) };
    } catch (err) {
      return fail(reply, err);
    }
  });
  fastify.patch('/wallets/:id', async (request, reply) => {
    try {
      return { status: 'success', wallet: walletView(await renameWallet(envOf(request), request.lightpayUser!.uid, String((request.params as any).id), ((request.body ?? {}) as any).label)) };
    } catch (err) {
      return fail(reply, err);
    }
  });
  fastify.post('/wallets/:id/default', async (request, reply) => {
    try {
      return { status: 'success', wallet: walletView(await setDefaultWallet(envOf(request), request.lightpayUser!.uid, String((request.params as any).id))) };
    } catch (err) {
      return fail(reply, err);
    }
  });
  fastify.delete('/wallets/:id', async (request, reply) => {
    try {
      return { status: 'success', wallet: walletView(await closeWallet(envOf(request), request.lightpayUser!.uid, String((request.params as any).id))) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get('/connections', async (request) => {
    const connections = await listUserConnections(envOf(request), request.lightpayUser!);
    const logos = await appLogos(envOf(request), connections.map((c: any) => c.app_id));
    return { status: 'success', scope_labels: SCOPE_LABELS, connections: connections.map((c: any) => ({ ...c, logo_url: logos.get(c.app_id) ?? null })) };
  });

  // « Afficher ma photo » (Compte) : the Google photo seen by the people this person pays or is paid by.
  fastify.put('/photo', async (request) => {
    const visible = ((request.body ?? {}) as any).visible !== false;
    await setPhotoVisible(request.lightpayUser!.uid, visible);
    return { status: 'success', show_photo: visible };
  });

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
      return { status: 'success', ...(await selfDeposit(envOf(request), request.lightpayUser!, (request.body as any)?.amount, key, (request.body as any)?.wallet_id)) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post('/transfers', async (request, reply) => {
    const key = idem(request, reply);
    if (!key || !(await pinOk(request, reply))) return;
    try {
      return { status: 'success', transfer: await sendMoney(envOf(request), request.lightpayUser!, (request.body ?? {}) as any, key) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post('/withdrawals', async (request, reply) => {
    const key = idem(request, reply);
    if (!key || !(await pinOk(request, reply))) return;
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
    const wallets = await listWallets(envOf(request), user.uid);
    streams.set(user.uid, (streams.get(user.uid) ?? 0) + 1);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': open\n\n');
    let pending: NodeJS.Timeout | null = null;
    // Any of the person's wallets moving refreshes their pages.
    const offs = wallets.map((w) => onWalletChange(envOf(request), w.id, () => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; res.write('event: change\ndata: {}\n\n'); }, 250);
    }));
    const off = () => offs.forEach((f) => f());
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

  // The 6-digit code: chosen once signed in; changed with the current code, or after a fresh
  // Google sign-in when forgotten.
  fastify.put('/pin', async (request, reply) => {
    const b = (request.body ?? {}) as any;
    try {
      await setPin(request.lightpayUser!.uid, b.pin, { current: b.current_pin, recentSignIn: isRecentSignIn(request.lightpayUser!) });
      return { status: 'success', pin_set: true };
    } catch (err) {
      if (err instanceof PinError) return reply.status(err.statusCode).send({ status: 'error', error: err.code, message: err.message, ...err.extra });
      return fail(reply, err);
    }
  });

  fastify.put('/username', async (request, reply) => {
    try {
      const before = await getUsername(request.lightpayUser!.uid);
      const username = await setUsername(request.lightpayUser!, (request.body as any)?.username);
      if (before && before !== username) notifyAccount(envOf(request), request.lightpayUser!, ACCOUNT.usernameChanged(username), username);
      return { status: 'success', username };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get('/recipient', async (request, reply) => {
    try {
      const r = await findRecipient(envOf(request), (request.query as any)?.to);
      if (r.uid === request.lightpayUser!.uid) return reply.status(400).send({ error: 'SAME_WALLET', message: 'C’est votre propre compte.' });
      return { status: 'success', recipient: { name: r.name, username: r.username, picture: r.picture } };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get('/developer-access', async (request) => ({ status: 'success', access: await developerAccess(request.lightpayUser!.uid) }));
  fastify.post('/developer-access', async (request, reply) => {
    try {
      return { status: 'success', access: await requestDeveloperAccess(request.lightpayUser!, (request.body ?? {}) as any) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Push notifications: the app registers this phone's Firebase Cloud Messaging token (after
  // sign-in, when it changes) and removes it at sign-out or when notifications are turned off.
  fastify.post('/devices', async (request, reply) => {
    const b = (request.body ?? {}) as any;
    const token = String(b.token ?? '').trim();
    if (token.length < 20 || token.length > 4096) return reply.status(400).send({ error: 'INVALID_TOKEN', message: 'Jeton de notification invalide.' });
    const platform = ['android', 'ios', 'web'].includes(b.platform) ? b.platform : 'android';
    await registerDevice(envOf(request), request.lightpayUser!.uid, token, platform, b.label ? String(b.label).slice(0, 80) : null);
    return { status: 'success' };
  });
  fastify.delete('/devices', async (request) => {
    const token = String(((request.body ?? {}) as any).token ?? (request.query as any)?.token ?? '').trim();
    if (token) await removeDevice(request.lightpayUser!.uid, token);
    return { status: 'success' };
  });

  fastify.get('/withdrawals', async (request) => ({ status: 'success', withdrawals: await listWithdrawals(envOf(request), request.lightpayUser!) }));

  fastify.get('/withdrawals/quote', async (request, reply) => {
    const q = request.query as any;
    try {
      return { status: 'success', quote: await quoteWithdrawal(envOf(request), request.lightpayUser!, q.amount, q.network) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get('/deposits/quote', async (request, reply) => {
    const raw = String((request.query as any).amount ?? '');
    if (!/^\d{1,12}$/.test(raw) || BigInt(raw) <= 0n) return reply.status(400).send({ error: 'INVALID_AMOUNT', message: 'Montant invalide.' });
    const amount = BigInt(raw);
    const env = envOf(request);
    const wallet = request.lightpayUser ? await findDefaultWallet(env, request.lightpayUser.uid) : null;
    const quotes = await Promise.all(
      mobileNetworks().map(async (n) => [n, quote(env, amount, (await routeOperation({ env, type: 'deposit', network: n, destination: wallet?.country, appId: 'mainapp', amount })).provider.name)])
    );
    return { status: 'success', quotes: Object.fromEntries(quotes) };
  });

  fastify.delete('/', async (request, reply) => {
    if (!recent(request, reply)) return;
    try {
      const closed = await closeAccount(request.lightpayUser!);
      notifyAccount(envOf(request), request.lightpayUser!, ACCOUNT.accountClosed(), String(Date.now()));
      await removeAllDevices(request.lightpayUser!.uid).catch(() => undefined);
      await removePin(request.lightpayUser!.uid).catch(() => undefined);
      return { status: 'success', ...closed };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.delete('/connections/:id', async (request, reply) => {
    try {
      const id = String((request.params as any).id);
      const app = (await listUserConnections(envOf(request), request.lightpayUser!)).find((c: any) => c.id === id);
      await revokeConnection(envOf(request), request.lightpayUser!, id);
      if (app) notifyAccount(envOf(request), request.lightpayUser!, ACCOUNT.appRevoked(app.app_name), id);
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
      const app = (await listUserConnections(envOf(request), request.lightpayUser!)).find((c: any) => c.app_id === String(b.app_id ?? '') && c.status === 'ACTIVE');
      if (app) {
        const scopes = (app.scopes as string[]).map((sc) => (SCOPE_LABELS as any)[sc] ?? sc);
        notifyAccount(envOf(request), request.lightpayUser!, ACCOUNT.appAuthorized(app.app_name, scopes), `${app.id}:${scopes.join(',')}`);
      }
      return { status: 'success', ...result };
    } catch (err) {
      return fail(reply, err);
    }
  });
}
