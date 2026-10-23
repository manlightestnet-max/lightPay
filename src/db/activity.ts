import crypto from 'crypto';
import { query } from './pool.js';
import { Environment } from '../types/index.js';
import { notifyWallets } from '../realtime.js';
import { notifyActivity } from '../notify/index.js';
import { describeActivity } from '../notify/catalog.js';
import { withAvatars } from './avatars.js';
import { maskNumber } from '../rails/registry.js';

/**
 * Wallet activity journal — what the person sees in their history: every operation that
 * reached the API for their wallet, with its state and, when refused, why.
 *
 * Journaling is best effort: it never blocks or fails a money movement (errors are logged).
 * A line is keyed by (wallet, ref_type, ref_id): retries, webhooks and sweeps update it.
 */

/** COMMISSION: what the app took on a sale, shown as its own line (never as LightPay fees). */
export type ActivityKind = 'DEPOSIT' | 'TRANSFER' | 'WITHDRAWAL' | 'PAYMENT' | 'CHARGE' | 'SALE' | 'REFUND' | 'COMMISSION';
export type ActivityStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'LOCKED' | 'REFUNDED' | 'EXPIRED' | 'CANCELLED';

export interface ActivityInput {
  walletId: string;
  kind: ActivityKind;
  direction: 'IN' | 'OUT';
  status: ActivityStatus;
  amount?: bigint | string | number;
  fees?: bigint | string | number;
  total?: bigint | string | number | null;
  currency?: string;
  counterparty?: string | null;
  reasonCode?: string | null;
  reason?: string | null;
  refType?: string;
  refId?: string;
  metadata?: Record<string, any>;
}

/** French explanation of a refusal / failure code (the person reads it). */
export const REASONS: Record<string, string> = {
  INSUFFICIENT_FUNDS: 'Solde disponible insuffisant.',
  BELOW_MINIMUM: 'Montant inférieur au minimum autorisé.',
  BELOW_MOBILE_MONEY_MINIMUM: 'Le mobile money accepte au minimum 1 000 FCFA.',
  INVALID_AMOUNT: 'Montant invalide.',
  INVALID_MSISDN: 'Numéro de téléphone invalide.',
  NETWORK_MISMATCH: 'Ce numéro n’appartient pas à l’opérateur choisi.',
  INVALID_NETWORK: 'Opérateur non pris en charge.',
  INVALID_RECIPIENT: 'Adresse e-mail du destinataire invalide.',
  RECIPIENT_NOT_FOUND: 'Aucun compte LightPay avec cet e-mail.',
  SAME_WALLET: 'Impossible de s’envoyer de l’argent à soi-même.',
  ACCOUNT_CLOSED: 'Compte fermé.',
  ABOVE_CHARGE_LIMIT: 'Montant au-dessus de la limite que vous avez fixée pour cette app.',
  SCOPE_NOT_GRANTED: 'L’app n’a pas l’autorisation de faire cette opération.',
  INSUFFICIENT_BALANCE: 'Solde insuffisant sur le compte mobile money.',
  PAYER_DECLINED: 'Paiement refusé depuis le téléphone.',
  PAYER_TIMEOUT: 'Aucune validation reçue à temps sur le téléphone.',
  PROVIDER_FAILED: 'Refusé par l’opérateur : solde insuffisant, code secret incorrect ou validation non faite à temps.',
  PROVIDER_CANCELLED: 'Annulé depuis le téléphone.',
  PROVIDER_EXPIRED: 'La demande a expiré sans validation.',
  REFUND_BELOW_FEES: 'Montant trop faible pour couvrir les frais de l’opérateur.',
  DISPUTED: 'Litige en cours : fonds gelés jusqu’à la décision.',
  CANCELLED_BY_ADMIN: 'Envoi annulé par LightPay après vérification.',
  // Our side, not the person's: the provider refused our server (configuration to fix).
  IP_NOT_WHITELISTED: 'Le service de retrait est momentanément indisponible. Réessayez plus tard.',
  PROVIDER_REFUSED: 'Le service de retrait est momentanément indisponible. Réessayez plus tard.',
  PROVIDER_AUTHENTICATION_ERROR: 'Le mobile money est momentanément indisponible. Réessayez plus tard.',
  PROVIDER_AUTHORISATION_ERROR: 'Le mobile money est momentanément indisponible. Réessayez plus tard.',
  PROVIDER_NO_AUTHENTICATION: 'Le mobile money est momentanément indisponible. Réessayez plus tard.',
  PROVIDER_DEPOSITS_NOT_ALLOWED: 'Le mobile money est momentanément indisponible. Réessayez plus tard.',
  PROVIDER_PAYOUTS_NOT_ALLOWED: 'Le service de retrait est momentanément indisponible. Réessayez plus tard.',
  PROVIDER_PROVIDER_TEMPORARILY_UNAVAILABLE: 'L’opérateur est momentanément indisponible. Réessayez dans quelques minutes.',
  PROVIDER_PAYER_NOT_FOUND: 'Ce numéro n’a pas de compte mobile money chez cet opérateur.',
  PROVIDER_RECIPIENT_NOT_FOUND: 'Ce numéro n’a pas de compte mobile money chez cet opérateur.',
  PROVIDER_INVALID_PHONE_NUMBER: 'Numéro de téléphone invalide.',
  PROVIDER_AMOUNT_OUT_OF_BOUNDS: 'Montant hors des limites de l’opérateur.',
  PROVIDER_PAYMENT_IN_PROGRESS: 'Un autre paiement attend déjà votre validation sur ce téléphone. Réessayez dans quelques minutes.',
  PROVIDER_WALLET_LIMIT_REACHED: 'Limite de votre compte mobile money atteinte.',
  PROVIDER_PAWAPAY_WALLET_OUT_OF_FUNDS: 'Le service de retrait est momentanément indisponible. Réessayez plus tard.',
};

