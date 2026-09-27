import crypto from 'crypto';
import { query } from './pool.js';
import { Environment } from '../types/index.js';

/** Fresh live/test API keys and webhook secret; only hashes of the API keys are stored. */
export const generateAppCredentials = () => {
  const liveKey = `sec_live_${crypto.randomBytes(24).toString('hex')}`;
  const testKey = `sec_test_${crypto.randomBytes(24).toString('hex')}`;
  return {
    liveKey,
    testKey,
    liveKeyHash: crypto.createHash('sha256').update(liveKey).digest('hex'),
    testKeyHash: crypto.createHash('sha256').update(testKey).digest('hex'),
    webhookSecret: `whsec_${crypto.randomBytes(24).toString('hex')}`,
    /** Last characters of each key, to recognise it later (never enough to use it). */
    liveHint: liveKey.slice(-4),
    testHint: testKey.slice(-4),
  };
};

/** The app's root merchant wallet in an environment (created on first use). */
export async function getOrCreateMerchantWallet(appId: string, environment: Environment, currency = 'CREDIT') {
  const existing = await query(
    "SELECT * FROM wallets WHERE app_id = $1 AND account_type = 'MERCHANT' AND environment = $2 AND currency = $3",
    [appId, environment, currency],
    environment
  );
  if (existing.length > 0) return existing[0];
  const created = await query(
    `INSERT INTO wallets (app_id, account_id, account_type, currency, environment, metadata)
     VALUES ($1, $1, 'MERCHANT', $2, $3, '{"role":"merchant_root"}')
     ON CONFLICT (app_id, account_id, currency, environment)
     DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [appId, currency, environment],
    environment
  );
  return created[0];
}
