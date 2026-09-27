/**
 * LightPay end-to-end THROUGH THE HTTP API: accounts, Connect (OAuth code + PKCE), deposits,
 * charges, wallet and guest checkout, escrow, limits and revocation. Sandbox and production.
 *
 * The server must run with LIGHTPAY_TEST_TOKEN_PUBLIC_KEY (test identities, never in
 * production); this script signs tokens with the matching private key:
 *   LW_URL=… LW_TEST_KEY=sec_test_… LW_LIVE_KEY=sec_live_… LIGHTPAY_TEST_TOKEN_PRIVATE_KEY_FILE=… npx tsx test/connect.http.ts
 */
import crypto from 'crypto';
import fs from 'fs';

const BASE = (process.env.LW_URL || 'http://localhost:8080').replace(/\/$/, '');
const PRIVATE_KEY = crypto.createPrivateKey(fs.readFileSync(process.env.LIGHTPAY_TEST_TOKEN_PRIVATE_KEY_FILE!, 'utf8'));
const RUN = Math.random().toString(36).slice(2, 8);
const REDIRECT = 'http://localhost:3011/lightpay/callback';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A signed test identity (issuer "lightpay-test"), like a Firebase ID token. */
const userToken = (uid: string, email: string, name: string) => {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: 'lightpay-test', aud: 'lightpay-test', sub: uid, email, name, email_verified: true, iat: now, exp: now + 3600 })}`;
  return `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), PRIVATE_KEY).toString('base64url')}`;
};

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};

async function scenario(env: 'sandbox' | 'production', appKey: string) {
  console.log(`\n== ${env}`);
  const req = async (method: string, path: string, opts: { key?: string; user?: string; body?: any; idem?: string } = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}),
        ...(opts.user ? { Authorization: `Bearer ${opts.user}`, 'X-Environment': env } : {}),
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.idem ? { 'Idempotency-Key': opts.idem } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  const app = (method: string, path: string, body?: any, idem?: string) => req(method, path, { key: appKey, body, idem });
  const idem = (n: string) => `connect-${RUN}-${env}-${n}`;

  const merchant = userToken(`test-merchant-${RUN}`, `marchand-${RUN}@test.lightpay`, 'Marchand Test');
  const client = userToken(`test-client-${RUN}`, `client-${RUN}@test.lightpay`, 'Client Test');

  // 0. Accounts: signing in creates the person's wallet.
  const me = await req('GET', '/v1/me', { user: merchant });
  check('merchant signs in, wallet created at 0', me.status === 200 && me.body.wallet?.available_balance === '0', `${me.status} ${me.body.message ?? ''}`);
  const anon = await req('GET', '/v1/me');
  check('/v1/me needs a signed-in person', anon.status === 401);
  const forged = await req('GET', '/v1/me', { user: `${merchant.slice(0, -4)}AAAA` });
  check('forged token rejected', forged.status === 401);

  // 1. The app registers its return address.
  const uris = await app('PUT', '/v1/apps/redirect-uris', { redirect_uris: [REDIRECT, 'https://salacope.online/lightpay/callback'] });
  check('app registers redirect URIs', uris.status === 200, `${uris.status} ${uris.body.message ?? ''}`);

  // 2. Connect: consent -> code -> PKCE exchange (server side).
  const connect = async (user: string, scope: string, chargeLimit?: string) => {
    const { verifier, challenge } = pkce();
    const state = crypto.randomBytes(8).toString('hex');
    const pre = await req('GET', `/v1/checkout/public/authorize?${new URLSearchParams({ app_id: 'salacope', scope, redirect_uri: REDIRECT, code_challenge: challenge, environment: env })}`);
    const ok = await req('POST', '/v1/me/connect/approve', { user, body: { app_id: 'salacope', scope, redirect_uri: REDIRECT, state, code_challenge: challenge, charge_limit: chargeLimit } });
    const url = new URL(ok.body.redirect ?? 'http://x');
    const code = url.searchParams.get('code') ?? '';
    const token = await app('POST', '/v1/connect/token', { code, redirect_uri: REDIRECT, code_verifier: verifier });
    return { pre, ok, state: url.searchParams.get('state') === state, code, verifier, token };
  };

  const m = await connect(merchant, 'balance:read payee');
  check('consent screen data (app + scope labels)', m.pre.status === 200 && m.pre.body.app?.id === 'salacope' && m.pre.body.scopes?.length === 2, JSON.stringify(m.pre.body).slice(0, 100));
  check('merchant approves -> code sent back with state', Boolean(m.code) && m.state);
  check('app exchanges code -> merchant connection', m.token.status === 200 && m.token.body.connection?.id?.startsWith('conn_'), `${m.token.status} ${m.token.body.message ?? ''}`);
  const merchantConn = m.token.body.connection.id as string;
  const reuse = await app('POST', '/v1/connect/token', { code: m.code, redirect_uri: REDIRECT, code_verifier: m.verifier });
  check('a code works only once', reuse.status === 400 && reuse.body.error === 'INVALID_GRANT');

  const c = await connect(client, 'balance:read deposit charge', '50000');
  check('client connection with charge limit 50 000', c.token.body.connection?.charge_limit === '50000');
  const clientConn = c.token.body.connection.id as string;

  const badPkce = pkce();
  const approved = await req('POST', '/v1/me/connect/approve', { user: client, body: { app_id: 'salacope', scope: 'balance:read', redirect_uri: REDIRECT, code_challenge: badPkce.challenge } });
  const stolen = await app('POST', '/v1/connect/token', { code: new URL(approved.body.redirect).searchParams.get('code'), redirect_uri: REDIRECT, code_verifier: pkce().verifier });
  check('a stolen code without the PKCE verifier is useless', stolen.status === 400 && stolen.body.error === 'INVALID_GRANT');
  const evilRedirect = await req('POST', '/v1/me/connect/approve', { user: client, body: { app_id: 'salacope', scope: 'charge', redirect_uri: 'https://evil.example/cb', code_challenge: badPkce.challenge, charge_limit: '1' } });
  check('unregistered redirect refused', evilRedirect.status === 400 && evilRedirect.body.error === 'INVALID_REDIRECT_URI');
  // Re-approving 'balance:read' only narrowed the client's scopes: restore them.
  await connect(client, 'balance:read deposit charge', '50000');

  // 3. Deposit: the client tops up 60 000 by mobile money.
  const dep = await app('POST', `/v1/connections/${clientConn}/deposits`, { amount: 60000, return_url: 'https://salacope.online/compte/wallet' }, idem('dep'));
  check('deposit session created', dep.status === 201 && dep.body.session?.kind === 'DEPOSIT', `${dep.status} ${dep.body.message ?? ''}`);
  await req('POST', `/v1/checkout/public/sessions/${dep.body.session.id}/mobile-money`, { body: { msisdn: '06 444 55 63', network: 'MTN_MOMO_COG' } });
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    const s = (await req('GET', `/v1/checkout/public/sessions/${dep.body.session.id}`)).body.session;
    if (s?.status === 'COMPLETED') break;
  }
  let bal = (await app('GET', `/v1/connections/${clientConn}/balance`)).body.balance;
  check('client wallet credited 60 000 (read by the app, balance:read)', bal?.available_balance === '60000', JSON.stringify(bal));

  // 4. Charge within the limit, into escrow for the merchant.
  const ch = await app('POST', `/v1/connections/${clientConn}/charges`, { amount: 20000, fee_amount: 2000, payee: merchantConn, reference: `CH-${RUN}` }, idem('ch1'));
  check('charge 20 000 -> escrow hold', ch.status === 201 && ch.body.hold?.status === 'ACTIVE', `${ch.status} ${ch.body.message ?? ''}`);
  const over = await app('POST', `/v1/connections/${clientConn}/charges`, { amount: 50001, payee: merchantConn }, idem('ch2'));
  check('charge above the person’s limit refused', over.status === 403 && over.body.error === 'ABOVE_CHARGE_LIMIT');
  const noScope = await app('POST', `/v1/connections/${merchantConn}/charges`, { amount: 100, payee: merchantConn }, idem('ch3'));
  check('no "charge" scope -> refused', noScope.status === 403 && noScope.body.error === 'SCOPE_NOT_GRANTED');
  const noDeposit = await app('POST', `/v1/connections/${merchantConn}/deposits`, { amount: 100 }, idem('dep2'));
  check('no "deposit" scope -> refused', noDeposit.status === 403);
  let mw = (await req('GET', '/v1/me', { user: merchant })).body.wallet;
  check('merchant sees 20 000 locked', mw?.locked_balance === '20000' && mw?.available_balance === '0', `${mw?.available_balance}/${mw?.locked_balance}`);

  // 5. Checkout: the client pays 35 000 with the LightPay wallet.
  const session = (n: string, amount: number, fee = 0) =>
    app('POST', '/v1/checkout/sessions', { amount, fee_amount: fee, reference: `SC-${RUN}-${n}`, description: 'Commande test', payee: merchantConn, return_url: 'https://salacope.online/compte/achats' }, idem(`s${n}`));
  const s1 = await session('1', 35000, 3500);
  check('checkout session to a connected seller', s1.status === 201 && s1.body.session?.methods?.includes('lightpay_wallet'), `${s1.status} ${s1.body.message ?? ''}`);
  const paidWallet = await req('POST', `/v1/checkout/public/sessions/${s1.body.session.id}/wallet`, { user: client });
  check('client pays with the LightPay wallet', paidWallet.status === 200 && paidWallet.body.session?.status === 'COMPLETED', `${paidWallet.status} ${paidWallet.body.message ?? ''}`);
  bal = (await app('GET', `/v1/connections/${clientConn}/balance`)).body.balance;
  check('client balance 60 000 - 20 000 - 35 000 = 5 000', bal?.available_balance === '5000', bal?.available_balance);
  const s2 = await session('2', 35000);
  const poor = await req('POST', `/v1/checkout/public/sessions/${s2.body.session.id}/wallet`, { user: client });
  const reopened = (await req('GET', `/v1/checkout/public/sessions/${s2.body.session.id}`)).body.session;
  check('insufficient wallet -> 402 and the session stays payable', poor.status === 402 && reopened?.status === 'OPEN', `${poor.status} ${reopened?.status}`);
  const self = await req('POST', `/v1/checkout/public/sessions/${s2.body.session.id}/wallet`, { user: merchant });
  check('the seller cannot pay himself', self.status === 400 && self.body.error === 'SAME_WALLET');

  // 6. Guest (no account) pays the same session by mobile money.
  await req('POST', `/v1/checkout/public/sessions/${s2.body.session.id}/mobile-money`, { body: { msisdn: '05 321 77 45', network: 'AIRTEL_COG' } });
  let guestDone = false;
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    const s = (await req('GET', `/v1/checkout/public/sessions/${s2.body.session.id}`)).body.session;
    if (s?.status === 'COMPLETED') { guestDone = true; break; }
  }
  check('guest pays by mobile money', guestDone);
  mw = (await req('GET', '/v1/me', { user: merchant })).body.wallet;
  check('merchant locked = 20 000 + 35 000 + 35 000', mw?.locked_balance === '90000', mw?.locked_balance);

  // 7. Orders validated: capture everything to the merchant.
  const s1App = (await app('GET', `/v1/checkout/sessions/${s1.body.session.id}`)).body.session;
  const s2App = (await app('GET', `/v1/checkout/sessions/${s2.body.session.id}`)).body.session;
  const caps = await Promise.all([ch.body.hold.id, s1App.hold_id, s2App.hold_id].map((h, i) => app('POST', `/v1/holds/${h}/capture`, {}, idem(`cap${i}`))));
  mw = (await req('GET', '/v1/me', { user: merchant })).body.wallet;
  check('captures -> merchant 18 000 + 31 500 + 35 000 available', caps.every((r) => r.status === 201) && mw?.available_balance === '84500' && mw?.locked_balance === '0', `${mw?.available_balance}/${mw?.locked_balance}`);

  // 8. Revocation and closed routes.
  const list = await req('GET', '/v1/me/connections', { user: client });
  check('client sees Salacope in authorized apps', list.body.connections?.some((x: any) => x.id === clientConn && x.status === 'ACTIVE'));
  await req('DELETE', `/v1/me/connections/${clientConn}`, { user: client });
  const afterRevoke = await app('POST', `/v1/connections/${clientConn}/charges`, { amount: 100, payee: merchantConn }, idem('ch4'));
  check('after revocation the app can no longer charge', afterRevoke.status === 403 && afterRevoke.body.error === 'CONNECTION_REVOKED');
  const noBalance = await app('GET', `/v1/connections/${clientConn}/balance`);
  check('…nor read the balance', noBalance.status === 403);
  const legacy = await app('POST', '/v1/merchant/collections/charge-user', { user_account_id: `user:test-client-${RUN}`, amount: 100 }, idem('legacy'));
  check('direct charge-user closed (410)', legacy.status === 410);
}

async function main() {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`LightWallet not reachable at ${BASE}`);
  if (process.env.LW_TEST_KEY) await scenario('sandbox', process.env.LW_TEST_KEY);
  if (process.env.LW_LIVE_KEY) await scenario('production', process.env.LW_LIVE_KEY);
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll LightPay checks passed');
}

main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(() => process.exit(failures ? 1 : 0));
