/**
 * Delays, limits and emergency brake (no database, no network). Run: npx tsx test/controls.test.ts
 */
import { DEFAULT_CONTROL_SETTINGS, ControlSettingsError, validateControlSettings } from '../src/payments/control-settings.js';
import { LEVELS, LockedError, guardDatabase, guardMoney, guardTransaction, guardWithdrawals, levelNow, rank, setStored, withBypass, withdrawalsClosed } from '../src/security/lockdown.js';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};
const throws = (fn: () => unknown) => {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof LockedError;
  }
};
const refuses = (input: unknown) => {
  try {
    validateControlSettings(input);
    return false;
  } catch (e) {
    return e instanceof ControlSettingsError;
  }
};

// ---- settings
check('defaults are valid and a refund waits 5 minutes', JSON.stringify(validateControlSettings({ ...DEFAULT_CONTROL_SETTINGS })) === JSON.stringify(DEFAULT_CONTROL_SETTINGS) && DEFAULT_CONTROL_SETTINGS.refund_delay_minutes === 5);
check('a delay above a day is refused', refuses({ ...DEFAULT_CONTROL_SETTINGS, withdrawal_delay_minutes: 1441 }));
check('a negative or decimal value is refused', refuses({ ...DEFAULT_CONTROL_SETTINGS, refund_delay_minutes: -1 }) && refuses({ ...DEFAULT_CONTROL_SETTINGS, refund_delay_minutes: 2.5 }));
check('0 attempts means no limit and is accepted', validateControlSettings({ ...DEFAULT_CONTROL_SETTINGS, withdrawal_max_attempts: 0 }).withdrawal_max_attempts === 0);
check('a suspension of 0 minutes is refused', refuses({ ...DEFAULT_CONTROL_SETTINGS, withdrawal_suspension_minutes: 0 }));
check('a missing key is refused', refuses({ withdrawal_delay_minutes: 1 }));

// ---- emergency brake (state set by hand: no database)
const at = (level: (typeof LEVELS)[number]) => setStored({ level, reason: 'test', since: null, by: null });
at('off');
check('off: nothing is stopped', !throws(() => guardMoney()) && !throws(() => guardWithdrawals()) && !throws(() => guardDatabase('UPDATE wallets SET x = 1')) && !withdrawalsClosed());
at('withdrawals');
check('withdrawals: withdrawals refused, other money still moves, database writes allowed', throws(() => guardWithdrawals()) && !throws(() => guardMoney()) && !throws(() => guardTransaction()) && withdrawalsClosed());
at('payments');
check('payments: no money movement at all, reads fine', throws(() => guardMoney()) && throws(() => guardWithdrawals()) && !throws(() => guardDatabase('SELECT 1')));
at('readonly');
check('readonly: writes refused, reads allowed', throws(() => guardDatabase('INSERT INTO wallets VALUES (1)')) && throws(() => guardTransaction()) && !throws(() => guardDatabase('SELECT * FROM wallets FOR UPDATE')) );
at('total');
check('total: even a read is refused', throws(() => guardDatabase('SELECT 1')) && levelNow() === 'total');
check('the admin\'s own lock screen still works when total (bypass)', await withBypass(async () => !throws(() => guardDatabase('SELECT 1'))));
check('levels are ordered', LEVELS.every((l, i) => rank(l) === i));
at('off');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll control checks passed');
process.exit(failures ? 1 : 0);
