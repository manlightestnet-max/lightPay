import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { LightWalletClient, Environment } from '../sdk/client.js';
import { config } from '../config/index.js';
import { query } from '../db/pool.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'app-users.json');
const CONFIG_FILE = path.join(DATA_DIR, 'client-app-config.json');

export interface ClientAppConfig {
  appId: string;
  appName: string;
  liveApiKey: string;
  testApiKey: string;
  apiKey: string;
  activeEnv: Environment;
  webhookSecret: string;
  createdAt: string;
}

export interface AppUser {
  id: string; // usr_uuid
  username: string; // unique lowercase
  passwordHash: string;
  salt: string;
  walletId: string; // Neon DB wallet UUID par défaut
  sandboxWalletId: string; // Neon DB wallet UUID Sandbox
  liveWalletId: string; // Neon DB wallet UUID Production
  createdAt: string;
}

export interface Session {
  token: string;
  userId: string;
  username: string;
  expiresAt: number;
}

// Sessions en mémoire pour les utilisateurs connectés
const activeSessions = new Map<string, Session>();

async function ensureAppInDatabase(creds: ClientAppConfig): Promise<void> {
  const liveKeyHash = crypto.createHash('sha256').update(creds.liveApiKey).digest('hex');
  const testKeyHash = crypto.createHash('sha256').update(creds.testApiKey).digest('hex');

  for (const env of ['production', 'sandbox'] as const) {
    try {
      await query(
        `INSERT INTO apps (id, name, api_key_hash, test_api_key_hash, webhook_url, webhook_secret, is_active)
         VALUES ($1, $2, $3, $4, null, $5, true)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           api_key_hash = EXCLUDED.api_key_hash,
           test_api_key_hash = EXCLUDED.test_api_key_hash,
           webhook_secret = EXCLUDED.webhook_secret,
           is_active = true,
           updated_at = NOW()`,
        [creds.appId, creds.appName, liveKeyHash, testKeyHash, creds.webhookSecret || 'whsec_default'],
        env
      );

      await query(
        `INSERT INTO wallets (app_id, account_id, account_type, currency, environment, metadata)
         VALUES ($1, 'SYSTEM_CASH_GATEWAY', 'SYSTEM', 'CREDIT', $2, $3)
         ON CONFLICT (app_id, account_id, currency, environment) DO UPDATE SET updated_at = NOW()`,
        [creds.appId, env, JSON.stringify({ role: `system_gateway_${env}` })],
        env
      );
    } catch (err: any) {
      console.warn(`[APP CONFIG] Ensure app in ${env} DB notice:`, err.message);
    }
  }
}

/**
 * 1. Initialise et persiste les VRAIES clés d'API générées par LightWallet Admin
 */
export async function getOrCreateClientCredentials(): Promise<ClientAppConfig> {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.appId && (parsed.apiKey || parsed.liveApiKey)) {
        const existingConfig: ClientAppConfig = {
          appId: parsed.appId,
          appName: parsed.appName,
          liveApiKey: parsed.liveApiKey || parsed.apiKey,
          testApiKey: parsed.testApiKey || parsed.apiKey,
          apiKey: parsed.apiKey || parsed.testApiKey,
          activeEnv: (parsed.activeEnv as Environment) || 'sandbox',
          webhookSecret: parsed.webhookSecret || 'whsec_default',
          createdAt: parsed.createdAt,
        };
        await ensureAppInDatabase(existingConfig);
        return existingConfig;
      }
    } catch (e) {
      console.warn('[CLIENT CONFIG] Corrupted config file, re-registering...');
    }
  }

  // Enregistrement réel via l'API Admin de LightWallet
  const appId = `app_client_${Date.now()}`;
  const appName = 'Angola Consumer Mobile App';

  const res = await fetch(`http://127.0.0.1:${config.port}/v1/admin/apps`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Master-Key': config.masterAdminKey,
    },
    body: JSON.stringify({
      id: appId,
      name: appName,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`Failed to register client app in LightWallet: ${(errData as any)?.error || res.statusText}`);
  }

  const data = (await res.json()) as any;
  const newConfig: ClientAppConfig = {
    appId: data.app.id,
    appName: data.app.name,
    liveApiKey: data.app.live_api_key || data.app.api_key,
    testApiKey: data.app.test_api_key || data.app.api_key,
    apiKey: data.app.test_api_key || data.app.api_key,
    activeEnv: 'sandbox',
    webhookSecret: data.app.webhook_secret,
    createdAt: new Date().toISOString(),
  };

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2), 'utf8');
  console.log(`[CLIENT APP] Registered with real API Keys (Live: ${newConfig.liveApiKey.substring(0, 15)}..., Test: ${newConfig.testApiKey.substring(0, 15)}...)`);

  return newConfig;
}

