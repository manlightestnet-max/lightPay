import crypto from 'crypto';

/**
 * LightPay USER identity: Firebase ID tokens (RS256 JWT), verified server side.
 *
 *   iss = https://securetoken.google.com/<project>   aud = <project>
 *   sub = Firebase uid (the person), exp/iat checked, signature against Google's certs.
 *
 * Test mode (local only): LIGHTPAY_TEST_TOKEN_PUBLIC_KEY lets the test suite sign its own
 * tokens (issuer "lightpay-test"). It is refused when NODE_ENV=production.
 */

export interface LightPayUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  name: string | null;
  /** When the person last entered their password (seconds since epoch). */
  authTime: number;
}

export class UserTokenError extends Error {
  code = 'INVALID_USER_TOKEN';
}

const FIREBASE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const projectId = () => process.env.LIGHTPAY_FIREBASE_PROJECT_ID || 'lightpay-a5f01';

let certs: { keys: Record<string, crypto.KeyObject>; expiresAt: number } | null = null;

async function googleKeys(): Promise<Record<string, crypto.KeyObject>> {
  if (certs && certs.expiresAt > Date.now()) return certs.keys;
  const res = await fetch(FIREBASE_CERTS_URL, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new UserTokenError('Unable to load identity certificates');
  const body = (await res.json()) as Record<string, string>;
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  const keys: Record<string, crypto.KeyObject> = {};
  for (const [kid, pem] of Object.entries(body)) keys[kid] = new crypto.X509Certificate(pem).publicKey;
  certs = { keys, expiresAt: Date.now() + maxAge * 1000 };
  return keys;
}

const testKey = (): crypto.KeyObject | null => {
  const pem = process.env.LIGHTPAY_TEST_TOKEN_PUBLIC_KEY;
  if (!pem || process.env.NODE_ENV === 'production') return null;
  return crypto.createPublicKey(pem.replace(/\\n/g, '\n'));
};

const b64json = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/** Sensitive actions (withdraw, send, delete, credentials) need a sign-in from the last 10 minutes. */
export const isRecentSignIn = (user: LightPayUser, maxAgeSeconds = 600) => Math.floor(Date.now() / 1000) - user.authTime <= maxAgeSeconds;

export async function verifyUserToken(token: string): Promise<LightPayUser> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new UserTokenError('Malformed token');
  let header: any;
  let payload: any;
  try {
    header = b64json(parts[0]);
    payload = b64json(parts[1]);
  } catch {
    throw new UserTokenError('Malformed token');
  }
  if (header.alg !== 'RS256') throw new UserTokenError('Unsupported token algorithm');

  const test = payload.iss === 'lightpay-test' ? testKey() : null;
  let key: crypto.KeyObject | undefined;
  if (payload.iss === 'lightpay-test') {
    if (!test) throw new UserTokenError('Test tokens are disabled');
    key = test;
  } else {
    if (payload.iss !== `https://securetoken.google.com/${projectId()}` || payload.aud !== projectId()) {
      throw new UserTokenError('Token was not issued for LightPay');
    }
    key = (await googleKeys())[header.kid];
    if (!key) throw new UserTokenError('Unknown signing key');
  }

  const valid = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
  if (!valid) throw new UserTokenError('Invalid token signature');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now - 30) throw new UserTokenError('Token expired');
  if (typeof payload.iat !== 'number' || payload.iat > now + 60) throw new UserTokenError('Token issued in the future');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) throw new UserTokenError('Token has no subject');

  return {
    uid: payload.sub,
    email: payload.email ?? null,
    emailVerified: payload.email_verified === true,
    phone: payload.phone_number ?? null,
    name: payload.name ?? null,
    authTime: typeof payload.auth_time === 'number' ? payload.auth_time : payload.iat,
  };
}
