import crypto from 'crypto';
import { query } from './pool.js';
import { generateAppCredentials, getOrCreateMerchantWallet } from './apps.js';
import { setRedirectUris } from './connect.js';
import { APP_ID_PATTERN, isReservedAppId } from '../security/app-identity.js';
import { dispatchWebhook } from '../webhooks/dispatch.js';
import { Environment } from '../types/index.js';

/**
 * Developer space: the apps a LightPay account owns. Everything is scoped to the owner
 * (Firebase uid); keys are shown once at creation / rotation and only hashes are stored.
 * App metadata lives in both databases (production is read, both are written).
 */

export class DeveloperError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode = 400
  ) {
    super(message);
  }
}

const MAX_APPS_PER_OWNER = 10;

const APP_COLUMNS = `id, name, webhook_url, redirect_uris, is_active, max_amount_per_tx::text, daily_volume_limit::text,
  live_key_hint, test_key_hint, keys_rotated_at, contact_email, created_at, updated_at`;

export interface AppView {
  id: string;
  name: string;
  webhook_url: string | null;
  redirect_uris: string[];
  is_active: boolean;
  max_amount_per_tx: string | null;
  daily_volume_limit: string | null;
  live_key_hint: string | null;
  test_key_hint: string | null;
  keys_rotated_at: string | null;
  created_at: string;
}

const view = (r: any): AppView => ({
  id: r.id,
  name: r.name,
  webhook_url: r.webhook_url ?? null,
  redirect_uris: Array.isArray(r.redirect_uris) ? r.redirect_uris : [],
  is_active: r.is_active,
  max_amount_per_tx: r.max_amount_per_tx ?? null,
  daily_volume_limit: r.daily_volume_limit ?? null,
  live_key_hint: r.live_key_hint ?? null,
  test_key_hint: r.test_key_hint ?? null,
  keys_rotated_at: r.keys_rotated_at ?? null,
  created_at: r.created_at,
});

export async function listOwnedApps(uid: string): Promise<AppView[]> {
  const rows = await query(`SELECT ${APP_COLUMNS} FROM apps WHERE owner_uid = $1 ORDER BY created_at DESC`, [uid], 'production');
  return rows.map(view);
}

/** The app if this account owns it; 404 otherwise (never reveals that it exists). */
export async function ownedApp(uid: string, appId: string): Promise<AppView> {
  const [row] = await query(`SELECT ${APP_COLUMNS} FROM apps WHERE id = $1 AND owner_uid = $2`, [appId, uid], 'production');
  if (!row) throw new DeveloperError('App introuvable.', 'APP_NOT_FOUND', 404);
  return view(row);
}

const bothDatabases = (sql: string, params: unknown[]) =>
  Promise.all([query(sql, params, 'production'), query(sql, params, 'sandbox')]);

const cleanName = (name: unknown) => String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);

