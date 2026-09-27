/**
 * Generates the MAINAPP key. Run it on your machine only:
 *   npx tsx scripts/generate-mainapp-key.ts
 *
 * - MAINAPP_KEY       (sec_main_…): keep it in your password manager / the central app's
 *                     server secrets. Never commit it, never put it in a front-end.
 * - MAINAPP_KEY_HASH  (scrypt$…):   set it in the server environment (Render). It is the
 *                     only thing the server knows; the database holds nothing for mainapp.
 *
 * Generating a new pair and replacing MAINAPP_KEY_HASH revokes the previous key.
 */
import { generateMainappKey } from '../src/security/app-identity.js';

const { key, hash } = generateMainappKey();
console.log('\nMAINAPP_KEY (secret, keep it safe):');
console.log(key);
console.log('\nMAINAPP_KEY_HASH (server environment):');
console.log(hash);
console.log('');
