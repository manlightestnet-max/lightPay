import crypto from 'crypto';
import { query } from './pool.js';
import { LedgerEngine } from './ledger.js';
import { Environment } from '../types/index.js';
import { LightPayUser } from '../security/user-token.js';
import { ConnectError, SCOPES, Scope, userWallet } from './connect.js';
import { MOBILE_NETWORKS, MobileNetwork, normalizeCongoMsisdn } from '../payments/mobile-money.js';
import { sendPayout } from './payouts.js';
import { minMobileMoneyAmount } from '../payments/fees.js';
import { maskMsisdn } from './checkout.js';

/**
 * The person's own money moves (from their LightPay account space):
 *   deposit   mobile money -> my wallet            (hosted payment page)
 *   send      my wallet -> another LightPay user   (by e-mail)
 *   withdraw  my wallet -> mobile money number     (payout; reversed if the network fails)
 *   close     account closed once everything is at zero and nothing is pending
 */

const MIN_WITHDRAWAL = 500n;
const newId = (prefix: string) => `${prefix}${crypto.randomBytes(18).toString('base64url')}`;
const txId = (r: any): string | null => r?.transactionId ?? r?.transaction?.id ?? null;

const positive = (value: unknown, field = 'amount') => {
  let amount: bigint;
  try {
    amount = BigInt(String(value));
  } catch {
    throw new ConnectError(`${field} must be a whole number`, 'INVALID_AMOUNT');
  }
  if (amount <= 0n) throw new ConnectError(`${field} must be greater than zero`, 'INVALID_AMOUNT');
  return amount;
};

const activeWallet = async (environment: Environment, user: LightPayUser) => {
  const wallet = await userWallet(environment, user);
  if (wallet.status !== 'ACTIVE') throw new ConnectError('This LightPay account is closed', 'ACCOUNT_CLOSED', 403);
  return wallet;
};

/** Top-up of my own wallet: a DEPOSIT session paid on the hosted page by mobile money. */
export async function selfDeposit(environment: Environment, user: LightPayUser, amountInput: unknown, idempotencyKey: string) {
  const amount = positive(amountInput);
  if (amount < minMobileMoneyAmount()) throw new ConnectError(`Recharge minimum : ${minMobileMoneyAmount()} FCFA.`, 'BELOW_MOBILE_MONEY_MINIMUM');
  const wallet = await activeWallet(environment, user);
  const existing = (
    await query(`SELECT id FROM checkout_sessions WHERE app_id = 'mainapp' AND environment = $1 AND idempotency_key = $2`, [environment, `self:${user.uid}:${idempotencyKey}`], environment)
  )[0];
  if (existing) return { session_id: existing.id, checkout_path: `/pay/${existing.id}` };
  const id = newId(environment === 'sandbox' ? 'cs_test_' : 'cs_live_');
  await query(
    `INSERT INTO checkout_sessions (id, app_id, environment, idempotency_key, kind, amount, fee_amount, currency, description, payee_wallet_id, escrow, methods, return_url, expires_at)
     VALUES ($1, 'mainapp', $2, $3, 'DEPOSIT', $4, 0, $5, 'Recharge du wallet LightPay', $6, FALSE, '["mobile_money"]'::jsonb, NULL, NOW() + interval '30 minutes')`,
    [id, environment, `self:${user.uid}:${idempotencyKey}`, amount.toString(), wallet.currency, wallet.id],
    environment
  );
  return { session_id: id, checkout_path: `/pay/${id}` };
}

