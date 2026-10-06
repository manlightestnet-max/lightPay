import { shell, themeToggle } from './shell.js';
import { iconSvg } from './icons.js';
import { CONSOLE_CSS } from './console.js';

/**
 * /admin — the owner's console (LightPay sign-in listed in ADMIN_UIDS). Revenue first, then the
 * provider reserves, users, apps, every movement, the main wallet and the admin log.
 * Hash routes: #/home · #/reserves · #/users → #/users/<wallet> · #/apps → #/apps/<id> · #/developers → #/developers/<uid> ·
 *   #/moves → #/moves/<tx> · #/main · #/fees · #/providers · #/audit   (an item is its own screen, with a back link)
 * ?env=sandbox for the test ledger. No withdrawal from here, on purpose.
 */

const ADMIN_CSS = `
.bars { display: flex; align-items: flex-end; gap: 3px; height: 120px; padding: 4px 0 0; }
.bars span { flex: 1; min-width: 3px; border-radius: 3px 3px 0 0; background: var(--accent); opacity: .85; }
.bars span.zero { background: var(--line); opacity: 1; height: 2px !important; }
.bars span:hover { opacity: 1; }
.bars-axis { display: flex; justify-content: space-between; margin-top: 8px; font-size: 11px; color: var(--faint); }
.rows { display: grid; }
.rows > div { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
.rows > div:last-child { border-bottom: 0; }
.rows > div span:first-child { color: var(--muted); }
.rows > div span:last-child { font-variant-numeric: tabular-nums; text-align: right; }
.rows > div.total span { color: var(--text); font-weight: 700; }
.check { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.check svg { width: 18px; height: 18px; flex-shrink: 0; }
.check.ok { color: var(--accent-ink); } .check.err { color: var(--danger); }
.share { white-space: pre-wrap; font-size: 14px; line-height: 1.6; padding: 14px 16px; border-radius: 12px; background: var(--raised); }
.search { width: 100%; max-width: 320px; height: 36px; border-radius: 10px; border: 1px solid var(--line-strong); background: var(--card); padding: 0 12px; font-size: 14px; }
.search:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
/* fees: provider choice, one-click edit rows, calculator */
.fee-top { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
.fee-top-label { font-size: 10px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
.fee-top-hint { font-size: 13px; color: var(--muted); }
.fee-top-hint b { color: var(--text); font-weight: 600; }
.fee-prov { display: inline-flex; gap: 4px; padding: 4px; border-radius: 14px; background: var(--raised); }
.fee-prov button { position: relative; height: 36px; padding: 0 16px; border: 0; border-radius: 10px; background: none; color: var(--muted); font-size: 13px; font-weight: 600; transition: background .15s, color .15s; }
.fee-prov button[aria-pressed="true"] { background: var(--card); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.25), 0 0 0 1px var(--line); }
.fee-prov button .on-dot { display: inline-block; width: 6px; height: 6px; margin-left: 7px; border-radius: 50%; background: var(--accent); vertical-align: middle; }
.fee-list { list-style: none; margin: 0; padding: 0; }
.fee-item { display: flex; align-items: center; gap: 12px; min-height: 58px; padding: 8px 0; border-bottom: 1px solid var(--line); }
.fee-item:last-child { border-bottom: 0; }
.fee-item .fee-main { flex: 1; min-width: 0; }
.fee-item .fee-label { display: block; font-size: 14px; }
.fee-item .fee-help { display: block; font-size: 12px; color: var(--muted); margin-top: 1px; }
.fee-val { flex-shrink: 0; min-width: 96px; height: 40px; padding: 0 12px; border: 1px solid transparent; border-radius: 10px; background: var(--raised); color: var(--text); font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; cursor: pointer; transition: border-color .15s, background .15s; }
.fee-val:hover { border-color: var(--line-strong); }
.fee-edit { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.fee-edit input { width: 96px; height: 40px; padding: 0 10px; border-radius: 10px; border: 1px solid var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); background: var(--card); color: var(--text); font: inherit; font-size: 15px; font-weight: 600; text-align: right; }
.fee-edit input:focus { outline: none; }
.fee-edit .unit { font-size: 12px; color: var(--muted); width: 30px; }
.fee-edit button { height: 40px; padding: 0 12px; border-radius: 10px; border: 0; font-size: 13px; font-weight: 600; }
.fee-edit .ok { background: var(--accent); color: var(--on-accent); }
.fee-edit .no { background: var(--raised); color: var(--text); }
.fee-item.saved .fee-val { border-color: var(--accent); }
.fee-item { flex-wrap: wrap; }
@media (max-width: 560px) { .fee-edit { width: 100%; justify-content: flex-end; } .fee-edit input { flex: 1; } }
.fee-item .fee-err { display: block; font-size: 12px; color: var(--danger); margin-top: 2px; }
.calc-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.calc-amount { display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line-strong); }
.calc-amount:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.calc-amount input { width: 120px; border: 0; background: none; color: var(--text); font: inherit; font-size: 17px; font-weight: 600; text-align: right; }
.calc-amount input:focus { outline: none; }
.calc-amount span { font-size: 12px; color: var(--muted); }
.calc-rows { margin-top: 16px; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.calc-cell { padding: 12px 14px; border-radius: 12px; background: var(--raised); }
.calc-cell span { display: block; font-size: 11px; color: var(--muted); letter-spacing: .04em; }
.calc-cell b { display: block; margin-top: 4px; font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
.calc-cell.main { background: var(--accent-soft); }
.calc-cell.main b { color: var(--accent-ink); }
.field select { width: 100%; height: 46px; border-radius: var(--radius-sm); border: 1px solid var(--line-strong); background: var(--card); color: var(--text); padding: 0 12px; font: inherit; font-size: 15px; }
.field select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.debit { color: var(--danger); } .credit { color: var(--accent-ink); }
.console .grid-2 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.console .grid-2 > .sticky .panel + .panel { margin-top: 20px; }
.items { list-style: none; margin: 0; padding: 0; }
.items li { display: flex; align-items: center; gap: 16px; padding: 12px 20px; border-bottom: 1px solid var(--line); }
.items li:last-child { border-bottom: 0; }
.items li[data-href] { cursor: pointer; transition: background .12s; }
.items li[data-href]:hover { background: var(--raised); }
.items .cell-main { flex: 1; }
.items .cell-title, .items .cell-sub { max-width: none; }
.items .end { flex-shrink: 0; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 14px; }
.items-empty { padding: 20px; color: var(--muted); font-size: 14px; }
@media (max-width: 960px) { .console .grid-2 { grid-template-columns: 1fr; } }
`;

const navItem = (route: string, key: string, icon: string, label: string) =>
  `<a class="nav-item" href="#/${route}" data-nav="${key}">${iconSvg(icon)}<span>${label}</span></a>`;
const envBadge = '<span class="badge" data-env-badge hidden>Test</span>';
const seg = (name: string, items: [string, string][]) =>
  `<div class="seg-sm" role="group" data-seg="${name}">${items.map(([v, l], i) => `<button type="button" data-value="${v}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div>`;
/**
 * Every screen is a scaffold: a pinned head (back link on an item, title, actions, toolbar with the
 * list's filters) that never scrolls, and one scrolling area. A list row opens its item as its own
 * screen (opts.back), never as a panel beside the list.
 */
const page = (screen: string, title: string, inner: string, actions = '', opts: { toolbar?: string; back?: { href: string; label: string } } = {}) => `
<section class="screen scaffold" data-screen="${screen}" hidden>
  <header class="page-top"><div class="page-top-in${opts.toolbar ? ' has-toolbar' : ''}">
    ${opts.back ? `<a class="page-back" href="${opts.back.href}" data-back>${iconSvg('arrow-left')}${opts.back.label}</a>` : ''}
    <div class="page-head"><h1 class="page-title" id="${screen}Title">${title}</h1>${envBadge}${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>
    ${opts.toolbar ? `<div class="page-toolbar">${opts.toolbar}</div>` : ''}
  </div></header>
  <div class="page-scroll"><div class="page">
    <div class="msg" id="${screen}Msg" role="status" aria-live="polite"></div>
    ${inner}
  </div></div>
</section>`;
const panel = (title: string, body: string, opts: { id?: string; actions?: string; flush?: boolean; foot?: string } = {}) =>
  `<section class="panel"><div class="panel-head"><h2 class="panel-title">${title}</h2>${opts.actions ?? ''}</div><div class="${opts.flush ? 'panel-flush' : 'panel-body'}"${opts.id ? ` id="${opts.id}"` : ''}>${body}</div>${opts.foot ? `<div class="panel-foot">${opts.foot}</div>` : ''}</section>`;
const stat = (id: string, label: string, hintId: string, accent = false) =>
  `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value${accent ? ' accent' : ''}" id="${id}">—</div><div class="stat-hint" id="${hintId}"></div></div>`;