export const reasonFor = (code?: string | null, fallback?: string | null) =>
  (code && REASONS[code]) || (code && code.startsWith('PROVIDER_') ? `Refusé par l’opérateur (${code.slice(9).toLowerCase().replace(/_/g, ' ')}).` : null) || fallback || null;

const str = (v: unknown) => (v === undefined || v === null ? null : String(v));

/** Creates (or refreshes, same operation) a journal line. Never throws. */
export async function logActivity(environment: Environment, a: ActivityInput): Promise<void> {
  try {
    // The state before (none for a new line): the person is notified of the change (notify/).
    const [before] = a.refId
      ? await query(`SELECT status, reason_code FROM wallet_activity WHERE wallet_id = $1 AND ref_type = $2 AND ref_id = $3`, [a.walletId, a.refType ?? null, a.refId], environment)
      : [];
    const [row] = await query(
      `INSERT INTO wallet_activity (id, environment, wallet_id, kind, direction, status, amount, fees, total, currency, counterparty, reason_code, reason, ref_type, ref_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (wallet_id, ref_type, ref_id) WHERE ref_id IS NOT NULL
       DO UPDATE SET status = EXCLUDED.status, amount = EXCLUDED.amount, fees = EXCLUDED.fees, total = EXCLUDED.total,
         counterparty = COALESCE(EXCLUDED.counterparty, wallet_activity.counterparty),
         reason_code = EXCLUDED.reason_code, reason = EXCLUDED.reason,
         metadata = wallet_activity.metadata || EXCLUDED.metadata, updated_at = NOW()
       RETURNING *`,
      [
        `act_${crypto.randomBytes(14).toString('base64url')}`, environment, a.walletId, a.kind, a.direction, a.status,
        str(a.amount ?? 0), str(a.fees ?? 0), str(a.total ?? null), a.currency ?? 'XAF', a.counterparty ?? null,
        a.reasonCode ?? null, a.reason ?? reasonFor(a.reasonCode), a.refType ?? null, a.refId ?? null, JSON.stringify(a.metadata ?? {}),
      ],
      environment
    );
    notifyWallets(environment, [a.walletId]);
    if (row) notifyActivity(environment, row, before ? { status: before.status, reason_code: before.reason_code } : null);
  } catch (err: any) {
    console.error('[ACTIVITY] log failed', a.kind, a.refType, a.refId, err?.message);
  }
}

/** Updates the state of every line of an operation (e.g. a payout settled by a webhook). Never throws. */
export async function updateActivity(
  environment: Environment,
  refType: string,
  refId: string,
  patch: { status: ActivityStatus; reasonCode?: string | null; reason?: string | null; fees?: bigint | string | number; total?: bigint | string | number; amount?: bigint | string | number; walletId?: string; metadata?: Record<string, any> }
): Promise<void> {
  try {
    const rows = await query(
      `WITH before AS (
         SELECT id, status AS old_status, reason_code AS old_reason_code FROM wallet_activity
         WHERE ref_type = $1 AND ref_id = $2 AND ($9::uuid IS NULL OR wallet_id = $9::uuid)
       )
       UPDATE wallet_activity w SET status = $3::varchar,
         reason_code = CASE WHEN $3::varchar IN ('FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'LOCKED') THEN COALESCE($4::varchar, w.reason_code) ELSE NULL END,
         reason = CASE WHEN $3::varchar IN ('FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'LOCKED') THEN COALESCE($5::text, w.reason) ELSE NULL END,
         fees = COALESCE($6::bigint, w.fees), total = COALESCE($7::bigint, w.total), amount = COALESCE($8::bigint, w.amount),
         metadata = w.metadata || $10::jsonb, updated_at = NOW()
       FROM before WHERE w.id = before.id
       RETURNING w.*, before.old_status, before.old_reason_code`,
      [refType, refId, patch.status, patch.reasonCode ?? null, patch.reason ?? reasonFor(patch.reasonCode), str(patch.fees), str(patch.total), str(patch.amount), patch.walletId ?? null, JSON.stringify(patch.metadata ?? {})],
      environment
    );
    notifyWallets(environment, rows.map((r: any) => r.wallet_id));
    for (const r of rows) notifyActivity(environment, r, { status: r.old_status, reason_code: r.old_reason_code });
  } catch (err: any) {
    console.error('[ACTIVITY] update failed', refType, refId, err?.message);
  }
}

