import { shell, topbar } from './shell.js';
import { iconSvg } from './icons.js';

/**
 * /account — the person's LightPay space, simple interface (the default for everyone).
 * Advanced mode (console + developer space, /account/console) is switched on from Sécurité.
 * Hash routes:
 *   #/home  #/deposit  #/send → #/send/review → #/send/done  #/withdraw → #/withdraw/review →
 *   #/withdraw/done  #/activity → #/activity/<id>  #/apps → #/apps/<id>  #/security
 * ?env=sandbox for the test wallet · ?return=<url> shows a back button to the calling app.
 */
export const accountPage = (nonce: string, env: string) => {
  const bar = (title: string) => topbar({ title, back: true, env });
  const body = `
<section class="screen" data-screen="home" hidden>
  ${topbar({ brand: true, back: false, env, end: '<button class="icon-btn" type="button" id="homeBack" hidden aria-label="Retour à l’application">' + iconSvg('x') + '</button>' })}
  <div class="content">
    <div class="row">
      <span class="avatar" id="homeAvatar" aria-hidden="true"></span>
      <span class="row-main"><span class="row-title" id="homeName"></span><span class="row-sub" id="homeEmail"></span></span>
    </div>
    <div class="hero mt">
      <div class="hero-label">Solde disponible</div>
      <div class="amount-xl" id="homeAvailable">—</div>
      <div class="hero-sub">${iconSvg('lock')}<span id="homeLocked"></span></div>
    </div>
    <div class="note warn" id="homeClosed" hidden>${iconSvg('alert')}<p>Ce compte LightPay est fermé : il ne peut plus recevoir ni envoyer d’argent.</p></div>
    <div class="quick" id="homeActions">
      <button class="quick-btn" type="button" data-go="deposit"><span class="quick-icon">${iconSvg('plus')}</span>Recharger</button>
      <button class="quick-btn" type="button" data-go="send"><span class="quick-icon">${iconSvg('send')}</span>Envoyer</button>
      <button class="quick-btn" type="button" data-go="withdraw"><span class="quick-icon">${iconSvg('withdraw')}</span>Retirer</button>
    </div>
    <div class="section-head"><h2>Activité récente</h2><a class="link" href="#/activity">Tout voir</a></div>
    <ul class="list" id="homeActivity"></ul>
    <div class="section-head"><h2>Mon compte</h2></div>
    <ul class="list">
      <li><a class="row" href="#/apps"><span class="row-icon">${iconSvg('apps')}</span><span class="row-main"><span class="row-title">Apps connectées</span><span class="row-sub" id="homeAppsSub">Accès et permissions</span></span>${iconSvg('chevron-right', 'chev')}</a></li>
      <li><a class="row" href="#/security"><span class="row-icon">${iconSvg('shield')}</span><span class="row-main"><span class="row-title">Sécurité et compte</span><span class="row-sub">E-mail, mot de passe, environnement</span></span>${iconSvg('chevron-right', 'chev')}</a></li>
    </ul>
    <div class="msg" id="homeMsg" role="status" aria-live="polite"></div>
    <p class="small muted mt-lg">Les fonds bloqués sont des paiements en attente de validation d’une commande : ils ne peuvent être ni envoyés ni retirés.</p>
  </div>
</section>

<section class="screen" data-screen="deposit" hidden>
  ${bar('Recharger')}
  <div class="content">
    <label class="label" for="depAmount">Montant à recharger</label>
    <div class="amount-wrap"><input class="amount-input" id="depAmount" data-amount inputmode="numeric" autocomplete="off" placeholder="0"><div class="amount-cur">FCFA · minimum 1 000</div></div>
    <div class="field"><span class="label" id="depNetLabel">Payer avec</span>
      <div class="seg" role="group" aria-labelledby="depNetLabel">
        <button class="seg-opt" type="button" data-dep-net="MTN_MOMO_COG" aria-pressed="true">MTN MoMo</button>
        <button class="seg-opt" type="button" data-dep-net="AIRTEL_COG" aria-pressed="false">Airtel Money</button>
      </div>
    </div>
    <div class="fees" id="depFees" hidden></div>
    <div class="msg" id="depMsg" role="status" aria-live="polite"></div>
    <div class="note">${iconSvg('info')}<p>Vous validerez le paiement sur votre téléphone. Le montant rechargé est crédité dès la confirmation de l’opérateur.</p></div>
  </div>
  <div class="actions-bar"><button class="btn" type="button" id="depGo" disabled>Continuer vers le paiement</button></div>
</section>

<section class="screen" data-screen="send" hidden>
  ${bar('Envoyer')}
  <div class="content">
    <div class="field"><label for="sendTo">Destinataire (e-mail LightPay)</label><input id="sendTo" type="email" autocomplete="off" inputmode="email" placeholder="nom@exemple.com"></div>
    <label class="label mt-lg" for="sendAmount">Montant</label>
    <div class="amount-wrap"><input class="amount-input" id="sendAmount" data-amount inputmode="numeric" autocomplete="off" placeholder="0"><div class="amount-cur" id="sendAvail">FCFA</div></div>
    <div class="field"><label for="sendNote">Message (facultatif)</label><input id="sendNote" maxlength="140" autocomplete="off" placeholder="Ex. : loyer de mars"></div>
    <div class="msg" id="sendMsg" role="status" aria-live="polite"></div>
    <div class="note">${iconSvg('bolt')}<p>Gratuit et instantané entre comptes LightPay.</p></div>
  </div>
  <div class="actions-bar"><button class="btn" type="button" id="sendNext">Continuer</button></div>
</section>

<section class="screen" data-screen="send-review" hidden>
  ${bar('Vérifier l’envoi')}
  <div class="content">
    <p class="eyebrow">Vous envoyez</p>
    <div class="amount-xl" id="sendReviewAmount"></div>
    <div class="receipt" id="sendReviewRows"></div>
    <div class="msg" id="sendReviewMsg" role="status" aria-live="polite"></div>
  </div>
  <div class="actions-bar"><button class="btn" type="button" id="sendConfirm">Confirmer l’envoi</button></div>
</section>

<section class="screen" data-screen="send-done" hidden>
  ${bar('Envoi')}
  <div class="state"><span class="state-icon ok">${iconSvg('check')}</span><h2>Argent envoyé</h2><p id="sendDoneText"></p></div>
  <div class="actions-bar"><button class="btn" type="button" data-home>Terminé</button></div>
</section>

<section class="screen" data-screen="withdraw" hidden>
  ${bar('Retirer')}
  <div class="content">
    <div class="field"><span class="label" id="wdNetLabel">Vers</span>
      <div class="seg" role="group" aria-labelledby="wdNetLabel">
        <button class="seg-opt" type="button" data-wd-net="MTN_MOMO_COG" aria-pressed="true">MTN MoMo</button>
        <button class="seg-opt" type="button" data-wd-net="AIRTEL_COG" aria-pressed="false">Airtel Money</button>
      </div>
    </div>
    <div class="field"><label for="wdPhone">Numéro qui reçoit</label><div class="input-prefix"><span>+242</span><input id="wdPhone" inputmode="tel" autocomplete="tel-national" placeholder="06 512 44 81" maxlength="16"></div></div>
    <label class="label mt-lg" for="wdAmount">Montant à recevoir</label>
    <div class="amount-wrap"><input class="amount-input" id="wdAmount" data-amount inputmode="numeric" autocomplete="off" placeholder="0"><div class="amount-cur" id="wdAvail">FCFA</div></div>
    <div class="fees" id="wdFees" hidden></div>
    <div class="msg" id="wdMsg" role="status" aria-live="polite"></div>
    <div class="section-head" id="wdListHead" hidden><h2>Derniers retraits</h2></div>
    <ul class="list" id="wdList"></ul>
  </div>
  <div class="actions-bar"><button class="btn" type="button" id="wdNext" disabled>Continuer</button></div>
</section>

<section class="screen" data-screen="withdraw-review" hidden>
  ${bar('Vérifier le retrait')}
  <div class="content">
    <p class="eyebrow">Vous recevez</p>
    <div class="amount-xl" id="wdReviewAmount"></div>
    <div class="receipt" id="wdReviewRows"></div>
    <div class="msg" id="wdReviewMsg" role="status" aria-live="polite"></div>
  </div>
  <div class="actions-bar"><button class="btn" type="button" id="wdConfirm">Confirmer le retrait</button></div>
</section>

<section class="screen" data-screen="withdraw-done" hidden>
  ${bar('Retrait')}
  <div class="state"><span class="state-icon" id="wdDoneIcon"></span><h2 id="wdDoneTitle"></h2><p id="wdDoneText"></p></div>
  <div class="actions-bar"><button class="btn" type="button" data-home>Terminé</button></div>
</section>

<section class="screen" data-screen="activity" hidden>
  ${bar('Activité')}
  <div class="content"><div id="actList"></div><div class="msg" id="actMsg" role="status" aria-live="polite"></div></div>
</section>

<section class="screen" data-screen="activity-item" hidden>
  ${bar('Détail de l’opération')}
  <div class="content">
    <div class="center mt"><span class="avatar avatar-lg" id="itemIcon" aria-hidden="true"></span><p class="small muted mt" id="itemKind"></p><div class="amount-xl" id="itemAmount"></div><p class="mt"><span class="pill" id="itemStatus"></span></p></div>
    <div class="note warn" id="itemReasonBox" hidden>${iconSvg('alert')}<p id="itemReason"></p></div>
    <div class="receipt" id="itemRows"></div>
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

<section class="screen" data-screen="security" hidden>
  ${bar('Sécurité et compte')}
  <div class="content">
    <ul class="list"><li><div class="row"><span class="row-icon">${iconSvg('mail')}</span><span class="row-main"><span class="row-title" id="secEmail"></span><span class="row-sub">E-mail de connexion</span></span></div></li></ul>
    <div class="field"><label for="newEmail">Nouvel e-mail</label><input id="newEmail" type="email" autocomplete="email"></div>
    <button class="btn btn-secondary mt" type="button" id="emailGo">Changer l’e-mail</button>
    <div class="field mt-lg"><label for="newPass">Nouveau mot de passe</label><input id="newPass" type="password" autocomplete="new-password" placeholder="6 caractères minimum"></div>
    <button class="btn btn-secondary mt" type="button" id="passGo">Changer le mot de passe</button>
    <div class="msg" id="secMsg" role="status" aria-live="polite"></div>
    <div class="section-head"><h2>Affichage</h2></div>
    <ul class="list"><li><button class="row" type="button" id="advancedMode"><span class="row-icon">${iconSvg('apps')}</span><span class="row-main"><span class="row-title">Mode avancé</span><span class="row-sub">Tableau de bord, historique détaillé et espace développeurs</span></span>${iconSvg('chevron-right', 'chev')}</button></li></ul>
    <div class="section-head"><h2>Environnement</h2></div>
    <ul class="list"><li><a class="row" id="envSwitch" href="/account"><span class="row-icon">${iconSvg('swap')}</span><span class="row-main"><span class="row-title" id="envSwitchTitle"></span><span class="row-sub" id="envSwitchSub"></span></span>${iconSvg('chevron-right', 'chev')}</a></li>
    <li><button class="row" type="button" id="signOut"><span class="row-icon">${iconSvg('logout')}</span><span class="row-main"><span class="row-title">Se déconnecter</span></span></button></li></ul>
    <div class="danger-zone">
      <h2 class="small">Supprimer mon compte</h2>
      <p class="small muted mt">Possible si vos wallets réel et test sont à zéro et qu’aucun paiement n’est en attente. Les apps connectées perdent leur accès ; l’historique comptable est conservé.</p>
      <div class="field"><label for="delConfirm">Tapez SUPPRIMER pour confirmer</label><input id="delConfirm" autocomplete="off"></div>
      <button class="btn btn-danger mt" type="button" id="delGo" disabled>Supprimer définitivement</button>
      <div class="msg" id="delMsg" role="status" aria-live="polite"></div>
    </div>
  </div>
</section>

<section class="screen" data-screen="bye" hidden>
  ${topbar({ brand: true, back: false, env })}
  <div class="state"><span class="state-icon ok">${iconSvg('check')}</span><h2>Compte supprimé</h2><p>Votre compte LightPay a été fermé. Merci de l’avoir utilisé.</p></div>
</section>

<div class="overlay" id="reauth" hidden role="dialog" aria-modal="true" aria-labelledby="reTitle">
  <form class="sheet" id="reForm" novalidate>
    <h2 class="title" id="reTitle">Confirmez votre identité</h2>
    <p class="small muted mt">Pour votre sécurité, entrez votre mot de passe LightPay.</p>
    <div class="field"><label for="rePass">Mot de passe</label><input id="rePass" type="password" autocomplete="current-password"></div>
    <div class="msg" id="reMsg" role="status" aria-live="polite"></div>
    <div class="btn-row mt-lg"><button class="btn btn-secondary" type="button" id="reCancel">Annuler</button><button class="btn" type="submit" id="reGo">Confirmer</button></div>
  </form>
</div>`;

  const script = `
  // Advanced mode chosen on this device: open the console instead.
  try { if (localStorage.getItem('lightpay.mode') === 'console') { location.replace('/account/console' + location.search + location.hash); return; } } catch (e) {}
  const params = new URLSearchParams(location.search);
  const returnUrl = (function () { const r = params.get('return'); try { const u = new URL(r); return u.protocol === 'https:' || u.hostname === 'localhost' ? u.toString() : null; } catch (e) { return null; } })();
  const SCOPE_ICON = { 'balance:read': 'wallet', payee: 'receive', deposit: 'plus', charge: 'send' };
  const WD_STATUS = { SUCCEEDED: ['ok', 'envoyé'], PENDING: ['warn', 'en cours'], FAILED: ['err', 'échoué · restitué'] };
  let me = null;
  const cur = () => (me ? me.wallet.currency : 'XAF');
  const available = () => (me ? Number(me.wallet.available_balance) : 0);
  const fmtPhone = (d) => d.replace(/^(\\d{2})(\\d{3})(\\d{2})(\\d{2})$/, '$1 $2 $3 $4');

  // ---------------------------------------------------------------- guarded calls + re-auth
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
    e.preventDefault();
    $('reGo').disabled = true; say('reMsg', '');
    try {
      await LP.signIn(LP.email(), $('rePass').value);
      $('reauth').hidden = true;
      const p = pending; pending = null;
      if (p) await guarded(p.action, p.msg);
    } catch (err) { say('reMsg', err.message, 'err'); }
    finally { $('reGo').disabled = false; }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('reauth').hidden) $('reCancel').click(); });

  // ---------------------------------------------------------------- activity (journal of every operation)
  const STATUS = {
    PENDING: ['warn', 'En cours'], SUCCEEDED: ['ok', 'Réussi'], FAILED: ['err', 'Refusé'], LOCKED: ['warn', 'Bloqué'],
    REFUNDED: ['', 'Remboursé'], EXPIRED: ['', 'Expiré'], CANCELLED: ['', 'Annulé'],
  };
  const KIND_ICON = { DEPOSIT: 'plus', TRANSFER: 'send', WITHDRAWAL: 'withdraw', PAYMENT: 'send', CHARGE: 'send', SALE: 'receive', REFUND: 'receive', COMMISSION: 'send' };
  function actTitle(a) {
    const who = a.counterparty || '';
    switch (a.kind) {
      case 'DEPOSIT': return 'Recharge';
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
  function actRow(a) {
    const st = STATUS[a.status] || ['', a.status];
    const incoming = a.direction === 'IN';
    const sub = timeLabel(a.created_at) + ' · ' + st[1] + (a.status === 'FAILED' && a.reason ? ' — ' + a.reason : '');
    const row = listRow({
      icon: a.status === 'FAILED' ? 'x' : a.status === 'LOCKED' ? 'lock' : (KIND_ICON[a.kind] === 'send' && incoming ? 'receive' : KIND_ICON[a.kind] || 'clock'),
      iconClass: incoming && a.status === 'SUCCEEDED' ? 'in' : '',
      title: actTitle(a),
      sub: sub,
      end: (incoming ? '+' : '−') + LP.money(a.amount, a.currency),
      endClass: !settledOk(a) || a.status === 'REFUNDED' && incoming ? 'void' : a.status === 'LOCKED' ? 'held' : incoming && a.status === 'SUCCEEDED' ? 'in' : '',
      href: '#/activity/' + encodeURIComponent(a.id),
      chev: true,
    });
    const subEl = row.querySelector('.row-sub');
    if (subEl && (a.status === 'FAILED')) subEl.classList.add('err');
    if (subEl && (a.status === 'PENDING' || a.status === 'LOCKED')) subEl.classList.add('warn');
    return row;
  }

  // ---------------------------------------------------------------- home
  async function loadMe() {
    me = await LP.api('GET', '/v1/me');
    const name = me.user.name || (me.user.email || '').split('@')[0];
    $('homeAvatar').textContent = initials(name);
    $('homeName').textContent = 'Bonjour ' + name;
    $('homeEmail').textContent = me.user.email || '';
    $('homeAvailable').textContent = LP.money(me.wallet.available_balance, cur());
    $('homeLocked').textContent = LP.money(me.wallet.locked_balance, cur()) + ' bloqués';
    const closed = me.wallet.status !== 'ACTIVE';
    $('homeClosed').hidden = !closed;
    $('homeActions').hidden = closed;
    $('secEmail').textContent = me.user.email || '—';
  }
  async function enterHome() {
    await guarded(async () => {
      await loadMe();
      const act = await LP.api('GET', '/v1/me/activity?limit=5');
      $('homeActivity').replaceChildren.apply($('homeActivity'), act.activity.length ? act.activity.map(actRow) : [el('li', { class: 'empty', text: 'Aucune opération pour l’instant.' })]);
      const c = await LP.api('GET', '/v1/me/connections');
      const n = c.connections.filter((x) => x.status === 'ACTIVE').length;
      $('homeAppsSub').textContent = n ? n + (n > 1 ? ' apps autorisées' : ' app autorisée') : 'Aucune app autorisée';
    }, 'homeMsg');
  }
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => nav.go(b.dataset.go)));
  document.querySelectorAll('[data-home]').forEach((b) => b.addEventListener('click', () => nav.home()));
  if (returnUrl) { $('homeBack').hidden = false; $('homeBack').addEventListener('click', () => location.assign(returnUrl)); }

  // ---------------------------------------------------------------- deposit
  let depNet = 'MTN_MOMO_COG', depQuotes = null;
  document.querySelectorAll('[data-dep-net]').forEach((b) => b.addEventListener('click', () => {
    depNet = b.dataset.depNet;
    document.querySelectorAll('[data-dep-net]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    renderDepFees();
  }));
  function renderDepFees() {
    const q = depQuotes && depQuotes[depNet];
    const amount = Number(amountDigits($('depAmount').value));
    $('depGo').disabled = true;
    if (!amount) { $('depFees').hidden = true; say('depMsg', ''); return; }
    if (!q) return;
    const approx = q.estimated ? '≈ ' : '';
    feeRows($('depFees'), [
      ['Recharge', LP.money(q.amount, cur())],
      ['Frais LightPay', LP.money(q.lightpay_fee, cur())],
      ['Frais opérateur', approx + LP.money(q.operator_fee, cur())],
      ['Total à payer', approx + LP.money(q.total, cur()), true],
    ]);
    $('depFees').hidden = false;
    if (amount < Number(q.minimum)) { say('depMsg', 'Le mobile money accepte au minimum ' + LP.money(q.minimum, cur()) + '.', 'err'); return; }
    say('depMsg', '');
    $('depGo').disabled = false;
  }
  const loadDepQuote = debounce(async () => {
    const amount = amountDigits($('depAmount').value);
    if (!amount) { depQuotes = null; renderDepFees(); return; }
    try { depQuotes = (await LP.api('GET', '/v1/me/deposits/quote?amount=' + amount)).quotes; renderDepFees(); }
    catch (e) { if (e.signIn) signIn(); else say('depMsg', e.message, 'err'); }
  }, 300);
  $('depAmount').addEventListener('input', () => { $('depGo').disabled = true; loadDepQuote(); });
  $('depGo').addEventListener('click', () => guarded(async () => {
    $('depGo').disabled = true;
    try {
      const r = await LP.api('POST', '/v1/me/deposits', { amount: amountDigits($('depAmount').value) }, LP.uuid());
      location.assign(r.checkout_path);
    } finally { $('depGo').disabled = false; }
  }, 'depMsg'));

  // ---------------------------------------------------------------- send
  let sendState = null, sendResult = null;
  function enterSend() {
    $('sendAvail').textContent = 'FCFA · disponible ' + LP.money(available(), cur());
    say('sendMsg', '');
  }
  $('sendNext').addEventListener('click', () => {
    const to = $('sendTo').value.trim();
    const amount = Number(amountDigits($('sendAmount').value));
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(to)) return say('sendMsg', 'Entrez l’e-mail LightPay du destinataire.', 'err');
    if (!amount) return say('sendMsg', 'Entrez un montant.', 'err');
    if (amount > available()) return say('sendMsg', 'Montant supérieur à votre solde disponible (' + LP.money(available(), cur()) + ').', 'err');
    sendState = { to: to, amount: String(amount), note: $('sendNote').value.trim(), key: LP.uuid() };
    nav.go('send/review');
  });
  function enterSendReview() {
    if (!sendState) return nav.go('send', true);
    $('sendReviewAmount').textContent = LP.money(sendState.amount, cur());
    const rows = [['À', sendState.to], ['Frais', 'Aucun']];
    if (sendState.note) rows.push(['Message', sendState.note]);
    rows.push(['Solde après envoi', LP.money(available() - Number(sendState.amount), cur()), true]);
    feeRows($('sendReviewRows'), rows);
    say('sendReviewMsg', '');
  }
  $('sendConfirm').addEventListener('click', () => guarded(async () => {
    if (!sendState) return;
    $('sendConfirm').disabled = true;
    try {
      const r = await LP.api('POST', '/v1/me/transfers', { to: sendState.to, amount: sendState.amount, note: sendState.note }, sendState.key);
      sendResult = r.transfer;
      sendState = null;
      $('sendTo').value = ''; $('sendAmount').value = ''; $('sendNote').value = '';
      await loadMe().catch(() => {});
      nav.go('send/done', true);
    } finally { $('sendConfirm').disabled = false; }
  }, 'sendReviewMsg'));
  function enterSendDone() {
    if (!sendResult) return nav.go('home', true);
    $('sendDoneText').textContent = LP.money(sendResult.amount, cur()) + ' envoyés à ' + (sendResult.to.name || sendResult.to.email) + '.';
  }

  // ---------------------------------------------------------------- withdraw
  let wdNet = 'MTN_MOMO_COG', wdQuote = null, wdState = null, wdResult = null, wdSeq = 0;
  document.querySelectorAll('[data-wd-net]').forEach((b) => b.addEventListener('click', () => {
    wdNet = b.dataset.wdNet;
    document.querySelectorAll('[data-wd-net]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    loadWdQuote();
  }));
  function wdCheck() {
    const phone = digits($('wdPhone').value).replace(/^242/, '');
    const q = wdQuote;
    $('wdNext').disabled = true;
    if (!q) return;
    if (Number(q.amount) < Number(q.minimum)) return say('wdMsg', 'Retrait minimum : ' + LP.money(q.minimum, cur()) + '.', 'err');
    if (Number(q.total) > available()) return say('wdMsg', 'Solde insuffisant : ce retrait coûte ' + LP.money(q.total, cur()) + ' frais compris (disponible ' + LP.money(available(), cur()) + ').', 'err');
    if (!/^0[4-6]\\d{7}$/.test(phone)) return say('wdMsg', 'Entrez le numéro à 9 chiffres qui reçoit l’argent.', phone ? 'err' : undefined);
    say('wdMsg', '');
    $('wdNext').disabled = false;
  }
  function renderWdFees() {
    const q = wdQuote;
    if (!q) { $('wdFees').hidden = true; return; }
    feeRows($('wdFees'), [
      ['Vous recevez', LP.money(q.amount, q.currency)],
      ['Frais opérateur', LP.money(q.operator_fee, q.currency)],
      ['Frais LightPay', LP.money(q.lightpay_fee, q.currency)],
      ['Total débité de votre wallet', LP.money(q.total, q.currency), true],
    ]);
    $('wdFees').hidden = false;
  }
  const loadWdQuote = debounce(async () => {
    const amount = amountDigits($('wdAmount').value);
    const seq = ++wdSeq;
    if (!amount) { wdQuote = null; renderWdFees(); wdCheck(); say('wdMsg', ''); return; }
    try {
      const r = await LP.api('GET', '/v1/me/withdrawals/quote?amount=' + amount + '&network=' + wdNet);
      if (seq !== wdSeq) return;
      wdQuote = r.quote; renderWdFees(); wdCheck();
    } catch (e) { if (e.signIn) signIn(); else say('wdMsg', e.message, 'err'); }
  }, 300);
  $('wdAmount').addEventListener('input', () => { $('wdNext').disabled = true; loadWdQuote(); });
  $('wdPhone').addEventListener('input', wdCheck);
  async function enterWithdraw() {
    $('wdAvail').textContent = 'FCFA · disponible ' + LP.money(available(), cur());
    wdCheck();
    try {
      const r = await LP.api('GET', '/v1/me/withdrawals');
      $('wdListHead').hidden = !r.withdrawals.length;
      $('wdList').replaceChildren.apply($('wdList'), r.withdrawals.slice(0, 5).map((w) => {
        const st = WD_STATUS[w.status] || ['', w.status];
        return listRow({ icon: 'withdraw', title: LP.money(w.amount, w.currency) + ' vers ' + w.to, sub: dayLabel(w.created_at) + ' · ' + timeLabel(w.created_at), end: el('span', { class: 'pill ' + st[0], text: st[1] }) });
      }));
    } catch (e) { /* history is optional */ }
  }
  $('wdNext').addEventListener('click', () => {
    if (!wdQuote) return;
    wdState = { quote: wdQuote, network: wdNet, msisdn: digits($('wdPhone').value).replace(/^242/, ''), key: LP.uuid() };
    nav.go('withdraw/review');
  });
  function enterWithdrawReview() {
    if (!wdState) return nav.go('withdraw', true);
    const q = wdState.quote;
    $('wdReviewAmount').textContent = LP.money(q.amount, q.currency);
    feeRows($('wdReviewRows'), [
      ['Vers', (wdState.network === 'MTN_MOMO_COG' ? 'MTN MoMo' : 'Airtel Money') + ' · +242 ' + fmtPhone(wdState.msisdn)],
      ['Frais opérateur', LP.money(q.operator_fee, q.currency)],
      ['Frais LightPay', LP.money(q.lightpay_fee, q.currency)],
      ['Total débité', LP.money(q.total, q.currency)],
      ['Solde après retrait', LP.money(available() - Number(q.total), q.currency), true],
    ]);
    say('wdReviewMsg', '');
  }
  $('wdConfirm').addEventListener('click', () => guarded(async () => {
    if (!wdState) return;
    $('wdConfirm').disabled = true;
    try {
      const r = await LP.api('POST', '/v1/me/withdrawals', { amount: wdState.quote.amount, msisdn: wdState.msisdn, network: wdState.network }, wdState.key);
      wdResult = r.withdrawal;
      wdState = null; wdQuote = null;
      $('wdAmount').value = ''; renderWdFees();
      await loadMe().catch(() => {});
      nav.go('withdraw/done', true);
    } finally { $('wdConfirm').disabled = false; }
  }, 'wdReviewMsg'));
  function enterWithdrawDone() {
    if (!wdResult) return nav.go('home', true);
    const w = wdResult;
    const icons = { SUCCEEDED: ['ok', 'check', 'Retrait envoyé'], PENDING: ['wait', 'clock', 'Retrait en cours'], FAILED: ['err', 'x', 'Retrait échoué'] };
    const v = icons[w.status] || icons.PENDING;
    $('wdDoneIcon').className = 'state-icon ' + v[0];
    $('wdDoneIcon').replaceChildren(icon(v[1]));
    $('wdDoneTitle').textContent = v[2];
    $('wdDoneText').textContent = w.status === 'FAILED'
      ? 'L’opérateur a refusé l’envoi. Les ' + LP.money(w.total, w.currency) + ' ont été restitués sur votre wallet.'
      : LP.money(w.amount, w.currency) + ' vers ' + w.to + (w.status === 'PENDING' ? ' : l’opérateur traite l’envoi, vous recevrez un SMS.' : '. Vous allez recevoir un SMS de votre opérateur.');
    if (w.status === 'PENDING') followWithdrawal(w.id);
  }
  // A pending withdrawal is re-read while its screen stays open: the operator usually confirms
  // within seconds, and the server settles it from the webhook or its own check.
  let wdFollow = null;
  function followWithdrawal(id, tries = 0) {
    clearTimeout(wdFollow);
    if (tries >= 60) return;
    wdFollow = setTimeout(async () => {
      const c = nav.current();
      if (!c || c.name !== 'withdraw-done' || !wdResult || wdResult.id !== id) return;
      try {
        const r = await LP.api('GET', '/v1/me/withdrawals');
        const w = (r.withdrawals || []).find((x) => x.id === id);
        if (w && w.status !== 'PENDING') { wdResult = w; await loadMe().catch(() => {}); return enterWithdrawDone(); }
      } catch (e) { /* next try */ }
      followWithdrawal(id, tries + 1);
    }, 3000);
  }

  // ---------------------------------------------------------------- activity
  async function enterActivity() {
    await guarded(async () => {
      const r = await LP.api('GET', '/v1/me/activity?limit=100');
      if (!r.activity.length) { $('actList').replaceChildren(el('p', { class: 'empty', text: 'Aucune opération pour l’instant.' })); return; }
      const out = []; let day = '';
      r.activity.forEach((a) => {
        const d = dayLabel(a.created_at);
        if (d !== day) { day = d; out.push(el('h2', { class: 'group-label', text: d.charAt(0).toUpperCase() + d.slice(1) })); out.push(el('ul', { class: 'list' })); }
        out[out.length - 1].append(actRow(a));
      });
      $('actList').replaceChildren.apply($('actList'), out);
    }, 'actMsg');
  }
  async function enterActivityItem(id) {
    say('itemMsg', '');
    await guarded(async () => {
      const a = (await LP.api('GET', '/v1/me/activity/' + encodeURIComponent(id))).activity;
      const st = STATUS[a.status] || ['', a.status];
      const incoming = a.direction === 'IN';
      $('itemIcon').replaceChildren(icon(a.status === 'FAILED' ? 'x' : KIND_ICON[a.kind] || 'clock'));
      $('itemKind').textContent = actTitle(a);
      $('itemAmount').textContent = (incoming ? '+' : '−') + LP.money(a.amount, a.currency);
      $('itemStatus').className = 'pill ' + st[0];
      $('itemStatus').textContent = st[1];
      $('itemReasonBox').hidden = !a.reason;
      $('itemReason').textContent = a.reason || '';
      const rows = [['Montant', LP.money(a.amount, a.currency)]];
      if (a.fees && a.fees !== '0') rows.push(['Frais', LP.money(a.fees, a.currency)]);
      if (a.total && a.total !== a.amount) rows.push([incoming ? 'Net reçu' : 'Total', LP.money(a.total, a.currency)]);
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
      feeRows($('itemRows'), rows);
    }, 'itemMsg');
  }

  // ---------------------------------------------------------------- apps
  let connections = [], scopeLabels = {};
  async function loadConnections() {
    const r = await LP.api('GET', '/v1/me/connections');
    connections = r.connections.filter((c) => c.status === 'ACTIVE');
    scopeLabels = r.scope_labels || {};
  }
  async function enterApps() {
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

  // ---------------------------------------------------------------- security
  function enterSecurity() {
    say('secMsg', ''); say('delMsg', '');
    $('envSwitch').href = LP.ENV === 'sandbox' ? '/account' : '/account?env=sandbox';
    $('envSwitchTitle').textContent = LP.ENV === 'sandbox' ? 'Passer au compte réel' : 'Ouvrir mon compte de test';
    $('envSwitchSub').textContent = LP.ENV === 'sandbox' ? 'Vous êtes dans l’environnement de test' : 'Pour essayer sans argent réel';
  }
  $('emailGo').addEventListener('click', () => guarded(async () => {
    const email = $('newEmail').value.trim();
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) return say('secMsg', 'Entrez une adresse e-mail valide.', 'err');
    await LP.updateIdentity({ email: email });
    $('newEmail').value = '';
    await loadMe().catch(() => {});
    say('secMsg', 'E-mail mis à jour.', 'ok');
  }, 'secMsg'));
  $('passGo').addEventListener('click', () => guarded(async () => {
    const password = $('newPass').value;
    if (password.length < 6) return say('secMsg', 'Mot de passe trop court (6 caractères minimum).', 'err');
    await LP.updateIdentity({ password: password });
    $('newPass').value = '';
    say('secMsg', 'Mot de passe mis à jour.', 'ok');
  }, 'secMsg'));
  $('signOut').addEventListener('click', () => { LP.signOut(); me = null; signIn(); });
  $('advancedMode').addEventListener('click', () => {
    try { localStorage.setItem('lightpay.mode', 'console'); } catch (e) {}
    location.assign('/account/console' + location.search + '#/home');
  });
  $('delConfirm').addEventListener('input', () => { $('delGo').disabled = $('delConfirm').value.trim() !== 'SUPPRIMER'; });
  $('delGo').addEventListener('click', () => guarded(async () => {
    $('delGo').disabled = true;
    try {
      await LP.api('DELETE', '/v1/me');
      await LP.deleteIdentity();
      showOnly(document.querySelector('[data-screen="bye"]'));
    } finally { $('delGo').disabled = $('delConfirm').value.trim() !== 'SUPPRIMER'; }
  }, 'delMsg'));

  // ---------------------------------------------------------------- navigation
  const nav = createNav({
    root: 'home',
    resolve: (route) => route.indexOf('apps/') === 0 ? ['app', route.slice(5)] : route.indexOf('activity/') === 0 ? ['activity-item', route.slice(9)] : [route.replace('/', '-'), null],
    onRootBack: () => { if (returnUrl) location.assign(returnUrl); },
    screens: {
      home: { enter: enterHome },
      deposit: { parent: 'home', enter: () => { say('depMsg', ''); renderDepFees(); } },
      send: { parent: 'home', enter: enterSend },
      'send-review': { parent: 'send', enter: enterSendReview },
      'send-done': { parent: 'home', enter: enterSendDone },
      withdraw: { parent: 'home', enter: enterWithdraw },
      'withdraw-review': { parent: 'withdraw', enter: enterWithdrawReview },
      'withdraw-done': { parent: 'home', enter: enterWithdrawDone },
      activity: { parent: 'home', enter: enterActivity },
      'activity-item': { parent: 'activity', enter: enterActivityItem },
      apps: { parent: 'home', enter: enterApps },
      app: { parent: 'apps', enter: enterApp },
      security: { parent: 'home', enter: enterSecurity },
    },
  });

  // Signed out: the sign-in screen (with a way back to the calling app when there is one).
  function signIn() { mountAuth(boot, returnUrl ? { onBack: () => location.assign(returnUrl) } : {}); }
  async function boot() {
    try { await loadMe(); nav.start(); }
    catch (e) { if (e.signIn) signIn(); else { nav.start(); say('homeMsg', e.message, 'err'); } }
  }
  if (LP.signedIn()) boot(); else signIn();
`;

  return shell({ title: 'Mon compte', nonce, env, body, script });
};
