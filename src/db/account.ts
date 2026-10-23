import crypto from 'crypto';
import { query } from './pool.js';
import { LedgerEngine } from './ledger.js';
import { Environment } from '../types/index.js';
import { findRecipient } from './identity.js';
import { LightPayUser } from '../security/user-token.js';
import { ConnectError, SCOPES, Scope } from './connect.js';
import { busyError, closeAllWallets, findDefaultWallet, listWallets, userWallet, walletBusy, walletOf } from '../wallets/index.js';
import { route as routeOperation } from '../rails/routing.js';
import { MobileNetwork, mobileNetworks, networkName } from '../payments/mobile-money.js';
import { countryOfNetwork, invalidNumberMessage, normalizeMsisdn, numberFitsNetwork } from '../rails/registry.js';
import { sendPayout } from './payouts.js';
import { failureOf, logActivity } from './activity.js';
import { FeeError, lightpayPayoutFee, minMobileMoneyAmount, minWithdrawalAmount, providerPayoutFee, swapBetween, withdrawalQuote } from '../payments/fees.js';
import { ensureProviderRates } from '../payments/provider-rates.js';
import { lightpayRevenueWallet } from './fee-wallet.js';
import { maskMsisdn } from './checkout.js';
import { guardMoney, guardWithdrawals } from '../security/lockdown.js';
import { assertNotSuspended, recordWithdrawalAttempt } from './withdrawal-guard.js';

/**
 * The person's own money moves (from their LightPay account space):
 *   deposit   mobile money -> my wallet            (hosted payment page)
 *   send      my wallet -> another LightPay user   (by e-mail)
 *   withdraw  my wallet -> mobile money number     (payout; reversed if the network fails)
 *   close     account closed once everything is at zero and nothing is pending
 */

const newId = (prefix: string) => `${prefix}${crypto.randomBytes(18).toString('base64url')}`;
const txId = (r: any): string | null => r?.transactionId ?? r?.transaction?.id ?? null;

/** Best-effort amount for the journal of a refused request. */
const safeAmount = (v: unknown): bigint => {
  try {
    const n = BigInt(String(v));
    return n > 0n ? n : 0n;
  } catch {
    return 0n;
  }
};

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

/** The wallet an operation uses: the one named (it must be the person's), the default one otherwise. */
const activeWallet = async (environment: Environment, user: LightPayUser, walletId?: unknown) => {
  const wallet = walletId ? await walletOf(environment, user.uid, { id: String(walletId) }) : await userWallet(environment, user);
  if (wallet.status !== 'ACTIVE') throw new ConnectError(walletId ? 'Ce wallet est fermé ou gelé.' : 'This LightPay account is closed', 'ACCOUNT_CLOSED', 403);
  return wallet;
};

/** Top-up of my own wallet: a DEPOSIT session paid on the hosted page by mobile money. */
export async function selfDeposit(environment: Environment, user: LightPayUser, amountInput: unknown, idempotencyKey: string, walletId?: unknown) {
  guardMoney();
  const amount = positive(amountInput);
  if (amount < minMobileMoneyAmount(environment)) throw new ConnectError(`Dépôt minimum : ${minMobileMoneyAmount(environment)} FCFA.`, 'BELOW_MOBILE_MONEY_MINIMUM');
  const wallet = await activeWallet(environment, user, walletId);
  const existing = (
    await query(`SELECT id FROM checkout_sessions WHERE app_id = 'mainapp' AND environment = $1 AND idempotency_key = $2`, [environment, `self:${user.uid}:${idempotencyKey}`], environment)
  )[0];
  if (existing) return { session_id: existing.id, checkout_path: `/pay/${existing.id}` };
  const id = newId(environment === 'sandbox' ? 'cs_test_' : 'cs_live_');
  await query(
    `INSERT INTO checkout_sessions (id, app_id, environment, idempotency_key, kind, amount, fee_amount, currency, description, payee_wallet_id, escrow, methods, return_url, expires_at)
     VALUES ($1, 'mainapp', $2, $3, 'DEPOSIT', $4, 0, $5, 'Dépôt sur le wallet LightPay', $6, FALSE, '["mobile_money"]'::jsonb, NULL, NOW() + interval '30 minutes')`,
    [id, environment, `self:${user.uid}:${idempotencyKey}`, amount.toString(), wallet.currency, wallet.id],
    environment
  );
  return { session_id: id, checkout_path: `/pay/${id}` };
}

/**
 * Send money to another LightPay user, found by e-mail or @name. Free when the receiver's wallet is in the same
 * country; otherwise the sender pays LightPay's swap fee on top (the receiver gets the whole amount).
 */
