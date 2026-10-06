import { iconSvg } from './icons.js';

/**
 * The money screens shared by the account (/account) and the console (/account/console):
 * Dépôt, Envoyer, Retirer and their result screens, one code for both pages.
 *
 *   form -> confirmation bottom sheet -> result screen (waiting -> done | refused)
 *   The form never shows an error: its button stays off until the form is complete, and a
 *   refusal appears on the result screen. Every operation has an idempotency key, the sheet's
 *   button and the flow lock at the first tap.
 *
 * Each page frames the screens its own way (top bar on the account, scaffold in the console):
 *   frame({ screen, title, state, content, actions }) -> <section data-screen=…>
 * The page provides: me, loadMe(), cur(), available(), lim(key), guarded(action, msgId), nav,
 * fmtPhone(digits), signIn(); routes deposit · deposit/done · send · send/done · withdraw ·
 * withdraw/done, entered with renderDepFees()+focusAmount('depAmount') / enterDepositDone /
 * enterSend / enterSendDone / enterWithdraw / enterWithdrawDone.
 */
export type FlowFrame = (o: { screen: string; title: string; state: boolean; content: string; actions: string }) => string;

export const flowScreens = (frame: FlowFrame) =>
  [
  frame({ screen: 'deposit', title: 'Dépôt', state: false, content: `
    <label class="label" for="depAmount">Montant à déposer</label>
    <div class="amount-wrap"><input class="amount-input" id="depAmount" data-amount inputmode="numeric" autocomplete="off" placeholder="0"><div class="amount-cur" id="depMin">FCFA</div></div>
    <div class="field"><span class="label" id="depNetLabel">Payer avec</span>
      <div class="seg" role="group" aria-labelledby="depNetLabel">
        <button class="seg-opt" type="button" data-dep-net="MTN_MOMO_COG" aria-pressed="true"><span class="op-logo mtn" aria-hidden="true"></span>MTN MoMo</button>
        <button class="seg-opt" type="button" data-dep-net="AIRTEL_COG" aria-pressed="false"><span class="op-logo airtel" aria-hidden="true"></span>Airtel Money</button>
      </div>
    </div>
    <div class="field"><label for="depPhone">Numéro qui paie</label><div class="input-prefix"><span>+242</span><input id="depPhone" inputmode="tel" autocomplete="tel-national" placeholder="06 512 44 81" maxlength="16"></div></div>
    <div class="fees" id="depFees" hidden></div>
    <div class="msg" id="depMsg" role="status" aria-live="polite"></div>
    <div class="note">${iconSvg('info')}<p>Vous validerez le paiement sur votre téléphone. Le montant déposé est crédité dès la confirmation de l’opérateur.</p></div>`, actions: `<button class="btn" type="button" id="depGo" disabled>Déposer</button>` }),
  frame({ screen: 'deposit-done', title: 'Dépôt', state: true, content: `
<div class="state"><span class="state-icon" id="depDoneIcon"></span><h2 id="depDoneTitle"></h2><p id="depDoneText"></p></div>`, actions: `<button class="btn btn-secondary" type="button" id="depRetry" hidden>Réessayer</button><button class="btn" type="button" data-home>Terminé</button>` }),
  frame({ screen: 'send', title: 'Envoyer', state: false, content: `
    <div class="field"><label for="sendTo">Destinataire</label><input id="sendTo" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="@pseudo ou e-mail"><p class="hint" id="sendWho"></p></div>
    <label class="label mt-lg" for="sendAmount">Montant</label>
    <div class="amount-wrap"><input class="amount-input" id="sendAmount" data-amount inputmode="numeric" autocomplete="off" placeholder="0"><div class="amount-cur" id="sendAvail">FCFA</div></div>
    <div class="field"><label for="sendNote">Message (facultatif)</label><input id="sendNote" maxlength="140" autocomplete="off" placeholder="Ex. : loyer de mars"></div>
    <div class="msg" id="sendMsg" role="status" aria-live="polite"></div>
    <div class="note">${iconSvg('bolt')}<p>Gratuit et instantané entre comptes LightPay.</p></div>`, actions: `<button class="btn" type="button" id="sendNext">Continuer</button>` }),
  frame({ screen: 'send-done', title: 'Envoi', state: true, content: `
<div class="state"><span class="state-icon" id="sendDoneIcon"></span><h2 id="sendDoneTitle"></h2><p id="sendDoneText"></p></div>`, actions: `<button class="btn btn-secondary" type="button" id="sendRetry" hidden>Réessayer</button><button class="btn" type="button" data-home>Terminé</button>` }),
  frame({ screen: 'withdraw', title: 'Retirer', state: false, content: `
    <div class="field"><span class="label" id="wdNetLabel">Vers</span>
      <div class="seg" role="group" aria-labelledby="wdNetLabel">
        <button class="seg-opt" type="button" data-wd-net="MTN_MOMO_COG" aria-pressed="true"><span class="op-logo mtn" aria-hidden="true"></span>MTN MoMo</button>
        <button class="seg-opt" type="button" data-wd-net="AIRTEL_COG" aria-pressed="false"><span class="op-logo airtel" aria-hidden="true"></span>Airtel Money</button>
      </div>
    </div>
    <div class="field"><label for="wdPhone">Numéro qui reçoit</label><div class="input-prefix"><span>+242</span><input id="wdPhone" inputmode="tel" autocomplete="tel-national" placeholder="06 512 44 81" maxlength="16"></div></div>
    <label class="label mt-lg" for="wdAmount">Montant à recevoir</label>
    <div class="amount-wrap"><input class="amount-input" id="wdAmount" data-amount inputmode="numeric" autocomplete="off" placeholder="0"><div class="amount-cur" id="wdAvail">FCFA</div></div>
    <div class="fees" id="wdFees" hidden></div>
    <div class="msg" id="wdMsg" role="status" aria-live="polite"></div>
    <div class="section-head" id="wdListHead" hidden><h2>Derniers retraits</h2></div>
    <div id="wdList"></div>`, actions: `<button class="btn" type="button" id="wdNext" disabled>Continuer</button>` }),
  frame({ screen: 'withdraw-done', title: 'Retrait', state: true, content: `
<div class="state"><span class="state-icon" id="wdDoneIcon"></span><h2 id="wdDoneTitle"></h2><p id="wdDoneText"></p></div>`, actions: `<button class="btn btn-secondary" type="button" id="wdRetry" hidden>Réessayer</button><button class="btn" type="button" data-home>Terminé</button>` }),
  ].join('\n\n');

