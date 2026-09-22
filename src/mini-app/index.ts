import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FastifyInstance } from 'fastify';
import {
  registerAppUser,
  loginAppUser,
  getSession,
  logoutSession,
  findUserById,
  findUserByUsername,
  listAvailableUsernames,
  getClientSdk,
  getOrCreateClientCredentials,
  getActiveEnv,
  setActiveEnv,
  getUserWalletIdForEnv,
  ensureUserWalletForEnv,
} from './auth-service.js';
import { Environment } from '../sdk/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Charge le code HTML de l'interface Mini-App
 */
export function getMiniAppHtml(): string {
  const possiblePaths = [
    path.join(__dirname, '..', '..', 'public', 'app.html'),
    path.resolve(process.cwd(), 'public', 'app.html'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8');
    }
  }

  return '<h1>LightWallet Mini-App</h1><p>public/app.html not found</p>';
}

/**
 * Enregistre les routes de l'API de la mini-app
 */
export async function miniAppRoutes(fastify: FastifyInstance) {

  // Middleware pour extraire la session utilisateur
  const authenticateUser = async (request: any, reply: any) => {
    const authHeader = request.headers['authorization'] as string;
    const token = authHeader?.replace(/^Bearer\s+/i, '') || (request.headers['x-session-token'] as string);

    if (!token) {
      return reply.status(401).send({ error: 'Session non authentifiée. Veuillez vous connecter.' });
    }

    const session = getSession(token);
    if (!session) {
      return reply.status(401).send({ error: 'Session expirée ou invalide.' });
    }

    const user = findUserById(session.userId);
    if (!user) {
      return reply.status(401).send({ error: 'Utilisateur introuvable.' });
    }

    request.appUser = user;
    request.sessionToken = token;
  };

  // 1. Initialisation / Vérification de la configuration de l'application cliente
  fastify.get('/config', async () => {
    const creds = await getOrCreateClientCredentials();
    return {
      status: 'success',
      appId: creds.appId,
      appName: creds.appName,
      activeEnv: creds.activeEnv || 'sandbox',
      liveKeyPreview: creds.liveApiKey ? `${creds.liveApiKey.substring(0, 12)}...` : 'N/A',
      testKeyPreview: creds.testApiKey ? `${creds.testApiKey.substring(0, 12)}...` : 'N/A',
      createdAt: creds.createdAt,
    };
  });

  // 2. Bascule d'environnement (Sandbox vs Production) pour l'application cliente
  fastify.post('/env', async (request, reply) => {
    const { env } = (request.body as any) || {};
    if (env !== 'sandbox' && env !== 'production') {
      return reply.status(400).send({ error: "Environnement invalide. Utilisez 'sandbox' ou 'production'." });
    }
    const updated = await setActiveEnv(env as Environment);
    return {
      status: 'success',
      activeEnv: updated.activeEnv,
      message: `Environnement basculé sur ${env === 'sandbox' ? '🧪 Sandbox (Mode Test)' : '🟢 Production (Mode Live)'}`,
    };
  });

  // 3. Inscription d'un nouvel utilisateur (création compte local + wallet Neon DB)
  fastify.post('/auth/register', async (request, reply) => {
    const { username, password } = (request.body as any) || {};

    if (!username || !password) {
      return reply.status(400).send({ error: "Nom d'utilisateur et mot de passe requis" });
    }

    try {
      const { user, token } = await registerAppUser(username, password);
      const activeEnv = await getActiveEnv();
      const currentWalletId = await ensureUserWalletForEnv(user, activeEnv);

      return reply.status(201).send({
        status: 'success',
        token,
        activeEnv,
        user: {
          id: user.id,
          username: user.username,
          walletId: currentWalletId,
          sandboxWalletId: user.sandboxWalletId,
          liveWalletId: user.liveWalletId,
          createdAt: user.createdAt,
        },
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 4. Connexion d'un utilisateur existant
  fastify.post('/auth/login', async (request, reply) => {
    const { username, password } = (request.body as any) || {};

    if (!username || !password) {
      return reply.status(400).send({ error: "Nom d'utilisateur et mot de passe requis" });
    }

    try {
      const { user, token } = await loginAppUser(username, password);
      const activeEnv = await getActiveEnv();
      const currentWalletId = await ensureUserWalletForEnv(user, activeEnv);

      return {
        status: 'success',
        token,
        activeEnv,
        user: {
          id: user.id,
          username: user.username,
          walletId: currentWalletId,
          sandboxWalletId: user.sandboxWalletId,
          liveWalletId: user.liveWalletId,
          createdAt: user.createdAt,
        },
      };
    } catch (err: any) {
      return reply.status(401).send({ error: err.message });
    }
  });

  // 5. Déconnexion
  fastify.post('/auth/logout', { preHandler: authenticateUser }, async (request) => {
    logoutSession((request as any).sessionToken);
    return { status: 'success', message: 'Déconnecté avec succès' };
  });

  // 6. Profil de l'utilisateur connecté + Solde réel & Relevé depuis Neon DB
  fastify.get('/me', { preHandler: authenticateUser }, async (request, reply) => {
    const user = (request as any).appUser;
    const activeEnv = await getActiveEnv();
    const walletId = await ensureUserWalletForEnv(user, activeEnv);

    try {
      const sdk = await getClientSdk(activeEnv);
      // Lecture en temps réel sur la base Neon via le SDK dans le bon environnement
      const wallet = await sdk.getWalletById(walletId);
      const statement = await sdk.getStatement(walletId, 20);

      return {
        status: 'success',
        activeEnv,
        user: {
          id: user.id,
          username: user.username,
          walletId,
          sandboxWalletId: user.sandboxWalletId,
          liveWalletId: user.liveWalletId,
        },
        wallet: {
          id: wallet.id,
          currency: wallet.currency,
          environment: wallet.environment,
          available_balance: wallet.available_balance,
          locked_balance: wallet.locked_balance,
          status: wallet.status,
        },
        statement,
      };
    } catch (err: any) {
      return reply.status(500).send({ error: `Erreur lors de la lecture du portefeuille (${activeEnv}): ${err.message}` });
    }
  });

  // 7. Liste des destinataires pour virement (les autres usernames enregistrés)
  fastify.get('/recipients', { preHandler: authenticateUser }, async (request) => {
    const user = (request as any).appUser;
    const recipients = listAvailableUsernames(user.username);
    return { status: 'success', recipients };
  });

  // ⛔ ROUTE DÉPÔT SUPPRIMÉE — SÉCURITÉ ANTI-FRAUDE
  // POST /deposit n'est plus exposé aux utilisateurs finaux.
  // La seule façon de créditer un wallet utilisateur est via MainApp :
  //   POST /v1/admin/treasury/distribute → depuis le Main Treasury
  // Le Main Treasury lui-même n'est alimenté que par l'agrégateur externe :
  //   POST /v1/gateways/webhook/:provider

  // 9. Virement P2P instantané vers un autre utilisateur (par son username)
  fastify.post('/transfer', { preHandler: authenticateUser }, async (request, reply) => {
    const sender = (request as any).appUser;
    const activeEnv = await getActiveEnv();
    const senderWalletId = await ensureUserWalletForEnv(sender, activeEnv);
    const { recipientUsername, amount, note } = (request.body as any) || {};

    if (!recipientUsername || !amount) {
      return reply.status(400).send({ error: 'Destinataire et montant requis' });
    }

    const cleanRecipient = recipientUsername.trim().toLowerCase();
    if (cleanRecipient === sender.username) {
      return reply.status(400).send({ error: 'Vous ne pouvez pas vous envoyer des crédits à vous-même' });
    }

    const recipient = findUserByUsername(cleanRecipient);
    if (!recipient) {
      return reply.status(404).send({ error: `Destinataire @${cleanRecipient} introuvable` });
    }

    const recipientWalletId = await ensureUserWalletForEnv(recipient, activeEnv);
    const transferAmount = parseInt(amount, 10);
    if (transferAmount <= 0) {
      return reply.status(400).send({ error: 'Le montant doit être supérieur à zéro' });
    }

    try {
      const sdk = await getClientSdk(activeEnv);

      // Vérifier le solde de l'émetteur
      const senderWallet = await sdk.getWalletById(senderWalletId);
      if (BigInt(senderWallet.available_balance) < BigInt(transferAmount)) {
        return reply.status(400).send({
          error: `Solde insuffisant. Vous disposez de ${Number(senderWallet.available_balance).toLocaleString('fr-FR')} Crédits en mode ${activeEnv}.`,
        });
      }

      // Virement atomique en partie double sur Neon DB
      const result = await sdk.transfer({
        fromWalletId: senderWalletId,
        toWalletId: recipientWalletId,
        amount: transferAmount,
        currency: 'CREDIT',
        note: note || `Transfert de @${sender.username} à @${recipient.username} (${activeEnv})`,
      });

      return {
        status: 'success',
        activeEnv,
        message: `Virement de ${transferAmount.toLocaleString('fr-FR')} Crédits envoyé à @${recipient.username} (${activeEnv})`,
        transaction: result,
      };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });
}
