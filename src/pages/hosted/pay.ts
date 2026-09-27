import { shell, topbar } from './shell.js';
import { iconSvg } from './icons.js';

/**
 * /pay/:id — hosted payment (or wallet top-up) page. States: loading → pay (mobile money or
 * LightPay wallet) → waiting (validate on the phone, polled) → done | closed. The back button
 * always leaves to the merchant (cancel_url), or to the account for a top-up.
 */
export const payPage = (nonce: string, sessionId: string, env: string) => {
  const body = `
<section class="screen" data-screen="loading">
  ${topbar({ title: 'Paiement', back: true, env })}
  <div class="state"><div class="spinner" aria-label="Chargement"></div></div>
</section>

<section class="screen" data-screen="pay" hidden>
  ${topbar({ title: 'Paiement', back: true, env })}
  <div class="content">
    <div class="row">
      <span class="avatar" id="merchantAvatar" aria-hidden="true"></span>
      <span class="row-main"><span class="row-title" id="merchant"></span><span class="row-sub" id="payee"></span></span>
    </div>
    <div class="hero mt">
      <div class="hero-label" id="amountLabel">Montant à payer</div>
      <div class="amount-xl" id="amount"></div>
      <div class="hero-sub" id="desc" hidden></div>
    </div>
    <div class="note" id="escrow" hidden>${iconSvg('shield')}<p>Paiement protégé : le vendeur n’est payé qu’une fois votre commande validée.</p></div>

    <div class="field" id="methodsBox" hidden><span class="label" id="methodsLabel">Payer avec</span>
      <div class="seg" role="group" aria-labelledby="methodsLabel">
        <button class="seg-opt" type="button" data-method="mobile_money" aria-pressed="true">${iconSvg('phone')}Mobile money</button>
        <button class="seg-opt" type="button" data-method="lightpay_wallet" aria-pressed="false">${iconSvg('wallet')}Wallet LightPay</button>
      </div>
    </div>

    <div id="momo" hidden>
      <div class="field"><span class="label" id="netLabel">Opérateur</span>
        <div class="seg" role="group" aria-labelledby="netLabel">
          <button class="seg-opt" type="button" data-net="MTN_MOMO_COG" aria-pressed="true">MTN MoMo</button>
          <button class="seg-opt" type="button" data-net="AIRTEL_COG" aria-pressed="false">Airtel Money</button>
        </div>
      </div>
      <div class="field"><label for="msisdn">Numéro de téléphone</label><div class="input-prefix"><span>+242</span><input id="msisdn" inputmode="tel" autocomplete="tel-national" placeholder="06 512 44 81" maxlength="16"></div><p class="hint">Vous validerez le paiement sur ce téléphone avec votre code secret.</p></div>
      <div class="fees" id="feeBox" hidden></div>
    </div>

    <div id="wallet" hidden>
      <ul class="list mt">
        <li><div class="row"><span class="avatar" id="walletAvatar" aria-hidden="true"></span><span class="row-main"><span class="row-title" id="walletWho"></span><span class="row-sub">Wallet LightPay</span></span><button class="link" type="button" id="walletSwitch">Changer</button></div></li>
        <li><div class="row"><span class="row-icon">${iconSvg('wallet')}</span><span class="row-main"><span class="row-title">Solde disponible</span></span><span class="row-end" id="walletBalance"></span></div></li>
      </ul>
      <div class="note warn" id="walletLow" hidden>${iconSvg('alert')}<p>Solde insuffisant. <a class="link" id="walletTopup" href="/account#/deposit">Recharger mon wallet</a> ou payez par mobile money.</p></div>
      <div class="fees" id="walletFees" hidden></div>
    </div>

    <div class="msg" id="msg" role="status" aria-live="polite"></div>
  </div>
  <div class="actions-bar">
    <button class="btn" type="button" id="payMomo" hidden>Payer</button>
    <button class="btn" type="button" id="payWallet" hidden>Payer avec mon wallet</button>
  </div>
</section>

<section class="screen" data-screen="waiting" hidden>
  ${topbar({ title: 'Validation', back: true, env })}
  <div class="state">
    <div class="spinner" aria-hidden="true"></div>
    <h2>Validez sur votre téléphone</h2>
    <p id="waitText"></p>
    <p class="small muted mt">Cette page se met à jour automatiquement.</p>
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
  let session = null, method = 'mobile_money', network = 'MTN_MOMO_COG', poll = null, lastAttemptAt = null, paidWithWallet = false, walletBalance = null;
  const accountUrl = (hash) => (LP.ENV === 'sandbox' ? '/account?env=sandbox' : '/account') + (hash || '');

  // Leaving always goes back to where the payer came from.
  function leave() {
    stop();
    if (session && session.cancel_url && session.status !== 'COMPLETED') return location.assign(session.cancel_url);
    if (session && session.status === 'COMPLETED' && session.return_url) return location.assign(session.return_url);
    if (session && session.kind === 'DEPOSIT') return location.assign(accountUrl());
    if (history.length > 1) return history.back();
    location.assign(accountUrl());
  }
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-back]'); if (b && !b.closest('#auth')) { e.preventDefault(); leave(); } });

  // ---------------------------------------------------------------- choices
  document.querySelectorAll('[data-net]').forEach((b) => b.addEventListener('click', () => {
    network = b.dataset.net;
    document.querySelectorAll('[data-net]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    renderFees();
  }));
  document.querySelectorAll('[data-method]').forEach((b) => b.addEventListener('click', () => {
    method = b.dataset.method;
    document.querySelectorAll('[data-method]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    say('msg', '');
    openMethod();
  }));

  function renderFees() {
    const q = session && session.fees && session.fees[network];
    if (!q) { $('feeBox').hidden = true; $('payMomo').textContent = 'Payer'; return; }
    const c = session.currency;
    const approx = q.estimated ? '≈ ' : '';
    feeRows($('feeBox'), [
      [session.kind === 'DEPOSIT' ? 'Recharge' : 'Montant', LP.money(q.amount, c)],
      ['Frais LightPay', LP.money(q.lightpay_fee, c)],
      ['Frais opérateur', q.operator_fee === '0' ? 'inclus' : approx + LP.money(q.operator_fee, c)],
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
    { method = 'mobile_money'; document.querySelectorAll('[data-method]').forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.method === 'mobile_money'))); }
    screen('pay'); openMethod();
  }
  $('walletSwitch').addEventListener('click', () => { LP.signOut(); mountAuth(openWallet, { title: 'Payer avec LightPay', onBack: backFromAuth }); });

  function openMethod() {
    const both = session.kind === 'PAYMENT' && session.methods.indexOf('mobile_money') >= 0 && session.methods.indexOf('lightpay_wallet') >= 0;
    if (!both) method = session.kind === 'DEPOSIT' || session.methods.indexOf('mobile_money') >= 0 ? 'mobile_money' : 'lightpay_wallet';
    $('methodsBox').hidden = !both;
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
    $('amountLabel').textContent = s.kind === 'DEPOSIT' ? 'Montant rechargé' : 'Montant à payer';
    $('amount').textContent = LP.money(s.amount, c);
    const d = s.kind === 'DEPOSIT' ? '' : [s.description, s.reference].filter(Boolean).join(' · ');
    $('desc').textContent = d; $('desc').hidden = !d;
    $('escrow').hidden = !s.escrow;
    const a = s.last_attempt;
    if (s.status === 'COMPLETED') {
      stop(); showDone(s);
    } else if (s.status === 'PROCESSING') {
      const total = a && a.charged ? LP.money(a.charged, c) : (s.fees && a && s.fees[a.network] ? (s.fees[a.network].estimated ? '≈ ' : '') + LP.money(s.fees[a.network].total, c) : '');
      $('waitText').textContent = 'Demande envoyée au ' + (a ? a.msisdn : 'numéro indiqué') + (total ? ' pour ' + total + ' (frais compris)' : '') + '. Composez votre code secret pour confirmer.';
      screen('waiting');
      start();
    } else if (s.status === 'OPEN') {
      const wasWaiting = !document.querySelector('[data-screen="waiting"]').hidden;
      stop();
      if (first || wasWaiting) { screen('pay'); openMethod(); }
      if (a && a.status === 'FAILED' && a.at !== lastAttemptAt) { lastAttemptAt = a.at; say('msg', failText(a.failure_code), 'err'); }
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
    if (s.return_url) {
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

  if (!id) { $('closedTitle').textContent = 'Lien invalide'; $('closedText').textContent = 'Ce lien de paiement est invalide.'; screen('closed'); }
  else load();
`;

  return shell({ title: 'Paiement', nonce, env, body, script });
};
