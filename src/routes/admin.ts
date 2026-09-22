import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { timingSafeCompare } from '../middleware/app-auth.js';
import { LedgerEngine } from '../db/ledger.js';

export async function adminRoutes(fastify: FastifyInstance) {
  // Middleware de vérification de la clé Super-Admin (constant-time comparison)
  fastify.addHook('preHandler', async (request, reply) => {
    const masterKey = request.headers['x-master-key'] as string;
    if (!masterKey || !timingSafeCompare(masterKey, config.masterAdminKey)) {
      return reply.status(401).send({ error: 'Unauthorized: Master admin key required' });
    }
  });

  /**
   * 1. Enregistrer une nouvelle application avec clés Live ET Sandbox dupliquées
   */
  fastify.post('/apps', async (request, reply) => {
    const { id, name, webhook_url } = request.body as any;

    if (!id || !name) {
      return reply.status(400).send({ error: 'id and name are required' });
    }

    // Génération des paires de clés indépendantes (Live vs Sandbox)
    const rawLiveKey = `sec_live_${crypto.randomBytes(24).toString('hex')}`;
    const liveKeyHash = crypto.createHash('sha256').update(rawLiveKey).digest('hex');

    const rawTestKey = `sec_test_${crypto.randomBytes(24).toString('hex')}`;
    const testKeyHash = crypto.createHash('sha256').update(rawTestKey).digest('hex');

    const webhookSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

    try {
      // 1. Enregistrer l'app dans la base PRODUCTION physique
      await query(
        `INSERT INTO apps (id, name, api_key_hash, test_api_key_hash, webhook_url, webhook_secret)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET name = $2, api_key_hash = $3, test_api_key_hash = $4, webhook_secret = $6, updated_at = NOW()`,
        [id, name, liveKeyHash, testKeyHash, webhook_url || null, webhookSecret],
        'production'
      );

      // 2. Enregistrer l'app dans la base SANDBOX physique
      await query(
        `INSERT INTO apps (id, name, api_key_hash, test_api_key_hash, webhook_url, webhook_secret)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET name = $2, api_key_hash = $3, test_api_key_hash = $4, webhook_secret = $6, updated_at = NOW()`,
        [id, name, liveKeyHash, testKeyHash, webhook_url || null, webhookSecret],
        'sandbox'
      );

      // 3. Création automatique du portefeuille SYSTEM PRODUCTION
      await query(
        `INSERT INTO wallets (app_id, account_id, account_type, currency, environment, metadata)
         VALUES ($1, 'SYSTEM_CASH_GATEWAY', 'SYSTEM', 'CREDIT', 'production', '{"role":"system_gateway_live"}')
         ON CONFLICT (app_id, account_id, currency, environment) DO UPDATE SET updated_at = NOW()`,
        [id],
        'production'
      );

      // 4. Création automatique du portefeuille SYSTEM SANDBOX
      await query(
        `INSERT INTO wallets (app_id, account_id, account_type, currency, environment, metadata)
         VALUES ($1, 'SYSTEM_CASH_GATEWAY', 'SYSTEM', 'CREDIT', 'sandbox', '{"role":"system_gateway_sandbox"}')
         ON CONFLICT (app_id, account_id, currency, environment) DO UPDATE SET updated_at = NOW()`,
        [id],
        'sandbox'
      );

      return reply.status(201).send({
        status: 'success',
        app: {
          id,
          name,
          webhook_url,
          live_api_key: rawLiveKey,
          test_api_key: rawTestKey,
          api_key: rawLiveKey,
          webhook_secret: webhookSecret,
        },
        warning: 'Store these API keys safely. They will never be shown again.',
      });
    } catch (err: any) {
      return reply.status(400).send({ error: 'Failed to create app', details: err.message });
    }
  });

  /**
   * 2. Assurer les clés et portefeuilles Sandbox pour une application existante
   */
  fastify.post('/apps/:id/ensure-sandbox', async (request, reply) => {
    const { id } = request.params as any;

    const apps = await query('SELECT id, name, api_key_hash, test_api_key_hash, webhook_secret FROM apps WHERE id = $1', [id], 'production');
    if (apps.length === 0) {
      return reply.status(404).send({ error: 'App not found' });
    }

    let rawTestKey: string | null = null;
    let testKeyHash = apps[0].test_api_key_hash;
    if (!testKeyHash) {
      rawTestKey = `sec_test_${crypto.randomBytes(24).toString('hex')}`;
      testKeyHash = crypto.createHash('sha256').update(rawTestKey).digest('hex');
      await query('UPDATE apps SET test_api_key_hash = $1 WHERE id = $2', [testKeyHash, id], 'production');
    }

    // Assurer l'application dans la base physique SANDBOX
    await query(
      `INSERT INTO apps (id, name, api_key_hash, test_api_key_hash, webhook_url, webhook_secret)
       VALUES ($1, $2, $3, $4, null, $5)
       ON CONFLICT (id) DO UPDATE SET test_api_key_hash = $4, updated_at = NOW()`,
      [id, apps[0].name, apps[0].api_key_hash || 'prod_hash', testKeyHash, apps[0].webhook_secret || 'whsec_dummy'],
      'sandbox'
    );

    // Assurer le portefeuille SYSTEM SANDBOX dans la base SANDBOX physique
    await query(
      `INSERT INTO wallets (app_id, account_id, account_type, currency, environment, metadata)
       VALUES ($1, 'SYSTEM_CASH_GATEWAY', 'SYSTEM', 'CREDIT', 'sandbox', '{"role":"system_gateway_sandbox"}')
       ON CONFLICT (app_id, account_id, currency, environment) DO UPDATE SET updated_at = NOW()`,
      [id],
      'sandbox'
    );

    return {
      status: 'success',
      app_id: id,
      test_api_key: rawTestKey || '(already configured)',
    };
  });

  /**
   * 3. Audit & Réconciliation comptable globale et par environnement
   */
  /**
   * 3. Audit & Réconciliation comptable globale et par environnement
   */
  fastify.get('/reconciliation', async (request, reply) => {
    const [prodCheck, sandCheck] = await Promise.all([
      query(`
        SELECT 
          'production' as environment,
          SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END) as total_debit,
          SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END) as total_credit,
          COUNT(*) as total_entries
        FROM ledger_entries
      `, [], 'production'),
      query(`
        SELECT 
          'sandbox' as environment,
          SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END) as total_debit,
          SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END) as total_credit,
          COUNT(*) as total_entries
        FROM ledger_entries
      `, [], 'sandbox')
    ]);

    const check = [...prodCheck, ...sandCheck];

    let globalDebit = 0n;
    let globalCredit = 0n;
    let globalEntries = 0;
    const byEnv: Record<string, any> = {};

    for (const row of check) {
      const d = BigInt(row.total_debit || '0');
      const c = BigInt(row.total_credit || '0');
      globalDebit += d;
      globalCredit += c;
      globalEntries += parseInt(row.total_entries || '0', 10);
      byEnv[row.environment] = {
        is_balanced: d === c,
        total_debit: d.toString(),
        total_credit: c.toString(),
        difference: (d - c).toString(),
        entries_count: parseInt(row.total_entries || '0', 10),
      };
    }

    return {
      status: 'success',
      is_balanced: globalDebit === globalCredit,
      total_debit: globalDebit.toString(),
      total_credit: globalCredit.toString(),
      difference: (globalDebit - globalCredit).toString(),
      total_entries: globalEntries,
      by_environment: byEnv,
    };
  });

  /**
   * 4. Liste des applications enregistrées
   */
  fastify.get('/apps', async (request, reply) => {
    const { environment = 'production' } = (request.query as any) || {};
    const env = environment === 'sandbox' ? 'sandbox' : 'production';
    const apps = await query(
      'SELECT id, name, webhook_url, is_active, (test_api_key_hash IS NOT NULL) as has_sandbox_key, created_at FROM apps ORDER BY created_at DESC',
      [],
      env
    );
    return { status: 'success', apps };
  });

  /**
   * 5. Statistiques globales pour l'Explorer Dashboard
   */
  fastify.get('/stats', async (request, reply) => {
    const { environment } = request.query as any;
    const env = environment === 'sandbox' ? 'sandbox' : 'production';

    const rows = await query(`
      SELECT 
        (SELECT COUNT(*) FROM apps WHERE is_active = TRUE) as total_apps,
        (SELECT COUNT(*) FROM wallets) as total_wallets,
        (SELECT COUNT(*) FROM transactions) as total_transactions,
        (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE status = 'SUCCESS') as total_volume_aoa,
        (SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END), 0) FROM ledger_entries) as total_debit,
        (SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END), 0) FROM ledger_entries) as total_credit,
        (SELECT COUNT(*) FROM ledger_entries) as total_entries;
    `, [], env);

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
        ledger_entries_count: parseInt(r.total_entries || '0', 10),
        is_balanced: totalDebit === totalCredit,
        total_debit: totalDebit,
        total_credit: totalCredit,
      },
    };
  });

  /**
   * 6. Explorer: Liste de tous les portefeuilles multi-tenant
   */
  fastify.get('/wallets', async (request, reply) => {
    const { app_id, status, account_type, environment, limit = 100, offset = 0 } = request.query as any;
    const env = environment === 'sandbox' ? 'sandbox' : 'production';

    let sql = `
      SELECT w.id, w.app_id, a.name as app_name, w.account_id, w.account_type, w.currency, w.environment,
             w.available_balance, w.locked_balance, w.status, w.metadata, w.created_at, w.updated_at
      FROM wallets w
      LEFT JOIN apps a ON a.id = w.app_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (app_id) {
      params.push(app_id);
      sql += ` AND w.app_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += ` AND w.status = $${params.length}`;
    }
    if (account_type) {
      params.push(account_type);
      sql += ` AND w.account_type = $${params.length}`;
    }

    params.push(parseInt(limit, 10), parseInt(offset, 10));
    sql += ` ORDER BY w.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const wallets = await query(sql, params, env);
    return { status: 'success', count: wallets.length, wallets };
  });

  /**
   * 7. Explorer: Liste des transactions
   */
  fastify.get('/transactions', async (request, reply) => {
    const { app_id, type, status, environment, limit = 50, offset = 0 } = request.query as any;
    const env = environment === 'sandbox' ? 'sandbox' : 'production';

    let sql = `
      SELECT t.id, t.app_id, a.name as app_name, t.idempotency_key, t.type, t.environment, t.amount, t.fee_amount,
             t.currency, t.status, t.reference, t.metadata, t.created_at, t.completed_at
      FROM transactions t
      LEFT JOIN apps a ON a.id = t.app_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (app_id) {
      params.push(app_id);
      sql += ` AND t.app_id = $${params.length}`;
    }
    if (type) {
      params.push(type);
      sql += ` AND t.type = $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += ` AND t.status = $${params.length}`;
    }

    params.push(parseInt(limit, 10), parseInt(offset, 10));
    sql += ` ORDER BY t.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const transactions = await query(sql, params, env);
    return { status: 'success', count: transactions.length, transactions };
  });

  /**
   * ⛔ ROUTE SUPPRIMÉE DÉFINITIVEMENT — SÉCURITÉ ANTI-FRAUDE
   * POST /wallets/seed est INTERDIT : il permettait de créditer un wallet
   * depuis le SYSTEM_CASH_GATEWAY sans passer par le Main Treasury Wallet,
   * créant ainsi de l'argent ex-nihilo (fraude comptable).
   *
   * La seule voie légale pour injecter de la liquidité est :
   *   POST /v1/gateways/webhook/:provider  → alimente SYSTEM_MAIN_TREASURY
   *   POST /v1/admin/treasury/distribute   → distribue depuis SYSTEM_MAIN_TREASURY
   */

  /**
   * 7. GET /treasury : Tableau de bord de trésorerie pour MainApp
   * Retourne l'état complet du Main Treasury Wallet et des crédits en circulation
   */
  fastify.get('/treasury', async (request, reply) => {
    const { environment = 'sandbox' } = (request.query as any) || {};
    const env = environment === 'production' ? 'production' : 'sandbox';

    // Récupérer les applications partenaires (hors mainapp)
    const apps = await query("SELECT id, name FROM apps WHERE id != 'mainapp' ORDER BY created_at ASC", [], env);

    const treasuryWalletId = await LedgerEngine.getOrCreateMainTreasury('mainapp', env, 'CREDIT');

    // 1. Solde du Main Treasury
    const treasuryRows = await query(
      'SELECT id, available_balance, locked_balance, currency, updated_at FROM wallets WHERE id = $1',
      [treasuryWalletId],
      env
    );
    const treasuryBalance = treasuryRows[0]?.available_balance || '0';

    // 2. Solde total en circulation dans les portefeuilles utilisateurs / marchands (hors SYSTEM)
    const circulatingRows = await query(
      "SELECT COALESCE(SUM(available_balance), 0) as total_circulating, COUNT(*) as active_wallets FROM wallets WHERE account_type != 'SYSTEM' AND environment = $1",
      [env],
      env
    );
    const circulatingBalance = circulatingRows[0]?.total_circulating || '0';
    const activeWalletsCount = circulatingRows[0]?.active_wallets || 0;

    // 3. Dernières écritures comptables impliquant le Main Treasury
    const recentTxs = await query(
      `SELECT le.id, le.transaction_id, le.direction, le.amount, le.balance_before, le.balance_after, le.description, le.created_at,
              t.type as tx_type, t.reference, t.metadata
       FROM ledger_entries le
       JOIN transactions t ON t.id = le.transaction_id
       WHERE le.wallet_id = $1
       ORDER BY le.created_at DESC
       LIMIT 30`,
      [treasuryWalletId],
      env
    );

    return {
      status: 'success',
      environment: env,
      treasury_wallet_id: treasuryWalletId,
      treasury_reserve_balance: treasuryBalance,
      circulating_credits_balance: circulatingBalance,
      total_backed_supply: (BigInt(treasuryBalance) + BigInt(circulatingBalance)).toString(),
      active_wallets_count: parseInt(activeWalletsCount, 10),
      currency: 'CREDIT',
      apps,
      recent_transactions: recentTxs,
    };
  });

  /**
   * 8. POST /treasury/distribute : Distribuer des Crédits depuis le Main Treasury
   * Débite obligatoirement SYSTEM_MAIN_TREASURY et crédite l'application / utilisateur cible
   */
  fastify.post('/treasury/distribute', async (request, reply) => {
    const {
      environment = 'sandbox',
      app_id,
      target_account_id,
      target_wallet_id,
      amount,
      note = 'Distribution de trésorerie',
    } = request.body as any;

    const env = environment === 'production' ? 'production' : 'sandbox';

    if (!amount || BigInt(amount) <= 0n) {
      return reply.status(400).send({ error: 'Le montant de distribution doit être supérieur à zéro' });
    }

    const distributeAmount = BigInt(amount);

    // Déterminer l'app_id
    let resolvedAppId = app_id;
    if (!resolvedAppId) {
      const apps = await query('SELECT id FROM apps ORDER BY created_at ASC LIMIT 1', [], env);
      if (apps.length === 0) {
        return reply.status(404).send({ error: `Aucune application enregistrée en base ${env}` });
      }
      resolvedAppId = apps[0].id;
    }

    // Récupérer le Main Treasury Wallet central
    const treasuryWalletId = await LedgerEngine.getOrCreateMainTreasury('mainapp', env, 'CREDIT');

    // Vérifier immédiatement la réserve disponible
    const treasuryRows = await query('SELECT available_balance FROM wallets WHERE id = $1', [treasuryWalletId], env);
    const availableReserve = BigInt(treasuryRows[0]?.available_balance || '0');

    if (availableReserve < distributeAmount) {
      return reply.status(400).send({
        error: `INSUFFICIENT_TREASURY_RESERVE: La réserve du Main Treasury (${availableReserve} Crédits) est insuffisante pour distribuer ${distributeAmount} Crédits. Veuillez d'abord encaisser via l'agrégateur.`,
      });
    }

    // Résoudre le wallet de destination
    let destinationWalletId = target_wallet_id;
    if (!destinationWalletId && target_account_id) {
      const userWallets = await query(
        'SELECT id FROM wallets WHERE app_id = $1 AND account_id = $2 AND currency = $3 AND environment = $4',
        [resolvedAppId, target_account_id, 'CREDIT', env],
        env
      );
      if (userWallets.length === 0) {
        const created = await query(
          `INSERT INTO wallets (app_id, account_id, account_type, currency, environment, metadata)
           VALUES ($1, $2, 'USER', 'CREDIT', $3, '{"created_by":"mainapp_treasury_distribution"}')
           RETURNING id`,
          [resolvedAppId, target_account_id, env],
          env
        );
        destinationWalletId = created[0].id;
      } else {
        destinationWalletId = userWallets[0].id;
      }
    }

    if (!destinationWalletId) {
      return reply.status(400).send({ error: 'target_account_id ou target_wallet_id est requis' });
    }

    const idempotencyKey = `DISTRIB_TREASURY_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      const result = await LedgerEngine.executeTransaction({
        appId: resolvedAppId,
        idempotencyKey,
        type: 'TRANSFER',
        environment: env,
        amount: distributeAmount,
        currency: 'CREDIT',
        reference: note,
        metadata: {
          distribution_by: 'MAINAPP_TREASURY',
          environment: env,
          note,
          target_account_id,
        },
        postings: [
          {
            walletId: treasuryWalletId,
            direction: 'DEBIT',
            amount: distributeAmount,
            description: `Débit Trésorerie Centrale pour dotation [${target_account_id || destinationWalletId}] (${env})`,
          },
          {
            walletId: destinationWalletId,
            direction: 'CREDIT',
            amount: distributeAmount,
            description: `Crédit de dotation Trésorerie: ${note} (${env})`,
          },
        ],
      });

      return reply.status(201).send({
        status: 'success',
        environment: env,
        message: `${distributeAmount} Crédits distribués depuis le Main Treasury vers ${target_account_id || destinationWalletId}`,
        transaction: result,
      });
    } catch (err: any) {
      return reply.status(400).send({ status: 'error', message: err.message });
    }
  });
}