/**
 * Obtient l'environnement actif configuré
 */
export async function getActiveEnv(): Promise<Environment> {
  const creds = await getOrCreateClientCredentials();
  return creds.activeEnv || 'sandbox';
}

/**
 * Change l'environnement actif (Sandbox vs Production)
 */
export async function setActiveEnv(env: Environment): Promise<ClientAppConfig> {
  const creds = await getOrCreateClientCredentials();
  creds.activeEnv = env;
  creds.apiKey = env === 'sandbox' ? creds.testApiKey : creds.liveApiKey;

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(creds, null, 2), 'utf8');
  console.log(`[CLIENT APP] Switched active environment to ${env}`);
  return creds;
}

/**
 * Obtient une instance configurée du SDK LightWallet pour la mini-app
 */
export async function getClientSdk(requestedEnv?: Environment): Promise<LightWalletClient> {
  const creds = await getOrCreateClientCredentials();
  const env = requestedEnv || creds.activeEnv || 'sandbox';
  const apiKey = env === 'sandbox' ? creds.testApiKey : creds.liveApiKey;

  return new LightWalletClient({
    baseUrl: `http://127.0.0.1:${config.port}`,
    appId: creds.appId,
    apiKey,
  });
}

/**
 * 2. Gestion des utilisateurs dans data/app-users.json (TOTALEMENT DÉCOUPLÉ DE NEON DB)
 */
function loadUsers(): AppUser[] {
  if (!fs.existsSync(USERS_FILE)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveUsers(users: AppUser[]): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

/**
 * Inscription d'un nouvel utilisateur dans l'application cliente
 * Crée simultanément le portefeuille Sandbox ET le portefeuille Live dans Neon DB
 */
export async function registerAppUser(username: string, password: string): Promise<{ user: AppUser; token: string }> {
  const cleanUsername = username.trim().toLowerCase();
  if (cleanUsername.length < 3) {
    throw new Error("Le nom d'utilisateur doit contenir au moins 3 caractères");
  }
  if (password.length < 4) {
    throw new Error("Le mot de passe doit contenir au moins 4 caractères");
  }

  const users = loadUsers();
  if (users.some((u) => u.username === cleanUsername)) {
    throw new Error("Ce nom d'utilisateur est déjà pris");
  }

  const userId = `usr_${crypto.randomUUID()}`;
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);

  // 3. Appel au VRAI SDK LightWallet pour créer le portefeuille Sandbox ET le portefeuille Live dans Neon DB
  const sandboxSdk = await getClientSdk('sandbox');
  const liveSdk = await getClientSdk('production');

  const [sandboxWallet, liveWallet] = await Promise.all([
    sandboxSdk.getOrCreateWallet({
      accountId: userId,
      currency: 'CREDIT',
      metadata: { username: cleanUsername, env: 'sandbox' },
    }),
    liveSdk.getOrCreateWallet({
      accountId: userId,
      currency: 'CREDIT',
      metadata: { username: cleanUsername, env: 'production' },
    }),
  ]);

  const activeEnv = await getActiveEnv();
  const newUser: AppUser = {
    id: userId,
    username: cleanUsername,
    passwordHash,
    salt,
    walletId: activeEnv === 'sandbox' ? sandboxWallet.id : liveWallet.id,
    sandboxWalletId: sandboxWallet.id,
    liveWalletId: liveWallet.id,
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);
  saveUsers(users);

  // Création de session
  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.set(token, {
    token,
    userId: newUser.id,
    username: newUser.username,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24h
  });

  return { user: newUser, token };
}

/**
 * Met à jour un utilisateur dans la base JSON locale
 */
export function updateUser(user: AppUser): void {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.id === user.id);
  if (idx !== -1) {
    users[idx] = { ...users[idx], ...user };
    saveUsers(users);
  }
}

