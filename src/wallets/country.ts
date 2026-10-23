/**
 * The country of a person's wallet.
 *
 * Choosing: the first wallet was opened in Congo by default (migration 027). The person chooses its country once,
 * before using it (when several countries are open); wallets opened later carry the country chosen when opening them.
 *
 * Changing: afterwards, moving a wallet to another country is a request the admin decides. On approval the wallet
 * changes country and LightPay's swap fee (Frais et minimums: swap_fee_bps, swap_fee_min) is taken from its available
 * balance, credited to the main wallet as « Frais LightPay - changement de pays ». The CFA franc is one unit inside
 * LightPay (1 XAF = 1 XOF), so the balance keeps its amount; a country outside the CFA zone is refused for now.
 */
import crypto from 'crypto';
import { query } from '../db/pool.js';
import { LedgerEngine } from '../db/ledger.js';
import { ConnectError } from '../db/connect.js';
import { lightpayRevenueWallet } from '../db/fee-wallet.js';
import { logActivity } from '../db/activity.js';
import { Environment } from '../types/index.js';
import type { LightPayUser } from '../security/user-token.js';
import { countryByCode, usableCountries } from '../rails/registry.js';
import { swapFee } from '../payments/fees.js';
import { userWallet, walletOf, WalletRow } from './index.js';

/** The franc LightPay counts in: a wallet can move between these countries without any rate. */
const FCFA = ['XAF', 'XOF'];

export interface CountryRequest {
  id: string;
  environment: Environment;
  wallet_id: string;
  uid: string;
  from_country: string | null;
  to_country: string;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  fee_amount: string | null;
  transaction_id: string | null;
  decided_by: string | null;
  decision_note: string | null;
  created_at: Date;
  updated_at: Date;
  decided_at: Date | null;
}

/** An open country a person may choose (one of the countries people can use now). */
function openCountry(code: unknown) {
  const country = usableCountries().find((c) => c.code === String(code ?? '').toUpperCase());
  if (!country) throw new ConnectError('Ce pays n’est pas ouvert sur LightPay.', 'COUNTRY_NOT_OPEN');
  if (!FCFA.includes(country.currency)) throw new ConnectError('Ce pays n’est pas encore disponible pour un wallet.', 'COUNTRY_NOT_SUPPORTED');
  return country;
}

/** The person must still choose the country of this wallet (not chosen, and more than one country open). */
export const mustChooseCountry = (w: Pick<WalletRow, 'country'> & { country_confirmed_at?: Date | null }) => !w.country_confirmed_at && usableCountries().length > 1;

/** The first choice of the default wallet's country (once; afterwards it is a request to the admin). */
export async function chooseCountry(env: Environment, user: LightPayUser, code: unknown) {
  const country = openCountry(code);
  const wallet = await userWallet(env, user);
  const [updated] = await query<WalletRow>(
    `UPDATE wallets SET country = $2, country_confirmed_at = NOW(), updated_at = NOW() WHERE id = $1 AND country_confirmed_at IS NULL RETURNING *`,
    [wallet.id, country.code],
    env
  );
  if (!updated) throw new ConnectError('Le pays de ce wallet est déjà choisi : demandez un changement depuis le wallet.', 'COUNTRY_ALREADY_CHOSEN', 409);
  return updated;
}

/** The request waiting for a wallet, if any. */
export async function pendingCountryRequest(env: Environment, walletId: string): Promise<CountryRequest | null> {
  const [r] = await query<CountryRequest>(`SELECT * FROM wallet_country_requests WHERE wallet_id = $1 AND status = 'PENDING'`, [walletId], env);
  return r ?? null;
}

/** What the move would cost now (the fee is taken again on the balance of the day of approval). */
export const countryChangeQuote = (env: Environment, w: Pick<WalletRow, 'available_balance'>) => ({
  balance: String(w.available_balance),
  fee: swapFee(env, BigInt(w.available_balance)).toString(),
});

