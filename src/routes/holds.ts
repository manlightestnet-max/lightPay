import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAppAuth } from '../middleware/app-auth.js';
import { Escrow, EscrowError, getHold } from '../db/escrow.js';
import { HoldStatus } from '../types/index.js';
import { merchantWallet, refundGuestPayer } from '../db/checkout.js';

const HOLD_STATUSES: HoldStatus[] = ['ACTIVE', 'DISPUTED', 'CAPTURED', 'RELEASED'];

const context = (request: FastifyRequest) => ({
  appId: request.appData!.id,
  environment: request.appData!.environment || 'production',
});

const idempotencyOf = (request: FastifyRequest) => (request.headers['idempotency-key'] as string) || request.idempotencyKey;

const fail = (reply: FastifyReply, err: any) =>
  reply.status(err instanceof EscrowError ? err.statusCode : err.statusCode || 400).send({
    status: 'error',
    error: err.code || 'ESCROW_ERROR',
    message: err.message,
    details: err.details,
  });

/**
 * Escrow API (séquestre). The platform's backend pays a seller with locked funds, then
 * captures them to the seller or releases them back to the buyer.
 */
export async function holdRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAppAuth);

  /** Pay into escrow: payer available -> beneficiary locked. */
  fastify.post('/', async (request, reply) => {
    const idempotencyKey = idempotencyOf(request);
    if (!idempotencyKey) return reply.status(400).send({ error: 'Missing required header: Idempotency-Key' });

    const { payer_wallet_id, beneficiary_wallet_id, amount, fee_amount = 0, currency, reference, reason, metadata, expires_at } = (request.body ?? {}) as any;
    if (!payer_wallet_id || !beneficiary_wallet_id || !amount) {
      return reply.status(400).send({ error: 'Missing required fields: payer_wallet_id, beneficiary_wallet_id, amount' });
    }

    try {
      const result = await Escrow.create({
        ...context(request),
        idempotencyKey,
        payerWalletId: payer_wallet_id,
        beneficiaryWalletId: beneficiary_wallet_id,
        amount: BigInt(amount),
        feeAmount: BigInt(fee_amount),
        currency,
        reference,
        reason,
        metadata,
        expiresAt: expires_at ? new Date(expires_at) : undefined,
      });
      return reply.status(result.duplicate ? 200 : 201).send({ status: 'success', ...result });
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** List holds (filters: wallet_id as payer or beneficiary, status, reference). */
  fastify.get('/', async (request, reply) => {
    const { wallet_id, status, reference, limit } = request.query as any;
    if (status && !HOLD_STATUSES.includes(status)) return reply.status(400).send({ error: `status must be one of ${HOLD_STATUSES.join(', ')}` });
    const holds = await Escrow.list({ ...context(request), walletId: wallet_id, status, reference, limit: limit ? Number(limit) : undefined });
    return { status: 'success', holds };
  });

  fastify.get('/:hold_id', async (request, reply) => {
    const { appId, environment } = context(request);
    const hold = await getHold(appId, environment, (request.params as any).hold_id);
    if (!hold) return reply.status(404).send({ error: 'Hold not found' });
    return { status: 'success', hold };
  });

  /** Validate: beneficiary locked -> available (minus fee, credited to fee_wallet_id). */
  fastify.post('/:hold_id/capture', async (request, reply) => {
    const idempotencyKey = idempotencyOf(request);
    if (!idempotencyKey) return reply.status(400).send({ error: 'Missing required header: Idempotency-Key' });
    const { fee_wallet_id, resolve_dispute } = (request.body ?? {}) as any;
    try {
      const { appId, environment } = context(request);
      const hold = await getHold(appId, environment, (request.params as any).hold_id);
      // The platform fee goes to the app's own merchant wallet unless another is given.
      const feeWalletId = fee_wallet_id || (hold && BigInt(hold.fee_amount) > 0n ? await merchantWallet(appId, environment, hold.currency) : undefined);
      const result = await Escrow.capture({
        ...context(request),
        idempotencyKey,
        holdId: (request.params as any).hold_id,
        feeWalletId,
        resolveDispute: resolve_dispute === true,
      });
      return reply.status(result.duplicate ? 200 : 201).send({ status: 'success', ...result });
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** Refund: beneficiary locked -> payer available. */
  fastify.post('/:hold_id/release', async (request, reply) => {
    const idempotencyKey = idempotencyOf(request);
    if (!idempotencyKey) return reply.status(400).send({ error: 'Missing required header: Idempotency-Key' });
    const { resolve_dispute } = (request.body ?? {}) as any;
    try {
      const result = await Escrow.release({
        ...context(request),
        idempotencyKey,
        holdId: (request.params as any).hold_id,
        resolveDispute: resolve_dispute === true,
      });
      // A guest payer gets the money back on the number that paid (idempotent).
      const refund = result.hold?.status === 'RELEASED' ? await refundGuestPayer(result.hold) : null;
      return reply.status(result.duplicate ? 200 : 201).send({ status: 'success', ...result, refund });
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** Litigation: freeze the hold until a resolution. */
  fastify.post('/:hold_id/dispute', async (request, reply) => {
    const { reason } = (request.body ?? {}) as any;
    try {
      const result = await Escrow.dispute({ ...context(request), holdId: (request.params as any).hold_id, reason });
      return { status: 'success', ...result };
    } catch (err) {
      return fail(reply, err);
    }
  });
}
