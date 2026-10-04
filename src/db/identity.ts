import { query } from './pool.js';
import { ConnectError } from './connect.js';
import { Environment } from '../types/index.js';
import type { LightPayUser } from '../security/user-token.js';

/**
 * Identity-level data, one per LightPay person (production database, both ledgers use it):
 *   - the @username people send money to (required, unique, changeable);
 *   - the advanced-mode request (console + developer space), decided by the LightPay admin.
 */

const ID_DB: Environment = 'production';

// ---------------------------------------------------------------- usernames

/** 3–20 characters: lowercase letters, digits, "." and "_", starting with a letter. */
const USERNAME = /^[a-z][a-z0-9._]{2,19}$/;
const RESERVED = new Set([
  'admin', 'administrateur', 'lightpay', 'light', 'pay', 'support', 'aide', 'help', 'salacope', 'root', 'system', 'systeme',
  'api', 'account', 'compte', 'checkout', 'paiement', 'mtn', 'airtel', 'momo', 'saspay', 'pawapay', 'moderateur', 'staff', 'security',
]);

export const normalizeUsername = (raw: unknown) => String(raw ?? '').trim().replace(/^@/, '').toLowerCase();

export async function getUsername(uid: string): Promise<string | null> {
  const [row] = await query(`SELECT username FROM usernames WHERE uid = $1`, [uid], ID_DB);
  return row?.username ?? null;
}

export async function setUsername(user: LightPayUser, raw: unknown) {
  const username = normalizeUsername(raw);
  if (!USERNAME.test(username) || /[._]{2}/.test(username) || /[._]$/.test(username)) {
    throw new ConnectError('3 à 20 caractères : lettres, chiffres, « . » ou « _ », en commençant par une lettre.', 'INVALID_USERNAME');
  }
  if (RESERVED.has(username)) throw new ConnectError('Ce nom est réservé. Choisissez-en un autre.', 'USERNAME_TAKEN', 409);
  const [taken] = await query(`SELECT uid FROM usernames WHERE lower(username) = $1 AND uid <> $2`, [username, user.uid], ID_DB);
  if (taken) throw new ConnectError('Ce nom est déjà pris.', 'USERNAME_TAKEN', 409);
  try {
    await query(
      `INSERT INTO usernames (uid, username) VALUES ($1, $2)
       ON CONFLICT (uid) DO UPDATE SET username = EXCLUDED.username, updated_at = NOW()`,
      [user.uid, username],
      ID_DB
    );
  } catch (err: any) {
    if (err?.code === '23505') throw new ConnectError('Ce nom est déjà pris.', 'USERNAME_TAKEN', 409);
    throw err;
  }
  return username;
}

/** Whose @username this is (uid), or null. */
export async function uidOfUsername(raw: unknown): Promise<string | null> {
  const username = normalizeUsername(raw);
  if (!USERNAME.test(username)) return null;
  const [row] = await query(`SELECT uid FROM usernames WHERE lower(username) = $1`, [username], ID_DB);
  return row?.uid ?? null;
}

/**
 * The person's wallet a transfer goes to, from "@username" or an e-mail, in one ledger.
 * Returns what the sender may see: the name and the @username, never the e-mail of someone
 * found by username.
 */
export async function findRecipient(environment: Environment, toRaw: unknown, currency = 'XAF') {
  const to = String(toRaw ?? '').trim().toLowerCase();
  const byEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
  let row: any;
  if (byEmail) {
    [row] = await query(
      `SELECT id, account_id, metadata FROM wallets WHERE app_id = 'mainapp' AND account_type = 'USER' AND environment = $1 AND currency = $2 AND status = 'ACTIVE' AND lower(metadata->>'email') = $3 LIMIT 1`,
      [environment, currency, to],
      environment
    );
  } else {
    const uid = await uidOfUsername(to);
    if (uid) {
      [row] = await query(
        `SELECT id, account_id, metadata FROM wallets WHERE app_id = 'mainapp' AND account_type = 'USER' AND environment = $1 AND currency = $2 AND status = 'ACTIVE' AND account_id = $3 LIMIT 1`,
        [environment, currency, `user:${uid}`],
        environment
      );
    } else if (!/^@?[a-z0-9._]+$/.test(to)) {
      throw new ConnectError('Entrez un @nom d’utilisateur ou une adresse e-mail.', 'INVALID_RECIPIENT');
    }
  }
  if (!row) throw new ConnectError(byEmail ? 'Aucun compte LightPay avec cet e-mail.' : 'Aucun compte LightPay avec ce nom.', 'RECIPIENT_NOT_FOUND', 404);
  const uid = String(row.account_id).replace(/^user:/, '');
  return {
    walletId: row.id as string,
    uid,
    name: (row.metadata?.name as string | undefined) || null,
    username: await getUsername(uid),
    email: byEmail ? to : null,
  };
}

