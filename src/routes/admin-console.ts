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
  recordProviderBalance,
  reserveWallet,
  reserves,
  sendFromMain,
} from '../db/admin-console.js';
import { Environment } from '../types/index.js';
import { DEFAULT_FEE_SETTINGS, FeeSettingsError, feeSettings, loadFeeSettings, saveFeeSettings, validateFeeSettings } from '../payments/fee-settings.js';
import { auditAction, providerStats } from '../db/admin-console.js';
import { PROVIDER_NAMES, ProviderSettingsError, servesLedger, loadProviderSettings, providerSettings, saveProviderSettings, validateProviderSettings } from '../payments/provider-settings.js';
import { providerByName, providerFor } from '../payments/mobile-money.js';
import { decideDeveloperAccess, listDeveloperRequests } from '../db/identity.js';
import { ConnectError } from '../db/connect.js';
import { DEFAULT_CONTROL_SETTINGS, ControlSettingsError, RANGES, controlSettings, loadControlSettings, saveControlSettings, validateControlSettings } from '../payments/control-settings.js';
import { PayoutControlError, cancelWaitingPayout, getPayoutAdmin, holdPayout, listPayoutsAdmin, payoutTimings, releasePayout } from '../db/payouts.js';
import { liftSuspension, listSuspensions, suspendAccount } from '../db/withdrawal-guard.js';
import { LockdownError, readLockdown, saveLockdown } from '../db/lockdown-store.js';
import { findRecipient } from '../db/identity.js';
import { LEVELS, withBypass } from '../security/lockdown.js';
import { TemplateError, listTemplates, resetTemplate, sampleVars, saveTemplate, validateTemplate } from '../notify/templates.js';
import { fromTemplate } from '../notify/catalog.js';
import { sendTest } from '../notify/index.js';
import { RESERVE_RANGES, ReserveSettingsError, loadReserveSettings, reserveSettings, saveReserveSettings, validateReserveSettings } from '../payments/reserve-settings.js';
import { readProviderBalances } from '../payments/reserve-watch.js';
import { providerRates, realProviderFee } from '../payments/provider-rates.js';
import { CountryRequestError, approveCountryRequest, countPendingCountryRequests, getCountryRequest, listCountryRequests, rejectCountryRequest } from '../wallets/country.js';
import { RebalanceError, cancelTransfer, canTransfer, getTransfer, listTransfers, planTransfer, requestTransfer, transferSources } from '../payments/rebalance.js';
import { KIND_OF, OPERATION_TYPES, OperationType, RoutingError, loadRoutingRules, route, routingRules, saveRoutingRules, validateRoutingRules } from '../rails/routing.js';
import { allCountries, allRails } from '../rails/registry.js';
import { RegistryError, registryForAdmin, updateCountry, updateRail } from '../rails/registry-admin.js';
import { quote, refundBreakdown, withdrawalQuote } from '../payments/fees.js';
import { PROVIDERS_OF } from '../payments/provider-settings.js';
import { query } from '../db/pool.js';

