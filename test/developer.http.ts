/**
 * Developer space end-to-end (HTTP only): an account creates an app, manages it, and nobody
 * else can see or change it.
 *   LW_URL=… LIGHTPAY_TEST_TOKEN_PRIVATE_KEY_FILE=… npx tsx test/developer.http.ts
 * Uses one fixed test app id per owner run (`devtest-<run>`), in both databases.
 */
import crypto from 'crypto';
import fs from 'fs';

const BASE = (process.env.LW_URL || 'http://localhost:8088').replace(/\/$/, '');
const PRIVATE_KEY = crypto.createPrivateKey(fs.readFileSync(process.env.LIGHTPAY_TEST_TOKEN_PRIVATE_KEY_FILE!, 'utf8'));
const RUN = Math.random().toString(36).slice(2, 8);

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};
const token = (uid: string, email: string, authAgo = 0) => {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${enc({ alg: 'RS256' })}.${enc({ iss: 'lightpay-test', aud: 'lightpay-test', sub: uid, email, name: 'Dev Test', iat: now, exp: now + 3600, auth_time: now - authAgo })}`;
  return `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), PRIVATE_KEY).toString('base64url')}`;
};
const req = async (method: string, path: string, user: string, body?: any, env = 'sandbox') => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${user}`, 'X-Environment': env, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};

async function main() {
  const owner = token(`test-dev-${RUN}`, `dev-${RUN}@test.lightpay`);
  const stale = token(`test-dev-${RUN}`, `dev-${RUN}@test.lightpay`, 3600);
  const other = token(`test-other-${RUN}`, `other-${RUN}@test.lightpay`);
  const appId = `devtest-${RUN}`;

  check('new account has no app', (await req('GET', '/v1/me/developer/apps', owner)).body.apps?.length === 0);
  check('creating needs a recent sign-in', (await req('POST', '/v1/me/developer/apps', stale, { id: appId, name: 'Dev test' })).status === 401);
  check('reserved id refused', (await req('POST', '/v1/me/developer/apps', owner, { id: 'mainapp', name: 'Nope' })).status === 403);

  const created = await req('POST', '/v1/me/developer/apps', owner, { id: appId, name: 'Dev test' });
  const keys = created.body.keys ?? {};
  check('app created, keys shown once', created.status === 201 && /^sec_test_/.test(keys.test_api_key) && /^sec_live_/.test(keys.live_api_key) && /^whsec_/.test(keys.webhook_secret));
  check('key hints stored', created.body.app?.test_key_hint === keys.test_api_key?.slice(-4));
  check('id already taken', (await req('POST', '/v1/me/developer/apps', owner, { id: appId, name: 'Again' })).status === 409);

  check('another account cannot read it', (await req('GET', `/v1/me/developer/apps/${appId}`, other)).status === 404);
  check('another account cannot change it', (await req('PATCH', `/v1/me/developer/apps/${appId}`, other, { name: 'Pwned' })).status === 404);
  check('another account cannot claim it with a wrong key', (await req('POST', '/v1/me/developer/apps/claim', other, { secret_key: `sec_test_${'0'.repeat(48)}` })).status === 404);
  check('owned app cannot be claimed by someone else', (await req('POST', '/v1/me/developer/apps/claim', other, { secret_key: keys.test_api_key })).status === 409);

  check('webhook must be https', (await req('PATCH', `/v1/me/developer/apps/${appId}`, owner, { webhook_url: 'http://example.com/hook' })).status === 400);
  const hook = await req('PATCH', `/v1/me/developer/apps/${appId}`, owner, { webhook_url: 'https://example.com/lightpay-hook', name: 'Dev test renamed' });
  check('webhook and name saved', hook.body.app?.webhook_url === 'https://example.com/lightpay-hook' && hook.body.app?.name === 'Dev test renamed');
  const redirects = await req('PATCH', `/v1/me/developer/apps/${appId}`, owner, { redirect_uris: ['https://example.com/cb'] });
  check('redirect URIs saved', redirects.body.app?.redirect_uris?.[0] === 'https://example.com/cb');

  // The test key works on the merchant API, then stops working after rotation.
  const ping = async (key: string) => (await fetch(`${BASE}/v1/merchant/balance`, { headers: { Authorization: `Bearer ${key}` } })).status;
  check('test key authenticates', (await ping(keys.test_api_key)) === 200);
  const rotated = await req('POST', `/v1/me/developer/apps/${appId}/rotate-keys`, owner, {});
  check('rotation returns new keys', rotated.status === 200 && rotated.body.keys?.test_api_key !== keys.test_api_key);
  check('old key refused after rotation', [401, 403].includes(await ping(keys.test_api_key)));
  check('new key authenticates', (await ping(rotated.body.keys.test_api_key)) === 200);

  const overview = await req('GET', `/v1/me/developer/apps/${appId}/overview`, owner);
  check('overview (sandbox)', overview.status === 200 && overview.body.environment === 'sandbox' && typeof overview.body.last_30_days?.completed === 'number', JSON.stringify(overview.body).slice(0, 160));
  check('sessions list', Array.isArray((await req('GET', `/v1/me/developer/apps/${appId}/sessions`, owner)).body.sessions));
  const test = await req('POST', `/v1/me/developer/apps/${appId}/webhooks/test`, owner, {});
  check('test webhook sent', test.status === 200);
  await new Promise((r) => setTimeout(r, 1500));
  const hooks = await req('GET', `/v1/me/developer/apps/${appId}/webhooks`, owner);
  check('delivery logged', hooks.body.deliveries?.some((d: any) => d.event === 'ping'), JSON.stringify(hooks.body.deliveries?.[0] ?? {}).slice(0, 120));

  check('old public registration closed', (await fetch(`${BASE}/v1/merchant/apps/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: `x-${RUN}`, name: 'x' }) })).status === 410);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll developer checks passed');
}

main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(() => process.exit(failures ? 1 : 0));
