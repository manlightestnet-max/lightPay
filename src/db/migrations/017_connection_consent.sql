-- ==========================================================
-- LIGHTWALLET MIGRATION 017 - WHAT THE PERSON ACCEPTED WHEN CONNECTING AN APP
-- ==========================================================
-- The exact clauses shown on the consent screen (e.g. the app's automatic commission on sales),
-- with the time they were accepted: the record to rely on in case of a dispute.
ALTER TABLE connections ADD COLUMN IF NOT EXISTS consent JSONB;
