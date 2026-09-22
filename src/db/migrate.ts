import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';
import { prodPool, sandboxPool } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrationsOnTarget(targetPool: Pool, dbName: string) {
  console.log(`[MIGRATION] Starting migrations for [${dbName}]...`);

  const possibleDirs = [
    path.resolve(process.cwd(), 'src', 'db', 'migrations'),
    path.join(__dirname, '..', '..', 'src', 'db', 'migrations'),
    path.join(__dirname, 'migrations'),
  ];

  const migrationsDir = possibleDirs.find((d) => fs.existsSync(d) && fs.readdirSync(d).length >= 4) ||
                        possibleDirs.find((d) => fs.existsSync(d));

  if (!migrationsDir) {
    throw new Error(`Migrations directory not found in any of: ${possibleDirs.join(', ')}`);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    let sql = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');

    let attempts = 0;
    const maxAttempts = 3;
    let applied = false;

    while (attempts < maxAttempts && !applied) {
      try {
        attempts++;
        await targetPool.query(sql);
        console.log(`[MIGRATION SUCCESS] Applied ${file} on [${dbName}]`);
        applied = true;
      } catch (err: any) {
        if (attempts < maxAttempts && (err.message.includes('timeout') || err.message.includes('terminated') || err.code === 'EAI_AGAIN' || err.message.includes('getaddrinfo') || err.message.includes('ECONNRESET'))) {
          console.warn(`[MIGRATION WARN] Attempt ${attempts} failed for ${file} on [${dbName}] (${err.message}). Retrying in 3s...`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
        } else {
          console.error(`[MIGRATION ERROR] Failed to apply ${file} on [${dbName}]:`, err.message);
          throw err;
        }
      }
    }
  }

  console.log(`[MIGRATION COMPLETE] Schema migrations up to date for [${dbName}].`);
}

export async function runMigrations() {
  // 1. Migration sur la base de PRODUCTION
  await runMigrationsOnTarget(prodPool, 'PRODUCTION: lightwallet');

  // 2. Migration sur la base SANDBOX physique séparée
  await runMigrationsOnTarget(sandboxPool, 'SANDBOX: lightwallet_sandbox');
}

// Si exécuté directement via `npm run migrate`
if (process.argv[1] === __filename) {
  runMigrations()
    .then(async () => {
      await prodPool.end();
      await sandboxPool.end();
    })
    .catch(async (err) => {
      console.error(err);
      await prodPool.end();
      await sandboxPool.end();
      process.exit(1);
    });
}
