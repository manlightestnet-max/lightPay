import { query } from './pool.js';
import { Environment } from '../types/index.js';

/**
 * Faces on the statement: the photo of the person (from their Google account, unless they hid it
 * in Compte) or the logo of the app (Developer console > app > Logo). Resolved when the lines are
 * read, so old lines get them too and a hidden photo disappears everywhere at once.
 */

export class LogoError extends Error {
  constructor(message: string, public code: string, public status = 400) {
    super(message);
  }
}

export const MAX_LOGO_BYTES = 150 * 1024;

/** Where a logo is served (same path on the API and the payment domain). */
export const logoPath = (appId: string, version: number | string) => `/v1/checkout/public/apps/${encodeURIComponent(appId)}/logo?v=${version}`;

/** Absolute address (push notifications are drawn by Android, outside any page). */
export const absoluteUrl = (url: string) =>
  url.startsWith('/') ? `${(process.env.CHECKOUT_BASE_URL || 'https://checkout.smlab.xyz').replace(/\/+$/, '')}${url}` : url;

/** A person's photo as others may see it (null when hidden or absent). */
export const photoOf = (metadata: any): string | null =>
  metadata && metadata.hide_photo !== true && typeof metadata.picture === 'string' && metadata.picture.startsWith('https://') ? metadata.picture : null;

const sniff = (b: Buffer): string | null => {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
};

const bothDatabases = (sql: string, params: unknown[]) =>
  Promise.all([query(sql, params, 'production'), query(sql, params, 'sandbox')]);

/** Saves an app's logo (base64 PNG / JPEG / WebP, the type is read from the bytes). Returns its address. */
export async function setAppLogo(appId: string, base64: unknown) {
  const raw = String(base64 ?? '').replace(/^data:[^,]*,/, '');
  if (!raw || raw.length > Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 8) throw new LogoError('Image trop lourde : 150 Ko au maximum.', 'LOGO_TOO_LARGE');
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length === 0) throw new LogoError('Image illisible.', 'LOGO_INVALID');
  if (bytes.length > MAX_LOGO_BYTES) throw new LogoError('Image trop lourde : 150 Ko au maximum.', 'LOGO_TOO_LARGE');
  const type = sniff(bytes);
  if (!type) throw new LogoError('Format accepté : PNG, JPEG ou WebP.', 'LOGO_FORMAT');
  const version = Date.now();
  await bothDatabases(`UPDATE apps SET logo = $2, logo_type = $3, logo_version = $4, updated_at = NOW() WHERE id = $1`, [appId, bytes, type, version]);
  return logoPath(appId, version);
}

export async function removeAppLogo(appId: string) {
  await bothDatabases(`UPDATE apps SET logo = NULL, logo_type = NULL, logo_version = NULL, updated_at = NOW() WHERE id = $1`, [appId]);
}

export async function appLogo(appId: string): Promise<{ bytes: Buffer; type: string; version: string } | null> {
  const [row] = await query(`SELECT logo, logo_type, logo_version::text FROM apps WHERE id = $1 AND logo IS NOT NULL`, [appId], 'production');
  return row ? { bytes: row.logo, type: row.logo_type, version: row.logo_version } : null;
}

/** Logo addresses of these apps (absent: no logo). */
export async function appLogos(environment: Environment, appIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(appIds.filter(Boolean))];
  if (!ids.length) return new Map();
  try {
    const rows = await query(`SELECT id, logo_version::text AS v FROM apps WHERE id = ANY($1) AND logo IS NOT NULL`, [ids], environment);
    return new Map(rows.map((r: any) => [r.id, logoPath(r.id, r.v)]));
  } catch {
    return new Map();
  }
}

export const appLogoUrl = async (environment: Environment, appId: string) => (await appLogos(environment, [appId])).get(appId) ?? null;

const APP_KINDS = ['PAYMENT', 'CHARGE', 'SALE', 'COMMISSION', 'REFUND'];

/**
 * Adds `avatar_url` to statement lines: the other person's photo for a transfer, the app's logo for
 * a payment, a sale, a commission or a refund. Never throws (no face is fine).
 */
export async function withAvatars<T extends { id: string; kind: string }>(environment: Environment, rows: T[]): Promise<(T & { avatar_url: string | null })[]> {
  const out = rows.map((r) => ({ ...r, avatar_url: null as string | null }));
  const ids = rows.map((r) => r.id);
  if (!ids.length) return out;
  try {
    const byId = new Map(out.map((r) => [r.id, r]));
    const transfers = rows.filter((r) => r.kind === 'TRANSFER').map((r) => r.id);
    if (transfers.length) {
      const peers = await query(
        `SELECT a.id, w.metadata FROM wallet_activity a
         JOIN wallet_activity p ON p.ref_type = a.ref_type AND p.ref_id = a.ref_id AND p.wallet_id <> a.wallet_id AND p.kind = 'TRANSFER'
         JOIN wallets w ON w.id = p.wallet_id
         WHERE a.id = ANY($1)`,
        [transfers],
        environment
      );
      for (const p of peers) {
        const row = byId.get(p.id);
        if (row) row.avatar_url = photoOf(p.metadata);
      }
    }
    const appLines = rows.filter((r) => APP_KINDS.includes(r.kind)).map((r) => r.id);
    if (appLines.length) {
      const apps = await query(
        `SELECT a.id, COALESCE(
           CASE WHEN a.ref_type IN ('checkout', 'sale', 'sale_commission') THEN (SELECT s.app_id FROM checkout_sessions s WHERE s.id = a.ref_id) END,
           CASE WHEN a.ref_type = 'collection' THEN (SELECT s.app_id FROM collection_attempts c JOIN checkout_sessions s ON s.id = c.session_id WHERE c.id = a.ref_id) END,
           CASE WHEN a.ref_type IN ('hold', 'hold_commission', 'hold_refund') THEN (SELECT h.app_id FROM holds h WHERE h.id::text = a.ref_id) END,
           CASE WHEN a.ref_type IN ('charge', 'charge_sale', 'charge_sale_commission') THEN split_part(a.ref_id, ':', 1) END
         ) AS app_id
         FROM wallet_activity a WHERE a.id = ANY($1)`,
        [appLines],
        environment
      );
      const logos = await appLogos(environment, apps.map((a: any) => a.app_id));
      for (const a of apps) {
        const row = byId.get(a.id);
        if (row && a.app_id) row.avatar_url = logos.get(a.app_id) ?? null;
      }
    }
  } catch (err: any) {
    console.error('[AVATARS] resolve failed', err?.message);
  }
  return out;
}

/** Shows or hides this person's photo to the people they pay or are paid by (both databases). */
export async function setPhotoVisible(uid: string, visible: boolean) {
  await bothDatabases(
    `UPDATE wallets SET metadata = metadata || $2, updated_at = NOW() WHERE app_id = 'mainapp' AND account_id = $1`,
    [`user:${uid}`, JSON.stringify({ hide_photo: !visible })]
  );
}
