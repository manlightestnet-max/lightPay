import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { query } from '../db/pool.js';
import { LedgerEngine, LedgerPosting } from '../db/ledger.js';
import { requireAppAuth } from '../middleware/app-auth.js';
import { encrypt3Des } from './gateways.js';
import { Environment } from '../types/index.js';

/**
 * Récupère ou provisionne automatiquement le portefeuille marchand racine de l'application
 */
async function getOrCreateMerchantWallet(appId: string, environment: Environment, currency = 'CREDIT') {
  const existing = await query(
    'SELECT * FROM wallets WHERE app_id = $1 AND account_type = \'MERCHANT\' AND environment = $2 AND currency = $3',
    [appId, environment, currency],
    environment
  );

  if (existing.length > 0) {
    return existing[0];
  }

  // Provisionnement automatique du wallet marchand
  const created = await query(
    `INSERT INTO wallets (app_id, account_id, account_type, currency, environment, metadata)
     VALUES ($1, $1, 'MERCHANT', $2, $3, '{"role":"merchant_root"}')
     ON CONFLICT (app_id, account_id, currency, environment)
     DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [appId, currency, environment],
    environment
  );

  return created[0];
}

export async function merchantRoutes(fastify: FastifyInstance) {
  /**
   * 0. ONBOARDING / CRÉATION D'APPLICATION MARCHANDE (Depuis le Dashboard)
   * Accessible publiquement pour permettre à un développeur de générer son application grossiste
   */
  fastify.post('/apps/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, name, webhook_url, contact_email } = request.body as any;

    if (!id || !name) {
      return reply.status(400).send({ error: 'id and name are required' });
    }

    const cleanId = id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');

    // Génération des paires de clés indépendantes (Live vs Sandbox)
    const rawLiveKey = `sec_live_${crypto.randomBytes(24).toString('hex')}`;
    const liveKeyHash = crypto.createHash('sha256').update(rawLiveKey).digest('hex');

    const rawTestKey = `sec_test_${crypto.randomBytes(24).toString('hex')}`;
    const testKeyHash = crypto.createHash('sha256').update(rawTestKey).digest('hex');

    const webhookSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

    try {
      // 1. Enregistrer dans la base PRODUCTION
      await query(
        `INSERT INTO apps (id, name, api_key_hash, test_api_key_hash, webhook_url, webhook_secret, contact_email)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET name = $2, api_key_hash = $3, test_api_key_hash = $4, webhook_secret = $6, contact_email = $7, updated_at = NOW()`,
        [cleanId, name, liveKeyHash, testKeyHash, webhook_url || null, webhookSecret, contact_email || null],
        'production'
      );

      // 2. Enregistrer dans la base SANDBOX
      await query(
        `INSERT INTO apps (id, name, api_key_hash, test_api_key_hash, webhook_url, webhook_secret, contact_email)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET name = $2, api_key_hash = $3, test_api_key_hash = $4, webhook_secret = $6, contact_email = $7, updated_at = NOW()`,
        [cleanId, name, liveKeyHash, testKeyHash, webhook_url || null, webhookSecret, contact_email || null],
        'sandbox'
      );

      // 3. Provisionner le Wallet Marchand en Production
      const prodWallet = await getOrCreateMerchantWallet(cleanId, 'production', 'CREDIT');

      // 4. Provisionner le Wallet Marchand en Sandbox
      const sandboxWallet = await getOrCreateMerchantWallet(cleanId, 'sandbox', 'CREDIT');

      return reply.status(201).send({
        status: 'success',
        app: {
          id: cleanId,
          name,
          webhook_url: webhook_url || null,
          contact_email: contact_email || null,
          is_active: true,
          created_at: new Date().toISOString(),
        },
        merchant_wallets: {
          production: prodWallet.id,
          sandbox: sandboxWallet.id,
        },
        live_api_key: rawLiveKey,
        test_api_key: rawTestKey,
        webhook_secret: webhookSecret,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: 'Failed to create merchant application', details: err.message });
    }
  });

  // =========================================================================
  // ROUTES PROTÉGÉES PAR LA CLÉ D'API DU MARCHAND (sec_live_... ou sec_test_...)
  // =========================================================================
  fastify.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', requireAppAuth);

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
     * 2. COLLECTIONS : ENCAISSER AUPRÈS D'UN UTILISATEUR LIGHTPAY (mainapp)
     * Débite le wallet d'un utilisateur de notre application centrale et crédite le compte marchand de l'app.
     */
    protectedRoutes.post('/collections/charge-user', async (request: FastifyRequest, reply: FastifyReply) => {
      const appId = request.appData!.id;
      const environment = request.appData!.environment || 'production';
      const idempotencyKey = (request.headers['idempotency-key'] as string) || request.idempotencyKey;

      if (!idempotencyKey) {
        return reply.status(400).send({ error: 'Missing required header: Idempotency-Key' });
      }

      const { user_account_id, amount, currency = 'CREDIT', reference, description, metadata = {} } = request.body as any;

      if (!user_account_id || !amount) {
        return reply.status(400).send({ error: 'user_account_id and amount are required' });
      }

      const chargeAmount = BigInt(amount);
      if (chargeAmount <= 0n) {
        return reply.status(400).send({ error: 'Amount must be greater than zero' });
      }

      // 1. Récupérer le wallet client de notre application centrale (mainapp)
      const userWallets = await query(
        'SELECT id, available_balance, status FROM wallets WHERE app_id = \'mainapp\' AND account_id = $1 AND currency = $2 AND environment = $3',
        [user_account_id, currency, environment],
        environment
      );

      if (userWallets.length === 0) {
        return reply.status(404).send({
          error: 'USER_NOT_FOUND',
          message: `Utilisateur '${user_account_id}' introuvable sur la plateforme LightPay (${environment}).`,
        });
      }

      const userWallet = userWallets[0];
      if (userWallet.status !== 'ACTIVE') {
        return reply.status(400).send({ error: 'USER_WALLET_INACTIVE', message: 'Le compte utilisateur est inactif ou bloqué.' });
      }

      if (BigInt(userWallet.available_balance) < chargeAmount) {
        return reply.status(400).send({
          error: 'INSUFFICIENT_FUNDS',
          message: 'Solde insuffisant sur le compte LightPay de l\'utilisateur.',
        });
      }

      // 2. Récupérer le wallet marchand de l'application
      const merchantWallet = await getOrCreateMerchantWallet(appId, environment, currency);

      // 3. Exécution comptable atomique en partie double
      const postings: LedgerPosting[] = [
        {
          walletId: userWallet.id,
          direction: 'DEBIT',
          amount: chargeAmount,
          description: `Paiement vers ${appId} - Ref: ${reference || 'N/A'} (${environment})`,
        },
        {
          walletId: merchantWallet.id,
          direction: 'CREDIT',
          amount: chargeAmount,
          description: `Encaissement client [${user_account_id}] - Ref: ${reference || 'N/A'} (${environment})`,
        },
      ];

      try {
        const result = await LedgerEngine.executeTransaction({
          appId,
          idempotencyKey,
          type: 'COLLECTION',
          environment,
          amount: chargeAmount,
          currency,
          reference: reference || `COL_${Date.now()}`,
          metadata: {
            ...metadata,
            payer_user_id: user_account_id,
            merchant_app_id: appId,
            description: description || 'Paiement marchand API',
          },
          postings,
        });

        return reply.status(result.duplicate ? 200 : 201).send({
          status: 'success',
          message: `Encaissement de ${amount} ${currency} effectué avec succès auprès de ${user_account_id}`,
          ...result,
        });
      } catch (err: any) {
        return reply.status(err.statusCode || 400).send({
          status: 'error',
          error: err.code || 'COLLECTION_FAILED',
          message: err.message,
        });
      }
    });

    /**
     * 3. DISBURSEMENTS : DEMANDER UN RETRAIT VERS MOBILE MONEY (MTN / Airtel Congo)
     * Débite obligatoirement le compte marchand de l'application et déclenche le virement externe.
     */
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
     * 5. TOP-UP EN MODE SANDBOX UNIQUEMENT (Recharge Test)
     */
    protectedRoutes.post('/sandbox-topup', async (request: FastifyRequest, reply: FastifyReply) => {
      const appId = request.appData!.id;
      const environment = request.appData!.environment || 'production';

      if (environment !== 'sandbox') {
        return reply.status(403).send({
          error: 'FORBIDDEN_IN_PRODUCTION',
          message: 'Le top-up direct est strictement réservé au mode Sandbox (test).',
        });
      }

      const { amount = 50000, currency = 'CREDIT' } = (request.body as any) || {};
      const topupAmount = BigInt(amount);

      if (topupAmount <= 0n) {
        return reply.status(400).send({ error: 'Amount must be greater than zero' });
      }

      const merchantWallet = await getOrCreateMerchantWallet(appId, 'sandbox', currency);
      const treasuryWalletId = await LedgerEngine.getOrCreateMainTreasury('mainapp', 'sandbox', currency);

      // S'assurer que le Main Treasury Sandbox a suffisamment de réserve, sinon on lui injecte une réserve test
      await query(
        'UPDATE wallets SET available_balance = available_balance + $1 WHERE id = $2',
        [topupAmount.toString(), treasuryWalletId],
        'sandbox'
      );

      const idempotencyKey = `SANDBOX_TOPUP_${appId}_${Date.now()}`;

      try {
        const result = await LedgerEngine.executeTransaction({
          appId,
          idempotencyKey,
          type: 'TRANSFER',
          environment: 'sandbox',
          amount: topupAmount,
          currency,
          reference: `TOPUP_SANDBOX_${Date.now()}`,
          metadata: { app_id: appId, source: 'SANDBOX_FAUCET' },
          postings: [
            {
              walletId: treasuryWalletId,
              direction: 'DEBIT',
              amount: topupAmount,
              description: `Attribution Sandbox Faucet vers Marchand ${appId}`,
            },
            {
              walletId: merchantWallet.id,
              direction: 'CREDIT',
              amount: topupAmount,
              description: `Recharge Sandbox de test (+${amount} ${currency})`,
            },
          ],
        });

        return reply.status(201).send({
          status: 'success',
          message: `Solde Sandbox rechargé de ${amount} ${currency}`,
          ...result,
        });
      } catch (err: any) {
        return reply.status(400).send({ status: 'error', message: err.message });
      }
    });
  });
}
