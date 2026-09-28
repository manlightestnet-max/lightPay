-- ==========================================================
-- LIGHTWALLET MIGRATION 016 - ADMIN CONSOLE AUDIT LOG
-- ==========================================================
-- Every action taken from the owner's admin console (sending from the main wallet, recharging
-- it): who, what, when, how much. Append-only; the ledger stays the source of truth for money.
CREATE TABLE IF NOT EXISTS admin_audit (
    id VARCHAR(64) PRIMARY KEY, -- adm_…
    environment VARCHAR(20) NOT NULL,
    admin_uid VARCHAR(128) NOT NULL,
    admin_email TEXT,
    action VARCHAR(40) NOT NULL,     -- MAIN_SEND, MAIN_RECHARGE
    target TEXT,
    amount BIGINT,
    currency VARCHAR(20),
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at DESC);
