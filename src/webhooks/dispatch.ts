import crypto from 'crypto';
import { query } from '../db/pool.js';
import { Environment } from '../types/index.js';

/**
 * Outgoing webhooks to an app's webhook_url, signed with its whsec_ secret:
 *   LightPay-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
 * The app recomputes the HMAC and rejects old timestamps (replay protection).
 * Every attempt is logged in webhook_logs; delivery is retried a few times.
 */

export const signWebhook = (secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) =>
  `t=${timestamp},v1=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

const RETRY_DELAYS_MS = [0, 2_000, 10_000, 60_000];

export async function dispatchWebhook(appId: string, environment: Environment, event: string, data: Record<string, any>) {
  const [app] = await query('SELECT webhook_url, webhook_secret FROM apps WHERE id = $1', [appId], environment);
  const payload = { id: `evt_${crypto.randomBytes(12).toString('hex')}`, type: event, environment, created: new Date().toISOString(), data };
  const [log] = await query(
    `INSERT INTO webhook_logs (app_id, event, payload, status) VALUES ($1, $2, $3, $4) RETURNING id`,
    [appId, event, JSON.stringify(payload), app?.webhook_url ? 'PENDING' : 'SKIPPED'],
    environment
  );
  if (!app?.webhook_url) return;

  const body = JSON.stringify(payload);
  const deliver = async (attempt: number): Promise<void> => {
    let status = 0;
    try {
      const res = await fetch(app.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'LightPay-Signature': signWebhook(app.webhook_secret, body), 'LightPay-Event': event },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
    } catch {
      status = 0;
    }
    const ok = status >= 200 && status < 300;
    const next = RETRY_DELAYS_MS[attempt + 1];
    await query(
      `UPDATE webhook_logs SET status = $2, response_status = $3, attempts = $4, next_retry_at = $5 WHERE id = $1`,
      [log.id, ok ? 'SENT' : next === undefined ? 'FAILED' : 'PENDING', status || null, attempt + 1, ok || next === undefined ? null : new Date(Date.now() + next)],
      environment
    ).catch(() => undefined);
    if (!ok && next !== undefined) setTimeout(() => void deliver(attempt + 1), next);
  };
  void deliver(0);
}
