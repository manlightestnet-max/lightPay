import { shell, themeToggle } from './shell.js';
import { iconSvg } from './icons.js';
import { CONSOLE_CSS } from './console.js';

/**
 * /admin — the owner's console (LightPay sign-in listed in ADMIN_UIDS). Revenue first, then the
 * provider reserves, users, apps, every movement, the main wallet and the admin log.
 * Hash routes: #/home · #/reserves · #/users[/<wallet>] · #/apps[/<id>] · #/moves[/<tx>] · #/main · #/audit
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
.check.ok { color: var(--accent); } .check.err { color: var(--danger); }
.share { white-space: pre-wrap; font-size: 14px; line-height: 1.6; padding: 14px 16px; border-radius: 12px; background: var(--raised); }
.search { width: 100%; max-width: 320px; height: 36px; border-radius: 10px; border: 1px solid var(--line-strong); background: var(--card); padding: 0 12px; font-size: 14px; }
.search:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.debit { color: var(--danger); } .credit { color: var(--accent); }
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
const page = (screen: string, title: string, inner: string, actions = '') => `
<section class="screen" data-screen="${screen}" hidden><div class="page">
  <div class="page-head"><h1 class="page-title">${title}</h1>${envBadge}${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>
  <div class="msg" id="${screen}Msg" role="status" aria-live="polite"></div>
  ${inner}
</div></section>`;
const panel = (title: string, body: string, opts: { id?: string; actions?: string; flush?: boolean; foot?: string } = {}) =>
  `<section class="panel"><div class="panel-head"><h2 class="panel-title">${title}</h2>${opts.actions ?? ''}</div><div class="${opts.flush ? 'panel-flush' : 'panel-body'}"${opts.id ? ` id="${opts.id}"` : ''}>${body}</div>${opts.foot ? `<div class="panel-foot">${opts.foot}</div>` : ''}</section>`;
const stat = (id: string, label: string, hintId: string, accent = false) =>
  `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value${accent ? ' accent' : ''}" id="${id}">—</div><div class="stat-hint" id="${hintId}"></div></div>`;

export const adminPage = (nonce: string, env: string) => {
  const body = `
<div class="console-shell" hidden>
<aside class="side" id="side" aria-label="Menu">
  <div class="side-head"><span class="brand"><span class="brand-mark">${iconSvg('bolt')}</span><span>LightPay<small>Administration</small></span></span></div>
  <nav class="env-switch" aria-label="Environnement"><a id="envReal" href="/admin">Réel</a><a id="envTest" class="test" href="/admin?env=sandbox">Test</a></nav>
  <nav class="side-nav" aria-label="Navigation">
    <div class="nav-label">Pilotage</div>
    ${navItem('home', 'home', 'home', 'Revenus et activité')}
    ${navItem('reserves', 'reserves', 'shield', 'Réserves providers')}
    <div class="nav-label">Réseau</div>
    ${navItem('users', 'users', 'user', 'Utilisateurs')}
    ${navItem('apps', 'apps', 'apps', 'Applications')}
    ${navItem('moves', 'moves', 'list', 'Mouvements')}
    <div class="nav-label">Trésorerie</div>
    ${navItem('main', 'main', 'wallet', 'Wallet main')}
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
  ${panel('30 derniers jours', '<div class="bars" id="bars" aria-hidden="true"></div><div class="bars-axis"><span id="barsFrom"></span><span id="barsTo"></span></div>', {
    actions: seg('series', [['transactions', 'Transactions'], ['revenue', 'Bénéfices']]),
  })}
  ${panel('Réseau', `<div class="well">
      ${stat('stUsers', 'Utilisateurs', 'stUsersHint')}
      ${stat('stApps', 'Applications', 'stAppsHint')}
      ${stat('stPayments', 'Paiements', 'stPaymentsHint')}
      ${stat('stMain', 'Wallet main', 'stMainHint')}
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
  <div class="grid-2">
    ${panel('Comptes LightPay', '<div id="usersTable"></div>', { flush: true, actions: '<input class="search" id="usersSearch" type="search" placeholder="Nom ou e-mail" aria-label="Rechercher un utilisateur">', foot: '<button class="link" type="button" id="usersMore" hidden>Afficher plus</button>' })}
    <div class="sticky" id="userDetail"></div>
  </div>
`)}

${page('apps', 'Applications', `
  <div class="grid-2">
    ${panel('Toutes les apps', '<div id="appsTable"></div>', { flush: true })}
    <div class="sticky" id="appDetail"></div>
  </div>
`)}

${page('moves', 'Mouvements', `
  <div class="grid-2">
    ${panel('Toutes les transactions', '<div id="movesTable"></div>', {
      flush: true,
      actions: seg('moveType', [['', 'Tout'], ['deposits', 'Encaissements'], ['payments', 'Paiements'], ['transfers', 'Transferts'], ['payouts', 'Retraits']]),
      foot: '<button class="link" type="button" id="movesMore" hidden>Afficher plus</button>',
    })}
    <div class="sticky" id="moveDetail"></div>
  </div>
`)}

${page('main', 'Wallet main', `
  ${panel('Votre argent', `<div class="well">${stat('mainBalance', 'Disponible', 'mainHint', true)}</div>
    <p class="small muted mt">Vos fonds propres, séparés de l’argent des clients. Il ne peut jamais descendre sous zéro et se recharge uniquement par un vrai dépôt mobile money. Aucun retrait possible depuis l’administration.</p>`)}
  <div class="grid-2">
    ${panel('Envoyer à un utilisateur', `
      <form id="sendForm" novalidate>
        <div class="field"><label for="sendTo">E-mail du compte LightPay</label><input id="sendTo" type="email" autocomplete="off"></div>
        <div class="field"><label for="sendAmount">Montant (FCFA)</label><input id="sendAmount" inputmode="numeric" autocomplete="off"></div>
        <div class="field"><label for="sendNote">Motif (facultatif)</label><input id="sendNote" maxlength="140" autocomplete="off"></div>
        <div class="msg" id="sendMsg" role="status" aria-live="polite"></div>
        <button class="btn mt" type="submit" id="sendGo">${iconSvg('send')}Envoyer</button>
      </form>`)}
    ${panel('Recharger', `
      <form id="rechargeForm" novalidate>
        <div class="field"><label for="rechargeAmount">Montant (FCFA)</label><input id="rechargeAmount" inputmode="numeric" autocomplete="off"></div>
        <p class="hint">Vous payez par MTN MoMo ou Airtel Money sur la page LightPay : l’argent arrive dans le wallet main une fois validé.</p>
        <div class="msg" id="rechargeMsg" role="status" aria-live="polite"></div>
        <button class="btn btn-secondary mt" type="submit" id="rechargeGo">${iconSvg('plus')}Ouvrir la page de paiement</button>
      </form>`)}
  </div>
  ${panel('Mouvements du wallet main', '<div id="mainMoves"></div>', { flush: true })}
`)}

${page('audit', 'Journal admin', panel('Actions faites depuis l’administration', '<div id="auditTable"></div>', { flush: true }))}

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
</div>

<div class="overlay" id="reauth" hidden role="dialog" aria-modal="true" aria-labelledby="reTitle">
  <form class="sheet" id="reForm" novalidate>
    <h2 class="title" id="reTitle">Confirmez votre identité</h2>
    <p class="small muted mt">Pour toute opération sur l’argent, entrez votre mot de passe LightPay.</p>
    <div class="field"><label for="rePass">Mot de passe</label><input id="rePass" type="password" autocomplete="current-password"></div>
    <div class="msg" id="reMsg" role="status" aria-live="polite"></div>
    <div class="btn-row mt-lg"><button class="btn btn-secondary" type="button" id="reCancel">Annuler</button><button class="btn" type="submit" id="reGo">Confirmer</button></div>
  </form>
</div>`;

  const script = `
  const NARROW = window.matchMedia('(max-width: 960px)');
  const money = (v) => LP.money(v, 'XAF');
  const num = (v) => Number(v || 0).toLocaleString('fr-FR');
  const fmtDate = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtDateTime = (d) => new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const TYPE = { COLLECTION: 'Encaissement', PAYMENT: 'Paiement', HOLD: 'Paiement protégé', HOLD_CAPTURE: 'Versé au vendeur', HOLD_RELEASE: 'Séquestre rendu', TRANSFER: 'Transfert', PAYOUT: 'Retrait', REFUND: 'Remboursement', FAUCET: 'Recharge faucet' };
  const STATUS = { SUCCESS: ['ok', 'réussi'], PENDING: ['warn', 'en cours'], FAILED: ['err', 'échoué'], REVERSED: ['err', 'annulé'] };
  const SOURCE = { deposit: 'Frais de dépôt', payment: 'Frais de paiement', withdrawal: 'Frais de retrait', other: 'Autres' };
  const PROVIDER = { SASPAY: 'SasPay', SIMULATOR: 'Simulateur', AUTRE: 'Sans provider indiqué' };
  const ACTION = { MAIN_SEND: 'Envoi depuis le wallet main', MAIN_RECHARGE: 'Recharge du wallet main' };
  const pill = (status) => { const s = STATUS[status] || ['', String(status || '').toLowerCase()]; return el('span', { class: 'pill ' + s[0], text: s[1] }); };
  const rows = (host, list) => host.replaceChildren.apply(host, list.map((r) => el('div', { class: r[2] ? 'total' : '' }, [el('span', { text: r[0] }), el('span', { text: r[1] })])));
  const segValue = (name) => { const b = document.querySelector('[data-seg="' + name + '"] [aria-pressed="true"]'); return b ? b.dataset.value : ''; };
  document.querySelectorAll('[data-seg]').forEach((g) => g.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    g.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    const c = nav.current(); if (c) screens[c.name].enter(c.param);
  }));
  document.querySelectorAll('[data-env-badge]').forEach((b) => { b.hidden = LP.ENV !== 'sandbox'; });

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
  let pending = null;
  async function guarded(action, msg) {
    try { return await action(); }
    catch (e) {
      if (e.reauth) { pending = { action: action, msg: msg }; $('reauth').hidden = false; $('rePass').value = ''; say('reMsg', ''); $('rePass').focus(); return; }
      if (e.signIn) { signIn(); return; }
      say(msg, e.message, 'err');
    }
  }
  $('reCancel').addEventListener('click', () => { pending = null; $('reauth').hidden = true; });
  $('reForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('reGo').disabled = true; say('reMsg', '');
    try { await LP.signIn(LP.email(), $('rePass').value); $('reauth').hidden = true; const p = pending; pending = null; if (p) await guarded(p.action, p.msg); }
    catch (err) { say('reMsg', err.message, 'err'); }
    finally { $('reGo').disabled = false; }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('reauth').hidden) $('reCancel').click();
    else if (!$('confirmSheet').hidden) $('confirmCancel').click();
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
      $('stUsers').textContent = num(o.users); $('stUsersHint').textContent = '+' + num(o.new_users) + ' sur la période · ' + num(o.guests) + ' invités';
      $('stApps').textContent = num(o.apps); $('stAppsHint').textContent = num(o.connections) + ' comptes connectés';
      $('stPayments').textContent = money(o.payments_volume); $('stPaymentsHint').textContent = num(o.payments) + ' paiements';
      $('stMain').textContent = money(o.main_balance); $('stMainHint').textContent = 'vos fonds propres';
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
      rows($('resHeld'), [['Utilisateurs', money(h.users)], ['Invités', money(h.guests)], ['Apps', money(h.apps)], ['Revenus LightPay', money(h.revenue)], ['Wallet main', money(h.main)]]
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
    const c = nav.current(); const sel = c && c.name === 'users' ? c.param : null;
    table($('usersTable'), [{ label: 'Compte' }, { label: 'Apps', cls: 'num' }, { label: 'Solde', cls: 'num' }],
      users.map((u) => ({ href: '#/users/' + u.id, selected: u.id === sel, cells: [cell(u.name || u.email || 'Sans nom', u.email || ''), num(u.apps), money(Number(u.available_balance) + Number(u.locked_balance))] })),
      usersQuery ? 'Aucun compte ne correspond.' : 'Aucun utilisateur pour le moment.');
  }
  async function enterUsers(id) {
    crumbs('Utilisateurs', id ? 'Détail' : '');
    $('usersTable').closest('.panel').hidden = Boolean(id) && NARROW.matches;
    await load('users', async () => {
      if (!users.length || !id) await loadUsers(false); else renderUsers();
      if (!id) { $('userDetail').replaceChildren(); return; }
      const d = await LP.api('GET', '/v1/admin-console/users/' + encodeURIComponent(id));
      const u = d.user;
      const box = el('div', {});
      rows(box, [['E-mail', u.email || '—'], ['Disponible', money(u.available_balance)], ['Bloqué', money(u.locked_balance)], ['Statut', u.status === 'ACTIVE' ? 'actif' : 'fermé'], ['Créé le', fmtDate(u.created_at)]]);
      box.classList.add('rows');
      const appsHost = items(d.apps.map((a) => ({ href: '#/apps/' + a.app_id, title: a.app_name, sub: 'depuis le ' + fmtDate(a.created_at), end: a.status === 'ACTIVE' ? 'connectée' : 'retirée' })), 'Aucune app connectée.');
      const movesHost = items(d.moves.map((m) => ({ href: '#/moves/' + m.transaction_id, title: m.description || TYPE[m.type] || m.type, sub: fmtDateTime(m.created_at), end: signed(m.direction, m.amount) })), 'Aucun mouvement.');
      $('userDetail').replaceChildren(detailPanel(u.name || u.email || 'Compte', [box]), flushPanel('Apps connectées', appsHost), flushPanel('Derniers mouvements', movesHost));
    });
  }

  // ---------------------------------------------------------------- apps
  let apps = [];
  function renderApps() {
    const c = nav.current(); const sel = c && c.name === 'apps' ? c.param : null;
    table($('appsTable'), [{ label: 'App' }, { label: 'Utilisateurs', cls: 'num' }, { label: 'Paiements 30 j', cls: 'num' }],
      apps.map((a) => ({ href: '#/apps/' + a.id, selected: a.id === sel, cells: [cell(a.name, a.id + (a.owner_email ? ' · ' + a.owner_email : a.owner_uid ? '' : ' · sans propriétaire') + (a.is_active ? '' : ' · désactivée')), num(a.users), money(a.volume_30d)] })),
      'Aucune application.');
  }
  async function enterApps(id) {
    crumbs('Applications', id || '');
    $('appsTable').closest('.panel').hidden = Boolean(id) && NARROW.matches;
    await load('apps', async () => {
      if (!apps.length || !id) apps = (await LP.api('GET', '/v1/admin-console/apps')).apps;
      renderApps();
      if (!id) { $('appDetail').replaceChildren(); return; }
      const d = await LP.api('GET', '/v1/admin-console/apps/' + encodeURIComponent(id));
      const box = el('div', { class: 'rows' });
      rows(box, [['Identifiant', d.app.id], ['Propriétaire', d.app.owner_email || (d.app.owner_uid ? 'compte LightPay' : 'non rattachée')], ['Utilisateurs connectés', num(d.app.users)], ['Transactions', num(d.app.transactions)], ['Paiements 30 j', money(d.app.volume_30d)], ['Créée le', fmtDate(d.app.created_at)]]);
      const usersHost = items(d.users.map((u) => ({ href: '#/users/' + u.wallet_id, title: u.name || u.email || 'Sans nom', sub: [u.email, (u.scopes || []).join(', '), u.status === 'ACTIVE' ? '' : 'retirée'].filter(Boolean).join(' · '), end: money(Number(u.available_balance) + Number(u.locked_balance)) })), 'Aucun utilisateur connecté.');
      const walletsHost = items(d.wallets.map((w) => ({ title: w.account_id, sub: w.account_type + ' · ' + w.currency, end: money(Number(w.available_balance) + Number(w.locked_balance)) })), 'Aucun wallet propre.');
      $('appDetail').replaceChildren(detailPanel(d.app.name, [box]), flushPanel('Utilisateurs rattachés', usersHost), flushPanel('Wallets de l’app', walletsHost));
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
    const c = nav.current(); const sel = c && c.name === 'moves' ? c.param : null;
    table($('movesTable'), [{ label: 'Opération' }, { label: 'App' }, { label: 'Montant', cls: 'num' }, { label: 'État' }],
      moves.map((t) => ({ href: '#/moves/' + t.id, selected: t.id === sel, cells: [cell(TYPE[t.type] || t.type, fmtDateTime(t.created_at) + (t.reference ? ' · ' + t.reference : '')), t.app_id, money(t.amount), pill(t.status)] })),
      'Aucun mouvement.');
  }
  async function enterMoves(id) {
    crumbs('Mouvements', id ? 'Détail' : '');
    $('movesTable').closest('.panel').hidden = Boolean(id) && NARROW.matches;
    await load('moves', async () => {
      if (!moves.length || !id || movesType !== segValue('moveType')) await loadMoves(false); else renderMoves();
      if (!id) { $('moveDetail').replaceChildren(); return; }
      const d = await LP.api('GET', '/v1/admin-console/transactions/' + encodeURIComponent(id));
      const t = d.transaction;
      const box = el('div', { class: 'rows' });
      rows(box, [['Montant', money(t.amount)], ['Frais', money(t.fee_amount)], ['App', t.app_id], ['Référence', t.reference || '—'], ['Date', fmtDateTime(t.created_at)]]
        .concat(t.metadata && t.metadata.provider ? [['Provider', t.metadata.provider + (t.metadata.network ? ' · ' + t.metadata.network : '')]] : []));
      const entriesHost = items(d.entries.map((e) => ({ href: e.account_type === 'USER' ? '#/users/' + e.wallet_id : null, title: e.label, sub: e.description || '', end: signed(e.direction, e.amount) })), 'Aucune écriture.');
      $('moveDetail').replaceChildren(detailPanel(TYPE[t.type] || t.type, [pill(t.status), box, el('p', { class: 'mono mt', text: t.id })]), flushPanel('Écritures (partie double)', entriesHost));
    });
  }

  // ---------------------------------------------------------------- wallet main
  let mainBalance = 0;
  async function enterMain() {
    crumbs('Trésorerie', 'Wallet main');
    await load('main', async () => {
      const d = await LP.api('GET', '/v1/admin-console/main');
      mainBalance = Number(d.wallet.available_balance);
      $('mainBalance').textContent = money(d.wallet.available_balance);
      $('mainHint').textContent = 'vos fonds propres';
      table($('mainMoves'), [{ label: 'Mouvement' }, { label: 'Montant', cls: 'num' }, { label: 'Solde après', cls: 'num' }], d.moves.map((m) => ({
        href: '#/moves/' + m.transaction_id,
        cells: [cell(m.description || TYPE[m.type] || m.type, fmtDateTime(m.created_at)), el('span', { class: m.direction === 'CREDIT' ? 'credit' : 'debit', text: (m.direction === 'CREDIT' ? '+' : '−') + money(m.amount) }), money(m.balance_after)],
      })), 'Aucun mouvement pour le moment.');
    });
  }
  const amountOf = (id) => { const v = digits($(id).value); return v && Number(v) > 0 ? v : null; };
  let sendDraft = null;
  $('sendForm').addEventListener('submit', (e) => {
    e.preventDefault(); say('sendMsg', '');
    const to = $('sendTo').value.trim().toLowerCase(); const amount = amountOf('sendAmount');
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(to)) return say('sendMsg', 'Adresse e-mail invalide.', 'err');
    if (!amount) return say('sendMsg', 'Montant invalide.', 'err');
    if (Number(amount) > mainBalance) return say('sendMsg', 'Solde du wallet main insuffisant (' + money(mainBalance) + ').', 'err');
    sendDraft = { to: to, amount: amount, note: $('sendNote').value.trim(), key: LP.uuid() };
    rows($('confirmRows'), [['À', to], ['Montant', money(amount)], ['Depuis', 'Wallet main'], ['Solde après', money(mainBalance - Number(amount)), true]].concat(sendDraft.note ? [['Motif', sendDraft.note]] : []));
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
    reserves: { parent: 'home', enter: withNav('reserves', enterReserves) },
    users: { parent: 'home', enter: withNav('users', enterUsers) },
    apps: { parent: 'home', enter: withNav('apps', enterApps) },
    moves: { parent: 'home', enter: withNav('moves', enterMoves) },
    main: { parent: 'home', enter: withNav('main', enterMain) },
    audit: { parent: 'home', enter: withNav('audit', enterAudit) },
    denied: { enter: () => {} },
  };
  const nav = createNav({
    root: 'home',
    resolve: (route) => {
      const i = route.indexOf('/');
      return i > 0 ? [route.slice(0, i), route.slice(i + 1)] : [route, null];
    },
    screens: screens,
  });

  function authAside() {
    const point = (text) => el('li', {}, [icon('check'), text]);
    return el('aside', { class: 'auth-aside' }, [
      el('span', { class: 'pill-brand' }, [el('span', { class: 'brand-mark' }, [icon('bolt')]), 'Administration']),
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
  if (LP.signedIn()) boot(); else signIn();
`;

  return shell({ title: 'Administration', nonce, env, body, script, css: CONSOLE_CSS + ADMIN_CSS, console: true });
};
