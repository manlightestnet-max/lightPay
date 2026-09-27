/**
 * App identity security (no database, no network).
 * Run: npx tsx test/app-identity.test.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  APP_ID_PATTERN,
  generateMainappKey,
  isReservedAppId,
  resetMainappVerification,
  verifyMainappKey,
} from '../src/security/app-identity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures++;
};

// Reserved ids and id format.
check('mainapp is reserved (any case)', isReservedAppId('mainapp') && isReservedAppId(' MainApp '));
check('system_master is reserved', isReservedAppId('system_master'));
check('a normal id is not reserved', !isReservedAppId('salacope'));
check('valid id accepted', APP_ID_PATTERN.test('salacope') && APP_ID_PATTERN.test('app_shop-2'));
check('too short / bad chars rejected', !APP_ID_PATTERN.test('ab') && !APP_ID_PATTERN.test('_x') && !APP_ID_PATTERN.test('a'.repeat(51)));

// Mainapp key: scrypt hash in the environment only.
const { key, hash } = generateMainappKey();
check('key has the sec_main_ prefix', key.startsWith('sec_main_') && key.length > 60);
check('hash is scrypt, never the key itself', hash.startsWith('scrypt$') && !hash.includes(key));
check('no hash in environment = mainapp locked', verifyMainappKey(key, undefined) === 'locked');
check('right key accepted', verifyMainappKey(key, hash) === 'ok');
check('right key accepted again (cached)', verifyMainappKey(key, hash) === 'ok');
resetMainappVerification();
check('wrong key refused', verifyMainappKey(`${key}x`, hash) === 'invalid');
check('key without prefix refused', verifyMainappKey(key.replace('sec_main_', 'sec_live_'), hash) === 'invalid');
const other = generateMainappKey();
check('rotating the hash revokes the old key', verifyMainappKey(key, other.hash) === 'invalid');
resetMainappVerification();
for (let i = 0; i < 5; i++) verifyMainappKey(`sec_main_guess${i}`, hash);
check('brute force throttled after 5 failures/minute', verifyMainappKey(`sec_main_guess6`, hash) === 'throttled');
resetMainappVerification();

// Static guards in the code.
const merchant = fs.readFileSync(path.resolve(__dirname, '../src/routes/merchant.ts'), 'utf8');
check('registration never overwrites an app', !/ON CONFLICT \(id\) DO UPDATE/.test(merchant));
check('registration refuses reserved ids', merchant.includes('isReservedAppId(cleanId)'));
check('registration refuses taken ids (409)', merchant.includes("'APP_ID_TAKEN'"));
const auth = fs.readFileSync(path.resolve(__dirname, '../src/middleware/app-auth.ts'), 'utf8');
check('database keys can never open a reserved app', (auth.match(/isReservedAppId\(apps\[0\]\.id\)/g) || []).length === 2);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll app identity checks passed');
process.exit(failures ? 1 : 0);
