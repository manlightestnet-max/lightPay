import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { query, pool } from '../src/db/pool.js';

async function main() {
  const appId = 'app_client_1790005918108';
  const rawTestKey = `sec_test_${crypto.randomBytes(24).toString('hex')}`;
  const testKeyHash = crypto.createHash('sha256').update(rawTestKey).digest('hex');

  // 1. Mettre à jour l'app avec la clé Sandbox
  await query('UPDATE apps SET test_api_key_hash = $1 WHERE id = $2', [testKeyHash, appId]);
  console.log(`[OK] Updated app ${appId} with test_api_key_hash`);

  // 2. Créer le portefeuille SYSTEM pour le sandbox
  await query(
    `INSERT INTO wallets (app_id, account_id, account_type, currency, environment, metadata)
     VALUES ($1, 'SYSTEM_CASH_GATEWAY', 'SYSTEM', 'AOA', 'sandbox', '{"role":"system_gateway_sandbox"}')
     ON CONFLICT (app_id, account_id, currency, environment) DO UPDATE SET updated_at = NOW()`,
    [appId]
  );
  console.log(`[OK] Created/ensured SYSTEM_CASH_GATEWAY sandbox wallet for ${appId}`);

  // 3. Mettre à jour le fichier de configuration client
  const configFile = path.resolve(process.cwd(), 'data', 'client-app-config.json');
  let currentConfig: any = {};
  if (fs.existsSync(configFile)) {
    currentConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  }

  const updatedConfig = {
    ...currentConfig,
    liveApiKey: currentConfig.apiKey || 'sec_live_ae32fd0840e476bf29766fd77f7270d8592cf6e5f66f0694',
    testApiKey: rawTestKey,
    apiKey: rawTestKey, // Par défaut en mode sandbox pour les tests
    activeEnv: 'sandbox',
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(configFile, JSON.stringify(updatedConfig, null, 2), 'utf8');
  console.log(`[OK] Saved client config with testApiKey: ${rawTestKey.substring(0, 15)}...`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  pool.end();
  process.exit(1);
});
