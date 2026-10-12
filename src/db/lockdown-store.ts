import { query } from './pool.js';
import { LEVELS, Level, LockdownState, setStored, stateNow, withBypass } from '../security/lockdown.js';

/** The administration's emergency brake, kept in the production database for both ledgers (see security/lockdown.ts). */
export const readLockdown = () => withBypass(async () => stateNow());

export class LockdownError extends Error {
  code = 'INVALID_LOCKDOWN';
  statusCode = 400;
}

export async function saveLockdown(levelInput: unknown, reasonInput: unknown, by: string): Promise<{ before: LockdownState; after: LockdownState }> {
  const level = String(levelInput ?? '') as Level;
  if (!LEVELS.includes(level)) throw new LockdownError(`Niveau inconnu : ${LEVELS.join(', ')}.`);
  const reason = String(reasonInput ?? '').trim().slice(0, 300);
  if (level !== 'off' && !reason) throw new LockdownError('Indiquez la raison : elle reste dans le journal.');
  const before = stateNow();
  const next: LockdownState = { level, reason: level === 'off' ? '' : reason, since: level === 'off' ? null : new Date().toISOString(), by: level === 'off' ? null : by };
  await withBypass(() =>
    query(
      `INSERT INTO platform_lockdown (id, state, updated_by, updated_at) VALUES (1, $1::jsonb, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [JSON.stringify(next), by],
      'production'
    )
  );
  setStored(next);
  return { before, after: stateNow() };
}
