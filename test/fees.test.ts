/**
 * Fee arithmetic (no database, no network). Run: npx tsx test/fees.test.ts
 * Defaults: collection LightPay fee 5 min; payout: SasPay 4 %, LightPay 5; withdrawal min 200.
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
check('SasPay payout fee: 4 %, no floor (500 -> 20, as measured live)', providerPayoutFee('saspay', 500n) === 20n && providerPayoutFee('saspay', 1000n) === 40n);
check('SasPay payout fee: 4 % rounded up', providerPayoutFee('saspay', 17_501n) === 701n && providerPayoutFee('saspay', 50_000n) === 2000n);
check('simulator payout fee: 0', providerPayoutFee('simulator', 50_000n) === 0n);
check('withdrawal minimum 200', minWithdrawalAmount() === 200n);

const wq = withdrawalQuote(5000n, 'saspay', 'XAF');
check('withdraw 5 000 via SasPay: 200 + 5 -> total 5 205', wq.amount === '5000' && wq.operator_fee === '200' && wq.lightpay_fee === '5' && wq.total === '5205', JSON.stringify(wq));
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
check('small refund keeps 4 % for SasPay', refundSendable(700n, 'saspay') === 673n && refundSendable(1n, 'saspay') === 0n);
check('refund at the 4 % boundary', refundSendable(18_200n, 'saspay') === 17_500n && refundSendable(18_201n, 'saspay') === 17_500n);
check('simulator refund sends everything', refundSendable(12_345n, 'simulator') === 12_345n);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll fee checks passed');
process.exit(failures ? 1 : 0);
