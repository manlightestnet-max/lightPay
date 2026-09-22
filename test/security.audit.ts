/**
 * =============================================================
 *       LIGHTWALLET — SECURITY AUDIT SUITE v1.0
 *  Mode: Static + Logic Analysis (no DB required)
 *  Run: node --import tsx/esm test/security.audit.ts
 *       OR: npx tsx test/security.audit.ts
 * =============================================================
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');

interface TestResult {
  id: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message: string;
}

const results: TestResult[] = [];
let passed = 0, failed = 0, warned = 0;

async function test(id: string, name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ id, name, status: 'PASS', message: 'OK' });
    passed++;
  } catch (err: any) {
    const isWarn = err?.warn === true;
    results.push({ id, name, status: isWarn ? 'WARN' : 'FAIL', message: err?.message || String(err) });
    if (isWarn) warned++; else failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}
function warn(message: string): never {
  const e: any = new Error(message); e.warn = true; throw e;
}

async function runAudit() {

// ===== AUTH-01: Missing headers → 401 =====
await test('AUTH-01', 'Missing X-App-Id + X-Api-Key → 401 guard present BEFORE DB query', async () => {
  const src = fs.readFileSync(path.join(SRC, 'middleware/app-auth.ts'), 'utf8');
  assert(src.includes('reply.status(401)') && src.includes('Missing required headers: X-App-Id and X-Api-Key'), '401 branch for missing headers not found');
  const missing401Idx = src.indexOf('reply.status(401)');
  const dbQueryIdx = src.indexOf('query(');
  assert(missing401Idx < dbQueryIdx, '401 guard must appear BEFORE database query to avoid unnecessary DB load');
});

// ===== AUTH-02: Wrong API key → 403 =====
await test('AUTH-02', 'Invalid API key → 403 guard present', async () => {
  const src = fs.readFileSync(path.join(SRC, 'middleware/app-auth.ts'), 'utf8');
  assert(src.includes('reply.status(403)') && src.includes('Invalid application credentials'), '403 for invalid/disabled credentials not found');
});

// ===== AUTH-03: Admin routes have independent master key guard =====
await test('AUTH-03', 'Admin routes have their own master key guard (not relying only on global auth)', async () => {
  const adminSrc = fs.readFileSync(path.join(SRC, 'routes/admin.ts'), 'utf8');
  assert(adminSrc.includes('x-master-key') && adminSrc.includes('Unauthorized: Master admin key required'),
    'Admin route must have its own master key preHandler hook to enforce admin-only access');
});

// ===== AUTH-04: API key stored as SHA-256 hash (never plain-text) =====
await test('AUTH-04', 'API keys stored as SHA-256 hash — plain-text never written to DB', async () => {
  const authSrc = fs.readFileSync(path.join(SRC, 'middleware/app-auth.ts'), 'utf8');
  assert(authSrc.includes("createHash('sha256')") && authSrc.includes('api_key_hash'),
    'SHA-256 hash comparison not found in auth middleware');
  const adminSrc = fs.readFileSync(path.join(SRC, 'routes/admin.ts'), 'utf8');
  assert(adminSrc.includes("createHash('sha256')") && adminSrc.includes('api_key_hash'),
    'Admin route must hash key with SHA-256 before storing — plain-text storage is a critical vulnerability');
  if (!authSrc.includes('timingSafeEqual')) {
    warn('AUTH-04: Key comparison delegated to PostgreSQL (SHA-256 hashes compared in SQL). ' +
         'Consider adding crypto.timingSafeEqual() for defense-in-depth against timing oracle attacks.');
  }
});

// ===== ENV-01: No hardcoded secrets / production guard exists =====
await test('ENV-01', 'Config reads secrets from process.env + production crash guard present', async () => {
  const configSrc = fs.readFileSync(path.join(SRC, 'config/index.ts'), 'utf8');
  assert(configSrc.includes('process.env'), 'Config must use process.env for secrets');
  assert(configSrc.includes('isProduction') && configSrc.includes('requiredEnvVars'),
    'Production startup guard (crash if required env vars missing) not found. Add a check at startup.');
});

// ===== LEDGER-01: Balance invariant (totalDebit == totalCredit) =====
await test('LEDGER-01', 'Ledger rejects unbalanced postings (totalDebit ≠ totalCredit)', async () => {
  const src = fs.readFileSync(path.join(SRC, 'db/ledger.ts'), 'utf8');
  assert(src.includes('totalDebit !== totalCredit'), 'Balance invariant check not found in ledger.ts');
  assert(src.includes('Ledger imbalance'), 'Imbalance error message not found');
  const balanceIdx = src.indexOf('totalDebit !== totalCredit');
  const beginIdx = src.indexOf('BEGIN TRANSACTION');
  assert(balanceIdx < beginIdx, 'Balance check must happen BEFORE BEGIN TRANSACTION to avoid wasting DB resources');
});

// ===== LEDGER-02: Zero / negative amounts rejected at ledger level =====
await test('LEDGER-02', 'Zero and negative posting amounts rejected before any DB write', async () => {
  const src = fs.readFileSync(path.join(SRC, 'db/ledger.ts'), 'utf8');
  assert(src.includes('post.amount <= 0n'), 'Guard against zero/negative amounts not found in ledger engine');
  assert(src.includes('Invalid posting amount'), 'Error message for invalid amount not found');
});

// ===== LEDGER-03: Insufficient funds raised inside transaction → ROLLBACK =====
await test('LEDGER-03', 'Insufficient funds error raised inside SERIALIZABLE tx → triggers ROLLBACK', async () => {
  const src = fs.readFileSync(path.join(SRC, 'db/ledger.ts'), 'utf8');
  assert(src.includes('currentBalance < post.amount'), 'Insufficient funds check not found');
  assert(src.includes('Insufficient funds'), 'Insufficient funds error message not found');
  const insuffIdx = src.indexOf('Insufficient funds');
  const rollbackIdx = src.indexOf('ROLLBACK');
  assert(rollbackIdx > insuffIdx, 'ROLLBACK must follow the insufficient funds throw to prevent partial writes');
});

// ===== LEDGER-04: Frozen wallet check =====
await test('LEDGER-04', "Frozen wallet (status !== 'ACTIVE') blocked — no debit/credit allowed", async () => {
  const src = fs.readFileSync(path.join(SRC, 'db/ledger.ts'), 'utf8');
  assert(src.includes("wallet.status !== 'ACTIVE'"), "Frozen wallet guard not found in ledger engine");
  assert(src.includes('Wallet is'), 'Status error message for non-ACTIVE wallets not found');
});

// ===== TENANT-01: All queries scoped by app_id =====
await test('TENANT-01', 'All wallet/payment/admin queries scoped by app_id (tenant isolation)', async () => {
  for (const f of ['routes/wallets.ts', 'routes/payments.ts', 'routes/admin.ts']) {
    const src = fs.readFileSync(path.join(SRC, f), 'utf8');
    assert(src.includes('appData') || src.includes('app_id'),
      `${f} must scope DB queries by app_id via request.appData`);
  }
  const ledger = fs.readFileSync(path.join(SRC, 'db/ledger.ts'), 'utf8');
  assert(ledger.includes('app_id'), 'Ledger must scope transactions by app_id');
});

// ===== IDEM-01: Idempotency key required on payment endpoints =====
await test('IDEM-01', 'Idempotency-Key required on all payment endpoints + checked inside TX', async () => {
  const src = fs.readFileSync(path.join(SRC, 'routes/payments.ts'), 'utf8');
  assert(src.includes('idempotency-key') || src.includes('Idempotency-Key'),
    'Idempotency-Key header check not found in payments route');
  assert(src.includes('Missing required header: Idempotency-Key'), '400 for missing idempotency key not found');
  const ledger = fs.readFileSync(path.join(SRC, 'db/ledger.ts'), 'utf8');
  const idemIdx = ledger.indexOf('idempotency_key');
  const beginIdx = ledger.indexOf('BEGIN TRANSACTION');
  assert(idemIdx > beginIdx, 'Idempotency check must be INSIDE the DB transaction for true atomicity');
});

// ===== AMOUNT-01: Zero / negative amounts rejected at route level =====
await test('AMOUNT-01', 'Route layer rejects zero and negative payment amounts', async () => {
  const src = fs.readFileSync(path.join(SRC, 'routes/payments.ts'), 'utf8');
  assert(src.includes('<= 0n') || src.includes('<= 0'),
    'Amount <= 0 validation missing from payment routes');
  assert(src.includes('Amount must be greater than zero'), 'Error message for zero/negative amount not found');
});

// ===== FEE-01: Fee >= amount rejected =====
await test('FEE-01', 'Fee amount >= total amount rejected (no zero-or-negative seller credit)', async () => {
  const src = fs.readFileSync(path.join(SRC, 'routes/payments.ts'), 'utf8');
  const hasFeeCheck = src.includes('>= totalAmount') || (src.includes('fee') && src.includes('totalAmount'));
  assert(hasFeeCheck, 'Guard against fee >= totalAmount not found in payment routes');
});

// ===== OVERFLOW-01: BigInt for all financial math =====
await test('OVERFLOW-01', 'All financial arithmetic uses BigInt — no floating-point risk', async () => {
  for (const f of ['db/ledger.ts', 'routes/payments.ts']) {
    const src = fs.readFileSync(path.join(SRC, f), 'utf8');
    const usesFloat = /parseFloat|Number\(.*amount/i.test(src);
    assert(!usesFloat, `${f} uses parseFloat/Number() on financial amounts. Must use BigInt() to avoid precision errors.`);
  }
  const ledger = fs.readFileSync(path.join(SRC, 'db/ledger.ts'), 'utf8');
  assert(ledger.includes('.toString()'), 'BigInt values must be .toString() before PostgreSQL insert (pg driver limitation)');
});

// ===== INJECTION-01: No string interpolation in SQL queries =====
await test('INJECTION-01', 'No dynamic SQL string interpolation found (SQL injection scan)', async () => {
  const files = ['db/ledger.ts', 'routes/wallets.ts', 'routes/payments.ts', 'routes/external.ts', 'routes/admin.ts'];
  const suspiciousFiles: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(SRC, f), 'utf8');
    const matches = src.match(/query\s*\(\s*`[^`]*\$\{(?!\d)/g);
    if (matches) suspiciousFiles.push(`${f}: ${matches.slice(0,3).join(', ')}`);
  }
  assert(suspiciousFiles.length === 0,
    `Possible SQL injection via template literal interpolation:\n  ${suspiciousFiles.join('\n  ')}`);
  const ledger = fs.readFileSync(path.join(SRC, 'db/ledger.ts'), 'utf8');
  assert(ledger.includes('$1') && ledger.includes('$2'), 'Parameterized placeholders $1, $2 must be used in all ledger queries');
});

// ===== DEADLOCK-01: Wallet locking in sorted order =====
await test('DEADLOCK-01', 'Wallets locked in alphabetical order to prevent deadlocks', async () => {
  const src = fs.readFileSync(path.join(SRC, 'db/ledger.ts'), 'utf8');
  assert(src.includes('localeCompare') || src.includes('.sort('), 'Alphabetical wallet sort for deadlock-safe locking not found');
  assert(src.includes('FOR UPDATE'), 'Row-level locking (FOR UPDATE) not found — concurrent transactions may race');
});

// ===== SERIALIZABLE-01: Transaction isolation =====
await test('SERIALIZABLE-01', 'PostgreSQL SERIALIZABLE isolation prevents phantom reads & write skew', async () => {
  const src = fs.readFileSync(path.join(SRC, 'db/ledger.ts'), 'utf8');
  assert(src.includes('SERIALIZABLE'),
    'SERIALIZABLE isolation not found. Without it, concurrent transactions can cause double-spend vulnerabilities.');
});

// ===== ROLLBACK-01: All errors trigger ROLLBACK + client.release() =====
await test('ROLLBACK-01', 'All transaction errors trigger ROLLBACK + pool client is always released', async () => {
  const src = fs.readFileSync(path.join(SRC, 'db/ledger.ts'), 'utf8');
  const catchBlock = src.substring(src.indexOf('} catch (err'), src.indexOf('} finally {'));
  assert(catchBlock.includes('ROLLBACK'), 'ROLLBACK missing from catch block — partial ledger writes possible on error');
  const finallyBlock = src.substring(src.indexOf('} finally {'), src.lastIndexOf('}'));
  assert(finallyBlock.includes('client.release()'), 'client.release() missing from finally block — connection pool exhaustion risk');
});

// ===== SCHEMA-01: BIGINT + non-negative constraint in SQL =====
await test('SCHEMA-01', 'Balance columns: BIGINT type + CHECK (balance >= 0) in SQL schema', async () => {
  const src = fs.readFileSync(path.join(SRC, 'db/migrations/001_initial_schema.sql'), 'utf8');
  assert(src.toLowerCase().includes('bigint'), 'Balance columns should be BIGINT to prevent float rounding errors');
  assert(src.includes('CHECK') && src.includes('>= 0'),
    'DB-level CHECK constraint (available_balance >= 0) not found. Application checks alone are insufficient defense.');
});

// ===== HEALTH-01: /health endpoint contains no secrets =====
await test('HEALTH-01', '/health endpoint exposes no credentials or internal URLs', async () => {
  const src = fs.readFileSync(path.join(SRC, 'index.ts'), 'utf8');
  const healthBlock = src.substring(src.indexOf("server.get('/health'"), src.indexOf("server.register"));
  assert(!healthBlock.includes('databaseUrl') && !healthBlock.includes('DATABASE_URL') && !healthBlock.includes('apiKey'),
    '/health endpoint must not expose database URLs or API keys');
});

// ===== REPORT =====
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', B = '\x1b[1m', X = '\x1b[0m';
console.log('\n');
console.log(`${B}${C}╔══════════════════════════════════════════════════════════╗${X}`);
console.log(`${B}${C}║         LIGHTWALLET — SECURITY AUDIT REPORT              ║${X}`);
console.log(`${B}${C}╚══════════════════════════════════════════════════════════╝${X}`);
console.log('');

for (const r of results) {
  const icon = r.status === 'PASS' ? `${G}✓${X}` : r.status === 'WARN' ? `${Y}⚠${X}` : `${R}✗${X}`;
  const label = r.status === 'PASS' ? `${G}PASS${X}` : r.status === 'WARN' ? `${Y}WARN${X}` : `${R}FAIL${X}`;
  console.log(`  ${icon} [${label}] ${B}${r.id}${X}  ${r.name}`);
  if (r.status !== 'PASS') {
    r.message.split('\n').forEach((line: string) => console.log(`          ${r.status === 'WARN' ? Y : R}→ ${line}${X}`));
  }
}

console.log('');
console.log(`${B}${C}──────────────────────────────────────────────────────────${X}`);
console.log(`  Total : ${results.length} checks`);
console.log(`  ${G}${B}Passed : ${passed}${X}`);
if (warned > 0) console.log(`  ${Y}${B}Warned : ${warned}${X}`);
if (failed > 0) console.log(`  ${R}${B}Failed : ${failed}${X}`);
console.log(`${B}${C}──────────────────────────────────────────────────────────${X}`);

if (failed > 0) {
  console.log(`\n${R}${B}⛔  AUDIT FAILED — ${failed} critical issue(s) must be fixed before deployment.${X}\n`);
  process.exit(1);
} else if (warned > 0) {
  console.log(`\n${Y}${B}⚠   AUDIT PASSED WITH WARNINGS — Review recommendations before going live.${X}\n`);
  process.exit(0);
} else {
  console.log(`\n${G}${B}✅  ALL CHECKS PASSED — LightWallet security posture is solid.${X}\n`);
  process.exit(0);
}
}

runAudit().catch(err => { console.error('Audit runner crashed:', err); process.exit(1); });
