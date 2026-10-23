-- ==========================================================
-- LIGHTWALLET MIGRATION 033 - SWAP FEE WHEN MONEY CHANGES COUNTRY
-- ==========================================================
-- LightPay's swap fee (Frais et minimums) is taken whenever money goes from one country to another: a withdrawal
-- from a wallet of country A to a number of country B, a deposit the other way, a move between two wallets of
-- different countries, a send to someone whose wallet is elsewhere, a payment to a seller of another country.
--
-- On a payout and a collection attempt the swap fee is a part of lightpay_fee (it follows exactly the same road:
-- pending fees, returned if the send fails, then the main wallet). swap_fee only says how much of it is swap, for
-- the person's receipt and the admin.
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS swap_fee NUMERIC(20, 0) NOT NULL DEFAULT 0;
ALTER TABLE collection_attempts ADD COLUMN IF NOT EXISTS swap_fee NUMERIC(20, 0) NOT NULL DEFAULT 0;
