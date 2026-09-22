import fs from 'fs';
import { pool } from '../src/db/pool.js';

async function resetDb() {
  console.log('[RESET] Starting database cleanup...');

  let currentAppId = 'app_client_1790005918108';
  if (fs.existsSync('data/client-app-config.json')) {
    const config = JSON.parse(fs.readFileSync('data/client-app-config.json', 'utf8'));
    currentAppId = config.appId;
  }
  console.log('[RESET] Keeping only current app:', currentAppId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Purge des journaux et transactions
    await client.query('DELETE FROM webhook_logs;');
    await client.query('DELETE FROM holds;');
    await client.query('DELETE FROM ledger_entries;');
    await client.query('DELETE FROM transactions;');

    // 2. Suppression de tous les portefeuilles sauf le SYSTEM de l'app actuelle
    await client.query(
      "DELETE FROM wallets WHERE app_id != $1 OR account_type != 'SYSTEM';",
      [currentAppId]
    );

    // 3. Réinitialisation du solde de la passerelle système
    await client.query(
      "UPDATE wallets SET available_balance = 0, locked_balance = 0 WHERE app_id = $1 AND account_type = 'SYSTEM';",
      [currentAppId]
    );

    // S'assurer que le wallet SYSTEM pour AOA est présent avec solde 0
    await client.query(
      `INSERT INTO wallets (app_id, account_id, account_type, currency, available_balance, locked_balance, metadata)
       VALUES ($1, 'SYSTEM_CASH_GATEWAY', 'SYSTEM', 'AOA', 0, 0, '{"role":"system_cash_gateway"}')
       ON CONFLICT (app_id, account_id, currency) DO UPDATE SET available_balance = 0, locked_balance = 0;`,
      [currentAppId]
    );

    // 4. Suppression des anciennes applications de test
    await client.query('DELETE FROM apps WHERE id != $1;', [currentAppId]);

    await client.query('COMMIT');
    console.log('[RESET SUCCESS] Neon database cleaned. Only current app preserved.');

    // 5. Réinitialisation du fichier local des utilisateurs
    fs.writeFileSync('data/app-users.json', '[]', 'utf8');
    console.log('[RESET SUCCESS] data/app-users.json emptied.');
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[RESET ERROR]', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

resetDb();
