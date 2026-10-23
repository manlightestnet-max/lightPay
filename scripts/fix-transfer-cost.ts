/**
 * Run by the owner once: corrects the cost of the transfers between provider wallets booked before 23 October, when
 * LightPay counted SasPay's fee twice (sent − received + fee, while SasPay's to_amount is already net of its fee).
 * For each such transfer, the part booked too much goes back: provider costs (SYSTEM_PROVIDER_COSTS) → transit.
 *
 * Balanced and idempotent: one correction per transfer, whatever the number of runs. Without --apply it only prints.
 *
 *   npx tsx scripts/fix-transfer-cost.ts --production
 *   npx tsx scripts/fix-transfer-cost.ts --production --apply
 */
import { LedgerEngine } from '../src/db/ledger.js';
import { getPool } from '../src/db/pool.js';
import type { Environment } from '../src/types/index.js';

async function main() {
  const env: Environment | null = process.argv.includes('--production') ? 'production' : process.argv.includes('--sandbox') ? 'sandbox' : null;
  const apply = process.argv.includes('--apply');
  if (!env) throw new Error('Précisez --production ou --sandbox.');
  const pool = getPool(env);
  const { rows } = await pool.query(
    `SELECT t.id, t.amount::text, t.received::text, t.fee::text, tx.amount::text AS booked
     FROM provider_transfers t JOIN transactions tx ON tx.id = t.cost_transaction_id
     WHERE t.environment = $1 AND t.status = 'SUCCEEDED' AND t.cost_transaction_id IS NOT NULL ORDER BY t.created_at`,
    [env]
  );
  let total = 0n;
  for (const t of rows) {
    const correct = BigInt(t.amount) - BigInt(t.received ?? t.amount);
    const extra = BigInt(t.booked) - (correct > 0n ? correct : 0n);
    if (extra <= 0n) continue;
    total += extra;
    console.log(`${t.id}: envoyé ${t.amount}, arrivé ${t.received}, coût écrit ${t.booked}, coût réel ${correct} → ${extra} FCFA à rendre`);
    if (!apply) continue;
    const transit = await LedgerEngine.getOrCreateGatewayInflow('mainapp', env, 'XAF');
    const { rows: [costs] } = await pool.query(`SELECT id FROM wallets WHERE app_id = 'mainapp' AND account_id = 'SYSTEM_PROVIDER_COSTS' AND currency = 'XAF' AND environment = $1`, [env]);
    if (!costs) throw new Error('Compte SYSTEM_PROVIDER_COSTS introuvable.');
    await LedgerEngine.executeTransaction({
      appId: 'mainapp',
      environment: env,
      idempotencyKey: `transfer-cost-fix:${t.id}`,
      type: 'DISBURSEMENT',
      amount: extra,
      currency: 'XAF',
      skipQuotas: true,
      metadata: { transfer: t.id, correction: 'fee counted twice' },
      postings: [
        { walletId: transit, direction: 'DEBIT', amount: extra, description: `Correction frais fournisseur - transfert ${t.id}` },
        { walletId: costs.id, direction: 'CREDIT', amount: extra, description: `Correction frais fournisseur - transfert ${t.id}` },
      ],
    });
  }
  console.log(total ? `${apply ? 'Corrigé' : 'À corriger'} : ${total} FCFA.${apply ? '' : ' Relancez avec --apply.'}` : 'Rien à corriger.');
  await pool.end();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
