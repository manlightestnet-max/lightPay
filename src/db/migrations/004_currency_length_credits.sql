-- ==========================================================
-- LIGHTWALLET MIGRATION 004 - EXPAND CURRENCY COLUMN FOR CREDITS
-- ==========================================================

ALTER TABLE wallets ALTER COLUMN currency TYPE VARCHAR(20);
ALTER TABLE wallets ALTER COLUMN currency SET DEFAULT 'CREDIT';

ALTER TABLE transactions ALTER COLUMN currency TYPE VARCHAR(20);
ALTER TABLE transactions ALTER COLUMN currency SET DEFAULT 'CREDIT';
