-- 005_mainapp_treasury.sql
-- Enregistrement de l'application centrale 'mainapp' pour héberger le coffre-fort central (SYSTEM_MAIN_TREASURY)
-- et le transit des règlements agrégateurs (SYSTEM_GATEWAY_INFLOW).

INSERT INTO apps (id, name, api_key_hash, test_api_key_hash, webhook_secret, is_active)
VALUES (
  'mainapp',
  'LightPay MainApp Central Treasury',
  'mainapp_system_hash',
  'mainapp_test_hash',
  'whsec_mainapp_treasury_system',
  TRUE
)
ON CONFLICT (id) DO NOTHING;
