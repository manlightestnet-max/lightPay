-- ==========================================================
-- LIGHTWALLET MIGRATION 026 - PROVIDER BALANCE CHECKS
-- ==========================================================
-- The real balance the owner read at a provider (its own dashboard), kept to compare with what LightPay expects
-- there (collected − sent + payouts not sent yet). One row per reading: the admin shows the latest and the gap.
-- Nothing here moves money: it is a note beside the ledger.
CREATE TABLE IF NOT EXISTS provider_balance_checks (
    id BIGSERIAL PRIMARY KEY,
    environment VARCHAR(20) NOT NULL,
    provider VARCHAR(30) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    balance NUMERIC(20, 0) NOT NULL,
    note TEXT,
    checked_by TEXT,
    checked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS provider_balance_checks_latest ON provider_balance_checks (environment, provider, checked_at DESC);