/**
 * Owner's admin console.
 *   GET  /admin                                 the console page (on ADMIN_BASE_URL's host when set)
 *   GET  /v1/admin-console/me                   am I an admin?
 *   GET  /v1/admin-console/overview?period=     revenue, volume, counts, 30-day series, ledger check
 *   GET  /v1/admin-console/reserves             reserves per provider wallet (provider + country) + client money coverage
 *   GET  /v1/admin-console/reserves/:key        one provider wallet (saspay:COG): its line, levels and readings
 *   POST /v1/admin-console/reserves/checks      { provider, country, balance, note }   the real balance read at a provider
 *   POST /v1/admin-console/reserves/read        reads every provider wallet now through the providers' APIs
 *   GET  /v1/admin-console/reserves/:key/plan   a transfer proposal to refill that provider wallet + the possible sources
 *   GET  /v1/admin-console/transfers            transfers between a provider's country wallets · /transfers/:id
 *   POST /v1/admin-console/transfers            { provider, from, to, amount }   recent sign-in; queued, logged
 *   POST /v1/admin-console/transfers/:id/cancel   a transfer still queued   recent sign-in, logged
 *   GET  /v1/admin-console/reserves-settings    gap alert, automatic readings, rebalancing, levels per provider wallet (+ ranges)
 *   PUT  /v1/admin-console/reserves-settings    { …all settings }   recent sign-in; applied at once, logged
 *   GET  /v1/admin-console/routing              routing rules (ordered) + what they can name (providers, operators, countries, apps)
 *   PUT  /v1/admin-console/routing              [ …all rules ]   recent sign-in; applied at once, logged
 *   POST /v1/admin-console/routing/simulate     { type, network, destination?, app?, amount }   which rule and provider, fees at each
 *   GET  /v1/admin-console/provider-rates       what each provider charges now, per operator (?refresh=1 reads it again)
 *   GET  /v1/admin-console/countries            every country and operator (both ledgers), providers' codes
 *   GET  /v1/admin-console/country-requests     people asking to move a wallet to another country (?status=PENDING…) · /:id
 *   POST /v1/admin-console/country-requests/:id/approve   recent sign-in: swap fee taken, wallet moved, logged
 *   POST /v1/admin-console/country-requests/:id/reject    { note }   recent sign-in, logged
 *   PUT  /v1/admin-console/countries/:code      { enabled?, example? }   recent sign-in, logged
 *   PUT  /v1/admin-console/rails/:method        { enabled?, name?, prefixes?, provider_codes? }   recent sign-in, logged
 *   GET  /v1/admin-console/users[?q=&offset=]   LightPay users · /users/:walletId
 *   GET  /v1/admin-console/apps                 apps · /apps/:id (attached users)
 *   GET  /v1/admin-console/transactions[?type=&app=&q=&before=] · /transactions/:id (ledger entries)
 *   GET  /v1/admin-console/main                 wallet main + its movements
 *   POST /v1/admin-console/main/send            { to, amount, note }   recent sign-in + Idempotency-Key
 *   POST /v1/admin-console/main/recharge        { amount }             production: real deposit page
 *   POST /v1/admin-console/faucet/issue         { amount }             test only: issue test money into the faucet
 *   GET  /v1/admin-console/fees                 fees and minimums of this ledger (+ the defaults)
 *   PUT  /v1/admin-console/fees                 { …all settings }   recent sign-in; applied at once, logged
 *   GET  /v1/admin-console/providers            provider of new collections / payouts, keys present, 30-day figures
 *   PUT  /v1/admin-console/providers            { collection, payout }   recent sign-in; applied at once, logged
 *   GET  /v1/admin-console/controls             payout delays and withdrawal limits (+ defaults, ranges)
 *   PUT  /v1/admin-console/controls             { …all settings }   recent sign-in; applied at once, logged
 *   GET  /v1/admin-console/messages             automatic messages: originals, current texts, variables
 *   PUT  /v1/admin-console/messages/:event      { title, body, subject, push, email, enabled }   recent sign-in; logged
 *   DELETE /v1/admin-console/messages/:event    back to the original text (logged)
 *   POST /v1/admin-console/messages/:event/test the message with sample values, to the admin's own phone and e-mail
 *   GET  /v1/admin-console/lockdown             the emergency brake: level, reason, since, by, forced by the environment
 *   PUT  /v1/admin-console/lockdown             { level, reason }   recent sign-in; works even when everything else is stopped
 *   GET  /v1/admin-console/payouts[?filter=]    withdrawals and refunds: upcoming (waiting or held) · held · all
 *   POST /v1/admin-console/payouts/:id/hold     { kind: DISPUTE|SUPPORT|OTHER, reason }   keep a waiting payout
 *   POST /v1/admin-console/payouts/:id/release  send it at the next pass
 *   POST /v1/admin-console/payouts/:id/cancel   give the wallet its money back (amount and fees)
 *   GET  /v1/admin-console/suspensions          accounts suspended for withdrawals and transfers
 *   POST /v1/admin-console/suspensions          { to, minutes, reason }   suspend one by hand
 *   DELETE /v1/admin-console/suspensions/:uid   lift a suspension
 *   GET  /v1/admin-console/developers[?status=] advanced-mode requests (pending first)
 *   POST /v1/admin-console/developers/:uid      { approve, note }   decide a request (logged)
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
  if (err instanceof PayoutControlError || err instanceof LockdownError || err instanceof ControlSettingsError || err instanceof ReserveSettingsError || err instanceof RoutingError || err instanceof RebalanceError || err instanceof CountryRequestError) {
    return reply.status((err as any).statusCode ?? 400).send({ status: 'error', error: (err as any).code, message: err.message });
  }
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
  reply.status(401).send({ error: 'RECENT_SIGN_IN_REQUIRED', message: 'Pour votre sécurité, reconnectez-vous avec votre compte Google.' });
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
      api.post('/reserves/checks', async (request, reply) => {
        const env = envOf(request);
        const admin = adminOf(request);
        try {
          const check = await recordProviderBalance(env, admin, (request.body ?? {}) as any);
          await auditAction(env, admin, 'PROVIDER_BALANCE_CHECK', null, null, { provider: check.provider, country: check.country, balance: check.balance, note: check.note });
          return { status: 'success', check, reserves: await reserves(env) };
        } catch (e) {
          return fail(reply, e);
        }
      });
      api.post('/reserves/read', async (request) => {
        const env = envOf(request);
        const admin = adminOf(request);
        const read = await readProviderBalances(env, admin.email || admin.uid, { force: true });
        return { status: 'success', read, reserves: await reserves(env) };
      });
      api.get('/reserves/:key', async (request, reply) => {
        try {
          return { status: 'success', ...(await reserveWallet(envOf(request), String((request.params as any).key))) };
        } catch (e) {
          return fail(reply, e);
        }
      });
      api.get('/reserves/:key/plan', async (request, reply) => {
        const env = envOf(request);
        const [provider, country] = String((request.params as any).key).split(':');
        if (!provider || !country || !canTransfer(env, provider)) return reply.status(400).send({ status: 'error', error: 'TRANSFER_NOT_SUPPORTED', message: 'Ce wallet ne peut pas être rééquilibré par API.' });
        const [plan, sources] = await Promise.all([planTransfer(env, provider, country), transferSources(env, provider, country)]);
        const str = (x: bigint | null) => (x === null ? null : x.toString());
        return {
          status: 'success',
          plan: plan ? { from: plan.from, amount: plan.amount.toString(), surplus: plan.surplus.toString() } : null,
          sources: sources.map((s) => ({ country: s.country, available: str(s.available), surplus: s.surplus.toString() })),
        };
      });
      api.get('/transfers', async (request) => ({ status: 'success', transfers: await listTransfers(envOf(request), intParam((request.query as any)?.limit, 50, 200)) }));
      api.get('/transfers/:id', async (request, reply) => {
        try {
          return { status: 'success', ...(await getTransfer(envOf(request), String((request.params as any).id))) };
        } catch (e) {
          return fail(reply, e);
        }
      });
      api.post('/transfers', async (request, reply) => {
        if (!recent(request, reply)) return;
        const env = envOf(request);
        const admin = adminOf(request);
        const b = (request.body ?? {}) as any;
        const raw = String(b.amount ?? '').replace(/\D/g, '');
        try {
          const transfer = await requestTransfer(env, {
            provider: String(b.provider ?? ''),
            from: String(b.from ?? '').toUpperCase(),
            to: String(b.to ?? '').toUpperCase(),
            amount: raw ? BigInt(raw) : 0n,
            reason: 'manual',
            by: admin.email || admin.uid,
          });
          await auditAction(env, admin, 'TRANSFER_REQUEST', transfer.id, BigInt(transfer.amount), { provider: transfer.provider, from: transfer.from_country, to: transfer.to_country });
          return { status: 'success', transfer };
        } catch (e) {
          return fail(reply, e);
        }
      });
      api.post('/transfers/:id/cancel', async (request, reply) => {
        if (!recent(request, reply)) return;
        const env = envOf(request);
        try {
          const transfer = await cancelTransfer(env, String((request.params as any).id));
          await auditAction(env, adminOf(request), 'TRANSFER_CANCEL', transfer.id, BigInt(transfer.amount), { provider: transfer.provider, from: transfer.from_country, to: transfer.to_country });
          return { status: 'success', transfer };
        } catch (e) {
          return fail(reply, e);
        }
      });
      api.get('/reserves-settings', async (request) => {
        const env = envOf(request);
        return { status: 'success', settings: await loadReserveSettings(env).catch(() => reserveSettings(env)), ranges: RESERVE_RANGES };
      });
      api.put('/reserves-settings', async (request, reply) => {
        if (!recent(request, reply)) return;
        const env = envOf(request);
        let next;
        try {
          next = validateReserveSettings(request.body);
        } catch (e) {
          return fail(reply, e);
        }
        const admin = adminOf(request);
        const { before, after } = await saveReserveSettings(env, next, admin.email || admin.uid);
        if (JSON.stringify(before) !== JSON.stringify(after)) await auditAction(env, admin, 'RESERVES_UPDATE', null, null, { before, after });
        return { status: 'success', settings: after };
      });

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

      api.get('/fees', async (request) => {
        const env = envOf(request);
        return { status: 'success', settings: await loadFeeSettings(env).catch(() => feeSettings(env)), defaults: DEFAULT_FEE_SETTINGS };
      });
      api.put('/fees', async (request, reply) => {
        if (!recent(request, reply)) return;
        const env = envOf(request);
        let next;
        try {
          next = validateFeeSettings(request.body);
        } catch (e) {
          if (e instanceof FeeSettingsError) return reply.status(400).send({ status: 'error', error: e.code, message: e.message });
          throw e;
        }
        const admin = adminOf(request);
        const { before, after } = await saveFeeSettings(env, next, admin.email || admin.uid);
        const changed = Object.fromEntries(Object.keys(after).filter((k) => (before as any)[k] !== (after as any)[k]).map((k) => [k, { from: (before as any)[k], to: (after as any)[k] }]));
        if (Object.keys(changed).length) await auditAction(env, admin, 'FEES_UPDATE', null, null, { changed });
        return { status: 'success', settings: after };
      });

      api.get('/providers', async (request) => {
        const env = envOf(request);
        const saved = await loadProviderSettings(env).catch(() => providerSettings(env));
        return {
          status: 'success',
          saved: Boolean(saved),
          current: { collection: providerFor(env, 'MTN_MOMO_COG', 'collection').name, payout: providerFor(env, 'MTN_MOMO_COG', 'payout').name },
          // All of them, with whether they serve this ledger (only those can be chosen).
          providers: PROVIDER_NAMES.map((name) => ({ name, available: servesLedger(env, name), configured: providerByName(name).configured(env) })),
          stats: await providerStats(env, 'month'),
        };
      });
      api.put('/providers', async (request, reply) => {
        if (!recent(request, reply)) return;
        const env = envOf(request);
        let next;
        try {
          next = validateProviderSettings(env, request.body);
        } catch (e) {
          if (e instanceof ProviderSettingsError) return reply.status(400).send({ status: 'error', error: e.code, message: e.message });
          throw e;
        }
        // Never route money to a provider without keys on this ledger.
        const missing = [next.collection, next.payout].find((n) => !providerByName(n).configured(env));
        if (missing) return reply.status(400).send({ status: 'error', error: 'PROVIDER_NOT_CONFIGURED', message: `Clés ${missing} absentes pour cet environnement.` });
        const admin = adminOf(request);
        const { before, after } = await saveProviderSettings(env, next, admin.email || admin.uid);
        if (!before || before.collection !== after.collection || before.payout !== after.payout) {
          await auditAction(env, admin, 'PROVIDERS_UPDATE', null, null, { from: before, to: after });
        }
        return { status: 'success', current: after };
      });

      // ---------------------------------------------------------- routing rules
      api.get('/routing', async (request) => {
        const env = envOf(request);
        const apps = await query(`SELECT id, name FROM apps WHERE id <> 'mainapp' ORDER BY name`, [], env);
        return {
          status: 'success',
          rules: await loadRoutingRules(env).catch(() => routingRules(env)),
          default: { collection: providerFor(env, 'MTN_MOMO_COG', 'collection').name, payout: providerFor(env, 'MTN_MOMO_COG', 'payout').name },
          options: {
            providers: PROVIDERS_OF[env].map((name) => ({ name, configured: providerByName(name).configured(env) })),
            types: OPERATION_TYPES.map((t) => ({ type: t, kind: KIND_OF[t] })),
            networks: allRails().map((r) => ({ network: r.network, name: r.name, country: r.country, enabled: r.enabled })),
            countries: allCountries().map((c) => ({ code: c.code, name: c.name, enabled: c.enabled })),
            apps,
          },
        };
      });
      api.put('/routing', async (request, reply) => {
        if (!recent(request, reply)) return;
        const env = envOf(request);
        let next;
        try {
          next = validateRoutingRules(env, (request.body as any)?.rules ?? request.body);
        } catch (e) {
          return fail(reply, e);
        }
        const admin = adminOf(request);
        const { before, after } = await saveRoutingRules(env, next, admin.email || admin.uid);
        if (JSON.stringify(before) !== JSON.stringify(after)) await auditAction(env, admin, 'ROUTING_UPDATE', null, null, { before, after });
        return { status: 'success', rules: after };
      });
      /** Which rule and provider an operation would get now, and what each provider would cost for it. Nothing is sent. */
      api.post('/routing/simulate', async (request, reply) => {
        const env = envOf(request);
        const b = (request.body ?? {}) as any;
        const type = String(b.type ?? '') as OperationType;
        if (!(OPERATION_TYPES as readonly string[]).includes(type)) return reply.status(400).send({ status: 'error', error: 'BAD_TYPE', message: 'Type d’opération inconnu.' });
        const network = String(b.network ?? '');
        if (!allRails().some((r) => r.network === network)) return reply.status(400).send({ status: 'error', error: 'BAD_NETWORK', message: 'Opérateur inconnu.' });
        const raw = String(b.amount ?? '').replace(/\D/g, '');
        if (!raw || BigInt(raw) <= 0n) return reply.status(400).send({ status: 'error', error: 'BAD_AMOUNT', message: 'Montant en FCFA entiers.' });
        const amount = BigInt(raw);
        const decision = await route({ env, type, network, destination: b.destination || null, appId: b.app || null, amount });
        const fees = await Promise.all(PROVIDERS_OF[env].map(async (name) => {
          const configured = providerByName(name).configured(env);
          // What the provider really charges (its live price), beside the fee set in « Frais et minimums ».
          const real = (on: bigint) => realProviderFee(env, name, network, KIND_OF[type], on).then((f) => (f === null ? null : f.toString())).catch(() => null);
          if (KIND_OF[type] === 'collection') {
            const q = quote(env, amount, name);
            return { provider: name, configured, operator_fee: q.operator_fee, real_operator_fee: await real(amount + BigInt(q.lightpay_fee)), lightpay_fee: q.lightpay_fee, total: q.total, label: 'Le client paie' };
          }
          if (type === 'refund') {
            const r = refundBreakdown(env, amount, name);
            return { provider: name, configured, operator_fee: r.operator_fee.toString(), real_operator_fee: await real(r.sent), lightpay_fee: r.lightpay_fee.toString(), total: r.sent.toString(), label: 'Rendu au client' };
          }
          const w = withdrawalQuote(env, amount, name, 'XAF');
          return { provider: name, configured, operator_fee: w.operator_fee, real_operator_fee: await real(amount), lightpay_fee: w.lightpay_fee, total: w.total, label: 'Débité du wallet' };
        }));
        return { status: 'success', provider: decision.provider.name, rule: decision.rule, steps: decision.steps, fees };
      });

      // ---------------------------------------------------------- wallets moving to another country (decided here)
      api.get('/country-requests', async (request) => {
        const env = envOf(request);
        const status = String((request.query as any)?.status ?? 'PENDING').toUpperCase();
        return { status: 'success', requests: await listCountryRequests(env, ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(status) ? status : ''), pending: await countPendingCountryRequests(env) };
      });
      api.get('/country-requests/:id', async (request, reply) => {
        try {
          return { status: 'success', request: await getCountryRequest(envOf(request), String((request.params as any).id)) };
        } catch (e) {
          return fail(reply, e);
        }
      });
      api.post('/country-requests/:id/approve', async (request, reply) => {
        if (!recent(request, reply)) return;
        const env = envOf(request);
        const admin = adminOf(request);
        try {
          const r = await approveCountryRequest(env, String((request.params as any).id), admin.email || admin.uid);
          await auditAction(env, admin, 'COUNTRY_CHANGE_APPROVED', r.id, r.fee_amount ? BigInt(r.fee_amount) : null, { wallet: r.wallet_id, from: r.from_country, to: r.to_country });
          return { status: 'success', request: await getCountryRequest(env, r.id) };
        } catch (e) {
          return fail(reply, e);
        }
      });
      api.post('/country-requests/:id/reject', async (request, reply) => {
        if (!recent(request, reply)) return;
        const env = envOf(request);
        const admin = adminOf(request);
        try {
          const r = await rejectCountryRequest(env, String((request.params as any).id), admin.email || admin.uid, ((request.body ?? {}) as any).note);
          await auditAction(env, admin, 'COUNTRY_CHANGE_REJECTED', r.id, null, { wallet: r.wallet_id, from: r.from_country, to: r.to_country, note: r.decision_note });
          return { status: 'success', request: await getCountryRequest(env, r.id) };
        } catch (e) {
          return fail(reply, e);
        }
      });

      // ---------------------------------------------------------- providers' live prices (admin only)
      api.get('/provider-rates', async (request) => ({
        status: 'success',
        providers: await providerRates(envOf(request), { refresh: String((request.query as any)?.refresh ?? '') === '1' }),
      }));

      // ---------------------------------------------------------- countries and operators (one list for both ledgers)
      api.get('/countries', async () => ({ status: 'success', ...registryForAdmin() }));
      api.put('/countries/:code', async (request, reply) => {
        if (!recent(request, reply)) return;
        const code = String((request.params as any).code).toUpperCase();
        try {
          const { before, after } = await updateCountry(code, (request.body ?? {}) as any);
          await auditAction(envOf(request), adminOf(request), 'COUNTRY_UPDATE', code, null, { before, after });
          return { status: 'success', ...registryForAdmin() };
        } catch (e) {
          if (e instanceof RegistryError) return reply.status(e.statusCode).send({ status: 'error', error: e.code, message: e.message });
          throw e;
        }
      });
      api.put('/rails/:method', async (request, reply) => {
        if (!recent(request, reply)) return;
        const method = String((request.params as any).method);
        try {
          const { before, after } = await updateRail(method, (request.body ?? {}) as any);
          await auditAction(envOf(request), adminOf(request), 'RAIL_UPDATE', method, null, { before, after });
          return { status: 'success', ...registryForAdmin() };
        } catch (e) {
          if (e instanceof RegistryError) return reply.status(e.statusCode).send({ status: 'error', error: e.code, message: e.message });
          throw e;
        }
      });

      // ---------------------------------------------------------- delays and limits
      api.get('/controls', async (request) => {
        const env = envOf(request);
        return { status: 'success', settings: await loadControlSettings(env).catch(() => controlSettings(env)), defaults: DEFAULT_CONTROL_SETTINGS, ranges: RANGES };
      });
      api.put('/controls', async (request, reply) => {
        if (!recent(request, reply)) return;
        const env = envOf(request);
        let next;
        try {
          next = validateControlSettings(request.body);
        } catch (e) {
          return fail(reply, e);
        }
        const admin = adminOf(request);
        const { before, after } = await saveControlSettings(env, next, admin.email || admin.uid);
        const changed = Object.fromEntries(Object.keys(after).filter((k) => (before as any)[k] !== (after as any)[k]).map((k) => [k, { from: (before as any)[k], to: (after as any)[k] }]));
        if (Object.keys(changed).length) await auditAction(env, admin, 'CONTROLS_UPDATE', null, null, { changed });
        return { status: 'success', settings: after };
      });

      // ---------------------------------------------------------- automatic messages (push + e-mail)
      api.get('/messages', async () => ({ status: 'success', messages: listTemplates() }));
      api.put('/messages/:event', async (request, reply) => {
        if (!recent(request, reply)) return;
        const event = String((request.params as any).event);
        let next;
        try {
          next = validateTemplate(event, request.body);
        } catch (e) {
          if (e instanceof TemplateError) return reply.status(400).send({ status: 'error', error: e.code, message: e.message });
          throw e;
        }
        const admin = adminOf(request);
        const { before, after } = await saveTemplate(event, next, admin.email || admin.uid);
        await auditAction(envOf(request), admin, 'MESSAGE_UPDATE', event, null, { from: before, to: after });
        return { status: 'success', message: after };
      });
      api.delete('/messages/:event', async (request, reply) => {
        if (!recent(request, reply)) return;
        const event = String((request.params as any).event);
        try {
          const admin = adminOf(request);
          const { before, after } = await resetTemplate(event, admin.email || admin.uid);
          await auditAction(envOf(request), admin, 'MESSAGE_RESET', event, null, { from: before, to: after });
          return { status: 'success', message: after };
        } catch (e) {
          if (e instanceof TemplateError) return reply.status(400).send({ status: 'error', error: e.code, message: e.message });
          throw e;
        }
      });
      api.post('/messages/:event/test', async (request, reply) => {
        const event = String((request.params as any).event);
        const m = fromTemplate(event, sampleVars(event), '/home');
        if (!m) return reply.status(400).send({ status: 'error', error: 'MESSAGE_OFF', message: 'Ce message est désactivé, ou sans push ni e-mail : rien à envoyer.' });
        const r = await sendTest(envOf(request), adminOf(request), m);
        return { status: 'success', ...r };
      });

      // ---------------------------------------------------------- emergency brake (runs even when everything else is stopped)
      api.get('/lockdown', async () => ({ status: 'success', lockdown: await readLockdown(), levels: LEVELS }));
      api.put('/lockdown', async (request, reply) => {
        if (!recent(request, reply)) return;
        const admin = adminOf(request);
        const b = (request.body ?? {}) as any;
        try {
          const { before, after } = await saveLockdown(b.level, b.reason, admin.email || admin.uid);
          // The journal lives in the database: when the brake is total it cannot be written, the action stays in the server log.
          await withBypass(() => auditAction('production', admin, 'LOCKDOWN', null, null, { from: before.level, to: after.level, reason: after.reason })).catch((e) =>
            console.error('[LOCKDOWN] not logged', after.level, e?.message)
          );
          return { status: 'success', lockdown: after };
        } catch (e) {
          return fail(reply, e);
        }
      });

      // ---------------------------------------------------------- withdrawals and refunds waiting to leave
      api.get('/payouts', async (request) => {
        const f = String((request.query as any)?.filter ?? 'upcoming');
        const env = envOf(request);
        return { status: 'success', payouts: await listPayoutsAdmin(env, f === 'held' || f === 'all' ? f : 'upcoming'), observed: await payoutTimings(env) };
      });
      api.get('/payouts/:id', async (request, reply) => {
        const p = await getPayoutAdmin(envOf(request), String((request.params as any).id));
        return p ? { status: 'success', payout: p } : reply.status(404).send({ status: 'error', error: 'NOT_FOUND', message: 'Envoi introuvable.' });
      });
      const payoutAction = (name: 'hold' | 'release' | 'cancel') =>
        api.post(`/payouts/:id/${name}`, async (request, reply) => {
          if (!recent(request, reply)) return;
          const env = envOf(request);
          const id = String((request.params as any).id);
          const b = (request.body ?? {}) as any;
          const admin = adminOf(request);
          try {
            const who = admin.email || admin.uid;
            const row = name === 'hold' ? await holdPayout(env, id, b.kind, b.reason, who) : name === 'release' ? await releasePayout(env, id) : await cancelWaitingPayout(env, id);
            await auditAction(env, admin, `PAYOUT_${name.toUpperCase()}`, id, BigInt(row.amount), { kind: b.kind ?? null, reason: b.reason ?? null, payout_reason: row.reason });
            return { status: 'success', payout: await getPayoutAdmin(env, id) };
          } catch (e) {
            return fail(reply, e);
          }
        });
      payoutAction('hold');
      payoutAction('release');
      payoutAction('cancel');

      // ---------------------------------------------------------- accounts suspended for withdrawals and transfers
      api.get('/suspensions', async (request) => ({ status: 'success', suspensions: await listSuspensions(envOf(request)) }));
      api.post('/suspensions', async (request, reply) => {
        if (!recent(request, reply)) return;
        const env = envOf(request);
        const b = (request.body ?? {}) as any;
        const [min, max] = RANGES.withdrawal_suspension_minutes;
        const minutes = Number(b.minutes);
        if (!Number.isInteger(minutes) || minutes < min || minutes > max) return reply.status(400).send({ status: 'error', error: 'INVALID_MINUTES', message: `Durée de ${min} à ${max} minutes.` });
        const admin = adminOf(request);
        try {
          const target = await findRecipient(env, b.to);
          const row = await suspendAccount(env, { uid: target.uid, email: target.email }, minutes, String(b.reason ?? '').trim().slice(0, 300), admin.email || admin.uid);
          await auditAction(env, admin, 'SUSPEND', target.username ? `@${target.username}` : target.email || target.uid, null, { minutes, reason: b.reason ?? null });
          return { status: 'success', suspension: row };
        } catch (e) {
          if (e instanceof ConnectError) return reply.status(e.statusCode).send({ status: 'error', error: e.code, message: e.message });
          throw e;
        }
      });
      api.delete('/suspensions/:uid', async (request, reply) => {
        if (!recent(request, reply)) return;
        const env = envOf(request);
        const gone = await liftSuspension(env, String((request.params as any).uid));
        if (!gone) return reply.status(404).send({ status: 'error', error: 'NOT_FOUND', message: 'Aucune suspension en cours pour ce compte.' });
        await auditAction(env, adminOf(request), 'SUSPEND_LIFT', gone.email || gone.uid, null, {});
        return { status: 'success' };
      });

      api.get('/developers', async (request) => {
        const s = String((request.query as any)?.status ?? '').toUpperCase();
        return { status: 'success', requests: await listDeveloperRequests(['PENDING', 'APPROVED', 'REJECTED'].includes(s) ? s : null) };
      });
      api.post('/developers/:uid', async (request, reply) => {
        const b = (request.body ?? {}) as any;
        const admin = adminOf(request);
        try {
          const row = await decideDeveloperAccess(String((request.params as any).uid), b.approve === true, b.note, admin.email || admin.uid);
          await auditAction('production', admin, b.approve === true ? 'DEVELOPER_APPROVED' : 'DEVELOPER_REJECTED', row.email || row.uid, null, { project: row.project, note: b.note ?? null });
          return { status: 'success', request: row };
        } catch (e) {
          if (e instanceof ConnectError) return reply.status(e.statusCode).send({ status: 'error', error: e.code, message: e.message });
          throw e;
        }
      });

      api.get('/audit', async (request) => ({ status: 'success', audit: await listAudit(envOf(request), intParam((request.query as any)?.limit, 100, 500)) }));
    },
    { prefix: '/v1/admin-console' }
  );
}