export async function createApp(uid: string, email: string | null, input: { id?: string; name?: string }) {
  const name = cleanName(input.name);
  if (name.length < 2) throw new DeveloperError('Donnez un nom à votre app.', 'INVALID_NAME');
  const id = String(input.id ?? '').trim().toLowerCase();
  if (!APP_ID_PATTERN.test(id)) {
    throw new DeveloperError('Identifiant : 3 à 50 caractères, minuscules, chiffres, « _ » ou « - », sans espace.', 'INVALID_APP_ID');
  }
  if (isReservedAppId(id)) throw new DeveloperError('Cet identifiant est réservé.', 'RESERVED_APP_ID', 403);
  const [{ n }] = await query(`SELECT COUNT(*)::int AS n FROM apps WHERE owner_uid = $1`, [uid], 'production');
  if (n >= MAX_APPS_PER_OWNER) throw new DeveloperError(`${MAX_APPS_PER_OWNER} apps maximum par compte.`, 'TOO_MANY_APPS', 403);
  const [inProd, inSandbox] = await Promise.all([
    query('SELECT 1 FROM apps WHERE id = $1', [id], 'production'),
    query('SELECT 1 FROM apps WHERE id = $1', [id], 'sandbox'),
  ]);
  if (inProd.length || inSandbox.length) throw new DeveloperError('Cet identifiant est déjà pris.', 'APP_ID_TAKEN', 409);

  const c = generateAppCredentials();
  await bothDatabases(
    `INSERT INTO apps (id, name, api_key_hash, test_api_key_hash, webhook_secret, contact_email, owner_uid, live_key_hint, test_key_hint)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
    [id, name, c.liveKeyHash, c.testKeyHash, c.webhookSecret, email, uid, c.liveHint, c.testHint]
  );
  await Promise.all([getOrCreateMerchantWallet(id, 'production', 'CREDIT'), getOrCreateMerchantWallet(id, 'sandbox', 'CREDIT')]);
  return { app: await ownedApp(uid, id), keys: { live_api_key: c.liveKey, test_api_key: c.testKey, webhook_secret: c.webhookSecret } };
}

export async function updateApp(uid: string, appId: string, input: { name?: string; webhook_url?: string | null; redirect_uris?: string[] }) {
  await ownedApp(uid, appId);
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (name.length < 2) throw new DeveloperError('Donnez un nom à votre app.', 'INVALID_NAME');
    await bothDatabases('UPDATE apps SET name = $2, updated_at = NOW() WHERE id = $1', [appId, name]);
  }
  if (input.webhook_url !== undefined) {
    const url = String(input.webhook_url ?? '').trim();
    if (url) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new DeveloperError('Adresse de webhook invalide.', 'INVALID_WEBHOOK_URL');
      }
      if (parsed.protocol !== 'https:' || parsed.hash) throw new DeveloperError('Le webhook doit être une adresse https, sans #.', 'INVALID_WEBHOOK_URL');
    }
    await bothDatabases('UPDATE apps SET webhook_url = $2, updated_at = NOW() WHERE id = $1', [appId, url || null]);
  }
  if (input.redirect_uris !== undefined) {
    const uris = (Array.isArray(input.redirect_uris) ? input.redirect_uris : []).map((u) => String(u).trim()).filter(Boolean);
    if (uris.length) {
      try {
        await setRedirectUris(appId, uris);
      } catch (err: any) {
        throw new DeveloperError(err.message, 'INVALID_REDIRECT_URIS');
      }
    } else {
      await bothDatabases(`UPDATE apps SET redirect_uris = '[]'::jsonb, updated_at = NOW() WHERE id = $1`, [appId]);
    }
  }
  return ownedApp(uid, appId);
}

/** New live/test keys and webhook secret; the old ones stop working immediately. */
export async function rotateKeys(uid: string, appId: string) {
  await ownedApp(uid, appId);
  const c = generateAppCredentials();
  await bothDatabases(
    `UPDATE apps SET api_key_hash = $2, test_api_key_hash = $3, webhook_secret = $4, live_key_hint = $5, test_key_hint = $6,
       keys_rotated_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [appId, c.liveKeyHash, c.testKeyHash, c.webhookSecret, c.liveHint, c.testHint]
  );
  return { app: await ownedApp(uid, appId), keys: { live_api_key: c.liveKey, test_api_key: c.testKey, webhook_secret: c.webhookSecret } };
}

/**
 * Attaches an app created before owners existed: whoever holds one of its secret keys proves
 * they run it. Only an app without an owner can be claimed; reserved identities never.
 */
