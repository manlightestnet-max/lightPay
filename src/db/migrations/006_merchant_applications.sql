-- ==========================================================
-- LIGHTWALLET MIGRATION 006 - MERCHANT APPLICATIONS ARCHITECTURE
-- ==========================================================

-- 1. Réassigner tout wallet utilisateur existant vers l'application centrale 'mainapp'
UPDATE wallets SET app_id = 'mainapp' WHERE account_type = 'USER' AND app_id != 'mainapp';

-- 2. Verrou de sécurité au niveau de la base :
-- Seule l'application centrale 'mainapp' est autorisée à détenir des portefeuilles clients (USER).
-- Les applications tierces sont des Marchands Grossistes (MERCHANT).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_only_mainapp_can_have_users'
  ) THEN
    ALTER TABLE wallets ADD CONSTRAINT chk_only_mainapp_can_have_users
    CHECK (account_type != 'USER' OR app_id = 'mainapp');
  END IF;
END $$;
