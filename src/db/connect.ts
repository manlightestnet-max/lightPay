import crypto from 'crypto';
import { query } from './pool.js';
import { LedgerEngine } from './ledger.js';
import { Escrow } from './escrow.js';
import { Environment } from '../types/index.js';
import { LightPayUser } from '../security/user-token.js';
import { isReservedAppId } from '../security/app-identity.js';
import { appName, failureOf, logActivity } from './activity.js';

/**
 * LIGHTPAY CONNECT — an app acts on a person's wallet only through a connection that
 * person approved (OAuth 2 authorization code + PKCE S256), limited to its scopes.
 */

export const SCOPES = ['balance:read', 'payee', 'deposit', 'charge'] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_LABELS: Record<Scope, string> = {
  'balance:read': 'Voir le solde et l’historique de votre wallet',
  payee: 'Vous verser l’argent de vos ventes sur votre wallet',
  deposit: 'Vous proposer des recharges de votre wallet',
  charge: 'Débiter votre wallet pour vos achats',
};

export class ConnectError extends Error {
  constructor(message: string, public code: string, public statusCode = 400) {
    super(message);
  }
}

export interface Connection {
  id: string;
  app_id: string;
  environment: Environment;
  wallet_id: string;
  user_uid: string;
  scopes: Scope[];
  charge_limit: string;
  status: 'ACTIVE' | 'REVOKED';
  created_at: Date;
  revoked_at: Date | null;
}

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const DEFAULT_CURRENCY = 'XAF';

// ---------------------------------------------------------------- the person's wallet

/**
 * The person's LightPay wallet (created on first sign-in), per environment.
 * Read first: a plain read never writes (balance polling must not contend with payments);
 * the profile is only rewritten when the name or e-mail actually changed.
 */
/** The person's LightPay wallet if they opened one, without ever creating it. */
export async function findUserWallet(environment: Environment, user: LightPayUser, currency = DEFAULT_CURRENCY) {
  const [existing] = await query(
    `SELECT available_balance::text, status FROM wallets WHERE app_id = 'mainapp' AND account_id = $1 AND currency = $2 AND environment = $3`,
    [`user:${user.uid}`, currency, environment],
    environment
  );
  return existing ?? null;
}

