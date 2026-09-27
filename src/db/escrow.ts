import { PoolClient } from 'pg';
import { LedgerEngine } from './ledger.js';
import { query } from './pool.js';
import { Environment, HoldStatus } from '../types/index.js';

/**
 * ESCROW — money that has changed hands but is not yet usable.
 *
 *   hold     payer.AVAILABLE  --amount-->  beneficiary.LOCKED        (order paid)
 *   capture  beneficiary.LOCKED --amount-fee--> beneficiary.AVAILABLE (order validated)
 *                               --fee-->        fee wallet AVAILABLE
 *   release  beneficiary.LOCKED --amount--> payer.AVAILABLE          (order cancelled / refunded)
 *   dispute  status only: frozen until an explicit resolution (capture or release)
 *
 * Every move is a double-entry transaction; the hold row is locked and updated inside
 * the same DB transaction, so a hold can never be settled twice.
 */

export class EscrowError extends Error {
  constructor(message: string, public code: string, public statusCode = 400) {
    super(message);
  }
}

export interface HoldRecord {
  id: string;
  app_id: string;
  environment: Environment;
  wallet_id: string;
  payer_wallet_id: string;
  amount: string;
  fee_amount: string;
  currency: string;
  status: HoldStatus;
  reason: string | null;
  reference: string | null;
  metadata: Record<string, any>;
  expires_at: Date | null;
  hold_transaction_id: string | null;
  settle_transaction_id: string | null;
  settled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface Base {
  appId: string;
  environment: Environment;
  idempotencyKey: string;
}

export interface CreateHoldParams extends Base {
  payerWalletId: string;
  beneficiaryWalletId: string;
  amount: bigint;
  /** Platform commission taken at capture (kept by the platform, never by the beneficiary). */
  feeAmount?: bigint;
  currency?: string;
  reference?: string;
  reason?: string;
  metadata?: Record<string, any>;
  expiresAt?: Date;
  /** Internal checkout only (payer is a guest wallet). */
  allowGuestDebit?: boolean;
  /** Internal checkout only: the collection that funded this hold already counted. */
  skipQuotas?: boolean;
}

const lockHold = async (client: PoolClient, appId: string, environment: Environment, holdId: string): Promise<HoldRecord> => {
  const rows = await client.query('SELECT * FROM holds WHERE id = $1 AND app_id = $2 AND environment = $3 FOR UPDATE', [
    holdId,
    appId,
    environment,
  ]);
  if (rows.rows.length === 0) throw new EscrowError('Hold not found', 'HOLD_NOT_FOUND', 404);
  return rows.rows[0];
};

/** Settled holds cannot move again; disputed ones only on an explicit resolution. */
const assertSettleable = (hold: HoldRecord, resolveDispute: boolean) => {
  if (hold.status === 'CAPTURED' || hold.status === 'RELEASED') {
    throw new EscrowError(`Hold already ${hold.status.toLowerCase()}`, 'HOLD_ALREADY_SETTLED', 409);
  }
  if (hold.status === 'DISPUTED' && !resolveDispute) {
    throw new EscrowError('Hold is disputed: pass resolve_dispute=true to settle it', 'HOLD_DISPUTED', 409);
  }
};

export const getHold = async (appId: string, environment: Environment, holdId: string): Promise<HoldRecord | undefined> =>
  (await query('SELECT * FROM holds WHERE id = $1 AND app_id = $2 AND environment = $3', [holdId, appId, environment], environment))[0];

const holdByTransaction = async (environment: Environment, transactionId: string): Promise<HoldRecord | undefined> =>
  (await query('SELECT * FROM holds WHERE hold_transaction_id = $1', [transactionId], environment))[0];

export class Escrow {
  /** Payer pays; the beneficiary receives the money locked. */
  static async create(p: CreateHoldParams) {
    const fee = p.feeAmount ?? 0n;
    if (p.amount <= 0n) throw new EscrowError('Amount must be greater than zero', 'INVALID_AMOUNT');
    if (fee < 0n || fee >= p.amount) throw new EscrowError('Fee must be non-negative and less than amount', 'INVALID_FEE');
    if (p.payerWalletId === p.beneficiaryWalletId) throw new EscrowError('Payer and beneficiary must differ', 'SAME_WALLET');

    let holdId: string | undefined;
    const result = await LedgerEngine.executeTransaction({
      appId: p.appId,
      environment: p.environment,
      idempotencyKey: p.idempotencyKey,
      type: 'HOLD',
      allowGuestDebit: p.allowGuestDebit,
      skipQuotas: p.skipQuotas,
      amount: p.amount,
      feeAmount: fee,
      currency: p.currency,
      reference: p.reference,
      metadata: p.metadata,
      postings: [
        { walletId: p.payerWalletId, direction: 'DEBIT', amount: p.amount, description: `Escrow payment - Ref: ${p.reference ?? 'N/A'}` },
        {
          walletId: p.beneficiaryWalletId,
          direction: 'CREDIT',
          bucket: 'LOCKED',
          amount: p.amount,
          description: `Escrow funds locked - Ref: ${p.reference ?? 'N/A'}`,
        },
      ],
      finalize: async (client, transactionId) => {
        const inserted = await client.query(
          `INSERT INTO holds (app_id, environment, wallet_id, payer_wallet_id, amount, fee_amount, currency, status, reason, reference, metadata, expires_at, hold_transaction_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8, $9, $10, $11, $12) RETURNING id`,
          [
            p.appId,
            p.environment,
            p.beneficiaryWalletId,
            p.payerWalletId,
            p.amount.toString(),
            fee.toString(),
            p.currency ?? 'CREDIT',
            p.reason ?? null,
            p.reference ?? null,
            JSON.stringify(p.metadata ?? {}),
            p.expiresAt ?? null,
            transactionId,
          ]
        );
        holdId = inserted.rows[0].id;
      },
    });

    // A replayed request returns the hold created the first time.
    const hold = holdId
      ? await getHold(p.appId, p.environment, holdId)
      : await holdByTransaction(p.environment, (result as any).transaction?.id ?? (result as any).transactionId);
    return { ...result, hold };
  }

