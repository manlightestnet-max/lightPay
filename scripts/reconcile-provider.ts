/**
 * Run by the owner after comparing a provider's statement with the admin's "Réserves" screen. Records, in the ledger,
 * money the provider moved without LightPay knowing:
 *
 *   --in   <FCFA>  a payment credited at the provider outside LightPay (a test, a link of the provider's own dashboard):
 *                  the money is at the provider, it becomes LightPay's own (wallet main);
 *   --fee  <FCFA>  a provider fee never booked: the money left the provider, paid by LightPay (wallet main).
 *
 * Balanced and idempotent: one movement per --ref (the provider's reference), whatever the number of runs.
 * Without --apply it only prints what it would do.
 *
 *   npx tsx scripts/reconcile-provider.ts --production --provider saspay --in 205 --ref 73dc90f7… --note "Paiement de test SasPay"
 *   npx tsx scripts/reconcile-provider.ts --production --provider saspay --fee 12 --ref frais-oct-2026 --apply
 */
import { LedgerEngine } from '../src/db/ledger.js';
import { getPool } from '../src/db/pool.js';
import { lightpayRevenueWallet } from '../src/db/fee-wallet.js';
import type { Environment } from '../src/types/index.js';

const CURRENCY = 'XAF';
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const env: Environment | null = process.argv.includes('--production') ? 'production' : process.argv.includes('--sandbox') ? 'sandbox' : null;
  const apply = process.argv.includes('--apply');
  const provider = String(arg('provider') ?? '').trim().toLowerCase();
  const ref = String(arg('ref') ?? '').trim();
  const note = String(arg('note') ?? '').trim();
  const inText = arg('in');
  const feeText = arg('fee');
  if (!env) throw new Error('Say which database: --production or --sandbox');
  if (!/^[a-z0-9_-]{2,30}$/.test(provider)) throw new Error('--provider is required (saspay, pawapay…)');
  if (!ref || ref.length > 60) throw new Error('--ref is required (the provider’s reference, at most 60 characters)');
  if ((inText === undefined) === (feeText === undefined)) throw new Error('Give exactly one of --in <FCFA> or --fee <FCFA>');
  const text = String(inText ?? feeText);
  if (!/^\d{1,9}$/.test(text) || BigInt(text) <= 0n) throw new Error('The amount must be a whole number of FCFA greater than zero');
  const amount = BigInt(text);
  const incoming = inText !== undefined;

  const reserve = await LedgerEngine.getOrCreateGatewayInflow('mainapp', env, CURRENCY);
  const main = await lightpayRevenueWallet(env, CURRENCY);
  const what = incoming ? `Encaissé hors LightPay [${provider}]` : `Frais du provider non enregistrés [${provider}]`;
  const description = `${what} - ${ref}${note ? ` · ${note}` : ''}`.slice(0, 250);
  console.log(`${env}: ${incoming ? '+' : '−'}${amount} ${CURRENCY} ${incoming ? 'to' : 'from'} the main wallet · ${description}`);
  if (!apply) {
    console.log('Nothing moved (add --apply to record it).');
    return;
  }
  const result: any = await LedgerEngine.executeTransaction({
    appId: 'mainapp',
    environment: env,
    idempotencyKey: `reconcile:${provider}:${ref}`,
    type: 'TRANSFER',
    amount,
    currency: CURRENCY,
    skipQuotas: true,
    reference: ref,
    metadata: { reconciliation: true, provider, direction: incoming ? 'in' : 'fee', note: note || undefined },
    postings: incoming
      ? [
          { walletId: reserve, direction: 'DEBIT', amount, description },
          { walletId: main, direction: 'CREDIT', amount, description },
        ]
      : [
          { walletId: main, direction: 'DEBIT', amount, description },
          { walletId: reserve, direction: 'CREDIT', amount, description },
        ],
  });
  console.log(result?.duplicate ? 'Already recorded (same --ref): nothing changed.' : 'Recorded.');
}

main()
  .then(() => getPool('production').end())
  .catch((err) => {
    console.error(err?.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
