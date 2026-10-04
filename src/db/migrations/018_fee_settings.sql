-- ==========================================================
-- LIGHTWALLET MIGRATION 018 - FEES AND MINIMUMS, SET BY THE ADMIN
-- ==========================================================
-- One row per ledger: every fee and minimum LightPay applies. Changed only from the admin
-- console (recent sign-in, logged in admin_audit). The values below are the starting point.
CREATE TABLE IF NOT EXISTS fee_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    settings JSONB NOT NULL,
    updated_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO fee_settings (id, settings) VALUES (1, '{
  "deposit_min": 1000,
  "deposit_lightpay_fee_min": 5,
  "deposit_lightpay_fee_bps": 0,
  "deposit_operator_fee_bps": 650,
  "withdrawal_min": 200,
  "withdrawal_lightpay_fee_min": 5,
  "withdrawal_lightpay_fee_bps": 0,
  "withdrawal_operator_fee_bps": 400,
  "withdrawal_operator_fee_min": 0
}'::jsonb)
ON CONFLICT (id) DO NOTHING;