export async function sendMoney(environment: Environment, user: LightPayUser, input: { to: unknown; amount: unknown; note?: unknown; wallet_id?: unknown }, idempotencyKey: string) {
  await assertNotSuspended(environment, user.uid); // an account suspended for withdrawal attempts sends nothing either
  const from = await activeWallet(environment, user, input.wallet_id);
  const ref = `send:${user.uid}:${idempotencyKey}`;
  const to = String(input.to ?? '').trim().toLowerCase();
  const note = String(input.note ?? '').slice(0, 140) || undefined;
  try {
    const amount = positive(input.amount);
    if (!to) throw new ConnectError('Entrez un @nom d’utilisateur ou une adresse e-mail.', 'INVALID_RECIPIENT');
    const found = await findRecipient(environment, to, from.currency);
    if (found.uid === user.uid) throw new ConnectError('Vous ne pouvez pas vous envoyer de l’argent.', 'SAME_WALLET');
    const shown = found.name || (found.username ? `@${found.username}` : to);
    const recipient = { id: found.walletId, metadata: { name: shown } };
    const swap = swapBetween(environment, from.country, found.country, amount);
    const result = await LedgerEngine.executeTransaction({
      appId: 'mainapp',
      environment,
      idempotencyKey: ref,
      type: 'TRANSFER',
      amount: amount + swap,
      feeAmount: swap,
      currency: from.currency,
      metadata: { kind: 'P2P', from_uid: user.uid, to_uid: found.uid, to_username: found.username, note, ...(swap > 0n ? { swap_fee: swap.toString(), from_country: from.country, to_country: found.country } : {}) },
      postings: [
        { walletId: from.id, direction: 'DEBIT', amount, description: `Envoi à ${recipient.metadata?.name || to}${note ? ` · ${note}` : ''}` },
        { walletId: recipient.id, direction: 'CREDIT', amount, description: `Reçu de ${user.name || user.email}${note ? ` · ${note}` : ''}` },
        ...(await swapPostings(environment, from.id, from.currency, swap, ref)),
      ],
    });
    if (!result.duplicate) {
      const common = { kind: 'TRANSFER' as const, status: 'SUCCEEDED' as const, amount, currency: from.currency, refType: 'transfer', refId: ref };
      await logActivity(environment, { ...common, fees: swap, total: amount + swap, metadata: { note, ...(swap > 0n ? { swap_fee: swap.toString() } : {}) }, walletId: from.id, direction: 'OUT', counterparty: recipient.metadata?.name || to });
      await logActivity(environment, { ...common, total: amount, metadata: { note }, walletId: recipient.id, direction: 'IN', counterparty: user.name || user.email || 'LightPay' });
    }
    return { transaction_id: txId(result), duplicate: result.duplicate, to: { name: found.name, username: found.username, email: found.email }, amount: amount.toString(), swap_fee: swap.toString(), total: (amount + swap).toString() };
  } catch (err: any) {
    const f = failureOf(err);
    await logActivity(environment, {
      walletId: from.id, kind: 'TRANSFER', direction: 'OUT', status: 'FAILED', amount: safeAmount(input.amount), currency: from.currency,
      counterparty: to || null, reasonCode: f.code, reason: f.message, refType: 'transfer', refId: ref, metadata: { note },
    });
    throw err;
  }
}

/**
 * Between two of the person's own wallets (same franc), never another person's: instant, free inside a country; from
 * one country to another the swap fee is paid on top (the other wallet gets the whole amount).
 */
export async function moveBetweenWallets(environment: Environment, user: LightPayUser, input: { from: unknown; to: unknown; amount: unknown }, idempotencyKey: string) {
  guardMoney();
  await assertNotSuspended(environment, user.uid);
  const amount = positive(input.amount);
  const from = await activeWallet(environment, user, input.from);
  const to = await activeWallet(environment, user, input.to);
  if (from.id === to.id) throw new ConnectError('Choisissez deux wallets différents.', 'SAME_WALLET');
  if (from.currency !== to.currency) throw new ConnectError('Ces deux wallets n’ont pas la même monnaie.', 'CURRENCY_MISMATCH');
  const ref = `move:${user.uid}:${idempotencyKey}`;
  const swap = swapBetween(environment, from.country, to.country, amount);
  const result = await LedgerEngine.executeTransaction({
    appId: 'mainapp',
    environment,
    idempotencyKey: ref,
    type: 'TRANSFER',
    amount: amount + swap,
    feeAmount: swap,
    currency: from.currency,
    metadata: { kind: 'OWN_WALLETS', uid: user.uid, from_wallet: from.id, to_wallet: to.id, ...(swap > 0n ? { swap_fee: swap.toString(), from_country: from.country, to_country: to.country } : {}) },
    postings: [
      { walletId: from.id, direction: 'DEBIT', amount, description: `Vers mon wallet « ${to.label} »` },
      { walletId: to.id, direction: 'CREDIT', amount, description: `Depuis mon wallet « ${from.label} »` },
      ...(await swapPostings(environment, from.id, from.currency, swap, ref)),
    ],
  });
  if (!result.duplicate) {
    const common = { kind: 'TRANSFER' as const, status: 'SUCCEEDED' as const, amount, currency: from.currency, refType: 'move', refId: ref };
    await logActivity(environment, { ...common, fees: swap, total: amount + swap, metadata: swap > 0n ? { swap_fee: swap.toString() } : undefined, walletId: from.id, direction: 'OUT', counterparty: `Mon wallet « ${to.label} »` });
    await logActivity(environment, { ...common, total: amount, walletId: to.id, direction: 'IN', counterparty: `Mon wallet « ${from.label} »` });
  }
  return { transaction_id: txId(result), duplicate: result.duplicate, amount: amount.toString(), swap_fee: swap.toString(), total: (amount + swap).toString(), from: from.id, to: to.id };
}

