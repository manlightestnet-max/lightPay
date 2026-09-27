/**
 * Static checks of the hosted pages (no server). Run: npx tsx test/pages.check.ts
 * Scripts parse · no style= / on*= attributes (CSP) · every id used by the script exists ·
 * nonce on every <style>/<script> · no external URL except Google identity endpoints.
 */
import { accountPage, connectPage, consolePage, payPage } from '../src/pages/hosted.js';

const NONCE = 'TESTNONCE';
// Ids created at runtime by the shared sign-in form (mountAuth).
const RUNTIME_IDS = new Set(['lp-name', 'lp-email', 'lp-pass']);
let failures = 0;

for (const [name, html] of [
  ['account', accountPage(NONCE, 'sandbox')],
  ['console', consolePage(NONCE, 'sandbox')],
  ['pay', payPage(NONCE, 'cs_test_abcdefghijklmnopqrst', 'sandbox')],
  ['connect', connectPage(NONCE, 'production')],
] as const) {
  const problems: string[] = [];
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  const styles = [...html.matchAll(/<style([^>]*)>/g)];
  for (const [, attrs, code] of scripts) {
    if (!attrs.includes(`nonce="${NONCE}"`)) problems.push('script without nonce');
    try {
      new Function(code);
    } catch (e: any) {
      problems.push(`script does not parse: ${e.message}`);
    }
  }
  for (const [, attrs] of styles) if (!attrs.includes(`nonce="${NONCE}"`)) problems.push('style without nonce');

  const markup = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  if (/\sstyle\s*=/.test(markup)) problems.push('inline style attribute');
  const handler = /\son[a-z]+\s*=/i.exec(markup);
  if (handler) problems.push(`inline event handler attribute (${handler[0].trim()})`);

  const ids = new Set([...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const code = scripts.map((s) => s[2]).join('\n');
  const used = new Set([
    ...[...code.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]),
    ...[...code.matchAll(/getElementById\('([\w-]+)'\)/g)].map((m) => m[1]),
    ...[...code.matchAll(/say\('([\w-]+)'/g)].map((m) => m[1]),
  ]);
  const missing = [...used].filter((id) => !ids.has(id) && !RUNTIME_IDS.has(id));
  if (missing.length) problems.push(`ids used but missing: ${missing.join(', ')}`);

  const urls = [...code.matchAll(/https?:\/\/[^'"\s)]+/g)].map((m) => m[0]).filter((u) => !/^https:\/\/(identitytoolkit|securetoken)\.googleapis\.com\//.test(u));
  if (urls.length) problems.push(`external URLs: ${urls.join(', ')}`);

  console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${name} (${html.length} bytes, ${ids.size} ids)${problems.length ? '  ' + problems.join(' | ') : ''}`);
  if (problems.length) failures++;
}
console.log(failures ? `\n${failures} page(s) failed` : '\nAll page checks passed');
process.exit(failures ? 1 : 0);
