import { shell, themeToggle } from './shell.js';
import { iconSvg } from './icons.js';
import { CONSOLE_CSS } from './console.js';

/**
 * /admin — the owner's console (LightPay sign-in listed in ADMIN_UIDS). Revenue first, then the
 * provider reserves, users, apps, every movement, the main wallet and the admin log.
 * Hash routes: #/home · #/reserves · #/users → #/users/<wallet> · #/apps → #/apps/<id> · #/developers → #/developers/<uid> ·
 *   #/moves → #/moves/<tx> · #/main · #/fees · #/providers · #/audit · #/lockdown · #/controls · #/payouts → #/payouts/<id> · #/suspensions · #/messages → #/messages/<event>
 *   (an item is its own screen, with a back link)
 * ?env=sandbox for the test ledger. No withdrawal from here, on purpose.
 */

const ADMIN_CSS = `
/* Messages: list of templates, editor with a live phone / e-mail preview. */
.msg-pill { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: var(--raised); color: var(--muted); }
.msg-pill.custom { background: var(--accent-soft); color: var(--accent-ink); }
.msg-pill.off { background: var(--danger-soft); color: var(--danger); }
.msg-switches { display: grid; gap: 4px; }
.msg-switches .agree { margin-top: 6px; }
.rule-checks { display: flex; flex-wrap: wrap; gap: 2px 20px; }
.rule-checks .agree { margin-top: 4px; }
.vars { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.var-chip { border: 1px solid var(--line-strong); background: transparent; border-radius: 999px; padding: 4px 10px; font-size: 12px; font-family: ui-monospace, Menlo, Consolas, monospace; color: var(--text); cursor: pointer; }
.var-chip:hover { border-color: var(--accent); }
.notif { display: flex; gap: 12px; padding: 14px; border-radius: 18px; background: var(--raised); }
.notif .brand-mark { width: 22px; height: 22px; margin-top: 2px; }
.notif-main { flex: 1; min-width: 0; }
.notif-app { font-size: 12px; color: var(--muted); }
.notif-title { font-size: 15px; font-weight: 600; margin-top: 2px; overflow-wrap: anywhere; }
.notif-body { font-size: 14px; color: var(--muted); margin-top: 2px; white-space: pre-line; overflow-wrap: anywhere; }
.mail-prev { margin-top: 14px; padding: 14px; border-radius: 14px; border: 1px solid var(--line); }
.mail-prev .mail-subject { font-size: 13px; color: var(--muted); }
.mail-prev .mail-subject b { color: var(--text); font-weight: 600; }
.mail-prev .mail-body { margin-top: 8px; font-size: 14px; white-space: pre-line; overflow-wrap: anywhere; }
.prev-off { margin-top: 10px; font-size: 13px; color: var(--muted); }
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
.ok-text { color: var(--accent-ink); } .err-text { color: var(--danger); }
.inline-form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 14px; align-items: end; }
.inline-form .msg, .inline-form .btn { grid-column: 1 / -1; justify-self: start; }
@media (max-width: 720px) { .inline-form { grid-template-columns: 1fr; } }
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
.fee-val[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-ink); cursor: default; }
.fee-val.danger { color: var(--danger); }
.search.wide { max-width: none; }
.lock-now { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; font-size: 14px; }
.lock-note { margin-top: 12px; font-size: 13px; color: var(--muted); }
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

const navItem = (route: string, key: string, icon: string, label: string, extra = '') =>
  `<a class="nav-item" href="#/${route}" data-nav="${key}">${iconSvg(icon)}<span>${label}</span>${extra}</a>`;
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
    ${navItem('reserves', 'reserves', 'shield', 'Réserves providers', '<span class="nav-count" id="navResCount" hidden></span>')}
    <div class="nav-label">Réseau</div>
    ${navItem('users', 'users', 'user', 'Utilisateurs')}
    ${navItem('apps', 'apps', 'apps', 'Applications')}
    ${navItem('developers', 'developers', 'code', 'Demandes mode avancé')}
    ${navItem('moves', 'moves', 'list', 'Mouvements')}
    <div class="nav-label">Trésorerie</div>
    ${navItem('main', 'main', 'wallet', '<span data-real>Wallet main</span><span data-test hidden>Faucet</span>')}
    <div class="nav-label">Contrôle</div>
    ${navItem('lockdown', 'lockdown', 'lock', 'Frein d’urgence')}
    ${navItem('controls', 'controls', 'clock', 'Délais et limites')}
    ${navItem('payouts', 'payouts', 'withdraw', 'Retraits et remboursements')}
    ${navItem('suspensions', 'suspensions', 'shield', 'Comptes suspendus')}
    ${navItem('country-requests', 'country-requests', 'swap', 'Changements de pays', '<span class="nav-count" id="navCountryCount" hidden></span>')}
    <div class="nav-label">Réglages</div>
    ${navItem('fees', 'fees', 'settings', 'Frais et minimums')}
    ${navItem('providers', 'providers', 'swap', 'Fournisseurs')}
    ${navItem('routing', 'routing', 'list', 'Routage')}
    ${navItem('countries', 'countries', 'phone', 'Pays et opérateurs')}
    ${navItem('messages', 'messages', 'mail', 'Messages')}
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
  <div class="list-card" id="resTable"></div>
  <p class="small muted mt">Une ligne par wallet chez un fournisseur (un par pays). Attendu = encaissé − versé + envois pas encore partis. Écart = solde réel (disponible + réservé chez lui) − attendu. Disponible = ce qui peut encore partir : solde − envois programmés ou retenus − minimum de sécurité.</p>
  ${panel('Transferts entre pays', '<div id="transferTable"></div>', { flush: true, foot: 'LightPay déplace son propre argent d’un wallet pays du fournisseur à un autre (SasPay seulement) : les wallets des personnes ne bougent pas. Un seul transfert à la fois : les suivants attendent en file. Ce que le transfert coûte est inscrit en « Frais fournisseurs ».' })}
  ${panel('Surveillance et rééquilibrage', '<ul class="fee-list" id="resSettings"></ul>', { foot: 'Les soldes sont lus chez les fournisseurs qui le permettent (SasPay, pawaPay) : une note à côté du grand livre, aucun argent ne bouge.' })}
  ${panel('Relever un solde à la main', `
    <form id="checkForm" class="inline-form" novalidate>
      <div class="field"><label for="checkProvider">Provider</label><select id="checkProvider"></select></div>
      <div class="field"><label for="checkCountry">Pays</label><select id="checkCountry"></select></div>
      <div class="field"><label for="checkBalance">Solde affiché par le provider (FCFA)</label><input id="checkBalance" data-amount inputmode="numeric" autocomplete="off"></div>
      <div class="field"><label for="checkNote">Note (facultatif)</label><input id="checkNote" maxlength="200" autocomplete="off"></div>
      <div class="msg" id="checkMsg" role="status" aria-live="polite"></div>
      <button class="btn btn-secondary btn-sm mt" type="submit" id="checkGo">${iconSvg('check')}Enregistrer le relevé</button>
    </form>`, { foot: 'Pour un fournisseur qui ne donne pas son solde par API, ou pour vérifier une lecture.' })}
  <div class="grid-2">
    ${panel('À qui appartient cet argent', '<div class="rows" id="resHeld"></div>')}
    ${panel('Couverture', '<div id="resCheck"></div><p class="small muted mt">Chaque franc dans un wallet est entré par un provider : la réserve totale doit être égale à la somme de tous les wallets.</p>')}
  </div>
`, '<button class="btn btn-secondary btn-sm" type="button" id="resRead" hidden>' + iconSvg('refresh') + 'Relever maintenant</button>')}

${page('reserve', 'Réserve', '<div class="stack" id="resDetail"></div>', '', { back: { href: '#/reserves', label: 'Réserves providers' } })}

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
    <p class="small muted mt" data-real>Vos fonds propres, séparés de l’argent des clients : les revenus de LightPay (frais de dépôt, de paiement et de retrait) y arrivent directement, et vous pouvez le recharger par un vrai dépôt mobile money. Il ne peut jamais descendre sous zéro. Aucun retrait possible depuis l’administration.</p>
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

${page('routing', 'Routage', `
  <div class="list-card" id="routeTable"></div>
  <p class="small muted mt">La première règle active qui correspond choisit le fournisseur ; sinon le fournisseur par défaut (Fournisseurs). Une règle d’envoi peut ne servir que si la réserve de ce fournisseur dans ce pays suffit : sinon la règle suivante est essayée. Les personnes et les apps ne voient jamais le fournisseur.</p>
  ${panel('Simulateur', `
    <form id="simForm" class="inline-form" novalidate>
      <div class="field"><label for="simType">Opération</label><select id="simType"></select></div>
      <div class="field"><label for="simNetwork">Opérateur du téléphone</label><select id="simNetwork"></select></div>
      <div class="field"><label for="simDest">Pays du wallet</label><select id="simDest"></select></div>
      <div class="field"><label for="simApp">App</label><select id="simApp"></select></div>
      <div class="field"><label for="simAmount">Montant (FCFA)</label><input id="simAmount" data-amount inputmode="numeric" autocomplete="off"></div>
      <div class="msg" id="simMsg" role="status" aria-live="polite"></div>
      <button class="btn btn-secondary btn-sm mt" type="submit" id="simGo">${iconSvg('bolt')}Simuler</button>
    </form>
    <div id="simResult"></div>`, { foot: 'Rien n’est envoyé : le simulateur dit quelle règle et quel fournisseur serviraient cette opération maintenant, et ce que coûterait chaque fournisseur (d’après « Frais et minimums »), et ce qu’il prend en vrai (son tarif du moment, en rouge s’il dépasse).' })}
`, '<a class="btn btn-sm" href="#/routing/new">' + iconSvg('plus') + 'Nouvelle règle</a>')}

${page('rule', 'Règle', '<div class="stack" id="ruleDetail"></div>', '', { back: { href: '#/routing', label: 'Routage' } })}

${page('countries', 'Pays et opérateurs', `
  <div class="list-card" id="countryTable"></div>
  <p class="small muted mt">Un pays ouvert propose ses opérateurs actifs dans les formulaires de dépôt, de retrait et de paiement. Une seule liste pour le réel et le test. Le numéro choisit l’opérateur d’après ses préfixes ; les codes des fournisseurs restent ici, jamais montrés aux personnes.</p>
`)}

${page('country', 'Pays', '<div class="stack" id="countryDetail"></div>', '', { back: { href: '#/countries', label: 'Pays et opérateurs' } })}

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
    ${panel('Changement de pays (swap)', '<ul class="fee-list" id="feeSwap"></ul>')}
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
  ${panel('Tarifs réels des fournisseurs', '<div id="ratesTable"></div>', {
    flush: true,
    actions: '<button class="btn btn-secondary btn-sm" type="button" id="ratesRefresh">' + iconSvg('refresh') + 'Actualiser</button>',
    foot: '<span id="ratesFoot">Ce que le fournisseur nous prend en ce moment, lu sur son API (SasPay). Les frais payés par les personnes restent ceux réglés ci-dessus.</span>',
  })}
  <p class="hint">Cliquez une valeur pour la modifier : appliquée tout de suite, à cet environnement seulement, et inscrite au journal admin.</p>
`)}

${page('lockdown', 'Frein d’urgence', `
  <div class="lock-now" id="lockNow"></div>
  <div class="grid-2">
    ${panel('Niveau', '<ul class="fee-list" id="lockLevels"></ul>')}
    ${panel('Appliquer', `
      <form id="lockForm" novalidate>
        <div class="field"><label for="lockReason">Raison (elle reste dans le journal)</label><textarea id="lockReason" maxlength="300" rows="3" autocomplete="off"></textarea></div>
        <div class="msg" id="lockSaveMsg" role="status" aria-live="polite"></div>
        <button class="btn mt" type="submit" id="lockGo">${iconSvg('check')}Appliquer</button>
        <p class="hint">Immédiat sur tous les serveurs (quelques secondes). Un niveau imposé par LIGHTWALLET_LOCKDOWN sur l’hébergeur ne se lève pas d’ici.</p>
      </form>`)}
  </div>
  <p class="lock-note">Le frein agit sur les deux environnements, réel et test. Remettre « Normal » rouvre tout.</p>
