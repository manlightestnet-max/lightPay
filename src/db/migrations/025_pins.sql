-- ==========================================================
-- LIGHTWALLET MIGRATION 025 - SECRET CODE (6 DIGITS)
-- ==========================================================
-- The person's LightPay code, asked to confirm money leaving the wallet (send, withdraw, pay
-- with the wallet). Mandatory: chosen right after the @username. Only a salted scrypt hash is
-- kept. 5 wrong codes in a row lock it for 15 minutes. Read from the production database (one
-- code for real and test).
CREATE TABLE IF NOT EXISTS user_pins (
    uid TEXT PRIMARY KEY,
    pin_hash TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