/** Is this wallet a person's (USER) or a guest's (GUEST)? Only those get a journal. */
export async function isPersonWallet(environment: Environment, walletId: string): Promise<boolean> {
  try {
    const [w] = await query(`SELECT account_type FROM wallets WHERE id = $1`, [walletId], environment);
    return w?.account_type === 'USER' || w?.account_type === 'GUEST';
  } catch {
    return false;
  }
}

/** Display name of an app, for the counterparty column. */
export async function appName(environment: Environment, appId: string): Promise<string> {
  try {
    const [a] = await query(`SELECT name FROM apps WHERE id = $1`, [appId], environment);
    return a?.name ?? appId;
  } catch {
    return appId;
  }
}

/**
 * A direct sale (no escrow) on the seller's statement: the sale, then the app's commission as its
 * own line, like a captured hold. Only for a person's wallet (an app's own wallet has no journal).
 */
export async function logDirectSale(
  environment: Environment,
  s: { payeeWalletId: string; appId: string; amount: bigint; fee: bigint; currency: string; refType: string; refId: string; reference?: string | null; metadata?: Record<string, any> }
): Promise<void> {
  if (!(await isPersonWallet(environment, s.payeeWalletId))) return;
  const app = await appName(environment, s.appId);
  await logActivity(environment, {
    walletId: s.payeeWalletId, kind: 'SALE', direction: 'IN', status: 'SUCCEEDED', amount: s.amount, fees: '0', total: s.amount,
    currency: s.currency, counterparty: app, refType: s.refType, refId: s.refId, metadata: { ...(s.metadata ?? {}), reference: s.reference ?? undefined, direct: true },
  });
  if (s.fee > 0n) {
    await logActivity(environment, {
      walletId: s.payeeWalletId, kind: 'COMMISSION', direction: 'OUT', status: 'SUCCEEDED', amount: s.fee, total: s.fee,
      currency: s.currency, counterparty: app, refType: `${s.refType}_commission`, refId: s.refId,
      metadata: { reference: s.reference ?? undefined, sale_amount: s.amount.toString() },
    });
  }
}

/** "242065124481" -> "+242 06 ••• •• 81" (the country's dial code). */
export const maskPhone = maskNumber;

/** A thrown error as (code, French message) for the journal. */
export const failureOf = (err: any): { code: string; message: string } => {
  if (String(err?.message ?? '').startsWith('Insufficient funds')) return { code: 'INSUFFICIENT_FUNDS', message: REASONS.INSUFFICIENT_FUNDS };
  const code = String(err?.code ?? 'ERROR');
  return { code, message: REASONS[code] && !/[àâéèêçùô]/i.test(String(err?.message)) ? REASONS[code] : String(err?.message ?? 'Erreur') };
};

/** What the person reads for an operation (notify/catalog.ts), on every line served. */
const withDescription = (row: any) => (row ? { ...row, description: describeActivity(row) } : row);

export async function listActivity(environment: Environment, walletId: string, limit = 50) {
  const rows = await query(
    `SELECT id, kind, direction, status, amount::text, fees::text, total::text, currency, counterparty, reason_code, regexp_replace(reason, '^null ', 'L’opérateur a refusé l’envoi. ') AS reason, ref_type, metadata, created_at, updated_at
     FROM wallet_activity WHERE wallet_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [walletId, Math.min(Math.max(limit, 1), 200)],
    environment
  );
  // avatar_url: the other person's photo, or the app's logo (avatars.ts).
  return withAvatars(environment, rows.map(withDescription));
}

export async function getActivity(environment: Environment, walletId: string, id: string) {
  const [row] = await query(
    `SELECT id, kind, direction, status, amount::text, fees::text, total::text, currency, counterparty, reason_code, regexp_replace(reason, '^null ', 'L’opérateur a refusé l’envoi. ') AS reason, ref_type, metadata, created_at, updated_at
     FROM wallet_activity WHERE wallet_id = $1 AND id = $2`,
    [walletId, id],
    environment
  );
  if (!row) return row;
  return (await withAvatars(environment, [withDescription(row)]))[0];
}
