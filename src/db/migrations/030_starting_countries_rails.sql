-- ==========================================================
-- LIGHTWALLET MIGRATION 030 - OPERATORS OF THE STARTING COUNTRIES
-- ==========================================================
-- 1. How a national number is written in each country (shown as the field's placeholder and in refusals).
ALTER TABLE countries ADD COLUMN IF NOT EXISTS example VARCHAR(30);
UPDATE countries SET example = '06 512 44 81' WHERE code = 'COG' AND example IS NULL;
UPDATE countries SET example = '6 71 23 45 67' WHERE code = 'CMR' AND example IS NULL;
UPDATE countries SET example = '07 12 34 56 78' WHERE code = 'CIV' AND example IS NULL;
UPDATE countries SET example = '90 12 34 56' WHERE code = 'TGO' AND example IS NULL;

-- Gabon, known but closed like the others.
INSERT INTO countries (code, iso2, name, dial_code, currency, national_pattern, example, enabled)
VALUES ('GAB', 'GA', 'Gabon', '241', 'XAF', '^0[67][0-9]{6}$', '07 12 34 56', FALSE)
ON CONFLICT (code) DO NOTHING;

-- 2. What the person must do before paying with an operator that asks for a one-time code (shown on its screen).
ALTER TABLE rails ADD COLUMN IF NOT EXISTS instructions TEXT;

-- 3. Their operators, with the codes SasPay's checkout uses (read on 23 October 2026). The countries stay closed until
--    the admin opens them (Pays et opérateurs); prefixes and provider codes can be corrected there. Orange Côte d'Ivoire
--    (code asked before paying) and Wave (operator's page) need their own waiting screens: kept off for now, like Djamo
--    (how it validates is not known yet).
INSERT INTO rails (method, country, network, name, prefixes, auth, provider_codes, enabled, position, instructions) VALUES
  ('mtn_cm', 'CMR', 'MTN_MOMO_CMR', 'MTN MoMo', '{67,650,651,652,653,654,680,681,682,683,684}', 'push', '{"saspay": "mtn_cm", "pawapay": "MTN_MOMO_CMR"}', TRUE, 1, NULL),
  ('orange_cm', 'CMR', 'ORANGE_CMR', 'Orange Money', '{69,655,656,657,658,659,685,686,687,688,689}', 'push', '{"saspay": "orange_cm", "pawapay": "ORANGE_CMR"}', TRUE, 2, NULL),
  ('mtn_ci', 'CIV', 'MTN_MOMO_CIV', 'MTN MoMo', '{05}', 'push', '{"saspay": "mtn_ci", "pawapay": "MTN_MOMO_CIV"}', TRUE, 1, NULL),
  ('moov_ci', 'CIV', 'MOOV_CIV', 'Moov Money', '{01}', 'push', '{"saspay": "moov_ci"}', TRUE, 2, NULL),
  ('orange_ci', 'CIV', 'ORANGE_CIV', 'Orange Money', '{07}', 'otp', '{"saspay": "orange_ci", "pawapay": "ORANGE_CIV"}', FALSE, 3,
   'Sur votre téléphone, composez #144*82# puis choisissez l’option 2 pour obtenir votre code de paiement.'),
  ('wave_ci', 'CIV', 'WAVE_CIV', 'Wave', '{}', 'redirect', '{"saspay": "wave_ci", "pawapay": "WAVE_CIV"}', FALSE, 4, NULL),
  ('djamo_ci', 'CIV', 'DJAMO_CIV', 'Djamo', '{}', 'push', '{"saspay": "djamo_ci"}', FALSE, 5, NULL),
  ('tmoney_tg', 'TGO', 'TMONEY_TGO', 'T-Money', '{70,71,72,73,90,91,92,93}', 'push', '{"saspay": "togocel"}', TRUE, 1, NULL),
  ('flooz_tg', 'TGO', 'MOOV_TGO', 'Flooz', '{78,79,96,97,98,99}', 'push', '{"saspay": "moov_tg"}', TRUE, 2, NULL),
  ('airtel_ga', 'GAB', 'AIRTEL_GAB', 'Airtel Money', '{07}', 'push', '{"saspay": "airtel_ga", "pawapay": "AIRTEL_GAB"}', TRUE, 1, NULL),
  ('moov_ga', 'GAB', 'MOOV_GAB', 'Moov Money', '{06}', 'push', '{"saspay": "moov_ga"}', TRUE, 2, NULL)
ON CONFLICT (method) DO NOTHING;
