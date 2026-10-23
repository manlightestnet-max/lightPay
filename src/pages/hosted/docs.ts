import { CSS } from './design.js';
import { FAVICON_PNG } from './brand.js';
import { iconSvg } from './icons.js';
import { brandMarkup, themeToggle } from './shell.js';

/**
 * /docs — the developer documentation, public. A scaffold like the console: the top bar and the section list stay put,
 * only the article scrolls. Everything written here is what the API does today (routes in src/routes/*): when an
 * endpoint changes, this page changes with it.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const code = (lang: string, text: string) =>
  `<div class="code"><div class="code-head"><span>${esc(lang)}</span><button class="code-copy" type="button" data-copy aria-label="Copier">${iconSvg('copy')}<span>Copier</span></button></div><pre><code>${esc(text.trim())}</code></pre></div>`;

const table = (head: string[], rows: string[][]) =>
  `<div class="tbl-wrap"><table class="doc-tbl"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => `<td>${i === 0 ? `<code>${esc(c)}</code>` : c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;

const endpoint = (method: string, path: string, what: string) =>
  `<div class="ep"><span class="ep-m ep-${method.toLowerCase()}">${method}</span><code>${esc(path)}</code><span class="ep-what">${what}</span></div>`;

const note = (text: string) => `<div class="doc-note">${iconSvg('info')}<p>${text}</p></div>`;

interface Section {
  id: string;
  group: string;
  title: string;
  body: string;
}

const sections = (api: string, checkout: string): Section[] => [
  {
    id: 'demarrer',
    group: 'Démarrer',
    title: 'Introduction',
    body: `
<p class="lead">LightPay encaisse et verse de l’argent par mobile money (MTN MoMo, Airtel Money, Orange Money…) au Congo-Brazzaville et dans les autres pays qu’il ouvre, en FCFA, avec un wallet pour chaque personne et un grand livre en partie double. Votre application l’utilise depuis son serveur, avec sa clé secrète.</p>
<h3>Deux façons d’encaisser</h3>
<ul>
  <li><b>Vous vendez vous-même</b> (marchand direct) : vous créez une session de paiement sans <code>payee</code>, l’argent arrive sur le wallet de votre app.</li>
  <li><b>Vous êtes une place de marché</b> : chaque vendeur connecte son wallet LightPay à votre app (LightPay Connect, permission <code>payee</code>) ; vous créez la session pour ce vendeur, avec votre commission et, si vous voulez, un séquestre.</li>
</ul>
<h3>Adresses</h3>
${table(['Adresse', 'Rôle'], [
  [api, 'API (depuis votre serveur, clé secrète).'],
  [checkout, 'Pages de paiement et script <code>lightpay.js</code> (côté client).'],
])}`,
  },
  {
    id: 'pays',
    group: 'Démarrer',
    title: 'Pays et opérateurs',
    body: `
<p>Les pays et les opérateurs ouverts se lisent à tout moment, sans clé : la page de paiement et le compte LightPay les proposent d’eux-mêmes (le pays, puis l’opérateur, puis le numéro).</p>
${endpoint('GET', '/v1/checkout/public/rails', 'Pays ouverts (indicatif, format du numéro, monnaie) et leurs opérateurs (<code>network</code>, nom, préfixes).')}
<p>Le franc CFA est une seule unité dans LightPay : 1 XOF = 1 XAF, sans frais de change. Une session reste en <code>XAF</code> ; un paiement depuis la Côte d’Ivoire ou le Togo est encaissé en XOF pour le même montant.</p>
${table(['Pays', 'Indicatif', 'Opérateurs (network)'], [
  ['Congo-Brazzaville', '+242', '<code>MTN_MOMO_COG</code>, <code>AIRTEL_COG</code>'],
  ['Cameroun', '+237', '<code>MTN_MOMO_CMR</code>, <code>ORANGE_CMR</code>'],
  ['Côte d’Ivoire', '+225', '<code>MTN_MOMO_CIV</code>, <code>MOOV_CIV</code>'],
  ['Togo', '+228', '<code>TMONEY_TGO</code>, <code>MOOV_TGO</code>'],
  ['Gabon', '+241', '<code>AIRTEL_GAB</code>, <code>MOOV_GAB</code>'],
])}
${note('Seuls les pays ouverts par LightPay acceptent des paiements : lisez la route ci-dessus plutôt que ce tableau. Un numéro s’écrit avec l’indicatif de son pays (<code>237691234567</code>) ; sans indicatif, il est lu dans le pays de l’opérateur choisi.')}`,
  },
  {
    id: 'cles',
    group: 'Démarrer',
    title: 'Clés et environnements',
    body: `
<p>Les clés se créent dans la console LightPay (Compte → mode avancé → Développeurs). Chaque app a deux clés secrètes et deux grands livres séparés :</p>
${table(['Préfixe', 'Grand livre'], [
  ['sec_test_…', 'Test (sandbox) : de l’argent de test, des opérateurs de test. Rien de réel.'],
  ['sec_live_…', 'Réel (production) : de vrais encaissements et de vrais envois.'],
])}
<p>La clé choisit le grand livre : la même requête avec <code>sec_test_</code> ne touche jamais l’argent réel. Une clé secrète ne quitte jamais votre serveur.</p>
${note('Le secret des webhooks (<code>whsec_…</code>) est différent de la clé : il sert seulement à vérifier les signatures.')}`,
  },
  {
    id: 'auth',
    group: 'Démarrer',
    title: 'Authentification et idempotence',
    body: `
<p>Chaque requête porte la clé secrète. Chaque écriture porte une clé d’idempotence : la même clé renvoie le même résultat, jamais un deuxième paiement.</p>
${code('HTTP', `POST ${api}/v1/checkout/sessions
Authorization: Bearer sec_test_…
Idempotency-Key: 8f0c2b1e-commande-1042
Content-Type: application/json`)}
<p>Montants : en FCFA entiers, envoyés en nombre ou en chaîne (<code>"5000"</code>). Les réponses renvoient les montants en chaînes.</p>`,
  },
  {
    id: 'checkout',
    group: 'Encaisser',
    title: 'Session de paiement',
    body: `
${endpoint('POST', '/v1/checkout/sessions', 'Crée une session et renvoie sa page de paiement.')}
${table(['Champ', 'Description'], [
  ['amount', '<b>Obligatoire.</b> Montant à encaisser, en FCFA.'],
  ['payee', 'Facultatif. <code>conn_…</code> d’un vendeur connecté avec la permission <code>payee</code>. Sans lui, l’argent va au wallet de votre app.'],
  ['fee_amount', 'Votre commission sur le vendeur (avec <code>payee</code> seulement), inférieure au montant.'],
  ['escrow', 'Séquestre : l’argent reste bloqué jusqu’à ce que vous le libériez. Par défaut <code>true</code> avec <code>payee</code>, <code>false</code> sans.'],
  ['reference', 'Votre référence (numéro de commande), renvoyée dans les webhooks.'],
  ['description', 'Ce que la personne voit sur la page de paiement.'],
  ['methods', '<code>["mobile_money", "lightpay_wallet"]</code> par défaut.'],
  ['return_url · cancel_url', 'Adresses https de retour après paiement ou abandon.'],
  ['expires_in_minutes', 'De 5 à 1440, 30 par défaut.'],
  ['metadata', 'Objet libre, renvoyé tel quel.'],
])}
${code('Node.js', `const res = await fetch('${api}/v1/checkout/sessions', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + process.env.LIGHTPAY_SECRET_KEY,
    'Idempotency-Key': 'commande-1042',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ amount: 5000, reference: 'CMD-1042', description: 'Guide pratique' }),
});
const { session } = await res.json();
// session.checkout_url : la page de paiement LightPay`)}
<h3>Réponse</h3>
${code('JSON', `{
  "status": "success",
  "duplicate": false,
  "session": {
    "id": "cs_test_…",
    "status": "OPEN",
    "amount": "5000",
    "fee_amount": "0",
    "currency": "XAF",
    "reference": "CMD-1042",
    "escrow": false,
    "payee": null,
    "checkout_url": "${checkout}/pay/cs_test_…",
    "expires_at": "…"
  }
}`)}
${endpoint('GET', '/v1/checkout/sessions/:id', 'Lit l’état d’une session (OPEN, COMPLETED, EXPIRED, CANCELLED).')}
${endpoint('POST', '/v1/checkout/sessions/:id/cancel', 'Annule une session encore ouverte.')}
${note('Ne livrez jamais sur la seule foi du navigateur : confirmez le paiement depuis votre serveur, par le webhook signé ou en lisant la session.')}`,
  },
  {
    id: 'page',
    group: 'Encaisser',
    title: 'Page de paiement dans votre site',
    body: `
<p>Redirigez la personne vers <code>checkout_url</code>, ou ouvrez la page dans une fenêtre au-dessus de votre site avec <code>lightpay.js</code>. La page reste sur le domaine de LightPay : votre site l’ouvre et la ferme, sans jamais la lire.</p>
${code('HTML', `<script src="${checkout}/lightpay.js"></script>
<script>
  const result = await LightPay.pay(checkoutUrl);            // { status: 'completed' | 'closed', session }
  LightPay.pay(checkoutUrl, { theme: 'dark' });              // la fenêtre dans le thème de votre site
</script>`)}
<p>La fenêtre ne s’ouvre que sur les sites déclarés par votre app (console → Développeurs) ; ailleurs, la page s’ouvre en plein écran. <code>completed</code> sert seulement à l’interface : la preuve du paiement reste le webhook.</p>`,
  },
  {
    id: 'webhooks',
    group: 'Encaisser',
    title: 'Webhooks',
    body: `
<p>LightPay envoie chaque événement à l’adresse de votre app, en <code>POST</code> JSON, puis réessaie s’il n’obtient pas une réponse 2xx (après 2 s, 10 s et 1 min).</p>
${table(['Événement', 'Quand'], [
  ['checkout.completed', 'Une session de paiement est payée.'],
  ['deposit.completed', 'Un dépôt sur un wallet connecté est arrivé.'],
  ['checkout.payment_failed', 'Une tentative de paiement a échoué (la session reste ouverte).'],
  ['refund.sent', 'Un remboursement est parti vers le numéro qui avait payé.'],
  ['refund.failed', 'Un remboursement a été refusé par l’opérateur.'],
  ['ping', 'Envoyé depuis la console pour tester votre adresse.'],
])}
${code('JSON', `{
  "id": "evt_…",
  "type": "checkout.completed",
  "environment": "sandbox",
  "created": "…",
  "data": {
    "session_id": "cs_test_…",
    "reference": "CMD-1042",
    "amount": "5000",
    "fee_amount": "0",
    "currency": "XAF",
    "escrow": false,
    "hold_id": null,
    "payer": { "type": "guest", "network": "MTN_MOMO_COG" },
    "metadata": {}
  }
}`)}
<h3>Vérifier la signature</h3>
<p>En-tête <code>LightPay-Signature: t=&lt;secondes&gt;,v1=&lt;HMAC-SHA256 hex de « t.corps »&gt;</code>, calculé avec le secret <code>whsec_…</code> sur le corps brut. Refusez les horodatages trop anciens.</p>
${code('Node.js', `import crypto from 'crypto';

function verifyLightPay(rawBody, header, secret, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = crypto.createHmac('sha256', secret).update(t + '.' + rawBody).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(parts.v1 || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}`)}`,
  },
  {
    id: 'sequestre',
    group: 'Place de marché',
    title: 'Séquestre',
    body: `
<p>Avec <code>escrow</code>, l’argent payé est bloqué sur le wallet du vendeur. Votre serveur décide ensuite : verser au vendeur (votre commission part à ce moment-là) ou rendre à l’acheteur. Un acheteur qui a payé par mobile money est remboursé sur le numéro qui a payé, moins les frais de retrait ; un acheteur qui a payé par wallet LightPay est remboursé en totalité.</p>
${endpoint('GET', '/v1/holds/:hold_id', 'État du séquestre.')}
${endpoint('POST', '/v1/holds/:hold_id/capture', 'Verse au vendeur.')}
${endpoint('POST', '/v1/holds/:hold_id/release', 'Rend à l’acheteur.')}
${endpoint('POST', '/v1/holds/:hold_id/dispute', 'Gèle le séquestre (<code>{ "reason": "…" }</code>) : seule une décision explicite le débloque ensuite (<code>resolve_dispute: true</code>).')}
${endpoint('GET', '/v1/checkout/refund-quote?amount=', 'Ce qu’un acheteur mobile money récupérerait, opérateur par opérateur (ceux des pays ouverts).')}`,
  },
  {
    id: 'connect',
    group: 'Place de marché',
    title: 'LightPay Connect',
    body: `
<p>Une personne autorise votre app à utiliser son wallet LightPay, avec des permissions précises. Flux OAuth 2 « authorization code » avec PKCE (S256).</p>
${table(['Permission', 'Ce que votre app peut faire'], [
  ['payee', 'Recevoir des paiements pour cette personne (vendeur).'],
  ['balance:read', 'Lire son solde et ses mouvements.'],
  ['deposit', 'Lui proposer un dépôt par mobile money.'],
  ['charge', 'Débiter son wallet, dans la limite qu’elle a choisie.'],
])}
<h3>1. Demander l’autorisation</h3>
${code('URL', `${checkout}/connect?app_id=votre_app&scope=payee%20balance:read&redirect_uri=https%3A%2F%2Fvotre-site%2Fretour&code_challenge=…&state=…`)}
<p>Déclarez d’abord vos adresses de retour : ${endpoint('PUT', '/v1/apps/redirect-uris', '<code>{ "redirect_uris": ["https://…"] }</code>')}</p>
<h3>2. Échanger le code</h3>
${endpoint('POST', '/v1/connect/token', '<code>{ code, redirect_uri, code_verifier }</code> → la connexion <code>conn_…</code>.')}
<h3>3. Utiliser la connexion</h3>
${endpoint('GET', '/v1/connections/:id', 'Permissions et compte.')}
${endpoint('GET', '/v1/connections/:id/balance', 'Solde (balance:read).')}
${endpoint('GET', '/v1/connections/:id/transactions', 'Mouvements (balance:read).')}
${endpoint('POST', '/v1/connections/:id/deposits', 'Dépôt (deposit) → <code>checkout_url</code>.')}
${endpoint('POST', '/v1/connections/:id/charges', 'Débit (charge) : <code>{ amount, payee?, fee_amount?, escrow?, reference, description }</code>. Sans <code>payee</code>, vers le wallet de votre app.')}
${note('Au-dessus de la limite choisie par la personne, le débit est refusé (<code>ABOVE_CHARGE_LIMIT</code>) : créez alors une session de paiement.')}
<p>Une personne peut tenir plusieurs wallets LightPay. Une connexion utilise le wallet qui était son wallet par défaut quand elle a autorisé votre app : le solde, les mouvements, les dépôts et les débits de cette connexion sont ceux de ce wallet.</p>`,
  },
  {
    id: 'frais',
    group: 'Référence',
    title: 'Frais',
    body: `
<p>Les frais sont réglés par LightPay et peuvent changer : lisez-les par l’API plutôt que de les écrire en dur.</p>
<ul>
  <li><b>Paiement et dépôt par mobile money</b> : les frais de LightPay et de l’opérateur s’ajoutent au montant, payés par la personne. Vous recevez le montant demandé. Les frais d’opérateur dépendent du pays et de l’opérateur : la page de paiement les affiche pour chacun avant que la personne paie.</li>
  <li><b>Paiement par wallet LightPay</b> : sans frais pour la personne.</li>
  <li><b>Remboursement vers un numéro</b> : il coûte comme un retrait (opérateur + LightPay), déduit du remboursement.</li>
</ul>`,
  },
  {
    id: 'erreurs',
    group: 'Référence',
    title: 'Erreurs',
    body: `
<p>Une erreur répond avec un code HTTP 4xx et un corps stable :</p>
${code('JSON', `{ "status": "error", "error": "INVALID_AMOUNT", "message": "amount must be greater than zero" }`)}
${table(['Code', 'Sens'], [
  ['INVALID_AMOUNT', 'Montant manquant, nul ou invalide.'],
  ['INVALID_FEE', '<code>fee_amount</code> négatif ou supérieur au montant.'],
  ['FEE_WITHOUT_PAYEE', 'Une commission demande un vendeur (<code>payee</code>).'],
  ['INSUFFICIENT_FUNDS', 'Solde insuffisant (402).'],
  ['SESSION_NOT_FOUND', 'Session inconnue (404).'],
  ['SESSION_NOT_OPEN', 'La session n’est plus ouverte (409).'],
  ['CONNECTION_NOT_FOUND · CONNECTION_REVOKED', 'Connexion inconnue ou retirée par la personne.'],
  ['ABOVE_CHARGE_LIMIT', 'Au-dessus de la limite de débit choisie par la personne (403).'],
  ['INVALID_GRANT · INVALID_PKCE', 'Code d’autorisation ou vérificateur PKCE invalide.'],
  ['PROVIDER_NOT_CONFIGURED', 'Mobile money momentanément indisponible (503) : réessayez plus tard.'],
])}`,
  },
  {
    id: 'reference',
    group: 'Référence',
    title: 'Toutes les routes',
    body: `
${endpoint('POST', '/v1/checkout/sessions', 'Créer une session de paiement')}
${endpoint('GET', '/v1/checkout/sessions/:id', 'Lire une session')}
${endpoint('POST', '/v1/checkout/sessions/:id/cancel', 'Annuler une session')}
${endpoint('GET', '/v1/checkout/refund-quote', 'Remboursement estimé')}
${endpoint('GET', '/v1/checkout/public/rails', 'Pays et opérateurs ouverts (public)')}
${endpoint('GET', '/v1/holds/:hold_id', 'Lire un séquestre')}
${endpoint('POST', '/v1/holds/:hold_id/capture', 'Verser au vendeur')}
${endpoint('POST', '/v1/holds/:hold_id/release', 'Rendre à l’acheteur')}
${endpoint('POST', '/v1/holds/:hold_id/dispute', 'Geler pour litige')}
${endpoint('PUT', '/v1/apps/redirect-uris', 'Adresses de retour Connect')}
${endpoint('POST', '/v1/connect/token', 'Échanger un code Connect')}
${endpoint('GET', '/v1/connections/:id', 'Lire une connexion')}
${endpoint('GET', '/v1/connections/:id/balance', 'Solde')}
${endpoint('GET', '/v1/connections/:id/transactions', 'Mouvements')}
${endpoint('POST', '/v1/connections/:id/deposits', 'Dépôt')}
${endpoint('POST', '/v1/connections/:id/charges', 'Débit')}`,
  },
];

const DOCS_CSS = `
html, body { height: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); overflow: hidden; }
.docs { display: grid; grid-template-rows: 56px 1fr; height: 100vh; height: 100dvh; }
.docs-top { display: flex; align-items: center; gap: 12px; padding: 0 16px 0 20px; border-bottom: 1px solid var(--line); background: var(--bg); }
.docs-top .brand { font-size: 16px; }
.docs-top .docs-label { font-size: 13px; font-weight: 650; color: var(--muted); padding-left: 12px; border-left: 1px solid var(--line); }
.docs-search { margin-left: auto; width: min(320px, 40vw); height: 36px; border-radius: 10px; border: 1px solid var(--line-strong); background: var(--card); color: var(--text); padding: 0 12px; font: inherit; font-size: 14px; }
.docs-body { display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 0; }
.docs-nav { overflow-y: auto; border-right: 1px solid var(--line); background: var(--card); padding: 14px 12px 24px; scrollbar-width: none; }
.docs-nav::-webkit-scrollbar { display: none; }
.docs-nav h4 { margin: 16px 10px 6px; font-size: 11px; font-weight: 650; color: var(--faint); letter-spacing: .02em; text-transform: uppercase; }
.docs-nav a { display: block; padding: 7px 10px; border-radius: 9px; color: var(--muted); text-decoration: none; font-size: 14px; font-weight: 550; }
.docs-nav a:hover { background: var(--raised); color: var(--text); }
.docs-nav a[aria-current="true"] { background: var(--accent-soft); color: var(--accent-ink); font-weight: 650; }
.docs-main { overflow-y: auto; overscroll-behavior: contain; scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { .docs-main { scroll-behavior: auto; } }
.docs-article { max-width: 820px; margin: 0 auto; padding: 32px 32px 96px; }
.doc-sec { padding-top: 8px; margin-bottom: 48px; scroll-margin-top: 16px; }
.doc-sec h2 { font-size: 24px; font-weight: 750; letter-spacing: -.02em; margin: 0 0 14px; }
.doc-sec h3 { font-size: 16px; font-weight: 700; margin: 24px 0 8px; }
.doc-sec p, .doc-sec li { font-size: 15px; line-height: 1.65; color: var(--text); }
.doc-sec p.lead { font-size: 16px; color: var(--muted); }
.doc-sec ul { padding-left: 20px; }
.doc-sec code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; padding: 1px 6px; border-radius: 6px; background: var(--raised); }
.code { margin: 14px 0; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; background: var(--card); }
.code-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px 6px 14px; border-bottom: 1px solid var(--line); font-size: 12px; font-weight: 650; color: var(--muted); }
.code-copy { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; color: var(--muted); font: inherit; font-size: 12px; padding: 4px 8px; border-radius: 8px; cursor: pointer; }
.code-copy:hover { background: var(--raised); color: var(--text); }
.code-copy svg { width: 14px; height: 14px; }
.code pre { margin: 0; padding: 14px; overflow-x: auto; }
.code pre code { padding: 0; background: none; font-size: 13px; line-height: 1.6; white-space: pre; }
.tbl-wrap { overflow-x: auto; margin: 14px 0; border: 1px solid var(--line); border-radius: 14px; }
.doc-tbl { width: 100%; border-collapse: collapse; font-size: 14px; }
.doc-tbl th { text-align: left; font-size: 11px; font-weight: 650; color: var(--faint); text-transform: uppercase; letter-spacing: .03em; padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--card); }
.doc-tbl td { padding: 10px 14px; border-bottom: 1px solid var(--line); vertical-align: top; line-height: 1.55; }
.doc-tbl tr:last-child td { border-bottom: 0; }
.doc-tbl td:first-child { white-space: nowrap; }
.ep { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
.ep code { font-size: 13px; }
.ep-m { min-width: 54px; text-align: center; font-size: 11px; font-weight: 750; letter-spacing: .03em; padding: 3px 8px; border-radius: 999px; background: var(--raised); color: var(--muted); }
.ep-post { background: var(--accent-soft); color: var(--accent-ink); }
.ep-get { color: var(--text); }
.ep-put, .ep-patch { background: var(--warn-soft); color: var(--warn); }
.ep-delete { background: var(--danger-soft); color: var(--danger); }
.ep-what { color: var(--muted); }
.doc-note { display: flex; gap: 10px; align-items: flex-start; margin: 16px 0; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--card); }
.doc-note svg { width: 18px; height: 18px; flex-shrink: 0; margin-top: 3px; color: var(--accent-ink); }
.doc-note p { margin: 0; font-size: 14px; }
.doc-sec[hidden] { display: none; }
.docs-empty { color: var(--muted); font-size: 15px; }
.menu-btn { display: none; }
@media (max-width: 860px) {
  .docs-body { grid-template-columns: 1fr; }
  .docs-nav { position: fixed; inset: 56px 0 0 0; z-index: 20; transform: translateX(-100%); transition: transform .2s var(--ease); width: 280px; border-right: 1px solid var(--line); }
  .docs-nav.open { transform: none; }
  .menu-btn { display: inline-flex; }
  .docs-top .docs-label { display: none; }
  .docs-article { padding: 24px 16px 80px; }
}
@media (prefers-reduced-motion: reduce) { .docs-nav { transition: none; } }
`;

const SCRIPT = `
var root = document.documentElement;
document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
  b.addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('lightpay.theme', next); } catch (e) {}
  });
});
document.querySelectorAll('[data-copy]').forEach(function (b) {
  b.addEventListener('click', function () {
    var text = b.closest('.code').querySelector('code').textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () {
      var label = b.querySelector('span'); label.textContent = 'Copié';
      setTimeout(function () { label.textContent = 'Copier'; }, 1500);
    }).catch(function () {});
  });
});
var nav = document.getElementById('docsNav');
var main = document.getElementById('docsMain');
var links = Array.prototype.slice.call(nav.querySelectorAll('a'));
var secs = Array.prototype.slice.call(document.querySelectorAll('.doc-sec'));
document.getElementById('menuBtn').addEventListener('click', function () { nav.classList.toggle('open'); });
links.forEach(function (a) { a.addEventListener('click', function () { nav.classList.remove('open'); }); });
function mark() {
  var top = main.scrollTop + 80, current = secs[0];
  secs.forEach(function (s) { if (!s.hidden && s.offsetTop <= top) current = s; });
  links.forEach(function (a) { a.setAttribute('aria-current', a.getAttribute('href') === '#' + current.id ? 'true' : 'false'); });
}
main.addEventListener('scroll', mark, { passive: true });
mark();
var search = document.getElementById('docsSearch');
var empty = document.getElementById('docsEmpty');
search.addEventListener('input', function () {
  var q = search.value.trim().toLowerCase(), shown = 0;
  secs.forEach(function (s) { var ok = !q || s.textContent.toLowerCase().indexOf(q) >= 0; s.hidden = !ok; if (ok) shown++; });
  links.forEach(function (a) { var s = document.getElementById(a.getAttribute('href').slice(1)); a.hidden = s.hidden; });
  empty.hidden = shown > 0;
  mark();
});
`;

/** The documentation page. `api` and `checkout` are the public origins of the API and of the payment pages. */
export const docsPage = (o: { nonce: string; api: string; checkout: string }) => {
  const list = sections(o.api, o.checkout);
  const groups = [...new Set(list.map((s) => s.group))];
  const navHtml = groups
    .map((g) => `<h4>${esc(g)}</h4>${list.filter((s) => s.group === g).map((s) => `<a href="#${s.id}">${esc(s.title)}</a>`).join('')}`)
    .join('');
  const article = list.map((s) => `<section class="doc-sec" id="${s.id}"><h2>${esc(s.title)}</h2>${s.body}</section>`).join('');
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Documentation de l’API LightPay : paiements mobile money, webhooks, séquestre et LightPay Connect.">
<link rel="icon" type="image/png" href="${FAVICON_PNG}">
<title>Documentation · LightPay</title>
<script nonce="${o.nonce}">try { var t = localStorage.getItem('lightpay.theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&amp;display=swap">
<style nonce="${o.nonce}">${CSS}${DOCS_CSS}</style>
</head>
<body>
<div class="docs">
  <header class="docs-top">
    <button class="icon-btn menu-btn" type="button" id="menuBtn" aria-label="Sections">${iconSvg('menu')}</button>
    ${brandMarkup}<span class="docs-label">Documentation</span>
    <input class="docs-search" id="docsSearch" type="search" placeholder="Rechercher dans la documentation" aria-label="Rechercher">
    ${themeToggle()}
  </header>
  <div class="docs-body">
    <nav class="docs-nav" id="docsNav" aria-label="Sections">${navHtml}</nav>
    <main class="docs-main" id="docsMain"><article class="docs-article">${article}<p class="docs-empty" id="docsEmpty" hidden>Aucun résultat.</p></article></main>
  </div>
</div>
<script nonce="${o.nonce}">(function () {${SCRIPT}})();</script>
</body>
</html>`;
};
