import { PoolClient } from 'pg';
import { getClient, query } from './pool.js';
import { LedgerDirection, TransactionType, Environment } from '../types/index.js';
import { enforceAppQuotas } from '../middleware/quota-enforcer.js';

export interface LedgerPosting {
  walletId: string;
  direction: LedgerDirection;
  amount: bigint;
  description?: string;
}

export interface ExecuteTransactionParams {
  appId: string;
  idempotencyKey: string;
  type: TransactionType;
  environment?: Environment;
  amount: bigint;
  feeAmount?: bigint;
  currency?: string;
  reference?: string;
  metadata?: Record<string, any>;
  postings: LedgerPosting[];
}

export class LedgerEngine {
  /**
   * Exécute une transaction atomique en partie double.
   * Vérifie strictement que la somme des Débits est égale à la somme des Crédits (Sum = 0).
   * Isole strictement les opérations entre Sandbox et Production.
   */
  static async executeTransaction(params: ExecuteTransactionParams) {
    const {
      appId,
      idempotencyKey,
      type,
      environment = 'production',
      amount,
      feeAmount = 0n,
      currency = 'CREDIT',
      reference,
      metadata = {},
      postings,
    } = params;

    // 1. Vérification de l'équilibre comptable : Total Débits == Total Crédits
    let totalDebit = 0n;
    let totalCredit = 0n;

    for (const post of postings) {
      if (post.amount <= 0n) {
        throw new Error(`Invalid posting amount: ${post.amount}. Must be positive.`);
      }
      if (post.direction === 'DEBIT') {
        totalDebit += post.amount;
      } else if (post.direction === 'CREDIT') {
        totalCredit += post.amount;
      }
    }

    if (totalDebit !== totalCredit) {
      throw new Error(
        `Ledger imbalance: Total DEBIT (${totalDebit}) does not equal Total CREDIT (${totalCredit}). Transaction aborted.`
      );
    }

    const client: PoolClient = await getClient(environment);

    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');

      // 2. Vérification Idempotence dans l'environnement spécifique
      const existingTx = await client.query(
        'SELECT id, status, amount, fee_amount, environment, created_at FROM transactions WHERE app_id = $1 AND idempotency_key = $2 AND environment = $3',
        [appId, idempotencyKey, environment]
      );

      if (existingTx.rows.length > 0) {
        await client.query('COMMIT');
        return {
          duplicate: true,
          environment,
          transaction: existingTx.rows[0],
        };
      }

      // 3. Vérification stricte des limites et quotas d'application (Plafond unitaire + Plafond journalier)
      await enforceAppQuotas(appId, environment, amount, client, metadata);

      // 4. Création de la transaction avec tag environnement
      const txResult = await client.query(
        `INSERT INTO transactions (app_id, idempotency_key, type, environment, amount, fee_amount, currency, status, reference, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8, $9)
         RETURNING id`,
        [
          appId,
          idempotencyKey,
          type,
          environment,
          amount.toString(),
          feeAmount.toString(),
          currency,
          reference,
          JSON.stringify(metadata),
        ]
      );
      const transactionId = txResult.rows[0].id;

      // 4. Verrouillage et mise à jour des wallets ordonnés (pour éviter tout deadlock)
      const sortedPostings = [...postings].sort((a, b) => a.walletId.localeCompare(b.walletId));

      for (const post of sortedPostings) {
        // Verrouillage de la ligne du wallet en cours avec vérification d'isolation
        const walletQuery = await client.query(
          'SELECT id, account_id, available_balance, status, account_type, environment, app_id FROM wallets WHERE id = $1 FOR UPDATE',
          [post.walletId]
        );

        if (walletQuery.rows.length === 0) {
          throw new Error(`Wallet not found: ${post.walletId}`);
        }

        const wallet = walletQuery.rows[0];
        if (wallet.status !== 'ACTIVE') {
          throw new Error(`Wallet is ${wallet.status}: ${post.walletId}`);
        }

        // Vérification d'appartenance: le wallet doit appartenir à appId SAUF s'il s'agit d'un compte SYSTEM,
        // ou d'une opération centrale ordonnée par 'mainapp', ou d'un encaissement sur un compte 'mainapp'
        if (appId !== 'mainapp' && wallet.account_type !== 'SYSTEM' && wallet.app_id !== appId && wallet.app_id !== 'mainapp') {
          throw new Error(`Wallet ${post.walletId} does not belong to app ${appId}`);
        }

        // Vérification stricte d'isolation Sandbox vs Production
        if (wallet.environment !== environment) {
          throw new Error(
            `Environment mismatch: Wallet ${post.walletId} is in ${wallet.environment} but transaction is in ${environment}`
          );
        }

        const currentBalance = BigInt(wallet.available_balance);
        let newBalance = currentBalance;

        if (post.direction === 'DEBIT') {
          // SYSTEM_MAIN_TREASURY ne peut JAMAIS être à découvert : tout transfert doit être adossé
          const isMainTreasury = wallet.account_id === 'SYSTEM_MAIN_TREASURY';
          const isStrictBalance = wallet.account_type !== 'SYSTEM' || isMainTreasury;

          if (isStrictBalance && currentBalance < post.amount) {
            throw new Error(
              isMainTreasury
                ? `INSUFFICIENT_TREASURY_LIQUIDITY: La réserve du Main Treasury Wallet est insuffisante (${currentBalance} disponible, ${post.amount} requis). Aucun découvert autorisé.`
                : `Insufficient funds in wallet ${post.walletId}. Available: ${currentBalance}, Required: ${post.amount}`
            );
          }
          newBalance = currentBalance - post.amount;
        } else {
          newBalance = currentBalance + post.amount;
        }

        // Mise à jour du solde du wallet
        await client.query(
          'UPDATE wallets SET available_balance = $1, updated_at = NOW() WHERE id = $2',
          [newBalance.toString(), post.walletId]
        );

        // Inscription immuable dans le grand livre (Ledger Entry) avec tag environnement
        await client.query(
          `INSERT INTO ledger_entries (transaction_id, wallet_id, direction, environment, amount, balance_before, balance_after, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            transactionId,
            post.walletId,
            post.direction,
            environment,
            post.amount.toString(),
            currentBalance.toString(),
            newBalance.toString(),
            post.description || null,
          ]
        );
      }

      // 5. Finalisation avec succès de la transaction
      await client.query(
        "UPDATE transactions SET status = 'SUCCESS', completed_at = NOW() WHERE id = $1",
        [transactionId]
      );

      await client.query('COMMIT');

      return {
        duplicate: false,
        transactionId,
        environment,
        status: 'SUCCESS',
        amount: amount.toString(),
        currency,
      };
    } catch (err: any) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Obtient ou crée le portefeuille de Trésorerie Centrale (SYSTEM_MAIN_TREASURY)
   * pour l'application et l'environnement donnés.
   */
  static async getOrCreateMainTreasury(appId = 'mainapp', environment: Environment, currency = 'CREDIT'): Promise<string> {
    const existing = await query(
      `SELECT id FROM wallets WHERE app_id = $1 AND account_id = 'SYSTEM_MAIN_TREASURY' AND currency = $2 AND environment = $3 LIMIT 1`,
      [appId, currency, environment],
      environment
    );
    if (existing.length > 0) {
      return existing[0].id;
    }
    const created = await query(
      `INSERT INTO wallets (app_id, account_id, account_type, currency, environment, metadata)
       VALUES ($1, 'SYSTEM_MAIN_TREASURY', 'SYSTEM', $2, $3, '{"role":"main_treasury_reserve","desc":"Coffre-fort central de liquidité adossé aux encaissements réels"}')
       ON CONFLICT (app_id, account_id, currency, environment) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [appId, currency, environment],
      environment
    );
    return created[0].id;
  }

  /**
   * Obtient ou crée le compte miroir externe d'encaissement agrégateur (SYSTEM_GATEWAY_INFLOW)
   */
  static async getOrCreateGatewayInflow(appId = 'mainapp', environment: Environment, currency = 'CREDIT'): Promise<string> {
    const existing = await query(
      `SELECT id FROM wallets WHERE app_id = $1 AND account_id = 'SYSTEM_GATEWAY_INFLOW' AND currency = $2 AND environment = $3 LIMIT 1`,
      [appId, currency, environment],
      environment
    );
    if (existing.length > 0) {
      return existing[0].id;
    }
    const created = await query(
      `INSERT INTO wallets (app_id, account_id, account_type, currency, environment, metadata)
       VALUES ($1, 'SYSTEM_GATEWAY_INFLOW', 'SYSTEM', $2, $3, '{"role":"gateway_inflow_transit","desc":"Transit comptable des règlements agrégateurs externes"}')
       ON CONFLICT (app_id, account_id, currency, environment) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [appId, currency, environment],
      environment
    );
    return created[0].id;
  }
}
