import { FastifyInstance } from 'fastify';
import { verifySasPayWebhook } from '../payments/saspay.js';
import { resolveCollectionByProviderReference } from '../db/checkout.js';
import { findPayoutByProviderReference, resolvePayout } from '../db/payouts.js';

/**
 * Provider notifications. Authenticity is checked (HMAC + timestamp), then the payload is
 * only used as a hint: the operation is re-verified with the provider before any money
 * moves. Unknown ids are acknowledged (200) so the provider stops retrying.
 *   POST /v1/providers/saspay/webhook
 */
export async function providerRoutes(fastify: FastifyInstance) {
  fastify.post('/saspay/webhook', async (request, reply) => {
    const raw = (request as any).rawBody as string | undefined;
    const ok = verifySasPayWebhook(
      raw ?? '',
      request.headers['x-webhook-signature'] as string | undefined,
      request.headers['x-webhook-timestamp'] as string | undefined
    );
    if (!ok) return reply.status(401).send({ error: 'INVALID_SIGNATURE' });

    const event = String((request.body as any)?.event ?? request.headers['x-webhook-event'] ?? '');
    const id = String((request.body as any)?.data?.id ?? '');
    request.log.info({ event, id }, '[SASPAY] webhook');
    if (!id || !event.startsWith('transaction.')) return { received: true };

    try {
      if (!(await resolveCollectionByProviderReference(id))) {
        const payout = await findPayoutByProviderReference(id);
        if (payout) await resolvePayout(payout);
      }
    } catch (err: any) {
      // Provider will retry; the sweeper also catches up.
      request.log.error({ err: err?.message, id }, '[SASPAY] webhook resolution failed');
      return reply.status(503).send({ error: 'RETRY_LATER' });
    }
    return { received: true };
  });
}
