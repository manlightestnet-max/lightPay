/**
 * Activity journal end-to-end (HTTP only, simulator rail): every operation that reaches the
 * API shows up in the person's history with its state and the reason of a refusal.
 *   LW_URL=… LIGHTPAY_TEST_TOKEN_PRIVATE_KEY_FILE=… npx tsx test/activity.http.ts   (sandbox)
 */
import crypto from 'crypto';
import fs from 'fs';

const BASE = (process.env.LW_URL || 'http://localhost:8088').replace(/\/$/, '');
const PRIVATE_KEY = crypto.createPrivateKey(fs.readFileSync(process.env.LIGHTPAY_TEST_TOKEN_PRIVATE_KEY_FILE!, 'utf8'));
const RUN = Math.random().toString(36).slice(2, 8);
const ENV = 'sandbox';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const token = (uid: string, email: string, name: string) => {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${enc({ alg: 'RS256' })}.${enc({ iss: 'lightpay-test', aud: 'lightpay-test', sub: uid, email, name, iat: now, exp: now + 3600, auth_time: now })}`;
  return `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), PRIVATE_KEY).toString('base64url')}`;
};
const req = async (method: string, path: string, user?: string, body?: any, idem?: string) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(user ? { Authorization: `Bearer ${user}`, 'X-Environment': ENV } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(idem ? { 'Idempotency-Key': idem } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};
const activity = async (user: string) => (await req('GET', '/v1/me/activity?limit=50', user)).body.activity as any[];
const waitSession = async (id: string, until: (s: any) => boolean) => {
  for (let i = 0; i < 20; i++) {
    await sleep(800);
    const s = (await req('GET', `/v1/checkout/public/sessions/${id}`)).body.session;
    if (s && until(s)) return s;
  }
  return null;
};

async function main() {
  const aEmail = `act-a-${RUN}@test.lightpay`;
  const bEmail = `act-b-${RUN}@test.lightpay`;
  const a = token(`test-act-a-${RUN}`, aEmail, 'Awa Test');
  const b = token(`test-act-b-${RUN}`, bEmail, 'Bouka Test');
  await req('GET', '/v1/me', b);

  // 1. Top-up: the operator refuses, then a second attempt succeeds -> two lines.
  const dep = await req('POST', '/v1/me/deposits', a, { amount: 20000 }, `actdep${RUN}`);
  await req('POST', `/v1/checkout/public/sessions/${dep.body.session_id}/mobile-money`, undefined, { msisdn: '06 700 00 10', network: 'MTN_MOMO_COG' });
  await waitSession(dep.body.session_id, (s) => s.status === 'OPEN' && s.last_attempt?.status === 'FAILED');
  await req('POST', `/v1/checkout/public/sessions/${dep.body.session_id}/mobile-money`, undefined, { msisdn: '06 700 00 13', network: 'MTN_MOMO_COG' });
  await waitSession(dep.body.session_id, (s) => s.status === 'COMPLETED');
  let list = await activity(a);
  const deposits = list.filter((x) => x.kind === 'DEPOSIT');
  const refused = deposits.find((x) => x.status === 'FAILED');
  check('refused top-up recorded with the operator reason', refused?.reason_code === 'INSUFFICIENT_BALANCE' && /insuffisant/i.test(refused?.reason ?? ''), JSON.stringify(refused ?? {}).slice(0, 160));
  check('successful top-up recorded separately (20 000, 5 fee)', deposits.some((x) => x.status === 'SUCCEEDED' && x.amount === '20000' && x.fees === '5'), JSON.stringify(deposits.map((x) => x.status)));

  // 2. Transfers: unknown recipient, success on both sides, over the balance, double tap.
  await req('POST', '/v1/me/transfers', a, { to: `nobody-${RUN}@test.lightpay`, amount: 1000 }, `actghost${RUN}`);
  await req('POST', '/v1/me/transfers', a, { to: bEmail, amount: 5000, note: 'Test journal' }, `actsend${RUN}`);
  await req('POST', '/v1/me/transfers', a, { to: bEmail, amount: 5000, note: 'Test journal' }, `actsend${RUN}`);
  await req('POST', '/v1/me/transfers', a, { to: bEmail, amount: 90000 }, `actmuch${RUN}`);
  list = await activity(a);
  const transfers = list.filter((x) => x.kind === 'TRANSFER');
  check('unknown recipient refusal recorded', transfers.some((x) => x.status === 'FAILED' && x.reason_code === 'RECIPIENT_NOT_FOUND'));
  check('insufficient balance refusal recorded', transfers.some((x) => x.status === 'FAILED' && x.reason_code === 'INSUFFICIENT_FUNDS' && x.amount === '90000'));
  check('double tap = one transfer line', transfers.filter((x) => x.status === 'SUCCEEDED').length === 1);
  const bList = await activity(b);
  check('recipient sees the incoming transfer from the sender', bList.some((x) => x.kind === 'TRANSFER' && x.direction === 'IN' && x.status === 'SUCCEEDED' && x.amount === '5000' && x.counterparty === 'Awa Test'));

  // 3. Withdrawals: below the minimum (refused), then sent with fees.
  await req('POST', '/v1/me/withdrawals', a, { amount: 500, msisdn: '066000003', network: 'MTN_MOMO_COG' }, `actwd1${RUN}`);
  const wd = await req('POST', '/v1/me/withdrawals', a, { amount: 2000, msisdn: '066000003', network: 'MTN_MOMO_COG' }, `actwd2${RUN}`);
  list = await activity(a);
  check('withdrawal under the minimum recorded as refused', list.some((x) => x.kind === 'WITHDRAWAL' && x.status === 'FAILED' && x.reason_code === 'BELOW_MINIMUM'));
  const sent = list.find((x) => x.kind === 'WITHDRAWAL' && x.status === 'SUCCEEDED');
  check('withdrawal recorded: 2 000 + 5 fee = 2 005, masked number', wd.status === 200 && sent?.total === '2005' && sent?.fees === '5' && /•••/.test(sent?.counterparty ?? ''), JSON.stringify(sent ?? {}).slice(0, 160));

  // 4. Detail of one operation; someone else's operation is not reachable.
  const detail = await req('GET', `/v1/me/activity/${refused?.id}`, a);
  check('operation detail with state and reason', detail.body.activity?.status === 'FAILED' && Boolean(detail.body.activity?.reason));
  const foreign = await req('GET', `/v1/me/activity/${refused?.id}`, b);
  check("another person's operation is not visible", foreign.status === 404);
  check('newest first', new Date(list[0].created_at).getTime() >= new Date(list[list.length - 1].created_at).getTime());

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll activity checks passed');
}

main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(() => process.exit(failures ? 1 : 0));
