-- ==========================================================
-- LIGHTWALLET MIGRATION 021 - PAYOUT DELAYS, WITHDRAWAL LIMITS, EMERGENCY BRAKE
-- ==========================================================
-- 1. Payouts can wait before leaving: status SCHEDULED (released at release_at) or HELD (kept by the admin:
--    dispute, support, other). The ledger is debited at once; a cancelled payout is mirrored back to the wallet.
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS release_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS hold_kind VARCHAR(20);
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS hold_reason TEXT;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS held_by TEXT;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS held_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_payouts_due ON payouts(release_at) WHERE status = 'SCHEDULED';

-- 2. Delays and withdrawal limits, set by the admin (same shape as fee_settings).
CREATE TABLE IF NOT EXISTS control_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    settings JSONB NOT NULL,
    updated_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Withdrawal attempts (one per request, replays of the same Idempotency-Key count once) and the suspensions they cause.
CREATE TABLE IF NOT EXISTS withdrawal_attempts (
    id BIGSERIAL PRIMARY KEY,
    uid VARCHAR(128) NOT NULL,
    idem_key VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (uid, idem_key)
);
CREATE INDEX IF NOT EXISTS idx_withdrawal_attempts_recent ON withdrawal_attempts(uid, created_at DESC);

CREATE TABLE IF NOT EXISTS withdrawal_suspensions (
    uid VARCHAR(128) PRIMARY KEY,
    email TEXT,
    until TIMESTAMP WITH TIME ZONE NOT NULL,
    kind VARCHAR(10) NOT NULL DEFAULT 'AUTO', -- AUTO (too many attempts), MANUAL (the admin)
    reason TEXT,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Emergency brake: one row, read from the production database for both ledgers.
CREATE TABLE IF NOT EXISTS platform_lockdown (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    state JSONB NOT NULL,
    updated_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
