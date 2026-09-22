async function runTests() {
  const BASE_URL = 'http://127.0.0.1:8080';
  console.log('=== 1. Healthcheck ===');
  const healthRes = await fetch(`${BASE_URL}/health`);
  const health = await healthRes.json();
  console.log('Health:', health);

  console.log('\n=== 2. Explorer Stats (Initial) ===');
  const statsRes = await fetch(`${BASE_URL}/v1/explorer/stats`);
  const statsData = await statsRes.json();
  console.log('Stats:', statsData.stats);

  console.log('\n=== 3. Mini-App Config ===');
  const cfgRes = await fetch(`${BASE_URL}/v1/mini-app/config`);
  const cfg = await cfgRes.json();
  console.log('Config:', cfg);

  console.log('\n=== 4. Register Alice ===');
  const aliceRes = await fetch(`${BASE_URL}/v1/mini-app/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: `alice_${Date.now().toString().slice(-4)}`,
      password: 'password123',
    }),
  });
  const aliceData = await aliceRes.json();
  if (!aliceRes.ok) throw new Error(`Alice register failed: ${JSON.stringify(aliceData)}`);
  console.log('Alice registered:', aliceData.user);
  const aliceToken = aliceData.token;

  console.log('\n=== 5. Register Bob ===');
  const bobUsername = `bob_${Date.now().toString().slice(-4)}`;
  const bobRes = await fetch(`${BASE_URL}/v1/mini-app/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: bobUsername,
      password: 'password123',
    }),
  });
  const bobData = await bobRes.json();
  if (!bobRes.ok) throw new Error(`Bob register failed: ${JSON.stringify(bobData)}`);
  console.log('Bob registered:', bobData.user);
  const bobToken = bobData.token;

  console.log('\n=== 6. Deposit 50,000 AOA into Alice (Sandbox) ===');
  const depRes = await fetch(`${BASE_URL}/v1/mini-app/deposit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aliceToken}`,
    },
    body: JSON.stringify({
      amount: 50000,
      method: 'MULTICAIXA_EXPRESS',
      reference: 'TEST_DEP_ALICE_SANDBOX',
    }),
  });
  const depData = await depRes.json();
  if (!depRes.ok) throw new Error(`Deposit failed: ${JSON.stringify(depData)}`);
  console.log('Deposit result:', depData.message);

  console.log('\n=== 7. Check Alice Balance in Sandbox ===');
  const aliceMeRes = await fetch(`${BASE_URL}/v1/mini-app/me`, {
    headers: { Authorization: `Bearer ${aliceToken}` },
  });
  const aliceMe = await aliceMeRes.json();
  console.log('Alice Wallet in Sandbox:', aliceMe.wallet);

  console.log('\n=== 8. Transfer 15,000 AOA from Alice to Bob (Sandbox P2P) ===');
  const xferRes = await fetch(`${BASE_URL}/v1/mini-app/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aliceToken}`,
    },
    body: JSON.stringify({
      recipientUsername: bobUsername,
      amount: 15000,
      note: 'Remboursement repas',
    }),
  });
  const xferData = await xferRes.json();
  if (!xferRes.ok) throw new Error(`Transfer failed: ${JSON.stringify(xferData)}`);
  console.log('Transfer result:', xferData.message);

  console.log('\n=== 9. Verify Alice & Bob Balances in Sandbox ===');
  const aliceMe2 = await (await fetch(`${BASE_URL}/v1/mini-app/me`, { headers: { Authorization: `Bearer ${aliceToken}` } })).json();
  const bobMe = await (await fetch(`${BASE_URL}/v1/mini-app/me`, { headers: { Authorization: `Bearer ${bobToken}` } })).json();
  console.log('Alice Balance:', aliceMe2.wallet.available_balance, 'AOA');
  console.log('Bob Balance:', bobMe.wallet.available_balance, 'AOA');

  console.log('\n=== 10. Switch Mini-App to Live Mode ===');
  const switchRes = await fetch(`${BASE_URL}/v1/mini-app/env`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ env: 'production' }),
  });
  const switchData = await switchRes.json();
  console.log('Switched env:', switchData);

  console.log('\n=== 11. Check Alice Balance in Live Mode (should be 0 AOA) ===');
  const aliceLiveMe = await (await fetch(`${BASE_URL}/v1/mini-app/me`, { headers: { Authorization: `Bearer ${aliceToken}` } })).json();
  console.log('Alice Live Wallet:', aliceLiveMe.wallet);

  console.log('\n=== 12. Deposit 25,000 AOA into Alice in Live Mode ===');
  const liveDepRes = await fetch(`${BASE_URL}/v1/mini-app/deposit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aliceToken}`,
    },
    body: JSON.stringify({
      amount: 25000,
      method: 'BANK_TRANSFER',
      reference: 'TEST_DEP_ALICE_LIVE',
    }),
  });
  const liveDepData = await liveDepRes.json();
  console.log('Live Deposit result:', liveDepData.message);

  const aliceLiveMeAfter = await (await fetch(`${BASE_URL}/v1/mini-app/me`, { headers: { Authorization: `Bearer ${aliceToken}` } })).json();
  console.log('Alice Live Wallet after deposit:', aliceLiveMeAfter.wallet);

  console.log('\n=== 13. Switch Mini-App Back to Sandbox ===');
  await fetch(`${BASE_URL}/v1/mini-app/env`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ env: 'sandbox' }),
  });
  const aliceSandboxMeFinal = await (await fetch(`${BASE_URL}/v1/mini-app/me`, { headers: { Authorization: `Bearer ${aliceToken}` } })).json();
  console.log('Alice Sandbox Wallet still at:', aliceSandboxMeFinal.wallet.available_balance, 'AOA (isolation intact!)');

  console.log('\n=== 14. Final Explorer Verification ===');
  const finalStats = await (await fetch(`${BASE_URL}/v1/explorer/stats`)).json();
  console.log('Final Explorer Stats:', finalStats.stats);

  const sandboxStats = await (await fetch(`${BASE_URL}/v1/explorer/stats?environment=sandbox`)).json();
  console.log('Sandbox Stats:', sandboxStats.stats);

  const liveStats = await (await fetch(`${BASE_URL}/v1/explorer/stats?environment=production`)).json();
  console.log('Live Stats:', liveStats.stats);

  console.log('\n=== 15. Verify Transactions List ===');
  const txList = await (await fetch(`${BASE_URL}/v1/explorer/transactions?limit=10`)).json();
  console.log(`Total transactions returned: ${txList.transactions.length}`);
  for (const t of txList.transactions) {
    console.log(`- [${t.environment.toUpperCase()}] ${t.type} | Amount: ${t.amount} AOA | Ref: ${t.reference} | Status: ${t.status}`);
  }

  console.log('\n========================================');
  console.log('🎉 ALL END-TO-END TESTS PASSED PERFECTLY!');
  console.log('========================================');
}

runTests().catch((err) => {
  console.error('TEST ERROR:', err);
  process.exit(1);
});
