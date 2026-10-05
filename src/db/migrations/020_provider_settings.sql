-- ==========================================================
-- LIGHTWALLET MIGRATION 020 - MOBILE-MONEY PROVIDERS, CHOSEN BY THE ADMIN
-- ==========================================================
-- One row per ledger: which provider (saspay, pawapay…) handles collections and payouts.
-- Changed only from the admin console (recent sign-in, logged in admin_audit). No row yet:
-- the server falls back to MOBILE_MONEY_ROUTES / MOBILE_MONEY_PROVIDER.
-- Each operation keeps the provider it started with (collection_attempts.provider, payouts.provider).
CREATE TABLE IF NOT EXISTS provider_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    settings JSONB NOT NULL,
    updated_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