// ---------------------------------------------------------------- advanced mode (developer access)

export type DeveloperStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

export async function developerAccess(uid: string) {
  const [row] = await query(`SELECT status, note, created_at, decided_at FROM developer_access WHERE uid = $1`, [uid], ID_DB);
  if (!row) return { status: 'NONE' as DeveloperStatus, note: null, requested_at: null, decided_at: null };
  return { status: row.status as DeveloperStatus, note: row.note ?? null, requested_at: row.created_at, decided_at: row.decided_at };
}

export const isDeveloper = async (uid: string) => (await developerAccess(uid)).status === 'APPROVED';

const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

/** The person asks for the advanced mode (again, after a refusal). */
export async function requestDeveloperAccess(user: LightPayUser, input: { project?: unknown; website?: unknown; use_case?: unknown }) {
  const project = clean(input.project, 80);
  const useCase = clean(input.use_case, 600);
  let website = clean(input.website, 200);
  if (project.length < 2) throw new ConnectError('Donnez le nom de votre projet ou de votre entreprise.', 'INVALID_REQUEST');
  if (useCase.length < 20) throw new ConnectError('Expliquez en quelques phrases ce que vous allez faire avec LightPay.', 'INVALID_REQUEST');
  if (website) {
    if (!/^https?:\/\//i.test(website)) website = `https://${website}`;
    try {
      const u = new URL(website);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol');
      website = u.toString();
    } catch {
      throw new ConnectError('Adresse du site invalide.', 'INVALID_REQUEST');
    }
  }
  const current = await developerAccess(user.uid);
  if (current.status === 'APPROVED') return current;
  if (current.status === 'PENDING') throw new ConnectError('Votre demande est déjà en cours d’examen.', 'ALREADY_PENDING', 409);
  await query(
    `INSERT INTO developer_access (uid, email, project, website, use_case, status)
     VALUES ($1, $2, $3, $4, $5, 'PENDING')
     ON CONFLICT (uid) DO UPDATE SET email = EXCLUDED.email, project = EXCLUDED.project, website = EXCLUDED.website,
       use_case = EXCLUDED.use_case, status = 'PENDING', note = NULL, decided_by = NULL, decided_at = NULL,
       created_at = NOW(), updated_at = NOW()`,
    [user.uid, user.email, project, website || null, useCase],
    ID_DB
  );
  return developerAccess(user.uid);
}

/** Admin: the requests, newest first (pending ones on top). */
export const listDeveloperRequests = (status: string | null) =>
  query(
    `SELECT d.uid, d.email, d.project, d.website, d.use_case, d.status, d.note, d.decided_by, d.decided_at, d.created_at, u.username
     FROM developer_access d LEFT JOIN usernames u ON u.uid = d.uid
     WHERE ($1::text IS NULL OR d.status = $1)
     ORDER BY (d.status = 'PENDING') DESC, d.created_at DESC LIMIT 200`,
    [status],
    ID_DB
  );

/** Admin: approve or refuse a request. */
export async function decideDeveloperAccess(uid: string, approve: boolean, note: unknown, by: string) {
  const text = clean(note, 300) || null;
  if (!approve && !text) throw new ConnectError('Indiquez le motif du refus : la personne le verra.', 'NOTE_REQUIRED');
  const [row] = await query(
    `UPDATE developer_access SET status = $2, note = $3, decided_by = $4, decided_at = NOW(), updated_at = NOW()
     WHERE uid = $1 RETURNING uid, email, project, status`,
    [uid, approve ? 'APPROVED' : 'REJECTED', approve ? null : text, by],
    ID_DB
  );
  if (!row) throw new ConnectError('Demande introuvable.', 'NOT_FOUND', 404);
  return row;
}