  /** Validation: the beneficiary gets the money (minus the platform fee) as available. */
  static async capture(p: Base & { holdId: string; feeWalletId?: string; resolveDispute?: boolean }) {
    return Escrow.settle(p, 'capture');
  }

  /** Cancellation / refund: the payer gets the full amount back as available. */
  static async release(p: Base & { holdId: string; resolveDispute?: boolean }) {
    return Escrow.settle(p, 'release');
  }

  private static async settle(p: Base & { holdId: string; feeWalletId?: string; resolveDispute?: boolean }, kind: 'capture' | 'release') {
    // Amounts and wallets come from the hold itself, never from the caller.
    const snapshot = await getHold(p.appId, p.environment, p.holdId);
    if (!snapshot) throw new EscrowError('Hold not found', 'HOLD_NOT_FOUND', 404);
    const amount = BigInt(snapshot.amount);
    const fee = BigInt(snapshot.fee_amount);
    const ref = snapshot.reference ?? snapshot.id;

    if (kind === 'capture' && fee > 0n && !p.feeWalletId) {
      throw new EscrowError('fee_wallet_id is required to capture a hold with a fee', 'FEE_WALLET_REQUIRED');
    }

    const postings =
      kind === 'capture'
        ? [
            { walletId: snapshot.wallet_id, direction: 'DEBIT' as const, bucket: 'LOCKED' as const, amount, description: `Escrow captured - Ref: ${ref}` },
            { walletId: snapshot.wallet_id, direction: 'CREDIT' as const, amount: amount - fee, description: `Escrow funds available - Ref: ${ref}` },
            ...(fee > 0n ? [{ walletId: p.feeWalletId!, direction: 'CREDIT' as const, amount: fee, description: `Platform fee - Ref: ${ref}` }] : []),
          ]
        : [
            { walletId: snapshot.wallet_id, direction: 'DEBIT' as const, bucket: 'LOCKED' as const, amount, description: `Escrow released - Ref: ${ref}` },
            { walletId: snapshot.payer_wallet_id, direction: 'CREDIT' as const, amount, description: `Escrow refund - Ref: ${ref}` },
          ];

    const result = await LedgerEngine.executeTransaction({
      appId: p.appId,
      environment: p.environment,
      idempotencyKey: p.idempotencyKey,
      type: kind === 'capture' ? 'HOLD_CAPTURE' : 'HOLD_RELEASE',
      amount,
      feeAmount: kind === 'capture' ? fee : 0n,
      currency: snapshot.currency,
      reference: snapshot.reference ?? undefined,
      metadata: { hold_id: snapshot.id },
      skipQuotas: true,
      postings,
      prepare: async (client) => {
        // Re-read under lock: the snapshot may be stale if two settlements race.
        assertSettleable(await lockHold(client, p.appId, p.environment, p.holdId), Boolean(p.resolveDispute));
      },
      finalize: async (client, transactionId) => {
        await client.query(
          `UPDATE holds SET status = $1, settle_transaction_id = $2, settled_at = NOW(), updated_at = NOW() WHERE id = $3`,
          [kind === 'capture' ? 'CAPTURED' : 'RELEASED', transactionId, p.holdId]
        );
      },
    });

    return { ...result, hold: await getHold(p.appId, p.environment, p.holdId) };
  }

  /** Litigation: freezes the hold. No money moves; only a resolution (capture/release) unfreezes it. */
  static async dispute(p: Omit<Base, 'idempotencyKey'> & { holdId: string; reason?: string }) {
    const rows = await query(
      `UPDATE holds SET status = 'DISPUTED', reason = COALESCE($4, reason), updated_at = NOW()
       WHERE id = $1 AND app_id = $2 AND environment = $3 AND status IN ('ACTIVE', 'DISPUTED')
       RETURNING *`,
      [p.holdId, p.appId, p.environment, p.reason ?? null],
      p.environment
    );
    if (rows.length === 0) {
      const hold = await getHold(p.appId, p.environment, p.holdId);
      if (!hold) throw new EscrowError('Hold not found', 'HOLD_NOT_FOUND', 404);
      throw new EscrowError(`Hold already ${hold.status.toLowerCase()}`, 'HOLD_ALREADY_SETTLED', 409);
    }
    return { hold: rows[0] as HoldRecord };
  }

  /** Holds of an app, optionally for one wallet (as payer or beneficiary) and/or a status. */
  static async list(p: Omit<Base, 'idempotencyKey'> & { walletId?: string; status?: HoldStatus; reference?: string; limit?: number }) {
    const where = ['app_id = $1', 'environment = $2'];
    const params: any[] = [p.appId, p.environment];
    if (p.walletId) {
      params.push(p.walletId);
      where.push(`(wallet_id = $${params.length} OR payer_wallet_id = $${params.length})`);
    }
    if (p.status) {
      params.push(p.status);
      where.push(`status = $${params.length}`);
    }
    if (p.reference) {
      params.push(p.reference);
      where.push(`reference = $${params.length}`);
    }
    params.push(Math.min(Math.max(p.limit ?? 50, 1), 200));
    return query(
      `SELECT * FROM holds WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
      p.environment
    ) as Promise<HoldRecord[]>;
  }
}
