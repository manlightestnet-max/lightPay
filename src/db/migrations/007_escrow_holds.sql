-- ==========================================================
-- LIGHTWALLET MIGRATION 007 - ESCROW (HOLDS ON THE LEDGER)
-- ==========================================================
-- A hold moves money from the payer's available balance to the beneficiary's locked
-- balance, in double entry. The beneficiary sees it but can never spend it: only the
-- hold itself can capture it (-> beneficiary available) or release it (-> payer).

-- 1. Each ledger entry says which balance it moved.
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS bucket VARCHAR(10) NOT NULL DEFAULT 'AVAILABLE'; -- 'AVAILABLE' | 'LOCKED'

-- 2. Holds carry everything needed to settle them. `wallet_id` is the beneficiary (where funds are locked).
ALTER TABLE holds ADD COLUMN IF NOT EXISTS app_id VARCHAR(50) REFERENCES apps(id) ON DELETE RESTRICT;
ALTER TABLE holds ADD COLUMN IF NOT EXISTS environment VARCHAR(20) NOT NULL DEFAULT 'production';
ALTER TABLE holds ADD COLUMN IF NOT EXISTS payer_wallet_id UUID REFERENCES wallets(id) ON DELETE RESTRICT;
ALTER TABLE holds ADD COLUMN IF NOT EXISTS currency VARCHAR(20) NOT NULL DEFAULT 'CREDIT';
ALTER TABLE holds ADD COLUMN IF NOT EXISTS fee_amount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE holds ADD COLUMN IF NOT EXISTS reference VARCHAR(100);
ALTER TABLE holds ADD COLUMN IF NOT EXISTS hold_transaction_id UUID REFERENCES transactions(id) ON DELETE RESTRICT;
ALTER TABLE holds ADD COLUMN IF NOT EXISTS settle_transaction_id UUID REFERENCES transactions(id) ON DELETE RESTRICT;
ALTER TABLE holds ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP WITH TIME ZONE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'holds_amount_positive') THEN
    ALTER TABLE holds ADD CONSTRAINT holds_amount_positive CHECK (amount > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'holds_fee_valid') THEN
    ALTER TABLE holds ADD CONSTRAINT holds_fee_valid CHECK (fee_amount >= 0 AND fee_amount < amount);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'holds_status_valid') THEN
    ALTER TABLE holds ADD CONSTRAINT holds_status_valid CHECK (status IN ('ACTIVE', 'DISPUTED', 'CAPTURED', 'RELEASED'));
  END IF;
END $$;

-- One hold per hold transaction (idempotent creation).
CREATE UNIQUE INDEX IF NOT EXISTS idx_holds_hold_tx ON holds(hold_transaction_id) WHERE hold_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_holds_app_status ON holds(app_id, environment, status);
CREATE INDEX IF NOT EXISTS idx_holds_wallet ON holds(wallet_id, status);
CREATE INDEX IF NOT EXISTS idx_holds_payer ON holds(payer_wallet_id, status);
CREATE INDEX IF NOT EXISTS idx_holds_reference ON holds(app_id, reference);
