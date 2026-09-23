-- ==========================================================
-- LIGHTWALLET MIGRATION 007 - SANDBOX TREASURY INITIALIZATION
-- ==========================================================

-- Alimentation initiale de la Trésorerie Centrale Sandbox (SYSTEM_MAIN_TREASURY) à 10 000 000 Crédits
-- Cette réserve centrale permet de doter automatiquement tout nouveau portefeuille marchand créé.
INSERT INTO wallets (app_id, account_id, account_type, currency, environment, available_balance, locked_balance, status, metadata)
VALUES (
  'mainapp',
  'SYSTEM_MAIN_TREASURY',
  'SYSTEM',
  'CREDIT',
  'sandbox',
  10000000,
  0,
  'ACTIVE',
  '{"role":"main_treasury_reserve","desc":"Coffre-fort central de liquidité sandbox"}'::jsonb
)
ON CONFLICT (app_id, account_id, currency, environment)
DO UPDATE SET
  available_balance = 10000000,
  locked_balance = 0,
  status = 'ACTIVE',
  updated_at = NOW();