`)}

${page('controls', 'Délais et limites', `
  <div class="grid-2">
    ${panel('Délais avant envoi', '<ul class="fee-list" id="ctlDelays"></ul>')}
    ${panel('Tentatives de retrait', '<ul class="fee-list" id="ctlLimits"></ul>')}
  </div>
  <p class="hint">Cliquez une valeur pour la modifier : appliquée tout de suite, à cet environnement seulement, et inscrite au journal admin. Pendant un délai, vous pouvez retenir ou annuler l’envoi depuis « Retraits et remboursements ».</p>
`)}

${page('messages', 'Messages automatiques', `
  <p class="hint">Ce que LightPay envoie tout seul à chaque personne : notification sur le téléphone et, pour ce qui compte, e-mail. Cliquez un message pour réécrire son texte, couper son push ou son e-mail, ou le désactiver. Les mêmes textes servent au réel et au test.</p>
  <div id="msgGroups"></div>
`)}

${page('message', 'Message', '<div id="msgDetail"></div>', '', { back: { href: '#/messages', label: 'Messages' } })}

${page('payouts', 'Retraits et remboursements', `
  <div id="payObserved"></div>
  <div class="list-card" id="payTable"></div>
`, '', { toolbar: seg('payFilter', [['upcoming', 'À venir'], ['held', 'Retenus'], ['all', 'Récents']]) })}

${page('payout', 'Envoi', '<div id="payDetail"></div>', '', { back: { href: '#/payouts', label: 'Retraits et remboursements' } })}

${page('country-requests', 'Changements de pays', `
  <div class="list-card" id="crTable"></div>
  <p class="small muted mt">Une personne demande à utiliser un de ses wallets dans un autre pays. Accepter prend les frais de changement de pays (Frais et minimums) sur son solde disponible du moment, puis change le pays du wallet. Refuser demande une raison : la personne la voit sur son wallet.</p>
