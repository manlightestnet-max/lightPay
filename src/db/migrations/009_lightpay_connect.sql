-- ==========================================================
-- LIGHTWALLET MIGRATION 009 - LIGHTPAY CONNECT (USER WALLETS + APP AUTHORIZATIONS)
-- ==========================================================
-- A person signs in to LightPay (Firebase identity) and owns a USER wallet under
-- mainapp (account_id 'user:<firebase uid>'). An app acts on it only through a
-- CONNECTION the person approved (OAuth 2 authorization code + PKCE), limited to scopes:
--   balance:read  payee  deposit  charge (with a per-payment limit)

-- 1. Allowed redirect URIs per app (exact match).
ALTER TABLE apps ADD COLUMN IF NOT EXISTS redirect_uris JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 2. Connections (person <-> app, per environment).
CREATE TABLE IF NOT EXISTS connections (
    id VARCHAR(64) PRIMARY KEY, -- conn_…
    app_id VARCHAR(50) NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
    environment VARCHAR(20) NOT NULL,
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    user_uid VARCHAR(128) NOT NULL,
    scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
    charge_limit BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, REVOKED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    revoked_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT connection_status_valid CHECK (status IN ('ACTIVE', 'REVOKED')),
    CONSTRAINT connection_charge_limit_valid CHECK (charge_limit >= 0)
);

-- One active connection per person, app and environment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_active ON connections(app_id, environment, wallet_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_connections_user ON connections(user_uid, environment);

-- 3. One-time authorization codes (only their SHA-256 is stored; 5 minutes; PKCE S256).
CREATE TABLE IF NOT EXISTS authorization_codes (
    code_hash VARCHAR(64) PRIMARY KEY,
    connection_id VARCHAR(64) NOT NULL REFERENCES connections(id) ON DELETE RESTRICT,
    app_id VARCHAR(50) NOT NULL,
    environment VARCHAR(20) NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge VARCHAR(128) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Checkout sessions: deposits into a person's own wallet, and who paid.
ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'PAYMENT'; -- PAYMENT, DEPOSIT
ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS payee_connection_id VARCHAR(64) REFERENCES connections(id) ON DELETE RESTRICT;
ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS payer_type VARCHAR(20); -- GUEST, USER

-- 5. Wallet lookups by person.
CREATE INDEX IF NOT EXISTS idx_wallets_account ON wallets(account_id, environment);
