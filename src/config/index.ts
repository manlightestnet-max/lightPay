import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

// ⛔ SECURITY: Crash at startup if critical secrets are missing in production.
// This prevents insecure dev defaults from accidentally running in production.
if (isProduction) {
  const requiredEnvVars = ['DATABASE_URL', 'MASTER_ADMIN_KEY'];
  const missing = requiredEnvVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(`[FATAL] Missing required environment variables in production: ${missing.join(', ')}`);
    console.error('[FATAL] LightWallet refuses to start without these secrets set.');
    process.exit(1);
  }
}

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/lightwallet',
  databaseUrlSandbox: process.env.DATABASE_URL_SANDBOX || process.env.DATABASE_URL?.replace('/lightwallet', '/lightwallet_sandbox') || 'postgresql://postgres:postgres@localhost:5432/lightwallet_sandbox',
  // ⚠️  In development this falls back to 'dev_master_key_change_in_production'.
  // In production, MASTER_ADMIN_KEY MUST be set (enforced above).
  masterAdminKey: process.env.MASTER_ADMIN_KEY || 'dev_master_key_change_in_production',
  defaultCurrency: process.env.DEFAULT_CURRENCY || 'CREDIT',
  isProduction,
};
