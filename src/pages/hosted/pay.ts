import { shell, skeletonScreen, topbar } from './shell.js';
import { iconSvg } from './icons.js';

/** Payment screen: merchant and amount on top, the ways to pay as cards side by side, one summary, one button. */
const PAY_CSS = `
.pay-head { display: flex; align-items: center; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid var(--line); }
.pay-head .row-main { flex: 1; min-width: 0; }
.pay-total { font-size: 20px; font-weight: 750; letter-spacing: -.01em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pay-desc { margin-top: 14px; font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
.quiet { display: flex; gap: 8px; align-items: flex-start; margin-top: 10px; font-size: 13px; color: var(--muted); line-height: 1.45; }
.quiet svg { width: 16px; height: 16px; flex-shrink: 0; margin-top: 1px; }
.quiet.warn { color: var(--warn); }
.methods { margin-top: 20px; }
.opts { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 10px; }
.opt { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; min-width: 0; padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--line-strong); background: var(--card); color: inherit; text-align: left; transition: border-color .15s, background .15s, box-shadow .15s; }
.opt:hover { border-color: var(--faint); }
.opt[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent); }
.opt b { display: block; font-size: 14px; font-weight: 600; line-height: 1.25; }
.opt small { display: block; margin-top: 2px; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.op-logo { width: 30px; height: 30px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; }
.op-logo.mtn { background: #ffcb05; color: #111111; }
.op-logo.airtel { background: #e40000; color: #ffffff; }
.op-logo.lp { background: var(--raised); color: var(--text); border: 1px solid var(--line); }
.op-logo svg { width: 16px; height: 16px; }
@media (max-width: 360px) { .opts { grid-auto-flow: row; grid-template-columns: 1fr 1fr; } }
.fees { border: 0; }
.input-prefix input:-webkit-autofill { -webkit-box-shadow: 0 0 0 40px var(--card) inset; -webkit-text-fill-color: var(--text); }
.secure { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 10px 0 0; font-size: 12px; color: var(--faint); }
.secure svg { width: 13px; height: 13px; }
.state .secure { margin-top: 24px; }
.phone-ring { position: relative; width: 104px; height: 104px; border-radius: 999px; background: var(--raised); display: flex; align-items: center; justify-content: center; }
.phone-ring::after { content: ''; position: absolute; inset: 8px; border-radius: 999px; border: 2px solid transparent; border-top-color: var(--accent); animation: spin 1.4s linear infinite; }
.phone-ring span { width: 56px; height: 56px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); display: flex; align-items: center; justify-content: center; }
.phone-ring svg { width: 24px; height: 24px; }
.steps { list-style: none; margin: 20px 0 0; padding: 0; display: grid; gap: 12px; text-align: left; }
.steps li { display: flex; align-items: center; gap: 12px; font-size: 14px; }
.steps li span { width: 24px; height: 24px; flex-shrink: 0; border-radius: 999px; background: var(--raised); color: var(--muted); display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }
.state .btn-inline { width: auto; min-width: 160px; margin-top: 20px; padding: 0 28px; }
@media (prefers-reduced-motion: reduce) { .phone-ring::after { animation-duration: 3s; } }
`;

/**
 * /pay/:id — hosted payment (or wallet top-up) page. States: loading → pay (mobile money or
 * LightPay wallet) → waiting (validate on the phone, polled) → done | closed. The back button
 * always leaves to the merchant (cancel_url), or to the account for a top-up.
 *
 * `embedOrigin`: shown in the app's dialog (lightpay.js). Leaving or finishing tells the app
 * (postMessage to that origin only) instead of navigating; the wallet payment (sign-in included)
 * happens right in the dialog.
 */
