-- ==========================================================
-- LIGHTWALLET MIGRATION 008 - CHECKOUT SESSIONS & GUEST PAYERS
-- ==========================================================
-- An app (with its secret key, server side) asks LightPay for a payment. The payer pays
-- on the LightPay page: with a LightPay wallet, or as a GUEST with mobile money (a guest
-- wallet bound to the paying number, usable only by the checkout that funded it).
-- Payees are the app's sellers (account_type 'PAYEE'): they receive locked funds.

-- 1. Checkout sessions (id = public capability: cs_test_… / cs_live_…).
CREATE TABLE IF NOT EXISTS checkout_sessions (
    id VARCHAR(64) PRIMARY KEY,
    app_id VARCHAR(50) NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
    environment VARCHAR(20) NOT NULL,
    idempotency_key VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN', -- OPEN, PROCESSING, COMPLETED, EXPIRED, CANCELLED
    amount BIGINT NOT NULL,
    fee_amount BIGINT NOT NULL DEFAULT 0,
    currency VARCHAR(20) NOT NULL DEFAULT 'XAF',
    reference VARCHAR(100),
    description TEXT,
    payee_wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    escrow BOOLEAN NOT NULL DEFAULT TRUE,
    methods JSONB NOT NULL DEFAULT '["mobile_money"]'::jsonb,
    return_url TEXT,
    cancel_url TEXT,
    payer_wallet_id UUID REFERENCES wallets(id) ON DELETE RESTRICT,
    payer_msisdn VARCHAR(20),
    hold_id UUID REFERENCES holds(id) ON DELETE RESTRICT,
    payment_transaction_id UUID REFERENCES transactions(id) ON DELETE RESTRICT,
    metadata JSONB DEFAULT '{}'::jsonb,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT checkout_amount_positive CHECK (amount > 0),
    CONSTRAINT checkout_fee_valid CHECK (fee_amount >= 0 AND fee_amount < amount),
    CONSTRAINT checkout_status_valid CHECK (status IN ('OPEN', 'PROCESSING', 'COMPLETED', 'EXPIRED', 'CANCELLED')),
    CONSTRAINT unique_checkout_idempotency UNIQUE (app_id, environment, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_checkout_app_status ON checkout_sessions(app_id, environment, status);
CREATE INDEX IF NOT EXISTS idx_checkout_reference ON checkout_sessions(app_id, reference);

-- 2. Mobile-money collection attempts (one session can have several: failed, then retried).
CREATE TABLE IF NOT EXISTS collection_attempts (
    id VARCHAR(64) PRIMARY KEY, -- ca_… (also the provider deposit id)
    session_id VARCHAR(64) NOT NULL REFERENCES checkout_sessions(id) ON DELETE RESTRICT,
    environment VARCHAR(20) NOT NULL,
    provider VARCHAR(30) NOT NULL, -- SIMULATOR, PAWAPAY…
    network VARCHAR(30) NOT NULL, -- MTN_MOMO_COG, AIRTEL_COG
    msisdn VARCHAR(20) NOT NULL,
    amount BIGINT NOT NULL,
    currency VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, SUCCEEDED, FAILED
    failure_code VARCHAR(50),
    provider_reference VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT collection_status_valid CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_collection_session ON collection_attempts(session_id, created_at DESC);
-- At most one attempt in flight per session.
CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_one_pending ON collection_attempts(session_id) WHERE status = 'PENDING';

-- 3. Payouts to a phone number (guest refunds today, seller withdrawals later).
CREATE TABLE IF NOT EXISTS payouts (
    id VARCHAR(64) PRIMARY KEY, -- po_…
    environment VARCHAR(20) NOT NULL,
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    provider VARCHAR(30) NOT NULL,
    network VARCHAR(30) NOT NULL,
    msisdn VARCHAR(20) NOT NULL,
    amount BIGINT NOT NULL,
    currency VARCHAR(20) NOT NULL,
    reason VARCHAR(50) NOT NULL, -- GUEST_REFUND, WITHDRAWAL
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, SUCCEEDED, FAILED
    transaction_id UUID REFERENCES transactions(id) ON DELETE RESTRICT,
    failure_code VARCHAR(50),
    reference VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT payout_amount_positive CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_payouts_wallet ON payouts(wallet_id, created_at DESC);

-- 4. Guest and payee wallets. GUEST: bound to a phone number, owned by mainapp, never
--    spendable through public routes. PAYEE: a seller of an app, receives locked funds.
CREATE INDEX IF NOT EXISTS idx_wallets_type ON wallets(app_id, account_type, environment);
