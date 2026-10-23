/**
 * The wallets of a LightPay person: the only way in to find, open, name or close one.
 *
 * A person ("user:<uid>", wallets.owner_id) may hold several wallets, each with a label and a default country.
 * One of them per currency is the default: it receives whatever does not name a wallet (transfers to @username,
 * connections, deposits). The first wallet keeps account_id = owner_id (migration 027), so the unique key
 * (app_id, account_id, currency, environment) still identifies it; the others get "<owner_id>/w_<random>".
 *
 * Reading never writes: balance polling must not contend with payments. Profile data (name, e-mail, photo) is
 * copied on every wallet of the person and only rewritten when it actually changed.
 */
import crypto from 'crypto';
import { query, getClient } from '../db/pool.js';
import { ConnectError } from '../db/connect.js';
import { Environment } from '../types/index.js';
import type { LightPayUser } from '../security/user-token.js';
import { ownerOf } from './owner.js';

export { ownerOf, uidOfOwner } from './owner.js';

const APP = 'mainapp';
export const DEFAULT_CURRENCY = 'XAF';
export const DEFAULT_COUNTRY = 'COG';
const LABEL_MAX = 40;

export interface WalletRow {
  id: string;
  app_id: string;
  account_id: string;
  owner_id: string;
  account_type: string;
  currency: string;
  label: string | null;
  country: string | null;
  is_default: boolean;
  /** When the person chose this wallet's country (null: the first wallet, still in Congo by default). */
  country_confirmed_at: Date | null;
  available_balance: string;
  locked_balance: string;
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

const PERSON = `app_id = '${APP}' AND account_type = 'USER'`;

// ---------------------------------------------------------------- reading

/** The person's default wallet in this currency, or null. Never creates it. */
export async function findDefaultWallet(env: Environment, uid: string, currency = DEFAULT_CURRENCY): Promise<WalletRow | null> {
  const [w] = await query<WalletRow>(
    `SELECT * FROM wallets WHERE ${PERSON} AND owner_id = $1 AND currency = $2 AND environment = $3 AND is_default`,
    [ownerOf(uid), currency, env],
    env
  );
  return w ?? null;
}

/** The person's default wallet if they opened one (balance and state only), without ever creating it. */
export async function findUserWallet(env: Environment, user: Pick<LightPayUser, 'uid'>, currency = DEFAULT_CURRENCY) {
  const w = await findDefaultWallet(env, user.uid, currency);
  return w ? { available_balance: w.available_balance, status: w.status } : null;
}

/** All the person's wallets (the default first), closed ones included only when asked. */
export async function listWallets(env: Environment, uid: string, opts: { currency?: string; includeClosed?: boolean } = {}) {
  return query<WalletRow>(
    `SELECT * FROM wallets WHERE ${PERSON} AND owner_id = $1 AND environment = $2
       AND ($3::text IS NULL OR currency = $3) AND ($4 OR status <> 'CLOSED')
     ORDER BY is_default DESC, created_at`,
    [ownerOf(uid), env, opts.currency ?? null, opts.includeClosed === true],
    env
  );
}

/** One of the person's wallets by id (refused if it belongs to someone else), or the default without id. */
export async function walletOf(env: Environment, uid: string, opts: { id?: string | null; currency?: string } = {}): Promise<WalletRow> {
  if (!opts.id) {
    const w = await findDefaultWallet(env, uid, opts.currency);
    if (!w) throw new ConnectError('Wallet introuvable.', 'WALLET_NOT_FOUND', 404);
    return w;
  }
  const [w] = await query<WalletRow>(`SELECT * FROM wallets WHERE id::text = $1 AND ${PERSON} AND owner_id = $2 AND environment = $3`, [
    String(opts.id),
    ownerOf(uid),
    env,
  ], env);
  if (!w) throw new ConnectError('Wallet introuvable.', 'WALLET_NOT_FOUND', 404);
  return w;
}

// ---------------------------------------------------------------- the default wallet (created on first sign-in)

const profileOf = (user: LightPayUser, current: Record<string, any> = {}) => ({
  email: user.email ?? current.email ?? null,
  name: user.name ?? current.name ?? null,
  picture: user.picture ?? current.picture ?? null,
});

/** The person's default wallet, created on first use; the profile copied on it is kept up to date. */
export async function userWallet(env: Environment, user: LightPayUser, currency = DEFAULT_CURRENCY): Promise<WalletRow> {
  const existing = await findDefaultWallet(env, user.uid, currency);
  if (existing) {
    const m = existing.metadata ?? {};
    const stale = (user.email && m.email !== user.email) || (user.name && m.name !== user.name) || (user.picture && m.picture !== user.picture);
    if (!stale) return existing;
    const profile = JSON.stringify(profileOf(user, m));
    await query(`UPDATE wallets SET metadata = metadata || $2, updated_at = NOW() WHERE ${PERSON} AND owner_id = $1 AND environment = $3`, [
      ownerOf(user.uid),
      profile,
      env,
    ], env);
    return { ...existing, metadata: { ...m, ...profileOf(user, m) } };
  }
  // First wallet: account_id = owner_id. If it exists without being the default (no default left), it becomes it.
  const [created] = await query<WalletRow>(
    `INSERT INTO wallets (app_id, account_id, owner_id, account_type, currency, environment, label, country, is_default, metadata)
     VALUES ('${APP}', $1, $1, 'USER', $2, $3, 'Principal', $4, TRUE, $5)
     ON CONFLICT (app_id, account_id, currency, environment)
     DO UPDATE SET metadata = wallets.metadata || EXCLUDED.metadata, is_default = TRUE, updated_at = NOW()
     RETURNING *`,
    [ownerOf(user.uid), currency, env, DEFAULT_COUNTRY, JSON.stringify(profileOf(user))],
    env
  );
  return created;
}

// ---------------------------------------------------------------- opening, naming, choosing the default, closing

const cleanLabel = (raw: unknown) => {
  const label = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!label || label.length > LABEL_MAX) throw new ConnectError(`Nom du wallet : 1 à ${LABEL_MAX} caractères.`, 'INVALID_LABEL');
  return label;
};