`, '', { toolbar: seg('crStatus', [['PENDING', 'À traiter'], ['APPROVED', 'Acceptées'], ['REJECTED', 'Refusées'], ['', 'Toutes']]) })}

${page('country-request', 'Demande', '<div class="stack" id="crDetail"></div>', '', { back: { href: '#/country-requests', label: 'Changements de pays' } })}

${page('suspensions', 'Comptes suspendus', `
  <div class="grid-2">
    ${panel('Suspendus maintenant', '<div id="susTable"></div>', { flush: true, foot: 'Un compte suspendu ne peut ni retirer ni envoyer. Il peut toujours recevoir.' })}
    ${panel('Suspendre un compte', `
      <form id="susForm" novalidate>
        <div class="field"><label for="susTo">Compte</label><input id="susTo" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="@pseudo ou e-mail"></div>
        <div class="field"><label for="susMinutes">Durée (minutes)</label><input id="susMinutes" data-amount inputmode="numeric" autocomplete="off" value="60"></div>
        <div class="field"><label for="susReason">Raison</label><input id="susReason" maxlength="300" autocomplete="off"></div>
        <div class="msg" id="susSaveMsg" role="status" aria-live="polite"></div>
        <button class="btn mt" type="submit" id="susGo">${iconSvg('lock')}Suspendre</button>
      </form>`)}
  </div>
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
  ACTION.CONTROLS_UPDATE = 'Délais et limites modifiés';
  ACTION.RESERVES_UPDATE = 'Surveillance des réserves modifiée';
  ACTION.ROUTING_UPDATE = 'Règles de routage modifiées';
  ACTION.COUNTRY_UPDATE = 'Pays modifié';
  ACTION.COUNTRY_CHANGE_APPROVED = 'Changement de pays accepté';
  ACTION.COUNTRY_CHANGE_REJECTED = 'Changement de pays refusé';
  ACTION.TRANSFER_REQUEST = 'Transfert entre pays demandé';
  ACTION.TRANSFER_CANCEL = 'Transfert entre pays annulé';
  ACTION.RAIL_UPDATE = 'Opérateur modifié';
  ACTION.PROVIDER_BALANCE_CHECK = 'Solde fournisseur relevé';
  ACTION.MESSAGE_UPDATE = 'Message modifié';
  ACTION.MESSAGE_RESET = 'Message rétabli';
  ACTION.LOCKDOWN = 'Frein d’urgence';
  ACTION.PAYOUT_HOLD = 'Envoi retenu';
  ACTION.PAYOUT_RELEASE = 'Envoi libéré';
  ACTION.PAYOUT_CANCEL = 'Envoi annulé';
  ACTION.SUSPEND = 'Compte suspendu';
  ACTION.SUSPEND_LIFT = 'Suspension levée';
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

  // Lists: table() of the shared client (sortable columns).
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

  // ---------------------------------------------------------------- reserves (one line per provider wallet: provider + country)
  const RES_STATE = { ok: ['ok', 'OK'], low: ['warn', 'Sous le seuil'], gap: ['err', 'Écart'], unchecked: ['', 'Pas relevé'] };
  const resState = (w) => el('span', { class: 'pill ' + RES_STATE[w.state][0], text: RES_STATE[w.state][1] });
  const signedMoney = (v) => { const n = Number(v); return (n > 0 ? '+' : n < 0 ? '−' : '') + money(Math.abs(n)); };
  const amountText = (v) => (Number(v) < 0 ? '−' : '') + money(Math.abs(Number(v)));
  const resName = (w) => (PROVIDER[w.provider] || w.provider) + ' · ' + w.country_name;
  const byWho = (by) => (by === 'auto' ? 'lu automatiquement' : by ? 'relevé par ' + by : 'relevé');
  function setResCount(n) { const c = $('navResCount'); c.hidden = !n; c.textContent = n ? String(n) : ''; }
  async function refreshResCount() { try { setResCount((await LP.api('GET', '/v1/admin-console/reserves')).reserves.alerts); } catch (e) {} }

  let resData = null, resSettings = null, resRanges = null;
  const RES_STORE = {
    get: () => resSettings,
    set: (v) => { resSettings = v; },
    put: async (next) => (await LP.api('PUT', '/v1/admin-console/reserves-settings', next)).settings,
    msg: 'reservesMsg',
  };
  function renderReserves(r) {
    table($('resTable'), [{ label: 'Wallet' }, { label: 'Attendu', cls: 'num' }, { label: 'Solde réel', cls: 'num' }, { label: 'Écart', cls: 'num' }, { label: 'Disponible', cls: 'num' }, { label: 'État' }],
      r.wallets.map((w) => ({ href: '#/reserves/' + encodeURIComponent(w.key), cells: [
        cell(resName(w), num(w.movements) + ' mouvements' + (Number(w.waiting) ? ' · ' + money(w.waiting) + ' pas encore parti' : '')),
        el('b', { class: Number(w.expected) < 0 ? 'err-text' : '', text: amountText(w.expected) }),
        w.checked ? cell(money(Number(w.checked.balance) + Number(w.checked.pending || 0)), fmtDateTime(w.checked.at) + ' · ' + byWho(w.checked.by)) : '—',
        w.checked ? el('span', { class: Number(w.checked.gap) === 0 ? 'ok-text' : w.state === 'gap' ? 'err-text' : '', text: Number(w.checked.gap) === 0 ? 'Aucun' : signedMoney(w.checked.gap) }) : '—',
        w.available === null ? '—' : el('span', { class: w.state === 'low' ? 'err-text' : '', text: amountText(w.available) }),
        resState(w),
      ], keys: [null, Number(w.expected), w.checked ? Number(w.checked.balance) : -Infinity, w.checked ? Number(w.checked.gap) : -Infinity, w.available === null ? -Infinity : Number(w.available), ['gap', 'low', 'unchecked', 'ok'].indexOf(w.state)] }))
        .concat(r.wallets.length > 1 ? [{ fixed: true, cells: [el('b', { text: 'Total' }), el('b', { text: money(r.expected_total) }), '', '', '', ''] }] : []),
      'Aucun wallet chez un fournisseur pour le moment.');
    setResCount(r.alerts);
    $('resRead').hidden = !r.readable.length;
    const providers = [...new Set(r.wallets.map((w) => w.provider.toLowerCase()).concat(['saspay', 'pawapay']))];
    $('checkProvider').replaceChildren(...providers.map((c) => el('option', { value: c, text: PROVIDER[c.toUpperCase()] || c })));
    $('checkCountry').replaceChildren(...r.countries.map((c) => el('option', { value: c.code, text: c.name })));
    const h = r.held;
    rows($('resHeld'), [['Utilisateurs', money(h.users)], ['Invités', money(h.guests)], ['Apps', money(h.apps)], [MAIN + ' (revenus LightPay compris)', money(h.main)], ['Frais de retrait en attente de confirmation', money(h.revenue)]].concat(TEST && Number(h.issued) ? [['Émis par le faucet', '−' + money(h.issued)]] : [])
      .concat(Number(h.other) ? [['Autres', money(h.other)]] : []).concat([['Dont bloqué en séquestre', money(h.locked)], ['Total', money(r.covered), true]]));
    $('resCheck').replaceChildren(el('p', { class: 'check ' + (r.balanced ? 'ok' : 'err') }, [icon(r.balanced ? 'check' : 'alert'),
      r.balanced ? 'Couvert : réserves ' + money(r.reserve_total) + ' = wallets ' + money(r.covered) + '.' : 'Écart : réserves ' + money(r.reserve_total) + ', wallets ' + money(r.covered) + '.']));
  }
  /** A yes / no setting, in the same rows as the values (one tap switches it, saved at once). */
  function toggleItem(key, label, help, store) {
    const li = el('li', { class: 'fee-item' });
    const view = () => {
      const on = Boolean(store.get()[key]);
      const btn = el('button', { class: 'fee-val', type: 'button', text: on ? 'Activé' : 'Désactivé', 'aria-pressed': String(on), 'aria-label': label + ' : ' + (on ? 'activé' : 'désactivé') + '. Changer' });
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await guarded(async () => {
          const next = Object.assign({}, store.get()); next[key] = !on;
          store.set(await store.put(next));
          view(); li.classList.add('saved'); setTimeout(() => li.classList.remove('saved'), 1600);
        }, store.msg);
        btn.disabled = false;
      });
      li.replaceChildren(el('span', { class: 'fee-main' }, [el('span', { class: 'fee-label', text: label }), el('span', { class: 'fee-help', text: help })]), btn);
    };
    view();
    return li;
  }
  function renderResSettings() {
    $('resSettings').replaceChildren(
      settingItem(['gap_alert', 'Écart toléré', 'Au-delà, la ligne passe en alerte (0 : le moindre écart)', 'fcfa', resRanges.gap_alert], RES_STORE),
      settingItem(['auto_check_minutes', 'Lecture automatique des soldes', 'LightPay lit les soldes chez les fournisseurs toutes les N minutes (0 : seulement sur demande)', 'min', resRanges.auto_check_minutes], RES_STORE),
      toggleItem('rebalance_payouts', 'Retrait vers un pays à sec', 'Le retrait attend un transfert depuis un autre wallet du fournisseur (la personne voit « en cours »)', RES_STORE),
      toggleItem('rebalance_low', 'Remise à niveau automatique', 'Un wallet sous son seuil bas (avec un niveau cible) est rempli sans attendre un retrait', RES_STORE),
      settingItem(['transfer_margin_bps', 'Marge d’un transfert', 'Ajoutée au montant pour couvrir les frais du fournisseur et les arrondis', 'pct', resRanges.transfer_margin_bps], RES_STORE));
  }
  const TR_STATUS = { QUEUED: ['warn', 'en file'], PENDING: ['warn', 'demandé'], SUCCEEDED: ['ok', 'arrivé'], FAILED: ['err', 'refusé'], CANCELLED: ['', 'annulé'] };
  const TR_REASON = { manual: 'à la main', low: 'sous le seuil bas', payout: 'pour un retrait' };
  const trPill = (st) => { const x = TR_STATUS[st] || ['', st]; return el('span', { class: 'pill ' + x[0], text: x[1] }); };
  const countryLabel = (code) => { const c = resData && resData.countries.filter((x) => x.code === code)[0]; return c ? c.name : code; };
  let transfers = null;
  function renderTransfers() {
    table($('transferTable'), [{ label: 'Transfert' }, { label: 'Montant', cls: 'num' }, { label: 'État' }],
      transfers.map((t) => ({ href: '#/reserves/' + t.id, cells: [
        cell(provName(t.provider) + ' · ' + countryLabel(t.from_country) + ' → ' + countryLabel(t.to_country), TR_REASON[t.reason] + ' · ' + fmtDateTime(t.updated_at)),
        money(t.amount), trPill(t.status),
      ], keys: [new Date(t.updated_at).getTime(), Number(t.amount), t.status] })),
      'Aucun transfert pour le moment.');
  }
  async function enterReserves() {
    crumbs('Pilotage', 'Réserves providers');
    // Already seen: the last known state at once, then the server's.
    if (resData) renderReserves(resData); else skeleton($('resTable'), 3, 'div');
    if (resSettings) renderResSettings(); else skeleton($('resSettings'), 2, 'li');
    if (transfers) renderTransfers(); else skeleton($('transferTable'), 2, 'div');
    await load('reserves', async () => {
      const [r, st, tr] = await Promise.all([LP.api('GET', '/v1/admin-console/reserves'), LP.api('GET', '/v1/admin-console/reserves-settings'), LP.api('GET', '/v1/admin-console/transfers')]);
      resData = r.reserves; resSettings = st.settings; resRanges = st.ranges; transfers = tr.transfers;
      renderReserves(resData); renderResSettings(); renderTransfers();
    });
  }
  $('resRead').addEventListener('click', async () => {
    say('reservesMsg', ''); $('resRead').disabled = true;
    await guarded(async () => {
      const r = await LP.api('POST', '/v1/admin-console/reserves/read');
      resData = r.reserves; renderReserves(resData);
      const failed = r.read.filter((x) => !x.ok);
      if (failed.length) say('reservesMsg', failed.map((x) => provName(x.provider) + ' : ' + x.error).join(' · '), 'err');
      else say('reservesMsg', r.read.map((x) => provName(x.provider) + ' : ' + x.wallets + ' wallet' + (x.wallets > 1 ? 's' : '') + ' lu' + (x.wallets > 1 ? 's' : '')).join(' · ') || 'Aucun fournisseur à lire.', 'ok');
    }, 'reservesMsg');
    $('resRead').disabled = false;
  });

  async function enterTransfer(id) {
    crumbs('Réserves providers', 'Transfert');
    $('reserveTitle').textContent = 'Transfert';
    $('resDetail').replaceChildren(); skeleton($('resDetail'), 5, 'div');
    await load('reserve', async () => {
      if (!resData) resData = (await LP.api('GET', '/v1/admin-console/reserves')).reserves;
      const d = await LP.api('GET', '/v1/admin-console/transfers/' + encodeURIComponent(id));
      const t = d.transfer;
      $('reserveTitle').textContent = countryLabel(t.from_country) + ' → ' + countryLabel(t.to_country);
      const cost = t.status === 'SUCCEEDED' ? Number(t.amount) - Number(t.received || t.amount) + Number(t.fee || 0) : null;
      const box = el('div', { class: 'rows' });
      rows(box, [
        ['Fournisseur', provName(t.provider)], ['Envoyé depuis', countryLabel(t.from_country)], ['Vers', countryLabel(t.to_country)], ['Montant envoyé', money(t.amount), true],
      ].concat(t.status === 'SUCCEEDED' ? [
        ['Arrivé', money(t.received) + (t.received_currency ? ' ' + t.received_currency : '')], ['Taux', t.rate || '—'], ['Frais du fournisseur', money(t.fee || 0)], ['Coût du transfert', money(cost), true],
      ] : []).concat([
        ['Raison', TR_REASON[t.reason] || t.reason], ['Demandé par', t.requested_by === 'auto' ? 'LightPay (automatique)' : (t.requested_by || '—')],
        ['Créé le', fmtDateTime(t.created_at)], ['Dernier changement', fmtDateTime(t.updated_at)],
      ]).concat(t.failure_code ? [['Refus', t.failure_code]] : []).concat(t.provider_reference ? [['Référence fournisseur', t.provider_reference]] : []));
      const parts = [detailPanel('Transfert', [trPill(t.status), box, el('p', { class: 'mono mt', text: t.id })])];
      if (d.waiting.length) parts.push(flushPanel('Retraits qui l’attendent', items(d.waiting.map((p) => ({ href: '#/payouts/' + encodeURIComponent(p.id), title: money(p.amount), sub: fmtDateTime(p.created_at), end: 'programmé' })), '')));
      if (t.status === 'QUEUED') {
        const msg = el('div', { class: 'msg', role: 'status', 'aria-live': 'polite' });
        const cancel = el('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Annuler ce transfert' });
        cancel.addEventListener('click', async () => {
          say(msg, ''); cancel.disabled = true;
          await guarded(async () => { await LP.api('POST', '/v1/admin-console/transfers/' + encodeURIComponent(t.id) + '/cancel'); transfers = null; await enterTransfer(id); }, msg);
          cancel.disabled = false;
        });
        parts.push(detailPanel('En file', [el('p', { class: 'small muted', text: 'Il n’a pas encore été demandé au fournisseur : il peut être annulé. Les retraits qui l’attendent partent alors comme avant.' }), el('div', { class: 'mt' }, [cancel]), msg]));
      }
      $('resDetail').replaceChildren.apply($('resDetail'), parts);
    });
  }

  async function enterReserve(key) {
    if (String(key).indexOf('tr_') === 0) return enterTransfer(key);
    crumbs('Réserves providers', 'Réserve');
    $('reserveTitle').textContent = 'Réserve';
    // Another wallet: the shimmer, never the previous one's numbers.
    $('resDetail').replaceChildren(); skeleton($('resDetail'), 5, 'div');
    await load('reserve', async () => {
      const [d, st] = await Promise.all([LP.api('GET', '/v1/admin-console/reserves/' + encodeURIComponent(key)), LP.api('GET', '/v1/admin-console/reserves-settings')]);
      resSettings = st.settings; resRanges = st.ranges;
      const w = d.wallet;
      $('reserveTitle').textContent = resName(w);
      const box = el('div', { class: 'rows' });
      rows(box, [
        ['Encaissé', money(w.money_in)], ['Versé', money(w.money_out)],
        ['Programmés ou retenus (encore dans le solde)', money(w.waiting_scheduled)], ['Demandés au fournisseur (réservés chez lui)', money(w.waiting_asked)],
        ['Attendu chez lui', amountText(w.expected), true],
      ].concat(w.checked ? [
        ['Dernier solde', money(w.checked.balance) + ' · ' + fmtDateTime(w.checked.at)],
        ['Réservé chez lui', w.checked.pending === null ? '—' : money(w.checked.pending)],
        ['Écart', Number(w.checked.gap) === 0 ? 'Aucun' : signedMoney(w.checked.gap)],
        ['Disponible pour envoyer', amountText(w.available), true],
      ] : [['Dernier solde', 'Jamais relevé']]));
      const levels = {
        get: () => resSettings.wallets[w.key] || { min: 0, low: 0, target: 0 },
        set: () => {},
        put: async (next) => {
          const all = Object.assign({}, resSettings, { wallets: Object.assign({}, resSettings.wallets) });
          all.wallets[w.key] = next;
          resSettings = (await LP.api('PUT', '/v1/admin-console/reserves-settings', all)).settings;
          return resSettings.wallets[w.key];
        },
        after: () => enterReserve(key),
        msg: 'reserveMsg',
      };
      const levelList = el('ul', { class: 'fee-list' }, [
        settingItem(['min', 'Minimum de sécurité', 'Jamais compté comme disponible pour envoyer', 'fcfa', resRanges.level], levels),
        settingItem(['low', 'Seuil bas', 'Sous ce disponible, la ligne passe en alerte (0 : pas d’alerte)', 'fcfa', resRanges.level], levels),
        settingItem(['target', 'Niveau cible', 'Le niveau qu’un rééquilibrage rétablit (0 : pas encore fixé)', 'fcfa', resRanges.level], levels),
      ]);
      const history = el('div', { id: 'resHistory' });
      table(history, [{ label: 'Relevé' }, { label: 'Solde', cls: 'num' }, { label: 'Réservé', cls: 'num' }],
        d.history.map((h) => ({ cells: [cell(fmtDateTime(h.checked_at), byWho(h.checked_by) + (h.note ? ' · ' + h.note : '')), money(h.balance), h.pending === null ? '—' : money(h.pending)], keys: [new Date(h.checked_at).getTime(), Number(h.balance), Number(h.pending || 0)] })),
        'Aucun relevé pour ce wallet.');
      const parts = [detailPanel('Wallet chez le fournisseur', [resState(w), box]), detailPanel('Niveaux', [levelList])];
      if (d.transferable) parts.push(await rebalancePanel(w));
      parts.push(flushPanel('Relevés', history));
      $('resDetail').replaceChildren.apply($('resDetail'), parts);
    });
  }

  /** Refill this provider wallet from another of its countries: LightPay's proposal, the admin decides. */
  async function rebalancePanel(w) {
    const r = await LP.api('GET', '/v1/admin-console/reserves/' + encodeURIComponent(w.key) + '/plan');
    const msg = el('div', { class: 'msg', role: 'status', 'aria-live': 'polite' });
    const field = (label, input) => el('div', { class: 'field' }, [el('label', { text: label }), input]);
    const from = el('select', { 'aria-label': 'Depuis' }, r.sources.map((src) => el('option', { value: src.country, text: countryLabel(src.country) + ' · peut donner ' + money(src.surplus) + (src.available === null ? ' (jamais relevé)' : '') })));
    if (r.plan) from.value = r.plan.from;
    const amount = el('input', { 'data-amount': true, inputmode: 'numeric', autocomplete: 'off', value: r.plan ? r.plan.amount : '', 'aria-label': 'Montant' });
    const go = el('button', { class: 'btn btn-sm', type: 'button' }, [icon('swap'), 'Demander le transfert']);
    go.addEventListener('click', async () => {
      say(msg, '');
      const a = digits(amount.value);
      if (!a) return say(msg, 'Indiquez le montant à transférer.', 'err');
      if (!from.value) return say(msg, 'Aucun autre wallet de ce fournisseur n’est connu.', 'err');
      go.disabled = true;
      await guarded(async () => {
        const t = (await LP.api('POST', '/v1/admin-console/transfers', { provider: w.provider.toLowerCase(), from: from.value, to: w.country, amount: a })).transfer;
        transfers = null;
        location.hash = '#/reserves/' + t.id;
      }, msg);
      go.disabled = false;
    });
    const intro = r.plan
      ? 'Proposé : ' + money(r.plan.amount) + ' depuis ' + countryLabel(r.plan.from) + ', pour revenir au niveau cible (marge comprise).'
      : 'Rien à proposer : ce wallet est à son niveau cible, aucun niveau n’est fixé, ou aucun autre pays n’a de surplus.';
    return detailPanel('Rééquilibrer', [el('p', { class: 'small muted', text: intro }), field('Depuis', from), field('Montant envoyé (FCFA)', amount), el('div', { class: 'btn-row mt' }, [go]), msg]);
  }

  $('checkForm').addEventListener('submit', async (e) => {
    e.preventDefault(); say('checkMsg', '');
    const balance = digits($('checkBalance').value);
    if (!balance) return say('checkMsg', 'Indiquez le solde affiché par le provider.', 'err');
    $('checkGo').disabled = true;
    await guarded(async () => {
      const r = await LP.api('POST', '/v1/admin-console/reserves/checks', { provider: $('checkProvider').value, country: $('checkCountry').value, balance: balance, note: $('checkNote').value.trim() || undefined });
      $('checkBalance').value = ''; $('checkNote').value = '';
      resData = r.reserves; renderReserves(resData);
      say('checkMsg', 'Relevé enregistré.', 'ok');
    }, 'checkMsg');
    $('checkGo').disabled = false;
  });

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
      const walletsHost = items(d.wallets.map((x) => ({
        href: x.id === u.id ? null : '#/users/' + x.id,
        title: (x.label || 'Principal') + (x.is_default ? ' · par défaut' : ''),
        sub: [x.country, x.status === 'ACTIVE' ? '' : x.status === 'CLOSED' ? 'fermé' : 'gelé', x.id === u.id ? 'ce wallet' : ''].filter(Boolean).join(' · '),
        end: money(Number(x.available_balance) + Number(x.locked_balance)),
      })), 'Aucun wallet.');
      $('userDetail').replaceChildren(detailPanel('Compte', [box]), flushPanel('Ses wallets', walletsHost), flushPanel('Apps connectées', appsHost), flushPanel('Derniers mouvements', movesHost));
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

  // ---------------------------------------------------------------- routing rules (ordered list; one rule = its own screen)
  const KIND_NAME = { collection: 'Encaissement', payout: 'Envoi' };
  const TYPE_NAME = { deposit: 'Dépôt', payment: 'Paiement', withdrawal: 'Retrait', refund: 'Remboursement' };
  let routing = null;
  const countryName = (c) => { const x = routing.options.countries.filter((o) => o.code === c)[0]; return x ? x.name : c; };
  const networkLabel = (n) => { const x = routing.options.networks.filter((o) => o.network === n)[0]; return x ? x.name + ' · ' + countryName(x.country) : n; };
  const appName = (a) => { const x = routing.options.apps.filter((o) => o.id === a)[0]; return x ? x.name : a; };
  function ruleSummary(r) {
    const parts = [r.types.length ? r.types.map((t) => TYPE_NAME[t]).join(', ') : (r.kind === 'collection' ? 'Tout encaissement' : 'Tout envoi')];
    if (r.networks.length) parts.push(r.networks.map(networkLabel).join(', '));
    else if (r.countries.length) parts.push('depuis ' + r.countries.map(countryName).join(', '));
    if (r.destinations.length) parts.push('wallet ' + r.destinations.map(countryName).join(', '));
    if (r.apps.length) parts.push(r.apps.map(appName).join(', '));
    if (r.require_reserve) parts.push('si sa réserve suffit');
    return parts.join(' · ');
  }
  async function loadRouting() { routing = await LP.api('GET', '/v1/admin-console/routing'); return routing; }
  async function saveRules(rules) {
    const r = await LP.api('PUT', '/v1/admin-console/routing', { rules: rules });
    routing.rules = r.rules;
    return r.rules;
  }
  function renderRouting() {
    table($('routeTable'), [{ label: 'Ordre', cls: 'num' }, { label: 'Règle' }, { label: 'Fournisseur' }, { label: 'État' }],
      routing.rules.map((r, i) => ({ href: '#/routing/' + r.id, cells: [num(i + 1), cell(r.name, KIND_NAME[r.kind] + ' · ' + ruleSummary(r)), provName(r.provider), el('span', { class: 'pill ' + (r.enabled ? 'ok' : ''), text: r.enabled ? 'active' : 'désactivée' })] }))
        .concat([{ fixed: true, cells: ['', cell('Sinon', 'Fournisseur par défaut (Fournisseurs)'), 'Encaissements : ' + provName(routing.default.collection) + ' · envois : ' + provName(routing.default.payout), ''] }]),
      'Aucune règle.');
    const opts = (host, list, keep) => { const cur = $(host).value; $(host).replaceChildren.apply($(host), list.map((o) => el('option', { value: o[0], text: o[1] }))); if (keep && cur) $(host).value = cur; };
    opts('simType', routing.options.types.map((t) => [t.type, TYPE_NAME[t.type]]), true);
    opts('simNetwork', routing.options.networks.map((n) => [n.network, networkLabel(n.network)]), true);
    opts('simDest', [['', 'Congo-Brazzaville (par défaut)']].concat(routing.options.countries.map((c) => [c.code, c.name])), true);
    opts('simApp', [['', 'Compte LightPay (aucune app)']].concat(routing.options.apps.map((a) => [a.id, a.name])), true);
  }
  async function enterRouting() {
    crumbs('Réglages', 'Routage');
    if (routing) renderRouting(); else skeleton($('routeTable'), 3, 'div');
    await load('routing', async () => { await loadRouting(); renderRouting(); });
  }
  $('simForm').addEventListener('submit', async (e) => {
    e.preventDefault(); say('simMsg', '');
    const amount = digits($('simAmount').value);
    if (!amount) return say('simMsg', 'Indiquez un montant.', 'err');
    $('simGo').disabled = true;
    await guarded(async () => {
      const r = await LP.api('POST', '/v1/admin-console/routing/simulate', { type: $('simType').value, network: $('simNetwork').value, destination: $('simDest').value || undefined, app: $('simApp').value || undefined, amount: amount });
      const steps = items(r.steps.map((st) => ({ title: st.name, sub: st.skipped ? 'passée : ' + st.skipped : 'choisie', end: st.skipped ? '—' : provName(r.provider) })), 'Aucune règle : le fournisseur par défaut sert.');
      const configured = r.fees.filter((f) => f.configured);
      const cheapest = configured.length ? configured.reduce((a, b) => (Number(b.operator_fee) < Number(a.operator_fee) ? b : a)) : null;
      const feeHost = el('div', {});
      table(feeHost, [{ label: 'Fournisseur' }, { label: 'Frais opérateur', cls: 'num' }, { label: 'Pris en vrai', cls: 'num' }, { label: 'Frais LightPay', cls: 'num' }, { label: r.fees[0] ? r.fees[0].label : 'Total', cls: 'num' }],
        r.fees.map((f) => ({ cells: [
          cell(provName(f.provider), (f.provider === r.provider ? 'choisi' : '') + (cheapest && f.provider === cheapest.provider ? (f.provider === r.provider ? ' · ' : '') + 'le moins cher' : '') + (f.configured ? '' : 'clés absentes')),
          money(f.operator_fee),
          f.real_operator_fee === null || f.real_operator_fee === undefined ? '—' : el('span', { class: Number(f.real_operator_fee) > Number(f.operator_fee) ? 'err-text' : '', text: money(f.real_operator_fee) }),
          money(f.lightpay_fee), money(f.total),
        ] })),
        'Aucun fournisseur sur cet environnement.');
      $('simResult').replaceChildren(
        el('p', { class: 'check ok mt' }, [icon('check'), 'Servi par ' + provName(r.provider) + (r.rule ? ' (règle « ' + r.rule.name + ' »).' : ' (fournisseur par défaut).')]),
        steps, feeHost);
    }, 'simMsg');
    $('simGo').disabled = false;
  });

  async function enterRule(id) {
    crumbs('Routage', 'Règle');
    $('ruleTitle').textContent = id === 'new' ? 'Nouvelle règle' : 'Règle';
    $('ruleDetail').replaceChildren(); skeleton($('ruleDetail'), 5, 'div');
    await load('rule', async () => {
      await loadRouting();
      const index = routing.rules.findIndex((r) => r.id === id);
      if (id !== 'new' && index < 0) throw new Error('Règle introuvable.');
      const rule = index >= 0 ? routing.rules[index] : { id: '', name: '', kind: 'collection', types: [], countries: [], networks: [], destinations: [], apps: [], provider: routing.default.collection, require_reserve: false, enabled: true };
      if (index >= 0) $('ruleTitle').textContent = rule.name;
      const msg = el('div', { class: 'msg', role: 'status', 'aria-live': 'polite' });
      const field = (label, input) => el('div', { class: 'field' }, [el('label', { text: label }), input]);
      const check = (label, on) => { const c = el('input', { type: 'checkbox' }); c.checked = on; return { box: c, row: el('label', { class: 'agree' }, [c, el('span', { text: label })]) }; };
      const group = (list, chosen) => { const boxes = list.map((o) => Object.assign(check(o[1], chosen.indexOf(o[0]) >= 0), { value: o[0] })); return { boxes: boxes, node: el('div', { class: 'rule-checks' }, boxes.map((b) => b.row)), get: () => boxes.filter((b) => b.box.checked).map((b) => b.value) }; };
      const name = el('input', { maxlength: '80', autocomplete: 'off', value: rule.name, 'aria-label': 'Nom' });
      const kind = el('select', {}, [el('option', { value: 'collection', text: 'Encaissement (dépôt, paiement)' }), el('option', { value: 'payout', text: 'Envoi (retrait, remboursement)' })]);
      kind.value = rule.kind;
      const provider = el('select', {}, routing.options.providers.map((pr) => el('option', { value: pr.name, text: provName(pr.name) + (pr.configured ? '' : ' (clés absentes)') })));
      provider.value = rule.provider;
      const typesHost = el('div', {});
      let types = null;
      const renderTypes = () => { types = group(routing.options.types.filter((t) => t.kind === kind.value).map((t) => [t.type, TYPE_NAME[t.type]]), rule.kind === kind.value ? rule.types : []); typesHost.replaceChildren(types.node); };
      renderTypes();
      const countries = group(routing.options.countries.map((c) => [c.code, c.name]), rule.countries);
      const networks = group(routing.options.networks.map((n) => [n.network, networkLabel(n.network)]), rule.networks);
      const destinations = group(routing.options.countries.map((c) => [c.code, c.name]), rule.destinations);
      const apps = group([['mainapp', 'Compte LightPay']].concat(routing.options.apps.map((a) => [a.id, a.name])), rule.apps);
      const reserve = check('Seulement si sa réserve dans ce pays couvre le montant (sinon la règle suivante)', rule.require_reserve);
      const enabled = check('Règle active', rule.enabled);
      const syncKind = () => { reserve.row.hidden = kind.value !== 'payout'; };
      kind.addEventListener('change', () => { renderTypes(); syncKind(); });
      syncKind();
      const current = () => ({ id: rule.id || undefined, name: name.value.trim(), kind: kind.value, types: types.get(), countries: countries.get(), networks: networks.get(), destinations: destinations.get(), apps: apps.get(), provider: provider.value, require_reserve: kind.value === 'payout' && reserve.box.checked, enabled: enabled.box.checked });
      const others = () => routing.rules.filter((r) => r.id !== rule.id);
      const act = async (button, rules, done, back) => {
        say(msg, ''); button.disabled = true;
        await guarded(async () => {
          const saved = await saveRules(rules);
          if (back) { location.hash = '#/routing'; return; }
          const again = saved.filter((r) => r.name === current().name && r.kind === current().kind)[0] || saved[saved.length - 1];
          if (!rule.id && again) { location.hash = '#/routing/' + again.id; return; }
          say(msg, done, 'ok');
        }, msg);
        button.disabled = false;
      };
      const save = el('button', { class: 'btn', type: 'button' }, [icon('check'), 'Enregistrer']);
      save.addEventListener('click', () => {
        if (!name.value.trim()) return say(msg, 'Donnez un nom à la règle.', 'err');
        const list = routing.rules.slice();
        if (index >= 0) list[index] = current(); else list.push(current());
        act(save, list, 'Règle enregistrée : elle s’applique tout de suite.');
      });
      const move = (delta, label) => {
        const b = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: label });
        if (index < 0 || index + delta < 0 || index + delta >= routing.rules.length) b.disabled = true;
        b.addEventListener('click', () => { const list = routing.rules.slice(); const r = list.splice(index, 1)[0]; list.splice(index + delta, 0, r); act(b, list, 'Ordre enregistré.', true); });
        return b;
      };
      const remove = el('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Supprimer la règle' });
      if (index < 0) remove.hidden = true;
      remove.addEventListener('click', () => act(remove, others(), 'Règle supprimée.', true));
      $('ruleDetail').replaceChildren(
        detailPanel('Règle', [
          field('Nom', name), field('Sens', kind), field('Fournisseur', provider),
          el('p', { class: 'hint', text: 'Ce qui n’est pas coché ne restreint rien.' }),
          field('Opérations', typesHost),
          field('Pays de l’opérateur du téléphone', countries.node),
          field('Opérateurs', networks.node),
          field('Pays du wallet', destinations.node),
          field('Apps', apps.node),
          el('div', { class: 'msg-switches' }, [reserve.row, enabled.row]),
          el('div', { class: 'btn-row mt-lg' }, [save, move(-1, 'Monter'), move(1, 'Descendre')]),
          el('div', { class: 'mt' }, [remove]),
          msg,
        ]));
    });
  }

  // ---------------------------------------------------------------- wallets moving to another country (the admin decides)
  const CR_STATUS = { PENDING: ['warn', 'à traiter'], APPROVED: ['ok', 'acceptée'], REJECTED: ['err', 'refusée'], CANCELLED: ['', 'annulée'] };
  const crPill = (st) => { const x = CR_STATUS[st] || ['', st]; return el('span', { class: 'pill ' + x[0], text: x[1] }); };
  const crCountry = (code) => code || '—';
  function setCountryCount(n) { const c = $('navCountryCount'); c.hidden = !n; c.textContent = n ? String(n) : ''; }
  let crList = null;
  function renderCountryRequests() {
    table($('crTable'), [{ label: 'Demande' }, { label: 'Solde', cls: 'num' }, { label: 'État' }],
      crList.map((r) => ({ href: '#/country-requests/' + encodeURIComponent(r.id), cells: [
        cell((r.owner_name || r.owner_email || 'Compte LightPay') + ' · ' + crCountry(r.from_country) + ' → ' + crCountry(r.to_country), (r.wallet_label || 'Wallet') + ' · ' + fmtDateTime(r.updated_at)),
        money(r.available_balance), crPill(r.status),
      ], keys: [new Date(r.created_at).getTime(), Number(r.available_balance), r.status] })),
      segValue('crStatus') === 'PENDING' ? 'Aucune demande à traiter.' : 'Aucune demande.');
  }
  async function enterCountryRequests() {
    crumbs('Contrôle', 'Changements de pays');
    if (crList) renderCountryRequests(); else skeleton($('crTable'), 3, 'div');
    await load('country-requests', async () => {
      const r = await LP.api('GET', '/v1/admin-console/country-requests?status=' + encodeURIComponent(segValue('crStatus')));
      crList = r.requests; setCountryCount(r.pending);
      renderCountryRequests();
    });
  }
  async function enterCountryRequest(id) {
    crumbs('Changements de pays', 'Demande');
    $('country-requestTitle').textContent = 'Demande';
    $('crDetail').replaceChildren(); skeleton($('crDetail'), 5, 'div');
    await load('country-request', async () => {
      const r = (await LP.api('GET', '/v1/admin-console/country-requests/' + encodeURIComponent(id))).request;
      $('country-requestTitle').textContent = crCountry(r.from_country) + ' → ' + crCountry(r.to_country);
      const box = el('div', { class: 'rows' });
      rows(box, [
        ['Personne', (r.owner_name || '—') + (r.owner_email ? ' · ' + r.owner_email : '')], ['Wallet', r.wallet_label || 'Wallet'],
        ['Pays actuel', crCountry(r.from_country)], ['Pays demandé', crCountry(r.to_country)],
        ['Solde disponible', money(r.available_balance)], ['Bloqué (séquestre)', money(r.locked_balance)],
        [r.status === 'PENDING' ? 'Frais si vous acceptez maintenant' : 'Frais pris', money(r.fee_now || 0), true],
        ['Demandée le', fmtDateTime(r.created_at)],
      ].concat(r.reason ? [['Raison donnée', r.reason]] : []).concat(r.decided_at ? [['Décidée le', fmtDateTime(r.decided_at) + (r.decided_by ? ' · ' + r.decided_by : '')]] : []).concat(r.decision_note ? [['Motif du refus', r.decision_note]] : []));
      const parts = [detailPanel('Demande', [crPill(r.status), box, el('p', { class: 'mono mt', text: r.id })])];
      if (r.status === 'PENDING') {
        const msg = el('div', { class: 'msg', role: 'status', 'aria-live': 'polite' });
        const note = el('input', { maxlength: '300', autocomplete: 'off', placeholder: 'Raison du refus (la personne la verra)', 'aria-label': 'Raison du refus' });
        const approve = el('button', { class: 'btn', type: 'button' }, [icon('check'), 'Accepter']);
        const reject = el('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Refuser' });
        const decide = async (button, path, body, done) => {
          say(msg, ''); button.disabled = true;
          await guarded(async () => {
            await LP.api('POST', '/v1/admin-console/country-requests/' + encodeURIComponent(r.id) + path, body);
            crList = null;
            await enterCountryRequest(id);
            say('country-requestMsg', done, 'ok');
          }, msg);
          button.disabled = false;
        };
        approve.addEventListener('click', () => decide(approve, '/approve', {}, 'Acceptée : le wallet a changé de pays.'));
        reject.addEventListener('click', () => { if (!note.value.trim()) return say(msg, 'Indiquez la raison du refus.', 'err'); decide(reject, '/reject', { note: note.value.trim() }, 'Refusée.'); });
        parts.push(detailPanel('Décision', [
          el('p', { class: 'small muted', text: 'Accepter prend les frais sur le solde disponible du moment, puis change le pays du wallet. Le solde reste en FCFA.' }),
          el('div', { class: 'btn-row mt' }, [approve]),
          el('div', { class: 'field mt' }, [el('label', { text: 'Ou refuser' }), note]),
          el('div', { class: 'mt' }, [reject]), msg,
        ]));
      }
      $('crDetail').replaceChildren.apply($('crDetail'), parts);
    });
  }

  // ---------------------------------------------------------------- providers' live prices
  // "3,5 %", "2,2 % + 50", several bands joined; "—" when the operator is not open there.
  const pctFr = (n) => String(Math.round(n * 100) / 100).replace('.', ',') + ' %';
  const tierText = (side) => !side || !side.available ? '—' : side.tiers.map((t) => pctFr(t.percent) + (t.fixed ? ' + ' + num(t.fixed) : '') + (t.min > 0 || t.max !== null ? ' (' + num(t.min) + (t.max !== null ? ' à ' + num(t.max) : ' et plus') + ')' : '') + (t.floor ? ' min ' + num(t.floor) : '') + (t.cap ? ' max ' + num(t.cap) : '')).join(' · ');
  let rates = null;
  async function loadRates(refresh) {
    rates = (await LP.api('GET', '/v1/admin-console/provider-rates' + (refresh ? '?refresh=1' : ''))).providers;
    return rates;
  }
  const rateOf = (provider, network) => { const p = rates && rates.filter((x) => x.provider === provider)[0]; return p ? p.rates.filter((r) => r.network === network)[0] || null : null; };
  function renderRates() {
    const all = [];
    (rates || []).forEach((p) => p.rates.forEach((r) => all.push(Object.assign({ provider: p.provider }, r))));
    table($('ratesTable'), [{ label: 'Opérateur' }, { label: 'Encaissement' }, { label: 'Envoi' }],
      all.map((r) => ({ cells: [
        cell(r.name, [provName(r.provider), r.country, r.currency, r.network ? '' : 'pas dans le registre', r.collection.otpRequired ? 'code OTP avant paiement' : ''].filter(Boolean).join(' · ')),
        tierText(r.collection), tierText(r.payout),
      ], keys: [r.country + ' ' + r.name, r.collection.tiers[0] ? r.collection.tiers[0].percent : -1, r.payout.tiers[0] ? r.payout.tiers[0].percent : -1] })),
      TEST ? 'Les fournisseurs ne donnent pas leurs tarifs sur le compte de test.' : 'Aucun fournisseur ne donne ses tarifs pour le moment.');
    const read = (rates || []).filter((p) => p.fetched_at).map((p) => provName(p.provider) + ' lu à ' + fmtDateTime(p.fetched_at));
    const errors = (rates || []).filter((p) => p.error).map((p) => provName(p.provider) + ' : ' + p.error);
    $('ratesFoot').textContent = (read.length ? read.join(' · ') + '. ' : '') + (errors.length ? 'Lecture impossible — ' + errors.join(' · ') + '. ' : '') + 'Les frais payés par les personnes restent ceux réglés ci-dessus.';
  }
  $('ratesRefresh').addEventListener('click', async () => {
    $('ratesRefresh').disabled = true;
    await guarded(async () => { await loadRates(true); renderRates(); }, 'feesMsg');
    $('ratesRefresh').disabled = false;
  });

  // ---------------------------------------------------------------- countries and operators (one list for both ledgers)
  let registry = null;
  function renderCountries() {
    table($('countryTable'), [{ label: 'Pays' }, { label: 'Opérateurs actifs', cls: 'num' }, { label: 'État' }],
      registry.countries.map((c) => {
        const on = c.rails.filter((r) => r.enabled).length;
        return { href: '#/countries/' + c.code, cells: [cell(c.name, '+' + c.dial + ' · ' + c.currency + ' · ' + c.rails.map((r) => r.name).join(', ')), num(on) + ' / ' + num(c.rails.length), el('span', { class: 'pill ' + (c.enabled ? 'ok' : ''), text: c.enabled ? 'ouvert' : 'fermé' })], keys: [null, on, c.enabled ? 1 : 0] };
      }),
      'Aucun pays.');
  }
  async function enterCountries() {
    crumbs('Réglages', 'Pays et opérateurs');
    if (registry) renderCountries(); else skeleton($('countryTable'), 4, 'div');
    await load('countries', async () => { registry = await LP.api('GET', '/v1/admin-console/countries'); renderCountries(); });
  }
  async function enterCountry(code) {
    crumbs('Pays et opérateurs', 'Pays');
    $('countryTitle').textContent = 'Pays';
    $('countryDetail').replaceChildren(); skeleton($('countryDetail'), 5, 'div');
    await load('country', async () => {
      registry = await LP.api('GET', '/v1/admin-console/countries');
      if (!rates) await loadRates(false).catch(() => null);
      const c = registry.countries.filter((x) => x.code === code)[0];
      if (!c) throw new Error('Pays inconnu.');
      $('countryTitle').textContent = c.name;
      const field = (label, input) => el('div', { class: 'field' }, [el('label', { text: label }), input]);
      const check = (label, on) => { const b = el('input', { type: 'checkbox' }); b.checked = on; return { box: b, row: el('label', { class: 'agree' }, [b, el('span', { text: label })]) }; };
      const after = async (r, msg, text) => { registry = r; say(msg, text, 'ok'); };
      // The country: open or closed, and how a number is written there.
      const cMsg = el('div', { class: 'msg', role: 'status', 'aria-live': 'polite' });
      const open = check('Ouvert aux personnes (dépôts, retraits, paiements)', c.enabled);
      const example = el('input', { maxlength: '30', autocomplete: 'off', value: c.example || '', 'aria-label': 'Exemple de numéro' });
      const cSave = el('button', { class: 'btn btn-sm', type: 'button' }, [icon('check'), 'Enregistrer']);
      cSave.addEventListener('click', async () => {
        say(cMsg, ''); cSave.disabled = true;
        await guarded(async () => after(await LP.api('PUT', '/v1/admin-console/countries/' + c.code, { enabled: open.box.checked, example: example.value.trim() }), cMsg, open.box.checked ? 'Pays ouvert.' : 'Pays fermé.'), cMsg);
        cSave.disabled = false;
      });
      const head = el('div', { class: 'rows' });
      rows(head, [['Indicatif', '+' + c.dial], ['Monnaie', c.currency + (c.currency === 'XOF' ? ' (1 XOF = 1 FCFA dans LightPay)' : '')]]);
      const parts = [detailPanel('Pays', [head, field('Exemple de numéro (affiché dans les formulaires)', example), el('div', { class: 'msg-switches' }, [open.row]), el('div', { class: 'btn-row mt' }, [cSave]), cMsg])];
      // Each operator: on or off, prefixes, providers' codes.
      c.rails.forEach((r) => {
        const msg = el('div', { class: 'msg', role: 'status', 'aria-live': 'polite' });
        const name = el('input', { maxlength: '40', autocomplete: 'off', value: r.name, 'aria-label': 'Nom' });
        const prefixes = el('input', { autocomplete: 'off', value: r.prefixes.join(', '), placeholder: 'ex. 06, 05', 'aria-label': 'Préfixes' });
        const codes = {};
        registry.providers.forEach((pr) => { codes[pr] = el('input', { autocomplete: 'off', value: r.provider_codes[pr] || '', 'aria-label': 'Code ' + provName(pr) }); });
        const on = check('Actif', r.enabled);
        if (!r.supported) { on.box.disabled = true; on.row.append(el('span', { class: 'muted', text: r.auth === 'otp' ? ' · code avant paiement : écran à venir' : ' · page de l’opérateur : écran à venir' })); }
        const save = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, [icon('check'), 'Enregistrer']);
        save.addEventListener('click', async () => {
          say(msg, ''); save.disabled = true;
          const pc = {}; Object.keys(codes).forEach((k) => { pc[k] = codes[k].value.trim(); });
          await guarded(async () => after(await LP.api('PUT', '/v1/admin-console/rails/' + r.method, { name: name.value.trim(), prefixes: prefixes.value, provider_codes: pc, enabled: on.box.checked }), msg, 'Opérateur enregistré.'), msg);
          save.disabled = false;
        });
        const live = registry.providers.map((pr) => { const x = rateOf(pr, r.network); return x ? provName(pr) + ' prend : encaissement ' + tierText(x.collection) + ' · envoi ' + tierText(x.payout) : null; }).filter(Boolean);
        parts.push(detailPanel(r.name + ' · ' + r.network, [
          r.instructions ? el('p', { class: 'small muted', text: 'Avant de payer : ' + r.instructions }) : null,
          live.length ? el('p', { class: 'small muted', text: live.join(' — ') }) : null,
          field('Nom affiché', name),
          field('Préfixes du numéro national (vide : tout numéro du pays)', prefixes),
        ].concat(registry.providers.map((pr) => field('Code ' + provName(pr) + ' (vide : ne sert pas cet opérateur)', codes[pr]))).concat([
          el('div', { class: 'msg-switches' }, [on.row]), el('div', { class: 'btn-row mt' }, [save]), msg,
        ])));
      });
      $('countryDetail').replaceChildren.apply($('countryDetail'), parts);
    });
  }

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
    swap: [
      ['swap_fee_bps', 'Frais de changement de pays', 'Pris sur le solde du wallet quand vous acceptez la demande', 'pct'],
      ['swap_fee_min', 'Frais minimum', 'Le plus grand des deux s’applique (jamais plus que le solde)', 'fcfa'],
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
  function parseFee(raw, unit, range) {
    const t = String(raw).trim().replace(/\\s/g, '').replace(',', '.').replace(/%|fcfa|min|fois/gi, '');
    if (!/^\\d+(\\.\\d+)?$/.test(t)) return NaN;
    const n = Number(t);
    if (unit === 'pct') { const bps = Math.round(n * 100); return Math.abs(bps - n * 100) < 1e-6 && bps <= 5000 ? bps : NaN; }
    const min = range ? range[0] : 0, max = range ? range[1] : 1000000;
    return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
  }
  const UNIT_END = { pct: '%', fcfa: 'FCFA', min: 'min', count: 'fois', num: '' };
  const UNIT_ERR = (unit, range) => unit === 'pct' ? 'Pourcentage de 0 à 50, 2 décimales au plus.' : unit === 'fcfa' ? 'Montant entier en FCFA.' : 'Nombre entier de ' + range[0] + ' à ' + range[1] + '.';
  const shownValue = (v, unit) => unit === 'min' ? v + ' min' : unit === 'count' ? (v === 0 ? 'Aucune limite' : v + (v > 1 ? ' fois' : ' fois')) : unit === 'num' ? String(v) : shown(v, unit);
  /**
   * One value, read as a button; a click turns it into a field (Enter saves, Échap cancels). One code for every settings screen:
   * the store tells where the values are, how a full set is saved and which screen line shows the message.
   * def = [key, label, help, unit, range?]
   */
  function settingItem(def, store) {
    const key = def[0], unit = def[3], range = def[4];
    const li = el('li', { class: 'fee-item' });
    const view = () => {
      const btn = el('button', { class: 'fee-val', type: 'button', text: shownValue(store.get()[key], unit), 'aria-label': def[1] + ' : ' + shownValue(store.get()[key], unit) + '. Modifier' });
      btn.addEventListener('click', edit);
      li.replaceChildren(el('span', { class: 'fee-main' }, [el('span', { class: 'fee-label', text: def[1] }), el('span', { class: 'fee-help', text: def[2] })]), btn);
    };
    const edit = () => {
      const cur = store.get()[key];
      const input = el('input', { inputmode: 'decimal', autocomplete: 'off', value: unit === 'pct' ? pctText(cur) : String(cur), 'aria-label': def[1] });
      const err = el('span', { class: 'fee-err', role: 'alert' });
      const save = async () => {
        const v = parseFee(input.value, unit, range);
        if (isNaN(v)) { err.textContent = UNIT_ERR(unit, range); input.focus(); return; }
        if (store.min1 && store.min1.indexOf(key) >= 0 && v < 1) { err.textContent = 'Au moins 1 FCFA.'; return; }
        if (v === cur) return view();
        ok.disabled = true;
        await guarded(async () => {
          const next = Object.assign({}, store.get()); next[key] = v;
          store.set(await store.put(next));
          view(); li.classList.add('saved'); setTimeout(() => li.classList.remove('saved'), 1600);
          if (store.after) store.after();
        }, store.msg);
        ok.disabled = false;
      };
      const ok = el('button', { class: 'ok', type: 'button', text: 'OK', on: { click: save } });
      const no = el('button', { class: 'no', type: 'button', text: 'Annuler', on: { click: view } });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') view(); });
      li.replaceChildren(el('span', { class: 'fee-main' }, [el('span', { class: 'fee-label', text: def[1] }), err]),
        el('span', { class: 'fee-edit' }, [input, el('span', { class: 'unit', text: UNIT_END[unit] }), no, ok]));
      input.focus(); input.select();
    };
    view();
    return li;
  }
  const FEE_STORE = {
    get: () => feeSet,
    set: (v) => { feeSet = v; },
    put: async (next) => (await LP.api('PUT', '/v1/admin-console/fees', next)).settings,
    after: () => renderCalc(),
    msg: 'feesMsg',
    min1: ['deposit_min', 'withdrawal_min'],
  };
  const feeItem = (def) => settingItem(def, FEE_STORE);
  function renderFees() {
    document.querySelectorAll('[data-prov]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.prov === feeProv));
      b.replaceChildren(PROVIDER[b.dataset.prov.toUpperCase()] || b.dataset.prov);
      if (feeActive && (feeActive.collection === b.dataset.prov || feeActive.payout === b.dataset.prov)) b.append(el('span', { class: 'on-dot', title: 'Actif' }));
    });
    $('feeDep').replaceChildren.apply($('feeDep'), FEE_KEYS.deposit.concat(OPERATOR_KEYS[feeProv].deposit).map(feeItem));
    $('feeWd').replaceChildren.apply($('feeWd'), FEE_KEYS.withdrawal.concat(OPERATOR_KEYS[feeProv].withdrawal).map(feeItem));
    $('feeSwap').replaceChildren.apply($('feeSwap'), FEE_KEYS.swap.map(feeItem));
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
    if (rates) renderRates(); else skeleton($('ratesTable'), 4, 'div');
    loadRates(false).then(renderRates).catch(() => {});
    if (!feeSet) { skeleton($('feeDep'), 4, 'li'); skeleton($('feeWd'), 4, 'li'); skeleton($('feeSwap'), 2, 'li'); }
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

  // ---------------------------------------------------------------- delays and limits (same rows as the fees)
  const CTL_KEYS = {
    delays: [
      ['withdrawal_delay_minutes', 'Délai avant un retrait', 'Le retrait attend ce temps avant de partir vers le téléphone (0 : tout de suite)', 'min'],
      ['refund_delay_minutes', 'Délai avant un remboursement', 'Un client invité est remboursé après ce délai : vous pouvez retenir l’envoi entre-temps', 'min'],
    ],
    limits: [
      ['withdrawal_max_attempts', 'Tentatives de retrait autorisées', 'Au-delà, le compte est suspendu (0 : pas de limite)', 'count'],
      ['withdrawal_attempt_window_minutes', 'Durée de comptage', 'Les tentatives sont comptées sur cette durée', 'min'],
      ['withdrawal_suspension_minutes', 'Durée de la suspension', 'Le compte ne peut ni retirer ni envoyer pendant ce temps', 'min'],
      ['max_wallets', 'Wallets par personne', 'Nombre de wallets qu’une personne peut tenir ouverts à la fois', 'num'],
    ],
  };
  let ctlSet = null, ctlRanges = null;
  const CTL_STORE = {
    get: () => ctlSet,
    set: (v) => { ctlSet = v; },
    put: async (next) => (await LP.api('PUT', '/v1/admin-console/controls', next)).settings,
    msg: 'controlsMsg',
  };
  const ctlDef = (d) => d.slice(0, 4).concat([ctlRanges[d[0]]]);
  async function enterControls() {
    crumbs('Contrôle', 'Délais et limites');
    if (!ctlSet) { skeleton($('ctlDelays'), 2, 'li'); skeleton($('ctlLimits'), 3, 'li'); }
    await load('controls', async () => {
      const r = await LP.api('GET', '/v1/admin-console/controls');
      ctlSet = r.settings; ctlRanges = r.ranges;
      $('ctlDelays').replaceChildren.apply($('ctlDelays'), CTL_KEYS.delays.map((d) => settingItem(ctlDef(d), CTL_STORE)));
      $('ctlLimits').replaceChildren.apply($('ctlLimits'), CTL_KEYS.limits.map((d) => settingItem(ctlDef(d), CTL_STORE)));
    });
  }

  // ---------------------------------------------------------------- emergency brake
  const LEVEL_INFO = [
    ['off', 'Normal', 'Tout fonctionne.'],
    ['withdrawals', 'Retraits fermés', 'Plus personne ne peut retirer ; les envois vers les téléphones (remboursements compris) attendent la réouverture.'],
    ['payments', 'Mouvements suspendus', 'Rien ne bouge : ni dépôt, ni paiement, ni envoi, ni retrait. La consultation reste possible.'],
    ['readonly', 'Lecture seule', 'Mouvements suspendus et aucune écriture dans la base de données.'],
    ['total', 'Arrêt total', 'Plus rien ne touche la base : toutes les requêtes reçoivent « arrêté ». Seule cette page reste active.'],
  ];
  let lockState = null, lockPick = 'off';
  function renderLock() {
    const cur = lockState.level;
    const info = LEVEL_INFO.filter((l) => l[0] === cur)[0];
    const bits = [el('span', { class: 'pill ' + (cur === 'off' ? 'ok' : 'err'), text: info ? info[1] : cur })];
    if (lockState.since) bits.push(el('span', { class: 'muted', text: 'depuis ' + fmtDateTime(lockState.since) + (lockState.by ? ' · ' + lockState.by : '') }));
    if (lockState.reason) bits.push(el('span', { class: 'muted', text: '« ' + lockState.reason + ' »' }));
    if (lockState.forced) bits.push(el('span', { class: 'muted', text: 'Imposé par LIGHTWALLET_LOCKDOWN (' + lockState.forced + ') : à lever sur l’hébergeur.' }));
    $('lockNow').replaceChildren.apply($('lockNow'), bits);
    $('lockLevels').replaceChildren.apply($('lockLevels'), LEVEL_INFO.map((l) => {
      const li = el('li', { class: 'fee-item' });
      const btn = el('button', { class: 'fee-val' + (l[0] === 'off' ? '' : ' danger'), type: 'button', text: l[0] === cur ? 'En vigueur' : l[0] === lockPick ? 'Choisi' : 'Choisir', 'aria-pressed': String(l[0] === lockPick) });
      btn.addEventListener('click', () => { lockPick = l[0]; renderLock(); });
      li.append(el('span', { class: 'fee-main' }, [el('span', { class: 'fee-label', text: l[1] }), el('span', { class: 'fee-help', text: l[2] })]), btn);
      return li;
    }));
    $('lockGo').disabled = lockPick === cur;
  }
  $('lockForm').addEventListener('submit', (e) => { e.preventDefault(); guarded(async () => {
    $('lockGo').disabled = true;
    try {
      lockState = (await LP.api('PUT', '/v1/admin-console/lockdown', { level: lockPick, reason: $('lockReason').value })).lockdown;
      lockPick = lockState.level; $('lockReason').value = '';
      renderLock(); say('lockSaveMsg', 'Niveau appliqué : ' + (LEVEL_INFO.filter((l) => l[0] === lockState.level)[0] || [0, lockState.level])[1] + '.', 'ok');
    } finally { renderLock(); }
  }, 'lockSaveMsg'); });
  async function enterLockdown() {
    crumbs('Contrôle', 'Frein d’urgence');
    await load('lockdown', async () => {
      lockState = (await LP.api('GET', '/v1/admin-console/lockdown')).lockdown;
      lockPick = lockState.level;
      renderLock();
    });
  }

  // ---------------------------------------------------------------- withdrawals and refunds waiting to leave (and the times they really take)
  const PAY_STATUS = { SCHEDULED: ['warn', 'programmé'], HELD: ['err', 'retenu'], PENDING: ['warn', 'en cours'], SUCCEEDED: ['ok', 'envoyé'], FAILED: ['err', 'échoué'] };
  const PAY_KIND = { WITHDRAWAL: 'Retrait', GUEST_REFUND: 'Remboursement' };
  const HOLD_LABEL = { DISPUTE: 'Litige', SUPPORT: 'Support', OTHER: 'Autre' };
  const payPill = (s) => { const x = PAY_STATUS[s] || ['', String(s).toLowerCase()]; return el('span', { class: 'pill ' + x[0], text: x[1] }); };
  const until = (d) => { const s = Math.round((new Date(d) - new Date()) / 1000); return s <= 0 ? 'à l’instant' : s < 90 ? 'dans ' + s + ' s' : 'dans ' + Math.round(s / 60) + ' min'; };
  const dur = (s) => s < 90 ? s + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : (Math.round(s / 360) / 10) + ' h';
  const payOwner = (p) => p.owner_type === 'GUEST' ? 'Invité' : (p.owner_name || p.owner_email || 'Compte LightPay');
  let payList = [], payTimer = null;
  function renderPayouts() {
    table($('payTable'), [{ label: 'Envoi' }, { label: 'Part' }, { label: 'État' }], payList.map((p) => ({
      href: '#/payouts/' + encodeURIComponent(p.id),
      cells: [
        cell(money(p.amount) + ' · ' + (PAY_KIND[p.reason] || p.reason), payOwner(p) + ' · ' + p.msisdn),
        p.status === 'SCHEDULED' ? (p.waiting_transfer ? 'attend un transfert' : until(p.release_at)) : p.status === 'HELD' ? 'retenu · ' + (HOLD_LABEL[p.hold_kind] || '') : fmtDateTime(p.created_at),
        payPill(p.status),
      ],
    })), 'Aucun envoi pour le moment.');
  }
  async function loadPayouts() {
    const r = await LP.api('GET', '/v1/admin-console/payouts?filter=' + (segValue('payFilter') || 'upcoming'));
    payList = r.payouts;
    const obs = r.observed || [];
    const line = (reason) => { const o = obs.filter((x) => x.reason === reason)[0]; return o ? o.n + ' envois en 30 j · moyenne ' + dur(o.avg_seconds) + ' · le plus long ' + dur(o.max_seconds) : 'Aucun envoi terminé en 30 jours'; };
    const box = el('div', { class: 'rows' });
    rows(box, [['Retraits', line('WITHDRAWAL')], ['Remboursements', line('GUEST_REFUND')]]);
    $('payObserved').replaceChildren(el('section', { class: 'panel' }, [el('div', { class: 'panel-head' }, [el('h2', { class: 'panel-title', text: 'Temps observés · de la demande à l’arrivée' })]), el('div', { class: 'panel-body' }, [box])]));
    renderPayouts();
  }
  async function enterPayouts() {
    crumbs('Contrôle', 'Retraits et remboursements');
    if (!payList.length) skeleton($('payTable'), 5, 'div');
    await load('payouts', loadPayouts);
    clearInterval(payTimer);
    payTimer = setInterval(() => { const c = nav.current(); if (c && c.name === 'payouts') loadPayouts().catch(() => {}); else clearInterval(payTimer); }, 15000);
  }
  async function enterPayout(id) {
    crumbs('Retraits et remboursements', 'Envoi');
    $('payoutTitle').textContent = 'Envoi';
    $('payDetail').replaceChildren(); skeleton($('payDetail'), 5, 'div');
    await load('payout', async () => {
      const p = (await LP.api('GET', '/v1/admin-console/payouts/' + encodeURIComponent(id))).payout;
      $('payoutTitle').textContent = money(p.amount) + ' · ' + (PAY_KIND[p.reason] || p.reason);
      const box = el('div', { class: 'rows' });
      const list = [
        ['État', (PAY_STATUS[p.status] || ['', p.status])[1]],
        ['Compte', payOwner(p) + (p.owner_email && p.owner_type !== 'GUEST' ? ' · ' + p.owner_email : '')],
        ['Reçu sur le téléphone', money(p.amount)], ['Frais opérateur', money(p.operator_fee)], ['Frais LightPay', money(p.lightpay_fee)], ['Débité du wallet', money(p.total_debited), true],
        ['Vers', p.msisdn + ' · ' + p.network], ['Demandé le', fmtDateTime(p.created_at)],
      ];
      if (p.status === 'SCHEDULED' && p.waiting_transfer) list.push(['Part', 'à l’arrivée du transfert ' + p.waiting_transfer + ' (au plus tard ' + fmtDateTime(p.release_at) + ')']);
      else if (p.status === 'SCHEDULED') list.push(['Part', fmtDateTime(p.release_at) + ' (' + until(p.release_at) + ')']);
      if (p.status === 'SUCCEEDED') list.push(['Arrivé le', fmtDateTime(p.updated_at)], ['Temps total', dur(Math.round((new Date(p.updated_at) - new Date(p.created_at)) / 1000))]);
      if (p.status === 'FAILED') list.push(['Fin', fmtDateTime(p.updated_at) + (p.failure_code ? ' · ' + p.failure_code : '')]);
      if (p.status === 'HELD') list.push(['Retenu par', (p.held_by || '—') + ' · ' + (p.held_at ? fmtDateTime(p.held_at) : '')], ['Motif', (HOLD_LABEL[p.hold_kind] || '') + ' : ' + (p.hold_reason || '')]);
      list.push(['Numéro d’envoi', p.id]);
      rows(box, list);
      const panels = [detailPanel('Envoi', [box])];
      if (p.status === 'SCHEDULED' || p.status === 'HELD') {
        const msg = el('div', { class: 'msg', id: 'payActMsg', role: 'status', 'aria-live': 'polite' });
        const act = (path, body, done) => guarded(async () => { await LP.api('POST', '/v1/admin-console/payouts/' + encodeURIComponent(p.id) + '/' + path, body); say('payoutMsg', done, 'ok'); payList = []; await enterPayout(id); }, 'payActMsg');
        let kind = 'DISPUTE';
        const kinds = el('div', { class: 'fee-prov', role: 'group', 'aria-label': 'Motif' }, ['DISPUTE', 'SUPPORT', 'OTHER'].map((k) => {
          const b = el('button', { type: 'button', text: HOLD_LABEL[k], 'aria-pressed': String(k === kind) });
          b.addEventListener('click', () => { kind = k; kinds.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', String(o === b))); });
          return b;
        }));
        const reason = el('input', { class: 'search wide mt', placeholder: 'Raison (reste dans le journal)', maxlength: '300', autocomplete: 'off' });
        let armed = false;
        const cancel = el('button', { class: 'btn btn-danger', type: 'button', text: 'Annuler et rendre l’argent' });
        cancel.addEventListener('click', () => { if (!armed) { armed = true; cancel.textContent = 'Confirmer : rendre ' + money(p.total_debited) + ' au wallet'; return; } act('cancel', {}, 'Envoi annulé : le wallet a retrouvé son argent.'); });
        const buttons = [];
        if (p.status === 'SCHEDULED') {
          buttons.push(el('button', { class: 'btn btn-secondary', type: 'button', text: 'Retenir', on: { click: () => { if (!reason.value.trim()) { say('payActMsg', 'Indiquez la raison de la retenue.', 'err'); return; } act('hold', { kind: kind, reason: reason.value }, 'Envoi retenu.'); } } }));
        }
        buttons.push(el('button', { class: 'btn', type: 'button', text: p.status === 'HELD' ? 'Libérer' : 'Envoyer maintenant', on: { click: () => act('release', {}, 'Envoi libéré : il part dans quelques secondes.') } }));
        const body = p.status === 'SCHEDULED' ? [el('p', { class: 'small muted', text: 'Retenir garde l’envoi tant que vous ne le libérez pas : litige, dossier de support ou autre.' }), el('div', { class: 'mt' }, [kinds]), reason] : [el('p', { class: 'small muted', text: 'Cet envoi est retenu : il ne partira qu’une fois libéré.' })];
        panels.push(detailPanel('Décision', body.concat([el('div', { class: 'btn-row mt' }, buttons), el('div', { class: 'mt' }, [cancel]), msg])));
      }
      $('payDetail').replaceChildren.apply($('payDetail'), panels);
    });
  }

  // ---------------------------------------------------------------- accounts suspended
  async function loadSuspensions() {
    const r = await LP.api('GET', '/v1/admin-console/suspensions');
    table($('susTable'), [{ label: 'Compte' }, { label: 'Jusqu’à' }, { label: '' }], r.suspensions.map((s) => ({
      cells: [cell(s.email || s.uid, (s.kind === 'AUTO' ? 'Automatique' : 'Par vous') + (s.reason ? ' · ' + s.reason : '')), fmtDateTime(s.until),
        el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'Lever', on: { click: (e) => { e.stopPropagation(); guarded(async () => { await LP.api('DELETE', '/v1/admin-console/suspensions/' + encodeURIComponent(s.uid)); say('suspensionsMsg', 'Suspension levée.', 'ok'); await loadSuspensions(); }, 'suspensionsMsg'); } } })],
    })), 'Aucun compte suspendu.');
  }
  $('susForm').addEventListener('submit', (e) => { e.preventDefault(); guarded(async () => {
    $('susGo').disabled = true;
    try {
      await LP.api('POST', '/v1/admin-console/suspensions', { to: $('susTo').value, minutes: Number(digits($('susMinutes').value)), reason: $('susReason').value });
      $('susTo').value = ''; $('susReason').value = '';
      say('susSaveMsg', 'Compte suspendu.', 'ok');
      await loadSuspensions();
    } finally { $('susGo').disabled = false; }
  }, 'susSaveMsg'); });
  async function enterSuspensions() {
    crumbs('Contrôle', 'Comptes suspendus');
    skeleton($('susTable'), 3, 'div');
    await load('suspensions', loadSuspensions);
  }

  // ---------------------------------------------------------------- automatic messages
  // Every message is a template with {variables}; the preview fills them with example values.
  let msgList = null;
  const fillVars = (text, vars) => { let out = String(text || ''); (vars || []).forEach((v) => { out = out.split('{' + v.name + '}').join(v.sample); }); return out.trim(); };
  const firstLine = (t) => String(t || '').split(String.fromCharCode(10))[0];
  function msgPill(m) {
    if (!m.current.enabled) return el('span', { class: 'msg-pill off', text: 'Désactivé' });
    if (m.custom) return el('span', { class: 'msg-pill custom', text: 'Modifié' });
    return el('span', { class: 'msg-pill', text: [m.current.push ? 'Push' : null, m.current.email ? 'E-mail' : null].filter(Boolean).join(' · ') || '—' });
  }
  async function loadMessages() { msgList = (await LP.api('GET', '/v1/admin-console/messages')).messages; }
  async function enterMessages() {
    crumbs('Réglages', 'Messages');
    if (!msgList) skeleton($('msgGroups'), 6, 'div');
    await load('messages', async () => {
      await loadMessages();
      const groups = [];
      msgList.forEach((m) => { let g = groups.filter((x) => x.name === m.group)[0]; if (!g) { g = { name: m.group, list: [] }; groups.push(g); } g.list.push(m); });
      $('msgGroups').replaceChildren.apply($('msgGroups'), groups.map((g) => flushPanel(g.name, items(g.list.map((m) => ({
        title: m.label,
        sub: fillVars(m.current.title, m.vars) + ' — ' + firstLine(fillVars(m.current.body, m.vars)),
        end: msgPill(m),
        href: '#/messages/' + encodeURIComponent(m.event),
      })), 'Aucun message.'))));
    });
  }
  async function enterMessage(event) {
    crumbs('Messages', 'Message');
    $('messageTitle').textContent = 'Message';
    if (!msgList) { $('msgDetail').replaceChildren(); skeleton($('msgDetail'), 5, 'div'); }
    await load('message', async () => {
      if (!msgList) await loadMessages();
      const m = msgList.filter((x) => x.event === event)[0];
      if (!m) { location.hash = '#/messages'; return; }
      $('messageTitle').textContent = m.label;
      const cur = m.current;
      const field = (label, input) => el('div', { class: 'field' }, [el('label', { text: label }), input]);
      const title = el('input', { maxlength: '80', autocomplete: 'off', value: cur.title });
      const body = el('textarea', { maxlength: '500', rows: '5' });
      body.value = cur.body;
      const subject = el('input', { maxlength: '120', autocomplete: 'off', value: cur.subject });
      const check = (label, on) => { const c = el('input', { type: 'checkbox' }); c.checked = on; return { box: c, row: el('label', { class: 'agree' }, [c, el('span', { text: label })]) }; };
      const enabled = check('Envoyer ce message', cur.enabled);
      const push = check('Notification sur le téléphone', cur.push);
      const email = check('E-mail', cur.email);
      // Variables: a click inserts it where the cursor is (in the last field used).
      let target = body;
      [title, body, subject].forEach((f) => f.addEventListener('focus', () => { target = f; }));
      const chips = m.vars.length
        ? el('div', { class: 'vars' }, m.vars.map((v) => el('button', { class: 'var-chip', type: 'button', text: '{' + v.name + '}', title: v.help + ' — ex. ' + v.sample.trim(), on: { click: () => {
            const a = target.selectionStart != null ? target.selectionStart : target.value.length, b = target.selectionEnd != null ? target.selectionEnd : a;
            target.value = target.value.slice(0, a) + '{' + v.name + '}' + target.value.slice(b);
            target.focus(); target.setSelectionRange(a + v.name.length + 2, a + v.name.length + 2); render();
          } } })))
        : el('p', { class: 'hint', text: 'Ce message n’a pas de variable.' });
      const varHelp = el('ul', { class: 'items' }, m.vars.map((v) => el('li', {}, [cell('{' + v.name + '}', v.help), el('span', { class: 'end small muted', text: v.sample.trim() })])));
      // Preview with example values.
      const pTitle = el('div', { class: 'notif-title' }), pBody = el('div', { class: 'notif-body' });
      const notif = el('div', { class: 'notif' }, [el('span', { class: 'brand-mark', 'aria-hidden': 'true' }), el('div', { class: 'notif-main' }, [el('div', { class: 'notif-app', text: 'LightPay · maintenant' }), pTitle, pBody])]);
      const mSubject = el('div', { class: 'mail-subject' }), mBody = el('div', { class: 'mail-body' });
      const mail = el('div', { class: 'mail-prev' }, [mSubject, mBody]);
      const off = el('p', { class: 'prev-off' });
      function render() {
        pTitle.textContent = fillVars(title.value, m.vars);
        pBody.textContent = fillVars(body.value, m.vars);
        mSubject.replaceChildren('Objet : ', el('b', { text: fillVars(subject.value || title.value, m.vars) }));
        mBody.textContent = fillVars(body.value, m.vars);
        notif.hidden = !push.box.checked || !enabled.box.checked;
        mail.hidden = !email.box.checked || !enabled.box.checked;
        off.textContent = !enabled.box.checked ? 'Ce message est désactivé : il ne part plus.' : !push.box.checked && !email.box.checked ? 'Ni push ni e-mail : rien ne part.' : '';
        off.hidden = !off.textContent;
      }
      [title, body, subject].forEach((f) => f.addEventListener('input', render));
      [enabled, push, email].forEach((c) => c.box.addEventListener('change', render));
      render();

      const msg = el('div', { class: 'msg', id: 'msgEditMsg', role: 'status', 'aria-live': 'polite' });
      const refresh = async () => { await loadMessages(); };
      const save = el('button', { class: 'btn', type: 'button', text: 'Enregistrer', on: { click: () => guarded(async () => {
        save.disabled = true;
        try {
          await LP.api('PUT', '/v1/admin-console/messages/' + encodeURIComponent(m.event), { title: title.value, body: body.value, subject: subject.value, push: push.box.checked, email: email.box.checked, enabled: enabled.box.checked });
          await refresh(); say('msgEditMsg', 'Enregistré : les prochains messages partent avec ce texte.', 'ok');
        } finally { save.disabled = false; }
      }, 'msgEditMsg') } });
      let armed = false;
      const reset = el('button', { class: 'btn btn-secondary', type: 'button', text: 'Rétablir le texte d’origine', on: { click: () => {
        if (!armed) { armed = true; reset.textContent = 'Confirmer : revenir au texte d’origine'; return; }
        guarded(async () => {
          await LP.api('DELETE', '/v1/admin-console/messages/' + encodeURIComponent(m.event));
          await refresh(); await enterMessage(event); say('messageMsg', 'Texte d’origine rétabli.', 'ok');
        }, 'msgEditMsg');
      } } });
      const test = el('button', { class: 'btn btn-secondary', type: 'button', text: 'Envoyer un test sur mon téléphone', on: { click: () => guarded(async () => {
        test.disabled = true;
        try {
          const r = await LP.api('POST', '/v1/admin-console/messages/' + encodeURIComponent(m.event) + '/test');
          say('msgEditMsg', (r.phones ? 'Test envoyé à ' + r.phones + (r.phones > 1 ? ' téléphones' : ' téléphone') : 'Aucun téléphone avec l’app connecté à votre compte : pas de push') + (r.email ? ' et à votre e-mail.' : '.') + ' (Le texte enregistré, pas celui en cours de saisie.)', 'ok');
        } finally { test.disabled = false; }
      }, 'msgEditMsg') } });
      if (!m.custom) reset.hidden = true;

      const form = detailPanel('Texte', [
        el('div', { class: 'msg-switches' }, [enabled.row, push.row, email.row]),
        field('Titre (notification)', title),
        field('Texte', body),
        field('Objet de l’e-mail', subject),
        el('p', { class: 'hint', text: 'Variables : cliquez pour l’insérer. Une ligne vide coupe le texte en deux lignes sur le téléphone.' }),
        chips,
        el('div', { class: 'btn-row mt-lg' }, [save, test]),
        el('div', { class: 'mt' }, [reset]),
        msg,
      ]);
      const preview = detailPanel('Aperçu (valeurs d’exemple)', [notif, mail, off]);
      const vars = m.vars.length ? flushPanel('Variables', varHelp) : null;
      $('msgDetail').replaceChildren(el('div', { class: 'grid-2' }, [form, el('div', {}, [preview, vars].filter(Boolean))]));
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
    reserve: { parent: 'reserves', enter: withNav('reserves', enterReserve) },
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
    routing: { enter: withNav('routing', enterRouting) },
    rule: { parent: 'routing', enter: withNav('routing', enterRule) },
    countries: { enter: withNav('countries', enterCountries) },
    country: { parent: 'countries', enter: withNav('countries', enterCountry) },
    'country-requests': { enter: withNav('country-requests', enterCountryRequests) },
    'country-request': { parent: 'country-requests', enter: withNav('country-requests', enterCountryRequest) },
    audit: { enter: withNav('audit', enterAudit) },
    lockdown: { enter: withNav('lockdown', enterLockdown) },
    controls: { enter: withNav('controls', enterControls) },
    payouts: { enter: withNav('payouts', enterPayouts) },
    payout: { parent: 'payouts', enter: withNav('payouts', enterPayout) },
    suspensions: { enter: withNav('suspensions', enterSuspensions) },
    messages: { enter: withNav('messages', enterMessages) },
    message: { parent: 'messages', enter: withNav('messages', enterMessage) },
    denied: { enter: () => {} },
  };
  const nav = createNav({
    root: 'home',
    // #/users/<id> opens the item screen "user" (and so on): a list and its item never share a screen.
    resolve: (route) => {
      const ITEM = { reserves: 'reserve', routing: 'rule', countries: 'country', 'country-requests': 'country-request', users: 'user', apps: 'app', developers: 'developer', moves: 'move', payouts: 'payout', messages: 'message' };
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
      // Reserve alerts show in the menu from the start, whatever screen opens first.
      const first = nav.current();
      if (!first || first.name !== 'reserves') void refreshResCount();
      // Country changes waiting for a decision show in the menu too.
      LP.api('GET', '/v1/admin-console/country-requests?status=PENDING').then((r) => setCountryCount(r.pending)).catch(() => {});
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
