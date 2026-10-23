-- ==========================================================
-- LIGHTWALLET MIGRATION 029 - ROUTING RULES
-- ==========================================================
-- Which provider serves which operation, decided by the admin as an ordered list of rules (per ledger): the first
-- rule that matches wins, otherwise the provider chosen in "Fournisseurs" (provider_settings). Same shape as the
-- other admin settings: one row, the whole list in JSON.
CREATE TABLE IF NOT EXISTS routing_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    rules JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- The rule that chose the provider of each operation (admin only, never shown to people or apps).
ALTER TABLE collection_attempts ADD COLUMN IF NOT EXISTS routing_rule VARCHAR(40);
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS routing_rule VARCHAR(40);
