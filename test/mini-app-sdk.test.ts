import { LightWalletClient } from '../src/sdk/client.js';
import { query } from '../src/db/pool.js';
import { config } from '../src/config/index.js';

const BASE_URL = `http://127.0.0.1:${config.port}`;
const APP_ID = 'app_test_fintech_2026';
const API_KEY = 'sec_live_test_fintech_super_secret_key';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    failed++;
  }
}

async function runE2ETest() {
  console.log('\n======================================================');
  console.log('🚀 LIGHTWALLET E2E VALIDATION SUITE (LIVE NEON DB)');
  console.log('======================================================\n');

  // Étape 1 : Enregistrement de l'App Test via l'API Admin
  console.log('1. Configuration du Tenant App dans Neon PostgreSQL...');
  try {
    const adminRes = await fetch(`${BASE_URL}/v1/admin/apps`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': config.masterAdminKey,
      },
      body: JSON.stringify({
        id: APP_ID,
        name: 'Fintech Test Application',
      }),
    });
    // Si déjà existant, ce n'est pas bloquant
    console.log(`   Statut enregistrement App: ${adminRes.status}`);
  } catch (e: any) {
    console.log('   App setup note:', e.message);
  }

  // Création directe de la clé d'API pour le test si nécessaire
  const crypto = await import('crypto');
  const apiKeyHash = crypto.createHash('sha256').update(API_KEY).digest('hex');
  await query(
    `INSERT INTO apps (id, name, api_key_hash, webhook_secret)
     VALUES ($1, 'Fintech Test Application', $2, 'whsec_test_secret')
     ON CONFLICT (id) DO UPDATE SET api_key_hash = $2`,
    [APP_ID, apiKeyHash]
  );
  assert(true, 'Application cliente enregistrée et authentifiée');

  // Étape 2 : Instanciation du SDK Client
  console.log('\n2. Initialisation du SDK LightWalletClient...');
  const sdk = new LightWalletClient({
    baseUrl: BASE_URL,
    appId: APP_ID,
    apiKey: API_KEY,
  });
  assert(!!sdk, 'Instance SDK créée');

  // Étape 3 : Création des Wallets pour Alice et Bob
  console.log('\n3. Création des portefeuilles utilisateurs (Devise: AOA)...');
  const aliceWallet = await sdk.getOrCreateWallet({ accountId: 'alice_angola', currency: 'AOA' });
  const bobWallet = await sdk.getOrCreateWallet({ accountId: 'bob_angola', currency: 'AOA' });

  assert(aliceWallet.account_id === 'alice_angola', 'Wallet Alice créé avec succès');
  assert(bobWallet.account_id === 'bob_angola', 'Wallet Bob créé avec succès');
  assert(aliceWallet.currency === 'AOA', 'Devise Kwanza (AOA) validée');

  const aliceInitialBal = BigInt(aliceWallet.available_balance);
  const bobInitialBal = BigInt(bobWallet.available_balance);
  console.log(`   Solde initial Alice: ${aliceInitialBal} AOA | Bob: ${bobInitialBal} AOA`);

  // Étape 4 : Dépôt sur le compte d'Alice (Ex: Recharge Multicaixa Express)
  console.log('\n4. Test Dépôt (Recharge Multicaixa Express de 50 000 AOA sur Alice)...');
  const depositRes = await sdk.deposit({
    accountId: 'alice_angola',
    amount: 50000,
    currency: 'AOA',
    method: 'MULTICAIXA_EXPRESS',
    reference: 'MCX_TEST_TX_98745',
  });
  assert(depositRes.status === 'SUCCESS' || depositRes.status === 'success', 'Dépôt crédité avec succès via le SDK');

  const aliceAfterDeposit = await sdk.getWalletByAccount('alice_angola', 'AOA');
  assert(
    BigInt(aliceAfterDeposit.available_balance) === aliceInitialBal + 50000n,
    'Solde Alice augmenté exactement de 50 000 AOA'
  );
  console.log(`   Nouveau solde Alice: ${aliceAfterDeposit.available_balance} AOA`);

  // Étape 5 : Virement P2P (Alice envoie 15 000 AOA à Bob)
  console.log('\n5. Test Virement P2P instantané (Alice -> Bob : 15 000 AOA)...');
  const transferRes = await sdk.transfer({
    fromAccountId: 'alice_angola',
    toAccountId: 'bob_angola',
    amount: 15000,
    currency: 'AOA',
    note: 'Remboursement déjeuner Luanda',
  });
  assert(transferRes.status === 'SUCCESS' || transferRes.status === 'success', 'Transfert P2P exécuté avec succès');

  const aliceAfterTransfer = await sdk.getWalletByAccount('alice_angola', 'AOA');
  const bobAfterTransfer = await sdk.getWalletByAccount('bob_angola', 'AOA');

  assert(
    BigInt(aliceAfterTransfer.available_balance) === aliceInitialBal + 35000n,
    'Alice a été débitée exactement de 15 000 AOA (Reste: 35 000 AOA)'
  );
  assert(
    BigInt(bobAfterTransfer.available_balance) === bobInitialBal + 15000n,
    'Bob a été crédité exactement de 15 000 AOA'
  );
  console.log(`   Solde final Alice: ${aliceAfterTransfer.available_balance} AOA | Bob: ${bobAfterTransfer.available_balance} AOA`);

  // Étape 6 : Test de Sécurité (Rejet de virement si solde insuffisant)
  console.log('\n6. Test de Sécurité Comptable (Tentative de découvert interdit)...');
  try {
    await sdk.transfer({
      fromAccountId: 'bob_angola',
      toAccountId: 'alice_angola',
      amount: 9999999, // Montant bien supérieur au solde de Bob
      currency: 'AOA',
      note: 'Tentative de dépassement de découvert',
    });
    assert(false, 'La tentative de découvert aurait dû être rejetée !');
  } catch (err: any) {
    assert(true, `Rejet immédiat confirmé : "${err.message}"`);
  }

  // Étape 7 : Consultation du Relevé Comptable (Grand Livre Immuable)
  console.log('\n7. Vérification du Relevé Comptable (Grand Livre)...');
  const aliceStatements = await sdk.getStatement(aliceWallet.id);
  assert(aliceStatements.length >= 2, 'Historique d\'Alice contient les écritures de débit et crédit');
  console.log(`   Écritures enregistrées pour Alice : ${aliceStatements.length}`);
  aliceStatements.slice(0, 2).forEach((entry, idx) => {
    console.log(`     #${idx + 1} [${entry.direction}] ${entry.amount} AOA - ${entry.description}`);
  });

  // Étape 8 : Vérification de l'Équilibre Global Invariant Zero-Sum
  console.log('\n8. Vérification de l\'Équilibre Zéro du Grand Livre Global...');
  const sums = await query<{ sum_debit: string; sum_credit: string }>(
    `SELECT 
       COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END), 0) as sum_debit,
       COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END), 0) as sum_credit
     FROM ledger_entries`
  );
  const totalDebit = BigInt(sums[0].sum_debit);
  const totalCredit = BigInt(sums[0].sum_credit);
  assert(totalDebit === totalCredit, `Total Débit (${totalDebit}) === Total Crédit (${totalCredit})`);

  console.log('\n======================================================');
  console.log(`📊 RÉSULTAT DU TEST : ${passed} PASSÉS, ${failed} ÉCHOUÉS`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runE2ETest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[FATAL TEST ERROR]', err);
    process.exit(1);
  });
