import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, getClient } from '../db/pool.js';
import { LedgerEngine } from '../db/ledger.js';
import { requireAppAuth } from '../middleware/app-auth.js';

export async function faucetRoutes(fastify: FastifyInstance) {
  // Le service Faucet est 100% privé et authentifié par la clé d'API de test (sec_test_...)
  fastify.addHook('preHandler', requireAppAuth);

  const handleFaucetClaim = async (request: FastifyRequest, reply: FastifyReply) => {
    const appId = request.appData!.id;
    const environment = request.appData!.environment || 'sandbox';

    // 1. Restriction stricte au mode Sandbox
    if (environment !== 'sandbox') {
      return reply.status(403).send({
        error: 'FORBIDDEN_IN_PRODUCTION',
        message: 'Le Faucet est strictement réservé au mode Sandbox (test).',
      });
    }

    // 2. Vérifier si CETTE application a déjà réclamé sa dotation unique à vie
    const existingAppClaim = await query(
      "SELECT id, reference, completed_at FROM transactions WHERE app_id = $1 AND type = 'FAUCET' AND status = 'SUCCESS' AND environment = 'sandbox' LIMIT 1",
      [appId],
      'sandbox'
    );

    if (existingAppClaim.length > 0) {
      return reply.status(409).send({
        error: 'FAUCET_ALREADY_CLAIMED',
        message: `Votre application '${appId}' a déjà réclamé sa dotation unique de test à vie (1 000 Crédits).`,
        claimed_at: existingAppClaim[0].completed_at,
        reference: existingAppClaim[0].reference,
      });
    }

    // 3. Récupérer le wallet central de trésorerie (mainapp)
    let mainWalletRows = await query(
      "SELECT id, available_balance FROM wallets WHERE app_id = 'mainapp' AND (account_id = 'mainapp' OR account_id = 'SYSTEM_MAIN_TREASURY') AND environment = 'sandbox' LIMIT 1",
      [],
      'sandbox'
    );

    if (mainWalletRows.length === 0) {
      // Auto-provisionnement du wallet central si inexistant
      await query(
        `INSERT INTO wallets (id, app_id, account_id, account_type, currency, environment, available_balance, locked_balance, status, metadata)
         VALUES ('00000000-0000-0000-0000-000000000001', 'mainapp', 'mainapp', 'SYSTEM', 'CREDIT', 'sandbox', 0, 0, 'ACTIVE', '{"role":"main_treasury"}')
         ON CONFLICT (app_id, account_id, currency, environment) DO NOTHING`,
        [],
        'sandbox'
      );
      mainWalletRows = await query(
        "SELECT id, available_balance FROM wallets WHERE app_id = 'mainapp' AND (account_id = 'mainapp' OR account_id = 'SYSTEM_MAIN_TREASURY') AND environment = 'sandbox' LIMIT 1",
        [],
        'sandbox'
      );
    }

    const mainWallet = mainWalletRows[0];

    // 4. PROTOCOLE SMART CONTRACT GENESIS :
    // Au principe la faucette est vide.
    // Quand le tout premier demande la recharge, le système vérifie si la transaction initiale 'INITIAL_FAUCET' existe.
    // Si non, il enregistre le record smart contract initialisant la réserve centrale.
    const genesisTxRows = await query(
      "SELECT id FROM transactions WHERE type = 'INITIAL_FAUCET' AND status = 'SUCCESS' AND environment = 'sandbox' LIMIT 1",
      [],
      'sandbox'
    );

    if (genesisTxRows.length === 0) {
      const client = await getClient('sandbox');
      try {
        await client.query('BEGIN');

        // Vérification avec verrou de concurrence (FOR UPDATE)
        const checkGenesisAgain = await client.query(
          "SELECT id FROM transactions WHERE type = 'INITIAL_FAUCET' AND status = 'SUCCESS' AND environment = 'sandbox' LIMIT 1"
        );

        if (checkGenesisAgain.rows.length === 0) {
          const genesisAmount = 10000000n; // 10 000 000 Crédits amorce centrale
          const genesisIdempotency = 'GENESIS_SMART_CONTRACT_INITIAL_FAUCET';

          // A. Inscription de la transaction Genesis Smart Contract
          const genTxRes = await client.query(
            `INSERT INTO transactions (app_id, idempotency_key, type, environment, amount, fee_amount, currency, status, reference, metadata, completed_at)
             VALUES ('mainapp', $1, 'INITIAL_FAUCET', 'sandbox', $2, 0, 'CREDIT', 'SUCCESS', 'GENESIS_FAUCET_INIT', $3, NOW())
             RETURNING id`,
            [
              genesisIdempotency,
              genesisAmount.toString(),
              JSON.stringify({
                protocol: 'SMART_CONTRACT_FAUCET_GENESIS',
                note: 'Amorce initiale de la réserve Faucet Sandbox lors de la première requête historique',
                triggered_by_app: appId,
              }),
            ]
          );

          const genTxId = genTxRes.rows[0].id;

          // B. Crédit de la Trésorerie Centrale mainapp
          await client.query(
            'UPDATE wallets SET available_balance = available_balance + $1, updated_at = NOW() WHERE id = $2',
            [genesisAmount.toString(), mainWallet.id]
          );

          // C. Écriture immuable au Grand Livre
          await client.query(
            `INSERT INTO ledger_entries (transaction_id, wallet_id, direction, environment, amount, balance_before, balance_after, description)
             VALUES ($1, $2, 'CREDIT', 'sandbox', $3, '0', $3, 'Genesis Smart Contract: Amorce de la réserve centrale Sandbox (+10 000 000 Crédits)')`,
            [genTxId, mainWallet.id, genesisAmount.toString()]
          );
        }

        await client.query('COMMIT');
      } catch (err: any) {
        await client.query('ROLLBACK');
        return reply.status(500).send({
          error: 'GENESIS_INITIALIZATION_FAILED',
          message: `Échec de l'initialisation Genesis du smart contract: ${err.message}`,
        });
      } finally {
        client.release();
      }
    }

    // 5. La Faucet est maintenant garantie initialisée.
    // Récupérer ou provisionner l'unique wallet marchand de l'application
    const merchantWallets = await query(
      "SELECT id, available_balance FROM wallets WHERE app_id = $1 AND environment = 'sandbox' AND currency = 'CREDIT' LIMIT 1",
      [appId],
      'sandbox'
    );

    let merchantWalletId = merchantWallets[0]?.id;
    if (!merchantWalletId) {
      const created = await query(
        `INSERT INTO wallets (app_id, account_id, account_type, currency, environment, available_balance, locked_balance, status, metadata)
         VALUES ($1, $1, 'MERCHANT', 'CREDIT', 'sandbox', 0, 0, 'ACTIVE', '{"role":"merchant_root"}')
         ON CONFLICT (app_id, account_id, currency, environment) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [appId],
        'sandbox'
      );
      merchantWalletId = created[0].id;
    }

    // 6. Débit du coffre central mainapp et crédit du wallet marchand (1 000 Crédits)
    const faucetGrantAmount = 1000n;
    const faucetIdempotency = `FAUCET_GRANT_${appId}`;

    try {
      const result = await LedgerEngine.executeTransaction({
        appId,
        idempotencyKey: faucetIdempotency,
        type: 'FAUCET',
        environment: 'sandbox',
        amount: faucetGrantAmount,
        currency: 'CREDIT',
        reference: `FAUCET_${appId}`,
        metadata: {
          app_id: appId,
          grant_type: 'ONCE_IN_A_LIFETIME_TEST_DOTATION',
          description: 'Dotation Faucet de test unique à vie (+1 000 Crédits)',
        },
        postings: [
          {
            walletId: mainWallet.id,
            direction: 'DEBIT',
            amount: faucetGrantAmount,
            description: `Attribution Faucet vers ${appId} (1000 Crédits)`,
          },
          {
            walletId: merchantWalletId,
            direction: 'CREDIT',
            amount: faucetGrantAmount,
            description: 'Dotation Faucet de test unique à vie (+1 000 Crédits)',
          },
        ],
      });

      const updatedWallet = await query(
        'SELECT available_balance FROM wallets WHERE id = $1',
        [merchantWalletId],
        'sandbox'
      );

      return reply.status(200).send({
        status: 'success',
        message: `Félicitations ! 1 000 Crédits Sandbox ont été transférés avec succès sur votre portefeuille marchand.`,
        app_id: appId,
        amount: 1000,
        currency: 'CREDIT',
        available_balance: updatedWallet[0]?.available_balance || '1000',
        transaction: result,
      });
    } catch (err: any) {
      console.error('[FAUCET ERROR]', err);
      return reply.status(400).send({
        status: 'error',
        error: err.code || 'FAUCET_TRANSFER_FAILED',
        message: err.message,
      });
    }
  };

  // Routes protégées par la clé secrète du marchand
  fastify.post('/faucet', handleFaucetClaim);
  fastify.post('/v1/merchant/faucet', handleFaucetClaim);
}