export const adminPage = (nonce: string, env: string) => {
  const body = `
<div class="console-shell" hidden>
<aside class="side" id="side" aria-label="Menu">
  <div class="side-head"><span class="brand"><span class="brand-mark" aria-hidden="true"></span><span>LightPay<small>Administration</small></span></span></div>
  <nav class="env-switch" aria-label="Environnement"><a id="envReal" href="/admin">Réel</a><a id="envTest" class="test" href="/admin?env=sandbox">Test</a></nav>
  <nav class="side-nav" aria-label="Navigation">
    <div class="nav-label">Pilotage</div>
    ${navItem('home', 'home', 'home', 'Revenus et activité')}
    ${navItem('reserves', 'reserves', 'shield', 'Réserves providers')}
    <div class="nav-label">Réseau</div>
    ${navItem('users', 'users', 'user', 'Utilisateurs')}
    ${navItem('apps', 'apps', 'apps', 'Applications')}
    ${navItem('developers', 'developers', 'code', 'Demandes mode avancé')}
    ${navItem('moves', 'moves', 'list', 'Mouvements')}
    <div class="nav-label">Trésorerie</div>
    ${navItem('main', 'main', 'wallet', '<span data-real>Wallet main</span><span data-test hidden>Faucet</span>')}
    <div class="nav-label">Réglages</div>
    ${navItem('fees', 'fees', 'settings', 'Frais et minimums')}
    ${navItem('providers', 'providers', 'swap', 'Fournisseurs')}
    ${navItem('audit', 'audit', 'clock', 'Journal admin')}
  </nav>
  <div class="side-foot"><div class="me"><span class="avatar" id="meAvatar" aria-hidden="true"></span><span class="me-main"><span class="me-name" id="meName"></span><span class="me-mail">Administrateur</span></span><button class="icon-btn" type="button" id="signOutSide" aria-label="Se déconnecter" title="Se déconnecter">${iconSvg('logout')}</button></div></div>
</aside>
<div class="scrim" id="scrim"></div>
<div class="main">
  <header class="main-top">
    <button class="icon-btn menu-btn" type="button" id="menuBtn" aria-label="Menu" aria-controls="side" aria-expanded="false">${iconSvg('menu')}</button>
    <nav class="crumbs" id="crumbs" aria-label="Fil d’Ariane"></nav>
    ${envBadge}
    ${themeToggle()}
  </header>
  <div class="console-body">

${page('home', 'Revenus et activité', `
  ${panel('Bénéfices', `<div class="well">
      ${stat('stRevenue', 'Vos bénéfices', 'stRevenueHint', true)}
      ${stat('stIn', 'Encaissé', 'stInHint')}
      ${stat('stOut', 'Versé', 'stOutHint')}
      ${stat('stTx', 'Transactions', 'stTxHint')}
    </div>`, { actions: seg('period', [['month', '30 jours'], ['week', '7 jours'], ['day', '24 h'], ['all', 'Tout']]) })}
  <div class="grid-2">
    ${panel('D’où viennent vos bénéfices', '<div class="rows" id="revRows"></div>')}
    ${panel('Équilibre du grand livre', '<div id="ledgerCheck"></div><div class="rows mt" id="ledgerRows"></div>')}
  </div>
  ${panel('Par fournisseur', '<div id="provHome"></div>', { flush: true, foot: 'Visible ici seulement : les utilisateurs et les apps ne voient jamais quel fournisseur les a servis.' })}
  ${panel('30 derniers jours', '<div class="bars" id="bars" aria-hidden="true"></div><div class="bars-axis"><span id="barsFrom"></span><span id="barsTo"></span></div>', {
    actions: seg('series', [['transactions', 'Transactions'], ['revenue', 'Bénéfices']]),
  })}
  ${panel('Réseau', `<div class="well">
      ${stat('stUsers', 'Utilisateurs', 'stUsersHint')}
      ${stat('stApps', 'Applications', 'stAppsHint')}
      ${stat('stPayments', 'Paiements', 'stPaymentsHint')}
      ${stat('stMain', '<span data-real>Wallet main</span><span data-test hidden>Faucet</span>', 'stMainHint')}
    </div>`)}
  ${panel('À partager', '<p class="share" id="shareText"></p>', { actions: '<button class="btn btn-sm btn-secondary" type="button" id="shareCopy">' + iconSvg('copy') + 'Copier</button>' })}
`)}

${page('reserves', 'Réserves providers', `
  ${panel('Ce qui doit être chez chaque provider', '<div id="resTable"></div>', {
    flush: true,
    foot: 'Encaissé moins versé à travers ce provider (frais de l’opérateur compris). Comparez chaque ligne au solde affiché par le provider : un écart signale un problème.',
  })}
  <div class="grid-2">
    ${panel('À qui appartient cet argent', '<div class="rows" id="resHeld"></div>')}
    ${panel('Couverture', '<div id="resCheck"></div><p class="small muted mt">Chaque franc dans un wallet est entré par un provider : la réserve totale doit être égale à la somme de tous les wallets.</p>')}
  </div>
`)}

${page('users', 'Utilisateurs', `
  <div class="list-card" id="usersTable"></div>
  <button class="btn btn-secondary btn-sm list-more" type="button" id="usersMore" hidden>Afficher plus</button>
`, '', { toolbar: '<input class="search" id="usersSearch" type="search" placeholder="Rechercher par nom ou e-mail" aria-label="Rechercher un utilisateur">' })}

${page('user', 'Compte', '<div class="stack" id="userDetail"></div>', '', { back: { href: '#/users', label: 'Utilisateurs' } })}

${page('apps', 'Applications', `
  <div class="list-card" id="appsTable"></div>
`)}

${page('app', 'Application', '<div class="stack" id="appDetail"></div>', '', { back: { href: '#/apps', label: 'Applications' } })}

${page('developers', 'Demandes mode avancé', `
  <div class="list-card" id="devTable"></div>
`, '', { toolbar: seg('devStatus', [['PENDING', 'À traiter'], ['APPROVED', 'Validées'], ['REJECTED', 'Refusées'], ['', 'Toutes']]) })}

${page('developer', 'Demande', '<div class="stack" id="devDetail"></div>', '', { back: { href: '#/developers', label: 'Demandes mode avancé' } })}

${page('moves', 'Mouvements', `
  <div class="list-card" id="movesTable"></div>
  <button class="btn btn-secondary btn-sm list-more" type="button" id="movesMore" hidden>Afficher plus</button>
`, '', { toolbar: seg('moveType', [['', 'Tout'], ['deposits', 'Encaissements'], ['payments', 'Paiements'], ['transfers', 'Transferts'], ['payouts', 'Retraits']]) })}

${page('move', 'Mouvement', '<div class="stack" id="moveDetail"></div>', '', { back: { href: '#/moves', label: 'Mouvements' } })}

${page('main', '<span data-real>Wallet main</span><span data-test hidden>Faucet</span>', `
  ${panel('<span data-real>Votre argent</span><span data-test hidden>Réserve du faucet</span>', `<div class="well">${stat('mainBalance', 'Disponible', 'mainHint', true)}</div>
    <p class="small muted mt" data-real>Vos fonds propres, séparés de l’argent des clients. Il ne peut jamais descendre sous zéro et se recharge uniquement par un vrai dépôt mobile money. Aucun retrait possible depuis l’administration.</p>
    <p class="small muted mt" data-test hidden>L’argent que vous distribuez aux testeurs. Vous l’émettez ici, puis vous l’envoyez à un compte par son e-mail. Il ne peut jamais descendre sous zéro.</p>`)}
  <div class="grid-2">
    ${panel('Envoyer à un utilisateur', `
      <form id="sendForm" novalidate>
        <div class="field"><label for="sendTo">E-mail du compte LightPay</label><input id="sendTo" type="email" autocomplete="off"></div>
        <div class="field"><label for="sendAmount">Montant (FCFA)</label><input id="sendAmount" data-amount inputmode="numeric" autocomplete="off"></div>
        <div class="field"><label for="sendNote">Motif (facultatif)</label><input id="sendNote" maxlength="140" autocomplete="off"></div>
        <div class="msg" id="sendMsg" role="status" aria-live="polite"></div>
        <button class="btn mt" type="submit" id="sendGo">${iconSvg('send')}Envoyer</button>
      </form>`)}
    <div data-test hidden>${panel('Émettre de l’argent de test', `
      <form id="issueForm" novalidate>
        <div class="field"><label for="issueAmount">Montant (FCFA)</label><input id="issueAmount" data-amount inputmode="numeric" autocomplete="off"></div>
        <p class="hint">Ajouté à la réserve du faucet, puis à envoyer aux comptes qui testent.</p>
        <div class="msg" id="issueMsg" role="status" aria-live="polite"></div>
        <button class="btn btn-secondary mt" type="submit" id="issueGo">${iconSvg('plus')}Émettre</button>
      </form>`)}</div>
    <div data-real>${panel('Déposer', `
      <form id="rechargeForm" novalidate>
        <div class="field"><label for="rechargeAmount">Montant (FCFA)</label><input id="rechargeAmount" data-amount inputmode="numeric" autocomplete="off"></div>
        <p class="hint">Vous payez par MTN MoMo ou Airtel Money sur la page LightPay : l’argent arrive dans le wallet main une fois validé.</p>
        <div class="msg" id="rechargeMsg" role="status" aria-live="polite"></div>
        <button class="btn btn-secondary mt" type="submit" id="rechargeGo">${iconSvg('plus')}Ouvrir la page de paiement</button>
      </form>`)}</div>
  </div>
  ${panel('<span data-real>Mouvements du wallet main</span><span data-test hidden>Mouvements du faucet</span>', '<div id="mainMoves"></div>', { flush: true })}
`)}

${page('providers', 'Fournisseurs mobile money', `
  <div class="grid-2">
    ${panel('Fournisseur par défaut', `
      <form id="provForm" novalidate>
        <div class="field"><label for="provCollection">Encaissements : dépôts et paiements</label><select id="provCollection"></select></div>
        <div class="field"><label for="provPayout">Envois : retraits et remboursements</label><select id="provPayout"></select></div>
        <div class="msg" id="provSaveMsg" role="status" aria-live="polite"></div>
        <button class="btn mt" type="submit" id="provGo">${iconSvg('check')}Enregistrer</button>
        <p class="hint">Pour les nouvelles opérations, sur cet environnement seulement. Une opération en cours reste chez son fournisseur. Inscrit au journal admin.</p>
      </form>`)}
    ${panel('Les fournisseurs', '<div id="provKeys"></div>', { flush: true, foot: 'Seuls ceux qui servent cet environnement, clés en place, peuvent être choisis.' })}
  </div>
  ${panel('Par fournisseur · 30 derniers jours', '<div id="provStats"></div>', { flush: true })}
`)}

${page('fees', 'Frais et minimums', `
  <div class="fee-top">
    <div>
      <p class="fee-top-label">Fournisseur</p>
      <div class="fee-prov" role="group" aria-label="Fournisseur" id="feeProv">
        <button type="button" data-prov="pawapay" aria-pressed="true">pawaPay</button>
        <button type="button" data-prov="saspay" aria-pressed="false">SasPay</button>
      </div>
    </div>
    <p class="fee-top-hint" id="feeActive"></p>
  </div>
  <div class="grid-2">
    ${panel('Dépôts et paiements', '<ul class="fee-list" id="feeDep"></ul>')}
    ${panel('Retraits', '<ul class="fee-list" id="feeWd"></ul>')}
  </div>
  ${panel('Calculateur', `
    <div class="calc-top">
      <div class="fee-prov" role="group" aria-label="Opération" id="calcKind">
        <button type="button" data-kind="deposit" aria-pressed="true">Dépôt</button>
        <button type="button" data-kind="withdrawal" aria-pressed="false">Retrait</button>
      </div>
      <label class="calc-amount"><input id="calcAmount" inputmode="numeric" autocomplete="off" value="1000" aria-label="Montant"><span>FCFA</span></label>
    </div>
    <div class="calc-rows" id="calcRows"></div>`)}
  <p class="hint">Cliquez une valeur pour la modifier : appliquée tout de suite, à cet environnement seulement, et inscrite au journal admin.</p>
`)}

${page('audit', 'Journal admin', '<div class="list-card" id="auditTable"></div>')}

  </div>
</div>
</div>

<section class="screen" data-screen="denied" hidden><div class="state"><span class="state-icon err">${iconSvg('lock')}</span><h2>Accès réservé</h2><p>Ce compte LightPay n’a pas accès à l’administration.</p><button class="btn btn-secondary mt" type="button" id="deniedOut">Changer de compte</button></div></section>

<div class="overlay" id="confirmSheet" hidden role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
  <div class="sheet">
    <h2 class="title" id="confirmTitle">Confirmer l’envoi</h2>
    <div class="rows mt" id="confirmRows"></div>
    <div class="btn-row mt-lg"><button class="btn btn-secondary" type="button" id="confirmCancel">Annuler</button><button class="btn" type="button" id="confirmGo">Envoyer</button></div>
  </div>
</div>`;

  const script = `
  const NARROW = window.matchMedia('(max-width: 960px)');
  const money = (v) => LP.money(v, 'XAF');
  const num = (v) => Number(v || 0).toLocaleString('fr-FR');
  const fmtDate = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtDateTime = (d) => new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const TYPE = { COLLECTION: 'Encaissement', PAYMENT: 'Paiement', HOLD: 'Paiement protégé', HOLD_CAPTURE: 'Versé au vendeur', HOLD_RELEASE: 'Séquestre rendu', TRANSFER: 'Transfert', PAYOUT: 'Retrait', REFUND: 'Remboursement', FAUCET: 'Recharge faucet' };
  const STATUS = { SUCCESS: ['ok', 'réussi'], PENDING: ['warn', 'en cours'], FAILED: ['err', 'échoué'], REVERSED: ['err', 'annulé'], GIVEN_BACK: ['', 'restitué'] };
  const SOURCE = { deposit: 'Frais de dépôt', payment: 'Frais de paiement', withdrawal: 'Frais de retrait', other: 'Autres' };
  const PROVIDER = { SASPAY: 'SasPay', PAWAPAY: 'pawaPay', SIMULATOR: 'Simulateur', AUTRE: 'Sans provider indiqué' };
  const ACTION = LP.ENV === 'sandbox'
    ? { MAIN_SEND: 'Envoi depuis le faucet', FAUCET_ISSUE: 'Émission d’argent de test' }
    : { MAIN_SEND: 'Envoi depuis le wallet main', MAIN_RECHARGE: 'Dépôt sur le wallet main' };
  ACTION.FEES_UPDATE = 'Frais et minimums modifiés';
  ACTION.PROVIDERS_UPDATE = 'Fournisseur mobile money changé';
  ACTION.DEVELOPER_APPROVED = 'Mode avancé validé';
  ACTION.DEVELOPER_REJECTED = 'Mode avancé refusé';
  const pill = (status) => { const s = STATUS[status] || ['', String(status || '').toLowerCase()]; return el('span', { class: 'pill ' + s[0], text: s[1] }); };
  const rows = (host, list) => host.replaceChildren.apply(host, list.map((r) => el('div', { class: r[2] ? 'total' : '' }, [el('span', { text: r[0] }), el('span', { text: r[1] })])));
  const segValue = (name) => { const b = document.querySelector('[data-seg="' + name + '"] [aria-pressed="true"]'); return b ? b.dataset.value : ''; };
  document.querySelectorAll('[data-seg]').forEach((g) => g.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    g.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    const c = nav.current(); if (c) screens[c.name].enter(c.param);
  }));
  document.querySelectorAll('[data-env-badge]').forEach((b) => { b.hidden = LP.ENV !== 'sandbox'; });
  const TEST = LP.ENV === 'sandbox';
  // Each environment only speaks of itself: the main wallet is the faucet in the test ledger.
  document.querySelectorAll('[data-real]').forEach((n) => { n.hidden = TEST; });
  document.querySelectorAll('[data-test]').forEach((n) => { n.hidden = !TEST; });
  const MAIN = TEST ? 'Faucet' : 'Wallet main';

  function table(host, cols, list, emptyText) {
    if (!list.length) { host.replaceChildren(el('p', { class: 'empty', text: emptyText })); return; }
    const head = el('tr', {}, cols.map((c) => el('th', { class: c.cls || '', text: c.label })));
    const body = list.map((r) => {
      const tr = el('tr', { 'data-href': r.href || null, 'aria-selected': r.selected ? 'true' : null }, r.cells.map((c, i) => {
        const td = el('td', { class: cols[i].cls || '' });
        if (c !== null && c !== undefined) td.append(typeof c === 'string' ? document.createTextNode(c) : c);
        return td;
      }));
      if (r.href) { tr.tabIndex = 0; tr.addEventListener('click', () => { location.hash = r.href; }); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = r.href; }); }
      return tr;
    });
    host.replaceChildren(el('div', { class: 'tbl-wrap' }, [el('table', { class: 'tbl' }, [el('thead', {}, [head]), el('tbody', {}, body)])]));
  }
  const cell = (title, sub) => el('span', { class: 'cell-main' }, [el('span', { class: 'cell-title', text: title }), sub ? el('span', { class: 'cell-sub', text: sub }) : null]);
  const detailPanel = (title, children) => el('section', { class: 'panel' }, [el('div', { class: 'panel-head' }, [el('h2', { class: 'panel-title', text: title })]), el('div', { class: 'panel-body' }, children)]);
  const flushPanel = (title, child) => el('section', { class: 'panel' }, [el('div', { class: 'panel-head' }, [el('h2', { class: 'panel-title', text: title })]), el('div', { class: 'panel-flush' }, [child])]);
  /** Detail column: one line per item (title + sub on the left, value on the right), never a wide table. */
  function items(list, emptyText) {
    if (!list.length) return el('p', { class: 'items-empty', text: emptyText });
    return el('ul', { class: 'items' }, list.map((it) => {
      const li = el('li', { 'data-href': it.href || null }, [cell(it.title, it.sub), el('span', { class: 'end' }, [typeof it.end === 'string' ? document.createTextNode(it.end) : it.end])]);
      if (it.href) { li.tabIndex = 0; li.addEventListener('click', () => { location.hash = it.href; }); li.addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = it.href; }); }
      return li;
    }));
  }
  const signed = (direction, amount) => el('span', { class: direction === 'CREDIT' ? 'credit' : 'debit', text: (direction === 'CREDIT' ? '+' : '−') + money(amount) });

  // ---------------------------------------------------------------- shell
  function setMenu(open) { $('side').classList.toggle('open', open); $('scrim').classList.toggle('open', open); $('menuBtn').setAttribute('aria-expanded', String(open)); }
  $('menuBtn').addEventListener('click', () => setMenu(!$('side').classList.contains('open')));
  $('scrim').addEventListener('click', () => setMenu(false));
  document.querySelectorAll('.side .nav-item').forEach((a) => a.addEventListener('click', () => setMenu(false)));
  function crumbs(section, title) {
    const parts = [el('span', { text: section })];
    if (title) { parts.push(icon('chevron-right')); parts.push(el('b', { text: title })); }
    $('crumbs').replaceChildren.apply($('crumbs'), parts);
    document.title = (title || section) + ' · Admin LightPay';
  }
  function highlight(key) { document.querySelectorAll('.nav-item').forEach((a) => { if (a.dataset.nav === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }); }
  function syncEnvLinks() {
    const hash = location.hash || '';
    $('envReal').href = '/admin' + hash; $('envTest').href = '/admin?env=sandbox' + hash;
    if (LP.ENV === 'sandbox') { $('envTest').setAttribute('aria-current', 'true'); $('envReal').removeAttribute('aria-current'); }
    else { $('envReal').setAttribute('aria-current', 'true'); $('envTest').removeAttribute('aria-current'); }
  }
  window.addEventListener('hashchange', syncEnvLinks);
  $('signOutSide').addEventListener('click', () => { LP.signOut(); location.reload(); });
  $('deniedOut').addEventListener('click', () => { LP.signOut(); location.reload(); });
  const load = async (screen, fn) => { say(screen + 'Msg', ''); try { await fn(); } catch (e) { if (e.signIn) return signIn(); say(screen + 'Msg', e.message, 'err'); } };

  // ---------------------------------------------------------------- guarded money actions + re-auth
  async function guarded(action, msg) {
    try { return await action(); }
    catch (e) {
      // Sensitive action: the same Google account again, then the action runs once more.
      if (e.reauth) { if (await confirmIdentity()) return guarded(action, msg); return; }
      if (e.signIn) { signIn(); return; }
      say(msg, e.message, 'err');
    }
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('confirmSheet').hidden) $('confirmCancel').click();
    else if ($('side').classList.contains('open')) setMenu(false);
  });

  // ---------------------------------------------------------------- revenue and activity
  let series = [];
  function drawBars() {
    const key = segValue('series') || 'transactions';
    const values = series.map((d) => Number(d[key]));
    const max = Math.max.apply(null, values.concat([1]));
    $('bars').replaceChildren.apply($('bars'), series.map((d, i) => {
      const v = values[i];
      const s = el('span', { class: v ? '' : 'zero', title: fmtDate(d.day) + ' · ' + (key === 'revenue' ? money(v) : num(v) + ' transactions') });
      if (v) s.style.height = Math.max(4, Math.round((v / max) * 116)) + 'px';
      return s;
    }));
    if (series.length) { $('barsFrom').textContent = fmtDate(series[0].day); $('barsTo').textContent = 'aujourd’hui'; }
  }
  async function enterHome() {
    crumbs('Revenus et activité');
    await load('home', async () => {
      const o = (await LP.api('GET', '/v1/admin-console/overview?period=' + (segValue('period') || 'month'))).overview;
      const r = o.revenue.by_source;
      $('stRevenue').textContent = money(o.revenue.total);
      $('stRevenueHint').textContent = 'frais de dépôt, paiement et retrait';
      $('stIn').textContent = money(o.money_in); $('stInHint').textContent = num(o.deposits_count) + ' encaissements mobile money';
      $('stOut').textContent = money(o.money_out); $('stOutHint').textContent = num(o.payouts_count) + ' retraits et remboursements';
      $('stTx').textContent = num(o.transactions); $('stTxHint').textContent = 'opérations réussies';
      rows($('revRows'), [
        [SOURCE.deposit, money(r.deposit.amount) + ' · ' + num(r.deposit.count)],
        [SOURCE.payment, money(r.payment.amount) + ' · ' + num(r.payment.count)],
        [SOURCE.withdrawal, money(r.withdrawal.amount) + ' · ' + num(r.withdrawal.count)],
      ].concat(Number(r.other.amount) ? [[SOURCE.other, money(r.other.amount)]] : []).concat([['Total', money(o.revenue.total), true]]));
      const faucetOnly = !o.ledger.balanced && o.ledger.unbalanced.length > 0 && o.ledger.unbalanced.every((t) => t.type === 'INITIAL_FAUCET');
      $('ledgerCheck').replaceChildren(el('p', { class: 'check ' + (o.ledger.balanced || faucetOnly ? 'ok' : 'err') }, [icon(o.ledger.balanced || faucetOnly ? 'check' : 'alert'),
        o.ledger.balanced ? 'Équilibré : chaque débit a son crédit.' : faucetOnly ? 'Seul écart : la réserve de départ du faucet.' : 'Déséquilibre détecté : à vérifier tout de suite.']));
      rows($('ledgerRows'), [['Total des débits', money(o.ledger.debit)], ['Total des crédits', money(o.ledger.credit)]]
        .concat(o.ledger.unbalanced.map((t) => [(t.type === 'INITIAL_FAUCET' ? 'Réserve de départ du faucet' : TYPE[t.type] || t.type) + ' · ' + fmtDate(t.created_at), (Number(t.gap) > 0 ? '+' : '') + money(t.gap)])));
      series = o.daily; drawBars();
      providerTable($('provHome'), o.by_provider || []);
      $('stUsers').textContent = num(o.users); $('stUsersHint').textContent = '+' + num(o.new_users) + ' sur la période · ' + num(o.guests) + ' invités';
      $('stApps').textContent = num(o.apps); $('stAppsHint').textContent = num(o.connections) + ' comptes connectés';
      $('stPayments').textContent = money(o.payments_volume); $('stPaymentsHint').textContent = num(o.payments) + ' paiements';
      $('stMain').textContent = money(o.main_balance); $('stMainHint').textContent = TEST ? 'à distribuer aux testeurs' : 'vos fonds propres';
      const label = { day: 'Ces dernières 24 h', week: 'Ces 7 derniers jours', month: 'Ces 30 derniers jours', all: 'Depuis le lancement' }[o.period];
      $('shareText').textContent = 'LightPay · ' + label + ' :\\n' + num(o.transactions) + ' transactions réussies\\n' + money(o.money_in) + ' encaissés par mobile money\\n' + num(o.users) + ' utilisateurs · ' + num(o.apps) + ' applications connectées';
    });
  }
  $('shareCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('shareText').textContent); $('shareCopy').replaceChildren(icon('check'), 'Copié'); setTimeout(() => $('shareCopy').replaceChildren(icon('copy'), 'Copier'), 1500); } catch (e) {}
  });

  // ---------------------------------------------------------------- reserves
  async function enterReserves() {
    crumbs('Réserves providers');
    await load('reserves', async () => {
      const r = (await LP.api('GET', '/v1/admin-console/reserves')).reserves;
      table($('resTable'), [{ label: 'Provider' }, { label: 'Encaissé', cls: 'num' }, { label: 'Versé', cls: 'num' }, { label: 'Doit être chez lui', cls: 'num' }],
        r.providers.map((p) => ({ cells: [cell(PROVIDER[p.provider] || p.provider, num(p.movements) + ' mouvements' + (p.last_at ? ' · dernier ' + fmtDateTime(p.last_at) : '')), money(p.money_in), money(p.money_out), el('b', { text: money(p.reserve) })] }))
          .concat(r.providers.length > 1 ? [{ cells: [el('b', { text: 'Total' }), '', '', el('b', { text: money(r.reserve_total) })] }] : []),
        'Aucun mouvement avec un provider pour le moment.');
      const h = r.held;
      rows($('resHeld'), [['Utilisateurs', money(h.users)], ['Invités', money(h.guests)], ['Apps', money(h.apps)], ['Revenus LightPay', money(h.revenue)], [MAIN, money(h.main)]].concat(TEST && Number(h.issued) ? [['Émis par le faucet', '−' + money(h.issued)]] : [])
        .concat(Number(h.other) ? [['Autres', money(h.other)]] : []).concat([['Dont bloqué en séquestre', money(h.locked)], ['Total', money(r.covered), true]]));
      $('resCheck').replaceChildren(el('p', { class: 'check ' + (r.balanced ? 'ok' : 'err') }, [icon(r.balanced ? 'check' : 'alert'),
        r.balanced ? 'Couvert : réserves ' + money(r.reserve_total) + ' = wallets ' + money(r.covered) + '.' : 'Écart : réserves ' + money(r.reserve_total) + ', wallets ' + money(r.covered) + '.']));
    });
  }

  // ---------------------------------------------------------------- users
  let users = [], usersQuery = '', searchTimer = null;
  $('usersSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { usersQuery = $('usersSearch').value.trim(); users = []; loadUsers(false); }, 300); });
  $('usersMore').addEventListener('click', () => loadUsers(true));
  async function loadUsers(more) {
    const r = await LP.api('GET', '/v1/admin-console/users?limit=50&offset=' + (more ? users.length : 0) + '&q=' + encodeURIComponent(usersQuery));
    users = more ? users.concat(r.users) : r.users;
    $('usersMore').hidden = r.users.length < 50;
    renderUsers();
  }
  function renderUsers() {
    table($('usersTable'), [{ label: 'Compte' }, { label: 'Apps', cls: 'num' }, { label: 'Solde', cls: 'num' }],
      users.map((u) => ({ href: '#/users/' + u.id, cells: [cell(u.name || u.email || 'Sans nom', u.email || ''), num(u.apps), money(Number(u.available_balance) + Number(u.locked_balance))] })),
      usersQuery ? 'Aucun compte ne correspond.' : 'Aucun utilisateur pour le moment.');
  }
  async function enterUsers() {
    crumbs('Réseau', 'Utilisateurs');
    if (!users.length) skeleton($('usersTable'), 8, 'div');
    await load('users', () => loadUsers(false));
  }
  async function enterUser(id) {
    crumbs('Utilisateurs', 'Compte');
    $('userTitle').textContent = 'Compte';
    $('userDetail').replaceChildren(); skeleton($('userDetail'), 5, 'div');
    await load('user', async () => {
      const d = await LP.api('GET', '/v1/admin-console/users/' + encodeURIComponent(id));
      const u = d.user;
      $('userTitle').textContent = u.name || u.email || 'Compte';
      const box = el('div', {});
      rows(box, [['E-mail', u.email || '—'], ['Disponible', money(u.available_balance)], ['Bloqué', money(u.locked_balance)], ['Statut', u.status === 'ACTIVE' ? 'actif' : 'fermé'], ['Créé le', fmtDate(u.created_at)]]);
      box.classList.add('rows');
      const appsHost = items(d.apps.map((a) => ({ href: '#/apps/' + a.app_id, title: a.app_name, sub: 'depuis le ' + fmtDate(a.created_at), end: a.status === 'ACTIVE' ? 'connectée' : 'retirée' })), 'Aucune app connectée.');
      const movesHost = items(d.moves.map((m) => ({ href: '#/moves/' + m.transaction_id, title: m.description || TYPE[m.type] || m.type, sub: fmtDateTime(m.created_at), end: signed(m.direction, m.amount) })), 'Aucun mouvement.');
      $('userDetail').replaceChildren(detailPanel('Compte', [box]), flushPanel('Apps connectées', appsHost), flushPanel('Derniers mouvements', movesHost));
    });
  }

  // ---------------------------------------------------------------- apps
  let apps = [];
  function renderApps() {
    table($('appsTable'), [{ label: 'App' }, { label: 'Utilisateurs', cls: 'num' }, { label: 'Paiements 30 j', cls: 'num' }],
      apps.map((a) => ({ href: '#/apps/' + a.id, cells: [cell(a.name, a.id + (a.owner_email ? ' · ' + a.owner_email : a.owner_uid ? '' : ' · sans propriétaire') + (a.is_active ? '' : ' · désactivée')), num(a.users), money(a.volume_30d)] })),
      'Aucune application.');
  }
  async function enterApps() {
    crumbs('Réseau', 'Applications');
    if (!apps.length) skeleton($('appsTable'), 6, 'div');
    await load('apps', async () => { apps = (await LP.api('GET', '/v1/admin-console/apps')).apps; renderApps(); });
  }
  async function enterApp(id) {
    crumbs('Applications', id);
    $('appTitle').textContent = 'Application';
    $('appDetail').replaceChildren(); skeleton($('appDetail'), 5, 'div');
    await load('app', async () => {
      const d = await LP.api('GET', '/v1/admin-console/apps/' + encodeURIComponent(id));
      $('appTitle').textContent = d.app.name;
      const box = el('div', { class: 'rows' });
      rows(box, [['Identifiant', d.app.id], ['Propriétaire', d.app.owner_email || (d.app.owner_uid ? 'compte LightPay' : 'non rattachée')], ['Utilisateurs connectés', num(d.app.users)], ['Transactions', num(d.app.transactions)], ['Paiements 30 j', money(d.app.volume_30d)], ['Créée le', fmtDate(d.app.created_at)]]);
      const usersHost = items(d.users.map((u) => ({ href: '#/users/' + u.wallet_id, title: u.name || u.email || 'Sans nom', sub: [u.email, (u.scopes || []).join(', '), u.status === 'ACTIVE' ? '' : 'retirée'].filter(Boolean).join(' · '), end: money(Number(u.available_balance) + Number(u.locked_balance)) })), 'Aucun utilisateur connecté.');
      const walletsHost = items(d.wallets.map((w) => ({ title: w.account_id, sub: w.account_type + ' · ' + w.currency, end: money(Number(w.available_balance) + Number(w.locked_balance)) })), 'Aucun wallet propre.');
      $('appDetail').replaceChildren(detailPanel('Application', [box]), flushPanel('Utilisateurs rattachés', usersHost), flushPanel('Wallets de l’app', walletsHost));
    });
  }

  // ---------------------------------------------------------------- advanced-mode requests
  const DEV_STATUS = { PENDING: ['warn', 'à traiter'], APPROVED: ['ok', 'validée'], REJECTED: ['err', 'refusée'] };
  let devRequests = [];
  function renderDevRequests() {
    table($('devTable'), [{ label: 'Demande' }, { label: 'Le' }, { label: 'État' }], devRequests.map((d) => ({
      href: '#/developers/' + encodeURIComponent(d.uid),
      cells: [cell(d.project, [d.username ? '@' + d.username : '', d.email || ''].filter(Boolean).join(' · ')), fmtDate(d.created_at), el('span', { class: 'pill ' + (DEV_STATUS[d.status] || ['', ''])[0], text: (DEV_STATUS[d.status] || ['', d.status])[1] })],
    })), 'Aucune demande.');
  }
  const loadDevRequests = async () => { devRequests = (await LP.api('GET', '/v1/admin-console/developers' + (segValue('devStatus') ? '?status=' + segValue('devStatus') : ''))).requests; };
  async function enterDevelopers() {
    crumbs('Réseau', 'Demandes mode avancé');
    if (!devRequests.length) skeleton($('devTable'), 5, 'div');
    await load('developers', async () => { await loadDevRequests(); renderDevRequests(); });
  }
  async function enterDeveloper(uid) {
    crumbs('Demandes mode avancé', 'Demande');
    $('developerTitle').textContent = 'Demande';
    $('devDetail').replaceChildren(); skeleton($('devDetail'), 5, 'div');
    await load('developer', async () => {
      if (!devRequests.some((x) => x.uid === uid)) {
        devRequests = (await LP.api('GET', '/v1/admin-console/developers')).requests;
      }
      const d = devRequests.find((x) => x.uid === uid);
      if (!d) { $('devDetail').replaceChildren(el('p', { class: 'empty', text: 'Demande introuvable.' })); return; }
      $('developerTitle').textContent = d.project;
      const box = el('div', { class: 'rows' });
      rows(box, [['Projet', d.project], ['Compte', [d.username ? '@' + d.username : '', d.email || ''].filter(Boolean).join(' · ') || d.uid], ['Site', d.website || '—'], ['Demandée le', fmtDateTime(d.created_at)], ['État', (DEV_STATUS[d.status] || ['', d.status])[1]]].concat(d.decided_at ? [['Décidée le', fmtDateTime(d.decided_at) + (d.decided_by ? ' · ' + d.decided_by : '')]] : []).concat(d.note ? [['Motif du refus', d.note]] : []));
      const use = el('p', { class: 'small', text: d.use_case });
      const note = el('textarea', { class: 'field-area mt', id: 'devNote', placeholder: 'Motif du refus (la personne le verra)', maxlength: '300' });
      const msg = el('div', { class: 'msg', id: 'devDecideMsg', role: 'status', 'aria-live': 'polite' });
      const decide = (approve) => guarded(async () => {
        await LP.api('POST', '/v1/admin-console/developers/' + encodeURIComponent(d.uid), { approve: approve, note: approve ? undefined : $('devNote').value });
        devRequests = [];
        say('developerMsg', approve ? 'Mode avancé validé pour ' + d.project + '.' : 'Demande refusée.', 'ok');
        await enterDeveloper(d.uid);
      }, 'devDecideMsg');
      const decision = d.status === 'APPROVED' ? [] : [detailPanel('Décision', [note, el('div', { class: 'btn-row mt' }, [
        el('button', { class: 'btn btn-secondary', type: 'button', text: 'Refuser', on: { click: () => decide(false) } }),
        el('button', { class: 'btn', type: 'button', text: 'Valider', on: { click: () => decide(true) } }),
      ]), msg])];
      $('devDetail').replaceChildren.apply($('devDetail'), [detailPanel('Demande', [box]), detailPanel('Ce qu’il va faire avec LightPay', [use])].concat(decision));
    });
  }

  // ---------------------------------------------------------------- movements
  let moves = [], movesType = null;
  $('movesMore').addEventListener('click', () => loadMoves(true));
  async function loadMoves(more) {
    const type = segValue('moveType');
    const last = more && moves.length ? moves[moves.length - 1].created_at : null;
    const r = await LP.api('GET', '/v1/admin-console/transactions?limit=50' + (type ? '&type=' + type : '') + (last ? '&before=' + encodeURIComponent(last) : ''));
    moves = more ? moves.concat(r.transactions) : r.transactions;
    movesType = type;
    $('movesMore').hidden = r.transactions.length < 50;
    renderMoves();
  }
  function renderMoves() {
    table($('movesTable'), [{ label: 'Opération' }, { label: 'App' }, { label: 'Montant', cls: 'num' }, { label: 'État' }],
      moves.map((t) => ({ href: '#/moves/' + t.id, cells: [cell(TYPE[t.type] || t.type, fmtDateTime(t.created_at) + (t.reference ? ' · ' + t.reference : '')), t.app_id, money(t.amount), pill(t.status)] })),
      'Aucun mouvement.');
  }
  async function enterMoves() {
    crumbs('Trésorerie', 'Mouvements');
    if (!moves.length || movesType !== segValue('moveType')) skeleton($('movesTable'), 8, 'div');
    await load('moves', () => loadMoves(false));
  }
  // The phone's side of an operation, beside the ledger: what was paid or sent, and who took what.
  function breakdownRows(b) {
    if (!b) return null;
    const via = (PROVIDER[String(b.provider).toUpperCase()] || b.provider) + ' · ' + (b.network === 'AIRTEL_COG' ? 'Airtel Money' : 'MTN MoMo');
    if (b.kind === 'collection') return [
      ['Payé par le téléphone', b.paid ? money(b.paid) : 'en attente de l’opérateur'],
      ['Frais opérateur', b.operator_fee ? money(b.operator_fee) : '—'],
      ['Frais LightPay', money(b.lightpay_fee)],
      ['Arrivé sur le wallet', money(b.received), true],
      ['Via', via],
    ];
    return [
      ['Débité du wallet', money(b.debited)],
      ['Frais LightPay', money(b.lightpay_fee)],
      ['Frais opérateur', money(b.operator_fee)],
      ['Reçu sur le téléphone', money(b.sent), true],
      ['Via', via],
    ];
  }
  async function enterMove(id) {
    crumbs('Mouvements', 'Détail');
    $('moveTitle').textContent = 'Mouvement';
    $('moveDetail').replaceChildren(); skeleton($('moveDetail'), 6, 'div');
    await load('move', async () => {
      const d = await LP.api('GET', '/v1/admin-console/transactions/' + encodeURIComponent(id));
      const t = d.transaction;
      $('moveTitle').textContent = (TYPE[t.type] || t.type) + ' · ' + money(t.amount);
      const box = el('div', { class: 'rows' });
      rows(box, [['Montant', money(t.amount)], ['App', t.app_id], ['Référence', t.reference || '—'], ['Date', fmtDateTime(t.created_at)]]);
      const parts = [detailPanel('Opération', [pill(t.status), box, el('p', { class: 'mono mt', text: t.id })])];
      const b = breakdownRows(d.breakdown);
      if (b) { const host = el('div', { class: 'rows' }); rows(host, b); parts.push(detailPanel(d.breakdown.kind === 'collection' ? 'Ce que le client a payé' : 'Ce qui est parti', [host])); }
      const entriesHost = items(d.entries.map((e) => ({ href: e.account_type === 'USER' ? '#/users/' + e.wallet_id : null, title: e.label, sub: e.description || '', end: signed(e.direction, e.amount) })), 'Aucune écriture.');
      parts.push(flushPanel('Écritures (partie double)', entriesHost));
      $('moveDetail').replaceChildren.apply($('moveDetail'), parts);
    });
  }

  // ---------------------------------------------------------------- wallet main
  let mainBalance = 0;
  async function enterMain() {
    crumbs('Trésorerie', MAIN);
    await load('main', async () => {
      const d = await LP.api('GET', '/v1/admin-console/main');
      mainBalance = Number(d.wallet.available_balance);
      $('mainBalance').textContent = money(d.wallet.available_balance);
      $('mainHint').textContent = TEST ? 'à distribuer aux testeurs' : 'vos fonds propres';
      table($('mainMoves'), [{ label: 'Mouvement' }, { label: 'Montant', cls: 'num' }, { label: 'Solde après', cls: 'num' }], d.moves.map((m) => ({
        href: '#/moves/' + m.transaction_id,
        cells: [cell(m.description || TYPE[m.type] || m.type, fmtDateTime(m.created_at)), el('span', { class: m.direction === 'CREDIT' ? 'credit' : 'debit', text: (m.direction === 'CREDIT' ? '+' : '−') + money(m.amount) }), money(m.balance_after)],
      })), 'Aucun mouvement pour le moment.');
    });
  }
  const amountOf = (id) => { const v = amountDigits($(id).value); return v && Number(v) > 0 ? v : null; };
  let sendDraft = null;
  $('sendForm').addEventListener('submit', (e) => {
    e.preventDefault(); say('sendMsg', '');
    const to = $('sendTo').value.trim().toLowerCase(); const amount = amountOf('sendAmount');
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(to)) return say('sendMsg', 'Adresse e-mail invalide.', 'err');
    if (!amount) return say('sendMsg', 'Montant invalide.', 'err');
    if (Number(amount) > mainBalance) return say('sendMsg', 'Solde ' + (TEST ? 'du faucet' : 'du wallet main') + ' insuffisant (' + money(mainBalance) + ').', 'err');
    sendDraft = { to: to, amount: amount, note: $('sendNote').value.trim(), key: LP.uuid() };
    rows($('confirmRows'), [['À', to], ['Montant', money(amount)], ['Depuis', MAIN], ['Solde après', money(mainBalance - Number(amount)), true]].concat(sendDraft.note ? [['Motif', sendDraft.note]] : []));
    $('confirmSheet').hidden = false; $('confirmGo').focus();
  });
  $('confirmCancel').addEventListener('click', () => { $('confirmSheet').hidden = true; sendDraft = null; });
  $('confirmGo').addEventListener('click', async () => {
    const d = sendDraft; if (!d) return;
    $('confirmSheet').hidden = true; $('sendGo').disabled = true;
    await guarded(async () => {
      const r = await LP.api('POST', '/v1/admin-console/main/send', { to: d.to, amount: d.amount, note: d.note || undefined }, d.key);
      sendDraft = null;
      $('sendTo').value = ''; $('sendAmount').value = ''; $('sendNote').value = '';
      say('sendMsg', money(r.amount) + ' envoyés à ' + (r.to.name || r.to.email) + '.', 'ok');
      moves = [];
      await enterMain();
      say('sendMsg', money(r.amount) + ' envoyés à ' + (r.to.name || r.to.email) + '.', 'ok');
    }, 'sendMsg');
    $('sendGo').disabled = false;
  });
  $('issueForm').addEventListener('submit', async (e) => {
    e.preventDefault(); say('issueMsg', '');
    const amount = amountOf('issueAmount');
    if (!amount) return say('issueMsg', 'Montant invalide.', 'err');
    $('issueGo').disabled = true;
    const key = LP.uuid();
    await guarded(async () => {
      const r = await LP.api('POST', '/v1/admin-console/faucet/issue', { amount: amount }, key);
      $('issueAmount').value = '';
      await enterMain();
      say('issueMsg', money(r.amount) + ' ajoutés au faucet.', 'ok');
    }, 'issueMsg');
    $('issueGo').disabled = false;
  });
  $('rechargeForm').addEventListener('submit', async (e) => {
    e.preventDefault(); say('rechargeMsg', '');
    const amount = amountOf('rechargeAmount');
    if (!amount) return say('rechargeMsg', 'Montant invalide.', 'err');
    $('rechargeGo').disabled = true;
    const key = LP.uuid();
    await guarded(async () => {
      const r = await LP.api('POST', '/v1/admin-console/main/recharge', { amount: amount }, key);
      const w = window.open(r.checkout_url, '_blank', 'noopener');
      say('rechargeMsg', w ? 'Page de paiement ouverte dans un nouvel onglet : le solde se met à jour une fois le paiement validé.' : 'Ouvrez la page de paiement : ' + r.checkout_url, 'ok');
    }, 'rechargeMsg');
    $('rechargeGo').disabled = false;
  });

  // ---------------------------------------------------------------- providers (admin only)
  const provName = (n) => PROVIDER[String(n).toUpperCase()] || n;
  const PROVIDER_DESC = {
    saspay: 'MTN et Airtel Congo, encaissements et retraits. Réel seulement : pas de mode test.',
    pawapay: 'MTN et Airtel Congo. Test : sandbox pawaPay. Réel : selon les droits du compte (encaissements pour l’instant).',
    simulator: 'Test seulement : répond comme un opérateur, sans argent réel.',
  };
  function providerTable(host, list) {
    table(host, [{ label: 'Fournisseur' }, { label: 'Encaissé', cls: 'num' }, { label: 'Envoyé', cls: 'num' }, { label: 'Échecs', cls: 'num' }], list.map((p) => ({
      cells: [
        cell(provName(p.provider), num(p.collections.succeeded) + ' encaissements · ' + num(p.payouts.succeeded) + ' envois' + (p.collections.pending + p.payouts.pending ? ' · ' + num(p.collections.pending + p.payouts.pending) + ' en cours' : '')),
        money(p.collections.amount), money(p.payouts.amount), num(p.collections.failed + p.payouts.failed),
      ],
    })), 'Aucune opération mobile money sur la période.');
  }
  let provInfo = null;
  async function enterProviders() {
    crumbs('Réglages', 'Fournisseurs');
    await load('providers', async () => {
      provInfo = await LP.api('GET', '/v1/admin-console/providers');
      ['provCollection', 'provPayout'].forEach((id) => {
        const kind = id === 'provCollection' ? 'collection' : 'payout';
        $(id).replaceChildren.apply($(id), provInfo.providers.filter((p) => p.available).map((p) => el('option', { value: p.name, text: provName(p.name) + (p.configured ? '' : ' (clés absentes)'), disabled: p.configured ? null : true, selected: provInfo.current[kind] === p.name ? true : null })));
        $(id).value = provInfo.current[kind];
      });
      $('provKeys').replaceChildren(items(provInfo.providers.map((p) => ({
        title: provName(p.name),
        sub: PROVIDER_DESC[p.name] || '',
        end: !p.available ? (p.name === 'simulator' ? 'Test seulement' : 'Réel seulement') : p.configured ? 'Clés en place' : 'Clés absentes',
      })), ''));
      providerTable($('provStats'), provInfo.stats);
      say('provSaveMsg', provInfo.saved ? '' : 'Aucun choix enregistré : la configuration du serveur s’applique (' + provName(provInfo.current.collection) + ').');
    });
  }
  $('provForm').addEventListener('submit', async (e) => {
    e.preventDefault(); say('provSaveMsg', '');
    $('provGo').disabled = true;
    await guarded(async () => {
      const r = await LP.api('PUT', '/v1/admin-console/providers', { collection: $('provCollection').value, payout: $('provPayout').value });
      say('provSaveMsg', 'Enregistré : encaissements par ' + provName(r.current.collection) + ', envois par ' + provName(r.current.payout) + '.', 'ok');
    }, 'provSaveMsg');
    $('provGo').disabled = false;
  });

  // ---------------------------------------------------------------- fees and minimums
  // Read as values; a click on one turns it into a field (Enter saves, Échap cancels). Operator
  // fees are per provider: the one serving this environment is preselected. The calculator uses
  // the same formulas as the server (fees.ts).
  const FEE_KEYS = {
    deposit: [
      ['deposit_min', 'Montant minimum', 'Plus petit dépôt ou paiement accepté', 'fcfa'],
      ['deposit_lightpay_fee_bps', 'Frais LightPay', 'Votre commission, ajoutée au montant', 'pct'],
      ['deposit_lightpay_fee_min', 'Frais LightPay minimum', 'Le plus grand des deux s’applique', 'fcfa'],
    ],
    withdrawal: [
      ['withdrawal_min', 'Montant minimum', 'Plus petit retrait accepté', 'fcfa'],
      ['withdrawal_lightpay_fee_bps', 'Frais LightPay', 'Votre commission, débitée avec le retrait', 'pct'],
      ['withdrawal_lightpay_fee_min', 'Frais LightPay minimum', 'Le plus grand des deux s’applique', 'fcfa'],
    ],
  };
  const OPERATOR_KEYS = {
    pawapay: {
      deposit: [['pawapay_deposit_fee_bps', 'Frais opérateur pawaPay', 'Demandés au payeur : couvrent la commission pawaPay', 'pct']],
      withdrawal: [['pawapay_payout_fee_bps', 'Frais opérateur pawaPay', 'Débités du wallet : couvrent la commission pawaPay', 'pct']],
    },
    saspay: {
      deposit: [['deposit_operator_fee_bps', 'Frais opérateur SasPay (estimés)', 'Affichés avant le paiement, SasPay donne le montant exact', 'pct']],
      withdrawal: [
        ['withdrawal_operator_fee_bps', 'Frais opérateur SasPay', 'Ce que SasPay prend sur chaque envoi', 'pct'],
        ['withdrawal_operator_fee_min', 'Frais opérateur SasPay minimum', 'Le plus grand des deux s’applique', 'fcfa'],
      ],
    },
  };
  let feeSet = null, feeProv = 'pawapay', calcKind = 'deposit', feeActive = null;
  const pctText = (bps) => String(bps / 100).replace('.', ',');
  const shown = (v, unit) => (unit === 'pct' ? pctText(v) + ' %' : money(v));
  function parseFee(raw, unit) {
    const t = String(raw).trim().replace(/\\s/g, '').replace(',', '.').replace(/%|fcfa/gi, '');
    if (!/^\\d+(\\.\\d+)?$/.test(t)) return NaN;
    const n = Number(t);
    if (unit === 'pct') { const bps = Math.round(n * 100); return Math.abs(bps - n * 100) < 1e-6 && bps <= 5000 ? bps : NaN; }
    return Number.isInteger(n) && n <= 1000000 ? n : NaN;
  }
  function feeItem(def) {
    const key = def[0], unit = def[3];
    const li = el('li', { class: 'fee-item' });
    const view = () => {
      const btn = el('button', { class: 'fee-val', type: 'button', text: shown(feeSet[key], unit), 'aria-label': def[1] + ' : ' + shown(feeSet[key], unit) + '. Modifier' });
      btn.addEventListener('click', edit);
      li.replaceChildren(el('span', { class: 'fee-main' }, [el('span', { class: 'fee-label', text: def[1] }), el('span', { class: 'fee-help', text: def[2] })]), btn);
    };
    const edit = () => {
      const input = el('input', { inputmode: 'decimal', autocomplete: 'off', value: unit === 'pct' ? pctText(feeSet[key]) : String(feeSet[key]), 'aria-label': def[1] });
      const err = el('span', { class: 'fee-err', role: 'alert' });
      const save = async () => {
        const v = parseFee(input.value, unit);
        if (isNaN(v)) { err.textContent = unit === 'pct' ? 'Pourcentage de 0 à 50, 2 décimales au plus.' : 'Montant entier en FCFA.'; input.focus(); return; }
        if ((key === 'deposit_min' || key === 'withdrawal_min') && v < 1) { err.textContent = 'Au moins 1 FCFA.'; return; }
        if (v === feeSet[key]) return view();
        ok.disabled = true;
        await guarded(async () => {
          const next = Object.assign({}, feeSet); next[key] = v;
          feeSet = (await LP.api('PUT', '/v1/admin-console/fees', next)).settings;
          view(); li.classList.add('saved'); setTimeout(() => li.classList.remove('saved'), 1600);
          renderCalc();
        }, 'feesMsg');
        ok.disabled = false;
      };
      const ok = el('button', { class: 'ok', type: 'button', text: 'OK', on: { click: save } });
      const no = el('button', { class: 'no', type: 'button', text: 'Annuler', on: { click: view } });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') view(); });
      li.replaceChildren(el('span', { class: 'fee-main' }, [el('span', { class: 'fee-label', text: def[1] }), err]),
        el('span', { class: 'fee-edit' }, [input, el('span', { class: 'unit', text: unit === 'pct' ? '%' : 'FCFA' }), no, ok]));
      input.focus(); input.select();
    };
    view();
    return li;
  }
  function renderFees() {
    document.querySelectorAll('[data-prov]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.prov === feeProv));
      b.replaceChildren(PROVIDER[b.dataset.prov.toUpperCase()] || b.dataset.prov);
      if (feeActive && (feeActive.collection === b.dataset.prov || feeActive.payout === b.dataset.prov)) b.append(el('span', { class: 'on-dot', title: 'Actif' }));
    });
    $('feeDep').replaceChildren.apply($('feeDep'), FEE_KEYS.deposit.concat(OPERATOR_KEYS[feeProv].deposit).map(feeItem));
    $('feeWd').replaceChildren.apply($('feeWd'), FEE_KEYS.withdrawal.concat(OPERATOR_KEYS[feeProv].withdrawal).map(feeItem));
    renderCalc();
  }
  // Same formulas as the server (src/payments/fees.ts).
  const ceilBps = (a, bps) => Math.ceil(a * bps / 10000);
  function renderCalc() {
    if (!feeSet) return;
    const s = feeSet, a = Number(String($('calcAmount').value).replace(/\\D/g, '')) || 0;
    document.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === calcKind)));
    let cells;
    if (calcKind === 'deposit') {
      const lp = Math.max(s.deposit_lightpay_fee_min, ceilBps(a, s.deposit_lightpay_fee_bps));
      const op = ceilBps(a + lp, feeProv === 'pawapay' ? s.pawapay_deposit_fee_bps : s.deposit_operator_fee_bps);
      cells = [['Le client paie', money(a + lp + op), true], ['Arrive sur le wallet', money(a)], ['LightPay gagne', money(lp)], ['Opérateur' + (feeProv === 'saspay' ? ' (estimé)' : ''), money(op)]];
      if (a && a < s.deposit_min) cells.push(['Refusé', 'Sous le minimum (' + money(s.deposit_min) + ')']);
    } else {
      const lp = Math.max(s.withdrawal_lightpay_fee_min, ceilBps(a, s.withdrawal_lightpay_fee_bps));
      const op = feeProv === 'pawapay' ? ceilBps(a, s.pawapay_payout_fee_bps) : Math.max(s.withdrawal_operator_fee_min, ceilBps(a, s.withdrawal_operator_fee_bps));
      cells = [['Débité du wallet', money(a + lp + op), true], ['Reçu sur le téléphone', money(a)], ['LightPay gagne', money(lp)], ['Opérateur', money(op)]];
      if (a && a < s.withdrawal_min) cells.push(['Refusé', 'Sous le minimum (' + money(s.withdrawal_min) + ')']);
    }
    $('calcRows').replaceChildren.apply($('calcRows'), cells.map((c) => el('div', { class: 'calc-cell' + (c[2] ? ' main' : '') }, [el('span', { text: c[0] }), el('b', { text: c[1] })])));
  }
  document.querySelectorAll('[data-prov]').forEach((b) => b.addEventListener('click', () => { feeProv = b.dataset.prov; renderFees(); }));
  document.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => { calcKind = b.dataset.kind; renderCalc(); }));
  $('calcAmount').addEventListener('input', renderCalc);
  async function enterFees() {
    crumbs('Réglages', 'Frais et minimums');
    if (!feeSet) { skeleton($('feeDep'), 4, 'li'); skeleton($('feeWd'), 4, 'li'); }
    await load('fees', async () => {
      const [f, p] = await Promise.all([LP.api('GET', '/v1/admin-console/fees'), LP.api('GET', '/v1/admin-console/providers').catch(() => null)]);
      feeSet = f.settings;
      feeActive = p ? p.current : null;
      // The provider serving new deposits is shown first.
      if (feeActive && (feeActive.collection === 'saspay' || feeActive.collection === 'pawapay')) feeProv = feeActive.collection;
      $('feeActive').replaceChildren.apply($('feeActive'), feeActive
        ? ['Actif ici : encaissements par ', el('b', { text: provName(feeActive.collection) }), ', envois par ', el('b', { text: provName(feeActive.payout) }), '.']
        : []);
      renderFees();
    });
  }

  // ---------------------------------------------------------------- admin log
  async function enterAudit() {
    crumbs('Trésorerie', 'Journal admin');
    await load('audit', async () => {
      const r = await LP.api('GET', '/v1/admin-console/audit?limit=200');
      table($('auditTable'), [{ label: 'Action' }, { label: 'Par' }, { label: 'Montant', cls: 'num' }],
        r.audit.map((a) => ({ cells: [cell(ACTION[a.action] || a.action, fmtDateTime(a.created_at) + (a.target ? ' · ' + a.target : '')), a.admin_email || '—', a.amount ? money(a.amount) : '—'] })),
        'Aucune action pour le moment.');
    });
  }

  // ---------------------------------------------------------------- navigation
  const withNav = (key, fn) => (param) => { highlight(key); syncEnvLinks(); return fn(param); };
  const screens = {
    home: { enter: withNav('home', enterHome) },
    reserves: { enter: withNav('reserves', enterReserves) },
    users: { enter: withNav('users', enterUsers) },
    user: { parent: 'users', enter: withNav('users', enterUser) },
    apps: { enter: withNav('apps', enterApps) },
    app: { parent: 'apps', enter: withNav('apps', enterApp) },
    developers: { enter: withNav('developers', enterDevelopers) },
    developer: { parent: 'developers', enter: withNav('developers', enterDeveloper) },
    moves: { enter: withNav('moves', enterMoves) },
    move: { parent: 'moves', enter: withNav('moves', enterMove) },
    main: { enter: withNav('main', enterMain) },
    fees: { enter: withNav('fees', enterFees) },
    providers: { enter: withNav('providers', enterProviders) },
    audit: { enter: withNav('audit', enterAudit) },
    denied: { enter: () => {} },
  };
  const nav = createNav({
    root: 'home',
    // #/users/<id> opens the item screen "user" (and so on): a list and its item never share a screen.
    resolve: (route) => {
      const ITEM = { users: 'user', apps: 'app', developers: 'developer', moves: 'move' };
      const i = route.indexOf('/');
      if (i < 0) return [route, null];
      const list = route.slice(0, i);
      return ITEM[list] ? [ITEM[list], route.slice(i + 1)] : [list, route.slice(i + 1)];
    },
    screens: screens,
  });

  function authAside() {
    const point = (text) => el('li', {}, [icon('check'), text]);
    return el('aside', { class: 'auth-aside' }, [
      el('span', { class: 'pill-brand' }, [el('span', { class: 'brand-mark', 'aria-hidden': 'true' }), 'Administration']),
      el('h2', { text: 'Le tableau de bord de LightPay.' }),
      el('p', { text: 'Vos revenus, les réserves chez chaque provider, les comptes, les apps et chaque mouvement du grand livre.' }),
      el('ul', { class: 'auth-points' }, [
        point('Accès réservé aux comptes autorisés.'),
        point('Mot de passe redemandé avant tout mouvement d’argent.'),
        point('Chaque action est enregistrée dans le journal.'),
      ]),
    ]);
  }
  function signIn() { mountAuth(boot, { title: 'Connexion administrateur', subtitle: 'Avec votre compte LightPay.', aside: authAside(), noSignUp: true }); }
  async function boot() {
    try {
      const r = await LP.api('GET', '/v1/admin-console/me');
      $('meAvatar').textContent = initials(r.admin.email || 'A');
      $('meName').textContent = r.admin.email || 'Administrateur';
      syncEnvLinks();
      nav.start();
    } catch (e) {
      if (e.signIn) return signIn();
      if (e.status === 403) { showOnly(document.querySelector('[data-screen="denied"]')); return; }
      nav.start(); say('homeMsg', e.message, 'err');
    }
  }
  if (LP.isRedirecting()) signIn(); else if (LP.signedIn()) boot(); else signIn();
`;

  return shell({ title: 'Administration', nonce, env, body, script, css: CONSOLE_CSS + ADMIN_CSS, console: true });
};
