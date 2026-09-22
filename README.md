# LightWallet Core Engine ⚡

**Universal Closed-Loop Multi-Tenant Core Banking & Wallet Engine**  
Conçu pour gérer la monnaie de n'importe quel site ou écosystème (cours, e-commerce, transport, logistique, SaaS).

---

## 🌟 Caractéristiques Principales

* **100% Agnostique & Multi-Tenant :** Ne contient aucune logique métier en dur. Chaque projet s'enregistre comme une `app` avec ses propres clés API étanches.
* **Moteur Comptable en Partie Double (Double-Entry Ledger) :** Chaque mouvement financier génère un équilibre strict entre Débits et Crédits. Impossible d'avoir un solde négatif grâce aux contraintes SQL au niveau du moteur.
* **Transactions Atomiques avec Split de Commission :** Débite l'acheteur, crédite le vendeur et prélève la commission de votre plateforme en 1 seule requête SQL ACID.
* **Protection Idempotence :** Header `Idempotency-Key` obligatoire pour interdire les doublons en cas de micro-coupure réseau.
* **Prêt pour le Déploiement Fly.io :** Conteneur Docker léger multi-stage et configuration `fly.toml` avec base PostgreSQL privée.

---

## 🚀 Démarrage Rapide

### 1. Variables d'Environnement (`.env`)
Créez un fichier `.env` à la racine :

```env
PORT=8080
HOST=0.0.0.0
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lightwallet
MASTER_ADMIN_KEY=dev_master_key_change_in_production
DEFAULT_CURRENCY=CREDIT
DATABASE_URL=postgresql://.../lightwallet?sslmode=require
DATABASE_URL_SANDBOX=postgresql://.../lightwallet_sandbox?sslmode=require
```

### 2. Installation des Dépendances
```bash
npm install
```

### 3. Lancer les Migrations de la Base (Live + Sandbox)
```bash
npm run migrate
```

### 4. Démarrer le Serveur
```bash
npm start
```

---

## ☁️ Déploiement Cloud du Serveur (Production)

Le serveur LightWallet est conteneurisé avec Docker et s'adapte à tous les hébergeurs cloud modernes.

### Option 1 : Déploiement sur Koyeb (Ultra-Simple & Rapide)
1. Poussez votre code sur votre compte **GitHub**.
2. Rendez-vous sur [Koyeb Console](https://app.koyeb.com/) et cliquez sur **Create Service**.
3. Sélectionnez **GitHub** et choisissez le dépôt de votre projet.
4. Koyeb détecte automatiquement le `Dockerfile`.
5. Dans la section **Ports & Routing** :
   - Port : `8080` (Protocole HTTP, Route `/`)
6. Dans la section **Health checks** :
   - Protocole : `HTTP`
   - Port : `8080`
   - Path : `/health`
7. Dans **Environment variables and files** (cliquez sur **Bulk edit**) et collez :
   ```env
   NODE_ENV=production
   DEFAULT_CURRENCY=CREDIT
   HOST=0.0.0.0
   PORT=8080
   DATABASE_URL=postgresql://neondb_owner:PASSWORD@ep-silent-shape-b4v1pv54-pooler.c-6.us-east-2.aws.neon.tech/lightwallet?sslmode=require
   DATABASE_URL_SANDBOX=postgresql://neondb_owner:PASSWORD@ep-silent-shape-b4v1pv54-pooler.c-6.us-east-2.aws.neon.tech/lightwallet_sandbox?sslmode=require
   MASTER_ADMIN_KEY=votre_cle_maitresse_ultra_secrete
   ```
8. Cliquez sur **Deploy** -> Koyeb compile l'image Docker, applique les migrations PostgreSQL et vous attribue votre domaine HTTPS (ex: `https://lightwallet-<votre-org>.koyeb.app`).

### Option 2 : Déploiement sur Render.com
1. Poussez le repo sur GitHub/GitLab.
2. Sur [Render.com](https://render.com), cliquez sur **New Web Service** et sélectionnez votre repo.
3. Render détectera automatiquement le fichier `render.yaml` ou `Dockerfile`.
4. Renseignez les variables d'environnement secrètes (`DATABASE_URL`, `DATABASE_URL_SANDBOX`, `MASTER_ADMIN_KEY`).
5. Cliquez sur **Deploy**.

### Option 3 : Déploiement sur Fly.io
```bash
# Définir les secrets de production
fly secrets set DATABASE_URL="postgresql://.../lightwallet" DATABASE_URL_SANDBOX="postgresql://.../lightwallet_sandbox" MASTER_ADMIN_KEY="votre_cle_secrete"

# Lancer le déploiement
fly deploy
```

### Option 4 : Déploiement Docker sur VPS / Railway / GCP Cloud Run
```bash
docker build -t lightwallet .
docker run -d -p 8080:8080 \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://.../lightwallet" \
  -e DATABASE_URL_SANDBOX="postgresql://.../lightwallet_sandbox" \
  -e MASTER_ADMIN_KEY="votre_cle_secrete" \
  lightwallet
```

---

## 📦 Distribution du SDK Client dans le Cloud

Les applications clientes peuvent consommer le SDK de deux manières simples :

### Méthode 1 : Import Direct depuis le Serveur Cloud (Zéro Installation)
Le serveur expose directement le client JavaScript (ESM) et les types TypeScript :

```javascript
// Import direct depuis l'URL de votre serveur publié dans le cloud :
import { LightWalletClient } from 'https://votre-serveur-cloud.com/v1/sdk/client.js';

const client = new LightWalletClient({
  baseUrl: 'https://votre-serveur-cloud.com',
  appId: 'app_mon_application',
  apiKey: 'sec_test_abc...', // 'sec_test_' bascule automatiquement sur la base Sandbox
});

// 1. Créer ou récupérer un portefeuille utilisateur
const wallet = await client.getOrCreateWallet({ accountId: 'user_42' });

// 2. Créditer des crédits
await client.deposit({ accountId: 'user_42', amount: 500, reference: 'DEP_1' });

// 3. Transférer des crédits (P2P instantané)
await client.transfer({ fromAccountId: 'user_42', toAccountId: 'merchant_99', amount: 50 });

// 4. Historique comptable
const entries = await client.getStatement(wallet.id);
```

### Méthode 2 : Package NPM (`lightwallet-sdk`)
Le dossier `packages/lightwallet-sdk` est prêt pour une publication sur le registre NPM :
```bash
cd packages/lightwallet-sdk
npm publish --access public
```

Puis dans n'importe quel projet client :
```bash
npm install lightwallet-sdk
```
