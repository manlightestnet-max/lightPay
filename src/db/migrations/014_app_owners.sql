-- ==========================================================
-- LIGHTWALLET MIGRATION 014 - APP OWNERS (developer space)
-- ==========================================================
-- An app belongs to a LightPay account (Firebase uid): the owner manages it from their
-- LightPay account (keys, webhooks, redirections). Keys are still stored as hashes only;
-- the hints (last 4 characters) let the owner recognise which key is in use.

ALTER TABLE apps ADD COLUMN IF NOT EXISTS owner_uid VARCHAR(128);
ALTER TABLE apps ADD COLUMN IF NOT EXISTS live_key_hint VARCHAR(8);
ALTER TABLE apps ADD COLUMN IF NOT EXISTS test_key_hint VARCHAR(8);
ALTER TABLE apps ADD COLUMN IF NOT EXISTS keys_rotated_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_apps_owner ON apps (owner_uid);
