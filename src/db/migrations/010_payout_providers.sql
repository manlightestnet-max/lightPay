-- ==========================================================
-- LIGHTWALLET MIGRATION 010 - PROVIDER REFERENCES ON PAYOUTS
-- ==========================================================
-- Payouts can stay PENDING at the provider (SasPay…): keep its id to check the status
-- (webhook + sweeper), and find a payout from a provider notification.
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS provider_reference VARCHAR(100);
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_reference ON payouts(reference);
CREATE INDEX IF NOT EXISTS idx_payouts_provider_ref ON payouts(provider_reference) WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payouts_pending ON payouts(status, created_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_collection_provider_ref ON collection_attempts(provider_reference) WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_collection_pending ON collection_attempts(status, created_at) WHERE status = 'PENDING';
