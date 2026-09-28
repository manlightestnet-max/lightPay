import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/pool.js';
import { requireAppAuth } from '../middleware/app-auth.js';
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

    // Closed: the app's owner withdraws from the LightPay console (Développeurs → app → Solde),
    // on the current mobile-money rails with the usual fees.
    protectedRoutes.post('/disbursements/payout', async (_request: FastifyRequest, reply: FastifyReply) =>
      reply.status(410).send({
        error: 'GONE',
        message: 'Retirez le solde de votre app depuis votre console LightPay : Développeurs → votre app → Solde.',
      })
    );

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
