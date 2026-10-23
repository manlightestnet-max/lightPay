-- ==========================================================
-- LIGHTWALLET MIGRATION 028 - RESERVES PER PROVIDER AND COUNTRY
-- ==========================================================
-- 1. A balance reading belongs to one of the provider's country wallets (SasPay and pawaPay keep one per country).
--    Older readings have no country: they were all Congo. pending: what the provider reports as reserved by
--    operations not finished yet (SasPay pending_amount), kept beside the available balance. checked_by = 'auto'
--    for the readings LightPay makes itself through the provider's API. Still a note: no money moves.
ALTER TABLE provider_balance_checks ADD COLUMN IF NOT EXISTS country CHAR(3);
ALTER TABLE provider_balance_checks ADD COLUMN IF NOT EXISTS pending NUMERIC(20, 0);
CREATE INDEX IF NOT EXISTS provider_balance_checks_wallet ON provider_balance_checks (environment, provider, country, checked_at DESC);

-- 2. What the admin sets for the reserves (per ledger): alert on a gap, automatic readings, and per provider wallet
--    (provider + country) a safety minimum, a low threshold and a target level. Same shape as control_settings.
CREATE TABLE IF NOT EXISTS reserve_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    settings JSONB NOT NULL,
    updated_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. The starting countries, known but closed until the admin opens them (their operators come later).
INSERT INTO countries (code, iso2, name, dial_code, currency, national_pattern, enabled) VALUES
  ('CMR', 'CM', 'Cameroun', '237', 'XAF', '^6[0-9]{8}$', FALSE),
  ('CIV', 'CI', 'Côte d''Ivoire', '225', 'XOF', '^0[157][0-9]{8}$', FALSE),
  ('TGO', 'TG', 'Togo', '228', 'XOF', '^[79][0-9]{7}$', FALSE)
ON CONFLICT (code) DO NOTHING;
