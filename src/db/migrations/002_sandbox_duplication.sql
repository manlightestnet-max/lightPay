-- ==========================================================
-- LIGHTWALLET MIGRATION 002 - SANDBOX VS LIVE DUPLICATION
-- ==========================================================

-- 1. Clé secrète de test (Sandbox) sur les applications
ALTER TABLE apps ADD COLUMN IF NOT EXISTS test_api_key_hash VARCHAR(255);

-- 2. Isolation de l'environnement sur les portefeuilles ('production' ou 'sandbox')
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS environment VARCHAR(20) NOT NULL DEFAULT 'production';

-- Mise à jour de la contrainte d'unicité pour permettre à un même account_id d'avoir un wallet Sandbox et un wallet Live
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_account_per_app_currency') THEN
    ALTER TABLE wallets DROP CONSTRAINT unique_account_per_app_currency;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_account_per_app_currency_env') THEN
    ALTER TABLE wallets ADD CONSTRAINT unique_account_per_app_currency_env UNIQUE(app_id, account_id, currency, environment);
  END IF;
END $$;

-- 3. Isolation de l'environnement sur les transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS environment VARCHAR(20) NOT NULL DEFAULT 'production';

-- 4. Isolation de l'environnement sur les écritures comptables
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS environment VARCHAR(20) NOT NULL DEFAULT 'production';

-- 5. Index pour requêtes instantanées par environnement
CREATE INDEX IF NOT EXISTS idx_wallets_env ON wallets(environment);
CREATE INDEX IF NOT EXISTS idx_transactions_env ON transactions(environment);
CREATE INDEX IF NOT EXISTS idx_ledger_env ON ledger_entries(environment);