export async function claimApp(uid: string, secretKey: string) {
  const key = String(secretKey ?? '').trim();
  if (!/^sec_(live|test)_[a-f0-9]{48}$/.test(key)) throw new DeveloperError('Collez une clé secrète sec_live_… ou sec_test_…', 'INVALID_KEY');
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const [app] = await query(
    'SELECT id, owner_uid FROM apps WHERE api_key_hash = $1 OR test_api_key_hash = $1',
    [hash],
    key.startsWith('sec_test_') ? 'sandbox' : 'production'
  );
  if (!app || isReservedAppId(app.id)) throw new DeveloperError('Aucune app ne correspond à cette clé.', 'APP_NOT_FOUND', 404);
  if (app.owner_uid && app.owner_uid !== uid) throw new DeveloperError('Cette app est déjà rattachée à un autre compte.', 'APP_OWNED', 409);
  await bothDatabases('UPDATE apps SET owner_uid = $2, updated_at = NOW() WHERE id = $1 AND (owner_uid IS NULL OR owner_uid = $2)', [app.id, uid]);
  return ownedApp(uid, app.id);
}

/** Money and activity of an app in one environment. */
export async function appOverview(uid: string, appId: string, env: Environment) {
  const app = await ownedApp(uid, appId);
  const [wallets, [sessions], [held], [hooks]] = await Promise.all([
    query(
      `SELECT currency, available_balance::text, locked_balance::text FROM wallets
       WHERE app_id = $1 AND account_type = 'MERCHANT' AND environment = $2 ORDER BY currency`,
      [appId, env],
      env
    ),
    query(
      `SELECT COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
              COALESCE(SUM(amount) FILTER (WHERE status = 'COMPLETED'), 0)::text AS volume,
              COALESCE(SUM(fee_amount) FILTER (WHERE status = 'COMPLETED'), 0)::text AS fees,
              COUNT(*) FILTER (WHERE status IN ('EXPIRED', 'CANCELLED'))::int AS abandoned,
              COUNT(*)::int AS total
       FROM checkout_sessions WHERE app_id = $1 AND environment = $2 AND created_at > NOW() - INTERVAL '30 days'`,
      [appId, env],
      env
    ),
    query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(s.amount), 0)::text AS amount
       FROM checkout_sessions s JOIN holds h ON h.id = s.hold_id
       WHERE s.app_id = $1 AND s.environment = $2 AND h.status IN ('ACTIVE', 'DISPUTED')`,
      [appId, env],
      env
    ),
    query(
      `SELECT COUNT(*) FILTER (WHERE status = 'SENT')::int AS sent, COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed
       FROM webhook_logs WHERE app_id = $1 AND created_at > NOW() - INTERVAL '30 days'`,
      [appId],
      env
    ),
  ]);
  return {
    app,
    environment: env,
    wallets,
    last_30_days: { ...sessions, webhooks_sent: hooks.sent, webhooks_failed: hooks.failed },
    escrow: held,
  };
}

export async function appSessions(uid: string, appId: string, env: Environment, limit = 50) {
  await ownedApp(uid, appId);
  return query(
    `SELECT id, kind, status, amount::text, fee_amount::text, currency, reference, description, escrow, payer_type,
            created_at, completed_at, expires_at
     FROM checkout_sessions WHERE app_id = $1 AND environment = $2 ORDER BY created_at DESC LIMIT $3`,
    [appId, env, Math.min(Math.max(limit, 1), 200)],
    env
  );
}

export async function appWebhookLogs(uid: string, appId: string, env: Environment, limit = 50) {
  await ownedApp(uid, appId);
  return query(
    `SELECT id, event, status, response_status, attempts, created_at, payload->>'id' AS event_id
     FROM webhook_logs WHERE app_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [appId, Math.min(Math.max(limit, 1), 200)],
    env
  );
}

/** Sends a signed `ping` event to the app's webhook, to check the integration. */
export async function sendTestWebhook(uid: string, appId: string, env: Environment) {
  const app = await ownedApp(uid, appId);
  if (!app.webhook_url) throw new DeveloperError('Renseignez d’abord l’adresse du webhook.', 'NO_WEBHOOK_URL');
  await dispatchWebhook(appId, env, 'ping', { message: 'Test depuis votre compte LightPay', app_id: appId });
  return { sent: true };
}
