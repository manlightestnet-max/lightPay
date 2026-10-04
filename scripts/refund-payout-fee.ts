/**
 * One movement, run by the owner: a payout whose operator fee was estimated too high gets the
 * difference back. The provider took `--real-fee`; the wallet was debited the estimated fee, so
 * the extra goes from the provider reserve back to the wallet. Balanced, and idempotent per payout.
 *
 *   npx tsx scripts/refund-payout-fee.ts --payout <po_… or provider id> --real-fee 20 --production
 *   (--sandbox instead of --production for the test database)
 */
import { LedgerEngine } from '../src/db/ledger.js';
import { logActivity } from '../src/db/activity.js';
import { getPool, query } from '../src/db/pool.js';
import type { Environment } from '../src/types/index.js';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const env: Environment | null = process.argv.includes('--production') ? 'production' : process.argv.includes('--sandbox') ? 'sandbox' : null;
  const ref = String(arg('payout') ?? '').trim();
  const realText = String(arg('real-fee') ?? '');
  if (!env) throw new Error('Say which database: --production or --sandbox');
  if (!ref) throw new Error('--payout is required (our po_ id or the provider id)');
  if (!/^\d{1,9}$/.test(realText)) throw new Error('--real-fee must be a whole number of FCFA');
  const realFee = BigInt(realText);

  const [p] = await query(`SELECT * FROM payouts WHERE id = $1 OR provider_reference = $1 LIMIT 1`, [ref], env);
  if (!p) throw new Error(`No payout ${ref} (${env})`);
  const charged = BigInt(p.operator_fee ?? 0);
  const extra = charged - realFee;
  if (extra <= 0n) throw new Error(`Nothing to give back: charged ${charged}, provider took ${realFee}`);

  const reserve = await LedgerEngine.getOrCreateGatewayInflow('mainapp', env, p.currency);
  const key = `payout-fee-refund:${p.id}`;
  const result: any = await LedgerEngine.executeTransaction({
    appId: 'mainapp',
    environment: env,
    idempotencyKey: key,
    skipQuotas: true,
    type: 'REFUND',
    amount: extra,
    currency: p.currency,
    metadata: { provider: p.provider, payout_id: p.id, charged_fee: charged.toString(), real_fee: realFee.toString() },
    postings: [
      { walletId: reserve, direction: 'DEBIT', amount: extra, description: `Frais opérateur trop perçus [${p.provider}] - ${p.id}` },
      { walletId: p.wallet_id, direction: 'CREDIT', amount: extra, description: 'Frais de retrait trop perçus, remboursés' },
    ],
  });
  if (!result.duplicate) {
    await query(
      `UPDATE payouts SET operator_fee = $2, total_debited = total_debited - $3, updated_at = NOW() WHERE id = $1`,
      [p.id, realFee.toString(), extra.toString()],
      env
    );
    await logActivity(env, {
      walletId: p.wallet_id, kind: 'REFUND', direction: 'IN', status: 'SUCCEEDED', amount: extra, total: extra, currency: p.currency,
      counterparty: 'Frais de retrait trop perçus', refType: 'payout_fee_refund', refId: key, metadata: { payout_id: p.id },
    });
  }
  const [after] = await query('SELECT available_balance::text FROM wallets WHERE id = $1', [p.wallet_id], env);
  console.log(result.duplicate ? 'Already refunded: nothing moved.' : `Refunded +${extra} ${p.currency} (fee ${charged} -> ${realFee}).`, `Balance: ${after.available_balance} ${p.currency}`);
}

main()
  .catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([getPool('production').end(), getPool('sandbox').end()]));
