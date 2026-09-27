/**
 * LightPay account space end-to-end THROUGH THE HTTP API: self deposit, send to another
 * user, withdraw to mobile money, recent sign-in, permissions, account closure.
 *   LW_URL=… LW_TEST_KEY=… [LW_LIVE_KEY=…] LIGHTPAY_TEST_TOKEN_PRIVATE_KEY_FILE=… npx tsx test/account.http.ts
 * (server started with LIGHTPAY_TEST_TOKEN_PUBLIC_KEY, simulator rail)
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

const userToken = (uid: string, email: string, name: string, signedInSecondsAgo = 0) => {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: 'lightpay-test', aud: 'lightpay-test', sub: uid, email, name, email_verified: true, iat: now, exp: now + 3600, auth_time: now - signedInSecondsAgo })}`;
  return `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), PRIVATE_KEY).toString('base64url')}`;
};

async function scenario(env: 'sandbox' | 'production', appKey: string) {
  console.log(`\n== ${env}`);
  const req = async (method: string, path: string, o: { user?: string; key?: string; body?: any; idem?: string } = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(o.user ? { Authorization: `Bearer ${o.user}`, 'X-Environment': env } : {}),
        ...(o.key ? { Authorization: `Bearer ${o.key}` } : {}),
        ...(o.body ? { 'Content-Type': 'application/json' } : {}),
        ...(o.idem ? { 'Idempotency-Key': o.idem } : {}),
      },
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  const key = (n: string) => `acct${RUN}${env}${n}`;
  const aEmail = `alice-${RUN}@test.lightpay`;
  const bEmail = `bruno-${RUN}@test.lightpay`;
  const alice = userToken(`test-alice-${RUN}`, aEmail, 'Alice Test');
  const aliceOld = userToken(`test-alice-${RUN}`, aEmail, 'Alice Test', 3600);
  const bruno = userToken(`test-bruno-${RUN}`, bEmail, 'Bruno Test');
  const balanceOf = async (u: string) => (await req('GET', '/v1/me', { user: u })).body.wallet;
  await balanceOf(bruno); // Bruno has an account (wallet created at sign-in)

  // 1. Self top-up by mobile money.
  const dep = await req('POST', '/v1/me/deposits', { user: alice, body: { amount: 50000 }, idem: key('dep') });
  check('self deposit -> hosted payment page', dep.status === 200 && /^\/pay\/cs_/.test(dep.body.checkout_path ?? ''), `${dep.status} ${dep.body.message ?? ''}`);
  const sid = dep.body.session_id;
  await req('POST', `/v1/checkout/public/sessions/${sid}/mobile-money`, { body: { msisdn: '06 700 00 03', network: 'MTN_MOMO_COG' } });
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    if ((await req('GET', `/v1/checkout/public/sessions/${sid}`)).body.session?.status === 'COMPLETED') break;
  }
  check('wallet credited 50 000', (await balanceOf(alice))?.available_balance === '50000');

  // 2. Send to another LightPay user.
  const noIdem = await req('POST', '/v1/me/transfers', { user: alice, body: { to: bEmail, amount: 1000 } });
  check('money moves need an Idempotency-Key', noIdem.status === 400);
  const old = await req('POST', '/v1/me/transfers', { user: aliceOld, body: { to: bEmail, amount: 1000 }, idem: key('old') });
  check('old sign-in -> password confirmation required', old.status === 401 && old.body.error === 'RECENT_SIGN_IN_REQUIRED');
  const sent = await req('POST', '/v1/me/transfers', { user: alice, body: { to: bEmail, amount: 12000, note: 'Loyer' }, idem: key('send') });
  const replay = await req('POST', '/v1/me/transfers', { user: alice, body: { to: bEmail, amount: 12000, note: 'Loyer' }, idem: key('send') });
  check('send 12 000 to Bruno', sent.status === 200 && sent.body.transfer?.to?.email === bEmail, `${sent.status} ${sent.body.message ?? ''}`);
  check('double tap does not send twice', replay.body.transfer?.duplicate === true && (await balanceOf(bruno))?.available_balance === '12000');
  const ghost = await req('POST', '/v1/me/transfers', { user: alice, body: { to: `nobody-${RUN}@test.lightpay`, amount: 100 }, idem: key('ghost') });
  check('unknown recipient refused', ghost.status === 404);
  const selfSend = await req('POST', '/v1/me/transfers', { user: alice, body: { to: aEmail, amount: 100 }, idem: key('self') });
  check('cannot send to oneself', selfSend.status === 400);

  // 3. Withdraw to mobile money.
  const small = await req('POST', '/v1/me/withdrawals', { user: alice, body: { amount: 100, msisdn: '066000003', network: 'AIRTEL_COG' }, idem: key('small') });
  check('withdrawal minimum 1 000', small.status === 400 && small.body.error === 'BELOW_MINIMUM');
  const wq = await req('GET', '/v1/me/withdrawals/quote?amount=8000&network=MTN_MOMO_COG', { user: alice });
  check('withdrawal quote: 8 000 received, 0 operator + 5 LightPay = 8 005 debited', wq.body.quote?.amount === '8000' && wq.body.quote?.operator_fee === '0' && wq.body.quote?.lightpay_fee === '5' && wq.body.quote?.total === '8005' && wq.body.quote?.minimum === '1000', JSON.stringify(wq.body.quote));
  const dq = await req('GET', '/v1/me/deposits/quote?amount=5000', { user: alice });
  check('deposit quote per operator: 5 000 + 5 LightPay', dq.body.quotes?.MTN_MOMO_COG?.total === '5005' && dq.body.quotes?.AIRTEL_COG?.lightpay_fee === '5', JSON.stringify(dq.body.quotes?.MTN_MOMO_COG));
  const badQuote = await req('GET', '/v1/me/withdrawals/quote?amount=abc&network=MTN_MOMO_COG', { user: alice });
  check('invalid quote request refused', badQuote.status === 400);
  const wd = await req('POST', '/v1/me/withdrawals', { user: alice, body: { amount: 8000, msisdn: '06 600 00 03', network: 'MTN_MOMO_COG' }, idem: key('wd') });
  check('withdraw 8 000 -> sent, fees shown', wd.status === 200 && wd.body.withdrawal?.status === 'SUCCEEDED' && wd.body.withdrawal?.total === '8005' && wd.body.withdrawal?.lightpay_fee === '5' && !JSON.stringify(wd.body).includes('66000003'), `${wd.status} ${wd.body.message ?? ''}`);
  check('balance 50 000 - 12 000 - 8 005 = 29 995', (await balanceOf(alice))?.available_balance === '29995');
  const tooMuch = await req('POST', '/v1/me/withdrawals', { user: alice, body: { amount: 29991, msisdn: '066000003', network: 'MTN_MOMO_COG' }, idem: key('much') });
  check('cannot withdraw more than available, fees included', tooMuch.status === 402 && /frais/.test(tooMuch.body.message ?? ''), tooMuch.body.message);
  const list = await req('GET', '/v1/me/withdrawals', { user: alice });
  check('withdrawal history', list.body.withdrawals?.length === 1);

  // 4. Locked money cannot be withdrawn: Alice sells to Bruno through Salacope (escrow).
  await req('PUT', '/v1/apps/redirect-uris', { key: appKey, body: { redirect_uris: [REDIRECT, 'https://salacope.online/lightpay/callback'] } });
  const connect = async (user: string, scope: string, limit?: string) => {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const ok = await req('POST', '/v1/me/connect/approve', { user, body: { app_id: 'salacope', scope, redirect_uri: REDIRECT, code_challenge: challenge, charge_limit: limit } });
    const code = new URL(ok.body.redirect).searchParams.get('code');
    return (await req('POST', '/v1/connect/token', { key: appKey, body: { code, redirect_uri: REDIRECT, code_verifier: verifier } })).body.connection;
  };
  const aliceConn = await connect(alice, 'balance:read payee');
  const brunoConn = await connect(bruno, 'balance:read charge deposit', '20000');
  const held = await req('POST', `/v1/connections/${brunoConn.id}/charges`, { key: appKey, body: { amount: 10000, payee: aliceConn.id }, idem: key('charge') });
  let w = await balanceOf(alice);
  check('Alice has 10 000 locked from a sale', held.status === 201 && w?.locked_balance === '10000', `${held.status} ${w?.locked_balance}`);
  const lockedOut = await req('POST', '/v1/me/withdrawals', { user: alice, body: { amount: 35000, msisdn: '066000003', network: 'MTN_MOMO_COG' }, idem: key('locked') });
  check('locked money cannot be withdrawn', lockedOut.status === 402);

  // 5. Permissions: remove a scope, change the limit.
  const narrowed = await req('PATCH', `/v1/me/connections/${brunoConn.id}`, { user: bruno, body: { scopes: ['charge'] } });
  check('Bruno removes balance:read and deposit', narrowed.status === 200 && narrowed.body.connection?.scopes?.join() === 'charge');
  const noRead = await req('GET', `/v1/connections/${brunoConn.id}/balance`, { key: appKey });
  check('…the app can no longer read his balance', noRead.status === 403);
  const widen = await req('PATCH', `/v1/me/connections/${brunoConn.id}`, { user: bruno, body: { scopes: ['charge', 'payee'] } });
  check('scopes cannot be added from here', widen.status === 400);
  await req('PATCH', `/v1/me/connections/${brunoConn.id}`, { user: bruno, body: { charge_limit: 500 } });
  const overLimit = await req('POST', `/v1/connections/${brunoConn.id}/charges`, { key: appKey, body: { amount: 501, payee: aliceConn.id }, idem: key('charge2') });
  check('new limit 500 enforced', overLimit.status === 403 && overLimit.body.error === 'ABOVE_CHARGE_LIMIT');

  // 6. Close the account: refused while money is left, then allowed.
  const refused = await req('DELETE', '/v1/me', { user: alice });
  check('closing refused while money is left', refused.status === 409);
  await req('POST', `/v1/holds/${held.body.hold.id}/release`, { key: appKey, idem: key('release') });
  await req('POST', '/v1/me/withdrawals', { user: alice, body: { amount: 29990, msisdn: '066000003', network: 'MTN_MOMO_COG' }, idem: key('empty') });
  w = await balanceOf(alice);
  check('Alice at zero after refund of the sale and a withdrawal', w?.available_balance === '0' && w?.locked_balance === '0', `${w?.available_balance}/${w?.locked_balance}`);
  const oldClose = await req('DELETE', '/v1/me', { user: aliceOld });
  check('closing needs a recent sign-in', oldClose.status === 401);
  const closed = await req('DELETE', '/v1/me', { user: alice });
  check('account closed', closed.status === 200 && closed.body.closed === true, `${closed.status} ${closed.body.message ?? ''}`);
  const afterClose = await req('POST', '/v1/me/deposits', { user: alice, body: { amount: 1000 }, idem: key('after') });
  check('a closed account cannot receive or move money', afterClose.status === 403 && afterClose.body.error === 'ACCOUNT_CLOSED');
  const appAfter = await req('GET', `/v1/connections/${aliceConn.id}`, { key: appKey });
  check('apps lost access to the closed account', appAfter.status === 403);
  const toClosed = await req('POST', '/v1/me/transfers', { user: bruno, body: { to: aEmail, amount: 100 }, idem: key('toClosed') });
  check('nobody can send to a closed account', toClosed.status === 404);
}

async function main() {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`LightWallet not reachable at ${BASE}`);
  if (process.env.LW_TEST_KEY) await scenario('sandbox', process.env.LW_TEST_KEY);
  if (process.env.LW_LIVE_KEY) await scenario('production', process.env.LW_LIVE_KEY);
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll account checks passed');
}

main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(() => process.exit(failures ? 1 : 0));
