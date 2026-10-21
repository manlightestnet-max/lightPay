/**
 * Run by the owner, once after the change "LightPay's revenue goes to the main wallet": the fees kept in LIGHTPAY_FEES
 * until then move to the main wallet. Only what is LightPay's for good moves:
 *   1. each confirmed payout's fee (the same move the server makes on every confirmation; idempotent per payout);
 *   2. the rest of LIGHTPAY_FEES (deposit and payment fees of before the change), minus the fees of payouts still
 *      waiting for the operator (they stay pending: a refused payout gives them back).
 * Without --apply it only prints what it would do.
 *
 *   npx tsx scripts/settle-fees-to-main.ts --production            (look)
 *   npx tsx scripts/settle-fees-to-main.ts --production --apply    (move)
 *   (--sandbox instead of --production for the test database)
 */
import { LedgerEngine } from '../src/db/ledger.js';
import { getPool, query } from '../src/db/pool.js';
import { lightpayFeeWallet, lightpayRevenueWallet, settlePayoutFee, FEE_SETTLEMENT } from '../src/db/fee-wallet.js';
import type { Environment } from '../src/types/index.js';

const CURRENCY = 'XAF';

async function main() {
  const env: Environment | null = process.argv.includes('--production') ? 'production' : process.argv.includes('--sandbox') ? 'sandbox' : null;
  const apply = process.argv.includes('--apply');
  if (!env) throw new Error('Say which database: --production or --sandbox');

  const fees = await lightpayFeeWallet(env, CURRENCY);
  const balance = async () => BigInt((await query(`SELECT available_balance::text AS b FROM wallets WHERE id = $1`, [fees], env))[0].b);

  // 1. Confirmed payouts whose fee never moved.
  const confirmed = await query(
    `SELECT p.id, p.environment, p.reference, p.currency, p.lightpay_fee::text
     FROM payouts p
     WHERE p.status = 'SUCCEEDED' AND p.currency = $1 AND COALESCE(p.lightpay_fee, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.idempotency_key = p.reference || ':fee')`,
    [CURRENCY],
    env
  );
  const confirmedTotal = confirmed.reduce((s: bigint, p: any) => s + BigInt(p.lightpay_fee), 0n);
  console.log(`${env}: ${confirmed.length} confirmed payout fee(s) to move, ${confirmedTotal} ${CURRENCY}`);
  if (apply) for (const p of confirmed) await settlePayoutFee(p);

  // 2. The rest, minus what waits for the operator.
  const [{ waiting }] = await query(
    `SELECT COALESCE(SUM(lightpay_fee), 0)::text AS waiting FROM payouts WHERE currency = $1 AND status IN ('SCHEDULED', 'HELD', 'PENDING')`,
    [CURRENCY],
    env
  );
  const left = (apply ? await balance() : (await balance()) - confirmedTotal) - BigInt(waiting);
  console.log(`${env}: pending fees kept for payouts not confirmed yet: ${waiting} ${CURRENCY}`);
  console.log(`${env}: older fees to move to the main wallet: ${left > 0n ? left : 0n} ${CURRENCY}`);
  if (apply && left > 0n) {
    const key = `legacy-fees-to-main:${env}`;
    await LedgerEngine.executeTransaction({
      appId: 'mainapp',
      environment: env,
      idempotencyKey: key,
      type: 'TRANSFER',
      amount: left,
      currency: CURRENCY,
      skipQuotas: true,
      metadata: { fee_settlement: true, legacy: true },
      postings: [
        { walletId: fees, direction: 'DEBIT', amount: left, description: `${FEE_SETTLEMENT} (frais d’avant le changement)` },
        { walletId: await lightpayRevenueWallet(env, CURRENCY), direction: 'CREDIT', amount: left, description: `${FEE_SETTLEMENT} (frais d’avant le changement)` },
      ],
    });
  }
  console.log(apply ? 'Done.' : 'Nothing moved (add --apply to move).');
}

main()
  .then(() => getPool('production').end())
  .catch((err) => {
    console.error(err?.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
