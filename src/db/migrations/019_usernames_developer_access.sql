-- ==========================================================
-- LIGHTWALLET MIGRATION 019 - USERNAMES AND DEVELOPER ACCESS
-- ==========================================================
-- Identity-level data (one LightPay person, both ledgers): read from the production database.

-- @username: how people find each other to send money (instead of an e-mail).
CREATE TABLE IF NOT EXISTS usernames (
    uid VARCHAR(128) PRIMARY KEY,
    username VARCHAR(20) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_usernames_username ON usernames (lower(username));

-- Advanced mode (console + developer space): asked by the person, decided by the LightPay admin.
CREATE TABLE IF NOT EXISTS developer_access (
    uid VARCHAR(128) PRIMARY KEY,
    email TEXT,
    project TEXT NOT NULL,
    website TEXT,
    use_case TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | REJECTED
    note TEXT,                                      -- the admin's word on a refusal
    decided_by TEXT,
    decided_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_developer_access_status ON developer_access (status, created_at);

-- People who already own an app had the developer space before this rule: they keep it.
INSERT INTO developer_access (uid, email, project, use_case, status, decided_by, decided_at)
SELECT DISTINCT ON (a.owner_uid) a.owner_uid, NULL, a.name, 'Accès existant avant la validation des demandes', 'APPROVED', 'migration', NOW()
FROM apps a
WHERE a.owner_uid IS NOT NULL
ORDER BY a.owner_uid, a.created_at
ON CONFLICT (uid) DO NOTHING;
