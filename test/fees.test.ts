/**
 * Fee arithmetic (no database, no network). Run: npx tsx test/fees.test.ts
 * Default settings (before the admin changes them): collection LightPay fee 5 min; payout: SasPay 4 %,
 * LightPay 5; withdrawal min 200. Every function takes the ledger first.
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
import { DEFAULT_FEE_SETTINGS, validateFeeSettings } from '../src/payments/fee-settings.js';

const E = 'production' as const;

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

check('LightPay collection fee: 5 minimum', lightpayCollectionFee(E, 200n) === 5n && lightpayCollectionFee(E, 1_000_000n) === 5n);
check('LightPay payout fee: 5 minimum', lightpayPayoutFee(E, 1000n) === 5n);
check('SasPay payout fee: 4 %, no floor (500 -> 20, as measured live)', providerPayoutFee(E, 'saspay', 500n) === 20n && providerPayoutFee(E, 'saspay', 1000n) === 40n);
check('SasPay payout fee: 4 % rounded up', providerPayoutFee(E, 'saspay', 17_501n) === 701n && providerPayoutFee(E, 'saspay', 50_000n) === 2000n);
check('simulator payout fee: 0', providerPayoutFee(E, 'simulator', 50_000n) === 0n);
check('withdrawal minimum 200', minWithdrawalAmount(E) === 200n);

const wq = withdrawalQuote(E, 5000n, 'saspay', 'XAF');
check('withdraw 5 000 via SasPay: 200 + 5 -> total 5 205', wq.amount === '5000' && wq.operator_fee === '200' && wq.lightpay_fee === '5' && wq.total === '5205', JSON.stringify(wq));
const dq = quote(E, 200n, 'saspay');
check('deposit 200 via SasPay: 5 + ≈14 -> ≈219', dq.lightpay_fee === '5' && dq.operator_fee === '14' && dq.total === '219', JSON.stringify(dq));

// refundSendable against its definition, brute force.
let bad = '';
for (let t = 0n; t <= 200_000n && !bad; t += t < 20_000n ? 1n : 7n) {
  const s = refundSendable(E, t, 'saspay');
  const fits = s === 0n || s + providerPayoutFee(E, 'saspay', s) <= t;
  const maximal = s + 1n + providerPayoutFee(E, 'saspay', s + 1n) > t;
  if (!fits || !maximal) bad = `total ${t} -> ${s}`;
}
check('refundSendable is the exact maximum (0 … 200 000)', !bad, bad);
check('refund of 35 000 via SasPay sends 33 653 (+1 347 fee)', refundSendable(E, 35_000n, 'saspay') === 33_653n);
check('small refund keeps 4 % for SasPay', refundSendable(E, 700n, 'saspay') === 673n && refundSendable(E, 1n, 'saspay') === 0n);
check('refund at the 4 % boundary', refundSendable(E, 18_200n, 'saspay') === 17_500n && refundSendable(E, 18_201n, 'saspay') === 17_500n);
check('simulator refund sends everything', refundSendable(E, 12_345n, 'simulator') === 12_345n);

let refused = '';
try { validateFeeSettings({ ...DEFAULT_FEE_SETTINGS, withdrawal_min: 0 }); } catch (e: any) { refused = e.message; }
check('settings: a minimum of 0 is refused', Boolean(refused));
let rate = '';
try { validateFeeSettings({ ...DEFAULT_FEE_SETTINGS, deposit_operator_fee_bps: 6000 }); } catch (e: any) { rate = e.message; }
check('settings: a rate above 50 % is refused', Boolean(rate));
check('settings: the defaults are valid', JSON.stringify(validateFeeSettings({ ...DEFAULT_FEE_SETTINGS })) === JSON.stringify(DEFAULT_FEE_SETTINGS));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll fee checks passed');
process.exit(failures ? 1 : 0);
