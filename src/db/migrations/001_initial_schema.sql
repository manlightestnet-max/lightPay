-- ==========================================================
-- LIGHTWALLET CORE SCHEMA - UNIVERSAL DOUBLE-ENTRY LEDGER
-- ==========================================================

-- Active pgcrypto pour la génération sécurisée d'UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Table des Applications Enregistrées (Multi-Tenant)
CREATE TABLE IF NOT EXISTS apps (
    id VARCHAR(50) PRIMARY KEY, -- ex: 'app_academy', 'app_shop', 'app_transport'
    name VARCHAR(100) NOT NULL,
    api_key_hash VARCHAR(255) NOT NULL,
    webhook_url TEXT,
    webhook_secret VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Portefeuilles Universels (Multi-Tenant)
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id VARCHAR(50) NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
    account_id VARCHAR(100) NOT NULL, -- Identifiant de l'utilisateur ou marchand dans le site client
    account_type VARCHAR(20) NOT NULL DEFAULT 'USER', -- 'USER', 'MERCHANT', 'PLATFORM', 'SYSTEM'
    currency VARCHAR(20) NOT NULL DEFAULT 'CREDIT',
    available_balance BIGINT NOT NULL DEFAULT 0, -- Sous-unités (entier en XAF)
    locked_balance BIGINT NOT NULL DEFAULT 0, -- Séquestre / Hold
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'FROZEN', 'CLOSED'
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT balance_non_negative CHECK (account_type = 'SYSTEM' OR available_balance >= 0),
    CONSTRAINT locked_balance_non_negative CHECK (locked_balance >= 0),
    CONSTRAINT unique_account_per_app_currency UNIQUE(app_id, account_id, currency)
);

-- Index pour requêtes instantanées par account_id
CREATE INDEX IF NOT EXISTS idx_wallets_app_account ON wallets(app_id, account_id);

-- 3. Transactions Financières Globales
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id VARCHAR(50) NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(100) NOT NULL,
    type VARCHAR(30) NOT NULL, -- 'COLLECTION', 'PAYMENT', 'TRANSFER', 'DISBURSEMENT', 'REFUND', 'HOLD_CAPTURE', 'HOLD_RELEASE'
    amount BIGINT NOT NULL,
    fee_amount BIGINT NOT NULL DEFAULT 0,
    currency VARCHAR(20) NOT NULL DEFAULT 'CREDIT',
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'SUCCESS', 'FAILED', 'REVERSED'
    reference VARCHAR(100), -- Référence externe (ex: commande #1042)
    metadata JSONB DEFAULT '{}'::jsonb,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT unique_idempotency_per_app UNIQUE(app_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_transactions_app_status ON transactions(app_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(app_id, reference);

-- 4. Grand Livre Comptable (Ledger Entries - Append-Only & Immuable)
CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    direction VARCHAR(10) NOT NULL, -- 'DEBIT' (-) ou 'CREDIT' (+)
    amount BIGINT NOT NULL,
    balance_before BIGINT NOT NULL,
    balance_after BIGINT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_wallet ON ledger_entries(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_transaction ON ledger_entries(transaction_id);

-- 5. Table des Séquestres / Holds Temporaires
CREATE TABLE IF NOT EXISTS holds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    amount BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'CAPTURED', 'RELEASED'
    reason TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Journal des Webhooks Sortants (Dispatch vers vos sites)
CREATE TABLE IF NOT EXISTS webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id VARCHAR(50) NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    event VARCHAR(50) NOT NULL, -- 'payment.succeeded', 'collection.credited', etc.
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'SENT', 'FAILED'
    response_status INTEGER,
    attempts INTEGER DEFAULT 0,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
