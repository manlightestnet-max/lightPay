import { FastifyInstance } from 'fastify';
import { query } from '../db/pool.js';

export async function explorerApiRoutes(fastify: FastifyInstance) {
  /**
   * 1. Statistiques globales de monitoring (100% READ-ONLY)
   * Supporte le filtrage par app_id et par environnement ('sandbox' | 'production')
   */
  fastify.get('/stats', async (request) => {
    const { app_id, environment } = request.query as any;

    let envCondition = '';
    if (environment === 'sandbox' || environment === 'production') {
      envCondition = `AND environment = '${environment}'`;
    }

    const sql = `
      SELECT 
        (SELECT COUNT(*) FROM apps WHERE is_active = TRUE) as total_apps,
        (SELECT COUNT(*) FROM wallets WHERE 1=1 ${app_id ? `AND app_id = '${app_id}'` : ''} ${envCondition}) as total_wallets,
        (SELECT COUNT(*) FROM transactions WHERE 1=1 ${app_id ? `AND app_id = '${app_id}'` : ''} ${envCondition}) as total_transactions,
        (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE status = 'SUCCESS' ${app_id ? `AND app_id = '${app_id}'` : ''} ${envCondition}) as total_volume_aoa,
        (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE status = 'SUCCESS' AND environment = 'production' ${app_id ? `AND app_id = '${app_id}'` : ''}) as live_volume_aoa,
        (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE status = 'SUCCESS' AND environment = 'sandbox' ${app_id ? `AND app_id = '${app_id}'` : ''}) as sandbox_volume_aoa,
        (SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END), 0) FROM ledger_entries WHERE 1=1 ${app_id ? `AND wallet_id IN (SELECT id FROM wallets WHERE app_id = '${app_id}')` : ''} ${envCondition}) as total_debit,
        (SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END), 0) FROM ledger_entries WHERE 1=1 ${app_id ? `AND wallet_id IN (SELECT id FROM wallets WHERE app_id = '${app_id}')` : ''} ${envCondition}) as total_credit,
        (SELECT COUNT(*) FROM ledger_entries WHERE 1=1 ${app_id ? `AND wallet_id IN (SELECT id FROM wallets WHERE app_id = '${app_id}')` : ''} ${envCondition}) as total_entries;
    `;

    const rows = await query(sql);
    const r = rows[0] || {};
    const totalDebit = (r.total_debit || '0').toString();
    const totalCredit = (r.total_credit || '0').toString();

    return {
      status: 'success',
      stats: {
        total_apps: parseInt(r.total_apps || '0', 10),
        total_wallets: parseInt(r.total_wallets || '0', 10),
        total_transactions: parseInt(r.total_transactions || '0', 10),
        total_volume_aoa: (r.total_volume_aoa || '0').toString(),
        live_volume_aoa: (r.live_volume_aoa || '0').toString(),
        sandbox_volume_aoa: (r.sandbox_volume_aoa || '0').toString(),
        ledger_entries_count: parseInt(r.total_entries || '0', 10),
        is_balanced: totalDebit === totalCredit,
        total_debit: totalDebit,
        total_credit: totalCredit,
        selected_environment: environment || 'all',
      },
    };
  });

  /**
   * 2. Liste des applications enregistrées (100% READ-ONLY)
   */
  fastify.get('/apps', async () => {
    const apps = await query(
      'SELECT id, name, is_active, (test_api_key_hash IS NOT NULL) as has_sandbox_key, created_at FROM apps ORDER BY created_at DESC'
    );
    return { status: 'success', apps };
  });

  /**
   * 3. Liste des portefeuilles (100% READ-ONLY)
   */
  fastify.get('/wallets', async (request) => {
    const { app_id, status, account_type, environment, limit = 100, offset = 0 } = request.query as any;

    let sql = 'SELECT id, app_id, account_id, account_type, currency, environment, available_balance, locked_balance, status, created_at, updated_at FROM wallets WHERE 1=1';
    const params: any[] = [];

    if (app_id) {
      params.push(app_id);
      sql += ` AND app_id = $${params.length}`;
    }
    if (environment) {
      params.push(environment);
      sql += ` AND environment = $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }
    if (account_type) {
      params.push(account_type);
      sql += ` AND account_type = $${params.length}`;
    }

    params.push(parseInt(limit, 10), parseInt(offset, 10));
    sql += ` ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const wallets = await query(sql, params);
    return { status: 'success', count: wallets.length, wallets };
  });

  /**
   * 4. Flux spot des transactions (100% READ-ONLY)
   */
  fastify.get('/transactions', async (request) => {
    const { wallet_id, q, environment = 'all', limit = 100, offset = 0 } = request.query as any;

    let sql = `
      SELECT 
        t.id, t.type, t.environment, t.amount, t.fee_amount, t.currency, t.status, t.reference, t.created_at, t.completed_at,
        (
          SELECT json_agg(json_build_object(
            'wallet_id', le.wallet_id,
            'direction', le.direction,
            'amount', le.amount,
            'balance_before', le.balance_before,
            'balance_after', le.balance_after,
            'account_id', w.account_id,
            'account_type', w.account_type,
            'description', le.description
          ))
          FROM ledger_entries le
          LEFT JOIN wallets w ON w.id = le.wallet_id
          WHERE le.transaction_id = t.id
        ) as postings
      FROM transactions t
      WHERE 1=1
    `;
    const params: any[] = [];

    // Recherche par wallet_id spécifique
    if (wallet_id) {
      params.push(wallet_id);
      sql += ` AND t.id IN (SELECT transaction_id FROM ledger_entries WHERE wallet_id::text = $${params.length})`;
    }

    // Recherche générique (ID wallet, ID compte, ID transaction, référence)
    if (q && q.trim().length > 0) {
      params.push(`%${q.trim()}%`);
      sql += ` AND (
        t.id::text ILIKE $${params.length} 
        OR t.reference ILIKE $${params.length}
        OR t.id IN (
          SELECT le.transaction_id 
          FROM ledger_entries le 
          LEFT JOIN wallets w ON w.id = le.wallet_id 
          WHERE le.wallet_id::text ILIKE $${params.length} OR w.account_id ILIKE $${params.length}
        )
      )`;
    }

    params.push(parseInt(limit, 10), parseInt(offset, 10));
    sql += ` ORDER BY t.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    let transactions: any[] = [];
    if (environment === 'sandbox') {
      transactions = await query(sql, params, 'sandbox');
    } else if (environment === 'production') {
      transactions = await query(sql, params, 'production');
    } else {
      const [prodTxs, sandTxs] = await Promise.all([
        query(sql, params, 'production'),
        query(sql, params, 'sandbox'),
      ]);
      transactions = [...prodTxs, ...sandTxs]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, parseInt(limit, 10));
    }

    return { status: 'success', count: transactions.length, transactions };
  });

  /**
   * 5. Inspection des écritures en partie double d'une transaction (100% READ-ONLY)
   */
  fastify.get('/transactions/:id/postings', async (request, reply) => {
    const { id } = request.params as any;

    let tx = await query('SELECT * FROM transactions WHERE id = $1', [id], 'production');
    let targetEnv: 'production' | 'sandbox' = 'production';
    if (tx.length === 0) {
      tx = await query('SELECT * FROM transactions WHERE id = $1', [id], 'sandbox');
      targetEnv = 'sandbox';
    }

    if (tx.length === 0) {
      return reply.status(404).send({ error: 'Transaction not found' });
    }

    const postings = await query(
      `SELECT le.id, le.wallet_id, le.environment, w.account_id, w.account_type, le.direction, le.amount, le.balance_before, le.balance_after, le.description, le.created_at
       FROM ledger_entries le
       JOIN wallets w ON w.id = le.wallet_id
       WHERE le.transaction_id = $1
       ORDER BY le.direction ASC`,
      [id],
      targetEnv
    );

    return {
      status: 'success',
      transaction: tx[0],
      postings,
    };
  });
}