export const FLOWS_SCRIPT = `
  const WD_STATUS = { SUCCEEDED: ['ok', 'envoyé'], PENDING: ['warn', 'en cours'], FAILED: ['err', 'échoué · restitué'] };
  // ---------------------------------------------------------------- deposit
  // Amount, operator and the paying number are chosen here, once: confirming sends the request
  // to the phone straight away (no second payment page, no second choice).
  let depNet = 'MTN_MOMO_COG', depQuotes = null, depBusy = false, depState = null, depResult = null;
  const depPhone = () => digits($('depPhone').value).replace(/^242/, '');
  const pickDepNet = (net) => { depNet = net; document.querySelectorAll('[data-dep-net]').forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.depNet === net))); };
  document.querySelectorAll('[data-dep-net]').forEach((b) => b.addEventListener('click', () => {
    pickDepNet(b.dataset.depNet);
    const n = networkOf(depPhone());
    if (n && n !== depNet) { $('depPhone').value = ''; $('depPhone').focus(); }
    renderDepFees();
  }));
  $('depPhone').addEventListener('input', () => {
    const n = networkOf(depPhone());
    if (n && n !== depNet) pickDepNet(n);
    renderDepFees();
  });
  function renderDepFees() {
    const q = depQuotes && depQuotes[depNet];
    const amount = Number(amountDigits($('depAmount').value));
    $('depGo').disabled = true;
    $('depGo').textContent = 'Déposer';
    if (!amount) { $('depFees').hidden = true; $('depMin').classList.remove('below'); say('depMsg', ''); return; }
    // Below the minimum: no fees and no error, only the minimum highlighted (the button stays off).
    const min = q ? Number(q.minimum) : lim('deposit_min');
    $('depMin').classList.toggle('below', amount < min);
    if (amount < min) { $('depFees').hidden = true; say('depMsg', ''); return; }
    if (!q) return;
    const approx = q.estimated ? '≈ ' : '';
    feeRows($('depFees'), [
      ['Dépôt', LP.money(q.amount, cur())],
      ['Frais LightPay', LP.money(q.lightpay_fee, cur())],
      ['Frais opérateur', approx + LP.money(q.operator_fee, cur())],
      ['Total à payer', approx + LP.money(q.total, cur()), true],
    ]);
    $('depFees').hidden = false;
    say('depMsg', '');
    $('depGo').textContent = 'Déposer ' + approx + LP.money(q.total, cur());
    $('depGo').disabled = !(/^0[4-6]\\d{7}$/.test(depPhone()) && networkOf(depPhone()) === depNet);
  }
  const loadDepQuote = debounce(async () => {
    const amount = amountDigits($('depAmount').value);
    if (!amount) { depQuotes = null; renderDepFees(); return; }
    try { depQuotes = (await LP.api('GET', '/v1/me/deposits/quote?amount=' + amount)).quotes; renderDepFees(); }
    catch (e) { if (e.signIn) signIn(); else $('depFees').hidden = true; }
  }, 300);
  $('depAmount').addEventListener('input', () => {
    $('depGo').disabled = true;
    if (Number(amountDigits($('depAmount').value)) >= lim('deposit_min')) skRows($('depFees'), 4);
    loadDepQuote();
  });
  $('depGo').addEventListener('click', async () => {
    const q = depQuotes && depQuotes[depNet];
    if (depBusy || !q || $('depGo').disabled) return;
    const msisdn = depPhone(), approx = q.estimated ? '≈ ' : '';
    depBusy = true;
    const ok = await confirmSheet({
      title: 'Vous déposez',
      amount: approx + LP.money(q.total, cur()),
      rows: [
        ['Depuis', (depNet === 'MTN_MOMO_COG' ? 'MTN MoMo' : 'Airtel Money') + ' · +242 ' + fmtPhone(msisdn)],
        ['Sur votre wallet', LP.money(q.amount, cur())],
        ['Frais', approx + LP.money(String(Number(q.total) - Number(q.amount)), cur())],
      ],
      note: 'Une demande arrive sur ce téléphone : validez-la avec votre code secret.',
      confirm: 'Confirmer',
    });
    if (!ok) { depBusy = false; return; }
    depState = { amount: q.amount, total: approx + LP.money(q.total, cur()), msisdn: msisdn, network: depNet, key: LP.uuid() };
    depResult = null;
    nav.go('deposit/done');
    await operate('dep', async () => {
      const r = await LP.api('POST', '/v1/me/deposits', { amount: depState.amount }, depState.key);
      const res = await fetch('/v1/checkout/public/sessions/' + encodeURIComponent(r.session_id) + '/mobile-money', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msisdn: depState.msisdn, network: depState.network }), signal: deadline(30000),
      }).catch(() => { throw new Error('Connexion impossible. Vérifiez votre réseau et réessayez.'); });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Le dépôt n’a pas pu démarrer. Réessayez.');
      depState.session = r.session_id;
      $('depAmount').value = ''; depQuotes = null; renderDepFees();
      enterDepositDone();
      followDeposit(r.session_id);
    });
    depBusy = false;
  });
  $('depRetry').addEventListener('click', () => nav.go('deposit', true));
  const DEP_FAIL = { INSUFFICIENT_BALANCE: 'Solde insuffisant sur ce compte mobile money.', PAYER_DECLINED: 'Paiement refusé depuis le téléphone.', PAYER_TIMEOUT: 'Aucune validation reçue à temps sur le téléphone.' };
  function enterDepositDone() {
    if (depResult) return result('dep', depResult[0], depResult[1], depResult[2]);
    if (!depState) return nav.go('home', true);
    result('dep', 'wait', depState.session ? 'Validez sur votre téléphone' : 'Envoi de la demande',
      (depState.session ? 'Demande envoyée au +242 ' : 'Au +242 ') + fmtPhone(depState.msisdn) + ' pour ' + depState.total + ', frais compris.');
  }
  // The deposit is followed until the operator answers (the server closes it after a few minutes).
  let depFollow = null;
  function followDeposit(sessionId, tries = 0) {
    clearTimeout(depFollow);
    if (tries > 240 || !depState || depState.session !== sessionId) return;
    depFollow = setTimeout(async () => {
      try {
        const res = await fetch('/v1/checkout/public/sessions/' + encodeURIComponent(sessionId), { cache: 'no-store', signal: deadline(15000) });
        const s = res.ok ? (await res.json()).session : null;
        const a = s && s.last_attempt;
        if (s && s.status === 'COMPLETED') {
          depResult = ['ok', 'Dépôt reçu', LP.money(s.amount, cur()) + ' ajoutés à votre wallet LightPay.'];
          await loadMe().catch(() => {});
        } else if (s && (s.status === 'EXPIRED' || s.status === 'CANCELLED' || (s.status === 'OPEN' && a && a.status === 'FAILED'))) {
          depResult = ['err', 'Dépôt non effectué', (a && (DEP_FAIL[a.failure_code] || a.reason)) || 'L’opérateur n’a pas confirmé le paiement. Aucun argent n’a été pris.'];
        }
        if (depResult) { const c = nav.current(); if (c && c.name === 'deposit-done') enterDepositDone(); return; }
      } catch (e) { /* next try */ }
      followDeposit(sessionId, tries + 1);
    }, 2000);
  }

  // ---------------------------------------------------------------- result screens (waiting, done, refused)
  // Errors of an operation only ever show here, never on the form where it was typed.
  const RESULT = { wait: ['wait', 'clock'], ok: ['ok', 'check'], err: ['err', 'x'] };
  function result(prefix, kind, title, text) {
    $(prefix + 'DoneIcon').className = 'state-icon ' + RESULT[kind][0];
    $(prefix + 'DoneIcon').replaceChildren(icon(RESULT[kind][1]));
    $(prefix + 'DoneTitle').textContent = title;
    $(prefix + 'DoneText').textContent = text;
    $(prefix + 'Retry').hidden = kind !== 'err';
    document.querySelector('[data-screen="' + ({ wd: 'withdraw', send: 'send', dep: 'deposit' })[prefix] + '-done"] [data-home]').hidden = kind === 'wait';
  }
  // Runs the operation from its result screen: sign-in again if needed, any refusal shown there.
  async function operate(prefix, action) {
    await guarded(async () => {
      try { await action(); }
      catch (e) { if (e.reauth || e.signIn) throw e; result(prefix, 'err', ({ wd: 'Retrait non effectué', send: 'Envoi non effectué', dep: 'Dépôt non effectué' })[prefix], e.message); }
    }, prefix + 'DoneText');
  }

  // ---------------------------------------------------------------- send
  let sendState = null, sendResult = null, sendBusy = false;
  // The amount takes the keyboard as soon as its screen opens (after the slide, so it does not jump).
  const focusAmount = (id) => setTimeout(() => { const i = $(id); if (i && !i.closest('[hidden]')) i.focus(); }, 320);
  function enterSend() {
    $('sendAvail').textContent = 'FCFA · disponible ' + LP.money(available(), cur());
    say('sendMsg', '');
    sendCheck();
    focusAmount($('sendTo').value ? 'sendAmount' : 'sendTo');
  }
  let sendWho = null, sendWhoSeq = 0;
  const lookupRecipient = debounce(async () => {
    const to = $('sendTo').value.trim();
    const seq = ++sendWhoSeq;
    sendWho = null; $('sendWho').textContent = ''; $('sendWho').className = 'hint'; sendCheck();
    if (to.length < 3) return;
    try {
      const r = await LP.api('GET', '/v1/me/recipient?to=' + encodeURIComponent(to));
      if (seq !== sendWhoSeq) return;
      sendWho = r.recipient;
      $('sendWho').textContent = '→ ' + [r.recipient.name, r.recipient.username ? '@' + r.recipient.username : ''].filter(Boolean).join(' · ');
    } catch (e) {
      if (seq !== sendWhoSeq) return;
      if (e.signIn) return signIn();
      $('sendWho').textContent = 'Aucun compte LightPay trouvé.';
    } finally { if (seq === sendWhoSeq) sendCheck(); }
  }, 350);
  $('sendTo').addEventListener('input', lookupRecipient);
  // The button stays off until the form is complete: nothing to correct after the tap.
  function sendCheck() {
    const amount = Number(amountDigits($('sendAmount').value));
    $('sendAvail').classList.toggle('below', amount > available());
    $('sendNext').disabled = !sendWho || !amount || amount > available();
  }
  $('sendAmount').addEventListener('input', sendCheck);
  $('sendNext').addEventListener('click', async () => {
    if (sendBusy || $('sendNext').disabled) return;
    const amount = Number(amountDigits($('sendAmount').value));
    const w = sendWho || {};
    const who = [w.name, w.username ? '@' + w.username : ''].filter(Boolean).join(' · ') || $('sendTo').value.trim();
    const note = $('sendNote').value.trim();
    const rows = [['À', who], ['Frais', 'Aucun']].concat(note ? [['Message', note]] : []).concat([['Solde après envoi', LP.money(available() - amount, cur()), true]]);
    sendBusy = true;
    const ok = await confirmSheet({ title: 'Vous envoyez', amount: LP.money(amount, cur()), rows: rows, confirm: 'Envoyer' });
    if (!ok) { sendBusy = false; return; }
    sendState = { to: $('sendTo').value.trim(), who: w, amount: String(amount), note: note, key: LP.uuid() };
    sendResult = null;
    nav.go('send/done');
    await operate('send', async () => {
      const r = await LP.api('POST', '/v1/me/transfers', { to: sendState.to, amount: sendState.amount, note: sendState.note }, sendState.key);
      sendResult = r.transfer;
      $('sendTo').value = ''; $('sendAmount').value = ''; $('sendNote').value = ''; $('sendWho').textContent = ''; sendWho = null; sendCheck();
      await loadMe().catch(() => {});
      enterSendDone();
    });
    sendBusy = false;
  });
  $('sendRetry').addEventListener('click', () => nav.go('send', true));
  function enterSendDone() {
    if (sendResult) {
      const t = sendResult.to || {};
      return result('send', 'ok', 'Argent envoyé', LP.money(sendResult.amount, cur()) + ' envoyés à ' + (t.name || (t.username ? '@' + t.username : t.email)) + '.');
    }
    if (!sendState) return nav.go('home', true);
    result('send', 'wait', 'Envoi en cours', LP.money(sendState.amount, cur()) + ' vers ' + (sendState.who.username ? '@' + sendState.who.username : sendState.to) + '…');
  }

  // ---------------------------------------------------------------- withdraw
  let wdNet = 'MTN_MOMO_COG', wdQuote = null, wdState = null, wdResult = null, wdSeq = 0, wdBusy = false;
  const pickWdNet = (net) => { wdNet = net; document.querySelectorAll('[data-wd-net]').forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.wdNet === net))); };
  document.querySelectorAll('[data-wd-net]').forEach((b) => b.addEventListener('click', () => {
    pickWdNet(b.dataset.wdNet);
    // Another operator than the number typed: the number goes.
    const n = networkOf(digits($('wdPhone').value).replace(/^242/, ''));
    if (n && n !== wdNet) { $('wdPhone').value = ''; $('wdPhone').focus(); }
    loadWdQuote();
  }));
  function wdCheck() {
    const phone = digits($('wdPhone').value).replace(/^242/, '');
    const q = wdQuote;
    $('wdNext').disabled = true;
    // Below the minimum or above the balance: the line under the amount says it, the button stays off.
    const below = Boolean(q) && Number(q.amount) < Number(q.minimum);
    const tooMuch = Boolean(q) && !below && Number(q.total) > available();
    $('wdAvail').classList.toggle('below', below || tooMuch);
    if (!q) return;
    if (below) { $('wdFees').hidden = true; return; }
    if (tooMuch || !/^0[4-6]\\d{7}$/.test(phone) || networkOf(phone) !== wdNet) return;
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
    } catch (e) { if (e.signIn) signIn(); }
  }, 300);
  $('wdAmount').addEventListener('input', () => {
    $('wdNext').disabled = true;
    if (Number(amountDigits($('wdAmount').value)) >= lim('withdrawal_min')) skRows($('wdFees'), 4);
    loadWdQuote();
  });
  // The number picks its operator (06 MTN, 05/04 Airtel).
  $('wdPhone').addEventListener('input', () => {
    const n = networkOf(digits($('wdPhone').value).replace(/^242/, ''));
    if (n && n !== wdNet) { pickWdNet(n); loadWdQuote(); }
    wdCheck();
  });
  const wdAvailText = () => { $('wdAvail').textContent = 'FCFA · disponible ' + LP.money(available(), cur()) + ' · minimum ' + lim('withdrawal_min').toLocaleString('fr-FR'); };
  async function enterWithdraw() {
    focusAmount('wdAmount');
    // Minimums and balance as they are now (the admin may have changed them since the page opened).
    loadMe().then(() => { wdAvailText(); wdCheck(); }).catch(() => {});
    $('wdAvail').textContent = 'FCFA · disponible ' + LP.money(available(), cur()) + ' · minimum ' + lim('withdrawal_min').toLocaleString('fr-FR');
    wdCheck();
    if (!$('wdList').children.length) { $('wdListHead').hidden = false; skeleton($('wdList'), 3, 'div'); }
    try {
      const r = await LP.api('GET', '/v1/me/withdrawals');
      $('wdListHead').hidden = !r.withdrawals.length;
      $('wdList').replaceChildren.apply($('wdList'), r.withdrawals.slice(0, 5).map((w) => {
        const st = WD_STATUS[w.status] || ['', w.status];
        const more = w.total && Number(w.total) > Number(w.amount);
        return txRow({ icon: w.status === 'FAILED' ? 'x' : 'withdraw', amount: '−' + LP.money(more ? w.total : w.amount, w.currency), desc: 'Vers ' + w.to + (more ? ' · ' + LP.money(w.amount, w.currency) + ' reçus' : ''), end: w.status === 'SUCCEEDED' ? shortDay(w.created_at) : st[1], cls: w.status === 'FAILED' ? 'void' : w.status === 'PENDING' ? 'wait' : '' });
      }));
    } catch (e) { $('wdList').replaceChildren(); $('wdListHead').hidden = true; /* history is optional */ }
  }
  $('wdNext').addEventListener('click', async () => {
    if (wdBusy || !wdQuote || $('wdNext').disabled) return;
    const q = wdQuote;
    const msisdn = digits($('wdPhone').value).replace(/^242/, '');
    wdBusy = true;
    const ok = await confirmSheet({
      title: 'Vous retirez',
      amount: LP.money(q.amount, q.currency),
      rows: [
        ['Vers', (wdNet === 'MTN_MOMO_COG' ? 'MTN MoMo' : 'Airtel Money') + ' · +242 ' + fmtPhone(msisdn)],
        ['Frais opérateur', LP.money(q.operator_fee, q.currency)],
        ['Frais LightPay', LP.money(q.lightpay_fee, q.currency)],
        ['Total débité', LP.money(q.total, q.currency), true],
        ['Solde après retrait', LP.money(available() - Number(q.total), q.currency)],
      ],
      confirm: 'Retirer',
    });
    if (!ok) { wdBusy = false; return; }
    wdState = { quote: q, network: wdNet, msisdn: msisdn, key: LP.uuid() };
    wdResult = null;
    nav.go('withdraw/done');
    await operate('wd', async () => {
      const r = await LP.api('POST', '/v1/me/withdrawals', { amount: wdState.quote.amount, msisdn: wdState.msisdn, network: wdState.network }, wdState.key);
      wdResult = r.withdrawal;
      wdQuote = null;
      $('wdAmount').value = ''; renderWdFees(); wdCheck();
      await loadMe().catch(() => {});
      enterWithdrawDone();
    });
    wdBusy = false;
  });
  $('wdRetry').addEventListener('click', () => nav.go('withdraw', true));
  function enterWithdrawDone() {
    if (!wdResult) {
      if (!wdState) return nav.go('home', true);
      return result('wd', 'wait', 'Retrait en cours', 'Envoi de ' + LP.money(wdState.quote.amount, wdState.quote.currency) + ' vers +242 ' + fmtPhone(wdState.msisdn) + '…');
    }
    const w = wdResult;
    if (w.status === 'FAILED') result('wd', 'err', 'Retrait échoué', (w.reason || 'L’opérateur a refusé l’envoi.') + ' Les ' + LP.money(w.total, w.currency) + ' ont été restitués sur votre wallet.');
    else if (w.status === 'SUCCEEDED') result('wd', 'ok', 'Retrait envoyé', LP.money(w.amount, w.currency) + ' vers ' + w.to + '. Vous allez recevoir un SMS de votre opérateur.');
    else { result('wd', 'wait', 'Retrait en cours', LP.money(w.amount, w.currency) + ' vers ' + w.to + ' : l’opérateur traite l’envoi, vous recevrez un SMS.'); followWithdrawal(w.id); }
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

`;
