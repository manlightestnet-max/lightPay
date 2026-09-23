import { FastifyInstance } from 'fastify';
import { query } from '../db/pool.js';
import { requireAppAuth } from '../middleware/app-auth.js';

export async function walletRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAppAuth);

  // 1. Créer ou récupérer un wallet pour un account_id externe (isolé par environnement)
  fastify.post('/', async (request, reply) => {
    const appId = request.appData!.id;
    const environment = request.appData!.environment || 'production';
    const { account_id, account_type = 'USER', currency = 'CREDIT', metadata = {} } = request.body as any;

    if (!account_id) {
      return reply.status(400).send({ error: 'account_id is required' });
    }

    // ⛔ SÉCURITÉ ARCHITECTURALE : Seule notre application centrale 'mainapp' peut émettre des wallets clients (USER)
    if (account_type === 'USER' && appId !== 'mainapp') {
      return reply.status(403).send({
        error: 'FORBIDDEN_USER_WALLET_CREATION',
        message: 'Only the central platform (mainapp) is authorized to issue user wallets. Third-party applications operate as wholesalers/merchants.',
      });
    }

    try {
      // Upsert : retourne le wallet existant ou le crée pour cet environnement
      const result = await query(
        `INSERT INTO wallets (app_id, account_id, account_type, currency, environment, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (app_id, account_id, currency, environment)
         DO UPDATE SET updated_at = NOW()
         RETURNING id, app_id, account_id, account_type, currency, environment, available_balance, locked_balance, status, created_at`,
        [appId, account_id, account_type, currency, environment, JSON.stringify(metadata)],
        environment
      );

      return reply.status(201).send({
        status: 'success',
        wallet: result[0],
      });
    } catch (err: any) {
      return reply.status(500).send({ error: 'Failed to create wallet', details: err.message });
    }
  });

  // 2. Consulter le solde par ID de wallet
  fastify.get('/:wallet_id', async (request, reply) => {
    const appId = request.appData!.id;
    const environment = request.appData!.environment || 'production';
    const { wallet_id } = request.params as any;

    const rows = await query(
      `SELECT id, app_id, account_id, account_type, currency, environment, available_balance, locked_balance, status, metadata, created_at, updated_at
       FROM wallets WHERE id = $1 AND app_id = $2`,
      [wallet_id, appId],
      environment
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Wallet not found' });
    }

    return { status: 'success', wallet: rows[0] };
  });

  // 3. Consulter le solde directement par account_id du site client dans son environnement
  fastify.get('/accounts/:account_id', async (request, reply) => {
    const appId = request.appData!.id;
    const environment = request.appData!.environment || 'production';
    const { account_id } = request.params as any;
    const { currency = 'CREDIT' } = request.query as any;

    const rows = await query(
      `SELECT id, app_id, account_id, account_type, currency, environment, available_balance, locked_balance, status, metadata, created_at, updated_at
       FROM wallets WHERE account_id = $1 AND app_id = $2 AND currency = $3 AND environment = $4`,
      [account_id, appId, currency, environment],
      environment
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: `Wallet not found for this account in ${environment}` });
    }

    return { status: 'success', wallet: rows[0] };
  });

  // 4. Relevé de compte / Grand Livre (Statement)
  fastify.get('/:wallet_id/statement', async (request, reply) => {
    const appId = request.appData!.id;
    const environment = request.appData!.environment || 'production';
    const { wallet_id } = request.params as any;
    const { limit = 50, offset = 0 } = request.query as any;

    // Vérifier l'appartenance
    const check = await query('SELECT id, environment FROM wallets WHERE id = $1 AND app_id = $2', [wallet_id, appId], environment);
    if (check.length === 0) {
      return reply.status(404).send({ error: 'Wallet not found' });
    }

    const entries = await query(
      `SELECT le.id, le.transaction_id, le.direction, le.environment, le.amount, le.balance_before, le.balance_after, le.description, le.created_at,
              t.type as transaction_type, t.reference
       FROM ledger_entries le
       JOIN transactions t ON t.id = le.transaction_id
       WHERE le.wallet_id = $1
       ORDER BY le.created_at DESC
       LIMIT $2 OFFSET $3`,
      [wallet_id, parseInt(limit, 10), parseInt(offset, 10)],
      environment
    );

    return {
      status: 'success',
      wallet_id,
      count: entries.length,
      entries,
    };
  });
}
