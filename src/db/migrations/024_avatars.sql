-- ==========================================================
-- LIGHTWALLET MIGRATION 024 - APP LOGOS
-- ==========================================================
-- Each app can have a logo (Developer console > app > Logo): small square image, resized in the
-- browser, checked by the server (PNG / JPEG / WebP, at most 150 KB). Same row in both databases.
-- Shown on the payment page, the authorization page, connected apps, statements and notifications.
-- People's photos come from their Google account (wallets.metadata.picture, hidden when
-- metadata.hide_photo is true): no table needed.
ALTER TABLE apps ADD COLUMN IF NOT EXISTS logo BYTEA;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS logo_type TEXT;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS logo_version BIGINT;
