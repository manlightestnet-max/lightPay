import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/pool.js';
import { LedgerEngine, LedgerPosting } from '../db/ledger.js';
import { requireAppAuth } from '../middleware/app-auth.js';
import { encrypt3Des } from './gateways.js';
import { isReservedAppId } from '../security/app-identity.js';
import { generateAppCredentials, getOrCreateMerchantWallet } from '../db/apps.js';

export async function merchantRoutes(fastify: FastifyInstance) {
  /**
   * 0. Apps are created from the owner's LightPay account (developer space, signed in):
   *    POST /v1/me/developer/apps. This public route used to create apps for anyone.
   */
  fastify.post('/apps/register', async (_request: FastifyRequest, reply: FastifyReply) =>
    reply.status(410).send({
      error: 'MOVED_TO_ACCOUNT',
      message: 'Créez vos apps depuis votre compte LightPay, espace Développeurs (checkout.smlab.xyz/account#/dev).',
    })
  );

  // =========================================================================
  // ROUTES PROTÉGÉES PAR LA CLÉ D'API DU MARCHAND (sec_live_... ou sec_test_...)
  // =========================================================================
  fastify.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', requireAppAuth);

    /**
     * 0.b ROTATION DES CLÉS (clé actuelle obligatoire)
     * Remplace les clés live/test et le secret webhook de l'application appelante. Les
     * anciennes clés cessent de fonctionner immédiatement.
     */
    protectedRoutes.post('/apps/rotate-keys', async (request: FastifyRequest, reply: FastifyReply) => {
      const appId = request.appData!.id;
      if (isReservedAppId(appId)) {
        return reply.status(403).send({ error: 'RESERVED_APP_ID', message: 'Reserved identities are managed from the server environment' });
      }
      const { liveKey, testKey, liveKeyHash, testKeyHash, webhookSecret, liveHint, testHint } = generateAppCredentials();
      const sql =
        'UPDATE apps SET api_key_hash = $2, test_api_key_hash = $3, webhook_secret = $4, live_key_hint = $5, test_key_hint = $6, keys_rotated_at = NOW(), updated_at = NOW() WHERE id = $1';
      await Promise.all([
        query(sql, [appId, liveKeyHash, testKeyHash, webhookSecret, liveHint, testHint], 'production'),
        query(sql, [appId, liveKeyHash, testKeyHash, webhookSecret, liveHint, testHint], 'sandbox'),
      ]);
      return reply.send({ status: 'success', app_id: appId, live_api_key: liveKey, test_api_key: testKey, webhook_secret: webhookSecret });
    });

    /**
     * 1. CONSULTER LE SOLDE DU WALLET MARCHAND (Son Solde)
     */
    protectedRoutes.get('/balance', async (request: FastifyRequest, reply: FastifyReply) => {
      const appId = request.appData!.id;
      const environment = request.appData!.environment || 'production';
      const { currency = 'CREDIT' } = request.query as any;

      const wallet = await getOrCreateMerchantWallet(appId, environment, currency);

      return {
        status: 'success',
        app_id: appId,
        environment,
        wallet_id: wallet.id,
        currency: wallet.currency,
        available_balance: wallet.available_balance.toString(),
        locked_balance: wallet.locked_balance.toString(),
        account_type: 'MERCHANT',
        status_label: wallet.status,
      };
    });

    /**
     * 2. COLLECTIONS DIRECTES : FERMÉ.
     * Débiter un client LightPay exige désormais son autorisation (LightPay Connect, droit
     * "charge" dans la limite qu'il a fixée) : POST /v1/connections/:id/charges, ou une
     * session de paiement : POST /v1/checkout/sessions.
     */
    protectedRoutes.post('/collections/charge-user', async (_request: FastifyRequest, reply: FastifyReply) =>
      reply.status(410).send({
        error: 'CHARGE_REQUIRES_CONSENT',
        message: 'Direct charges are closed. Use a LightPay Connect charge (POST /v1/connections/:id/charges) or a checkout session (POST /v1/checkout/sessions).',
      })
    );

    protectedRoutes.post('/disbursements/payout', async (request: FastifyRequest, reply: FastifyReply) => {
      const appId = request.appData!.id;
      const environment = request.appData!.environment || 'production';
      const body = (request.body as any) || {};

      const {
        amount,
        phone,
        network,
        name = 'Marchand LightPay',
        currency = 'CREDIT',
        country = 'CG',
        description = 'Retrait Marchand Mobile Money',
      } = body;

      if (!amount || parseInt(amount, 10) <= 0) {
        return reply.status(400).send({ error: 'Montant de retrait invalide' });
      }
      if (!phone) {
        return reply.status(400).send({ error: 'Numéro de téléphone destinataire requis' });
      }

      // Résolution du serviceCode
      let serviceCode = body.service_code || body.serviceCode;
      if (!serviceCode) {
        const net = (network || '').toUpperCase();
        if (net === 'AIRTEL' || net === 'AIRTEL_COG') {
          serviceCode = 'AIRTEL_COG';
        } else {
          serviceCode = 'MTN_MOMO_COG';
        }
      }

      const payoutAmount = BigInt(amount);
      const merchantWallet = await getOrCreateMerchantWallet(appId, environment, currency);

      if (BigInt(merchantWallet.available_balance) < payoutAmount) {
        return reply.status(400).send({
          error: 'INSUFFICIENT_MERCHANT_BALANCE',
          message: `Solde marchand insuffisant (${merchantWallet.available_balance} ${currency}) pour effectuer un retrait de ${amount} ${currency}.`,
        });
      }

      // Wallet de transit passerelle de mainapp
      const gatewayOutflowId = await LedgerEngine.getOrCreateGatewayInflow('mainapp', environment, currency);
      const requestId = `payout-${appId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const idempotencyKey = `PAYOUT_${appId}_${requestId}`;

      try {
        // Débit comptable du compte marchand de l'application
        const ledgerResult = await LedgerEngine.executeTransaction({
          appId,
          idempotencyKey,
          type: 'DISBURSEMENT',
          environment,
          amount: payoutAmount,
          currency,
          reference: `PAYOUT_${serviceCode}_${requestId}`,
          metadata: {
            recipient_phone: phone,
            recipient_name: name,
            network: serviceCode,
            environment,
            country,
            app_id: appId,
          },
          postings: [
            {
              walletId: merchantWallet.id,
              direction: 'DEBIT',
              amount: payoutAmount,
              description: `Retrait Marchand vers ${serviceCode} (${phone})`,
            },
            {
              walletId: gatewayOutflowId,
              direction: 'CREDIT',
              amount: payoutAmount,
              description: `Sortie caisse Mobile Money [${serviceCode}] pour ${appId}`,
            },
          ],
        });

        // Déclenchement passerelle 3DES si clés configurées
        const gatewayPublicKey = process.env.GATEWAY_PUBLIC_KEY || '';
        const gatewayBearerToken = process.env.GATEWAY_BEARER_TOKEN || '';
        const gatewayEncryptionKey = process.env.GATEWAY_ENCRYPTION_KEY || '';
        const gatewayBaseUrl = (process.env.GATEWAY_BASE_URL || 'https://gate.klasapps.com').replace(/\/+$/, '');
        const merchantWalletId = parseInt(process.env.GATEWAY_WALLET_ID || '12', 10);

        let gatewayResponse: any = null;

        if (gatewayPublicKey && gatewayBearerToken && gatewayEncryptionKey) {
          const plainPayload = {
            country,
            amount: amount.toString(),
            accountName: name,
            serviceCode,
            requestId,
            description,
            currency: 'XAF',
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
            gatewayResponse = { error: apiErr.message, note: 'Échec de transmission passerelle' };
          }
        }

        return reply.status(201).send({
          status: 'success',
          message: `Retrait de ${amount} ${currency} vers ${phone} (${serviceCode}) initié avec succès.`,
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

    /**
     * 4. RELEVÉ COMPTABLE DU MARCHAND (Collections & Disbursements)
     */
    protectedRoutes.get('/statement', async (request: FastifyRequest, reply: FastifyReply) => {
      const appId = request.appData!.id;
      const environment = request.appData!.environment || 'production';
      const { limit = 50, offset = 0, type } = request.query as any;

      const merchantWallet = await getOrCreateMerchantWallet(appId, environment, 'CREDIT');

      let typeFilter = '';
      const params: any[] = [merchantWallet.id, parseInt(limit, 10), parseInt(offset, 10)];

      if (type === 'COLLECTION') {
        typeFilter = 'AND le.direction = \'CREDIT\'';
      } else if (type === 'DISBURSEMENT') {
        typeFilter = 'AND le.direction = \'DEBIT\'';
      }

      const entries = await query(
        `SELECT le.id, le.transaction_id, le.direction, le.environment, le.amount, le.balance_before, le.balance_after, le.description, le.created_at,
                t.type as transaction_type, t.reference, t.metadata
         FROM ledger_entries le
         JOIN transactions t ON t.id = le.transaction_id
         WHERE le.wallet_id = $1 ${typeFilter}
         ORDER BY le.created_at DESC
         LIMIT $2 OFFSET $3`,
        params,
        environment
      );

      return {
        status: 'success',
        app_id: appId,
        environment,
        wallet_id: merchantWallet.id,
        count: entries.length,
        entries: entries.map((e: any) => ({
          id: e.id,
          transaction_id: e.transaction_id,
          direction: e.direction,
          category: e.direction === 'CREDIT' ? 'COLLECTION' : 'DISBURSEMENT',
          amount: e.amount.toString(),
          balance_before: e.balance_before.toString(),
          balance_after: e.balance_after.toString(),
          description: e.description,
          created_at: e.created_at,
          transaction_type: e.transaction_type,
          reference: e.reference,
          metadata: e.metadata,
        })),
      };
    });

    /**
     * 5. TOP-UP FAUCET DÉSACTIVÉ
     * Chaque wallet marchand reçoit automatiquement 1 000 Crédits de test à sa création.
     */
    protectedRoutes.post('/sandbox-topup', async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.status(410).send({
        error: 'FAUCET_DISABLED',
        message: 'Le faucet est désactivé. Chaque application marchande reçoit automatiquement 1 000 Crédits de test à sa création.',
      });
    });
  });
}
