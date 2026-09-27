/**
 * Checkout end-to-end THROUGH THE HTTP API only (no direct DB access), like a real app.
 * Runs the same scenario in sandbox and in production (both with the simulator rail).
 *
 *   LW_URL=http://localhost:8080 LW_TEST_KEY=sec_test_… LW_LIVE_KEY=sec_live_… npx tsx test/checkout.http.ts
 *
 * Simulator numbers: …0 insufficient balance, …1 declined, …2 timeout, other = paid.
 */
const BASE = (process.env.LW_URL || 'http://localhost:8080').replace(/\/$/, '');
const RUN = Math.random().toString(36).slice(2, 8);

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function scenario(label: string, key: string) {
  console.log(`\n== ${label}`);
  const call = async (method: string, path: string, body?: any, idem?: string) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(idem ? { 'Idempotency-Key': idem } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  const pub = async (method: string, path: string, body?: any) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  const payUntil = async (sessionId: string, msisdn: string, network = 'MTN_MOMO_COG') => {
    const started = await pub('POST', `/v1/checkout/public/sessions/${sessionId}/mobile-money`, { msisdn, network });
    if (started.status !== 200) return { started, final: null as any };
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      const s = (await pub('GET', `/v1/checkout/public/sessions/${sessionId}`)).body.session;
      if (s && s.status !== 'PROCESSING') return { started, final: s };
    }
    return { started, final: null as any };
  };
  const newSession = (n: string, amount: number, fee: number) =>
    call('POST', '/v1/checkout/sessions', {
      amount, fee_amount: fee, currency: 'XAF', reference: `TEST-${RUN}-${n}`, description: 'Test de bout en bout',
      payee: `seller-${RUN}`, methods: ['mobile_money'], return_url: 'https://salacope.online/compte/achats',
    }, `test-${RUN}-${label}-${n}`);

  // Seller.
  const payee = await call('PUT', `/v1/payees/seller-${RUN}`, { display_name: 'Vendeur de test' });
  check('payee created', payee.status === 200 && payee.body.payee?.locked_balance === '0', JSON.stringify(payee.body).slice(0, 120));

  // 1. Session + hosted page + idempotency.
  const s1 = await newSession('1', 35000, 3500);
  check('session created with a checkout_url', s1.status === 201 && /\/pay\/cs_/.test(s1.body.session?.checkout_url ?? ''), `${s1.status} ${s1.body.message ?? ''}`);
  const again = await newSession('1', 35000, 3500);
  check('same Idempotency-Key returns the same session', again.body.session?.id === s1.body.session?.id && again.body.duplicate === true);
  const html = await fetch(s1.body.session.checkout_url);
  check('hosted payment page served', html.status === 200 && (await html.text()).includes('LightPay'));

  // 2. Failed then successful mobile money.
  const failed = await payUntil(s1.body.session.id, '06 512 44 80');
  check('insufficient balance -> session reopens', failed.final?.status === 'OPEN' && failed.final?.last_attempt?.failure_code === 'INSUFFICIENT_BALANCE', JSON.stringify(failed.final?.last_attempt));
  const paid = await payUntil(s1.body.session.id, '06 512 44 83');
  check('payment confirmed -> session COMPLETED', paid.final?.status === 'COMPLETED', paid.final?.status);
  check('page never shows the full number', !JSON.stringify(paid.final).includes('512448'));
  const s1App = (await call('GET', `/v1/checkout/sessions/${s1.body.session.id}`)).body.session;
  check('app sees the hold', Boolean(s1App?.hold_id));
  let seller = (await call('GET', `/v1/payees/seller-${RUN}`)).body.payee;
  check('seller sees 35 000 locked, 0 available', seller?.locked_balance === '35000' && seller?.available_balance === '0', `${seller?.available_balance}/${seller?.locked_balance}`);

  // 3. A guest wallet cannot be spent through the public API.
  const steal = await call('POST', '/v1/payments/transfer', { from_wallet_id: s1App.payer.wallet_id, to_wallet_id: seller.wallet_id, amount: 100, currency: 'XAF' }, `steal-${RUN}-${label}`);
  check('guest wallet cannot be debited by an app', steal.status >= 400 && JSON.stringify(steal.body).includes('GUEST_WALLET_LOCKED'), `${steal.status} ${steal.body.message ?? steal.body.error ?? ''}`.slice(0, 110));
  const pay2 = await pub('POST', `/v1/checkout/public/sessions/${s1.body.session.id}/mobile-money`, { msisdn: '065124483', network: 'MTN_MOMO_COG' });
  check('a completed session cannot be paid twice', pay2.status === 409);

  // 4. Capture: seller paid minus the fee.
  const cap = await call('POST', `/v1/holds/${s1App.hold_id}/capture`, {}, `cap-${RUN}-${label}`);
  seller = (await call('GET', `/v1/payees/seller-${RUN}`)).body.payee;
  check('capture -> seller 31 500 available', cap.status === 201 && seller?.available_balance === '31500' && seller?.locked_balance === '0', `${cap.status} ${seller?.available_balance}/${seller?.locked_balance}`);

  // 5. Refund of a guest goes back to the same number.
  const s2 = await newSession('2', 20000, 0);
  const paid2 = await payUntil(s2.body.session.id, '05 700 11 25', 'AIRTEL_COG');
  const s2App = (await call('GET', `/v1/checkout/sessions/${s2.body.session.id}`)).body.session;
  const rel = await call('POST', `/v1/holds/${s2App?.hold_id}/release`, {}, `rel-${RUN}-${label}`);
  check('release refunds the guest by mobile money', paid2.final?.status === 'COMPLETED' && rel.status === 201 && rel.body.refund?.status === 'SUCCEEDED' && rel.body.refund?.msisdn === '242057001125', `${rel.status} ${rel.body.refund?.status}`);
  seller = (await call('GET', `/v1/payees/seller-${RUN}`)).body.payee;
  check('seller lock back to 0 after refund', seller?.locked_balance === '0');

  // 6. Dispute freezes; only a resolution settles.
  const s3 = await newSession('3', 10000, 0);
  await payUntil(s3.body.session.id, '06 900 00 07');
  const s3App = (await call('GET', `/v1/checkout/sessions/${s3.body.session.id}`)).body.session;
  await call('POST', `/v1/holds/${s3App?.hold_id}/dispute`, { reason: 'Travail non conforme' });
  const blocked = await call('POST', `/v1/holds/${s3App?.hold_id}/capture`, {}, `cap3-${RUN}-${label}`);
  check('disputed hold cannot be captured', blocked.status === 409 && blocked.body.error === 'HOLD_DISPUTED');
  const resolved = await call('POST', `/v1/holds/${s3App?.hold_id}/release`, { resolve_dispute: true }, `rel3-${RUN}-${label}`);
  check('dispute resolved by refund', resolved.body.hold?.status === 'RELEASED' && resolved.body.refund?.status === 'SUCCEEDED');

  // 7. Wrong key cannot read another app's session.
  const foreign = await fetch(`${BASE}/v1/checkout/sessions/${s1.body.session.id}`, { headers: { Authorization: 'Bearer sec_test_invalid' } });
  check('invalid key rejected', foreign.status === 401 || foreign.status === 403);
}

async function main() {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`LightWallet not reachable at ${BASE}`);
  if (process.env.LW_TEST_KEY) await scenario('sandbox', process.env.LW_TEST_KEY);
  if (process.env.LW_LIVE_KEY) await scenario('production', process.env.LW_LIVE_KEY);
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checkout checks passed');
}

main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(() => process.exit(failures ? 1 : 0));
