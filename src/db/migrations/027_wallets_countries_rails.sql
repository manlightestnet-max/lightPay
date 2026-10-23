-- ==========================================================
-- LIGHTWALLET MIGRATION 027 - SEVERAL WALLETS, COUNTRIES, RAILS
-- ==========================================================
-- 1. A person (or an app) may hold several wallets. owner_id is who owns the wallet ("user:<uid>"); the default
--    wallet keeps account_id = owner_id, so the existing unique key (app_id, account_id, currency, environment)
--    and every ON CONFLICT on it keep working. Other wallets get account_id = "<owner_id>/w_<random>".
--    One default per owner and currency. Nothing about money changes: all existing wallets become defaults.
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS owner_id VARCHAR(100);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS label VARCHAR(40);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS country CHAR(3);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE wallets SET owner_id = account_id WHERE owner_id IS NULL;
UPDATE wallets SET label = 'Principal' WHERE label IS NULL AND account_type = 'USER';
UPDATE wallets SET country = 'COG' WHERE country IS NULL AND account_type = 'USER';

-- Inserts that do not name an owner (system, merchant, guest wallets, older code) own themselves.
CREATE OR REPLACE FUNCTION wallets_fill_owner() RETURNS trigger AS $$
BEGIN
  NEW.owner_id := COALESCE(NEW.owner_id, NEW.account_id);
  IF NEW.account_type = 'USER' THEN
    NEW.label := COALESCE(NEW.label, 'Principal');
    NEW.country := COALESCE(NEW.country, 'COG');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Migrations run at every start: lock the wallets table only the first time.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_wallets_fill_owner') THEN
    CREATE TRIGGER trg_wallets_fill_owner BEFORE INSERT ON wallets FOR EACH ROW EXECUTE FUNCTION wallets_fill_owner();
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wallets' AND column_name = 'owner_id' AND is_nullable = 'YES') THEN
    ALTER TABLE wallets ALTER COLUMN owner_id SET NOT NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_wallets_owner ON wallets(owner_id, environment);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_one_default ON wallets(app_id, owner_id, currency, environment) WHERE is_default;

-- 2. Countries: what LightPay knows of a country (number format, currency). Rows, not code.
CREATE TABLE IF NOT EXISTS countries (
    code CHAR(3) PRIMARY KEY,               -- ISO 3166-1 alpha-3 (COG, CMR, CIV, TGO)
    iso2 CHAR(2) NOT NULL,                  -- what SasPay uses (CG, CM, CI, TG)
    name VARCHAR(60) NOT NULL,
    dial_code VARCHAR(4) NOT NULL,          -- 242
    currency VARCHAR(10) NOT NULL,          -- XAF, XOF
    national_pattern TEXT NOT NULL,         -- national number without the dial code, e.g. ^0[4-6][0-9]{7}$
    enabled BOOLEAN NOT NULL DEFAULT FALSE, -- open to people (the admin decides)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO countries (code, iso2, name, dial_code, currency, national_pattern, enabled)
VALUES ('COG', 'CG', 'Congo-Brazzaville', '242', 'XAF', '^0[4-6][0-9]{7}$', TRUE)
ON CONFLICT (code) DO NOTHING;

-- 3. Rails: one way of paying in a country (an operator), its number prefixes and each provider's code for it.
--    network is the code the ledger already stores (payouts.network, attempts.network).
CREATE TABLE IF NOT EXISTS rails (
    method VARCHAR(30) PRIMARY KEY,         -- our code, the only one apps and people see (mtn_cg)
    country CHAR(3) NOT NULL REFERENCES countries(code),
    network VARCHAR(30) NOT NULL UNIQUE,    -- MTN_MOMO_COG
    name VARCHAR(40) NOT NULL,              -- MTN MoMo
    prefixes TEXT[] NOT NULL DEFAULT '{}',  -- national prefixes: {06}
    auth VARCHAR(10) NOT NULL DEFAULT 'push' CHECK (auth IN ('push', 'otp', 'redirect')),
    provider_codes JSONB NOT NULL DEFAULT '{}'::jsonb, -- {"saspay": "mtn_cg", "pawapay": "MTN_MOMO_COG"}
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    position INTEGER NOT NULL DEFAULT 0,    -- display order within the country
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rails_country ON rails(country, position);

INSERT INTO rails (method, country, network, name, prefixes, auth, provider_codes, enabled, position) VALUES
  ('mtn_cg', 'COG', 'MTN_MOMO_COG', 'MTN MoMo', '{06}', 'push', '{"saspay": "mtn_cg", "pawapay": "MTN_MOMO_COG"}', TRUE, 1),
  ('airtel_cg', 'COG', 'AIRTEL_COG', 'Airtel Money', '{05,04}', 'push', '{"saspay": "airtel_cg", "pawapay": "AIRTEL_COG"}', TRUE, 2)
ON CONFLICT (method) DO NOTHING;
