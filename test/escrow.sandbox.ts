/**
 * Escrow end-to-end on the SANDBOX database (real Postgres, no HTTP).
 * Run: npx tsx test/escrow.sandbox.ts
 *
 * Scenario (Salacope): a buyer pays a seller into escrow; the seller sees the money
 * locked and cannot spend it; then capture, release (refund) and dispute are exercised,
 * with idempotency, double-settlement and ledger balance checks.
 */
import 'dotenv/config';
import crypto from 'crypto';
import { query, sandboxPool, prodPool } from '../src/db/pool.js';
import { LedgerEngine } from '../src/db/ledger.js';
import { Escrow } from '../src/db/escrow.js';

const ENV = 'sandbox' as const;
const APP = 'app_escrow_test';
const run = crypto.randomBytes(4).toString('hex');
const key = (name: string) => `escrow-test-${run}-${name}`;

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};
const rejects = async (name: string, fn: () => Promise<unknown>, code?: string) => {
  try {
    await fn();
    check(name, false, 'did not throw');
  } catch (err: any) {
    check(name, !code || err.code === code || String(err.message).includes(code), err.code ?? err.message);
  }
};

const wallet = async (accountId: string, type: 'USER' | 'MERCHANT' | 'SYSTEM') =>
  (
    await query(
      `INSERT INTO wallets (app_id, account_id, account_type, currency, environment)
       VALUES ($1, $2, $3, 'XAF', $4)
       ON CONFLICT (app_id, account_id, currency, environment) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      // Customer wallets belong to the central 'mainapp' (one wallet per person across apps).
      [type === 'USER' ? 'mainapp' : APP, accountId, type, ENV],
      ENV
    )
  )[0].id as string;

const balances = async (id: string) => {
  const w = (await query('SELECT available_balance, locked_balance FROM wallets WHERE id = $1', [id], ENV))[0];
  return { available: BigInt(w.available_balance), locked: BigInt(w.locked_balance) };
};

async function main() {
  // Test tenant and wallets (sandbox only).
  await query(
    `INSERT INTO apps (id, name, api_key_hash, webhook_secret) VALUES ($1, 'Escrow test', 'x', 'x') ON CONFLICT (id) DO NOTHING`,
    [APP],
    ENV
  );
  const funding = await wallet(`SYSTEM_TEST_FUNDING`, 'SYSTEM');
  const buyer = await wallet(`buyer-${run}`, 'USER');
  const seller = await wallet(`seller-${run}`, 'USER');
  const platform = await wallet(`platform-${run}`, 'MERCHANT');

  // Top-up the buyer (stands in for a mobile-money collection).
  await LedgerEngine.executeTransaction({
    appId: APP,
    environment: ENV,
    idempotencyKey: key('topup'),
    type: 'COLLECTION',
    amount: 100_000n,
    currency: 'XAF',
    metadata: { admin_seed: true },
    postings: [
      { walletId: funding, direction: 'DEBIT', amount: 100_000n },
      { walletId: buyer, direction: 'CREDIT', amount: 100_000n },
    ],
  });

  // 1. Pay 35 000 into escrow, 3 500 platform fee at capture.
  const paid = await Escrow.create({
    appId: APP, environment: ENV, idempotencyKey: key('hold-1'),
    payerWalletId: buyer, beneficiaryWalletId: seller, amount: 35_000n, feeAmount: 3_500n, currency: 'XAF', reference: `SC-${run}-1`,
  });
  check('hold created ACTIVE', paid.hold?.status === 'ACTIVE');
  let b = await balances(buyer), s = await balances(seller);
  check('buyer debited', b.available === 65_000n, `${b.available}`);
  check('seller sees funds locked, not available', s.locked === 35_000n && s.available === 0n, `${s.available}/${s.locked}`);

  // 2. Replay = same hold, no double debit.
  const replay = await Escrow.create({
    appId: APP, environment: ENV, idempotencyKey: key('hold-1'),
    payerWalletId: buyer, beneficiaryWalletId: seller, amount: 35_000n, feeAmount: 3_500n, currency: 'XAF', reference: `SC-${run}-1`,
  });
  b = await balances(buyer);
  check('idempotent replay returns the same hold', replay.duplicate === true && replay.hold?.id === paid.hold?.id);
  check('replay does not debit twice', b.available === 65_000n);

  // 3. Locked money cannot be spent by the seller.
  await rejects('seller cannot pay with locked funds', () =>
    LedgerEngine.executeTransaction({
      appId: APP, environment: ENV, idempotencyKey: key('spend-locked'), type: 'TRANSFER', amount: 1_000n, currency: 'XAF',
      postings: [
        { walletId: seller, direction: 'DEBIT', amount: 1_000n },
        { walletId: buyer, direction: 'CREDIT', amount: 1_000n },
      ],
    }), 'Insufficient funds');

  // 4. Capture: seller gets 31 500 available, platform 3 500.
  await rejects('capture with fee needs a fee wallet', () =>
    Escrow.capture({ appId: APP, environment: ENV, idempotencyKey: key('cap-nofee'), holdId: paid.hold!.id }), 'FEE_WALLET_REQUIRED');
  const captured = await Escrow.capture({ appId: APP, environment: ENV, idempotencyKey: key('cap-1'), holdId: paid.hold!.id, feeWalletId: platform });
  s = await balances(seller);
  const p = await balances(platform);
  check('hold CAPTURED', captured.hold?.status === 'CAPTURED');
  check('seller available = amount - fee, nothing locked', s.available === 31_500n && s.locked === 0n, `${s.available}/${s.locked}`);
  check('platform fee credited', p.available === 3_500n, `${p.available}`);
  await rejects('a captured hold cannot be released', () =>
    Escrow.release({ appId: APP, environment: ENV, idempotencyKey: key('rel-after-cap'), holdId: paid.hold!.id }), 'HOLD_ALREADY_SETTLED');

  // 5. Refund path.
  const second = await Escrow.create({
    appId: APP, environment: ENV, idempotencyKey: key('hold-2'),
    payerWalletId: buyer, beneficiaryWalletId: seller, amount: 20_000n, currency: 'XAF', reference: `SC-${run}-2`,
  });
  await Escrow.release({ appId: APP, environment: ENV, idempotencyKey: key('rel-2'), holdId: second.hold!.id });
  b = await balances(buyer);
  s = await balances(seller);
  check('release refunds the buyer in full', b.available === 65_000n, `${b.available}`);
  check('release empties the seller lock', s.locked === 0n && s.available === 31_500n);

  // 6. Dispute freezes, only an explicit resolution settles.
  const third = await Escrow.create({
    appId: APP, environment: ENV, idempotencyKey: key('hold-3'),
    payerWalletId: buyer, beneficiaryWalletId: seller, amount: 10_000n, currency: 'XAF', reference: `SC-${run}-3`,
  });
  await Escrow.dispute({ appId: APP, environment: ENV, holdId: third.hold!.id, reason: 'Travail non conforme' });
  await rejects('a disputed hold cannot be captured without resolution', () =>
    Escrow.capture({ appId: APP, environment: ENV, idempotencyKey: key('cap-3'), holdId: third.hold!.id }), 'HOLD_DISPUTED');
  const resolved = await Escrow.release({ appId: APP, environment: ENV, idempotencyKey: key('rel-3'), holdId: third.hold!.id, resolveDispute: true });
  check('dispute resolved by refund', resolved.hold?.status === 'RELEASED');

  // 7. Racing settlements: exactly one wins.
  const fourth = await Escrow.create({
    appId: APP, environment: ENV, idempotencyKey: key('hold-4'),
    payerWalletId: buyer, beneficiaryWalletId: seller, amount: 5_000n, currency: 'XAF', reference: `SC-${run}-4`,
  });
  const race = await Promise.allSettled([
    Escrow.capture({ appId: APP, environment: ENV, idempotencyKey: key('race-cap'), holdId: fourth.hold!.id }),
    Escrow.release({ appId: APP, environment: ENV, idempotencyKey: key('race-rel'), holdId: fourth.hold!.id }),
  ]);
  check('concurrent capture/release: exactly one succeeds', race.filter((r) => r.status === 'fulfilled').length === 1);
  b = await balances(buyer);
  s = await balances(seller);
  check('no money created or lost after the race', b.available + s.available + s.locked === 100_000n - 3_500n, `${b.available}+${s.available}+${s.locked}`);

  // 8. Every transaction of this run is balanced, and locked balances match the ledger.
  // (The whole sandbox ledger is not: the faucet genesis mints credits without a debit.)
  const [led] = await query(
    `SELECT SUM(CASE WHEN e.direction='DEBIT' THEN e.amount ELSE 0 END) d, SUM(CASE WHEN e.direction='CREDIT' THEN e.amount ELSE 0 END) c, COUNT(DISTINCT t.id) n
     FROM ledger_entries e JOIN transactions t ON t.id = e.transaction_id WHERE t.idempotency_key LIKE $1`,
    [`escrow-test-${run}-%`],
    ENV
  );
  check(`ledger balanced for this run's ${led.n} transactions`, led.d === led.c, `${led.d} / ${led.c}`);
  const [lockedLedger] = await query(
    `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END),0) v FROM ledger_entries WHERE wallet_id = $1 AND bucket = 'LOCKED'`,
    [seller],
    ENV
  );
  check("seller's locked balance equals its LOCKED ledger", BigInt(lockedLedger.v) === s.locked, `${lockedLedger.v} vs ${s.locked}`);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll escrow checks passed');
}

main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(async () => {
    await Promise.allSettled([sandboxPool.end(), prodPool.end()]);
    process.exit(failures ? 1 : 0);
  });
