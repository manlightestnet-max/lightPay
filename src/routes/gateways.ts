import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { LedgerEngine } from '../db/ledger.js';
import { query } from '../db/pool.js';
import { Environment } from '../types/index.js';

export async function gatewayRoutes(fastify: FastifyInstance) {
  /**
   * 1. Webhook Officiel d'Agrégateur Externe (Règlement certifié)
   * Approvisionne obligatoirement le Main Treasury Wallet (100% Backed Reserve).
   */
  fastify.post('/webhook/:provider', async (request: FastifyRequest, reply: FastifyReply) => {
    const { provider } = request.params as { provider: string };
    const payload = (request.body as any) || {};
    const queryParams = (request.query as any) || {};

    // Détection de l'environnement : payload.environment ou query ?env=sandbox / ?env=production
    const rawEnv = payload.environment || queryParams.env || (payload.test_mode ? 'sandbox' : 'production');
    const environment: Environment = rawEnv === 'sandbox' ? 'sandbox' : 'production';

    const gatewayTxId = payload.transaction_id || payload.id || payload.tx_id || payload.reference;
    const amount = payload.amount;
    const paymentStatus = (payload.status || 'SUCCESS').toUpperCase();

    if (!gatewayTxId || !amount) {
      return reply.status(400).send({
        error: 'Champs requis manquants dans le webhook (transaction_id, amount)',
      });
    }

    if (paymentStatus !== 'SUCCESS' && paymentStatus !== 'COMPLETED' && paymentStatus !== 'PAID') {
      return reply.status(200).send({
        status: 'ignored',
        message: `Paiement ${paymentStatus}, aucun crédit alloué`,
      });
    }

    // L'encaissement externe est toujours rattaché au compte central 'mainapp'
    const appId = 'mainapp';

    const creditAmount = BigInt(amount);
    if (creditAmount <= 0n) {
      return reply.status(400).send({ error: 'Le montant doit être supérieur à zéro' });
    }

    // Garantir l'existence des deux comptes système : Transit Inflow et Main Treasury
    const treasuryWalletId = await LedgerEngine.getOrCreateMainTreasury('mainapp', environment, 'CREDIT');
    const gatewayInflowId = await LedgerEngine.getOrCreateGatewayInflow('mainapp', environment, 'CREDIT');

    const idempotencyKey = `GATEWAY_${provider.toUpperCase()}_${gatewayTxId}_${environment}`;

    try {
      const result = await LedgerEngine.executeTransaction({
        appId,
        idempotencyKey,
        type: 'COLLECTION',
        environment,
        amount: creditAmount,
        currency: 'CREDIT',
        reference: `SETTLE_${provider.toUpperCase()}_${gatewayTxId}`,
        metadata: {
          gateway_provider: provider.toUpperCase(),
          gateway_transaction_id: gatewayTxId,
          environment,
          raw_amount: amount.toString(),
          settled_at: new Date().toISOString(),
          customer: payload.customer || payload.phone || null,
        },
        postings: [
          {
            walletId: gatewayInflowId,
            direction: 'DEBIT',
            amount: creditAmount,
            description: `Règlement externe agrégateur [${provider.toUpperCase()}] - Tx: ${gatewayTxId} (${environment})`,
          },
          {
            walletId: treasuryWalletId,
            direction: 'CREDIT',
            amount: creditAmount,
            description: `Approvisionnement Réserve Main Treasury via [${provider.toUpperCase()}] (${environment})`,
          },
        ],
      });

      return reply.status(result.duplicate ? 200 : 201).send({
        status: 'success',
        provider: provider.toUpperCase(),
        message: `Main Treasury Wallet approvisionné de ${creditAmount} Crédits via ${provider.toUpperCase()}`,
        ...result,
      });
    } catch (err: any) {
      return reply.status(400).send({
        status: 'error',
        error: err.message,
      });
    }
  });
}
