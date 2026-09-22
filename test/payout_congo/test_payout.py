import os
import sys
import json
import uuid
import base64
import requests
from Crypto.Cipher import DES3
from Crypto.Util.Padding import pad

CONFIG_FILE = os.path.join(os.path.dirname(__file__), 'config.json')

def load_config():
    if not os.path.exists(CONFIG_FILE):
        print(f'[ERREUR] Fichier introuvable: {CONFIG_FILE}')
        sys.exit(1)
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def encrypt_3des(plain_json_str: str, secret_key: str) -> str:
    key_bytes = secret_key.encode('utf-8')
    if len(key_bytes) < 24:
        key_bytes = key_bytes.ljust(24, b'\0')
    elif len(key_bytes) > 24:
        key_bytes = key_bytes[:24]

    iv = key_bytes[:8]
    cipher = DES3.new(key_bytes, DES3.MODE_CBC, iv)
    data_bytes = plain_json_str.encode('utf-8')
    padded_data = pad(data_bytes, DES3.block_size)
    encrypted_bytes = cipher.encrypt(padded_data)
    return base64.b64encode(encrypted_bytes).decode('utf-8')

def run_live_payout(network=None, amount=None, phone=None, name=None):
    cfg = load_config()
    payout_cfg = cfg.get('default_payout', {})

    base_url = cfg.get('base_url', 'https://gate.klasha.com').rstrip('/')
    public_key = cfg.get('merchant_public_key', '').strip()
    bearer_token = cfg.get('bearer_token', '').strip()
    encryption_key = cfg.get('encryption_key', '').strip()
    wallet_id = cfg.get('wallet_id', 12)

    missing = []
    if not public_key or 'METTRE_VOTRE' in public_key:
        missing.append('merchant_public_key (x-auth-token)')
    if not bearer_token or 'METTRE_VOTRE' in bearer_token:
        missing.append('bearer_token (Authorization: Bearer ...)')
    if not encryption_key or 'METTRE_VOTRE' in encryption_key:
        missing.append('encryption_key (Pour le chiffrement 3DES)')

    if missing:
        print('=' * 70)
        print('[ATTENTION - MODE PRODUCTION / LIVE]')
        print('Veuillez renseigner vos identifiants reels dans config.json :')
        for item in missing:
            print(f'   - {item}')
        print('=' * 70)

    service_code = network or payout_cfg.get('service_code', 'MTN_MOMO_COG')
    if service_code.upper() in ('AIRTEL', 'AIRTEL_COG'):
        service_code = 'AIRTEL_COG'
    elif service_code.upper() in ('MTN', 'MTN_MOMO_COG'):
        service_code = 'MTN_MOMO_COG'

    payout_amount = str(amount or payout_cfg.get('amount', '100'))
    recipient_phone = str(phone or payout_cfg.get('recipient_phone', '242060000000'))
    recipient_name = name or payout_cfg.get('recipient_name', 'Test Beneficiaire Congo')
    request_id = f'tranf-{uuid.uuid4()}'

    # 1. Corps de requete conforme a la documentation officielle
    plain_payload = {
        'country': payout_cfg.get('country', 'CG'),
        'amount': payout_amount,
        'accountName': recipient_name,
        'serviceCode': service_code,
        'requestId': request_id,
        'description': payout_cfg.get('description', 'Payout Momo Congo Live'),
        'currency': payout_cfg.get('currency', 'XAF'),
        'accountNumber': recipient_phone,
        'type': 'mobile_money',
        'debitAmount': payout_cfg.get('debit_amount', '10'),
        'walletId': wallet_id,
        'payoutType': payout_cfg.get('payout_type', 'USD_MOMO')
    }

    plain_json_str = json.dumps(plain_payload, separators=(',', ':'))

    # 2. Chiffrement obligatoire avec encryption=NEW
    if encryption_key and 'METTRE_VOTRE' not in encryption_key:
        encrypted_message = encrypt_3des(plain_json_str, encryption_key)
    else:
        encrypted_message = 'CLE_ENCRYPTION_MANQUANTE'

    request_body = {
        'message': encrypted_message
    }

    endpoint_url = f'{base_url}/wallet/merchant/bank/transfer/request/v3?encryption=NEW'

    headers = {
        'Content-Type': 'application/json',
        'x-auth-token': public_key,
        'Authorization': f'Bearer {bearer_token}'
    }

    print('=' * 70)
    print('DEMANDE DE PAYOUT EN DIRECT (PRODUCTION / LIVE)')
    print('=' * 70)
    print(f'URL Endpoint   : {endpoint_url}')
    print(f'Reseau Mobile  : {service_code}')
    print(f'Montant        : {payout_amount} XAF (FCFA)')
    print(f'Beneficiaire   : {recipient_name} ({recipient_phone})')
    print(f'Request ID     : {request_id}')
    print(f'Wallet ID      : {wallet_id}')
    print('-' * 70)
    print('Payload en clair (avant 3DES) :')
    print(json.dumps(plain_payload, indent=2))
    print('-' * 70)
    print(f'Message chiffre 3DES (extrait) : {encrypted_message[:50]}...')
    print('-' * 70)

    try:
        response = requests.post(endpoint_url, headers=headers, json=request_body, timeout=30)
        print(f'Statut HTTP de reponse : {response.status_code}')
        print('Reponse :')
        try:
            res_json = response.json()
            print(json.dumps(res_json, indent=2))
        except Exception:
            print(response.text)
    except requests.exceptions.RequestException as err:
        print(f'Erreur reseau : {err}')

    print('=' * 70)

if __name__ == '__main__':
    net = sys.argv[1] if len(sys.argv) > 1 else None
    amt = sys.argv[2] if len(sys.argv) > 2 else None
    ph = sys.argv[3] if len(sys.argv) > 3 else None
    nm = sys.argv[4] if len(sys.argv) > 4 else None
    run_live_payout(network=net, amount=amt, phone=ph, name=nm)
