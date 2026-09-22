import { prodPool, sandboxPool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import fs from 'fs';
import path from 'path';

async function reset() {
  console.log('[RESET] Truncating production database tables (lightwallet)...');
  await prodPool.query('TRUNCATE TABLE ledger_entries, transactions, wallets, apps CASCADE;');
  console.log('[RESET] Production database truncated.');

  console.log('[RESET] Truncating sandbox database tables (lightwallet_sandbox)...');
  await sandboxPool.query('TRUNCATE TABLE ledger_entries, transactions, wallets, apps CASCADE;');
  console.log('[RESET] Sandbox database truncated.');

  console.log('[RESET] Re-running migrations on both databases...');
  await runMigrations();
  console.log('[RESET] Migrations applied successfully on both databases.');

  const usersFile = path.resolve(process.cwd(), 'data', 'app-users.json');
  if (fs.existsSync(usersFile)) {
    fs.writeFileSync(usersFile, '[]', 'utf8');
    console.log('[RESET] Cleared data/app-users.json.');
  }

  await prodPool.end();
  await sandboxPool.end();
  console.log('[RESET] Both databases successfully reset to clean ZERO state!');
}

reset().catch((err) => {
  console.error('[RESET ERROR]', err);
  process.exit(1);
});
