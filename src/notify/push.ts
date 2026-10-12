import crypto from 'crypto';

/**
 * Push notifications through Firebase Cloud Messaging (HTTP v1), no SDK.
 *
 *   LIGHTPAY_FCM_SERVICE_ACCOUNT   the Firebase service account key (JSON, raw or base64) of the
 *                                  project the LightPay app is registered in (lightpay-a5f01).
 *                                  Firebase console > Project settings > Service accounts > Generate key.
 * Without it, pushes are skipped (logged once): nothing else changes.
 */

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let account: ServiceAccount | null | undefined;
let warned = false;

function serviceAccount(): ServiceAccount | null {
  if (account !== undefined) return account;
  const raw = process.env.LIGHTPAY_FCM_SERVICE_ACCOUNT?.trim();
  if (!raw) return (account = null);
  try {
    const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const a = JSON.parse(json);
    if (!a.project_id || !a.client_email || !a.private_key) throw new Error('incomplete');
    account = { project_id: a.project_id, client_email: a.client_email, private_key: String(a.private_key).replace(/\\n/g, '\n') };
  } catch (err: any) {
    console.error('[PUSH] LIGHTPAY_FCM_SERVICE_ACCOUNT unreadable', err?.message);
    account = null;
  }
  return account;
}

export const pushConfigured = () => serviceAccount() !== null;

let access: { token: string; expiresAt: number } | null = null;

/** OAuth access token for FCM, signed with the service account key (cached ~55 min). */
async function accessToken(a: ServiceAccount): Promise<string> {
  if (access && access.expiresAt > Date.now() + 60_000) return access.token;
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: a.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(a.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${signature}`,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  access = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return access.token;
}

export type PushResult = 'sent' | 'invalid_token' | 'failed' | 'skipped';

/**
 * One notification to one phone. Shown by Android even when the app is closed; a tap opens
 * the app, which reads `data.route` to open the right screen.
 */
export async function sendPush(token: string, n: { title: string; body: string; data?: Record<string, string>; tag?: string; image?: string }): Promise<PushResult> {
  const a = serviceAccount();
  if (!a) {
    if (!warned) console.warn('[PUSH] LIGHTPAY_FCM_SERVICE_ACCOUNT not set: push notifications skipped');
    warned = true;
    return 'skipped';
  }
  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${a.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken(a)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: n.title, body: n.body },
          data: n.data ?? {},
          android: {
            priority: 'HIGH',
            // Silhouette du logo LightPay (drawable de l'app), teintée en vert LightPay.
            // image : la photo de la personne ou le logo de l'app, en vignette à droite du texte.
            notification: { channel_id: 'lightpay_events', icon: 'ic_stat_lightpay', color: '#10B981', tag: n.tag, default_sound: true, ...(n.image ? { image: n.image } : {}) },
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return 'sent';
    const body: any = await res.json().catch(() => ({}));
    const code = body?.error?.details?.find?.((d: any) => d?.errorCode)?.errorCode ?? body?.error?.status;
    if (code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT' || res.status === 404) return 'invalid_token';
    console.error('[PUSH] send failed', res.status, code);
    return 'failed';
  } catch (err: any) {
    console.error('[PUSH] send failed', err?.message);
    return 'failed';
  }
}
