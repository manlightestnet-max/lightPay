# Test de Payout Mobile Money - Congo (Brazzaville) [PRODUCTION / LIVE]

Ce module permet d executer un retrait reel (Payout / Disbursement) vers MTN MoMo ou Airtel Money au Congo via l API officielle v3 avec chiffrement 3DES.

## 1. Parametres de Production
- URL de Production : https://gate.klasapps.com
- Endpoint : /wallet/merchant/bank/transfer/request/v3?encryption=NEW
- Chiffrement : TripleDES / CBC / PKCS5Padding avec IV = 8 premiers octets de la cle secrete

## 2. Renseigner vos cles dans test/payout_congo/config.json
Dans votre Dashboard -> Settings -> Generate API Keys :
- merchant_public_key (pour x-auth-token)
- bearer_token (pour Authorization: Bearer ...)
- encryption_key (votre cle secrete de chiffrement 3DES)
- wallet_id (l ID de votre wallet marchand)

## 3. Execution
# Test par defaut (valeurs de config.json) :
python test/payout_congo/test_payout.py

# Test personnalise :
python test/payout_congo/test_payout.py MTN 500 242060000000

## 4. Codes Reseau au Congo
- MTN Congo    : MTN_MOMO_COG (Format: 24206XXXXXXX)
- Airtel Congo : AIRTEL_COG   (Format: 24205XXXXXXX)