/** The swap fee leaves the wallet as its own line and reaches LightPay's main wallet (« Frais LightPay - swap »). */
async function swapPostings(environment: Environment, walletId: string, currency: string, swap: bigint, ref: string) {
  if (swap <= 0n) return [];
  return [
    { walletId, direction: 'DEBIT' as const, amount: swap, description: 'Frais de swap (autre pays)' },
    { walletId: await lightpayRevenueWallet(environment, currency), direction: 'CREDIT' as const, amount: swap, description: `Frais LightPay - swap - ${ref}` },
  ];
}

/** What a move between two of my wallets costs, before doing it (the swap fee when their countries differ). */
export async function quoteMove(environment: Environment, user: LightPayUser, input: { from: unknown; to: unknown; amount: unknown }) {
  const amount = positive(input.amount);
  const from = await activeWallet(environment, user, input.from);
  const to = await activeWallet(environment, user, input.to);
  const swap = swapBetween(environment, from.country, to.country, amount);
  return { amount: amount.toString(), swap_fee: swap.toString(), total: (amount + swap).toString(), currency: from.currency };
}

/** What a send costs, before doing it: free inside a country, the swap fee when the receiver's wallet is elsewhere. */
export async function quoteSend(environment: Environment, user: LightPayUser, input: { to: unknown; amount: unknown; wallet_id?: unknown }) {
  const amount = positive(input.amount);
  const from = await activeWallet(environment, user, input.wallet_id);
  const found = await findRecipient(environment, String(input.to ?? '').trim().toLowerCase(), from.currency);
  const swap = swapBetween(environment, from.country, found.country, amount);
  return { amount: amount.toString(), swap_fee: swap.toString(), total: (amount + swap).toString(), currency: from.currency };
}

