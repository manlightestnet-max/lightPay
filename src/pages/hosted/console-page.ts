import { shell, skeletonRows, themeToggle } from './shell.js';
import { iconSvg } from './icons.js';
import { CONSOLE_CSS } from './console.js';
import { FLOWS_SCRIPT, FlowFrame, flowScreens } from './flows.js';

/**
 * /account/console — the LightPay console (advanced mode): only for people whose request the
 * LightPay admin approved; anyone else is sent back to /account. The person's money and the
 * apps they build (developer space). Scaffold: fixed sidebar; every screen has a pinned head
 * (back link, title, actions, toolbar) and one scrolling area; a list row opens its item as its
 * own screen; a bottom bar on phones. Test <-> real
 * switches in place (no reload). Hash routes:
 *   #/home · #/activity → #/activity/<id> · #/deposit[/done] · #/send[/done] · #/withdraw[/done] (flows.ts)
 *   #/apps → #/apps/<connection> (apps allowed to use the account) · #/security
 *   #/dev · #/dev/new · #/dev/<app>[/keys|/webhooks|/payments|/settings] (apps the account owns)
 * ?env=sandbox for test money · ?return=<url> shows a way back to the calling app.
 */

let tipSeq = 0;
/** ⓘ with a short explanation (hover or keyboard focus). */
const tip = (text: string) => {
  const id = `tip${++tipSeq}`;
  return `<span class="tip"><button type="button" aria-label="Aide" aria-describedby="${id}">${iconSvg('info')}</button><span class="tip-text" role="tooltip" id="${id}">${text}</span></span>`;
};

const stat = (o: { id: string; label: string; help?: string; hint?: string; hintId?: string; accent?: boolean }) =>
  `<div class="stat"><div class="stat-label">${o.label}${o.help ? tip(o.help) : ''}</div><div class="stat-value${o.accent ? ' accent' : ''}" id="${o.id}"><span class="sk sk-stat"></span></div>${
    o.hint !== undefined || o.hintId ? `<div class="stat-hint"${o.hintId ? ` id="${o.hintId}"` : ''}>${o.hint ?? ''}</div>` : ''
  }</div>`;

const navItem = (route: string, key: string, icon: string, label: string, extra = '') =>
  `<a class="nav-item" href="#/${route}" data-nav="${key}">${iconSvg(icon)}<span>${label}</span>${extra}</a>`;

const envBadge = '<span class="badge" data-env-badge hidden>Test</span>';

/**
 * Every screen is a scaffold: a pinned head (back link on an item, title, actions, toolbar with a
 * list's filters or an app's sections) that never scrolls, and one scrolling area under it. A list
 * row opens its item as its own screen with a back link (never a panel beside the list).
 */
const page = (screen: string, title: string, inner: string, o: { actions?: string; toolbar?: string; back?: { href: string; label: string }; narrow?: boolean; titleId?: string } = {}) => `
<section class="screen scaffold" data-screen="${screen}" hidden>
  <header class="page-top"><div class="page-top-in${o.toolbar ? ' has-toolbar' : ''}">
    ${o.back ? `<a class="page-back" href="${o.back.href}" data-back>${iconSvg('arrow-left')}${o.back.label}</a>` : ''}
    <div class="page-head"><h1 class="page-title" id="${o.titleId ?? screen + 'Title'}">${title}</h1>${envBadge}${o.actions ? `<div class="page-actions">${o.actions}</div>` : ''}</div>
    ${o.toolbar ? `<div class="page-toolbar">${o.toolbar}</div>` : ''}
  </div></header>
  <div class="page-scroll"><div class="page${o.narrow ? ' narrow' : ''}">${inner}</div></div>
</section>`;

/** The shared money screens (flows.ts) in the console: a narrow scaffold, the form in one panel. */
const flowFrame: FlowFrame = (f) =>
  page(f.screen, f.title, `<section class="panel flow-panel"><div class="panel-body">${f.content}</div><div class="actions-bar">${f.actions}</div></section>`, {
    back: { href: '#/home', label: 'Vue d’ensemble' },
    narrow: true,
  });

