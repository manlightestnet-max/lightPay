-- ==========================================================
-- LIGHTWALLET MIGRATION 032 - THE PERSON CHOOSES THEIR COUNTRY, AND ASKS TO CHANGE IT
-- ==========================================================
-- 1. A person's first wallet was opened in Congo by default: they confirm (or choose) its country once, before using
--    it. NULL = not chosen yet. Wallets opened later carry the country chosen when opening them.
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS country_confirmed_at TIMESTAMP WITH TIME ZONE;

-- 2. Moving a wallet to another country afterwards is asked by the person and decided by the admin. On approval the
--    wallet changes country and LightPay's swap fee (Frais et minimums) is taken from its balance.
--    PENDING → APPROVED | REJECTED (the admin) | CANCELLED (the person, while pending).
CREATE TABLE IF NOT EXISTS wallet_country_requests (
    id VARCHAR(40) PRIMARY KEY,
    environment VARCHAR(20) NOT NULL,
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    uid VARCHAR(128) NOT NULL,
    from_country CHAR(3),
    to_country CHAR(3) NOT NULL,
    reason TEXT,
    status VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    fee_amount NUMERIC(20, 0),
    transaction_id UUID,
    decided_by TEXT,
    decision_note TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMP WITH TIME ZONE
);
-- One request waiting per wallet at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_country_requests_one_pending ON wallet_country_requests (wallet_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_country_requests_status ON wallet_country_requests (environment, status, created_at);