/**
 * Assure qu'un utilisateur possède un portefeuille physiquement existant dans la base Neon de l'environnement spécifié
 */
export async function ensureUserWalletForEnv(user: AppUser, env: Environment): Promise<string> {
  const sdk = await getClientSdk(env);
  const targetProp = env === 'sandbox' ? 'sandboxWalletId' : 'liveWalletId';

  const existingWalletId = user[targetProp];
  if (existingWalletId) {
    try {
      const w = await sdk.getWalletById(existingWalletId);
      if (w && w.id) {
        return w.id;
      }
    } catch {
      // Portefeuille inexistant dans cette base physique, re-création ci-dessous
    }
  }

  // Création stricte dans la base physique Neon de cet environnement avec la devise CREDIT
  const wallet = await sdk.getOrCreateWallet({
    accountId: user.id,
    currency: 'CREDIT',
    metadata: { username: user.username, env },
  });

  user[targetProp] = wallet.id;
  updateUser(user);
  return wallet.id;
}

/**
 * Connexion d'un utilisateur existant
 */
export async function loginAppUser(username: string, password: string): Promise<{ user: AppUser; token: string }> {
  const cleanUsername = username.trim().toLowerCase();
  const users = loadUsers();
  const user = users.find((u) => u.username === cleanUsername);

  if (!user) {
    throw new Error('Identifiants incorrects');
  }

  const attemptHash = hashPassword(password, user.salt);
  if (!crypto.timingSafeEqual(Buffer.from(attemptHash), Buffer.from(user.passwordHash))) {
    throw new Error('Identifiants incorrects');
  }

  // Provisionner / valider les deux portefeuilles dans leurs bases de données respectives
  await Promise.all([
    ensureUserWalletForEnv(user, 'sandbox').catch((e) => console.warn('Sandbox wallet check warn:', e.message)),
    ensureUserWalletForEnv(user, 'production').catch((e) => console.warn('Live wallet check warn:', e.message)),
  ]);

  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.set(token, {
    token,
    userId: user.id,
    username: user.username,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  });

  return { user, token };
}

/**
 * Vérifie un jeton de session
 */
export function getSession(token: string): Session | null {
  if (!token) return null;
  const session = activeSessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return null;
  }
  return session;
}

/**
 * Déconnecte une session
 */
export function logoutSession(token: string): void {
  activeSessions.delete(token);
}

/**
 * Recherche un utilisateur par ID
 */
export function findUserById(userId: string): AppUser | null {
  const users = loadUsers();
  return users.find((u) => u.id === userId) || null;
}

/**
 * Recherche un utilisateur par username
 */
export function findUserByUsername(username: string): AppUser | null {
  const clean = username.trim().toLowerCase();
  const users = loadUsers();
  return users.find((u) => u.username === clean) || null;
}

/**
 * Retourne le walletId d'un utilisateur selon l'environnement (JAMAIS le même entre Sandbox et Live)
 */
export function getUserWalletIdForEnv(user: AppUser, env: Environment): string {
  if (env === 'sandbox') {
    return user.sandboxWalletId || '';
  }
  return user.liveWalletId || '';
}

/**
 * Liste les autres utilisateurs disponibles (sans mots de passe)
 */
export function listAvailableUsernames(excludeUsername?: string): string[] {
  const users = loadUsers();
  return users
    .map((u) => u.username)
    .filter((uname) => uname !== excludeUsername?.toLowerCase());
}
