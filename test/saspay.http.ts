/**
 * SasPay integration end-to-end, against the local fake SasPay (test/fake-saspay.ts).
 * LightWallet must run with MOBILE_MONEY_ROUTES=MTN_MOMO_COG=saspay,AIRTEL_COG=saspay,
 * SASPAY_API_URL=<fake>/api/v1, SASPAY_SECRET_KEY, SASPAY_WEBHOOK_SECRET and test identities.
 *   LW_URL=… FAKE_URL=… LW_TEST_KEY=sec_test_… LIGHTPAY_TEST_TOKEN_PRIVATE_KEY_FILE=… npx tsx test/saspay.http.ts
 */
import crypto from 'crypto';
import fs from 'fs';

const BASE = (process.env.LW_URL || 'http://localhost:8088').replace(/\/$/, '');
const FAKE = (process.env.FAKE_URL || 'http://localhost:8099').replace(/\/$/, '');
const APP_KEY = process.env.LW_TEST_KEY!;
const PRIVATE_KEY = crypto.createPrivateKey(fs.readFileSync(process.env.LIGHTPAY_TEST_TOKEN_PRIVATE_KEY_FILE!, 'utf8'));
const RUN = Math.random().toString(36).slice(2, 8);
const REDIRECT = 'http://localhost:3011/lightpay/callback';
const env = 'sandbox';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const userToken = (uid: string, email: string) => {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${enc({ alg: 'RS256' })}.${enc({ iss: 'lightpay-test', aud: 'lightpay-test', sub: uid, email, name: uid, iat: now, exp: now + 3600, auth_time: now })}`;
  return `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), PRIVATE_KEY).toString('base64url')}`;
};
const req = async (method: string, path: string, o: { user?: string; key?: string; body?: any; idem?: string; headers?: Record<string, string> } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(o.user ? { Authorization: `Bearer ${o.user}`, 'X-Environment': env } : {}),
      ...(o.key ? { Authorization: `Bearer ${o.key}` } : {}),
      ...(o.body ? { 'Content-Type': 'application/json' } : {}),
      ...(o.idem ? { 'Idempotency-Key': o.idem } : {}),
      ...(o.headers ?? {}),
    },
    body: o.body ? (typeof o.body === 'string' ? o.body : JSON.stringify(o.body)) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};
const waitSession = async (id: string, until: (s: any) => boolean) => {
  for (let i = 0; i < 20; i++) {
    await sleep(700);
    const s = (await req('GET', `/v1/checkout/public/sessions/${id}`)).body.session;
    if (s && until(s)) return s;
  }
  return (await req('GET', `/v1/checkout/public/sessions/${id}`)).body.session;
};

async function main() {
  // Seller connected with "payee".
  const merchant = userToken(`test-sas-merchant-${RUN}`, `sas-merchant-${RUN}@test.lightpay`);
  await req('GET', '/v1/me', { user: merchant });
  await req('PUT', '/v1/apps/redirect-uris', { key: APP_KEY, body: { redirect_uris: [REDIRECT] } });
  const verifier = crypto.randomBytes(32).toString('base64url');
  const approve = await req('POST', '/v1/me/connect/approve', {
    user: merchant,
    body: { app_id: 'salacope', scope: 'payee', redirect_uri: REDIRECT, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url') },
  });
  const conn = (await req('POST', '/v1/connect/token', { key: APP_KEY, body: { code: new URL(approve.body.redirect).searchParams.get('code'), redirect_uri: REDIRECT, code_verifier: verifier } })).body.connection;
  check('seller connected', Boolean(conn?.id));

  // 1. Guest pays 35 000 by MTN through SasPay; SasPay's webhook completes it.
  const s1 = await req('POST', '/v1/checkout/sessions', { key: APP_KEY, body: { amount: 35000, payee: conn.id, reference: `SAS-${RUN}-1` }, idem: `sas-${RUN}-1` });
  const start = await req('POST', `/v1/checkout/public/sessions/${s1.body.session.id}/mobile-money`, { body: { msisdn: '06 555 12 33', network: 'MTN_MOMO_COG' } });
  check('collection pushed to SasPay', start.status === 200 && start.body.attempt?.status === 'PENDING', `${start.status} ${start.body.message ?? ''}`);
  const done = await waitSession(s1.body.session.id, (s) => s.status === 'COMPLETED');
  check('SasPay SUCCESS -> session COMPLETED, funds locked for the seller', done?.status === 'COMPLETED');
  const requests = (await (await fetch(`${FAKE}/_requests`)).json()) as any[];
  const softpay = requests.find((r) => r.url === '/api/v1/payments/softpay/' && r.body.customer?.phone === '242065551233');
  check('request body matches SasPay: CG / mtn_cg / "35000.00" / XAF / ADD_ON',
    softpay?.body.country === 'CG' && softpay?.body.network === 'mtn_cg' && softpay?.body.amount === '35000.00' && softpay?.body.currency === 'XAF' && softpay?.body.fee_charge_mode === 'ADD_ON',
    JSON.stringify(softpay?.body ?? {}).slice(0, 160));
  check('Idempotency-Key sent as a UUID', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(softpay?.idempotencyKey ?? ''), softpay?.idempotencyKey);
  check('SasPay was asked to verify (payload never trusted alone)', requests.some((r) => /\/payments\/.+\/verify\/$/.test(r.url)));

  // 2. Refused by SasPay -> the session reopens.
  const s2 = await req('POST', '/v1/checkout/sessions', { key: APP_KEY, body: { amount: 5000, payee: conn.id }, idem: `sas-${RUN}-2` });
  await req('POST', `/v1/checkout/public/sessions/${s2.body.session.id}/mobile-money`, { body: { msisdn: '05 555 12 30', network: 'AIRTEL_COG' } });
  const reopened = await waitSession(s2.body.session.id, (s) => s.status === 'OPEN' && s.last_attempt?.status === 'FAILED');
  check('SasPay FAILED (Airtel) -> payable again', reopened?.status === 'OPEN' && reopened?.last_attempt?.failure_code?.startsWith('PROVIDER_'), JSON.stringify(reopened?.last_attempt));
  const airtel = ((await (await fetch(`${FAKE}/_requests`)).json()) as any[]).find((r) => r.body?.customer?.phone === '242055551230');
  check('Airtel routed as airtel_cg', airtel?.body.network === 'airtel_cg');

  // 3. Forged webhook refused.
  const forged = await req('POST', '/v1/providers/saspay/webhook', {
    body: JSON.stringify({ event: 'transaction.success', data: { id: crypto.randomUUID() } }),
    headers: { 'X-Webhook-Signature': 'a'.repeat(64), 'X-Webhook-Timestamp': String(Math.floor(Date.now() / 1000)) },
  });
  check('forged SasPay webhook rejected', forged.status === 401);

  // 4. Withdrawals: one fails at SasPay (money restored), one succeeds.
  const user = userToken(`test-sas-user-${RUN}`, `sas-user-${RUN}@test.lightpay`);
  const dep = await req('POST', '/v1/me/deposits', { user, body: { amount: 20000 }, idem: `sasdep${RUN}` });
  await req('POST', `/v1/checkout/public/sessions/${dep.body.session_id}/mobile-money`, { body: { msisdn: '06 555 00 03', network: 'MTN_MOMO_COG' } });
  await waitSession(dep.body.session_id, (s) => s.status === 'COMPLETED');
  const w0 = (await req('GET', '/v1/me', { user })).body.wallet;
  check('deposit via SasPay credited 20 000', w0?.available_balance === '20000', w0?.available_balance);

  const bad = await req('POST', '/v1/me/withdrawals', { user, body: { amount: 7000, msisdn: '06 555 00 09', network: 'MTN_MOMO_COG' }, idem: `saswd1${RUN}` });
  check('withdrawal sent, PENDING at SasPay', bad.body.withdrawal?.status === 'PENDING', `${bad.status} ${JSON.stringify(bad.body).slice(0, 120)}`);
  check('amount leaves the wallet while pending', (await req('GET', '/v1/me', { user })).body.wallet?.available_balance === '13000');
  let restored = false;
  for (let i = 0; i < 20 && !restored; i++) {
    await sleep(700);
    restored = (await req('GET', '/v1/me', { user })).body.wallet?.available_balance === '20000';
  }
  check('SasPay FAILED payout -> 7 000 restored to the wallet', restored);
  const good = await req('POST', '/v1/me/withdrawals', { user, body: { amount: 5000, msisdn: '06 555 00 04', network: 'MTN_MOMO_COG' }, idem: `saswd2${RUN}` });
  let succeeded = false;
  for (let i = 0; i < 20 && !succeeded; i++) {
    await sleep(700);
    succeeded = (await req('GET', '/v1/me/withdrawals', { user })).body.withdrawals?.some((w: any) => w.id === good.body.withdrawal?.id && w.status === 'SUCCEEDED');
  }
  check('SasPay SUCCESS payout -> withdrawal SUCCEEDED, balance 15 000', succeeded && (await req('GET', '/v1/me', { user })).body.wallet?.available_balance === '15000');
  const payoutReq = ((await (await fetch(`${FAKE}/_requests`)).json()) as any[]).find((r) => r.url === '/api/v1/payouts/initialize/' && r.body.recipient?.msisdn === '242065550004');
  check('payout body: CG / method mtn_cg / DEDUCTED fee', payoutReq?.body.method === 'mtn_cg' && payoutReq?.body.country === 'CG' && payoutReq?.body.fee_charge_mode === 'DEDUCTED');

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll SasPay checks passed');
}

main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(() => process.exit(failures ? 1 : 0));
