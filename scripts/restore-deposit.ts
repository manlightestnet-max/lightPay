/**
 * One movement, run by the owner: a mobile-money deposit that is at the provider but no longer in
 * the ledger (erased by the database reset) is recorded again and credited to a LightPay account.
 * Balanced like any deposit (provider reserve -> wallet) and idempotent: running it twice with
 * the same arguments moves the money once.
 *
 *   npx tsx scripts/restore-deposit.ts --email you@example.com --amount 200 --provider saspay --production
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
  const email = String(arg('email') ?? '').trim().toLowerCase();
  const amountText = String(arg('amount') ?? '');
  const provider = String(arg('provider') ?? 'saspay').toLowerCase();
  if (!env) throw new Error('Say which database: --production or --sandbox');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('--email is required');
  if (!/^\d{1,9}$/.test(amountText) || BigInt(amountText) <= 0n) throw new Error('--amount must be a whole number of FCFA');
  const amount = BigInt(amountText);

  const [wallet] = await query(
    `SELECT id, metadata FROM wallets WHERE app_id = 'mainapp' AND account_type = 'USER' AND currency = 'XAF' AND status = 'ACTIVE'
       AND lower(metadata->>'email') = $1 LIMIT 1`,
    [email],
    env
  );
  if (!wallet) throw new Error(`No LightPay account with ${email} (${env})`);

  const inflow = await LedgerEngine.getOrCreateGatewayInflow('mainapp', env, 'XAF');
  const ref = `restore-deposit:${email}:${amount}:${provider}`;
  const result: any = await LedgerEngine.executeTransaction({
    appId: 'mainapp',
    environment: env,
    idempotencyKey: ref,
    skipQuotas: true,
    type: 'COLLECTION',
    amount,
    currency: 'XAF',
    metadata: { provider, deposit: true, restored: true },
    postings: [
      { walletId: inflow, direction: 'DEBIT', amount, description: `Mobile money in [${provider}] - recharge restaurée` },
      { walletId: wallet.id, direction: 'CREDIT', amount, description: 'Recharge du wallet' },
    ],
  });
  if (!result.duplicate) {
    await logActivity(env, {
      walletId: wallet.id, kind: 'DEPOSIT', direction: 'IN', status: 'SUCCEEDED', amount, total: amount, currency: 'XAF',
      counterparty: 'Mobile money', refType: 'transfer', refId: ref, metadata: { via: provider },
    });
  }
  const [after] = await query('SELECT available_balance::text FROM wallets WHERE id = $1', [wallet.id], env);
  console.log(result.duplicate ? 'Already recorded: nothing moved.' : `Recorded: +${amount} FCFA to ${email} (${env}).`, `Balance: ${after.available_balance} FCFA`);
}

main()
  .catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([getPool('production').end(), getPool('sandbox').end()]));