/** Send money to another LightPay user, found by e-mail. */
export async function sendMoney(environment: Environment, user: LightPayUser, input: { to: unknown; amount: unknown; note?: unknown }, idempotencyKey: string) {
  const amount = positive(input.amount);
  const to = String(input.to ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new ConnectError('Adresse e-mail du destinataire invalide.', 'INVALID_RECIPIENT');
  if (to === (user.email ?? '').toLowerCase()) throw new ConnectError('Vous ne pouvez pas vous envoyer de l’argent.', 'SAME_WALLET');
  const from = await activeWallet(environment, user);
  const [recipient] = await query(
    `SELECT id, metadata FROM wallets WHERE app_id = 'mainapp' AND account_type = 'USER' AND environment = $1 AND currency = $2 AND status = 'ACTIVE' AND lower(metadata->>'email') = $3 LIMIT 1`,
    [environment, from.currency, to],
    environment
  );
  if (!recipient) throw new ConnectError('Aucun compte LightPay avec cet e-mail.', 'RECIPIENT_NOT_FOUND', 404);
  const note = String(input.note ?? '').slice(0, 140) || undefined;
  const result = await LedgerEngine.executeTransaction({
    appId: 'mainapp',
    environment,
    idempotencyKey: `send:${user.uid}:${idempotencyKey}`,
    type: 'TRANSFER',
    amount,
    currency: from.currency,
    metadata: { kind: 'P2P', from_uid: user.uid, to_email: to, note },
    postings: [
      { walletId: from.id, direction: 'DEBIT', amount, description: `Envoi à ${recipient.metadata?.name || to}${note ? ` · ${note}` : ''}` },
      { walletId: recipient.id, direction: 'CREDIT', amount, description: `Reçu de ${user.name || user.email}${note ? ` · ${note}` : ''}` },
    ],
  });
  return { transaction_id: txId(result), duplicate: result.duplicate, to: { name: recipient.metadata?.name ?? null, email: to }, amount: amount.toString() };
}

/** Withdraw available money to a mobile-money number. Locked money can never leave. */
export async function withdraw(environment: Environment, user: LightPayUser, input: { amount: unknown; msisdn: unknown; network: unknown }, idempotencyKey: string) {
  const amount = positive(input.amount);
  if (amount < MIN_WITHDRAWAL) throw new ConnectError(`Retrait minimum : ${MIN_WITHDRAWAL} FCFA.`, 'BELOW_MINIMUM');
  const network = String(input.network ?? '') as MobileNetwork;
  if (!MOBILE_NETWORKS.includes(network)) throw new ConnectError(`network: ${MOBILE_NETWORKS.join(', ')}`, 'INVALID_NETWORK');
  const msisdn = normalizeCongoMsisdn(String(input.msisdn ?? ''));
  if (!msisdn) throw new ConnectError('Numéro invalide : 9 chiffres, par exemple 06 512 44 81.', 'INVALID_MSISDN');
  const wallet = await activeWallet(environment, user);

  const payout = await sendPayout({
    environment,
    appId: 'mainapp',
    walletId: wallet.id,
    msisdn,
    network,
    amount,
    currency: wallet.currency,
    reason: 'WITHDRAWAL',
    reference: `withdraw:${user.uid}:${idempotencyKey}`,
    description: `Retrait vers ${maskMsisdn(msisdn)}`,
  });
  return payoutView(payout);
}

const payoutView = (p: any) => ({
  id: p.id,
  status: p.status,
  amount: String(p.amount),
  currency: p.currency,
  to: maskMsisdn(p.msisdn),
  network: p.network,
  failure_code: p.failure_code,
  created_at: p.created_at,
});

export async function listWithdrawals(environment: Environment, user: LightPayUser) {
  const wallet = await userWallet(environment, user);
  return (await query(`SELECT * FROM payouts WHERE wallet_id = $1 AND reason = 'WITHDRAWAL' ORDER BY created_at DESC LIMIT 20`, [wallet.id], environment)).map(payoutView);
}

/** The person narrows (or re-tunes) what an app may do. Scopes can only be removed here. */
export async function updateConnection(environment: Environment, user: LightPayUser, id: string, input: { scopes?: unknown; charge_limit?: unknown }) {
  const [c] = await query(`SELECT * FROM connections WHERE id = $1 AND user_uid = $2 AND environment = $3 AND status = 'ACTIVE'`, [id, user.uid, environment], environment);
  if (!c) throw new ConnectError('Connection not found', 'CONNECTION_NOT_FOUND', 404);
  let scopes: Scope[] = c.scopes;
  if (input.scopes !== undefined) {
    const next = [...new Set(Array.isArray(input.scopes) ? input.scopes.map(String) : [])];
    if (next.length === 0) throw new ConnectError('Gardez au moins une permission, ou retirez l’app.', 'INVALID_SCOPE');
    if (next.some((s) => !SCOPES.includes(s as Scope) || !c.scopes.includes(s))) {
      throw new ConnectError('Vous pouvez seulement retirer des permissions ici.', 'INVALID_SCOPE');
    }
    scopes = next as Scope[];
  }
  let limit = BigInt(c.charge_limit);
  if (input.charge_limit !== undefined) limit = positive(input.charge_limit, 'charge_limit');
  if (!scopes.includes('charge')) limit = 0n;
  await query(`UPDATE connections SET scopes = $2, charge_limit = $3, updated_at = NOW() WHERE id = $1`, [id, JSON.stringify(scopes), limit.toString()], environment);
  return { id, scopes, charge_limit: limit.toString() };
}

/**
 * Closes the LightPay account in both environments: only when nothing is left (no
 * balance, no money locked or pending). Connections are revoked; wallets are CLOSED
 * (kept for the ledger history). The identity itself is deleted by the page afterwards.
 */
export async function closeAccount(user: LightPayUser) {
  const envs: Environment[] = ['production', 'sandbox'];
  for (const env of envs) {
    const [w] = await query(`SELECT * FROM wallets WHERE app_id = 'mainapp' AND account_id = $1 AND environment = $2`, [`user:${user.uid}`, env], env);
    if (!w) continue;
    if (BigInt(w.available_balance) !== 0n || BigInt(w.locked_balance) !== 0n) {
      throw new ConnectError(
        `Videz d’abord votre wallet${env === 'sandbox' ? ' de test' : ''} : il reste de l’argent disponible ou bloqué.`,
        'BALANCE_NOT_EMPTY',
        409
      );
    }
    const [pending] = await query(
      `SELECT 1 FROM holds WHERE (wallet_id = $1 OR payer_wallet_id = $1) AND status IN ('ACTIVE', 'DISPUTED') LIMIT 1`,
      [w.id],
      env
    );
    if (pending) throw new ConnectError('Des paiements sont encore en attente de validation.', 'PENDING_PAYMENTS', 409);
  }
  for (const env of envs) {
    await query(`UPDATE connections SET status = 'REVOKED', revoked_at = NOW(), updated_at = NOW() WHERE user_uid = $1 AND status = 'ACTIVE'`, [user.uid], env);
    await query(
      `UPDATE wallets SET status = 'CLOSED', metadata = metadata || '{"closed": true}'::jsonb, updated_at = NOW() WHERE app_id = 'mainapp' AND account_id = $1`,
      [`user:${user.uid}`],
      env
    );
  }
  return { closed: true };
}
