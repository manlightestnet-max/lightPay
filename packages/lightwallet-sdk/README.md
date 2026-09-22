# LightWallet SDK (TypeScript / JavaScript)

Universal client library for interacting with the **LightWallet Core Engine** (Double-Entry Ledger, Multi-Tenant internal Credits Wallet).

Zero external dependencies. Works in **Node.js 18+**, **Bun**, **Deno**, and modern **Browsers / Web Apps**.

---

## 📦 Installation

### Option 1: Via NPM
```bash
npm install lightwallet-sdk
```

### Option 2: Direct Import from Cloud Server (No install required)
```javascript
import { LightWalletClient } from 'https://<VOTRE_DOMAINE_CLOUD>/v1/sdk/client.js';
```

---

## 🚀 Quick Start

### 1. Initialiser le Client

```typescript
import { LightWalletClient } from 'lightwallet-sdk';

const client = new LightWalletClient({
  baseUrl: 'https://votre-serveur-lightwallet.com',
  appId: 'app_votre_application',
  apiKey: 'sec_test_votre_cle_api', // Clé 'sec_test_' -> Bascule automatique sur la base Sandbox
});

// Vérifier l'environnement actif
console.log('Mode Sandbox ?', client.isSandbox()); // true
console.log('Mode Production ?', client.isLive());    // false
```

### 2. Créer ou Obtenir un Portefeuille (Crédits)

```typescript
// Crée le wallet s'il n'existe pas, ou retourne le wallet existant
const wallet = await client.getOrCreateWallet({
  accountId: 'user_alice_456',
  accountType: 'USER',
});

console.log('ID Portefeuille :', wallet.id);
console.log('Solde disponible :', wallet.available_balance, wallet.currency); // 'CREDIT'
```

### 3. Créditer des Fonds (Dépôt / Recharge)

```typescript
const depositResult = await client.deposit({
  accountId: 'user_alice_456',
  amount: 1000, // 1000 Crédits
  reference: 'TOPUP_BONUS_1',
});

console.log('Nouveau solde :', depositResult.current_balance);
```

### 4. Transférer des Crédits entre Utilisateurs (P2P Atomique)

```typescript
const transfer = await client.transfer({
  fromAccountId: 'user_alice_456',
  toAccountId: 'user_bob_789',
  amount: 250, // 250 Crédits
  note: 'Paiement pour service rendu',
});

console.log('Statut du transfert :', transfer.status); // 'success'
```

### 5. Consulter le Grand Livre / Relevé d'un Compte (Statement)

```typescript
const statement = await client.getStatement(wallet.id, 20); // 20 dernières opérations

statement.forEach((entry) => {
  console.log(`[${entry.created_at}] ${entry.direction} ${entry.amount} ${entry.environment} -> ${entry.description}`);
});
```

---

## 🔒 Idempotence et Sécurité

Toutes les opérations d'écriture (`deposit`, `transfer`) acceptent une clé optionnelle `idempotencyKey`. Si elle n'est pas fournie, le SDK en génère une automatiquement via `LightWalletClient.generateIdempotencyKey()`.

Cela garantit qu'aucune transaction n'est exécutée en double, même en cas de coupure réseau ou de retry intempestif.
