import crypto from 'crypto';

/**
 * Identities that no one can register or reach with a key stored in the database.
 * `mainapp` owns every customer wallet: whoever controls it controls everything.
 */
export const RESERVED_APP_IDS = new Set([
  'mainapp',
  'main_app',
  'system_master',
  'system',
  'admin',
  'root',
  'lightpay',
  'lightwallet',
  'treasury',
]);

export const isReservedAppId = (id: string) => RESERVED_APP_IDS.has(id.trim().toLowerCase());

/** Public app ids: lowercase, 3 to 50 chars, letters, digits, `_` and `-`. */
export const APP_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,49}$/;

/**
 * MAINAPP KEY — never stored in the database.
 * Only its scrypt hash lives in the server environment (`MAINAPP_KEY_HASH`); the raw
 * key (`sec_main_…`) stays with the operator. Without the variable, `mainapp` is locked.
 *
 * Hash format: scrypt$<N>$<r>$<p>$<salt hex>$<hash hex>
 */
export const MAINAPP_KEY_PREFIX = 'sec_main_';

const SCRYPT = { N: 2 ** 16, r: 8, p: 1, keyLength: 64 };
const maxmem = (N: number, r: number) => 256 * N * r; // 2x what scrypt needs

export function generateMainappKey(): { key: string; hash: string } {
  const key = `${MAINAPP_KEY_PREFIX}${crypto.randomBytes(48).toString('base64url')}`;
  return { key, hash: hashMainappKey(key) };
}

export function hashMainappKey(key: string): string {
  const salt = crypto.randomBytes(32);
  const { N, r, p, keyLength } = SCRYPT;
  const hash = crypto.scryptSync(key, salt, keyLength, { N, r, p, maxmem: maxmem(N, r) });
  return ['scrypt', N, r, p, salt.toString('hex'), hash.toString('hex')].join('$');
}

// A verified key is remembered by its SHA-256 only, so scrypt runs once per process.
let verifiedDigest: Buffer | null = null;
let verifiedFor: string | null = null;

// Brute-force brake: failed attempts in the last minute, process-wide.
const failures: number[] = [];
const MAX_FAILURES_PER_MINUTE = 5;

export type MainappVerdict = 'ok' | 'invalid' | 'locked' | 'throttled';

export function verifyMainappKey(key: string, storedHash = process.env.MAINAPP_KEY_HASH): MainappVerdict {
  if (!storedHash) return 'locked';
  if (!key.startsWith(MAINAPP_KEY_PREFIX)) return 'invalid';

  const digest = crypto.createHash('sha256').update(key).digest();
  if (verifiedDigest && verifiedFor === storedHash && crypto.timingSafeEqual(digest, verifiedDigest)) return 'ok';

  const now = Date.now();
  while (failures.length && now - failures[0] > 60_000) failures.shift();
  if (failures.length >= MAX_FAILURES_PER_MINUTE) return 'throttled';

  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return 'locked';
  const [, n, r, p, saltHex, hashHex] = parts;
  const N = Number(n);
  const R = Number(r);
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(key, Buffer.from(saltHex, 'hex'), expected.length, { N, r: R, p: Number(p), maxmem: maxmem(N, R) });

  if (actual.length === expected.length && crypto.timingSafeEqual(actual, expected)) {
    verifiedDigest = digest;
    verifiedFor = storedHash;
    return 'ok';
  }
  failures.push(now);
  return 'invalid';
}

/** Test helper: forget the cached key and the failure counter. */
export function resetMainappVerification() {
  verifiedDigest = null;
  verifiedFor = null;
  failures.length = 0;
}
