-- ==========================================================
-- LIGHTWALLET MIGRATION 011 - FEES ON MOBILE-MONEY COLLECTIONS
-- ==========================================================
-- amount          = what the provider is asked to collect (requested + LightPay fee)
-- lightpay_fee    = LightPay's own fee (credited to the LIGHTPAY_FEES wallet)
-- provider_fee    = operator fee reported by the provider (paid by the payer on top)
-- charged_amount  = exact amount debited from the payer's phone, when known
ALTER TABLE collection_attempts ADD COLUMN IF NOT EXISTS lightpay_fee BIGINT NOT NULL DEFAULT 0;
ALTER TABLE collection_attempts ADD COLUMN IF NOT EXISTS provider_fee BIGINT;
ALTER TABLE collection_attempts ADD COLUMN IF NOT EXISTS charged_amount BIGINT;
