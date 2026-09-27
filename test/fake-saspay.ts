/**
 * Local stand-in for SasPay (https://docs.saspay.me), for tests only: same paths, bodies,
 * statuses and signed webhooks. Never used in production.
 *   FAKE_SASPAY_PORT=8099 FAKE_SASPAY_KEY=sk_test_fake FAKE_SASPAY_WEBHOOK_SECRET=… FAKE_SASPAY_WEBHOOK_URL=… npx tsx test/fake-saspay.ts
 * Outcome by the last digit of the number: collections …0 FAILED, payouts …9 FAILED, else SUCCESS (after ~1.5 s).
 */
import crypto from 'crypto';
import http from 'http';

const PORT = Number(process.env.FAKE_SASPAY_PORT || 8099);
const KEY = process.env.FAKE_SASPAY_KEY || 'sk_test_fake';
const SECRET = process.env.FAKE_SASPAY_WEBHOOK_SECRET || 'whsec_fake';
const WEBHOOK_URL = process.env.FAKE_SASPAY_WEBHOOK_URL || '';

type Tx = { id: string; kind: 'payment' | 'payout'; status: string; msisdn: string; body: any; createdAt: number };
const txs = new Map<string, Tx>();
const byIdem = new Map<string, string>();
const log: any[] = [];

const send = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const settle = (tx: Tx) => {
  if (tx.status !== 'PENDING') return;
  const failed = tx.kind === 'payment' ? tx.msisdn.endsWith('0') : tx.msisdn.endsWith('9');
  tx.status = failed ? 'FAILED' : 'SUCCESS';
  if (!WEBHOOK_URL) return;
  const body = JSON.stringify({ event: `transaction.${failed ? 'failed' : 'success'}`, data: { id: tx.id, status: tx.status, msisdn: tx.msisdn } });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
  fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': sig, 'X-Webhook-Timestamp': ts, 'X-Webhook-Event': 'transaction' }, body }).catch(() => undefined);
};

http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = req.url ?? '';
      if (url === '/_requests') return send(res, 200, log);
      if (req.headers.authorization !== `Bearer ${KEY}`) return send(res, 401, { success: false, error: { message: 'Invalid API key', code: 'unauthorized' }, code: 401 });
      const body = raw ? JSON.parse(raw) : {};
      log.push({ method: req.method, url, body, idempotencyKey: req.headers['idempotency-key'] ?? null });

      const create = (kind: Tx['kind'], msisdn: string) => {
        const idem = req.headers['idempotency-key'] as string | undefined;
        if (idem && byIdem.has(idem)) return txs.get(byIdem.get(idem)!)!;
        const tx: Tx = { id: crypto.randomUUID(), kind, status: 'PENDING', msisdn, body, createdAt: Date.now() };
        txs.set(tx.id, tx);
        if (idem) byIdem.set(idem, tx.id);
        setTimeout(() => settle(tx), 1500);
        return tx;
      };

      if (req.method === 'POST' && url === '/api/v1/payments/softpay/') {
        if (body.country !== 'CG' || !['mtn_cg', 'airtel_cg'].includes(body.network)) return send(res, 422, { success: false, error: { message: 'No route', code: 'no_route_available' }, code: 422 });
        const tx = create('payment', String(body.customer?.phone ?? ''));
        return send(res, 201, { message: 'Payment pushed successfully', id: tx.id, status: tx.status, checkout_url: '' });
      }
      if (req.method === 'POST' && url === '/api/v1/payouts/initialize/') {
        if (body.country !== 'CG' || !body.recipient?.msisdn) return send(res, 422, { success: false, error: { message: 'Invalid', code: 'invalid_data' }, code: 422 });
        const tx = create('payout', String(body.recipient.msisdn));
        return send(res, 201, { success: true, data: { id: tx.id, status: tx.status, requested_amount: body.amount, currency: body.currency }, code: 201 });
      }
      const m = /^\/api\/v1\/(payments|payouts)\/([0-9a-f-]+)\/verify\/$/.exec(url);
      if (req.method === 'GET' && m) {
        const tx = txs.get(m[2]);
        if (!tx) return send(res, 404, { success: false, error: { message: 'Transaction introuvable', code: 'not_found' }, code: 404 });
        return send(res, 200, { message: 'fetched', id: tx.id, status: tx.status });
      }
      return send(res, 404, { success: false, error: { message: 'Not found', code: 'not_found' }, code: 404 });
    });
  })
  .listen(PORT, () => console.log(`[FAKE SASPAY] listening on ${PORT}`));
