import { query } from './pool.js';
import { LedgerEngine } from './ledger.js';
import { Environment } from '../types/index.js';

/**
 * Where LightPay's own fees go. LightPay is a closed app run by its owner: its revenue lands in the main wallet
 * (SYSTEM_MAIN_TREASURY), where the owner can use it at once.
 *
 *   deposit and payment fees  final as soon as the money is collected: credited to the main wallet directly;
 *   withdrawal / refund fees  kept in LIGHTPAY_FEES ("frais en attente") while the payout is not confirmed, because a
 *                             refused payout gives them back to the person and the main wallet may never go negative;
 *                             moved to the main wallet as soon as the operator confirms the send (settlePayoutFee).
 *
 * Every fee leg is described "Frais LightPay - <id>" (given back: "Frais LightPay remboursés - <id>"): that is how the
 * admin's revenue figures find them, whichever wallet holds them.
 */

/** The main wallet: LightPay's revenue goes there. */
export const lightpayRevenueWallet = (environment: Environment, currency: string): Promise<string> =>
  LedgerEngine.getOrCreateMainTreasury('mainapp', environment, currency);

/** Fees of payouts not confirmed yet (and, before this change, all LightPay fees). */
export async function lightpayFeeWallet(environment: Environment, currency: string): Promise<string> {
  const [existing] = await query(
    `SELECT id FROM wallets WHERE app_id = 'mainapp' AND account_id = 'LIGHTPAY_FEES' AND currency = $1 AND environment = $2`,
    [currency, environment],
    environment
  );
  if (existing) return existing.id;
  const [created] = await query(
    `INSERT INTO wallets (app_id, account_id, account_type, currency, environment, metadata)
     VALUES ('mainapp', 'LIGHTPAY_FEES', 'PLATFORM', $1, $2, '{"role":"lightpay_pending_fees"}')
     ON CONFLICT (app_id, account_id, currency, environment) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [currency, environment],
    environment
  );
  return created.id;
}

/** Description of the move of a confirmed payout's fee to the main wallet (never counted twice as revenue). */
export const FEE_SETTLEMENT = 'Frais de retrait versés au wallet main';

/**
 * A payout was confirmed by the operator: its LightPay fee leaves the pending fees for the main wallet. Idempotent
 * (one move per payout, whatever the number of confirmations).
 */
export async function settlePayoutFee(p: { id: string; environment: Environment; reference: string; currency: string; lightpay_fee?: string | null }) {
  const fee = BigInt(p.lightpay_fee ?? 0);
  if (fee <= 0n) return;
  const env = p.environment;
  await LedgerEngine.executeTransaction({
    appId: 'mainapp',
    environment: env,
    idempotencyKey: `${p.reference}:fee`,
    type: 'TRANSFER',
    amount: fee,
    currency: p.currency,
    skipQuotas: true,
    metadata: { fee_settlement: true, payout_id_settled: p.id },
    postings: [
      { walletId: await lightpayFeeWallet(env, p.currency), direction: 'DEBIT', amount: fee, description: `${FEE_SETTLEMENT} - ${p.id}` },
      { walletId: await lightpayRevenueWallet(env, p.currency), direction: 'CREDIT', amount: fee, description: `${FEE_SETTLEMENT} - ${p.id}` },
    ],
  });
}
