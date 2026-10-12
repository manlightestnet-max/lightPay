import { query } from './pool.js';
import { Environment } from '../types/index.js';
import { ConnectError } from './connect.js';
import { controlSettings } from '../payments/control-settings.js';
import { notifyAccount } from '../notify/index.js';
import { ACCOUNT } from '../notify/catalog.js';

/**
 * Withdrawal attempts are counted per person: more than `withdrawal_max_attempts` in the last
 * `withdrawal_attempt_window_minutes` suspends the account (no withdrawal, no transfer) for
 * `withdrawal_suspension_minutes`. All three are set by the admin. Receiving money is never blocked.
 * A request replayed with the same Idempotency-Key (a double tap, a retry after re-authentication) counts once.
 */
const hhmm = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Brazzaville' });

export async function suspensionOf(env: Environment, uid: string) {
  const [row] = await query(`SELECT uid, email, until, kind, reason FROM withdrawal_suspensions WHERE uid = $1 AND until > NOW()`, [uid], env);
  return row as { uid: string; email: string | null; until: Date; kind: 'AUTO' | 'MANUAL'; reason: string | null } | undefined;
}

const suspendedError = (s: { until: Date; kind: string }) =>
  new ConnectError(
    s.kind === 'AUTO'
      ? `Trop de tentatives de retrait : retraits et envois suspendus jusqu’à ${hhmm(new Date(s.until))}. Réessayez ensuite.`
      : `Votre compte est suspendu pour les retraits et les envois jusqu’à ${hhmm(new Date(s.until))}. Contactez le support.`,
    'WITHDRAWALS_SUSPENDED',
    429
  );

/** The account is suspended: nothing leaves it until the end of the suspension. */
export async function assertNotSuspended(env: Environment, uid: string) {
  const s = await suspensionOf(env, uid);
  if (s) throw suspendedError(s);
}

/** One more attempt; past the limit the account is suspended and this very attempt is refused. */
export async function recordWithdrawalAttempt(env: Environment, user: { uid: string; email: string | null }, idemKey: string) {
  const s = controlSettings(env);
  if (s.withdrawal_max_attempts <= 0) return;
  const inserted = await query(`INSERT INTO withdrawal_attempts (uid, idem_key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id`, [user.uid, idemKey], env);
  if (!inserted.length) return; // the same request again
  const [{ n }] = await query(
    `SELECT COUNT(*)::int AS n FROM withdrawal_attempts WHERE uid = $1 AND created_at > NOW() - make_interval(mins => $2::int)`,
    [user.uid, s.withdrawal_attempt_window_minutes],
    env
  );
  if (n <= s.withdrawal_max_attempts) return;
  const [row] = await query(
    `INSERT INTO withdrawal_suspensions (uid, email, until, kind, reason)
     VALUES ($1, $2, NOW() + make_interval(mins => $3::int), 'AUTO', $4)
     ON CONFLICT (uid) DO UPDATE SET until = EXCLUDED.until, kind = 'AUTO', reason = EXCLUDED.reason, email = EXCLUDED.email, created_by = NULL, created_at = NOW()
     RETURNING until, kind`,
    [user.uid, user.email, s.withdrawal_suspension_minutes, `${n} tentatives de retrait en ${s.withdrawal_attempt_window_minutes} min (limite ${s.withdrawal_max_attempts})`],
    env
  );
  notifyAccount(env, user, ACCOUNT.withdrawalsSuspended(hhmm(new Date(row.until)), true), String(new Date(row.until).getTime()));
  throw suspendedError(row);
}

/** Old attempts are of no use: dropped by the sweeper. */
export const purgeOldAttempts = (env: Environment) => query(`DELETE FROM withdrawal_attempts WHERE created_at < NOW() - INTERVAL '2 days'`, [], env);

// ---------------------------------------------------------------- admin

export const listSuspensions = (env: Environment) =>
  query(`SELECT uid, email, until, kind, reason, created_by, created_at FROM withdrawal_suspensions WHERE until > NOW() ORDER BY created_at DESC LIMIT 200`, [], env);

export async function suspendAccount(env: Environment, target: { uid: string; email: string | null }, minutes: number, reason: string, by: string) {
  const [row] = await query(
    `INSERT INTO withdrawal_suspensions (uid, email, until, kind, reason, created_by)
     VALUES ($1, $2, NOW() + make_interval(mins => $3::int), 'MANUAL', $4, $5)
     ON CONFLICT (uid) DO UPDATE SET until = EXCLUDED.until, kind = 'MANUAL', reason = EXCLUDED.reason, email = EXCLUDED.email, created_by = EXCLUDED.created_by, created_at = NOW()
     RETURNING uid, email, until, kind, reason`,
    [target.uid, target.email, minutes, reason || null, by],
    env
  );
  notifyAccount(env, target, ACCOUNT.withdrawalsSuspended(hhmm(new Date(row.until)), false), String(new Date(row.until).getTime()));
  return row;
}

/** Ends the suspension and forgets the attempts that caused it, so the person starts clean. */
export async function liftSuspension(env: Environment, uid: string) {
  const gone = await query(`DELETE FROM withdrawal_suspensions WHERE uid = $1 RETURNING uid, email`, [uid], env);
  await query(`DELETE FROM withdrawal_attempts WHERE uid = $1`, [uid], env);
  return gone[0];
}
