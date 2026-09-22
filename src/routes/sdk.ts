import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'fs';
import path from 'path';

export async function sdkDistributionRoutes(fastify: FastifyInstance) {
  // Chemins vers les fichiers compilés du SDK
  const distSdkJsPath = path.resolve(process.cwd(), 'dist/sdk/client.js');
  const distSdkDtsPath = path.resolve(process.cwd(), 'dist/sdk/client.d.ts');
  const srcSdkTsPath = path.resolve(process.cwd(), 'src/sdk/client.ts');

  /**
   * 1. Servir le client SDK JavaScript (ESM)
   * Accessible publiquement depuis n'importe quelle application cliente ou navigateur
   */
  fastify.get('/client.js', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Content-Type', 'application/javascript; charset=utf-8');
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Cache-Control', 'public, max-age=3600');

    if (fs.existsSync(distSdkJsPath)) {
      const content = fs.readFileSync(distSdkJsPath, 'utf8');
      return reply.send(content);
    }

    return reply.status(404).send('// LightWallet SDK not compiled yet. Run "npm run build".');
  });

  /**
   * 2. Servir les déclarations TypeScript (.d.ts)
   */
  fastify.get('/client.d.ts', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Cache-Control', 'public, max-age=3600');

    if (fs.existsSync(distSdkDtsPath)) {
      const content = fs.readFileSync(distSdkDtsPath, 'utf8');
      return reply.send(content);
    }

    return reply.status(404).send('// LightWallet SDK types not found.');
  });

  /**
   * 3. Informations et guide d'intégration rapide du SDK Cloud
   */
  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    const host = request.headers.host || 'localhost:8080';
    const protocol = request.headers['x-forwarded-proto'] || 'http';
    const baseUrl = `${protocol}://${host}`;

    return reply.send({
      service: 'LightWallet SDK Cloud Distribution',
      version: '1.0.0',
      currency: 'CREDIT',
      cdn: {
        esm_url: `${baseUrl}/v1/sdk/client.js`,
        types_url: `${baseUrl}/v1/sdk/client.d.ts`,
      },
      usage_esm: `import { LightWalletClient } from '${baseUrl}/v1/sdk/client.js';`,
      example: {
        init: `const client = new LightWalletClient({ baseUrl: '${baseUrl}', appId: 'YOUR_APP_ID', apiKey: 'sec_test_...' });`,
        getWallet: `const wallet = await client.getOrCreateWallet({ accountId: 'user_123' });`,
        deposit: `await client.deposit({ accountId: 'user_123', amount: 500, reference: 'TOPUP' });`,
        transfer: `await client.transfer({ fromAccountId: 'user_123', toAccountId: 'merchant_999', amount: 50, note: 'Payment' });`,
        statement: `const history = await client.getStatement(wallet.id);`,
      },
    });
  });
}
