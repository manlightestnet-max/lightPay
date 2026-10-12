import crypto from 'crypto';
import { promisify } from 'util';
import { query } from './pool.js';
import { Environment } from '../types/index.js';

/**
 * The LightPay code: 6 digits, asked to confirm money leaving the wallet (send, withdraw, pay
 * with the wallet), on the phone and on the web. Mandatory (chosen after the @username).
 *
 *   - only a salted scrypt hash is stored (user_pins, production database: one code for real and test);
 *   - 5 wrong codes in a row lock it for 15 minutes (the count resets on a right code);
 *   - choosing it the first time: signed in; changing it: the current code, or a recent Google
 *     sign-in when it is forgotten.
 *
 * The code travels in the X-LightPay-Pin header (never in a body that could be stored).
 */

const ID_DB: Environment = 'production';
const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const MAX_PIN_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export class PinError extends Error {
  constructor(message: string, public code: string, public statusCode = 400, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

const WEAK = new Set(['000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999', '123456', '654321', '012345', '123123', '112233']);

/** 6 digits, not a trivial sequence. */
export function checkNewPin(raw: unknown): string {
  const pin = String(raw ?? '').trim();
  if (!/^\d{6}$/.test(pin)) throw new PinError('Le code doit faire 6 chiffres.', 'PIN_FORMAT');
  if (WEAK.has(pin)) throw new PinError('Code trop facile à deviner : évitez les suites et les chiffres répétés.', 'PIN_WEAK');
  return pin;
}

async function hash(pin: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pin, salt, 32);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function matches(pin: string, stored: string): Promise<boolean> {
  const [algo, salt, key] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const got = await scrypt(pin, Buffer.from(salt, 'base64'), expected.length);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

export async function hasPin(uid: string): Promise<boolean> {
  const [row] = await query(`SELECT 1 FROM user_pins WHERE uid = $1`, [uid], ID_DB);
  return Boolean(row);
}

/**
 * Chooses or changes the code. A change needs the current code, unless `recentSignIn` (forgotten
 * code: the person just signed in again with Google).
 */
export async function setPin(uid: string, raw: unknown, opts: { current?: unknown; recentSignIn: boolean }) {
  const pin = checkNewPin(raw);
  const [row] = await query(`SELECT pin_hash FROM user_pins WHERE uid = $1`, [uid], ID_DB);
  if (row && !opts.recentSignIn) {
    if (opts.current === undefined || opts.current === null || opts.current === '') {
      throw new PinError('Entrez votre code actuel, ou reconnectez-vous avec Google si vous l’avez oublié.', 'PIN_CURRENT_REQUIRED', 401);
    }
    await verifyPin(uid, opts.current);
  }
  await query(
    `INSERT INTO user_pins (uid, pin_hash) VALUES ($1, $2)
     ON CONFLICT (uid) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, failed_attempts = 0, locked_until = NULL, updated_at = NOW()`,
    [uid, await hash(pin)],
    ID_DB
  );
}

/** Throws unless `raw` is this person's code (and counts the wrong ones). */
export async function verifyPin(uid: string, raw: unknown): Promise<void> {
  const [row] = await query(`SELECT pin_hash, failed_attempts, locked_until FROM user_pins WHERE uid = $1`, [uid], ID_DB);
  if (!row) throw new PinError('Choisissez d’abord votre code LightPay à 6 chiffres.', 'PIN_NOT_SET', 428);
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    const minutes = Math.max(1, Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 60_000));
    throw new PinError(`Trop d’essais. Code bloqué pendant encore ${minutes} min.`, 'PIN_LOCKED', 423, { retry_in_minutes: minutes });
  }
  const pin = String(raw ?? '').trim();
  if (!/^\d{6}$/.test(pin)) throw new PinError('Entrez votre code LightPay à 6 chiffres.', 'PIN_REQUIRED', 401);
  if (await matches(pin, row.pin_hash)) {
    if (row.failed_attempts > 0 || row.locked_until) {
      await query(`UPDATE user_pins SET failed_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE uid = $1`, [uid], ID_DB);
    }
    return;
  }
  const failed = Number(row.failed_attempts ?? 0) + 1;
  if (failed >= MAX_PIN_ATTEMPTS) {
    await query(
      `UPDATE user_pins SET failed_attempts = 0, locked_until = NOW() + ($2 || ' minutes')::interval, updated_at = NOW() WHERE uid = $1`,
      [uid, String(LOCK_MINUTES)],
      ID_DB
    );
    throw new PinError(`Code incorrect. Trop d’essais : code bloqué ${LOCK_MINUTES} min.`, 'PIN_LOCKED', 423, { retry_in_minutes: LOCK_MINUTES });
  }
  await query(`UPDATE user_pins SET failed_attempts = $2, updated_at = NOW() WHERE uid = $1`, [uid, failed], ID_DB);
  const left = MAX_PIN_ATTEMPTS - failed;
  throw new PinError(`Code incorrect. ${left} essai${left > 1 ? 's' : ''} restant${left > 1 ? 's' : ''}.`, 'PIN_INVALID', 401, { attempts_left: left });
}

/** Account closed: the code goes with it. */
export async function removePin(uid: string) {
  await query(`DELETE FROM user_pins WHERE uid = $1`, [uid], ID_DB);
}
