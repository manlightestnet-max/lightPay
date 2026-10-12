import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Emergency brake of LightPay, set by the owner (Administration > Frein d'urgence). Five levels, each stricter than the last:
 *   off          normal.
 *   withdrawals  withdrawals are closed: people cannot withdraw, and every payout to a phone (refunds included) waits.
 *   payments     nothing moves: no deposit, payment, transfer, escrow movement or payout. Reading still works.
 *   readonly     payments frozen, and the database accepts no write.
 *   total        nothing touches the database: every request is answered "stopped" (the admin's own lock screen excepted).
 *
 * Two switches, the stricter wins:
 *   - the administration's switch, kept in `platform_lockdown` (production database, both ledgers), re-read every 5 seconds;
 *   - the environment variable LIGHTWALLET_LOCKDOWN (withdrawals | payments | readonly | total), which does not depend on
 *     the database at all: set to `total`, not one query reaches Neon. It is the lever when the database or an admin session
 *     may be compromised (change it on the host and redeploy).
 */
export type Level = 'off' | 'withdrawals' | 'payments' | 'readonly' | 'total';
export const LEVELS: Level[] = ['off', 'withdrawals', 'payments', 'readonly', 'total'];
export const rank = (l: Level) => LEVELS.indexOf(l);

export interface LockdownState {
  level: Level;
  reason: string;
  since: string | null;
  by: string | null;
}

const OFF: LockdownState = { level: 'off', reason: '', since: null, by: null };
const TTL = 5_000;

let stored: LockdownState = OFF;
let loadedAt = 0;

/** The level imposed by the environment (`1` / `true` mean total). */
export const envLevel = (): Level => {
  const v = (process.env.LIGHTWALLET_LOCKDOWN ?? '').trim().toLowerCase();
  if (v === '1' || v === 'true') return 'total';
  return (LEVELS as string[]).includes(v) ? (v as Level) : 'off';
};

/** The level in force now: the stricter of the environment and the administration's switch. */
export const levelNow = (): Level => (rank(envLevel()) >= rank(stored.level) ? envLevel() : stored.level);
export const stateNow = (): LockdownState & { forced: Level | null } => ({ ...stored, level: levelNow(), forced: envLevel() === 'off' ? null : envLevel() });
export const storedState = () => stored;
export const withdrawalsClosed = () => rank(levelNow()) >= rank('withdrawals');

// Code that must keep working while stopped (the lock screen of the administration) runs in a bypass scope.
const bypass = new AsyncLocalStorage<true>();
export const withBypass = <T>(fn: () => Promise<T>) => bypass.run(true, fn);
const bypassing = () => bypass.getStore() === true;

export class LockedError extends Error {
  statusCode = 503;
  code = 'LOCKED';
  constructor(
    message: string,
    readonly level: Level
  ) {
    super(message);
  }
}

const STOPPED = 'LightPay est momentanément arrêté pour une vérification de sécurité. Revenez dans quelques instants.';
const READONLY = 'LightPay est en lecture seule pour une vérification de sécurité : les modifications sont suspendues.';
const NO_MONEY = 'Les mouvements d’argent sont suspendus pour une vérification de sécurité. Réessayez dans quelques instants.';
const NO_WITHDRAWALS = 'Les retraits sont momentanément fermés. Réessayez dans quelques instants.';

export const lockedMessage = (level: Level) =>
  level === 'total' ? STOPPED : level === 'readonly' ? READONLY : level === 'payments' ? NO_MONEY : NO_WITHDRAWALS;

/** Reads the administration's switch again if it has not been read for a few seconds (the only query made while stopped). */
export async function refreshLockdown(): Promise<void> {
  if (envLevel() === 'total') return; // already total: the database is not even asked
  if (Date.now() - loadedAt < TTL) return;
  loadedAt = Date.now();
  try {
    const { query } = await import('../db/pool.js');
    const [row] = await withBypass(() => query(`SELECT state FROM platform_lockdown WHERE id = 1`, [], 'production'));
    stored = row ? { ...OFF, ...row.state } : OFF;
  } catch {
    // table not migrated yet, or the database is unreachable: the last known state stays
  }
}

/** Keeps this instance in step right away (the others catch up within seconds). */
export function setStored(state: LockdownState) {
  stored = state;
  loadedAt = Date.now();
}

const WRITE = /\b(insert\s+into|delete\s+from|truncate|alter\s+table|drop\s+table|create\s+table|nextval)\b|(?<!for\s)\bupdate\s+[a-z_"(]/i;

/** Every SQL statement passes here: nothing at all when total, nothing that writes when read-only. */
export function guardDatabase(sql: string): void {
  if (bypassing()) return;
  const level = levelNow();
  if (level === 'total') throw new LockedError(STOPPED, level);
  if (level === 'readonly' && WRITE.test(sql)) throw new LockedError(READONLY, level);
}

/** A transaction (always a write) is about to start. */
export function guardTransaction(): void {
  if (bypassing()) return;
  const level = levelNow();
  if (level === 'total') throw new LockedError(STOPPED, level);
  if (level === 'readonly') throw new LockedError(READONLY, level);
}

/** Anything that moves money (ledger, deposit, payout) stops at the `payments` level. */
export function guardMoney(): void {
  if (bypassing()) return;
  const level = levelNow();
  if (rank(level) >= rank('payments')) throw new LockedError(lockedMessage(level), level);
}

/** A person asks to withdraw: refused from the first level. */
export function guardWithdrawals(): void {
  if (bypassing()) return;
  const level = levelNow();
  if (rank(level) >= rank('withdrawals')) throw new LockedError(lockedMessage(level), level);
}