/**
 * Opens another wallet for the person. `max` (from the admin's controls) caps the wallets not closed.
 * The new wallet copies the profile of the default one and is never the default itself.
 */
export async function openWallet(
  env: Environment,
  user: LightPayUser,
  input: { label: unknown; country?: string; currency?: string },
  max: number
): Promise<WalletRow> {
  const label = cleanLabel(input.label);
  const currency = input.currency ?? DEFAULT_CURRENCY;
  const main = await userWallet(env, user, currency);
  if (main.status !== 'ACTIVE') throw new ConnectError('Votre compte LightPay est fermé ou gelé.', 'ACCOUNT_CLOSED', 403);
  const open = await listWallets(env, user.uid);
  if (open.length >= max) throw new ConnectError(`Vous avez déjà ${open.length} wallets : c’est le maximum.`, 'TOO_MANY_WALLETS', 409);
  const [w] = await query<WalletRow>(
    `INSERT INTO wallets (app_id, account_id, owner_id, account_type, currency, environment, label, country, is_default, metadata, country_confirmed_at)
     VALUES ('${APP}', $1, $2, 'USER', $3, $4, $5, $6, FALSE, $7, NOW()) RETURNING *`,
    [
      `${ownerOf(user.uid)}/w_${crypto.randomBytes(9).toString('base64url')}`,
      ownerOf(user.uid),
      currency,
      env,
      label,
      input.country ?? main.country ?? DEFAULT_COUNTRY,
      JSON.stringify(profileOf(user, main.metadata)),
    ],
    env
  );
  return w;
}

