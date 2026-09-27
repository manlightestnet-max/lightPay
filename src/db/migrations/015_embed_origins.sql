-- ==========================================================
-- LIGHTWALLET MIGRATION 015 - EMBEDDED CHECKOUT ORIGINS
-- ==========================================================
-- Sites allowed to show the LightPay payment page in a dialog (iframe opened by lightpay.js).
-- The page is framed only by these origins (plus the origins of the app's redirect URIs);
-- any other site gets frame-ancestors 'none' and falls back to the full-page redirect.

ALTER TABLE apps ADD COLUMN IF NOT EXISTS embed_origins JSONB NOT NULL DEFAULT '[]'::jsonb;