/** The person asks to move one of their wallets to another country. */
export async function requestCountryChange(env: Environment, user: LightPayUser, walletId: string, code: unknown, reasonInput?: unknown) {
  const wallet = await walletOf(env, user.uid, { id: walletId });
  if (wallet.status !== 'ACTIVE') throw new ConnectError('Ce wallet est fermé ou gelé.', 'WALLET_NOT_ACTIVE', 409);
  const country = openCountry(code);
  if (country.code === wallet.country) throw new ConnectError('Ce wallet est déjà dans ce pays.', 'SAME_COUNTRY');
  if (await pendingCountryRequest(env, wallet.id)) throw new ConnectError('Une demande est déjà en attente pour ce wallet.', 'REQUEST_PENDING', 409);
  const reason = String(reasonInput ?? '').trim().slice(0, 300) || null;
  try {
    const [r] = await query<CountryRequest>(
      `INSERT INTO wallet_country_requests (id, environment, wallet_id, uid, from_country, to_country, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [`wcr_${crypto.randomBytes(12).toString('base64url')}`, env, wallet.id, user.uid, wallet.country, country.code, reason],
      env
    );
    return r;
  } catch (err: any) {
    if (err?.code === '23505') throw new ConnectError('Une demande est déjà en attente pour ce wallet.', 'REQUEST_PENDING', 409);
    throw err;
  }
}

export async function cancelCountryRequest(env: Environment, user: LightPayUser, walletId: string) {
  const wallet = await walletOf(env, user.uid, { id: walletId });
  const [r] = await query<CountryRequest>(
    `UPDATE wallet_country_requests SET status = 'CANCELLED', updated_at = NOW(), decided_at = NOW() WHERE wallet_id = $1 AND status = 'PENDING' RETURNING *`,
    [wallet.id],
    env
  );
  if (!r) throw new ConnectError('Aucune demande en attente pour ce wallet.', 'NO_PENDING_REQUEST', 404);
  return r;
}

// ---------------------------------------------------------------- the admin's decision

export class CountryRequestError extends Error {
  constructor(message: string, public code: string, public statusCode = 400) {
    super(message);
  }
}

const REQUEST_COLUMNS = `r.*, w.label AS wallet_label, w.available_balance::text AS available_balance, w.locked_balance::text AS locked_balance,
  w.currency, w.status AS wallet_status, w.metadata->>'name' AS owner_name, w.metadata->>'email' AS owner_email`;

export const listCountryRequests = (env: Environment, status: string) =>
  query(
    `SELECT ${REQUEST_COLUMNS} FROM wallet_country_requests r JOIN wallets w ON w.id = r.wallet_id
     WHERE r.environment = $1 AND ($2 = '' OR r.status = $2) ORDER BY (r.status = 'PENDING') DESC, r.created_at DESC LIMIT 200`,
    [env, status],
    env
  );

export async function getCountryRequest(env: Environment, id: string) {
  const [r] = await query(`SELECT ${REQUEST_COLUMNS} FROM wallet_country_requests r JOIN wallets w ON w.id = r.wallet_id WHERE r.id = $1 AND r.environment = $2`, [id, env], env);
  if (!r) throw new CountryRequestError('Demande introuvable.', 'NOT_FOUND', 404);
  return { ...r, fee_now: r.status === 'PENDING' ? swapFee(env, BigInt(r.available_balance)).toString() : r.fee_amount };
}

export const countPendingCountryRequests = async (env: Environment) =>
  Number((await query(`SELECT COUNT(*)::int AS n FROM wallet_country_requests WHERE environment = $1 AND status = 'PENDING'`, [env], env))[0]?.n ?? 0);

/** Approves: the swap fee (on the available balance now) goes to LightPay, then the wallet changes country. */
export async function approveCountryRequest(env: Environment, id: string, by: string) {
  const [r] = await query<CountryRequest>(`SELECT * FROM wallet_country_requests WHERE id = $1 AND environment = $2`, [id, env], env);
  if (!r) throw new CountryRequestError('Demande introuvable.', 'NOT_FOUND', 404);
  if (r.status !== 'PENDING') throw new CountryRequestError('Cette demande n’est plus en attente.', 'NOT_PENDING', 409);
  const [wallet] = await query<WalletRow>(`SELECT * FROM wallets WHERE id = $1`, [r.wallet_id], env);
  if (!wallet || wallet.status !== 'ACTIVE') throw new CountryRequestError('Ce wallet n’est plus actif.', 'WALLET_NOT_ACTIVE', 409);
  if (!countryByCode(r.to_country)) throw new CountryRequestError('Ce pays n’existe plus dans le registre.', 'COUNTRY_UNKNOWN', 409);
  const fee = swapFee(env, BigInt(wallet.available_balance));
  let transactionId: string | null = null;
  if (fee > 0n) {
    const toName = countryByCode(r.to_country)?.name ?? r.to_country;
    const result: any = await LedgerEngine.executeTransaction({
      appId: 'mainapp',
      environment: env,
      idempotencyKey: `country-change:${r.id}`,
      type: 'TRANSFER',
      amount: fee,
      feeAmount: fee,
      currency: wallet.currency,
      skipQuotas: true,
      metadata: { kind: 'COUNTRY_CHANGE_FEE', request: r.id, from_country: r.from_country, to_country: r.to_country },
      postings: [
        { walletId: wallet.id, direction: 'DEBIT', amount: fee, description: `Changement de pays vers ${toName}` },
        { walletId: await lightpayRevenueWallet(env, wallet.currency), direction: 'CREDIT', amount: fee, description: `Frais LightPay - changement de pays ${r.id}` },
      ],
    });
    transactionId = result?.transactionId ?? result?.transaction?.id ?? null;
    await logActivity(env, {
      walletId: wallet.id, kind: 'TRANSFER', direction: 'OUT', status: 'SUCCEEDED', amount: fee, fees: fee, total: fee, currency: wallet.currency,
      counterparty: `Changement de pays vers ${toName}`, refType: 'country_change', refId: r.id,
    });
  }
  await query(`UPDATE wallets SET country = $2, country_confirmed_at = NOW(), updated_at = NOW() WHERE id = $1`, [wallet.id, r.to_country], env);
  const [done] = await query<CountryRequest>(
    `UPDATE wallet_country_requests SET status = 'APPROVED', fee_amount = $2, transaction_id = $3, decided_by = $4, decided_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'PENDING' RETURNING *`,
    [r.id, fee.toString(), transactionId, by],
    env
  );
  return done ?? r;
}

export async function rejectCountryRequest(env: Environment, id: string, by: string, noteInput: unknown) {
  const note = String(noteInput ?? '').trim().slice(0, 300);
  if (!note) throw new CountryRequestError('Indiquez la raison du refus : la personne la verra.', 'REASON_REQUIRED');
  const [r] = await query<CountryRequest>(
    `UPDATE wallet_country_requests SET status = 'REJECTED', decided_by = $3, decision_note = $4, decided_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND environment = $2 AND status = 'PENDING' RETURNING *`,
    [id, env, by, note],
    env
  );
  if (!r) throw new CountryRequestError('Cette demande n’est plus en attente.', 'NOT_PENDING', 409);
  return r;
}

/** The person's last request for a wallet (pending, or the last decision to show). */
export async function lastCountryRequest(env: Environment, walletId: string): Promise<CountryRequest | null> {
  const [r] = await query<CountryRequest>(`SELECT * FROM wallet_country_requests WHERE wallet_id = $1 ORDER BY created_at DESC LIMIT 1`, [walletId], env);
  return r ?? null;
}
