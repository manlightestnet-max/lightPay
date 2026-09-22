-- ==========================================================
-- LIGHTWALLET MIGRATION 003 - APPLICATION QUOTAS & LIMITS
-- ==========================================================

-- 1. Ajout des colonnes de gestion des risques et limites par application
ALTER TABLE apps ADD COLUMN IF NOT EXISTS max_amount_per_tx BIGINT DEFAULT 250000;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS daily_volume_limit BIGINT DEFAULT 2000000;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS rate_limit_rpm INTEGER DEFAULT 60;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS contact_email VARCHAR(150);
ALTER TABLE apps ADD COLUMN IF NOT EXISTS description TEXT;

-- 2. Mise a jour des applications existantes avec les valeurs par defaut
UPDATE apps SET 
  max_amount_per_tx = COALESCE(max_amount_per_tx, 250000),
  daily_volume_limit = COALESCE(daily_volume_limit, 2000000),
  rate_limit_rpm = COALESCE(rate_limit_rpm, 60)
WHERE max_amount_per_tx IS NULL OR daily_volume_limit IS NULL OR rate_limit_rpm IS NULL;
