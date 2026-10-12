import crypto from 'crypto';
import { query } from '../db/pool.js';
import { Environment } from '../types/index.js';
import type { LightPayUser } from '../security/user-token.js';
import { ACCOUNT, ActivityRow, Message, activityMessage } from './catalog.js';
import { sendEmail } from './email.js';
import { sendPush } from './push.js';
import { absoluteUrl, withAvatars } from '../db/avatars.js';

/**
 * Automatic messages, like a SaaS: every money operation that changes state, every new
 * sign-in and every account change reaches the person by push (all their phones with the
 * app) and, for what matters, by e-mail. Texts: catalog.ts (and docs/notifications.md).
 *
 * Never blocks nor fails what triggered it: everything runs after the response, errors are
 * logged. One message per event (notification_log.event_key): retried webhooks and sweeps
 * never notify twice.
 */

const ID_DB: Environment = 'production';

const later = (task: () => Promise<void>) => {
  setImmediate(() => {
    task().catch((err) => console.error('[NOTIFY]', err?.message));
  });
};

interface Person {
  uid: string;
  email: string | null;
}

/** The person behind a wallet (USER wallets only; a guest wallet is a bare phone number). */
async function personOfWallet(env: Environment, walletId: string): Promise<Person | null> {
  const [w] = await query(`SELECT account_type, account_id, metadata FROM wallets WHERE id = $1`, [walletId], env);
  if (!w || w.account_type !== 'USER' || !String(w.account_id ?? '').startsWith('user:')) return null;
  return { uid: String(w.account_id).slice(5), email: w.metadata?.email ?? null };
}

/** Sends one message (push to every phone of the person in this environment, e-mail if asked). */
async function deliver(env: Environment, person: Person, eventKey: string, m: Message, data: Record<string, string> = {}) {
  const [logged] = await query(
    `INSERT INTO notification_log (id, event_key, uid, environment, event, title, body)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (event_key) DO NOTHING RETURNING id`,
    [`ntf_${crypto.randomBytes(12).toString('base64url')}`, eventKey, person.uid, env, m.event, m.title, m.body],
    ID_DB
  );
  if (!logged) return; // already sent
  const sandbox = env === 'sandbox';
  const title = sandbox ? `[Test] ${m.title}` : m.title;

  let push = 'none';
  const devices = m.push === false ? [] : await query(`SELECT token FROM push_devices WHERE uid = $1 AND environment = $2`, [person.uid, env], ID_DB);
  for (const d of devices) {
    const r = await sendPush(d.token, { title, body: m.body, tag: data.id, image: m.image, data: { event: m.event, route: m.route ?? '/home', ...data } });
    if (r === 'invalid_token') await query(`DELETE FROM push_devices WHERE token = $1`, [d.token], ID_DB);
    if (r === 'sent' || push === 'none' || push === 'skipped') push = r;
  }

  let email = 'none';
  if (m.email && person.email) email = await sendEmail(person.email, { title: m.subject ?? m.title, body: m.body, route: m.route, sandbox });

  await query(`UPDATE notification_log SET push_status = $2, email_status = $3 WHERE id = $1`, [logged.id, push, email], ID_DB);
}

/**
 * A journal line was written or changed (db/activity.ts). `previous`: its state before (null
 * when new). Called for every line; only state changes that mean something are sent.
 */
export function notifyActivity(env: Environment, row: ActivityRow & { wallet_id: string }, previous: { status: string; reason_code: string | null } | null) {
  const disputed = row.reason_code === 'DISPUTED';
  if (previous && previous.status === row.status && (previous.reason_code === 'DISPUTED') === disputed) return;
  const m = activityMessage(row, previous ? previous.status : null);
  if (!m) return;
  later(async () => {
    const person = await personOfWallet(env, row.wallet_id);
    if (!person) return;
    // The other person's photo or the app's logo, as a thumbnail beside the text.
    const [face] = await withAvatars(env, [row as ActivityRow & { id: string; kind: string }]);
    const image = face?.avatar_url ? absoluteUrl(face.avatar_url) : undefined;
    await deliver(env, person, `act:${env}:${row.id}:${row.status}${disputed ? ':DISPUTED' : ''}`, { ...m, image }, { id: row.id });
  });
}

/** An account event (app authorized, username changed…), for a signed-in person. */
export function notifyAccount(env: Environment, user: Pick<LightPayUser, 'uid' | 'email'>, m: Message | null, key: string) {
  if (!m) return;
  later(() => deliver(env, { uid: user.uid, email: user.email }, `acc:${env}:${user.uid}:${m.event}:${key}`, m));
}

