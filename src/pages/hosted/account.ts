import { shell, skeletonRows, topbar } from './shell.js';
import { iconSvg } from './icons.js';
import { FLOWS_SCRIPT, FlowFrame, flowScreens } from './flows.js';

/**
 * /account — the person's LightPay space, simple interface (the default for everyone).
 * Scaffold: fixed top bar, pinned key figure, only the list area scrolls; a bottom bar
 * (Accueil · Activité · + · Compte) on the root screens, hidden inside a flow.
 * A @username is required: chosen on first visit, changeable in Compte.
 * Advanced mode (console + developer space, /account/console) only after the LightPay admin
 * approved the person's request (asked from Compte); before that it appears nowhere.
 * Hash routes:
 *   #/home  #/activity → #/activity/<id>  #/account → #/username ·
 *   #/developer · #/delete · #/apps → #/apps/<id>
 *   #/deposit → (confirmation sheet) → #/deposit/done  #/send → (confirmation sheet) → #/send/done  #/withdraw → (confirmation sheet) → #/withdraw/done
 * ?env=sandbox for the test wallet (switchable in place) · ?return=<url> shows a way back to the app.
 */
export const accountPage = (nonce: string, env: string) => {
  const bar = (title: string) => topbar({ title, back: true, env });
  // Money screens (flows.ts): the account's top bar, the form scrolls, the actions stay at the bottom.
  const frame: FlowFrame = (o) => `<section class="screen" data-screen="${o.screen}" hidden>
  ${bar(o.title)}
  ${o.state ? o.content : `<div class="content">${o.content}</div>`}
  <div class="actions-bar">${o.actions}</div>
</section>`;
  const body = `
<section class="screen" data-screen="home" hidden>
  ${topbar({ brand: true, back: false, env, end: '<button class="icon-btn" type="button" id="homeBack" hidden aria-label="Retour à l’application">' + iconSvg('x') + '</button>' })}
  <div class="home-compact" id="homeCompact" aria-hidden="true">
    <div class="compact-row">
      <div class="compact-main"><div class="hero-label">Disponible</div><div class="compact-amount" id="compactAmount"></div></div>
      <div class="compact-actions">
        <button class="chip primary" type="button" data-go="deposit" tabindex="-1">${iconSvg('plus')}Dépôt</button>
        <button class="chip" type="button" data-go="withdraw" tabindex="-1">${iconSvg('withdraw')}Retrait</button>
      </div>
    </div>
    <a class="send-link" href="#/send" tabindex="-1">${iconSvg('send')}<span>Envoyer à un @pseudo</span>${iconSvg('chevron-right', 'chev')}</a>
  </div>
  <div class="content" id="homeScroll">
    <div class="hero home-hero" id="homeHero">
      <div class="amount-xl" id="homeAvailable"><span class="sk sk-amount"></span></div>
      <div class="hero-sub" id="homeLockedLine" hidden>${iconSvg('lock')}<span id="homeLocked"></span></div>
      <div class="home-actions" id="homeActions">
        <button class="chip primary" type="button" data-go="deposit">${iconSvg('plus')}Dépôt</button>
        <button class="chip" type="button" data-go="withdraw">${iconSvg('withdraw')}Retrait</button>
        <button class="chip" type="button" data-go="send">${iconSvg('send')}Envoyer</button>
      </div>
    </div>
    <div class="note warn" id="homeClosed" hidden>${iconSvg('alert')}<p>Ce compte LightPay est fermé : il ne peut plus recevoir ni envoyer d’argent.</p></div>
    <div class="section-head sticky"><h2>Activité</h2><a class="link" href="#/activity">Tout voir</a></div>
    <div id="homeActivity" aria-busy="true">${skeletonRows(6, 'div')}</div>
    <a class="home-more" id="homeMore" href="#/activity" hidden>Voir toute l’activité</a>
    <div class="msg" id="homeMsg" role="status" aria-live="polite"></div>
  </div>
</section>

${flowScreens(frame)}

<section class="screen" data-screen="activity" hidden>
  ${topbar({ title: 'Activité', back: false, env })}
  <div class="filters" role="group" aria-label="Filtrer l’activité">
    <button type="button" data-filter="all" aria-pressed="true">Tout</button>
    <button type="button" data-filter="in" aria-pressed="false">Entrées</button>
    <button type="button" data-filter="out" aria-pressed="false">Sorties</button>
    <button type="button" data-filter="wait" aria-pressed="false">En attente</button>
  </div>
  <div class="content" id="actScroll"><div id="actList" aria-busy="true">${skeletonRows(8, 'div')}</div><div class="msg" id="actMsg" role="status" aria-live="polite"></div></div>
</section>

<section class="screen" data-screen="activity-item" hidden>
  ${bar('Opération')}
  <div class="content">
    <div id="itemSk" aria-busy="true" aria-label="Chargement">
      <div class="detail-head"><span class="sk sk-circle"></span><span class="sk sk-s w-30 sk-center"></span><span class="sk sk-amount sk-center"></span><span class="sk sk-s w-30 sk-center"></span></div>
      <span class="sk sk-card"></span>
    </div>
    <div id="itemReal" hidden>
      <div class="detail-head">
        <span class="detail-icon" id="itemIcon" aria-hidden="true"></span>
        <p class="detail-kind" id="itemKind"></p>
        <div class="amount-xl" id="itemAmount"></div>
        <span class="status" id="itemStatus"></span>
      </div>
      <div class="note warn" id="itemReasonBox" hidden>${iconSvg('alert')}<p id="itemReason"></p></div>
      <div class="receipt card" id="itemRows"></div>
    </div>
    <div class="msg" id="itemMsg" role="status" aria-live="polite"></div>
  </div>
</section>

<section class="screen" data-screen="apps" hidden>
  ${bar('Apps connectées')}
  <div class="content">
    <p class="small muted">Les apps que vous avez autorisées à utiliser votre compte LightPay.</p>
    <ul class="list mt" id="appsList"></ul>
    <div class="msg" id="appsMsg" role="status" aria-live="polite"></div>
  </div>
</section>

<section class="screen" data-screen="app" hidden>
  ${bar('Accès de l’app')}
  <div class="content">
    <div class="center mt"><span class="avatar avatar-lg" id="appAvatar" aria-hidden="true"></span><h2 class="title mt" id="appName"></h2><p class="small muted" id="appSince"></p></div>
    <div class="section-head"><h2>Ce que l’app peut faire</h2></div>
    <ul class="list" id="appScopes"></ul>
    <div id="appTermsBox" hidden>
      <div class="section-head"><h2 id="appTermsHead">Conditions acceptées</h2></div>
      <ul class="terms" id="appTerms"></ul>
    </div>
    <div id="appLimitBox" hidden>
      <div class="field"><label for="appLimit">Montant maximum par débit (FCFA)</label><input id="appLimit" inputmode="numeric" autocomplete="off"></div>
      <button class="btn btn-secondary mt" type="button" id="appLimitSave">Enregistrer la limite</button>
    </div>
    <div class="msg" id="appMsg" role="status" aria-live="polite"></div>
    <button class="btn btn-danger mt-lg" type="button" id="appRevoke">Retirer l’accès</button>
  </div>
</section>

<section class="screen" data-screen="account" hidden>
  ${topbar({ title: 'Compte', back: false, env })}
  <div class="content">
    <div class="profile">
      <span class="avatar avatar-lg" id="accAvatar" aria-hidden="true"></span>
      <div class="profile-main"><div class="profile-name" id="accName"></div><div class="profile-handle" id="accHandle"></div></div>
    </div>
    <p class="group-title">Profil</p>
    <ul class="group">
      <li><a class="row" href="#/username"><span class="row-icon">${iconSvg('user')}</span><span class="row-main"><span class="row-title">Nom d’utilisateur</span><span class="row-sub" id="accUsername"></span></span>${iconSvg('chevron-right', 'chev')}</a></li>
      <li><div class="row"><span class="row-icon">${iconSvg('mail')}</span><span class="row-main"><span class="row-title">Compte Google</span><span class="row-sub" id="secEmail"></span></span></div></li>
    </ul>
    <p class="group-title">Autorisations</p>
    <ul class="group">
      <li><a class="row" href="#/apps"><span class="row-icon">${iconSvg('apps')}</span><span class="row-main"><span class="row-title">Apps connectées</span><span class="row-sub" id="accAppsSub">Accès et permissions</span></span>${iconSvg('chevron-right', 'chev')}</a></li>
      <li><a class="row" href="#/developer"><span class="row-icon">${iconSvg('code')}</span><span class="row-main"><span class="row-title">Mode avancé</span><span class="row-sub" id="accDevSub">Sur demande</span></span>${iconSvg('chevron-right', 'chev')}</a></li>
    </ul>
    <p class="group-title">Session</p>
    <ul class="group">
      <li><button class="row" type="button" id="envSwitch"><span class="row-icon">${iconSvg('swap')}</span><span class="row-main"><span class="row-title" id="envSwitchTitle"></span><span class="row-sub" id="envSwitchSub"></span></span></button></li>
      <li><button class="row" type="button" id="signOut"><span class="row-icon">${iconSvg('logout')}</span><span class="row-main"><span class="row-title">Se déconnecter</span></span></button></li>
    </ul>
    <ul class="group mt-lg">
      <li><a class="row danger" href="#/delete"><span class="row-icon">${iconSvg('trash')}</span><span class="row-main"><span class="row-title">Supprimer mon compte</span></span></a></li>
    </ul>
    <div class="msg" id="accMsg" role="status" aria-live="polite"></div>
  </div>
</section>

<section class="screen" data-screen="username" hidden>
  ${topbar({ title: 'Nom d’utilisateur', back: true, env, backId: 'unBack' })}
  <div class="content">
    <h2 class="title mt" id="unTitle">Choisissez votre nom d’utilisateur</h2>
    <p class="small muted mt">On vous envoie de l’argent avec ce nom, sans connaître votre e-mail.</p>
    <div class="field"><label for="unInput">Nom d’utilisateur</label><div class="input-prefix"><span>@</span><input id="unInput" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" placeholder="votre.nom"></div><p class="hint">3 à 20 caractères : lettres, chiffres, « . » ou « _ ».</p></div>
    <div class="msg" id="unMsg" role="status" aria-live="polite"></div>
  </div>
  <div class="actions-bar"><button class="btn" type="button" id="unGo">Enregistrer</button></div>
</section>

<section class="screen" data-screen="developer" hidden>
  ${bar('Mode avancé')}
  <div class="content">
    <div class="sk-block" id="devSk" aria-busy="true" hidden><span class="sk sk-t w-75"></span><span class="sk sk-t w-60"></span><span class="sk sk-field"></span><span class="sk sk-field"></span><span class="sk sk-card"></span></div>
    <div id="devForm" hidden>
      <p class="small muted mt">La console et l’espace développeur (clés API, webhooks, paiements de vos apps) s’ouvrent après validation de votre demande par LightPay.</p>
      <div class="note warn" id="devRefused" hidden>${iconSvg('alert')}<p id="devRefusedText"></p></div>
      <div class="field"><label for="devProject">Projet ou entreprise</label><input id="devProject" maxlength="80" autocomplete="organization"></div>
      <div class="field"><label for="devSite">Site web (facultatif)</label><input id="devSite" type="url" maxlength="200" autocomplete="url" placeholder="https://"></div>
      <div class="field"><label for="devUse">Ce que vous allez faire avec LightPay</label><textarea id="devUse" maxlength="600" rows="4"></textarea></div>
    </div>
    <div class="state" id="devPending" hidden><span class="state-icon wait">${iconSvg('clock')}</span><h2>Demande en cours d’examen</h2><p>Envoyée le <span id="devPendingDate"></span>. Le mode avancé apparaîtra ici dès qu’elle sera validée.</p></div>
    <div class="state" id="devApproved" hidden><span class="state-icon ok">${iconSvg('check')}</span><h2>Mode avancé activé</h2><p>Console, historique détaillé et espace développeur.</p></div>
    <div class="msg" id="devMsg" role="status" aria-live="polite"></div>
  </div>
  <div class="actions-bar"><button class="btn" type="button" id="devGo" hidden>Envoyer la demande</button><a class="btn" id="devOpen" href="/account/console#/home" hidden>Ouvrir la console</a></div>
</section>

<section class="screen" data-screen="delete" hidden>
  ${bar('Supprimer mon compte')}
  <div class="content">
    <p class="small muted mt">Possible si vos wallets réel et test sont à zéro et qu’aucun paiement n’est en attente. Les apps connectées perdent leur accès ; l’historique comptable est conservé.</p>
    <div class="field"><label for="delConfirm">Tapez SUPPRIMER pour confirmer</label><input id="delConfirm" autocomplete="off"></div>
    <div class="msg" id="delMsg" role="status" aria-live="polite"></div>
  </div>
  <div class="actions-bar"><button class="btn btn-danger" type="button" id="delGo" disabled>Supprimer définitivement</button></div>
</section>

<section class="screen" data-screen="bye" hidden>
  ${topbar({ brand: true, back: false, env })}
  <div class="state"><span class="state-icon ok">${iconSvg('check')}</span><h2>Compte supprimé</h2><p>Votre compte LightPay a été fermé. Merci de l’avoir utilisé.</p></div>
</section>

<nav class="tabbar" id="tabbar" aria-label="Navigation" hidden>
  <a href="#/home" data-tab="home">${iconSvg('home')}<span>Accueil</span></a>
  <a href="#/activity" data-tab="activity">${iconSvg('pulse')}<span>Activité</span></a>
  <a href="#/account" data-tab="account">${iconSvg('user')}<span>Compte</span></a>
</nav>`;

  const script = `
  const params = new URLSearchParams(location.search);
  const returnUrl = (function () { const r = params.get('return'); try { const u = new URL(r); return u.protocol === 'https:' || u.hostname === 'localhost' ? u.toString() : null; } catch (e) { return null; } })();
  const SCOPE_ICON = { 'balance:read': 'wallet', payee: 'receive', deposit: 'plus', charge: 'send' };
  let me = null;
  const cur = () => (me ? me.wallet.currency : 'XAF');
  const available = () => (me ? Number(me.wallet.available_balance) : 0);
  const fmtPhone = (d) => d.replace(/^(\\d{2})(\\d{3})(\\d{2})(\\d{2})$/, '$1 $2 $3 $4');

  // ---------------------------------------------------------------- guarded calls + re-auth
  async function guarded(action, msg) {
    try { return await action(); }
    catch (e) {
      // Sensitive action: the same Google account again, then the action runs once more.
      if (e.reauth) { if (await confirmIdentity()) return guarded(action, msg); return; }
      if (e.signIn) { signIn(); return; }
      say(msg, e.message, 'err');
    }
  }

  // ---------------------------------------------------------------- activity (journal of every operation)
  const STATUS = {
    PENDING: ['warn', 'En cours'], SUCCEEDED: ['ok', 'Réussi'], FAILED: ['err', 'Refusé'], LOCKED: ['warn', 'Bloqué'],
    REFUNDED: ['', 'Remboursé'], EXPIRED: ['', 'Expiré'], CANCELLED: ['', 'Annulé'],
  };
  const KIND_ICON = { DEPOSIT: 'plus', TRANSFER: 'send', WITHDRAWAL: 'withdraw', PAYMENT: 'send', CHARGE: 'send', SALE: 'receive', REFUND: 'receive', COMMISSION: 'send' };
  function actTitle(a) {
    const who = a.counterparty || '';
    switch (a.kind) {
      case 'DEPOSIT': return who ? 'Dépôt · ' + who : 'Dépôt';
      case 'TRANSFER': return a.direction === 'IN' ? 'Reçu de ' + who : 'Envoi à ' + (who || '—');
      case 'WITHDRAWAL': return who ? 'Retrait · ' + who : 'Retrait';
      case 'PAYMENT': return 'Paiement · ' + who;
      case 'CHARGE': return 'Débit par ' + who;
      case 'SALE': return 'Vente · ' + who;
      case 'COMMISSION': return 'Commission automatique · ' + who;
      case 'REFUND': return a.direction === 'IN' ? 'Remboursement · ' + who : 'Remboursement envoyé';
      default: return a.kind;
    }
  }
  const settledOk = (a) => a.status === 'SUCCEEDED' || a.status === 'LOCKED' || a.status === 'PENDING';
  const END_LABEL = { FAILED: 'Refusé', PENDING: 'En cours', LOCKED: 'Bloqué', REFUNDED: 'Remboursé', EXPIRED: 'Expiré', CANCELLED: 'Annulé' };
  function actRow(a, short) {
    const incoming = a.direction === 'IN';
    return txRow({
      icon: a.status === 'FAILED' ? 'x' : a.status === 'LOCKED' ? 'lock' : (KIND_ICON[a.kind] === 'send' && incoming ? 'receive' : KIND_ICON[a.kind] || 'clock'),
      amount: (incoming ? '+' : '−') + LP.money(walletAmount(a), a.currency),
      desc: actTitle(a),
      end: END_LABEL[a.status] || (short ? shortDay(a.created_at) : timeLabel(a.created_at)),
      cls: !settledOk(a) || (a.status === 'REFUNDED' && incoming) ? 'void' : a.status === 'LOCKED' ? 'held' : a.status === 'PENDING' ? 'wait' : incoming ? 'in' : '',
      href: '#/activity/' + encodeURIComponent(a.id),
    });
  }

  // ---------------------------------------------------------------- home
  // Minimums set by the admin (from /v1/me).
  const lim = (k) => Number(me && me.limits ? me.limits[k] : 0);
  async function loadMe() {
    me = await LP.api('GET', '/v1/me');
    const name = me.user.name || (me.user.email || '').split('@')[0];
    amountParts($('homeAvailable'), me.wallet.available_balance, cur());
    const locked = Number(me.wallet.locked_balance);
    $('homeLockedLine').hidden = !locked;
    $('homeLocked').textContent = LP.money(locked, cur()) + ' bloqués jusqu’à la livraison';
    $('depMin').textContent = 'FCFA · minimum ' + lim('deposit_min').toLocaleString('fr-FR');
    const closed = me.wallet.status !== 'ACTIVE';
    $('homeClosed').hidden = !closed;
    $('homeActions').hidden = closed;
    amountParts($('compactAmount'), me.wallet.available_balance, cur());
    $('accAvatar').textContent = initials(name);
    $('accName').textContent = name;
    $('accHandle').textContent = me.username ? '@' + me.username : '';
    $('accUsername').textContent = me.username ? '@' + me.username : 'À choisir';
    $('secEmail').textContent = me.user.email || '—';
    $('accDevSub').textContent = DEV_SUB[me.developer] || DEV_SUB.NONE;
  }
  const DEV_SUB = { NONE: 'Sur demande', PENDING: 'Demande en cours d’examen', APPROVED: 'Activé', REJECTED: 'Demande refusée · vous pouvez la refaire' };
  async function enterHome() {
    await guarded(async () => {
      await loadMe();
      const act = await LP.api('GET', '/v1/me/activity?limit=30');
      actCache = act.activity;
      $('homeActivity').replaceChildren.apply($('homeActivity'), act.activity.length ? act.activity.slice(0, 10).map((a) => actRow(a, true)) : [el('p', { class: 'empty', text: 'Aucune opération pour l’instant.' })]);
      $('homeMore').hidden = act.activity.length <= 10;
      $('homeActivity').removeAttribute('aria-busy');
    }, 'homeMsg');
  }
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => nav.go(b.dataset.go)));
  document.querySelectorAll('[data-home]').forEach((b) => b.addEventListener('click', () => nav.home()));
  if (returnUrl) { $('homeBack').hidden = false; $('homeBack').addEventListener('click', () => location.assign(returnUrl)); }

  // ---------------------------------------------------------------- bottom bar + "+" sheet
  const TAB_OF = { home: 'home', activity: 'activity', account: 'account' };
  function syncTabs(c) {
    const tab = c ? TAB_OF[c.name] : null;
    $('tabbar').hidden = !tab;
    document.querySelectorAll('[data-tab]').forEach((a) => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  }
  // The balance scrolls away with the list; once it is gone it shows small in the top bar.
  // Scrolling: once the big balance and its buttons pass under the top, a compact bar slides in
  // (balance left, Dépôt / Retrait right, "Envoyer à un @pseudo" under it); scrolling back up,
  // it slides away and the big balance is there again. The Activité heading sticks below it.
  const homeScreen = document.querySelector('[data-screen="home"]');
  function compact(on) {
    if (homeScreen.classList.contains('compact-on') === on) return;
    homeScreen.style.setProperty('--compact-h', $('homeCompact').offsetHeight + 'px');
    homeScreen.style.setProperty('--compact-top', $('homeScroll').offsetTop + 'px');
    homeScreen.classList.toggle('compact-on', on);
    $('homeCompact').setAttribute('aria-hidden', String(!on));
    $('homeCompact').querySelectorAll('button, a').forEach((b) => { b.tabIndex = on ? 0 : -1; });
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => entries.forEach((e) => compact(!e.isIntersecting && e.boundingClientRect.top < e.rootBounds.top + 1)), { root: $('homeScroll'), threshold: 0 }).observe($('homeActions'));
  }

${FLOWS_SCRIPT}
  // ---------------------------------------------------------------- activity
  let actCache = null, actFilter = 'all';
  const FILTERS = {
    all: () => true,
    in: (a) => a.direction === 'IN',
    out: (a) => a.direction !== 'IN',
    wait: (a) => a.status === 'PENDING' || a.status === 'LOCKED',
  };
  function renderActivity() {
    const list = (actCache || []).filter(FILTERS[actFilter]);
    $('actList').removeAttribute('aria-busy');
    if (!list.length) { $('actList').replaceChildren(el('p', { class: 'empty', text: actCache && actCache.length ? 'Rien dans ce filtre.' : 'Aucune opération pour l’instant.' })); return; }
    const out = []; let day = '';
    list.forEach((a) => {
      const d = dayLabel(a.created_at);
      if (d !== day) { day = d; out.push(el('h2', { class: 'day-label', text: d.charAt(0).toUpperCase() + d.slice(1) })); }
      out.push(actRow(a, false));
    });
    $('actList').replaceChildren.apply($('actList'), out);
  }
  document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    actFilter = b.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    $('actScroll').scrollTop = 0;
    renderActivity();
  }));
  async function enterActivity() {
    if (actCache) renderActivity(); else { $('actList').setAttribute('aria-busy', 'true'); skeleton($('actList'), 8, 'div'); }
    await guarded(async () => {
      actCache = (await LP.api('GET', '/v1/me/activity?limit=100')).activity;
      renderActivity();
    }, 'actMsg');
  }
  // The detail screen is reused from one operation to the next: another operation shows the
  // shimmer first (never the previous amount), and a late answer for an older one is dropped.
  let itemShown = null, itemSeq = 0;
  async function enterActivityItem(id) {
    say('itemMsg', '');
    const seq = ++itemSeq;
    if (id !== itemShown) { $('itemReal').hidden = true; $('itemSk').hidden = false; }
    await guarded(async () => {
      const a = (await LP.api('GET', '/v1/me/activity/' + encodeURIComponent(id))).activity;
      if (seq !== itemSeq) return;
      const st = STATUS[a.status] || ['', a.status];
      const incoming = a.direction === 'IN';
      const failed = !settledOk(a) || (a.status === 'REFUNDED' && incoming);
      $('itemIcon').className = 'detail-icon' + (a.status === 'FAILED' ? ' err' : incoming && !failed ? ' in' : '');
      $('itemIcon').replaceChildren(icon(a.status === 'FAILED' ? 'x' : a.status === 'LOCKED' ? 'lock' : (KIND_ICON[a.kind] === 'send' && incoming ? 'receive' : KIND_ICON[a.kind] || 'clock')));
      $('itemKind').textContent = actTitle(a);
      $('itemAmount').className = 'amount-xl' + (failed ? ' void' : incoming ? ' in' : '');
      $('itemAmount').textContent = (incoming ? '+' : '−') + LP.money(walletAmount(a), a.currency);
      $('itemStatus').className = 'status ' + st[0];
      $('itemStatus').textContent = st[1];
      $('itemReasonBox').hidden = !a.reason;
      $('itemReason').textContent = a.reason || '';
      const rows = amountRows(a);
      if (a.kind === 'COMMISSION') {
        if (a.metadata && a.metadata.sale_amount) rows.push(['Sur la vente de', LP.money(a.metadata.sale_amount, a.currency)]);
        rows.push(['Retenue', 'Automatique, à la validation de la vente']);
        rows.push(['Autorisée', 'En connectant votre wallet à ' + (a.counterparty || 'l’app')]);
      }
      if (a.counterparty) rows.push([incoming ? 'De' : a.kind === 'DEPOSIT' || a.kind === 'WITHDRAWAL' ? 'Via' : 'À', a.counterparty]);
      if (a.metadata && a.metadata.via) rows.push(['Via', a.metadata.via]);
      if (a.metadata && a.metadata.reference) rows.push(['Référence', a.metadata.reference]);
      if (a.metadata && a.metadata.note) rows.push(['Message', a.metadata.note]);
      rows.push(['Date', new Date(a.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })]);
      if (a.updated_at && a.updated_at !== a.created_at && a.status !== 'SUCCEEDED') rows.push(['Mise à jour', new Date(a.updated_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })]);
      rows.push(['N° d’opération', a.id, true]);
      feeRows($('itemRows'), rows);
      itemShown = id;
      $('itemSk').hidden = true; $('itemReal').hidden = false;
    }, 'itemMsg');
    if (seq === itemSeq && itemShown !== id) $('itemSk').hidden = true;
  }

  // ---------------------------------------------------------------- apps
  let connections = [], scopeLabels = {};
  async function loadConnections() {
    const r = await LP.api('GET', '/v1/me/connections');
    connections = r.connections.filter((c) => c.status === 'ACTIVE');
    scopeLabels = r.scope_labels || {};
  }
  async function enterApps() {
    skeleton($('appsList'), 2);
    await guarded(async () => {
      await loadConnections();
      $('appsList').replaceChildren.apply($('appsList'), connections.length ? connections.map((c) => listRow({
        icon: el('span', { class: 'avatar', text: initials(c.app_name) }),
        title: c.app_name,
        sub: c.scopes.length + (c.scopes.length > 1 ? ' permissions' : ' permission') + ' · depuis le ' + new Date(c.created_at).toLocaleDateString('fr-FR'),
        href: '#/apps/' + encodeURIComponent(c.id),
        chev: true,
      })) : [el('li', { class: 'empty', text: 'Aucune app n’a accès à votre compte.' })]);
    }, 'appsMsg');
  }
  let appRevokeArmed = false;
  async function enterApp(id) {
    appRevokeArmed = false; $('appRevoke').textContent = 'Retirer l’accès'; say('appMsg', '');
    await guarded(async () => {
      if (!connections.length) await loadConnections();
      const c = connections.find((x) => x.id === id);
      if (!c) return nav.go('apps', true);
      $('appAvatar').textContent = initials(c.app_name);
      $('appName').textContent = c.app_name;
      $('appSince').textContent = 'Autorisée le ' + new Date(c.created_at).toLocaleDateString('fr-FR');
      $('appScopes').replaceChildren.apply($('appScopes'), c.scopes.map((s) => listRow({
        icon: SCOPE_ICON[s] || 'check',
        title: scopeLabels[s] || s,
        end: c.scopes.length > 1 ? el('button', { class: 'link', type: 'button', text: 'Retirer', 'aria-label': 'Retirer : ' + (scopeLabels[s] || s), on: { click: () => guarded(async () => {
          await LP.api('PATCH', '/v1/me/connections/' + encodeURIComponent(c.id), { scopes: c.scopes.filter((x) => x !== s) });
          await loadConnections(); enterApp(id); say('appMsg', 'Permission retirée.', 'ok');
        }, 'appMsg') } }) : null,
      })));
      $('appLimitBox').hidden = !c.scopes.includes('charge');
      $('appLimit').value = c.charge_limit || '';
      const terms = (c.consent && c.consent.terms) || [];
      $('appTermsBox').hidden = !terms.length;
      if (terms.length) {
        $('appTermsHead').textContent = 'Conditions acceptées le ' + new Date(c.consent.accepted_at).toLocaleString('fr-FR');
        $('appTerms').replaceChildren.apply($('appTerms'), terms.map((t) => el('li', { text: t })));
      }
    }, 'appMsg');
  }
  $('appLimitSave').addEventListener('click', () => guarded(async () => {
    const c = nav.current() && connections.find((x) => x.id === nav.current().param);
    if (!c) return;
    const limit = digits($('appLimit').value);
    if (!limit || Number(limit) <= 0) return say('appMsg', 'Entrez un montant supérieur à 0.', 'err');
    await LP.api('PATCH', '/v1/me/connections/' + encodeURIComponent(c.id), { charge_limit: limit });
    await loadConnections();
    say('appMsg', 'Limite mise à jour : ' + LP.money(limit, cur()) + ' par débit.', 'ok');
  }, 'appMsg'));
  $('appRevoke').addEventListener('click', () => guarded(async () => {
    const c = nav.current() && connections.find((x) => x.id === nav.current().param);
    if (!c) return;
    if (!appRevokeArmed) { appRevokeArmed = true; $('appRevoke').textContent = 'Confirmer : retirer l’accès de ' + c.app_name; return; }
    await LP.api('DELETE', '/v1/me/connections/' + encodeURIComponent(c.id));
    await loadConnections();
    nav.go('apps', true);
    say('appsMsg', c.app_name + ' n’a plus accès à votre compte.', 'ok');
  }, 'appMsg'));

  // ---------------------------------------------------------------- compte
  async function enterAccount() {
    say('accMsg', '');
    $('envSwitchTitle').textContent = LP.ENV === 'sandbox' ? 'Passer au compte réel' : 'Passer au compte de test';
    $('envSwitchSub').textContent = LP.ENV === 'sandbox' ? 'Vous êtes dans l’environnement de test' : 'Pour essayer sans argent réel';
    if (!connections.length) $('accAppsSub').replaceChildren(el('span', { class: 'sk sk-s w-45 inline' }));
    try {
      await loadConnections();
      $('accAppsSub').textContent = connections.length ? connections.length + (connections.length > 1 ? ' apps autorisées' : ' app autorisée') : 'Aucune app autorisée';
    } catch (e) { /* the count is optional */ }
  }
  function enterUsername() {
    const first = !me || !me.username;
    $('unBack').hidden = first;
    $('unTitle').textContent = first ? 'Choisissez votre nom d’utilisateur' : 'Changer de nom d’utilisateur';
    $('unInput').value = me && me.username ? me.username : '';
    say('unMsg', '');
  }
  $('unGo').addEventListener('click', () => guarded(async () => {
    const first = !me || !me.username;
    $('unGo').disabled = true;
    try {
      const r = await LP.api('PUT', '/v1/me/username', { username: $('unInput').value });
      me.username = r.username;
      await loadMe().catch(() => {});
      if (first) nav.go('home', true); else { nav.go('account', true); say('accMsg', 'Nom d’utilisateur : @' + r.username, 'ok'); }
    } finally { $('unGo').disabled = false; }
  }, 'unMsg'));
  async function enterDeveloper() {
    say('devMsg', '');
    ['devForm', 'devPending', 'devApproved', 'devGo', 'devOpen'].forEach((id) => { $(id).hidden = true; });
    $('devSk').hidden = false;
    await guarded(async () => {
      const a = (await LP.api('GET', '/v1/me/developer-access')).access;
      $('devSk').hidden = true;
      if (a.status === 'APPROVED') { $('devApproved').hidden = false; $('devOpen').hidden = false; return; }
      if (a.status === 'PENDING') { $('devPending').hidden = false; $('devPendingDate').textContent = new Date(a.requested_at).toLocaleDateString('fr-FR'); return; }
      $('devForm').hidden = false; $('devGo').hidden = false;
      $('devRefused').hidden = a.status !== 'REJECTED';
      $('devRefusedText').textContent = a.note ? 'Demande précédente refusée : ' + a.note : '';
    }, 'devMsg');
  }
  $('devGo').addEventListener('click', () => guarded(async () => {
    $('devGo').disabled = true;
    try {
      await LP.api('POST', '/v1/me/developer-access', { project: $('devProject').value, website: $('devSite').value, use_case: $('devUse').value });
      await loadMe().catch(() => {});
      await enterDeveloper();
    } finally { $('devGo').disabled = false; }
  }, 'devMsg'));
  $('devOpen').addEventListener('click', () => { try { localStorage.setItem('lightpay.mode', 'console'); } catch (e) {} });

  // Test <-> real, in place: the same screens, the other ledger, shimmer while it loads.
  $('envSwitch').addEventListener('click', async () => {
    LP.setEnv(LP.ENV === 'sandbox' ? 'production' : 'sandbox');
    $('homeAvailable').replaceChildren(el('span', { class: 'sk sk-amount' }));
    $('homeActivity').replaceChildren(); skeleton($('homeActivity'), 6, 'div');
    $('actList').replaceChildren(); actCache = null; itemShown = null;
    if (liveStop) liveStop();
    liveStop = LP.live(onLive);
    await enterAccount();
    await loadMe().catch(() => {});
    say('accMsg', LP.ENV === 'sandbox' ? 'Compte de test : aucun argent réel.' : 'Compte réel.', 'ok');
  });
  $('signOut').addEventListener('click', () => { LP.signOut(); me = null; signIn(); });
  $('delConfirm').addEventListener('input', () => { $('delGo').disabled = $('delConfirm').value.trim() !== 'SUPPRIMER'; });
  $('delGo').addEventListener('click', () => guarded(async () => {
    $('delGo').disabled = true;
    try {
      await LP.api('DELETE', '/v1/me');
      await LP.deleteIdentity();
      $('tabbar').hidden = true;
      showOnly(document.querySelector('[data-screen="bye"]'));
    } finally { $('delGo').disabled = $('delConfirm').value.trim() !== 'SUPPRIMER'; }
  }, 'delMsg'));

  // ---------------------------------------------------------------- navigation
  const nav = createNav({
    root: 'home',
    resolve: (route) => route.indexOf('apps/') === 0 ? ['app', route.slice(5)] : route.indexOf('activity/') === 0 ? ['activity-item', route.slice(9)] : [route.replace('/', '-'), null],
    onRootBack: () => { if (returnUrl) location.assign(returnUrl); },
    onEnter: (c) => {
      syncTabs(c);
      // No wallet without a @username: chosen first.
      if (me && !me.username && c.name !== 'username') setTimeout(() => nav.go('username', true), 0);
    },
    screens: {
      home: { enter: enterHome },
      deposit: { parent: 'home', enter: () => { say('depMsg', ''); renderDepFees(); focusAmount('depAmount'); loadMe().then(renderDepFees).catch(() => {}); } },
      'deposit-done': { parent: 'home', enter: enterDepositDone },
      send: { parent: 'home', enter: enterSend },
      'send-done': { parent: 'home', enter: enterSendDone },
      withdraw: { parent: 'home', enter: enterWithdraw },
      'withdraw-done': { parent: 'home', enter: enterWithdrawDone },
      activity: { enter: enterActivity },
      'activity-item': { parent: 'activity', enter: enterActivityItem },
      apps: { parent: 'account', enter: enterApps },
      app: { parent: 'apps', enter: enterApp },
      account: { enter: enterAccount },
      username: { parent: 'account', enter: enterUsername },
      developer: { parent: 'account', enter: enterDeveloper },
      delete: { parent: 'account', enter: () => { say('delMsg', ''); $('delConfirm').value = ''; $('delGo').disabled = true; } },
      security: { enter: () => nav.go('account', true) },
    },
  });

  // Signed out: the sign-in screen (with a way back to the calling app when there is one).
  function signIn() { mountAuth(boot, returnUrl ? { onBack: () => location.assign(returnUrl) } : {}); }
  // Live: when the wallet moves (payment received, withdrawal settled…), what is on screen is re-read.
  let liveStop = null;
  async function onLive() {
    await loadMe().catch(() => {});
    const c = nav.current();
    if (!c) return;
    if (c.name === 'home') return enterHome();
    if (c.name === 'activity') return enterActivity();
    if (c.name === 'activity-item') return enterActivityItem(c.param);
    if (c.name === 'withdraw-done' && wdResult) {
      const r = await LP.api('GET', '/v1/me/withdrawals').catch(() => null);
      const w = r && (r.withdrawals || []).find((x) => x.id === wdResult.id);
      if (w) { wdResult = w; enterWithdrawDone(); }
    }
  }
  async function boot() {
    try {
      await loadMe();
      // The console only for people the admin approved; the choice is remembered per device.
      let wantsConsole = false;
      try { wantsConsole = localStorage.getItem('lightpay.mode') === 'console'; } catch (e) {}
      if (wantsConsole && me.developer === 'APPROVED' && me.username) { location.replace('/account/console' + location.search + location.hash); return; }
      if (wantsConsole && me.developer !== 'APPROVED') { try { localStorage.removeItem('lightpay.mode'); } catch (e) {} }
      if (!me.username) history.replaceState(history.state, '', location.pathname + location.search + '#/username');
      nav.start();
      if (liveStop) liveStop();
      liveStop = LP.live(onLive);
    } catch (e) { if (e.signIn) signIn(); else { nav.start(); say('homeMsg', e.message, 'err'); } }
  }
  if (LP.isRedirecting()) signIn(); else if (LP.signedIn()) boot(); else signIn();
`;

  return shell({ title: 'Mon compte', nonce, env, body, script });
};