export async function renameWallet(env: Environment, uid: string, id: string, rawLabel: unknown) {
  const w = await walletOf(env, uid, { id });
  const [renamed] = await query<WalletRow>(`UPDATE wallets SET label = $2, updated_at = NOW() WHERE id = $1 RETURNING *`, [w.id, cleanLabel(rawLabel)], env);
  return renamed;
}

/** Makes this wallet the default of its currency (one transaction: there is never zero or two defaults). */
export async function setDefaultWallet(env: Environment, uid: string, id: string) {
  const w = await walletOf(env, uid, { id });
  if (w.status !== 'ACTIVE') throw new ConnectError('Ce wallet n’est pas actif.', 'WALLET_NOT_ACTIVE', 409);
  if (w.is_default) return w;
  const client = await getClient(env);
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE wallets SET is_default = FALSE, updated_at = NOW() WHERE ${PERSON} AND owner_id = $1 AND currency = $2 AND environment = $3 AND is_default`, [
      w.owner_id,
      w.currency,
      env,
    ]);
    const { rows } = await client.query(`UPDATE wallets SET is_default = TRUE, updated_at = NOW() WHERE id = $1 RETURNING *`, [w.id]);
    await client.query('COMMIT');
    return rows[0] as WalletRow;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Why a wallet cannot be emptied of its history yet: money in it, locked, or about to leave. Null when free. */
export async function walletBusy(env: Environment, w: Pick<WalletRow, 'id' | 'available_balance' | 'locked_balance'>) {
  if (BigInt(w.available_balance) !== 0n || BigInt(w.locked_balance) !== 0n) return 'BALANCE_NOT_EMPTY';
  const [hold] = await query(`SELECT 1 FROM holds WHERE (wallet_id = $1 OR payer_wallet_id = $1) AND status IN ('ACTIVE', 'DISPUTED') LIMIT 1`, [w.id], env);
  if (hold) return 'PENDING_PAYMENTS';
  const [payout] = await query(`SELECT 1 FROM payouts WHERE wallet_id = $1 AND status IN ('SCHEDULED', 'HELD', 'PENDING') LIMIT 1`, [w.id], env);
  if (payout) return 'PENDING_PAYOUTS';
  return null;
}

const BUSY_MESSAGES: Record<string, string> = {
  BALANCE_NOT_EMPTY: 'Videz d’abord ce wallet : il reste de l’argent disponible ou bloqué.',
  PENDING_PAYMENTS: 'Des paiements sont encore en attente de validation.',
  PENDING_PAYOUTS: 'Un retrait est encore en cours.',
};
export const busyError = (code: string) => new ConnectError(BUSY_MESSAGES[code] ?? code, code, 409);

/** Closes one wallet (kept for the ledger history). Never the default: choose another default first. */
export async function closeWallet(env: Environment, uid: string, id: string) {
  const w = await walletOf(env, uid, { id });
  if (w.status === 'CLOSED') return w;
  if (w.is_default) throw new ConnectError('Choisissez d’abord un autre wallet par défaut.', 'DEFAULT_WALLET', 409);
  const busy = await walletBusy(env, w);
  if (busy) throw busyError(busy);
  await query(`UPDATE connections SET status = 'REVOKED', revoked_at = NOW(), updated_at = NOW() WHERE wallet_id = $1 AND status = 'ACTIVE'`, [w.id], env);
  const [closed] = await query<WalletRow>(`UPDATE wallets SET status = 'CLOSED', updated_at = NOW() WHERE id = $1 RETURNING *`, [w.id], env);
  return closed;
}

/** Every wallet of the person in this environment is closed (account closing; checks are the caller's). */
export async function closeAllWallets(env: Environment, uid: string) {
  await query(
    `UPDATE wallets SET status = 'CLOSED', metadata = metadata || '{"closed": true}'::jsonb, updated_at = NOW() WHERE ${PERSON} AND owner_id = $1 AND environment = $2`,
    [ownerOf(uid), env],
    env
  );
}
