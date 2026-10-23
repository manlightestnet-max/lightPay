-- ==========================================================
-- LIGHTWALLET MIGRATION 034 - OPERATOR FEES OF EACH PROVIDER, SET BY THE ADMIN
-- ==========================================================
-- One row per ledger: what each provider charges, per operator (collection and payout), as the admin sets it in
-- « Frais et minimums ». Nothing is applied from a provider's API by itself: SasPay's prices can be imported, then
-- edited. A rate is { bps, fixed, min }: percent in basis points (320 = 3,2 %), a fixed part in FCFA, a minimum.
-- on_total: the percent is taken on the total paid, fees included (SasPay: 200 sent at 3,2 % → 7, not 6,4).
-- An operator without its own rate uses the provider's default.
--
-- Starting point: the operator fees the admin had set before (one rate per provider), as each provider's default.
CREATE TABLE IF NOT EXISTS provider_fee_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    settings JSONB NOT NULL,
    updated_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO provider_fee_settings (id, settings)
SELECT 1, jsonb_build_object(
  'saspay', jsonb_build_object(
    'on_total', TRUE,
    'default', jsonb_build_object(
      'collection', jsonb_build_object('bps', COALESCE((f.settings->>'deposit_operator_fee_bps')::int, 0), 'fixed', 0, 'min', 0),
      'payout', jsonb_build_object('bps', COALESCE((f.settings->>'withdrawal_operator_fee_bps')::int, 0), 'fixed', 0, 'min', COALESCE((f.settings->>'withdrawal_operator_fee_min')::int, 0))
    ),
    'operators', '{}'::jsonb
  ),
  'pawapay', jsonb_build_object(
    'on_total', FALSE,
    'default', jsonb_build_object(
      'collection', jsonb_build_object('bps', COALESCE((f.settings->>'pawapay_deposit_fee_bps')::int, 0), 'fixed', 0, 'min', 0),
      'payout', jsonb_build_object('bps', COALESCE((f.settings->>'pawapay_payout_fee_bps')::int, 0), 'fixed', 0, 'min', 0)
    ),
    'operators', '{}'::jsonb
  )
)
FROM (SELECT 1) AS one LEFT JOIN fee_settings f ON f.id = 1
ON CONFLICT (id) DO NOTHING;