export const consolePage = (nonce: string, env: string) => {
  const body = `
<div class="console-shell" hidden>
<aside class="side" id="side" aria-label="Menu">
  <div class="side-head"><span class="brand"><span class="brand-mark" aria-hidden="true"></span><span>LightPay<small>Compte et développeurs</small></span></span></div>
  <div class="env-switch" role="group" aria-label="Environnement"><button type="button" id="envReal">Réel</button><button type="button" id="envTest" class="test">Test</button></div>
  <nav class="side-nav" aria-label="Navigation">
    <div class="nav-label">Mon argent</div>
    ${navItem('home', 'home', 'home', 'Vue d’ensemble')}
    ${navItem('activity', 'activity', 'list', 'Activité')}
    ${navItem('deposit', 'deposit', 'plus', 'Dépôt')}
    ${navItem('send', 'send', 'send', 'Envoyer')}
    ${navItem('withdraw', 'withdraw', 'withdraw', 'Retirer')}
    <div class="nav-label">Autorisations</div>
    ${navItem('apps', 'apps', 'apps', 'Apps connectées', '<span class="nav-count" id="navConnCount" hidden></span>')}
    <div class="nav-label">Développeurs</div>
    ${navItem('dev', 'dev', 'code', 'Mes apps')}
    <div id="navDevApps"></div>
    <div class="nav-label">Compte</div>
    ${navItem('security', 'security', 'shield', 'Sécurité et compte')}
  </nav>
  <div class="side-foot"><div class="me"><span class="avatar" id="meAvatar" aria-hidden="true"></span><span class="me-main"><span class="me-name" id="meName"></span><span class="me-mail" id="meMail"></span></span><button class="icon-btn" type="button" id="signOutSide" aria-label="Se déconnecter" title="Se déconnecter">${iconSvg('logout')}</button></div></div>
</aside>
<div class="scrim" id="scrim"></div>
<div class="main">
  <header class="main-top">
    <button class="icon-btn menu-btn" type="button" id="menuBtn" aria-label="Menu" aria-controls="side" aria-expanded="false">${iconSvg('menu')}</button>
    <nav class="crumbs" id="crumbs" aria-label="Fil d’Ariane"></nav>
    ${envBadge}
    <button class="icon-btn" type="button" id="backToApp" hidden aria-label="Retour à l’application" title="Retour à l’application">${iconSvg('x')}</button>
    ${themeToggle()}
  </header>
  <div class="console-body">

${page('home', 'Vue d’ensemble', `
  <div class="note warn" id="homeClosed" hidden>${iconSvg('alert')}<p>Ce compte LightPay est fermé : il ne peut plus recevoir ni envoyer d’argent.</p></div>
  <div class="well">
    ${stat({ id: 'homeAvailable', label: 'Disponible', hint: 'Envoyable et retirable' })}
    ${stat({ id: 'homeLocked', label: 'Bloqué', hint: 'Jusqu’à la livraison' })}
    ${stat({ id: 'homeIn', label: 'Entrées · 30 j', hintId: 'homeInHint' })}
    ${stat({ id: 'homeOut', label: 'Sorties · 30 j', hintId: 'homeOutHint' })}
  </div>
  <div class="section-row"><h2 class="section-title">Activité récente</h2><a class="link" href="#/activity">Tout voir</a></div>
  <div class="list-card" id="homeActivity"><div class="sk-pad">${skeletonRows(6, 'div')}</div></div>
  <div class="msg" id="homeMsg" role="status" aria-live="polite"></div>
`, { actions: `<span class="page-actions-in" id="homeActions">
      <a class="btn btn-sm" href="#/deposit">${iconSvg('plus')}Dépôt</a>
      <a class="btn btn-sm btn-secondary" href="#/send">${iconSvg('send')}Envoyer</a>
      <a class="btn btn-sm btn-secondary" href="#/withdraw">${iconSvg('withdraw')}Retirer</a>
    </span>` })}

${page('activity', 'Activité', `
  <div class="list-card" id="actList"><div class="sk-pad">${skeletonRows(8, 'div')}</div></div>
  <div class="msg" id="actMsg" role="status" aria-live="polite"></div>
`, { toolbar: `<div class="seg-sm" role="group" aria-label="Filtrer" id="actFilter"><button type="button" data-f="all" aria-pressed="true">Tout</button><button type="button" data-f="in" aria-pressed="false">Entrées</button><button type="button" data-f="out" aria-pressed="false">Sorties</button><button type="button" data-f="failed" aria-pressed="false">Refusées</button></div><span class="count-pill" id="actCount"></span>` })}

${page('activity-item', 'Opération', `
  <div class="stack" id="actDetailBody"></div>
  <div class="msg" id="actItemMsg" role="status" aria-live="polite"></div>
`, { back: { href: '#/activity', label: 'Activité' }, narrow: true })}

${flowScreens(flowFrame)}

${page('apps', 'Apps connectées', `
  <div class="list-card" id="appsList"><div class="sk-pad">${skeletonRows(2, 'div')}</div></div>
  <div class="msg" id="appsMsg" role="status" aria-live="polite"></div>
`, { actions: '<span class="count-pill" id="appsCount"></span>' })}

${page('app', 'Accès de l’app', `
  <section class="panel"><div class="panel-body">
        <div class="cell mt"><span class="avatar" id="appAvatar" aria-hidden="true"></span><span class="cell-main"><span class="cell-title" id="appName"></span><span class="cell-sub" id="appSince"></span></span></div>
        <div class="section-head"><h2>Ce que l’app peut faire</h2></div>
        <ul class="list" id="appScopes"></ul>
        <div id="appLimitBox" hidden>
          <div class="field"><label for="appLimit">Montant maximum par débit (FCFA)</label><input id="appLimit" inputmode="numeric" autocomplete="off"></div>
          <button class="btn btn-secondary mt" type="button" id="appLimitSave">Enregistrer la limite</button>
        </div>
        <div class="msg" id="appMsg" role="status" aria-live="polite"></div>
  </div><div class="panel-actions"><button class="btn btn-danger" type="button" id="appRevoke">Retirer l’accès</button></div></section>
`, { back: { href: '#/apps', label: 'Apps connectées' }, narrow: true })}

${page('security', 'Sécurité et compte', `
  <div class="stack">
    <section class="panel"><div class="panel-head"><h2 class="panel-title">Nom d’utilisateur</h2></div><div class="panel-body">
      <p class="small muted">On vous envoie de l’argent avec ce nom, sans connaître votre e-mail.</p>
      <div class="field"><label for="unInput">Nom d’utilisateur</label><div class="input-prefix"><span>@</span><input id="unInput" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20"></div></div>
      <button class="btn btn-secondary mt" type="button" id="unGo">Enregistrer</button>
      <div class="msg" id="unMsg" role="status" aria-live="polite"></div>
    </div></section>
    <section class="panel"><div class="panel-head"><h2 class="panel-title">Connexion</h2></div><div class="panel-body">
      <p class="small muted">Compte Google : <b id="secEmail"></b>. Le même pour LightPay et les apps de notre écosystème.</p>
      <div class="msg" id="secMsg" role="status" aria-live="polite"></div>
    </div></section>
    <section class="panel"><div class="panel-head"><h2 class="panel-title">Environnement et session</h2></div><div class="panel-body"><ul class="list">
      <li><button class="row" type="button" id="simpleMode"><span class="row-icon">${iconSvg('phone')}</span><span class="row-main"><span class="row-title">Revenir à l’interface simple</span><span class="row-sub">Solde, envois et retraits, sans l’espace développeurs</span></span>${iconSvg('chevron-right', 'chev')}</button></li>
      <li><button class="row" type="button" id="envSwitch"><span class="row-icon">${iconSvg('swap')}</span><span class="row-main"><span class="row-title" id="envSwitchTitle"></span><span class="row-sub" id="envSwitchSub"></span></span></button></li>
      <li><button class="row" type="button" id="signOut"><span class="row-icon">${iconSvg('logout')}</span><span class="row-main"><span class="row-title">Se déconnecter</span><span class="row-sub">Sur cet appareil</span></span></button></li>
    </ul></div></section>
    <section class="panel danger-zone">
      <h2 class="small">Supprimer mon compte</h2>
      <p class="small muted mt">Possible si vos wallets réel et test sont à zéro et qu’aucun paiement n’est en attente. Les apps connectées perdent leur accès ; l’historique comptable est conservé.</p>
      <div class="field"><label for="delConfirm">Tapez SUPPRIMER pour confirmer</label><input id="delConfirm" autocomplete="off"></div>
      <button class="btn btn-danger mt" type="button" id="delGo" disabled>Supprimer définitivement</button>
      <div class="msg" id="delMsg" role="status" aria-live="polite"></div>
    </section>
  </div>
`, { narrow: true })}

${page('dev', 'Développeurs', `
  <p class="page-sub">Vos apps branchées sur LightPay : clés API, webhooks, paiements reçus. Les clés test utilisent l’environnement de test, les clés live l’argent réel.</p>
  <div class="list-card" id="devList"></div>
  <div class="stack mt-lg">
    <section class="panel"><div class="panel-head"><h2 class="panel-title">Rattacher une app existante ${tip('Pour une app créée avant l’espace développeurs : collez une de ses clés secrètes. Elle prouve que l’app est à vous ; elle n’est ni affichée ni conservée.')}</h2></div><div class="panel-body">
      <div class="field"><label for="claimKey">Clé secrète de l’app</label><input id="claimKey" type="password" autocomplete="off" placeholder="sec_live_… ou sec_test_…"></div>
      <button class="btn btn-secondary mt" type="button" id="claimGo">Rattacher à mon compte</button>
      <div class="msg" id="claimMsg" role="status" aria-live="polite"></div>
    </div></section>
  </div>
  <div class="msg" id="devMsg" role="status" aria-live="polite"></div>
`, { actions: `<span class="count-pill" id="devCount"></span><a class="btn btn-sm" href="#/dev/new">${iconSvg('plus')}Nouvelle app</a>` })}

${page('dev-new', 'Nouvelle app', `
  <section class="panel"><div class="panel-body">
    <div class="field"><label for="newAppName">Nom de l’app</label><input id="newAppName" maxlength="60" autocomplete="off" placeholder="Ma boutique"></div>
    <div class="field"><label for="newAppId">Identifiant</label><input id="newAppId" maxlength="50" autocomplete="off" placeholder="ma-boutique" class="mono"><p class="hint">Minuscules, chiffres, « - » ou « _ ». Il apparaît dans les paiements et ne change plus.</p></div>
    <div class="note">${iconSvg('key')}<p>Vos clés s’affichent une seule fois après la création : gardez-les dans un endroit sûr (variables d’environnement de votre serveur).</p></div>
    <div class="msg" id="newAppMsg" role="status" aria-live="polite"></div>
  </div><div class="actions-bar"><button class="btn" type="button" id="newAppGo">Créer l’app</button></div></section>
</div></section>
`, { back: { href: '#/dev', label: 'Développeurs' }, narrow: true })}

${page('dev-app', 'App', `
  <div data-tab="overview" class="stack">
    <section class="panel"><div class="panel-head"><h2 class="panel-title">Aperçu · 30 derniers jours</h2>${envBadge}</div>
      <div class="panel-body"><div class="well">
        ${stat({ id: 'daVolume', label: 'Encaissé', hintId: 'daVolumeHint', help: 'Montant des paiements terminés sur les 30 derniers jours, dans l’environnement affiché.' })}
        ${stat({ id: 'daEscrow', label: 'En séquestre', hintId: 'daEscrowHint', help: 'Paiements bloqués en attente de validation de la commande (litiges compris).' })}
        ${stat({ id: 'daFees', label: 'Vos commissions', hint: 'Frais de plateforme perçus', help: 'Total des fee_amount prélevés par votre app sur les paiements terminés.' })}
        ${stat({ id: 'daHooks', label: 'Webhooks', hintId: 'daHooksHint', help: 'Événements livrés à votre serveur ; les échecs sont retentés automatiquement.' })}
      </div></div>
      <div class="panel-foot" id="daWallets"></div>
    </section>
    <section class="panel"><div class="panel-head"><h2 class="panel-title">Derniers paiements</h2><a class="link" id="daMorePayments" href="#/dev">Tout voir</a></div><div class="panel-flush" id="daRecent"></div></section>
  </div>

  <div data-tab="keys" class="stack" hidden>
    <section class="panel"><div class="panel-head"><h2 class="panel-title">Clés API ${tip('Seules les empreintes des clés sont conservées : LightPay ne peut pas vous les réafficher. Régénérez-les si vous les avez perdues.')}</h2></div>
      <div class="panel-body"><dl class="kv">
        <dt>Clé test</dt><dd class="mono" id="daTestKey"></dd>
        <dt>Clé live</dt><dd class="mono" id="daLiveKey"></dd>
        <dt>Secret webhook</dt><dd class="mono">whsec_… <span class="muted small">(affiché à la création)</span></dd>
        <dt>Dernière régénération</dt><dd id="daRotated"></dd>
      </dl></div>
      <div class="panel-actions"><button class="btn btn-danger" type="button" id="daRotate">${iconSvg('refresh')}Régénérer les clés</button></div>
    </section>
    <section class="panel"><div class="panel-head"><h2 class="panel-title">Créer un paiement</h2></div><div class="panel-body">
      <p class="small muted">Depuis votre serveur, avec la clé test puis la clé live. Le client paie sur la page LightPay, l’argent reste bloqué jusqu’à la capture.</p>
      <pre class="code mt" id="daSnippet"></pre>
    </div></section>
  </div>

  <div data-tab="webhooks" class="stack" hidden>
    <section class="panel"><div class="panel-head"><h2 class="panel-title">Adresse du webhook ${tip('LightPay y envoie chaque événement (paiement confirmé, remboursement…), signé avec l’en-tête LightPay-Signature : t=…,v1=HMAC-SHA256 de « t.corps ».')}</h2></div><div class="panel-body">
      <div class="field"><label for="daHookUrl">URL https</label><input id="daHookUrl" type="url" autocomplete="off" placeholder="https://mon-site.com/api/lightpay/webhook"></div>
      <div class="btn-row mt"><button class="btn btn-secondary" type="button" id="daHookTest">Envoyer un test</button><button class="btn" type="button" id="daHookSave">Enregistrer</button></div>
      <div class="msg" id="daHookMsg" role="status" aria-live="polite"></div>
    </div></section>
    <section class="panel"><div class="panel-head"><h2 class="panel-title">Livraisons <span class="count" id="daHookCount"></span></h2>${envBadge}</div><div class="panel-flush" id="daHookList"></div></section>
  </div>

  <div data-tab="payments" hidden>
    <section class="panel"><div class="panel-head"><h2 class="panel-title">Paiements <span class="count" id="daPayCount"></span></h2>${envBadge}</div><div class="panel-flush" id="daPayList"></div></section>
  </div>

  <div data-tab="balance" class="stack" hidden>
    <section class="panel"><div class="panel-head"><h2 class="panel-title">Solde de l’app ${tip('Ce que votre app a encaissé pour elle-même et ses commissions (fee_amount). Cet argent vous appartient : vous le retirez vers MTN MoMo ou Airtel Money.')}</h2>${envBadge}</div>
      <div class="panel-body"><div class="well">
        ${stat({ id: 'dbAvail', label: 'Disponible', hint: 'retirable maintenant', accent: true })}
        ${stat({ id: 'dbLocked', label: 'Bloqué', hint: 'en séquestre' })}
      </div></div>
    </section>
    <div class="grid-2">
      <section class="panel"><div class="panel-head"><h2 class="panel-title">Mouvements</h2></div><div class="panel-flush" id="dbMoves"></div></section>
      <section class="panel"><div class="panel-head"><h2 class="panel-title">Virer vers mon compte</h2></div><div class="panel-body">
        <form id="dbForm" novalidate>
          <p class="small muted">Le solde de l’app va uniquement sur votre compte LightPay principal. Vous le retirez ensuite vers MTN MoMo ou Airtel Money depuis votre compte, comme d’habitude.</p>
          <div class="field"><label for="dbAmount">Montant (FCFA)</label><input id="dbAmount" data-amount inputmode="numeric" autocomplete="off" placeholder="0"></div>
          <p class="small mt"><button class="link" type="button" id="dbAll">Tout virer</button></p>
          <div class="msg" id="dbMsg" role="status" aria-live="polite"></div>
          <button class="btn mt" type="submit" id="dbGo" disabled>${iconSvg('send')}Virer vers mon compte</button>
        </form>
      </div></section>
    </div>
  </div>

  <div data-tab="settings" class="stack" hidden>
    <section class="panel"><div class="panel-head"><h2 class="panel-title">Informations</h2></div><div class="panel-body">
      <div class="field"><label for="daName">Nom affiché aux clients</label><input id="daName" maxlength="60" autocomplete="off"></div>
      <button class="btn btn-secondary mt" type="button" id="daNameSave">Enregistrer le nom</button>
      <div class="msg" id="daNameMsg" role="status" aria-live="polite"></div>
    </div></section>
    <section class="panel"><div class="panel-head"><h2 class="panel-title">Sites autorisés à afficher le paiement ${tip('Les sites qui peuvent ouvrir le paiement LightPay dans un dialogue (lightpay.js). Le domaine seul, en https, un par ligne. Les domaines de vos adresses de retour sont autorisés d’office ; ailleurs, le client est redirigé vers la page de paiement.')}</h2></div><div class="panel-body">
      <textarea class="field-area" id="daEmbeds" spellcheck="false" placeholder="https://ma-boutique.com"></textarea>
      <button class="btn btn-secondary mt" type="button" id="daEmbedsSave">Enregistrer les sites</button>
      <div class="msg" id="daEmbedsMsg" role="status" aria-live="polite"></div>
      <pre class="code mt" id="daEmbedSnippet"></pre>
    </div></section>
    <section class="panel"><div class="panel-head"><h2 class="panel-title">Adresses de retour (LightPay Connect) ${tip('Où LightPay renvoie une personne après qu’elle a autorisé votre app. Une adresse https par ligne, sans #.')}</h2></div><div class="panel-body">
      <textarea class="field-area" id="daRedirects" spellcheck="false" placeholder="https://mon-site.com/lightpay/callback"></textarea>
      <button class="btn btn-secondary mt" type="button" id="daRedirectsSave">Enregistrer les adresses</button>
      <div class="msg" id="daRedirectsMsg" role="status" aria-live="polite"></div>
    </div></section>
  </div>
  <div class="msg" id="daMsg" role="status" aria-live="polite"></div>
`, { back: { href: '#/dev', label: 'Développeurs' }, titleId: 'daTitle', actions: '<span class="pill mono" id="daId"></span>', toolbar: '<nav class="tabs" id="daTabs" aria-label="Sections de l’app"></nav>' })}

  </div>
  <nav class="tabbar console-tabbar" aria-label="Navigation">
    <a href="#/home" data-tab="home">${iconSvg('home')}<span>Accueil</span></a>
    <a href="#/activity" data-tab="activity">${iconSvg('pulse')}<span>Activité</span></a>
    <a href="#/security" data-tab="security">${iconSvg('user')}<span>Compte</span></a>
  </nav>
</div>
</div>

<section class="screen" data-screen="bye" hidden>
  <div class="state"><span class="state-icon ok">${iconSvg('check')}</span><h2>Compte supprimé</h2><p>Votre compte LightPay a été fermé. Merci de l’avoir utilisé.</p></div>
</section>

<div class="overlay" id="keysSheet" hidden role="dialog" aria-modal="true" aria-labelledby="keysTitle">
  <div class="sheet">
    <h2 class="title" id="keysTitle">Vos clés</h2>
    <div class="note warn">${iconSvg('alert')}<p>Copiez-les maintenant : elles ne seront plus jamais affichées. Gardez-les sur votre serveur, jamais dans une app mobile ou un site public.</p></div>
    <div id="keysRows"></div>
    <div class="mt-lg"><button class="btn" type="button" id="keysDone">J’ai copié mes clés</button></div>
  </div>
</div>`;

  const script = `
  // Advanced mode remembered on this device (the simple /account sends here while it is on).
  try { localStorage.setItem('lightpay.mode', 'console'); } catch (e) {}
  const params = new URLSearchParams(location.search);
  const returnUrl = (function () { const r = params.get('return'); try { const u = new URL(r); return u.protocol === 'https:' || u.hostname === 'localhost' ? u.toString() : null; } catch (e) { return null; } })();
  const SCOPE_ICON = { 'balance:read': 'wallet', payee: 'receive', deposit: 'plus', charge: 'send' };
  const NARROW = window.matchMedia('(max-width: 960px)');
  let me = null;
  const cur = () => (me ? me.wallet.currency : 'XAF');
  const available = () => (me ? Number(me.wallet.available_balance) : 0);
  const fmtPhone = (d) => d.replace(/^(\\d{2})(\\d{3})(\\d{2})(\\d{2})$/, '$1 $2 $3 $4');
  const fmtDate = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtDateTime = (d) => new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  document.querySelectorAll('[data-env-badge]').forEach((b) => { b.hidden = LP.ENV !== 'sandbox'; });

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
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('side').classList.contains('open')) setMenu(false);
  });

  // ---------------------------------------------------------------- shell: menu, breadcrumb, environment
  function setMenu(open) {
    $('side').classList.toggle('open', open);
    $('scrim').classList.toggle('open', open);
    $('menuBtn').setAttribute('aria-expanded', String(open));
  }
  $('menuBtn').addEventListener('click', () => setMenu(!$('side').classList.contains('open')));
  $('scrim').addEventListener('click', () => setMenu(false));
  $('side').addEventListener('click', (e) => { if (e.target.closest && e.target.closest('a.nav-item')) setMenu(false); });
  function crumbs(section, title) {
    const parts = [el('span', { text: section })];
    if (title) { parts.push(icon('chevron-right')); parts.push(el('b', { text: title })); }
    $('crumbs').replaceChildren.apply($('crumbs'), parts);
    document.title = (title || section) + ' · LightPay';
  }
  function highlight(key) {
    document.querySelectorAll('.nav-item').forEach((a) => {
      if (a.dataset.nav === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  function syncEnvLinks() {
    $('envTest').setAttribute('aria-pressed', String(LP.ENV === 'sandbox'));
    $('envReal').setAttribute('aria-pressed', String(LP.ENV !== 'sandbox'));
    if (LP.ENV === 'sandbox') { $('envTest').setAttribute('aria-current', 'true'); $('envReal').removeAttribute('aria-current'); }
    else { $('envReal').setAttribute('aria-current', 'true'); $('envTest').removeAttribute('aria-current'); }
  }
  // Test <-> real without reloading: shimmer where figures were, then the same screen re-reads.
  function switchEnv(next) {
    if (LP.ENV === next) return;
    LP.setEnv(next);
    syncEnvLinks();
    activity = []; connections = [];
    ['homeAvailable', 'homeLocked', 'homeIn', 'homeOut'].forEach((id) => $(id).replaceChildren(el('span', { class: 'sk sk-stat' })));
    ['homeInHint', 'homeOutHint'].forEach((id) => { $(id).textContent = ''; });
    ['homeActivity', 'actList'].forEach((id) => { $(id).replaceChildren(); skeleton($(id), 6, 'div'); });
    if (liveStop) liveStop();
    liveStop = LP.live(onLive);
    loadMe().catch(() => {});
    const c = nav.current();
    if (c) nav.go(c.route, true);
  }
  $('envReal').addEventListener('click', () => switchEnv('production'));
  $('envTest').addEventListener('click', () => switchEnv('sandbox'));
  // Phones: bottom bar and the "+" sheet.
  const TAB_OF = { home: 'home', activity: 'activity', security: 'security' };
  function syncTabs(c) {
    const tab = c ? TAB_OF[c.name] : null;
    document.querySelectorAll('[data-tab]').forEach((a) => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  }
  if (returnUrl) { $('backToApp').hidden = false; $('backToApp').addEventListener('click', () => location.assign(returnUrl)); }

  // ---------------------------------------------------------------- small builders
  function tipEl(text) {
    const id = 'tip-' + Math.random().toString(36).slice(2);
    return el('span', { class: 'tip' }, [el('button', { type: 'button', 'aria-label': 'Aide', 'aria-describedby': id }, [icon('info')]), el('span', { class: 'tip-text', role: 'tooltip', id: id, text: text })]);
  }
  /** Table with small-caps headers; rows with href are clickable, the selected one is marked. */
  function table(host, cols, rows, emptyText, noHead) {
    if (!rows.length) { host.replaceChildren(el('p', { class: 'empty', text: emptyText })); return; }
    const head = el('tr', {}, cols.map((c) => el('th', { class: c.cls || '', text: c.label })));
    const body = rows.map((r) => {
      const tr = el('tr', { 'data-href': r.href || null, 'aria-selected': r.selected ? 'true' : null }, r.cells.map((c, i) => {
        const td = el('td', { class: cols[i].cls || '' });
        if (c !== null && c !== undefined) td.append(typeof c === 'string' ? document.createTextNode(c) : c);
        return td;
      }));
      if (r.href) {
        tr.tabIndex = 0;
        tr.addEventListener('click', () => { location.hash = r.href; });
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = r.href; });
      }
      return tr;
    });
    host.replaceChildren(el('div', { class: 'tbl-wrap' }, [el('table', { class: 'tbl' }, [noHead ? null : el('thead', {}, [head]), el('tbody', {}, body)])]));
  }
  function cellMain(iconNode, title, sub, subClass) {
    return el('span', { class: 'cell' }, [
      iconNode,
      el('span', { class: 'cell-main' }, [el('span', { class: 'cell-title', text: title }), sub ? el('span', { class: 'cell-sub' + (subClass ? ' ' + subClass : ''), text: sub }) : null]),
    ]);
  }
  function copyButton(value) {
    const b = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Copier', title: 'Copier' }, [icon('copy')]);
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(value); b.replaceChildren(icon('check')); setTimeout(() => b.replaceChildren(icon('copy')), 1500); } catch (e) {}
    });
    return b;
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
      case 'DEPOSIT': return 'Dépôt';
      case 'TRANSFER': return a.direction === 'IN' ? 'Reçu de ' + who : 'Envoi à ' + (who || '—');
      case 'WITHDRAWAL': return 'Retrait';
      case 'PAYMENT': return 'Paiement · ' + who;
      case 'CHARGE': return 'Débit par ' + who;
      case 'SALE': return 'Vente · ' + who;
      case 'COMMISSION': return 'Commission automatique · ' + who;
      case 'REFUND': return a.direction === 'IN' ? 'Remboursement · ' + who : 'Remboursement envoyé';
      default: return a.kind;
    }
  }
  const settledOk = (a) => a.status === 'SUCCEEDED' || a.status === 'LOCKED' || a.status === 'PENDING';
  const actIcon = (a) => a.status === 'FAILED' ? 'x' : a.status === 'LOCKED' ? 'lock' : (KIND_ICON[a.kind] === 'send' && a.direction === 'IN' ? 'receive' : KIND_ICON[a.kind] || 'clock');
  function actCells(a) {
    const st = STATUS[a.status] || ['', a.status];
    const incoming = a.direction === 'IN';
    const iconBox = el('span', { class: 'row-icon' + (incoming && a.status === 'SUCCEEDED' ? ' in' : '') }, [icon(actIcon(a))]);
    const sub = a.status === 'FAILED' ? (a.kind === 'WITHDRAWAL' ? 'Refusé · montant restitué' : 'Refusé') : a.counterparty && a.kind !== 'TRANSFER' ? a.counterparty : '';
    const amountClass = !settledOk(a) || (a.status === 'REFUNDED' && incoming) ? 'void' : a.status === 'LOCKED' ? 'held' : incoming && a.status === 'SUCCEEDED' ? 'in' : '';
    return [
      cellMain(iconBox, actTitle(a), sub, a.status === 'FAILED' ? 'err' : ''),
      el('span', { class: 'muted-cell', text: fmtDateTime(a.created_at) }),
      el('span', { class: 'pill ' + st[0], text: st[1] }),
      el('span', { class: 'strong ' + amountClass, text: (incoming ? '+' : '−') + LP.money(walletAmount(a), a.currency) }),
    ];
  }
  const ACT_COLS = [{ label: 'Opération' }, { label: 'Date', cls: 'hide-sm' }, { label: 'Statut', cls: 'hide-md' }, { label: 'Montant', cls: 'num' }];

  // ---------------------------------------------------------------- home
  // Minimums set by the admin (from /v1/me).
  const lim = (k) => Number(me && me.limits ? me.limits[k] : 0);
  async function loadMe() {
    me = await LP.api('GET', '/v1/me');
    const name = me.user.name || (me.user.email || '').split('@')[0];
    $('meAvatar').textContent = initials(name);
    $('meName').textContent = name;
    $('meMail').textContent = me.user.email || '';
    $('homeTitle').textContent = 'Bonjour ' + name.split(' ')[0];
    $('unInput').value = me.username || '';
    $('homeAvailable').textContent = LP.money(me.wallet.available_balance, cur());
    $('depMin').textContent = 'FCFA · minimum ' + lim('deposit_min').toLocaleString('fr-FR');
    $('homeLocked').textContent = LP.money(me.wallet.locked_balance, cur());
    const closed = me.wallet.status !== 'ACTIVE';
    $('homeClosed').hidden = !closed;
    $('homeActions').hidden = closed;
    $('secEmail').textContent = me.user.email || '—';
  }
  async function enterHome() {
    crumbs('Mon argent', 'Vue d’ensemble');
    await guarded(async () => {
      await loadMe();
      const act = await LP.api('GET', '/v1/me/activity?limit=100');
      table($('homeActivity'), [{ label: '' }, { label: '', cls: 'num' }], act.activity.slice(0, 10).map((a) => { const c = actCells(a); return { cells: [c[0], c[3]], href: '#/activity/' + encodeURIComponent(a.id) }; }), 'Aucune opération pour l’instant.', true);
      const since = Date.now() - 30 * 86400000;
      let inSum = 0, outSum = 0, inN = 0, outN = 0;
      act.activity.forEach((a) => {
        if (a.status !== 'SUCCEEDED' || new Date(a.created_at).getTime() < since) return;
        if (a.direction === 'IN') { inSum += Number(a.amount); inN++; } else { outSum += Number(walletAmount(a)); outN++; }
      });
      $('homeIn').textContent = LP.money(inSum, cur());
      $('homeInHint').textContent = inN + (inN > 1 ? ' opérations' : ' opération');
      $('homeOut').textContent = LP.money(outSum, cur());
      $('homeOutHint').textContent = outN + (outN > 1 ? ' opérations' : ' opération');
    }, 'homeMsg');
  }
  document.querySelectorAll('[data-home]').forEach((b) => b.addEventListener('click', () => nav.go('home')));

${FLOWS_SCRIPT}
  // ---------------------------------------------------------------- activity: list + detail
  let activity = [], actFilter = 'all';
  document.querySelectorAll('#actFilter button').forEach((b) => b.addEventListener('click', () => {
    actFilter = b.dataset.f;
    document.querySelectorAll('#actFilter button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    renderActivity();
  }));
  function renderActivity() {
    const rows = activity.filter((a) => actFilter === 'all' || (actFilter === 'failed' ? a.status === 'FAILED' : actFilter === 'in' ? a.direction === 'IN' : a.direction === 'OUT'));
    $('actCount').textContent = String(rows.length);
    table($('actList'), ACT_COLS, rows.map((a) => ({ cells: actCells(a), href: '#/activity/' + encodeURIComponent(a.id) })), actFilter === 'all' ? 'Aucune opération pour l’instant.' : 'Aucune opération dans ce filtre.');
  }
  function renderActDetail(a) {
    const st = STATUS[a.status] || ['', a.status];
    const incoming = a.direction === 'IN';
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
    rows.push(['Créée le', new Date(a.created_at).toLocaleString('fr-FR')]);
    if (a.updated_at && a.updated_at !== a.created_at) rows.push(['Mise à jour', new Date(a.updated_at).toLocaleString('fr-FR')]);
    rows.push(['N° d’opération', a.id, true]);
    const receipt = el('div', { class: 'receipt' });
    feeRows(receipt, rows);
    $('activity-itemTitle').textContent = actTitle(a);
    $('actDetailBody').replaceChildren(el('section', { class: 'panel' }, [
      el('div', { class: 'detail-head' }, [
        el('span', { class: 'avatar' }, [icon(actIcon(a))]),
        el('span', { class: 'cell-main' }, [el('span', { class: 'cell-title', text: actTitle(a) }), el('span', { class: 'amount', text: (incoming ? '+' : '−') + LP.money(walletAmount(a), a.currency) })]),
      ]),
      el('div', { class: 'panel-body' }, [
        el('span', { class: 'pill ' + st[0], text: st[1] }),
        a.reason ? el('div', { class: 'note warn' }, [icon('alert'), el('p', { text: a.reason })]) : null,
        receipt,
      ]),
    ]));
  }
  async function enterActivity() {
    crumbs('Mon argent', 'Activité');
    if (!activity.length) skeleton($('actList'), 8, 'div');
    await guarded(async () => {
      activity = (await LP.api('GET', '/v1/me/activity?limit=200')).activity;
      renderActivity();
    }, 'actMsg');
  }
  // Another operation shows the shimmer first, never the previous one; a late answer is dropped.
  let actSeq = 0;
  async function enterActivityItem(id) {
    crumbs('Activité', 'Opération');
    const seq = ++actSeq;
    $('activity-itemTitle').textContent = 'Opération';
    $('actDetailBody').replaceChildren(); skeleton($('actDetailBody'), 6, 'div');
    await guarded(async () => {
      const a = activity.find((x) => x.id === id) || (await LP.api('GET', '/v1/me/activity/' + encodeURIComponent(id))).activity;
      if (seq === actSeq) renderActDetail(a);
    }, 'actItemMsg');
  }

  // ---------------------------------------------------------------- connected apps: list + detail
  let connections = [], scopeLabels = {};
  async function loadConnections() {
    const r = await LP.api('GET', '/v1/me/connections');
    connections = r.connections.filter((c) => c.status === 'ACTIVE');
    scopeLabels = r.scope_labels || {};
    $('navConnCount').hidden = !connections.length; $('navConnCount').textContent = String(connections.length);
  }
  function renderConnections() {
    $('appsCount').textContent = String(connections.length);
    table($('appsList'), [{ label: 'App' }, { label: 'Permissions', cls: 'hide-sm' }, { label: 'Depuis', cls: 'hide-md' }], connections.map((c) => ({
      href: '#/apps/' + encodeURIComponent(c.id),
      cells: [
        cellMain(el('span', { class: 'avatar', text: initials(c.app_name) }), c.app_name, c.scopes.map((s) => scopeLabels[s] || s).join(' · ')),
        el('span', { class: 'muted-cell', text: c.scopes.length + (c.scopes.length > 1 ? ' permissions' : ' permission') }),
        el('span', { class: 'muted-cell', text: fmtDate(c.created_at) }),
      ],
    })), 'Aucune app n’a accès à votre compte.');
  }
  let appRevokeArmed = false;
  async function enterApps() {
    crumbs('Autorisations', 'Apps connectées');
    await guarded(async () => { await loadConnections(); renderConnections(); }, 'appsMsg');
  }
  async function enterApp(id) {
    crumbs('Apps connectées', 'Accès de l’app');
    appRevokeArmed = false; $('appRevoke').textContent = 'Retirer l’accès'; say('appMsg', '');
    await guarded(async () => {
      if (!connections.some((x) => x.id === id)) await loadConnections();
      const c = connections.find((x) => x.id === id);
      if (!c) return nav.go('apps', true);
      $('appTitle').textContent = c.app_name;
      $('appAvatar').textContent = initials(c.app_name);
      $('appName').textContent = c.app_name;
      $('appSince').textContent = 'Autorisée le ' + fmtDate(c.created_at);
      $('appScopes').replaceChildren.apply($('appScopes'), c.scopes.map((sc) => listRow({
        icon: SCOPE_ICON[sc] || 'check',
        title: scopeLabels[sc] || sc,
        end: c.scopes.length > 1 ? el('button', { class: 'link', type: 'button', text: 'Retirer', 'aria-label': 'Retirer : ' + (scopeLabels[sc] || sc), on: { click: () => guarded(async () => {
          await LP.api('PATCH', '/v1/me/connections/' + encodeURIComponent(c.id), { scopes: c.scopes.filter((x) => x !== sc) });
          await loadConnections(); enterApp(id); say('appMsg', 'Permission retirée.', 'ok');
        }, 'appMsg') } }) : null,
      })));
      $('appLimitBox').hidden = !c.scopes.includes('charge');
      $('appLimit').value = c.charge_limit || '';
    }, 'appMsg');
  }
  const currentConnection = () => nav.current() && connections.find((x) => x.id === nav.current().param);
  $('appLimitSave').addEventListener('click', () => guarded(async () => {
    const c = currentConnection();
    if (!c) return;
    const limit = digits($('appLimit').value);
    if (!limit || Number(limit) <= 0) return say('appMsg', 'Entrez un montant supérieur à 0.', 'err');
    await LP.api('PATCH', '/v1/me/connections/' + encodeURIComponent(c.id), { charge_limit: limit });
    await loadConnections();
    say('appMsg', 'Limite mise à jour : ' + LP.money(limit, cur()) + ' par débit.', 'ok');
  }, 'appMsg'));
  $('appRevoke').addEventListener('click', () => guarded(async () => {
    const c = currentConnection();
    if (!c) return;
    if (!appRevokeArmed) { appRevokeArmed = true; $('appRevoke').textContent = 'Confirmer : retirer l’accès de ' + c.app_name; return; }
    await LP.api('DELETE', '/v1/me/connections/' + encodeURIComponent(c.id));
    await loadConnections();
    nav.go('apps', true);
    say('appsMsg', c.app_name + ' n’a plus accès à votre compte.', 'ok');
  }, 'appMsg'));

  // ---------------------------------------------------------------- security
  function enterSecurity() {
    crumbs('Compte', 'Sécurité et compte');
    say('secMsg', ''); say('delMsg', '');
    $('envSwitchTitle').textContent = LP.ENV === 'sandbox' ? 'Passer au compte réel' : 'Passer au compte de test';
    $('envSwitchSub').textContent = LP.ENV === 'sandbox' ? 'Vous êtes dans l’environnement de test' : 'Pour essayer sans argent réel';
  }
  $('envSwitch').addEventListener('click', () => { switchEnv(LP.ENV === 'sandbox' ? 'production' : 'sandbox'); });
  $('unGo').addEventListener('click', () => guarded(async () => {
    const r = await LP.api('PUT', '/v1/me/username', { username: $('unInput').value });
    me.username = r.username; $('unInput').value = r.username;
    say('unMsg', 'Nom d’utilisateur : @' + r.username, 'ok');
  }, 'unMsg'));
  function signOut() { LP.signOut(); me = null; devApps = []; activity = []; connections = []; signIn(); }
  $('signOut').addEventListener('click', signOut);
  $('simpleMode').addEventListener('click', () => {
    try { localStorage.setItem('lightpay.mode', 'simple'); } catch (e) {}
    location.assign('/account' + location.search);
  });
  $('signOutSide').addEventListener('click', signOut);
  $('delConfirm').addEventListener('input', () => { $('delGo').disabled = $('delConfirm').value.trim() !== 'SUPPRIMER'; });
  $('delGo').addEventListener('click', () => guarded(async () => {
    $('delGo').disabled = true;
    try {
      await LP.api('DELETE', '/v1/me');
      await LP.deleteIdentity();
      showOnly(document.querySelector('[data-screen="bye"]'));
    } finally { $('delGo').disabled = $('delConfirm').value.trim() !== 'SUPPRIMER'; }
  }, 'delMsg'));

  // ---------------------------------------------------------------- developer space
  let devApps = [];
  async function loadDevApps() {
    devApps = (await LP.api('GET', '/v1/me/developer/apps')).apps;
    $('navDevApps').replaceChildren.apply($('navDevApps'), devApps.map((a) =>
      el('a', { class: 'nav-item sub', href: '#/dev/' + encodeURIComponent(a.id), 'data-nav': 'app:' + a.id }, [el('span', { text: a.name })])));
    const c = nav.current();
    if (c) highlight(navKeyOf(c));
  }
  function showKeys(keys, title) {
    $('keysTitle').textContent = title;
    const row = (label, value) => el('div', { class: 'field' }, [el('span', { class: 'label', text: label }), el('div', { class: 'keybox' }, [el('code', { text: value }), copyButton(value)])]);
    $('keysRows').replaceChildren(row('Clé test (sandbox)', keys.test_api_key), row('Clé live (argent réel)', keys.live_api_key), row('Secret des webhooks', keys.webhook_secret));
    $('keysSheet').hidden = false;
  }
  $('keysDone').addEventListener('click', () => { $('keysSheet').hidden = true; $('keysRows').replaceChildren(); });
  async function enterDev() {
    crumbs('Développeurs', 'Mes apps');
    say('claimMsg', '');
    await guarded(async () => {
      await loadDevApps();
      $('devCount').textContent = String(devApps.length);
      if (!devApps.length) {
        $('devList').replaceChildren(el('div', { class: 'hero-empty' }, [
          el('span', { class: 'state-icon' }, [icon('code')]),
          el('h2', { text: 'Branchez votre première app' }),
          el('p', { text: 'Créez une app pour obtenir vos clés : encaissez en MTN MoMo, Airtel Money ou wallet LightPay, avec l’argent bloqué jusqu’à la livraison.' }),
          el('a', { class: 'btn', href: '#/dev/new' }, [icon('plus'), 'Créer une app']),
        ]));
        return;
      }
      table($('devList'), [{ label: 'App' }, { label: 'Clé test', cls: 'hide-sm' }, { label: 'Webhook', cls: 'hide-md' }, { label: 'Créée', cls: 'hide-md' }], devApps.map((a) => ({
        href: '#/dev/' + encodeURIComponent(a.id),
        cells: [
          cellMain(el('span', { class: 'avatar', text: initials(a.name) }), a.name, a.id),
          el('span', { class: 'mono muted-cell', text: a.test_key_hint ? 'sec_test_…' + a.test_key_hint : '—' }),
          el('span', { class: 'pill ' + (a.webhook_url ? 'ok' : ''), text: a.webhook_url ? 'Configuré' : 'Aucun' }),
          el('span', { class: 'muted-cell', text: fmtDate(a.created_at) }),
        ],
      })), '');
    }, 'devMsg');
  }
  $('claimGo').addEventListener('click', () => guarded(async () => {
    const key = $('claimKey').value.trim();
    if (!key) return say('claimMsg', 'Collez la clé secrète de l’app.', 'err');
    const r = await LP.api('POST', '/v1/me/developer/apps/claim', { secret_key: key });
    $('claimKey').value = '';
    await loadDevApps();
    nav.go('dev/' + encodeURIComponent(r.app.id));
  }, 'claimMsg'));

  // new app
  const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  let idTouched = false;
  $('newAppName').addEventListener('input', () => { if (!idTouched) $('newAppId').value = slug($('newAppName').value); });
  $('newAppId').addEventListener('input', () => { idTouched = true; });
  function enterDevNew() { crumbs('Développeurs', 'Nouvelle app'); say('newAppMsg', ''); }
  $('newAppGo').addEventListener('click', () => guarded(async () => {
    $('newAppGo').disabled = true;
    try {
      const r = await LP.api('POST', '/v1/me/developer/apps', { name: $('newAppName').value.trim(), id: $('newAppId').value.trim() });
      $('newAppName').value = ''; $('newAppId').value = ''; idTouched = false;
      await loadDevApps();
      nav.go('dev/' + encodeURIComponent(r.app.id), true);
      showKeys(r.keys, 'App créée : vos clés');
    } finally { $('newAppGo').disabled = false; }
  }, 'newAppMsg'));

  // one app
  const TABS = [['overview', 'Aperçu'], ['balance', 'Solde'], ['keys', 'Clés API'], ['webhooks', 'Webhooks'], ['payments', 'Paiements'], ['settings', 'Paramètres']];
  const SESSION_STATUS = { COMPLETED: ['ok', 'Payé'], OPEN: ['', 'Ouvert'], PROCESSING: ['warn', 'En cours'], EXPIRED: ['', 'Expiré'], CANCELLED: ['', 'Annulé'] };
  const HOOK_STATUS = { SENT: ['ok', 'Livré'], PENDING: ['warn', 'En attente'], FAILED: ['err', 'Échec'], SKIPPED: ['', 'Sans URL'] };
  let devApp = null;
  const sessionCells = (s) => {
    const st = SESSION_STATUS[s.status] || ['', s.status];
    return [
      cellMain(el('span', { class: 'row-icon' + (s.status === 'COMPLETED' ? ' in' : '') }, [icon(s.kind === 'DEPOSIT' ? 'plus' : 'receive')]), s.reference || s.description || s.id, s.description && s.reference ? s.description : (s.escrow ? 'Séquestre' : '')),
      el('span', { class: 'muted-cell', text: fmtDateTime(s.created_at) }),
      el('span', { class: 'pill ' + st[0], text: st[1] }),
      el('span', { class: 'strong', text: LP.money(s.amount, s.currency) }),
    ];
  };
  const SESSION_COLS = [{ label: 'Paiement' }, { label: 'Date', cls: 'hide-sm' }, { label: 'Statut', cls: 'hide-md' }, { label: 'Montant', cls: 'num' }];
  function snippet(app) {
    return [
      'curl -X POST ' + location.origin.replace('checkout.', 'api.') + '/v1/checkout/sessions \\\\',
      '  -H "Authorization: Bearer sec_test_…' + (app.test_key_hint || '') + '" \\\\',
      '  -H "Idempotency-Key: commande-10482" \\\\',
      '  -H "Content-Type: application/json" \\\\',
      '  -d \\'{ "amount": "20000", "payee": "conn_…", "escrow": true,',
      '        "reference": "commande-10482", "return_url": "<votre page de retour>" }\\'',
      '',
      '# → { "session": { "checkout_url": "…/pay/cs_test_…" } }',
    ].join('\\n');
  }
  // ---------------------------------------------------------------- the app's own wallet (Solde)
  let dbAvailable = 0, dbKey = null;
  async function loadDevBalance() {
    const b = await LP.api('GET', '/v1/me/developer/apps/' + encodeURIComponent(devApp.id) + '/balance');
    dbAvailable = Number(b.wallet.available_balance);
    $('dbAvail').textContent = LP.money(b.wallet.available_balance, 'XAF');
    $('dbLocked').textContent = LP.money(b.wallet.locked_balance, 'XAF');
    table($('dbMoves'), [{ label: 'Mouvement' }, { label: 'Montant', cls: 'num' }], b.moves.map((m) => ({
      cells: [cellMain(el('span', { class: 'row-icon' }, [icon(m.direction === 'CREDIT' ? 'receive' : 'send')]), m.description || m.type, fmtDateTime(m.created_at)),
        el('span', { class: m.direction === 'CREDIT' ? 'in' : '', text: (m.direction === 'CREDIT' ? '+' : '−') + LP.money(m.amount, 'XAF') })],
    })), 'Aucun mouvement : les commissions de votre app arriveront ici.');
    dbCheck();
  }
  function dbCheck() {
    const amount = Number(amountDigits($('dbAmount').value));
    $('dbGo').disabled = true;
    if (!amount) return;
    if (amount > dbAvailable) return say('dbMsg', 'Solde de l’app insuffisant (disponible ' + LP.money(dbAvailable, 'XAF') + ').', 'err');
    say('dbMsg', '');
    $('dbGo').disabled = false;
  }
  $('dbAmount').addEventListener('input', () => { dbKey = null; dbCheck(); });
  $('dbAll').addEventListener('click', () => { $('dbAmount').value = dbAvailable ? String(dbAvailable) : ''; dbKey = null; dbCheck(); });
  $('dbForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('dbGo').disabled) return;
    // One key per transfer filled in: a double tap or a retry after re-auth never moves it twice.
    if (!dbKey) dbKey = LP.uuid();
    const amount = amountDigits($('dbAmount').value);
    $('dbGo').disabled = true;
    await guarded(async () => {
      const r = await LP.api('POST', '/v1/me/developer/apps/' + encodeURIComponent(devApp.id) + '/transfer', { amount: amount }, dbKey);
      dbKey = null;
      $('dbAmount').value = '';
      await loadDevBalance();
      if (me) await loadMe().catch(() => {});
      say('dbMsg', LP.money(r.transfer.amount, 'XAF') + ' virés sur votre compte LightPay.', 'ok');
    }, 'dbMsg');
    dbCheck();
  });

  async function enterDevApp(param) {
    const parts = String(param || '').split('/');
    const id = parts[0];
    const tab = TABS.some((t) => t[0] === parts[1]) ? parts[1] : 'overview';
    say('daMsg', '');
    await guarded(async () => {
      if (!devApps.length) await loadDevApps();
      devApp = (await LP.api('GET', '/v1/me/developer/apps/' + encodeURIComponent(id))).app;
      crumbs('Développeurs', devApp.name);
      highlight('app:' + devApp.id);
      $('daTitle').textContent = devApp.name;
      $('daId').textContent = devApp.id;
      $('daTabs').replaceChildren.apply($('daTabs'), TABS.map((t) => el('a', { class: 'tab', href: '#/dev/' + encodeURIComponent(id) + (t[0] === 'overview' ? '' : '/' + t[0]), 'aria-current': t[0] === tab ? 'page' : null, text: t[1] })));
      document.querySelectorAll('[data-screen="dev-app"] [data-tab]').forEach((s) => { s.hidden = s.dataset.tab !== tab; });
      $('daMorePayments').href = '#/dev/' + encodeURIComponent(id) + '/payments';
      if (tab === 'overview') {
        const o = await LP.api('GET', '/v1/me/developer/apps/' + encodeURIComponent(id) + '/overview');
        const d = o.last_30_days;
        $('daVolume').textContent = LP.money(d.volume, 'XAF');
        $('daVolumeHint').textContent = d.completed + (d.completed > 1 ? ' paiements' : ' paiement') + (d.abandoned ? ' · ' + d.abandoned + ' abandonnés' : '');
        $('daEscrow').textContent = LP.money(o.escrow.amount, 'XAF');
        $('daEscrowHint').textContent = o.escrow.n + (o.escrow.n > 1 ? ' commandes en attente' : ' commande en attente');
        $('daFees').textContent = LP.money(d.fees, 'XAF');
        $('daHooks').textContent = String(d.webhooks_sent);
        $('daHooksHint').textContent = d.webhooks_failed ? d.webhooks_failed + ' en échec' : (devApp.webhook_url ? 'aucun échec' : 'aucune URL configurée');
        $('daWallets').textContent = o.wallets.length ? 'Wallet de l’app : ' + o.wallets.map((w) => LP.money(w.available_balance, w.currency)).join(' · ') : '';
        const s = await LP.api('GET', '/v1/me/developer/apps/' + encodeURIComponent(id) + '/sessions?limit=6');
        table($('daRecent'), SESSION_COLS, s.sessions.map((x) => ({ cells: sessionCells(x) })), 'Aucun paiement dans cet environnement pour l’instant.');
      } else if (tab === 'keys') {
        $('daTestKey').textContent = devApp.test_key_hint ? 'sec_test_' + '•'.repeat(12) + devApp.test_key_hint : 'Créée avant l’espace développeurs';
        $('daLiveKey').textContent = devApp.live_key_hint ? 'sec_live_' + '•'.repeat(12) + devApp.live_key_hint : 'Créée avant l’espace développeurs';
        $('daRotated').textContent = devApp.keys_rotated_at ? fmtDateTime(devApp.keys_rotated_at) : 'Jamais (clés d’origine)';
        $('daSnippet').textContent = snippet(devApp);
        rotateArmed = false; $('daRotate').replaceChildren(icon('refresh'), 'Régénérer les clés');
      } else if (tab === 'webhooks') {
        $('daHookUrl').value = devApp.webhook_url || '';
        say('daHookMsg', '');
        const w = await LP.api('GET', '/v1/me/developer/apps/' + encodeURIComponent(id) + '/webhooks?limit=50');
        $('daHookCount').textContent = String(w.deliveries.length);
        table($('daHookList'), [{ label: 'Événement' }, { label: 'Date', cls: 'hide-sm' }, { label: 'Réponse', cls: 'hide-md' }, { label: 'Statut', cls: 'num' }], w.deliveries.map((h) => {
          const st = HOOK_STATUS[h.status] || ['', h.status];
          return { cells: [
            cellMain(el('span', { class: 'row-icon' }, [icon('webhook')]), h.event, h.event_id || ''),
            el('span', { class: 'muted-cell', text: fmtDateTime(h.created_at) }),
            el('span', { class: 'muted-cell mono', text: h.response_status ? 'HTTP ' + h.response_status + (h.attempts > 1 ? ' · ' + h.attempts + ' essais' : '') : '—' }),
            el('span', { class: 'pill ' + st[0], text: st[1] }),
          ] };
        }), 'Aucun événement envoyé pour l’instant.');
      } else if (tab === 'balance') {
        await loadDevBalance();
      } else if (tab === 'payments') {
        const s = await LP.api('GET', '/v1/me/developer/apps/' + encodeURIComponent(id) + '/sessions?limit=100');
        $('daPayCount').textContent = String(s.sessions.length);
        table($('daPayList'), SESSION_COLS, s.sessions.map((x) => ({ cells: sessionCells(x) })), 'Aucun paiement dans cet environnement pour l’instant.');
      } else if (tab === 'settings') {
        $('daName').value = devApp.name;
        $('daRedirects').value = (devApp.redirect_uris || []).join('\\n');
        $('daEmbeds').value = (devApp.embed_origins || []).join('\\n');
        $('daEmbedSnippet').textContent = [
          '<script src="' + location.origin + '/lightpay.js"></' + 'script>',
          '',
          '// checkout_url : renvoyée par POST /v1/checkout/sessions (depuis votre serveur)',
          'const r = await LightPay.pay(checkout_url);',
          '// r.status : "completed" ou "closed" — confirmez toujours côté serveur (API ou webhook).',
        ].join('\\n');
        say('daNameMsg', ''); say('daRedirectsMsg', ''); say('daEmbedsMsg', '');
      }
    }, 'daMsg');
  }
  let rotateArmed = false;
  $('daRotate').addEventListener('click', () => guarded(async () => {
    if (!devApp) return;
    if (!rotateArmed) { rotateArmed = true; $('daRotate').replaceChildren(icon('alert'), 'Confirmer : les clés actuelles cessent de fonctionner'); return; }
    const r = await LP.api('POST', '/v1/me/developer/apps/' + encodeURIComponent(devApp.id) + '/rotate-keys', {});
    devApp = r.app; rotateArmed = false;
    await enterDevApp(devApp.id + '/keys');
    showKeys(r.keys, 'Nouvelles clés');
  }, 'daMsg'));
  $('daHookSave').addEventListener('click', () => guarded(async () => {
    if (!devApp) return;
    const r = await LP.api('PATCH', '/v1/me/developer/apps/' + encodeURIComponent(devApp.id), { webhook_url: $('daHookUrl').value.trim() });
    devApp = r.app;
    say('daHookMsg', devApp.webhook_url ? 'Adresse enregistrée.' : 'Webhook désactivé.', 'ok');
  }, 'daHookMsg'));
  $('daHookTest').addEventListener('click', () => guarded(async () => {
    if (!devApp) return;
    await LP.api('POST', '/v1/me/developer/apps/' + encodeURIComponent(devApp.id) + '/webhooks/test', {});
    say('daHookMsg', 'Événement « ping » envoyé. Il apparaît dans les livraisons dans quelques secondes.', 'ok');
    setTimeout(() => { if (nav.current() && nav.current().name === 'dev-app') enterDevApp(devApp.id + '/webhooks'); }, 2500);
  }, 'daHookMsg'));
  $('daNameSave').addEventListener('click', () => guarded(async () => {
    if (!devApp) return;
    const r = await LP.api('PATCH', '/v1/me/developer/apps/' + encodeURIComponent(devApp.id), { name: $('daName').value.trim() });
    devApp = r.app;
    $('daTitle').textContent = devApp.name; crumbs('Développeurs', devApp.name);
    await loadDevApps();
    say('daNameMsg', 'Nom enregistré.', 'ok');
  }, 'daNameMsg'));
  $('daEmbedsSave').addEventListener('click', () => guarded(async () => {
    if (!devApp) return;
    const origins = $('daEmbeds').value.split('\\n').map((s) => s.trim()).filter(Boolean);
    const r = await LP.api('PATCH', '/v1/me/developer/apps/' + encodeURIComponent(devApp.id), { embed_origins: origins });
    devApp = r.app;
    $('daEmbeds').value = devApp.embed_origins.join('\\n');
    say('daEmbedsMsg', origins.length ? 'Sites enregistrés.' : 'Aucun site ajouté : seuls les domaines de vos adresses de retour peuvent ouvrir le dialogue.', 'ok');
  }, 'daEmbedsMsg'));
  $('daRedirectsSave').addEventListener('click', () => guarded(async () => {
    if (!devApp) return;
    const uris = $('daRedirects').value.split('\\n').map((s) => s.trim()).filter(Boolean);
    const r = await LP.api('PATCH', '/v1/me/developer/apps/' + encodeURIComponent(devApp.id), { redirect_uris: uris });
    devApp = r.app;
    say('daRedirectsMsg', uris.length ? uris.length + (uris.length > 1 ? ' adresses enregistrées.' : ' adresse enregistrée.') : 'Aucune adresse : LightPay Connect est désactivé pour cette app.', 'ok');
  }, 'daRedirectsMsg'));

  // ---------------------------------------------------------------- navigation
  const navKeyOf = (c) => c.name === 'dev-app' ? 'app:' + String(c.param || '').split('/')[0]
    : c.name === 'dev-new' ? 'dev'
    : c.name === 'activity-item' ? 'activity' : c.name === 'app' ? 'apps'
    : c.name.indexOf('send') === 0 ? 'send' : c.name.indexOf('withdraw') === 0 ? 'withdraw' : c.name.indexOf('deposit') === 0 ? 'deposit' : c.name;
  const withNav = (fn) => (param) => { const c = nav.current(); if (c) { highlight(navKeyOf(c)); syncTabs(c); } syncEnvLinks(); return fn(param); };
  const nav = createNav({
    root: 'home',
    resolve: (route) => {
      if (route.indexOf('apps/') === 0) return ['app', route.slice(5)];
      if (route.indexOf('activity/') === 0) return ['activity-item', route.slice(9)];
      if (route === 'dev/new') return ['dev-new', null];
      if (route.indexOf('dev/') === 0) return ['dev-app', route.slice(4)];
      return [route.replace('/', '-'), null];
    },
    onRootBack: () => { if (returnUrl) location.assign(returnUrl); },
    screens: {
      home: { enter: withNav(enterHome) },
      activity: { enter: withNav(enterActivity) },
      'activity-item': { parent: 'activity', enter: withNav(enterActivityItem) },
      deposit: { parent: 'home', enter: withNav(() => { crumbs('Mon argent', 'Dépôt'); say('depMsg', ''); renderDepFees(); focusAmount('depAmount'); loadMe().then(renderDepFees).catch(() => {}); }) },
      'deposit-done': { parent: 'home', enter: withNav(enterDepositDone) },
      send: { parent: 'home', enter: withNav(() => { crumbs('Mon argent', 'Envoyer'); enterSend(); }) },
      'send-done': { parent: 'home', enter: withNav(enterSendDone) },
      withdraw: { parent: 'home', enter: withNav(() => { crumbs('Mon argent', 'Retirer'); return enterWithdraw(); }) },
      'withdraw-done': { parent: 'home', enter: withNav(enterWithdrawDone) },
      apps: { enter: withNav(enterApps) },
      app: { parent: 'apps', enter: withNav(enterApp) },
      security: { enter: withNav(enterSecurity) },
      dev: { enter: withNav(enterDev) },
      'dev-new': { parent: 'dev', enter: withNav(enterDevNew) },
      'dev-app': { parent: 'dev', enter: withNav(enterDevApp) },
    },
  });

  // Signed out: the sign-in screen, with what the account gives access to.
  function authAside() {
    const tool = (ic, title, text) => el('div', { class: 'auth-tool' }, [el('span', { class: 'tool-icon' }, [icon(ic)]), el('span', {}, [el('b', { text: title }), el('span', { text: text })])]);
    const point = (text) => el('li', {}, [icon('check'), text]);
    return el('aside', { class: 'auth-aside' }, [
      el('span', { class: 'pill-brand' }, [el('span', { class: 'brand-mark', 'aria-hidden': 'true' }), 'Compte LightPay']),
      el('h2', { text: 'Un seul compte, votre argent et vos apps.' }),
      el('p', { text: 'Le même compte Google pour votre wallet, pour payer sur les sites partenaires et pour gérer vos intégrations.' }),
      el('div', { class: 'auth-tools' }, [
        tool('wallet', 'Wallet LightPay', 'Déposer, envoyer et retirer vers MTN MoMo ou Airtel Money'),
        tool('lock', 'Paiements protégés', 'L’argent reste bloqué jusqu’à la livraison de la commande'),
        tool('code', 'Espace développeurs', 'Clés API, webhooks et paiements de vos apps'),
      ]),
      el('ul', { class: 'auth-points' }, [
        point('Frais affichés avant chaque validation.'),
        point('Chaque opération tracée, avec la raison d’un refus.'),
        point('Environnement de test séparé : aucun argent réel en jeu.'),
      ]),
    ]);
  }
  function signIn() { mountAuth(boot, Object.assign({ aside: authAside(), subtitle: 'Votre wallet et votre espace développeurs.' }, returnUrl ? { onBack: () => location.assign(returnUrl) } : {})); }
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
      // The console is the advanced mode: granted by the LightPay admin, never by default.
      if (me.developer !== 'APPROVED') {
        try { localStorage.removeItem('lightpay.mode'); } catch (e) {}
        location.replace('/account' + location.search);
        return;
      }
      if (!me.username) { location.replace('/account' + location.search + '#/username'); return; }
      loadDevApps().catch(() => {});
      loadConnections().catch(() => {});
      syncEnvLinks();
      nav.start();
      if (liveStop) liveStop();
      liveStop = LP.live(onLive);
    } catch (e) { if (e.signIn) signIn(); else { nav.start(); say('homeMsg', e.message, 'err'); } }
  }
  if (LP.isRedirecting()) signIn(); else if (LP.signedIn()) boot(); else signIn();
`;

  return shell({ title: 'Mon compte', nonce, env, body, script, css: CONSOLE_CSS, console: true });
};