/** Withdraw available money to a mobile-money number. Locked money can never leave. */
export async function withdraw(environment: Environment, user: LightPayUser, input: { amount: unknown; msisdn: unknown; network: unknown; wallet_id?: unknown }, idempotencyKey: string) {
  guardWithdrawals(); // closed by the admin's emergency brake
  await assertNotSuspended(environment, user.uid);
  await recordWithdrawalAttempt(environment, user, idempotencyKey); // too many attempts: the account is suspended
  const wallet = await activeWallet(environment, user, input.wallet_id);
  const refused = async (err: ConnectError) => {
    const phone = normalizeMsisdn(String(input.msisdn ?? ''), countryOfNetwork(String(input.network ?? '')) ?? undefined);
    await logActivity(environment, {
      walletId: wallet.id, kind: 'WITHDRAWAL', direction: 'OUT', status: 'FAILED', amount: safeAmount(input.amount), currency: wallet.currency,
      counterparty: phone ? maskMsisdn(phone) : null, reasonCode: err.code, reason: err.message, refType: 'withdraw_request', refId: `withdraw:${user.uid}:${idempotencyKey}`,
    });
    return err;
  };
  let amount: bigint;
  try {
    amount = positive(input.amount);
  } catch (err: any) {
    throw await refused(err);
  }
  const minimum = minWithdrawalAmount(environment);
  if (amount < minimum) throw await refused(new ConnectError(`Retrait minimum : ${minimum} FCFA.`, 'BELOW_MINIMUM'));
  const network = String(input.network ?? '') as MobileNetwork;
  if (!mobileNetworks().includes(network)) throw await refused(new ConnectError(`network: ${mobileNetworks().join(', ')}`, 'INVALID_NETWORK'));
  const msisdn = normalizeMsisdn(String(input.msisdn ?? ''), countryOfNetwork(network) ?? undefined);
  if (!msisdn) throw await refused(new ConnectError(invalidNumberMessage(network), 'INVALID_MSISDN'));
  if (!numberFitsNetwork(msisdn, network)) throw await refused(new ConnectError(`Ce numéro n’est pas un numéro ${networkName(network)}.`, 'NETWORK_MISMATCH'));
  const route = await routeOperation({ env: environment, type: 'withdrawal', network, destination: wallet.country, appId: 'mainapp', amount });
  const provider = route.provider.name;
  await ensureProviderRates(environment);
  let operatorFee: bigint;
  try {
    operatorFee = providerPayoutFee(environment, provider, network, amount);
  } catch (err: any) {
    throw await refused(err instanceof FeeError ? new ConnectError(err.message, err.code, 503) : err);
  }
  const lightpayFee = lightpayPayoutFee(environment, amount);
  // The number is in another country than the wallet: the money changes country, the person pays the swap fee.
  const swap = swapBetween(environment, wallet.country, countryOfNetwork(network), amount);
  const total = amount + operatorFee + lightpayFee + swap;
  if (BigInt(wallet.available_balance) < total) {
    throw await refused(new ConnectError(
      `Solde insuffisant : ce retrait coûte ${total} FCFA frais compris (${operatorFee} opérateur + ${lightpayFee} LightPay${swap > 0n ? ` + ${swap} swap` : ''}).`,
      'INSUFFICIENT_FUNDS',
      402
    ));
  }

  const payout = await sendPayout({
    environment,
    appId: 'mainapp',
    walletId: wallet.id,
    msisdn,
    network,
    amount,
    operatorFee,
    // The swap fee follows LightPay's fee (pending until the send is confirmed, returned if it fails).
    lightpayFee: lightpayFee + swap,
    swapFee: swap,
    currency: wallet.currency,
    reason: 'WITHDRAWAL',
    reference: `withdraw:${user.uid}:${idempotencyKey}`,
    description: `Retrait vers ${maskMsisdn(msisdn)}`,
    provider,
    routingRule: route.rule?.id ?? null,
  });
  return payoutView(payout);
}

// A payout waiting for its delay, or kept by the admin, is "in progress" for the person; release_at says when it leaves.
const payoutView = (p: any) => ({
  id: p.id,
  status: p.status === 'SCHEDULED' || p.status === 'HELD' ? 'PENDING' : p.status,
  // Waiting for a rebalancing: "in progress" for the person, with no hour to announce.
  release_at: p.status === 'SCHEDULED' && !p.waiting_transfer ? p.release_at : null,
  amount: String(p.amount),
  operator_fee: String(p.operator_fee ?? 0),
  // lightpay_fee holds the swap fee too (same road): shown apart.
  lightpay_fee: String(BigInt(p.lightpay_fee ?? 0) - BigInt(p.swap_fee ?? 0)),
  swap_fee: String(p.swap_fee ?? 0),
  total: String(p.total_debited ?? p.amount),
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
    for (const w of await listWallets(env, user.uid)) {
      const busy = await walletBusy(env, w);
      if (busy === 'BALANCE_NOT_EMPTY') {
        throw new ConnectError(
          `Videz d’abord ${w.is_default ? 'votre wallet' : `le wallet « ${w.label} »`}${env === 'sandbox' ? ' de test' : ''} : il reste de l’argent disponible ou bloqué.`,
          busy,
          409
        );
      }
      if (busy) throw busyError(busy);
    }
  }
  for (const env of envs) {
    await query(`UPDATE connections SET status = 'REVOKED', revoked_at = NOW(), updated_at = NOW() WHERE user_uid = $1 AND status = 'ACTIVE'`, [user.uid], env);
    await closeAllWallets(env, user.uid);
  }
  return { closed: true };
}

/** What a withdrawal will cost, before doing it (same computation and same routing as withdraw()). */
export async function quoteWithdrawal(environment: Environment, user: LightPayUser, amountInput: unknown, networkInput: unknown, walletId?: unknown) {
  const amount = positive(amountInput);
  const network = String(networkInput ?? '') as MobileNetwork;
  if (!mobileNetworks().includes(network)) throw new ConnectError(`network: ${mobileNetworks().join(', ')}`, 'INVALID_NETWORK');
  const wallet = walletId ? await walletOf(environment, user.uid, { id: String(walletId) }) : await findDefaultWallet(environment, user.uid);
  const route = await routeOperation({ env: environment, type: 'withdrawal', network, destination: wallet?.country, appId: 'mainapp', amount });
  await ensureProviderRates(environment);
  try {
    return withdrawalQuote(environment, amount, route.provider.name, network, 'XAF', swapBetween(environment, wallet?.country, countryOfNetwork(network), amount));
  } catch (err: any) {
    throw err instanceof FeeError ? new ConnectError(err.message, err.code, 503) : err;
  }
}
