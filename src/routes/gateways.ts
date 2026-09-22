import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { LedgerEngine } from '../db/ledger.js';
import { Environment } from '../types/index.js';
import crypto from 'crypto';

/**
 * Chiffrement 3DES conforme aux spécifications officielles :
 * TripleDES (DES-EDE3-CBC) avec IV = 8 premiers octets de la clé secrète, padding PKCS5/7
 */
export function encrypt3Des(text: string, secretKey: string): string {
  let keyBytes = Buffer.from(secretKey, 'utf-8');
  if (keyBytes.length < 24) {
    const padded = Buffer.alloc(24, 0);
    keyBytes.copy(padded);
    keyBytes = padded;
  } else if (keyBytes.length > 24) {
    keyBytes = keyBytes.subarray(0, 24);
  }
  const iv = keyBytes.subarray(0, 8);
  const cipher = crypto.createCipheriv('des-ede3-cbc', keyBytes, iv);
  cipher.setAutoPadding(true);
  let encrypted = cipher.update(text, 'utf-8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

export async function gatewayRoutes(fastify: FastifyInstance) {
  /**
   * 1. Webhook d'Agrégateur Externe (Règlement certifié / Entrée de fonds)
   * Approvisionne obligatoirement le Main Treasury Wallet (100% Backed Reserve).
   */
  fastify.post('/webhook/:provider', async (request: FastifyRequest, reply: FastifyReply) => {
    const { provider } = request.params as { provider: string };
    const payload = (request.body as any) || {};
    const queryParams = (request.query as any) || {};

    const rawEnv = payload.environment || queryParams.env || (payload.test_mode ? 'sandbox' : 'production');
    const environment: Environment = rawEnv === 'sandbox' ? 'sandbox' : 'production';

    const gatewayTxId = payload.transaction_id || payload.id || payload.tx_id || payload.reference;
    const amount = payload.amount;
    const paymentStatus = (payload.status || 'SUCCESS').toUpperCase();

    if (!gatewayTxId || !amount) {
      return reply.status(400).send({
        error: 'Champs requis manquants dans le webhook (transaction_id, amount)',
      });
    }

    if (paymentStatus !== 'SUCCESS' && paymentStatus !== 'COMPLETED' && paymentStatus !== 'PAID') {
      return reply.status(200).send({
        status: 'ignored',
        message: `Paiement ${paymentStatus}, aucun crédit alloué`,
      });
    }

    const appId = 'mainapp';
    const creditAmount = BigInt(amount);
    if (creditAmount <= 0n) {
      return reply.status(400).send({ error: 'Le montant doit être supérieur à zéro' });
    }

    const treasuryWalletId = await LedgerEngine.getOrCreateMainTreasury('mainapp', environment, 'CREDIT');
    const gatewayInflowId = await LedgerEngine.getOrCreateGatewayInflow('mainapp', environment, 'CREDIT');
    const idempotencyKey = `GATEWAY_${provider.toUpperCase()}_${gatewayTxId}`;

    try {
      const result = await LedgerEngine.executeTransaction({
        appId,
        idempotencyKey,
        type: 'COLLECTION',
        environment,
        amount: creditAmount,
        currency: 'CREDIT',
        reference: `SETTLE_${provider.toUpperCase()}_${gatewayTxId}`,
        metadata: {
          gateway_provider: provider.toUpperCase(),
          gateway_transaction_id: gatewayTxId,
          environment,
          raw_amount: amount.toString(),
          settled_at: new Date().toISOString(),
          customer: payload.customer || payload.phone || null,
        },
        postings: [
          {
            walletId: gatewayInflowId,
            direction: 'DEBIT',
            amount: creditAmount,
            description: `Règlement externe agrégateur [${provider.toUpperCase()}] - Tx: ${gatewayTxId} (${environment})`,
          },
          {
            walletId: treasuryWalletId,
            direction: 'CREDIT',
            amount: creditAmount,
            description: `Approvisionnement Réserve Main Treasury via [${provider.toUpperCase()}] (${environment})`,
          },
        ],
      });

      return reply.status(result.duplicate ? 200 : 201).send({
        status: 'success',
        provider: provider.toUpperCase(),
        message: `Main Treasury Wallet approvisionné de ${amount} Crédits via ${provider.toUpperCase()}`,
        ...result,
      });
    } catch (err: any) {
      return reply.status(400).send({
        status: 'error',
        error: err.message,
      });
    }
  });

  /**
   * 2. Payout Sortant Mobile Money (Disbursement via API externe avec 3DES)
   * Prélève obligatoirement sur le Main Treasury Wallet (Zero-Deficit Guarantee).
   */
  fastify.post('/payout', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body as any) || {};
    const {
      network,
      amount,
      phone,
      name = 'Beneficiaire Mobile Money',
      currency = 'XAF',
      country = 'CG',
      environment = 'production',
      wallet_id,
      description = 'Payout Mobile Money',
    } = body;

    if (!amount || parseInt(amount, 10) <= 0) {
      return reply.status(400).send({ error: 'Montant de payout invalide' });
    }
    if (!phone) {
      return reply.status(400).send({ error: 'Numéro de téléphone du destinataire requis' });
    }

    // Résolution du serviceCode officiel
    let serviceCode = body.service_code || body.serviceCode;
    if (!serviceCode) {
      const net = (network || '').toUpperCase();
      if (net === 'AIRTEL' || net === 'AIRTEL_COG') {
        serviceCode = 'AIRTEL_COG';
      } else {
        serviceCode = 'MTN_MOMO_COG';
      }
    }

    const env: Environment = environment === 'sandbox' ? 'sandbox' : 'production';
    const payoutAmount = BigInt(amount);
    const appId = 'mainapp';

    // 1. Vérification et réservation dans le grand livre double-entrée
    const treasuryWalletId = await LedgerEngine.getOrCreateMainTreasury('mainapp', env, 'CREDIT');
    const gatewayOutflowId = await LedgerEngine.getOrCreateGatewayInflow('mainapp', env, 'CREDIT'); // transit

    const requestId = `payout-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const idempotencyKey = `PAYOUT_${serviceCode}_${phone}_${Date.now()}`;

    try {
      // Débit de la réserve Main Treasury
      const ledgerResult = await LedgerEngine.executeTransaction({
        appId,
        idempotencyKey,
        type: 'PAYOUT',
        environment: env,
        amount: payoutAmount,
        currency: 'CREDIT',
        reference: `PAYOUT_${serviceCode}_${requestId}`,
        metadata: {
          recipient_phone: phone,
          recipient_name: name,
          network: serviceCode,
          environment: env,
          country,
        },
        postings: [
          {
            walletId: treasuryWalletId,
            direction: 'DEBIT',
            amount: payoutAmount,
            description: `Retrait Payout Mobile Money [${serviceCode}] vers ${phone}`,
          },
          {
            walletId: gatewayOutflowId,
            direction: 'CREDIT',
            amount: payoutAmount,
            description: `Sortie de caisse agrégateur externe [${serviceCode}] (${env})`,
          },
        ],
      });

      // 2. Appel vers l'API de décaissement externe (avec chiffrement 3DES si clés configurées)
      const gatewayPublicKey = process.env.GATEWAY_PUBLIC_KEY || '';
      const gatewayBearerToken = process.env.GATEWAY_BEARER_TOKEN || '';
      const gatewayEncryptionKey = process.env.GATEWAY_ENCRYPTION_KEY || '';
      const gatewayBaseUrl = (process.env.GATEWAY_BASE_URL || 'https://gate.klasapps.com').replace(/\/+$/, '');
      const merchantWalletId = wallet_id || parseInt(process.env.GATEWAY_WALLET_ID || '12', 10);

      let gatewayResponse = null;

      if (gatewayPublicKey && gatewayBearerToken && gatewayEncryptionKey) {
        const plainPayload = {
          country,
          amount: amount.toString(),
          accountName: name,
          serviceCode,
          requestId,
          description,
          currency,
          accountNumber: phone,
          type: 'mobile_money',
          debitAmount: amount.toString(),
          walletId: merchantWalletId,
          payoutType: 'USD_MOMO',
        };

        const encryptedMessage = encrypt3Des(JSON.stringify(plainPayload), gatewayEncryptionKey);
        const endpointUrl = `${gatewayBaseUrl}/wallet/merchant/bank/transfer/request/v3?encryption=NEW`;

        try {
          const res = await fetch(endpointUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-auth-token': gatewayPublicKey,
              'Authorization': `Bearer ${gatewayBearerToken}`,
            },
            body: JSON.stringify({ message: encryptedMessage }),
          });

          gatewayResponse = await res.json().catch(() => ({ status_code: res.status }));
        } catch (apiErr: any) {
          gatewayResponse = { error: apiErr.message, note: 'Échec de transmission réseau passerelle' };
        }
      }

      return reply.status(201).send({
        status: 'success',
        message: `Payout de ${amount} Crédits initié avec succès vers ${phone} (${serviceCode})`,
        request_id: requestId,
        network: serviceCode,
        ledger_transaction: ledgerResult,
        gateway_response: gatewayResponse || { mode: 'ledger_reserved_awaiting_dispatch' },
      });
    } catch (err: any) {
      return reply.status(400).send({
        status: 'error',
        error: err.message,
      });
    }
  });
}
