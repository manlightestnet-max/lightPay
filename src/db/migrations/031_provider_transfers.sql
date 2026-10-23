-- ==========================================================
-- LIGHTWALLET MIGRATION 031 - TRANSFERS BETWEEN A PROVIDER'S COUNTRY WALLETS
-- ==========================================================
-- LightPay moves its own money from one country wallet of a provider to another (SasPay wallet-transfers), so that
-- a country short of funds can send again. People's wallets are never touched: only the provider's wallets move,
-- and what the move costs (provider fee, rounding) is booked as a provider cost.
--   QUEUED     waiting for its turn (SasPay takes one transfer at a time)
--   PENDING    asked to the provider, waiting for its answer (or its approval)
--   SUCCEEDED  arrived: received, rate and fee as the provider reported them
--   FAILED     refused by the provider (nothing moved)   ·   CANCELLED   withdrawn by the admin before it was asked
CREATE TABLE IF NOT EXISTS provider_transfers (
    id VARCHAR(40) PRIMARY KEY,
    environment VARCHAR(20) NOT NULL,
    provider VARCHAR(30) NOT NULL,
    from_country CHAR(3) NOT NULL,
    to_country CHAR(3) NOT NULL,
    amount NUMERIC(20, 0) NOT NULL CHECK (amount > 0),
    status VARCHAR(12) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    provider_reference VARCHAR(100),
    received NUMERIC(20, 0),
    received_currency VARCHAR(10),
    rate VARCHAR(30),
    fee NUMERIC(20, 0),
    failure_code VARCHAR(60),
    -- manual (the admin), low (a wallet under its low threshold), payout (a withdrawal waiting for it)
    reason VARCHAR(12) NOT NULL DEFAULT 'manual',
    requested_by TEXT,
    -- The ledger entry of its cost, once booked.
    cost_transaction_id UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    CHECK (from_country <> to_country)
);
CREATE INDEX IF NOT EXISTS idx_provider_transfers_open ON provider_transfers (environment, provider, status, created_at) WHERE status IN ('QUEUED', 'PENDING');
CREATE INDEX IF NOT EXISTS idx_provider_transfers_recent ON provider_transfers (environment, created_at DESC);

-- A withdrawal or refund that waits for a transfer to its country before leaving (programmed, released when it arrives).
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS waiting_transfer VARCHAR(40);
CREATE INDEX IF NOT EXISTS idx_payouts_waiting_transfer ON payouts (waiting_transfer) WHERE waiting_transfer IS NOT NULL;
