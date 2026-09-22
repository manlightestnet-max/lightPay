import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Charge le code HTML de l'Explorer Dashboard (100% Read-Only Spot Monitoring)
 */
export function getExplorerHtml(): string {
  const possiblePaths = [
    path.join(__dirname, '..', '..', 'public', 'explorer.html'),
    path.resolve(process.cwd(), 'public', 'explorer.html'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8');
    }
  }

  return '<h1>LightWallet Explorer</h1><p>public/explorer.html not found</p>';
}
