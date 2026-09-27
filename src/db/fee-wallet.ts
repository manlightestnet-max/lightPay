import { query } from './pool.js';
import { Environment } from '../types/index.js';

/** LightPay's own revenue wallet (fees on collections and payouts), per environment and currency. */
export async function lightpayFeeWallet(environment: Environment, currency: string): Promise<string> {
  const [existing] = await query(
    `SELECT id FROM wallets WHERE app_id = 'mainapp' AND account_id = 'LIGHTPAY_FEES' AND currency = $1 AND environment = $2`,
    [currency, environment],
    environment
  );
  if (existing) return existing.id;
  const [created] = await query(
    `INSERT INTO wallets (app_id, account_id, account_type, currency, environment, metadata)
     VALUES ('mainapp', 'LIGHTPAY_FEES', 'PLATFORM', $1, $2, '{"role":"lightpay_fee_revenue"}')
     ON CONFLICT (app_id, account_id, currency, environment) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [currency, environment],
    environment
  );
  return created.id;
}
