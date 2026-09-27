/**
 * Fee arithmetic (no database, no network). Run: npx tsx test/fees.test.ts
 * Defaults: collection LightPay fee 5 min; payout: SasPay max(4 %, 700), LightPay 5; withdrawal min 1000.
 */
import {
  lightpayCollectionFee,
  lightpayPayoutFee,
  minWithdrawalAmount,
  providerPayoutFee,
  quote,
  refundSendable,
  withdrawalQuote,
} from '../src/payments/fees.js';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

check('LightPay collection fee: 5 minimum', lightpayCollectionFee(200n) === 5n && lightpayCollectionFee(1_000_000n) === 5n);
check('LightPay payout fee: 5 minimum', lightpayPayoutFee(1000n) === 5n);
check('SasPay payout fee: 700 minimum below 17 500', providerPayoutFee('saspay', 1000n) === 700n && providerPayoutFee('saspay', 17_500n) === 700n);
check('SasPay payout fee: 4 % above (rounded up)', providerPayoutFee('saspay', 17_501n) === 701n && providerPayoutFee('saspay', 50_000n) === 2000n);
check('simulator payout fee: 0', providerPayoutFee('simulator', 50_000n) === 0n);
check('withdrawal minimum 1000', minWithdrawalAmount() === 1000n);

const wq = withdrawalQuote(5000n, 'saspay', 'XAF');
check('withdraw 5 000 via SasPay: 700 + 5 -> total 5 705', wq.amount === '5000' && wq.operator_fee === '700' && wq.lightpay_fee === '5' && wq.total === '5705', JSON.stringify(wq));
const dq = quote(200n, 'saspay');
check('deposit 200 via SasPay: 5 + ≈14 -> ≈219', dq.lightpay_fee === '5' && dq.operator_fee === '14' && dq.total === '219', JSON.stringify(dq));

// refundSendable against its definition, brute force.
let bad = '';
for (let t = 0n; t <= 200_000n && !bad; t += t < 20_000n ? 1n : 7n) {
  const s = refundSendable(t, 'saspay');
  const fits = s === 0n || s + providerPayoutFee('saspay', s) <= t;
  const maximal = s + 1n + providerPayoutFee('saspay', s + 1n) > t;
  if (!fits || !maximal) bad = `total ${t} -> ${s}`;
}
check('refundSendable is the exact maximum (0 … 200 000)', !bad, bad);
check('refund of 35 000 via SasPay sends 33 653 (+1 347 fee)', refundSendable(35_000n, 'saspay') === 33_653n);
check('refund below the 700 fee sends nothing', refundSendable(700n, 'saspay') === 0n && refundSendable(701n, 'saspay') === 1n);
check('refund at the 4 % boundary', refundSendable(18_200n, 'saspay') === 17_500n && refundSendable(18_201n, 'saspay') === 17_500n);
check('simulator refund sends everything', refundSendable(12_345n, 'simulator') === 12_345n);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll fee checks passed');
process.exit(failures ? 1 : 0);
