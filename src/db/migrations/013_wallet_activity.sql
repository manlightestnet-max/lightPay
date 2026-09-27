-- ==========================================================
-- LIGHTWALLET MIGRATION 013 - WALLET ACTIVITY JOURNAL
-- ==========================================================
-- Every operation that reaches the API for a person's wallet leaves a trace, succeeded
-- or not: deposits (per mobile-money attempt), transfers, withdrawals, wallet payments,
-- app charges, sales held in escrow, refunds. The ledger stays the source of truth for
-- money; this journal is what the person sees (state + reason of a refusal).
CREATE TABLE IF NOT EXISTS wallet_activity (
    id VARCHAR(64) PRIMARY KEY, -- act_…
    environment VARCHAR(20) NOT NULL,
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    kind VARCHAR(20) NOT NULL,       -- DEPOSIT, TRANSFER, WITHDRAWAL, PAYMENT, CHARGE, SALE, REFUND
    direction VARCHAR(3) NOT NULL,   -- IN, OUT
    status VARCHAR(20) NOT NULL,     -- PENDING, SUCCEEDED, FAILED, LOCKED, REFUNDED, EXPIRED, CANCELLED
    amount BIGINT NOT NULL DEFAULT 0,
    fees BIGINT NOT NULL DEFAULT 0,
    total BIGINT,
    currency VARCHAR(20) NOT NULL DEFAULT 'XAF',
    counterparty TEXT,
    reason_code VARCHAR(60),
    reason TEXT,
    ref_type VARCHAR(30),
    ref_id VARCHAR(120),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT activity_direction_valid CHECK (direction IN ('IN', 'OUT')),
    CONSTRAINT activity_status_valid CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'LOCKED', 'REFUNDED', 'EXPIRED', 'CANCELLED'))
);
-- One line per (wallet, operation): retries and webhooks update it instead of duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_ref ON wallet_activity(wallet_id, ref_type, ref_id) WHERE ref_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activity_wallet ON wallet_activity(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_ref_lookup ON wallet_activity(ref_type, ref_id);
