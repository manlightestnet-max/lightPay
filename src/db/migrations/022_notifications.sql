-- ==========================================================
-- LIGHTWALLET MIGRATION 022 - NOTIFICATIONS (PUSH + E-MAIL)
-- ==========================================================
-- Identity-level data (one LightPay person, both ledgers): read from the production database.

-- Phones that receive push notifications (Firebase Cloud Messaging token), per environment.
CREATE TABLE IF NOT EXISTS push_devices (
    token TEXT PRIMARY KEY,
    uid VARCHAR(128) NOT NULL,
    environment VARCHAR(20) NOT NULL DEFAULT 'production',
    platform VARCHAR(20) NOT NULL DEFAULT 'android',
    label TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_devices_uid ON push_devices (uid, environment);

-- Devices a person already signed in from: a sign-in from a new one sends "Nouvelle connexion".
CREATE TABLE IF NOT EXISTS sign_in_devices (
    uid VARCHAR(128) NOT NULL,
    device_key VARCHAR(64) NOT NULL,
    label TEXT,
    last_auth_time BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (uid, device_key)
);

-- Every message sent (one per event: a retried webhook never notifies twice).
CREATE TABLE IF NOT EXISTS notification_log (
    id VARCHAR(64) PRIMARY KEY,
    event_key TEXT NOT NULL,
    uid VARCHAR(128),
    environment VARCHAR(20) NOT NULL,
    event VARCHAR(60) NOT NULL,
    title TEXT,
    body TEXT,
    push_status VARCHAR(20),
    email_status VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_log_key ON notification_log (event_key);
CREATE INDEX IF NOT EXISTS idx_notification_log_uid ON notification_log (uid, created_at DESC);