export async function userWallet(environment: Environment, user: LightPayUser, currency = DEFAULT_CURRENCY) {
  const [existing] = await query(
    `SELECT * FROM wallets WHERE app_id = 'mainapp' AND account_id = $1 AND currency = $2 AND environment = $3`,
    [`user:${user.uid}`, currency, environment],
    environment
  );
  if (existing) {
    const stale = (user.email && existing.metadata?.email !== user.email) || (user.name && existing.metadata?.name !== user.name);
    if (!stale) return existing;
    const [updated] = await query(
      `UPDATE wallets SET metadata = metadata || $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [existing.id, JSON.stringify({ email: user.email ?? existing.metadata?.email, name: user.name ?? existing.metadata?.name })],
      environment
    );
    return updated;
  }
  return (
    await query(
      `INSERT INTO wallets (app_id, account_id, account_type, currency, environment, metadata)
       VALUES ('mainapp', $1, 'USER', $2, $3, $4)
       ON CONFLICT (app_id, account_id, currency, environment)
       DO UPDATE SET metadata = wallets.metadata || EXCLUDED.metadata, updated_at = NOW()
       RETURNING *`,
      [`user:${user.uid}`, currency, environment, JSON.stringify({ email: user.email, name: user.name })],
      environment
    )
  )[0];
}

export async function walletStatement(environment: Environment, walletId: string, limit = 50) {
  return query(
    `SELECT e.id, e.direction, e.bucket, e.amount::text, e.balance_after::text, e.description, e.created_at, t.type, t.reference
     FROM ledger_entries e JOIN transactions t ON t.id = e.transaction_id
     WHERE e.wallet_id = $1 ORDER BY e.created_at DESC LIMIT $2`,
    [walletId, Math.min(Math.max(limit, 1), 200)],
    environment
  );
}

// ---------------------------------------------------------------- apps

const activeApp = async (appId: string, environment: Environment) => {
  const [app] = await query(`SELECT id, name, is_active, redirect_uris FROM apps WHERE id = $1`, [appId], environment);
  if (!app || !app.is_active || isReservedAppId(app.id)) throw new ConnectError('Unknown application', 'APP_NOT_FOUND', 404);
  return app as { id: string; name: string; redirect_uris: string[] };
};

export async function appPublicInfo(appId: string, environment: Environment) {
  const app = await activeApp(appId, environment);
  return { id: app.id, name: app.name };
}

const validRedirectUri = (uri: string) => {
  try {
    const url = new URL(uri);
    return (url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1') && !url.hash;
  } catch {
    return false;
  }
};

/** An app declares where LightPay may send people back (exact match, both environments). */
export async function setRedirectUris(appId: string, uris: string[]) {
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) throw new ConnectError('redirect_uris: 1 to 10 URLs', 'INVALID_REDIRECT_URIS');
  const bad = uris.find((u) => typeof u !== 'string' || !validRedirectUri(u));
  if (bad) throw new ConnectError(`Invalid redirect URI: ${bad} (https, no #fragment)`, 'INVALID_REDIRECT_URIS');
  const value = JSON.stringify([...new Set(uris)]);
  await Promise.all([
    query(`UPDATE apps SET redirect_uris = $2, updated_at = NOW() WHERE id = $1`, [appId, value], 'production'),
    query(`UPDATE apps SET redirect_uris = $2, updated_at = NOW() WHERE id = $1`, [appId, value], 'sandbox'),
  ]);
  return [...new Set(uris)];
}

// ---------------------------------------------------------------- authorization

export interface ApproveInput {
  appId: string;
  scopes: string[];
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  chargeLimit?: bigint;
}

const parseScopes = (scopes: string[]): Scope[] => {
  const unique = [...new Set(scopes)];
  if (unique.length === 0 || unique.some((s) => !SCOPES.includes(s as Scope))) {
    throw new ConnectError(`scope must be among: ${SCOPES.join(' ')}`, 'INVALID_SCOPE');
  }
  return unique as Scope[];
};

/** Checks the request before showing the consent screen (and again on approval). */
export async function validateAuthorizeRequest(environment: Environment, input: Omit<ApproveInput, 'chargeLimit'>) {
  const app = await activeApp(input.appId, environment);
  if (!(app.redirect_uris ?? []).includes(input.redirectUri)) {
    // The exact address, so the app's developer sees what to declare (Paramètres → Adresses de retour).
    throw new ConnectError(`Adresse de retour non déclarée par cette app : ${input.redirectUri}`, 'INVALID_REDIRECT_URI');
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.codeChallenge)) throw new ConnectError('code_challenge must be a S256 PKCE challenge', 'INVALID_PKCE');
  const scopes = parseScopes(input.scopes);
  return { app: { id: app.id, name: app.name }, scopes: scopes.map((s) => ({ scope: s, label: SCOPE_LABELS[s] })) };
}

/** The person approves: connection created (or updated) and a one-time code issued. */
export async function approve(environment: Environment, user: LightPayUser, input: ApproveInput) {
  await validateAuthorizeRequest(environment, input);
  const scopes = parseScopes(input.scopes);
  const chargeLimit = scopes.includes('charge') ? input.chargeLimit ?? 0n : 0n;
  if (scopes.includes('charge') && chargeLimit <= 0n) throw new ConnectError('A charge limit is required to allow charges', 'CHARGE_LIMIT_REQUIRED');
  const wallet = await userWallet(environment, user);

  const [connection] = await query(
    `INSERT INTO connections (id, app_id, environment, wallet_id, user_uid, scopes, charge_limit)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (app_id, environment, wallet_id) WHERE status = 'ACTIVE'
     DO UPDATE SET scopes = EXCLUDED.scopes, charge_limit = EXCLUDED.charge_limit, updated_at = NOW()
     RETURNING *`,
    [`conn_${crypto.randomBytes(16).toString('base64url')}`, input.appId, environment, wallet.id, user.uid, JSON.stringify(scopes), chargeLimit.toString()],
    environment
  );

  const code = crypto.randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO authorization_codes (code_hash, connection_id, app_id, environment, redirect_uri, code_challenge, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + interval '5 minutes')`,
    [sha256(code), connection.id, input.appId, environment, input.redirectUri, input.codeChallenge],
    environment
  );

  const back = new URL(input.redirectUri);
  back.searchParams.set('code', code);
  if (input.state) back.searchParams.set('state', input.state);
  return { redirect: back.toString() };
}

/** The app's server swaps the code (+ PKCE verifier) for the connection. One use, 5 minutes. */
export async function exchangeCode(appId: string, environment: Environment, code: string, redirectUri: string, codeVerifier: string) {
  if (!code || !codeVerifier) throw new ConnectError('code and code_verifier are required', 'INVALID_GRANT');
  const [row] = await query(
    `UPDATE authorization_codes SET used_at = NOW()
     WHERE code_hash = $1 AND app_id = $2 AND environment = $3 AND used_at IS NULL AND expires_at > NOW()
     RETURNING *`,
    [sha256(code), appId, environment],
    environment
  );
  if (!row) throw new ConnectError('Invalid, expired or already used code', 'INVALID_GRANT');
  const challenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const pkceOk = challenge.length === row.code_challenge.length && crypto.timingSafeEqual(Buffer.from(challenge), Buffer.from(row.code_challenge));
  if (!pkceOk || row.redirect_uri !== redirectUri) throw new ConnectError('Code verification failed', 'INVALID_GRANT');
  return connectionView(await getConnection(appId, environment, row.connection_id));
}

// ---------------------------------------------------------------- connections

export async function getConnection(appId: string, environment: Environment, id: string): Promise<Connection> {
  const [c] = await query(`SELECT * FROM connections WHERE id = $1 AND app_id = $2 AND environment = $3`, [id, appId, environment], environment);
  if (!c) throw new ConnectError('Connection not found', 'CONNECTION_NOT_FOUND', 404);
  if (c.status !== 'ACTIVE') throw new ConnectError('This person revoked the connection', 'CONNECTION_REVOKED', 403);
  return c;
}

export function requireScope(c: Connection, scope: Scope) {
  if (!c.scopes.includes(scope)) throw new ConnectError(`This connection does not allow "${scope}"`, 'SCOPE_NOT_GRANTED', 403);
}

export async function connectionView(c: Connection) {
  const [wallet] = await query(`SELECT metadata FROM wallets WHERE id = $1`, [c.wallet_id], c.environment);
  return {
    id: c.id,
    status: c.status,
    environment: c.environment,
    scopes: c.scopes,
    charge_limit: c.scopes.includes('charge') ? String(c.charge_limit) : null,
    account: { name: wallet?.metadata?.name ?? null, email: wallet?.metadata?.email ?? null },
    created_at: c.created_at,
  };
}

export async function listUserConnections(environment: Environment, user: LightPayUser) {
  return query(
    `SELECT c.id, c.app_id, a.name AS app_name, c.scopes, c.charge_limit::text, c.status, c.created_at, c.revoked_at
     FROM connections c JOIN apps a ON a.id = c.app_id
     WHERE c.user_uid = $1 AND c.environment = $2 ORDER BY c.created_at DESC`,
    [user.uid, environment],
    environment
  );
}

export async function revokeConnection(environment: Environment, user: LightPayUser, id: string) {
  const rows = await query(
    `UPDATE connections SET status = 'REVOKED', revoked_at = NOW(), updated_at = NOW() WHERE id = $1 AND user_uid = $2 AND status = 'ACTIVE' RETURNING id`,
    [id, user.uid],
    environment
  );
  if (rows.length === 0) throw new ConnectError('Connection not found', 'CONNECTION_NOT_FOUND', 404);
}

export async function connectionBalance(c: Connection) {
  const [w] = await query(`SELECT currency, available_balance::text, locked_balance::text FROM wallets WHERE id = $1`, [c.wallet_id], c.environment);
  return w;
}

// ---------------------------------------------------------------- charges

export interface ChargeInput {
  amount: bigint;
  feeAmount: bigint;
  reference?: string;
  description?: string;
  payeeConnectionId?: string;
  escrow: boolean;
  metadata?: Record<string, any>;
}

/** Wallet of a connected seller (scope payee) of this app. */
export async function payeeWallet(appId: string, environment: Environment, connectionId: string) {
  const payee = await getConnection(appId, environment, connectionId);
  requireScope(payee, 'payee');
  return payee;
}

/**
 * Debits the person's wallet (scope charge, within their limit) to a connected seller.
 * Journaled for the person, refusals included (limit, balance…).
 */
export async function charge(appId: string, environment: Environment, connectionId: string, idempotencyKey: string, input: ChargeInput) {
  const payer = await getConnection(appId, environment, connectionId);
  const journal = async (status: 'SUCCEEDED' | 'FAILED', err?: any, extra?: Record<string, any>) => {
    const f = err ? failureOf(err) : null;
    await logActivity(environment, {
      walletId: payer.wallet_id, kind: 'CHARGE', direction: 'OUT', status, amount: input.amount > 0n ? input.amount : 0n, total: input.amount > 0n ? input.amount : 0n,
      counterparty: await appName(environment, appId), reasonCode: f?.code, reason: f?.message, refType: 'charge', refId: `${appId}:${idempotencyKey}`,
      metadata: { reference: input.reference, description: input.description, escrow: input.escrow, ...(extra ?? {}) },
    });
  };
  try {
    const result: any = await chargeUnjournaled(appId, environment, connectionId, idempotencyKey, input);
    await journal('SUCCEEDED', undefined, result?.hold ? { hold_id: result.hold.id } : {});
    return result;
  } catch (err) {
    await journal('FAILED', err);
    throw err;
  }
}

async function chargeUnjournaled(appId: string, environment: Environment, connectionId: string, idempotencyKey: string, input: ChargeInput) {
  const payer = await getConnection(appId, environment, connectionId);
  requireScope(payer, 'charge');
  if (input.amount <= 0n) throw new ConnectError('amount must be greater than zero', 'INVALID_AMOUNT');
  if (input.feeAmount < 0n || input.feeAmount >= input.amount) throw new ConnectError('fee_amount must be >= 0 and < amount', 'INVALID_FEE');
  if (input.amount > BigInt(payer.charge_limit)) {
    throw new ConnectError(`Above the limit this person allowed (${payer.charge_limit}). Use a checkout session instead.`, 'ABOVE_CHARGE_LIMIT', 403);
  }
  if (!input.payeeConnectionId) throw new ConnectError('payee (a connected seller) is required', 'PAYEE_REQUIRED');
  const payee = await payeeWallet(appId, environment, input.payeeConnectionId);
  const [payerWallet] = await query(`SELECT currency FROM wallets WHERE id = $1`, [payer.wallet_id], environment);
  const currency = payerWallet?.currency ?? DEFAULT_CURRENCY;
  const metadata = { ...(input.metadata ?? {}), connection: payer.id, payee_connection: payee.id };

  if (input.escrow) {
    return Escrow.create({
      appId, environment, idempotencyKey, payerWalletId: payer.wallet_id, beneficiaryWalletId: payee.wallet_id,
      amount: input.amount, feeAmount: input.feeAmount, currency, reference: input.reference, reason: input.description, metadata,
    });
  }
  const fee = input.feeAmount;
  const [merchant] = await query(
    `INSERT INTO wallets (app_id, account_id, account_type, currency, environment, metadata)
     VALUES ($1, $1, 'MERCHANT', $2, $3, '{"role":"merchant_root"}')
     ON CONFLICT (app_id, account_id, currency, environment) DO UPDATE SET updated_at = NOW() RETURNING id`,
    [appId, currency, environment],
    environment
  );
  return LedgerEngine.executeTransaction({
    appId, environment, idempotencyKey, type: 'PAYMENT', amount: input.amount, feeAmount: fee, currency, reference: input.reference, metadata,
    postings: [
      { walletId: payer.wallet_id, direction: 'DEBIT', amount: input.amount, description: input.description },
      { walletId: payee.wallet_id, direction: 'CREDIT', amount: input.amount - fee, description: input.description },
      ...(fee > 0n ? [{ walletId: merchant.id, direction: 'CREDIT' as const, amount: fee, description: 'Platform fee' }] : []),
    ],
  });
}