// ---------------------------------------------------------------- new sign-in

/** « l’app LightPay Android », « Chrome sur Windows »… from the User-Agent. */
export function deviceLabel(ua: string | undefined): string {
  const s = String(ua ?? '');
  if (/LightPay-Android/i.test(s)) return 'l’app LightPay Android';
  if (/^Dart\//.test(s)) return 'l’app LightPay';
  const os = /Android/i.test(s) ? 'Android' : /iPhone|iPad/i.test(s) ? 'iPhone' : /Windows/i.test(s) ? 'Windows' : /Mac OS X|Macintosh/i.test(s) ? 'Mac' : /Linux/i.test(s) ? 'Linux' : null;
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /SamsungBrowser/.test(s) ? 'Samsung Internet' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : null;
  if (browser && os) return `${browser} sur ${os}`;
  return browser ?? os ?? 'un nouvel appareil';
}

const seen = new Map<string, number>();

/**
 * Every authenticated call of the person's space (routes/me.ts). The first time a sign-in
 * comes from a device the person never used, « Nouvelle connexion » is sent (push to their
 * other phones, e-mail). The very first device recorded for someone is not announced
 * (account creation, or first visit since this feature).
 */
export function noteSignIn(env: Environment, user: LightPayUser, userAgent: string | undefined) {
  const label = deviceLabel(userAgent);
  const deviceKey = crypto.createHash('sha256').update(label).digest('hex').slice(0, 32);
  const k = `${user.uid}:${deviceKey}`;
  if ((seen.get(k) ?? 0) >= user.authTime) return;
  seen.set(k, user.authTime);
  later(async () => {
    const [known] = await query(`SELECT last_auth_time FROM sign_in_devices WHERE uid = $1 AND device_key = $2`, [user.uid, deviceKey], ID_DB);
    await query(
      `INSERT INTO sign_in_devices (uid, device_key, label, last_auth_time) VALUES ($1, $2, $3, $4)
       ON CONFLICT (uid, device_key) DO UPDATE SET last_auth_time = GREATEST(sign_in_devices.last_auth_time, EXCLUDED.last_auth_time), updated_at = NOW()`,
      [user.uid, deviceKey, label, user.authTime],
      ID_DB
    );
    if (known) return;
    const [{ n }] = await query(`SELECT COUNT(*)::int AS n FROM sign_in_devices WHERE uid = $1 AND device_key <> $2`, [user.uid, deviceKey], ID_DB);
    if (!n) return;
    const when = new Date(user.authTime * 1000).toLocaleString('fr-FR', { timeZone: 'Africa/Brazzaville', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    const m = ACCOUNT.signIn(label, when);
    if (m) await deliver(env, { uid: user.uid, email: user.email }, `signin:${user.uid}:${deviceKey}:${user.authTime}`, m);
  });
}

// ---------------------------------------------------------------- phones

/** The app registers its Firebase Cloud Messaging token after sign-in (and when it changes). */
export async function registerDevice(env: Environment, uid: string, token: string, platform: string, label: string | null) {
  await query(
    `INSERT INTO push_devices (token, uid, environment, platform, label) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (token) DO UPDATE SET uid = EXCLUDED.uid, environment = EXCLUDED.environment, platform = EXCLUDED.platform, label = EXCLUDED.label, updated_at = NOW()`,
    [token, uid, env, platform, label],
    ID_DB
  );
}

/** Sign-out or notifications turned off on that phone. */
export async function removeDevice(uid: string, token: string) {
  await query(`DELETE FROM push_devices WHERE token = $1 AND uid = $2`, [token, uid], ID_DB);
}

/** Account deleted: no phone keeps receiving anything. */
export async function removeAllDevices(uid: string) {
  await query(`DELETE FROM push_devices WHERE uid = $1`, [uid], ID_DB);
}

/** Administration > Messages > « Envoyer un test » : le message, avec des valeurs d'exemple, au téléphone et à l'e-mail de l'admin. */
export async function sendTest(env: Environment, admin: { uid: string; email: string | null }, m: Message) {
  const [{ n }] = await query(`SELECT COUNT(*)::int AS n FROM push_devices WHERE uid = $1 AND environment = $2`, [admin.uid, env], ID_DB);
  await deliver(env, { uid: admin.uid, email: admin.email }, `test:${admin.uid}:${m.event}:${Date.now()}`, { ...m, event: `test.${m.event}` }, { id: 'test' });
  return { phones: n as number, email: Boolean(m.email && admin.email) };
}
