import { Pool, PoolClient } from 'pg';
import { config } from '../config/index.js';
import { Environment } from '../types/index.js';

const isCloudProd = config.databaseUrl.includes('neon.tech') || config.databaseUrl.includes('sslmode=require');
const isCloudSandbox = config.databaseUrlSandbox.includes('neon.tech') || config.databaseUrlSandbox.includes('sslmode=require');

export const prodPool = new Pool({
  connectionString: config.databaseUrl,
  ssl: (config.isProduction || isCloudProd) ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
});

export const sandboxPool = new Pool({
  connectionString: config.databaseUrlSandbox,
  ssl: (config.isProduction || isCloudSandbox) ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
});

prodPool.on('error', (err) => {
  console.error('[DATABASE ERROR: PROD] Unexpected error on idle client', err);
});

sandboxPool.on('error', (err) => {
  console.error('[DATABASE ERROR: SANDBOX] Unexpected error on idle client', err);
});

// Default pool for production
export const pool = prodPool;

export function getPool(environment: Environment = 'production'): Pool {
  return environment === 'sandbox' ? sandboxPool : prodPool;
}

export async function query<T = any>(text: string, params?: any[], environment: Environment = 'production'): Promise<T[]> {
  const targetPool = getPool(environment);
  const res = await targetPool.query(text, params);
  return res.rows;
}

export async function getClient(environment: Environment = 'production'): Promise<PoolClient> {
  const targetPool = getPool(environment);
  return await targetPool.connect();
}
