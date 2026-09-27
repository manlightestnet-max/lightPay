-- ==========================================================
-- LIGHTWALLET MIGRATION 012 - FEES ON PAYOUTS (WITHDRAWALS, REFUNDS)
-- ==========================================================
-- amount        = what the phone receives
-- operator_fee  = provider fee paid on top from our provider balance (ADD_ON)
-- lightpay_fee  = LightPay's fee (credited to LIGHTPAY_FEES)
-- total_debited = what left the wallet (amount + operator_fee + lightpay_fee)
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS operator_fee BIGINT NOT NULL DEFAULT 0;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS lightpay_fee BIGINT NOT NULL DEFAULT 0;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS total_debited BIGINT;
