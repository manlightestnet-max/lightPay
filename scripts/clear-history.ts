/**
 * Start the money history again from zero, run by the owner. Keeps the apps and everything about them (keys, sites,
 * webhooks, logos), the people (accounts, @names, LightPay codes, connections) and every setting (fees, providers,
 * controls, messages). Erases only the money: transactions and ledger entries, holds, checkout sessions, collection
 * attempts, payouts, withdrawal attempts, activity, webhook logs and balance readings; every balance goes back to 0.
 * The ledger stays exact: it is empty.
 *
 * Before erasing, everything erased is written to archives/history-<ledger>-<date>.json, on this computer only (never
 * in git). The real ledger asks for --confirm EFFACER-LE-REEL and lists every balance set back to 0 first.
 *
 *   npx tsx scripts/clear-history.ts --sandbox                  (look: what would be erased)
 *   npx tsx scripts/clear-history.ts --sandbox --apply          (erase the test ledger)
 *   npx tsx scripts/clear-history.ts --production --apply --confirm EFFACER-LE-REEL
 */
import fs from 'fs';
import path from 'path';
import { getClient, getPool, query } from '../src/db/pool.js';
import type { Environment } from '../src/types/index.js';

/** Erased in this order (each one only refers to those after it). */
const TABLES = [
  'webhook_logs',
  'provider_balance_checks',
  'withdrawal_attempts',
  'wallet_activity',
  'collection_attempts',
  'payouts',
  'holds',
  'checkout_sessions',
  'ledger_entries',
  'transactions',
];

async function main() {
  const env: Environment | null = process.argv.includes('--production') ? 'production' : process.argv.includes('--sandbox') ? 'sandbox' : null;
  const apply = process.argv.includes('--apply');
  if (!env) throw new Error('Say which ledger: --sandbox (test) or --production (real)');
  const c = process.argv.indexOf('--confirm');
  if (env === 'production' && apply && process.argv[c + 1] !== 'EFFACER-LE-REEL') throw new Error('Real ledger: add --confirm EFFACER-LE-REEL');

  const counts: Record<string, number> = {};
  for (const t of TABLES) counts[t] = (await query(`SELECT COUNT(*)::int AS n FROM ${t}`, [], env))[0].n;
  const holders = await query(
    `SELECT account_type, account_id, metadata->>'email' AS email, metadata->>'name' AS name, (available_balance + locked_balance)::text AS balance
     FROM wallets WHERE environment = $1 AND (available_balance <> 0 OR locked_balance <> 0) ORDER BY account_type, account_id`,
    [env],
    env
  );
  console.log(`\n${env === 'sandbox' ? 'TEST (sandbox)' : 'RÉEL (production)'} — à effacer :`);
  for (const t of TABLES) console.log(`  ${t.padEnd(24)} ${counts[t]}`);
  console.log('\nSoldes remis à 0 :');
  for (const h of holders) console.log(`  ${String(h.account_type).padEnd(9)} ${String(h.email ?? h.name ?? h.account_id).padEnd(36)} ${h.balance} XAF`);
  if (!apply) {
    console.log('\nRien n’est effacé (ajoutez --apply pour effacer).');
    return;
  }

  // Archive first: what is erased stays on this computer.
  const dir = path.resolve('archives');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `history-${env}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const archive: Record<string, unknown[]> = { wallets_before: await query(`SELECT * FROM wallets WHERE environment = $1`, [env], env) };
  for (const t of TABLES) archive[t] = await query(`SELECT * FROM ${t}`, [], env);
  fs.writeFileSync(file, JSON.stringify(archive, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  console.log(`\nArchive écrite : ${file}`);

  const client = await getClient(env);
  try {
    await client.query('BEGIN');
    for (const t of TABLES) await client.query(`DELETE FROM ${t}`);
    await client.query(`UPDATE wallets SET available_balance = 0, locked_balance = 0, updated_at = NOW() WHERE environment = $1`, [env]);
    await client.query('COMMIT');
    console.log('Historique effacé, soldes à 0. Les apps, les comptes et les réglages sont intacts.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => Promise.all([getPool('production').end(), getPool('sandbox').end()]))
  .catch((err) => {
    console.error(err?.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
