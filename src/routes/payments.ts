import { FastifyInstance } from 'fastify';
import { requireAppAuth } from '../middleware/app-auth.js';
import { LedgerEngine, LedgerPosting } from '../db/ledger.js';
import { query } from '../db/pool.js';

export async function paymentRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAppAuth);

  /**
   * 1. Paiement Universel avec Split (Split Payment Atomique)
   * Débite l'acheteur, crédite le vendeur et crédite la commission plateforme en 1 seule transaction ACID.
   */
  fastify.post('/process', async (request, reply) => {
    const appId = request.appData!.id;
    const environment = request.appData!.environment || 'production';
    const idempotencyKey = (request.headers['idempotency-key'] as string) || request.idempotencyKey;

    if (!idempotencyKey) {
      return reply.status(400).send({ error: 'Missing required header: Idempotency-Key' });
    }

    const {
      source_wallet_id,
      destination_wallet_id,
      platform_fee_wallet_id,
      amount,
      fee_amount = 0,
      currency = 'CREDIT',
      reference,
      metadata = {},
    } = request.body as any;

    if (!source_wallet_id || !destination_wallet_id || !amount) {
      return reply.status(400).send({
        error: 'Missing required fields: source_wallet_id, destination_wallet_id, amount',
      });
    }

    const totalAmount = BigInt(amount);
    const fee = BigInt(fee_amount);

    if (totalAmount <= 0n) {
      return reply.status(400).send({ error: 'Amount must be greater than zero' });
    }

    if (fee < 0n || fee >= totalAmount) {
      return reply.status(400).send({ error: 'Fee amount must be non-negative and less than total amount' });
    }

    const sellerAmount = totalAmount - fee;

    // Construction des écritures comptables en partie double
    const postings: LedgerPosting[] = [
      // Débit de l'acheteur
      {
        walletId: source_wallet_id,
        direction: 'DEBIT',
        amount: totalAmount,
        description: `Payment debit - Ref: ${reference || 'N/A'} (${environment})`,
      },
      // Crédit du vendeur
      {
        walletId: destination_wallet_id,
        direction: 'CREDIT',
        amount: sellerAmount,
        description: `Payment credit (net of fees) - Ref: ${reference || 'N/A'} (${environment})`,
      },
    ];

    // Si une commission de plateforme est définie
    if (fee > 0n) {
      if (!platform_fee_wallet_id) {
        return reply.status(400).send({
          error: 'platform_fee_wallet_id is required when fee_amount is greater than zero',
        });
      }
      postings.push({
        walletId: platform_fee_wallet_id,
        direction: 'CREDIT',
        amount: fee,
        description: `Platform fee deduction - Ref: ${reference || 'N/A'} (${environment})`,
      });
    }

    try {
      const result = await LedgerEngine.executeTransaction({
        appId,
        idempotencyKey,
        type: 'PAYMENT',
        environment,
        amount: totalAmount,
        feeAmount: fee,
        currency,
        reference,
        metadata,
        postings,
      });

      return reply.status(result.duplicate ? 200 : 201).send({
        status: 'success',
        ...result,
      });
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        status: 'error',
        error: err.code || 'TRANSACTION_ERROR',
        message: err.message,
        details: err.details,
      });
    }
  });

  /**
   * 2. Virement direct simple entre deux portefeuilles quelconques (P2P instantané)
   */
  fastify.post('/transfer', async (request, reply) => {
    const appId = request.appData!.id;
    const environment = request.appData!.environment || 'production';
    const idempotencyKey = (request.headers['idempotency-key'] as string) || request.idempotencyKey;

    if (!idempotencyKey) {
      return reply.status(400).send({ error: 'Missing required header: Idempotency-Key' });
    }

    let { from_wallet_id, to_wallet_id, from_account_id, to_account_id, amount, currency = 'CREDIT', note, metadata = {} } = request.body as any;

    if (!amount) {
      return reply.status(400).send({ error: 'Missing required field: amount' });
    }

    // Résolution automatique par account_id dans l'environnement courant
    if (!from_wallet_id && from_account_id) {
      const fromWallet = await query(
        'SELECT id FROM wallets WHERE app_id = $1 AND account_id = $2 AND currency = $3 AND environment = $4',
        [appId, from_account_id, currency, environment],
        environment
      );
      if (fromWallet.length === 0) {
        return reply.status(404).send({ error: `Sender wallet not found for account: ${from_account_id} in ${environment}` });
      }
      from_wallet_id = fromWallet[0].id;
    }

    if (!to_wallet_id && to_account_id) {
      const toWallet = await query(
        'SELECT id FROM wallets WHERE app_id = $1 AND account_id = $2 AND currency = $3 AND environment = $4',
        [appId, to_account_id, currency, environment],
        environment
      );
      if (toWallet.length === 0) {
        return reply.status(404).send({ error: `Recipient wallet not found for account: ${to_account_id} in ${environment}` });
      }
      to_wallet_id = toWallet[0].id;
    }

    if (!from_wallet_id || !to_wallet_id) {
      return reply.status(400).send({
        error: 'Missing required sender or recipient (provide from_wallet_id/to_wallet_id or from_account_id/to_account_id)',
      });
    }

    const transferAmount = BigInt(amount);
    if (transferAmount <= 0n) {
      return reply.status(400).send({ error: 'Amount must be greater than zero' });
    }

    const postings: LedgerPosting[] = [
      {
        walletId: from_wallet_id,
        direction: 'DEBIT',
        amount: transferAmount,
        description: `Direct transfer out: ${note || 'N/A'} (${environment})`,
      },
      {
        walletId: to_wallet_id,
        direction: 'CREDIT',
        amount: transferAmount,
        description: `Direct transfer in: ${note || 'N/A'} (${environment})`,
      },
    ];

    try {
      const result = await LedgerEngine.executeTransaction({
        appId,
        idempotencyKey,
        type: 'TRANSFER',
        environment,
        amount: transferAmount,
        currency,
        reference: note,
        metadata,
        postings,
      });

      return reply.status(result.duplicate ? 200 : 201).send({
        status: 'success',
        ...result,
      });
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        status: 'error',
        error: err.code || 'TRANSACTION_ERROR',
        message: err.message,
        details: err.details,
      });
    }
  });

  /**
   * 3. Remboursement intégral d'un paiement passé
   */
  fastify.post('/refund', async (request, reply) => {
    const appId = request.appData!.id;
    const environment = request.appData!.environment || 'production';
    const idempotencyKey = (request.headers['idempotency-key'] as string) || request.idempotencyKey;

    if (!idempotencyKey) {
      return reply.status(400).send({ error: 'Missing required header: Idempotency-Key' });
    }

    const { transaction_id, reason } = request.body as any;

    if (!transaction_id) {
      return reply.status(400).send({ error: 'Missing required field: transaction_id' });
    }

    // Récupérer la transaction originale
    const tx = await query(
      'SELECT id, type, amount, currency, status, environment FROM transactions WHERE id = $1 AND app_id = $2 AND environment = $3',
      [transaction_id, appId, environment],
      environment
    );

    if (tx.length === 0) {
      return reply.status(404).send({ error: 'Original transaction not found in this environment' });
    }

    if (tx[0].status !== 'SUCCESS') {
      return reply.status(400).send({ error: `Cannot refund transaction with status: ${tx[0].status}` });
    }

    // Récupérer les écritures d'origine pour inverser
    const originalPostings = await query(
      'SELECT wallet_id, direction, amount FROM ledger_entries WHERE transaction_id = $1',
      [transaction_id],
      environment
    );

    const inversePostings: LedgerPosting[] = originalPostings.map((p: any) => ({
      walletId: p.wallet_id,
      direction: p.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
      amount: BigInt(p.amount),
      description: `Refund for Tx ${transaction_id}: ${reason || 'Customer refund'} (${environment})`,
    }));

    try {
      const result = await LedgerEngine.executeTransaction({
        appId,
        idempotencyKey,
        type: 'REFUND',
        environment,
        amount: BigInt(tx[0].amount),
        currency: tx[0].currency,
        reference: `REFUND_${transaction_id}`,
        metadata: { original_transaction_id: transaction_id, reason },
        postings: inversePostings,
      });

      return reply.status(result.duplicate ? 200 : 201).send({
        status: 'success',
        message: 'Transaction refunded successfully',
        ...result,
      });
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        status: 'error',
        error: err.code || 'TRANSACTION_ERROR',
        message: err.message,
        details: err.details,
      });
    }
  });
}