export const payPage = (nonce: string, sessionId: string, env: string, mode: { embedOrigin?: string | null } = {}) => {
  const body = `
<section class="screen" data-screen="loading">
  ${topbar({ title: 'Paiement', back: true, env })}
  ${skeletonScreen()}
</section>

<section class="screen" data-screen="pay" hidden>
  ${topbar({ title: 'Paiement', back: true, env })}
  <div class="content">
    <div class="pay-head">
      <span class="avatar" id="merchantAvatar" aria-hidden="true"></span>
      <span class="row-main"><span class="row-title" id="merchant"></span><span class="row-sub" id="payee"></span></span>
      <span class="pay-total" id="amount"></span>
    </div>
    <div class="pay-desc" id="desc" hidden></div>
    <p class="quiet" id="escrow" hidden>${iconSvg('shield')}<span>Paiement protégé : le vendeur n’est payé qu’une fois votre commande validée.</span></p>

    <div class="methods" id="methodsBox" hidden>
      <div class="label">Moyen de paiement</div>
      <div class="opts" role="group" aria-label="Moyen de paiement">
        <button class="opt" type="button" data-pick="MTN_MOMO_COG" aria-pressed="true"><span class="op-logo mtn" aria-hidden="true">M</span><span><b>MTN MoMo</b><small data-fee="MTN_MOMO_COG"></small></span></button>
        <button class="opt" type="button" data-pick="AIRTEL_COG" aria-pressed="false"><span class="op-logo airtel" aria-hidden="true">A</span><span><b>Airtel Money</b><small data-fee="AIRTEL_COG"></small></span></button>
        <button class="opt" type="button" data-pick="lightpay_wallet" aria-pressed="false"><span class="op-logo lp" aria-hidden="true">${iconSvg('wallet')}</span><span><b>Wallet LightPay</b><small>Sans frais</small></span></button>
      </div>
    </div>

    <div id="momo" hidden>
      <div class="field"><label for="msisdn">Numéro de téléphone</label><div class="input-prefix"><span>+242</span><input id="msisdn" inputmode="tel" autocomplete="tel-national" placeholder="06 512 44 81" maxlength="16"></div><p class="hint">Vous validerez le paiement sur ce téléphone avec votre code secret.</p></div>
      <div class="fees" id="feeBox" hidden></div>
    </div>
    <div id="wallet" hidden>
      <ul class="list mt">
        <li><div class="row"><span class="avatar" id="walletAvatar" aria-hidden="true"></span><span class="row-main"><span class="row-title" id="walletWho"></span><span class="row-sub">Wallet LightPay</span></span><button class="link" type="button" id="walletSwitch">Changer</button></div></li>
        <li><div class="row"><span class="row-main"><span class="row-title">Solde disponible</span></span><span class="row-end" id="walletBalance"></span></div></li>
      </ul>
      <p class="quiet warn" id="walletLow" hidden>${iconSvg('alert')}<span>Solde insuffisant. <a class="link" id="walletTopup" href="/account#/deposit">Recharger mon wallet</a> ou payez par mobile money.</span></p>
      <div class="fees" id="walletFees" hidden></div>
    </div>

    <div class="msg" id="msg" role="status" aria-live="polite"></div>
  </div>
  <div class="actions-bar">
    <button class="btn" type="button" id="payMomo" hidden>Payer</button>
    <button class="btn" type="button" id="payWallet" hidden>Payer avec mon wallet</button>
    <p class="secure">${iconSvg('lock')}Paiement sécurisé par LightPay</p>
  </div>
</section>

<section class="screen" data-screen="waiting" hidden>
  ${topbar({ title: 'Validation', back: true, env })}
  <div class="state">
    <div class="phone-ring" aria-hidden="true"><span>${iconSvg('phone')}</span></div>
    <h2>Confirmez sur votre téléphone</h2>
    <p id="waitText"></p>
    <ol class="steps">
      <li><span>1</span>Ouvrez la demande reçue sur votre téléphone</li>
      <li><span>2</span>Composez votre code secret</li>
      <li><span>3</span>Cette page se met à jour toute seule</li>
    </ol>
    <p class="secure">${iconSvg('lock')}Paiement sécurisé par LightPay</p>
  </div>
</section>

<section class="screen" data-screen="failed" hidden>
  ${topbar({ title: 'Paiement', back: true, env })}
  <div class="state">
    <span class="state-icon err">${iconSvg('x')}</span>
    <h2>Paiement échoué</h2>
    <p id="failedText"></p>
    <button class="btn btn-inline" type="button" id="retry">Réessayer</button>
    <p class="secure">${iconSvg('lock')}Paiement sécurisé par LightPay</p>
  </div>
</section>

<section class="screen" data-screen="done" hidden>
  ${topbar({ title: 'Reçu', back: true, env })}
  <div class="content">
    <div class="state"><span class="state-icon ok">${iconSvg('check')}</span><h2 id="doneTitle">Paiement confirmé</h2><p id="doneText"></p></div>
    <div class="receipt" id="doneRows"></div>
  </div>
  <div class="actions-bar"><a class="btn" id="doneBack" href="/account">Retour au site</a></div>
</section>

<section class="screen" data-screen="closed" hidden>
  ${topbar({ title: 'Paiement', back: true, env })}
  <div class="state"><span class="state-icon err">${iconSvg('x')}</span><h2 id="closedTitle">Paiement indisponible</h2><p id="closedText"></p></div>
  <div class="actions-bar"><button class="btn btn-secondary" type="button" data-back>Retour</button></div>
</section>`;

  const script = `
  const id = ${JSON.stringify(sessionId)};
  const MODE = { embed: ${JSON.stringify(mode.embedOrigin ?? null)} };
  // In the app's dialog: tell the app (its origin only) that the payer is done or left.
  const tell = (type) => { if (MODE.embed) window.parent.postMessage({ source: 'lightpay', type: type, session: id }, MODE.embed); };
  const screen = (name) => showOnly(document.querySelector('[data-screen="' + name + '"]'));
  const FAIL = {
    INSUFFICIENT_BALANCE: 'Solde insuffisant sur ce compte mobile money.',
    PAYER_DECLINED: 'Paiement refusé depuis le téléphone.',
    PAYER_TIMEOUT: 'Aucune confirmation reçue à temps. Réessayez.',
    PROVIDER_FAILED: 'Paiement refusé par l’opérateur : solde insuffisant, code secret incorrect ou validation non faite à temps. Vérifiez votre solde, puis réessayez.',
    PROVIDER_CANCELLED: 'Paiement annulé depuis le téléphone.',
    PROVIDER_EXPIRED: 'La demande a expiré sans validation. Réessayez.',
  };
  const failText = (code) => FAIL[code] || (code && code.indexOf('PROVIDER_') === 0 ? 'L’opérateur a refusé ce paiement (' + code.slice(9).toLowerCase().replace(/_/g, ' ') + '). Réessayez ou changez de numéro.' : 'Le paiement a échoué. Réessayez.');
  const NET_NAME = { MTN_MOMO_COG: 'MTN MoMo', AIRTEL_COG: 'Airtel Money' };
  // false: the person signed in on the app has no LightPay wallet, so only mobile money is offered.
  let payerHasWallet = null;
  let session = null, method = 'mobile_money', network = 'MTN_MOMO_COG', poll = null, lastAttemptAt = null, paidWithWallet = false, walletBalance = null;
  const accountUrl = (hash) => (LP.ENV === 'sandbox' ? '/account?env=sandbox' : '/account') + (hash || '');

  // Leaving always goes back to where the payer came from.
  function leave() {
    stop();
    if (MODE.embed) return tell(session && session.status === 'COMPLETED' ? 'completed' : 'closed');
    if (session && session.cancel_url && session.status !== 'COMPLETED') return location.assign(session.cancel_url);
    if (session && session.status === 'COMPLETED' && session.return_url) return location.assign(session.return_url);
    if (session && session.kind === 'DEPOSIT') return location.assign(accountUrl());
    if (history.length > 1) return history.back();
    location.assign(accountUrl());
  }
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-back]'); if (b && !b.closest('#auth')) { e.preventDefault(); leave(); } });

  // ---------------------------------------------------------------- choices
  // One choice: an operator (mobile money) or the LightPay wallet.
  const picked = () => (method === 'mobile_money' ? network : 'lightpay_wallet');
  const sync = () => document.querySelectorAll('[data-pick]').forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.pick === picked())));
  document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    const was = method;
    if (b.dataset.pick === 'lightpay_wallet') method = 'lightpay_wallet';
    else { method = 'mobile_money'; network = b.dataset.pick; }
    sync();
    say('msg', '');
    if (method !== was) openMethod(); else renderFees();
  }));

  function renderFees() {
    const q = session && session.fees && session.fees[network];
    if (!q) { $('feeBox').hidden = true; $('payMomo').textContent = 'Payer'; return; }
    const c = session.currency;
    const approx = q.estimated ? '≈ ' : '';
    feeRows($('feeBox'), [
      [session.kind === 'DEPOSIT' ? 'Recharge' : 'Montant', LP.money(q.amount, c)],
      ['Frais', approx + '+' + LP.money(String(Number(q.total) - Number(q.amount)), c)],
      ['Total à payer', approx + LP.money(q.total, c), true],
    ]);
    $('feeBox').hidden = false;
    const tooSmall = Number(q.amount) < Number(q.minimum);
    $('payMomo').disabled = tooSmall;
    $('payMomo').textContent = tooSmall ? 'Minimum ' + LP.money(q.minimum, c) + ' par mobile money' : 'Payer ' + approx + LP.money(q.total, c);
  }

  async function openWallet() {
    screen('pay');
    $('momo').hidden = true; $('payMomo').hidden = true;
    try {
      const me = await LP.api('GET', '/v1/me');
      walletBalance = Number(me.wallet.available_balance);
      const who = me.user.name || me.user.email || '';
      $('walletAvatar').textContent = initials(who);
      $('walletWho').textContent = who;
      $('walletBalance').textContent = LP.money(me.wallet.available_balance, session.currency);
      const low = walletBalance < Number(session.amount);
      $('walletLow').hidden = !low;
      $('walletTopup').href = accountUrl('#/deposit');
      // The account never opens inside the app's dialog: a LightPay tab instead.
      if (MODE.embed) { $('walletTopup').target = '_blank'; $('walletTopup').rel = 'noopener'; }
      feeRows($('walletFees'), [['Montant', LP.money(session.amount, session.currency)], ['Frais', 'Aucun'], ['Total débité', LP.money(session.amount, session.currency), true]]);
      $('walletFees').hidden = false;
      $('wallet').hidden = false;
      $('payWallet').hidden = false;
      $('payWallet').disabled = low;
    } catch (e) {
      if (e.signIn) mountAuth(openWallet, { title: 'Payer avec LightPay', subtitle: 'Connectez-vous pour payer avec votre wallet.', onBack: backFromAuth });
      else say('msg', e.message, 'err');
    }
  }
  function backFromAuth() {
    // Wallet-only payment: nothing else to show, leaving is the only way back.
    if (session.methods.indexOf('mobile_money') < 0 || session.kind !== 'PAYMENT') return leave();
    method = 'mobile_money';
    screen('pay'); openMethod();
  }
  $('walletSwitch').addEventListener('click', () => { LP.signOut(); mountAuth(openWallet, { title: 'Payer avec LightPay', onBack: backFromAuth }); });

  function openMethod() {
    const both = session.kind === 'PAYMENT' && session.methods.indexOf('mobile_money') >= 0 && session.methods.indexOf('lightpay_wallet') >= 0 && payerHasWallet !== false;
    if (!both) method = session.kind === 'DEPOSIT' || session.methods.indexOf('mobile_money') >= 0 ? 'mobile_money' : 'lightpay_wallet';
    // Only the ways this session accepts are offered; each operator card shows its fees.
    $('methodsBox').hidden = false;
    document.querySelectorAll('[data-pick]').forEach((o) => { o.hidden = (o.dataset.pick === 'lightpay_wallet') !== (method === 'lightpay_wallet') && !both; });
    document.querySelectorAll('[data-fee]').forEach((f) => {
      const q = session.fees && session.fees[f.dataset.fee];
      f.textContent = q ? (q.estimated ? '≈ ' : '') + '+' + LP.money(String(Number(q.total) - Number(q.amount)), session.currency) + ' de frais' : '';
    });
    sync();
    if (method === 'mobile_money') {
      $('wallet').hidden = true; $('payWallet').hidden = true;
      $('momo').hidden = false; $('payMomo').hidden = false;
      renderFees();
    } else {
      if (LP.signedIn()) openWallet();
      else mountAuth(openWallet, { title: 'Payer avec LightPay', subtitle: 'Connectez-vous pour payer avec votre wallet.', onBack: backFromAuth });
    }
  }

  // ---------------------------------------------------------------- session states
  function render(s) {
    const first = !session;
    session = s;
    const c = s.currency;
    $('merchantAvatar').textContent = initials(s.kind === 'DEPOSIT' ? 'LightPay' : s.merchant);
    $('merchant').textContent = s.kind === 'DEPOSIT' ? 'Recharge LightPay' : s.merchant;
    $('payee').textContent = s.kind === 'DEPOSIT' ? 'Votre wallet' : (s.payee ? 'Vendeur : ' + s.payee : 'Paiement sécurisé');
    $('amount').textContent = LP.money(s.amount, c);
    const d = s.kind === 'DEPOSIT' ? '' : [s.description, s.reference].filter(Boolean).join(' · ');
    $('desc').textContent = d; $('desc').hidden = !d;
    $('escrow').hidden = !s.escrow;
    const a = s.last_attempt;
    if (s.status === 'COMPLETED') {
      stop(); showDone(s);
    } else if (s.status === 'PROCESSING') {
      const total = a && a.charged ? LP.money(a.charged, c) : (s.fees && a && s.fees[a.network] ? (s.fees[a.network].estimated ? '≈ ' : '') + LP.money(s.fees[a.network].total, c) : '');
      $('waitText').textContent = 'Demande envoyée au ' + (a ? a.msisdn : 'numéro indiqué') + (total ? ' pour ' + total + ', frais compris' : '') + '.';
      screen('waiting');
      start();
    } else if (s.status === 'OPEN') {
      const wasWaiting = !document.querySelector('[data-screen="waiting"]').hidden;
      stop();
      const failedNow = a && a.status === 'FAILED' && a.at !== lastAttemptAt;
      if (failedNow && wasWaiting) { lastAttemptAt = a.at; $('failedText').textContent = failText(a.failure_code); screen('failed'); }
      else {
        if (first || wasWaiting) { screen('pay'); openMethod(); }
        if (failedNow) { lastAttemptAt = a.at; say('msg', failText(a.failure_code), 'err'); }
      }
    } else {
      stop();
      $('closedTitle').textContent = s.status === 'EXPIRED' ? 'Paiement expiré' : 'Paiement annulé';
      $('closedText').textContent = 'Revenez sur le site du marchand pour relancer votre commande.';
      screen('closed');
    }
    if (first && s.status === 'OPEN' && a && a.status === 'FAILED') lastAttemptAt = a.at;
  }

  function showDone(s) {
    const c = s.currency, a = s.last_attempt;
    $('doneTitle').textContent = s.kind === 'DEPOSIT' ? 'Wallet rechargé' : 'Paiement confirmé';
    const rows = [[s.kind === 'DEPOSIT' ? 'Recharge' : 'Montant', LP.money(s.amount, c)]];
    if (!paidWithWallet && a && a.status === 'SUCCEEDED') {
      rows.push(['Frais LightPay', LP.money(a.lightpay_fee, c)]);
      if (a.operator_fee) rows.push(['Frais opérateur', LP.money(a.operator_fee, c)]);
      rows.push(['Payé avec', (NET_NAME[a.network] || 'Mobile money') + ' · ' + a.msisdn]);
      if (a.charged) rows.push(['Total débité', LP.money(a.charged, c), true]);
    } else if (paidWithWallet) {
      rows.push(['Payé avec', 'Wallet LightPay'], ['Total débité', LP.money(s.amount, c), true]);
    }
    if (s.reference) rows.splice(1, 0, ['Référence', s.reference]);
    feeRows($('doneRows'), rows);
    const back = $('doneBack');
    if (MODE.embed) {
      back.href = '#'; back.textContent = 'Terminer';
      back.addEventListener('click', (e) => { e.preventDefault(); tell('completed'); });
      $('doneText').textContent = 'Paiement confirmé. Vous revenez sur le site dans un instant.';
      setTimeout(() => tell('completed'), 2500);
    } else if (s.return_url) {
      back.href = s.return_url; back.textContent = 'Retour au site';
      $('doneText').textContent = 'Vous allez être redirigé vers le site du marchand.';
      setTimeout(() => location.assign(s.return_url), 3500);
    } else if (s.kind === 'DEPOSIT') {
      back.href = accountUrl(); back.textContent = 'Retour à mon compte';
      $('doneText').textContent = LP.money(s.amount, c) + ' ont été ajoutés à votre wallet LightPay.';
    } else {
      back.href = accountUrl(); back.textContent = 'Voir mon compte LightPay';
      $('doneText').textContent = 'Vous pouvez fermer cette page.';
    }
    screen('done');
  }

  const load = async () => {
    const res = await fetch('/v1/checkout/public/sessions/' + encodeURIComponent(id), { cache: 'no-store' }).catch(() => null);
    if (!res || !res.ok) {
      if (session) return; // transient network error while polling: keep the current state
      stop(); $('closedTitle').textContent = 'Lien invalide'; $('closedText').textContent = 'Ce lien de paiement est invalide ou a expiré.'; screen('closed'); return;
    }
    render((await res.json()).session);
  };
  const start = () => { if (!poll) poll = setInterval(load, 2000); };
  const stop = () => { clearInterval(poll); poll = null; };

  // ---------------------------------------------------------------- pay
  $('payMomo').addEventListener('click', async () => {
    const msisdn = digits($('msisdn').value).replace(/^242/, '');
    if (!/^0[4-6]\\d{7}$/.test(msisdn)) return say('msg', 'Entrez un numéro à 9 chiffres, par exemple 06 512 44 81.', 'err');
    $('payMomo').disabled = true; say('msg', '');
    try {
      const res = await fetch('/v1/checkout/public/sessions/' + encodeURIComponent(id) + '/mobile-money', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msisdn: msisdn, network: network }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return say('msg', body.message || 'Le paiement n’a pas pu démarrer.', 'err');
      await load();
    } catch (e) { say('msg', 'Connexion impossible. Vérifiez votre réseau et réessayez.', 'err'); }
    finally { if (session && session.status === 'OPEN') renderFees(); else $('payMomo').disabled = false; }
  });
  $('payWallet').addEventListener('click', async () => {
    $('payWallet').disabled = true; say('msg', '');
    try {
      const r = await LP.api('POST', '/v1/checkout/public/sessions/' + encodeURIComponent(id) + '/wallet');
      paidWithWallet = true;
      render(r.session);
    } catch (e) {
      if (e.signIn) mountAuth(openWallet, { title: 'Payer avec LightPay', onBack: backFromAuth });
      else say('msg', e.message, 'err');
    } finally { $('payWallet').disabled = walletBalance !== null && walletBalance < Number(session.amount); }
  });

  // The app's page hands over the payer's current sign-in (lightpay.js, from the declared site only).
  window.addEventListener('message', (e) => {
    if (!MODE.embed || e.origin !== MODE.embed || e.source !== window.parent) return;
    const d = e.data || {};
    if (d.source !== 'lightpay-app' || d.type !== 'identity' || d.session !== id || typeof d.idToken !== 'string') return;
    if (!LP.lend(d.idToken)) return;
    LP.api('GET', '/v1/checkout/public/sessions/' + encodeURIComponent(id) + '/payer').then((r) => {
      payerHasWallet = Boolean(r.has_wallet);
      // No LightPay account: the wallet is not offered, the payer simply pays by mobile money.
      if (session && session.status === 'OPEN' && !document.querySelector('[data-screen="pay"]').hidden) openMethod();
      else if (session && session.status === 'OPEN' && method === 'lightpay_wallet') { screen('pay'); openMethod(); }
    }).catch(() => {});
  });

  $('retry').addEventListener('click', () => { say('msg', ''); screen('pay'); openMethod(); });

  tell('ready');
  if (!id) { $('closedTitle').textContent = 'Lien invalide'; $('closedText').textContent = 'Ce lien de paiement est invalide.'; screen('closed'); }
  else load();
`;

  return shell({ title: 'Paiement', nonce, env, body, script, css: PAY_CSS });
};
