import { PoolClient } from 'pg';
import { query } from '../db/pool.js';
import { Environment } from '../types/index.js';

export class TransactionQuotaError extends Error {
  public statusCode: number;
  public code: string;
  public details?: any;

  constructor(message: string, code: string, statusCode = 400, details?: any) {
    super(message);
    this.name = 'TransactionQuotaError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

// In-memory sliding window rate limiter
const rateLimitWindows = new Map<string, number[]>();

export function checkRateLimit(appId: string, limitRpm: number): { allowed: boolean; retryAfter: number } {
  if (!limitRpm || limitRpm <= 0) return { allowed: true, retryAfter: 0 };

  const now = Date.now();
  const windowStart = now - 60000;
  const timestamps = (rateLimitWindows.get(appId) || []).filter((t) => t > windowStart);

  if (timestamps.length >= limitRpm) {
    const oldestInWindow = timestamps[0];
    const retryAfter = Math.ceil((oldestInWindow + 60000 - now) / 1000);
    return { allowed: false, retryAfter: Math.max(1, retryAfter) };
  }

  timestamps.push(now);
  rateLimitWindows.set(appId, timestamps);
  return { allowed: true, retryAfter: 0 };
}

/**
 * Verifie les quotas d'une application avant execution comptable :
 * 1. Plafond par transaction (max_amount_per_tx)
 * 2. Plafond journalier de volume sur 24h glissantes (daily_volume_limit)
 */
export async function enforceAppQuotas(
  appId: string,
  environment: Environment,
  amount: bigint,
  client?: PoolClient,
  metadata?: Record<string, any>
): Promise<void> {
  // Ignorer pour le master admin ou les opérations de seed administratif
  if (appId === 'system_master' || metadata?.admin_seed === true) return;

  const runQuery = client
    ? (sql: string, params: any[]) => client.query(sql, params).then((r) => r.rows)
    : (sql: string, params: any[]) => query(sql, params);

  // 1. Recuperer la configuration des quotas de l'application
  const apps = await runQuery(
    'SELECT max_amount_per_tx, daily_volume_limit FROM apps WHERE id = $1',
    [appId]
  );

  if (apps.length === 0) return;

  const app = apps[0];
  const maxPerTx = BigInt(app.max_amount_per_tx || 250000);
  const dailyLimit = BigInt(app.daily_volume_limit || 2000000);

  // A. Verification du montant unitaire
  if (amount > maxPerTx) {
    throw new TransactionQuotaError(
      `Montant de ${amount} AOA superieur au plafond autorise par transaction (${maxPerTx} AOA) pour cette application.`,
      'MAX_TRANSACTION_EXCEEDED',
      400,
      { amount: amount.toString(), max_per_tx: maxPerTx.toString() }
    );
  }

  // B. Verification du volume cumule sur 24h glissantes (hors opérations de trésorerie admin)
  const volResult = await runQuery(
    `SELECT COALESCE(SUM(amount), 0) as rolling_volume 
     FROM transactions 
     WHERE app_id = $1 AND environment = $2 AND status = 'SUCCESS' 
       AND (metadata->>'admin_seed' IS NULL OR metadata->>'admin_seed' != 'true')
       AND created_at >= NOW() - INTERVAL '24 HOURS'`,
    [appId, environment]
  );

  const current24hVolume = BigInt(volResult[0]?.rolling_volume || '0');
  if (current24hVolume + amount > dailyLimit) {
    throw new TransactionQuotaError(
      `Plafond journalier de ${dailyLimit} AOA depasse. Volume deja consomme sur 24h: ${current24hVolume} AOA, Montant tente: ${amount} AOA.`,
      'DAILY_VOLUME_EXCEEDED',
      400,
      {
        attempted_amount: amount.toString(),
        daily_limit: dailyLimit.toString(),
        consumed_24h: current24hVolume.toString(),
        remaining: (dailyLimit > current24hVolume ? dailyLimit - current24hVolume : 0n).toString(),
      }
    );
  }
}
