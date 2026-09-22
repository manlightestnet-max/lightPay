import { FastifyInstance } from 'fastify';
import { requireAppAuth } from '../middleware/app-auth.js';
import { LedgerEngine } from '../db/ledger.js';
import { query } from '../db/pool.js';

export async function externalMoneyRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAppAuth);

  /**
   * Endpoint de Dépôt / Injection de Liquidité
   * SÉCURITÉ ABSOLUE :
   * - En Production : Tout dépôt direct par clé d'application est STRICTEMENT INTERDIT (Code 403).
   *   L'entrée de fonds doit obligatoirement transiter par le webhook certifié de l'agrégateur vers le Main Treasury Wallet.
   * - En Sandbox : Autorisé uniquement si adossé au Main Treasury Wallet de test (aucun découvert possible).
   */
  fastify.post('/collections/deposit', async (request, reply) => {
    const appId = request.appData!.id;
    const environment = request.appData!.environment || 'production';

    // ⛔ BLOCAGE ANTI-FRAUDE STRICT EN PRODUCTION
    if (environment === 'production') {
      return reply.status(403).send({
        error: 'FORBIDDEN: DIRECT_DEPOSITS_PROHIBITED_USE_MAINAPP_OR_GATEWAY',
        message:
          'En production, les dépôts directs arbitraires sont strictement interdits. ' +
          'La capitalisation doit obligatoirement provenir d un règlement réel d agrégateur externe vers le Main Treasury Wallet, ou d une distribution validée via MainApp.',
      });
    }

    // --- MODE SANDBOX STRICTEMENT ADOSSÉ AU MAIN TREASURY SANDBOX ---
    const idempotencyKey = (request.headers['idempotency-key'] as string) || request.idempotencyKey;
    if (!idempotencyKey) {
      return reply.status(400).send({ error: 'Missing required header: Idempotency-Key' });
    }

    let {
      wallet_id,
      account_id,
      amount,
      currency = 'CREDIT',
      reference,
      metadata = {},
    } = request.body as any;

    if (!amount) {
      return reply.status(400).send({ error: 'Le montant est requis' });
    }

    const depositAmount = BigInt(amount);
    if (depositAmount <= 0n) {
      return reply.status(400).send({ error: 'Le montant doit être supérieur à zéro' });
    }

    // Résolution ou auto-création du wallet cible en Sandbox
    if (!wallet_id && account_id) {
      const userWallets = await query(
        'SELECT id FROM wallets WHERE app_id = $1 AND account_id = $2 AND currency = $3 AND environment = $4',
        [appId, account_id, currency, environment],
        environment
      );
      if (userWallets.length === 0) {
        const created = await query(
          `INSERT INTO wallets (app_id, account_id, account_type, currency, environment)
           VALUES ($1, $2, 'USER', $3, $4)
           RETURNING id`,
          [appId, account_id, currency, environment],
          environment
        );
        wallet_id = created[0].id;
      } else {
        wallet_id = userWallets[0].id;
      }
    }

    if (!wallet_id) {
      return reply.status(400).send({ error: 'wallet_id ou account_id est requis' });
    }

    // Récupérer le Main Treasury Wallet Sandbox
    const treasuryWalletId = await LedgerEngine.getOrCreateMainTreasury('mainapp', environment, currency);

    // Vérifier la réserve de trésorerie Sandbox
    const treasuryRows = await query('SELECT available_balance FROM wallets WHERE id = $1', [treasuryWalletId], environment);
    const availableReserve = BigInt(treasuryRows[0]?.available_balance || '0');

    // Aucune création de crédit ex-nihilo : même en Sandbox, la réserve doit être préalablement approvisionnée via l'agrégateur Sandbox
    if (availableReserve < depositAmount) {
      return reply.status(400).send({
        error: 'INSUFFICIENT_TREASURY_RESERVE',
        message: `La réserve du Main Treasury Sandbox (${availableReserve} Crédits) est insuffisante pour allouer ${depositAmount} Crédits. Veuillez d'abord approvisionner le coffre-fort via l'agrégateur Sandbox (simulateur ou webhook).`,
      });
    }

    try {
      const result = await LedgerEngine.executeTransaction({
        appId,
        idempotencyKey,
        type: 'TRANSFER',
        environment,
        amount: depositAmount,
        currency,
        reference: reference || `DEP_TREASURY_${Date.now()}`,
        metadata: {
          ...metadata,
          source: 'MAIN_TREASURY_SANDBOX',
          account_id,
        },
        postings: [
          {
            walletId: treasuryWalletId,
            direction: 'DEBIT',
            amount: depositAmount,
            description: `Débit Main Treasury Sandbox vers [${account_id || wallet_id}]`,
          },
          {
            walletId: wallet_id,
            direction: 'CREDIT',
            amount: depositAmount,
            description: `Dépôt Sandbox alloué depuis Main Treasury`,
          },
        ],
      });

      return reply.status(result.duplicate ? 200 : 201).send({
        status: 'success',
        message: 'Crédits Sandbox alloués avec succès depuis le Main Treasury',
        ...result,
      });
    } catch (err: any) {
      return reply.status(400).send({ status: 'error', message: err.message });
    }
  });
}
