-- ==========================================================
-- LIGHTWALLET MIGRATION 023 - MESSAGE TEMPLATES
-- ==========================================================
-- Texts of the automatic messages as rewritten by the admin (Administration > Messages).
-- One row: { "<event>": { title, body, subject, push, email, enabled } } for the messages that
-- differ from the originals (src/notify/templates.ts). Read from the production database.
CREATE TABLE IF NOT EXISTS message_templates (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    templates JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
