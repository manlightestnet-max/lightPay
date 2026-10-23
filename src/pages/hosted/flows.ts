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
 * signIn(); countries, operators and numbers come from the shared client (RAILS, loadRails…); with several wallets
 * (me.wallets) each form asks which one, starting from flowWallet (set by a wallet's own screen); routes deposit · deposit/done · send · send/done · withdraw ·
 * withdraw/done · move · move/done (between my wallets, enterMove / enterMoveDone), entered with enterDeposit / enterDepositDone /
 * enterSend / enterSendDone / enterWithdraw / enterWithdrawDone.
 */
export type FlowFrame = (o: { screen: string; title: string; state: boolean; content: string; actions: string }) => string;

export const flowScreens = (frame: FlowFrame) =>
  [
  frame({ screen: 'deposit', title: 'Dépôt', state: false, content: `
    <div class="field" id="depWalletField" hidden><span class="label" id="depWalletLabel">Sur le wallet</span><div class="seg" role="group" aria-labelledby="depWalletLabel" id="depWallets"></div></div>
    <label class="label" for="depAmount">Montant à déposer</label>
    <div class="amount-wrap"><input class="amount-input" id="depAmount" data-amount inputmode="numeric" autocomplete="off" placeholder="0"><div class="amount-cur" id="depMin">FCFA</div></div>
    <div class="field" id="depCountryField" hidden><span class="label" id="depCountryLabel">Pays</span><div class="seg" role="group" aria-labelledby="depCountryLabel" id="depCountries"></div></div>
    <div class="field"><span class="label" id="depNetLabel">Payer avec</span><div class="seg" role="group" aria-labelledby="depNetLabel" id="depNets"></div></div>
    <div class="field"><label for="depPhone">Numéro qui paie</label><div class="input-prefix"><span id="depDial">+242</span><input id="depPhone" inputmode="tel" autocomplete="tel-national" placeholder="06 512 44 81" maxlength="18"></div></div>
    <div class="fees" id="depFees" hidden></div>
    <div class="msg" id="depMsg" role="status" aria-live="polite"></div>
    <div class="note">${iconSvg('info')}<p>Vous validerez le paiement sur votre téléphone. Le montant déposé est crédité dès la confirmation de l’opérateur.</p></div>`, actions: `<button class="btn" type="button" id="depGo" disabled>Déposer</button>` }),
  frame({ screen: 'deposit-done', title: 'Dépôt', state: true, content: `
<div class="state"><span class="state-icon" id="depDoneIcon"></span><h2 id="depDoneTitle"></h2><p id="depDoneText"></p></div>`, actions: `<button class="btn btn-secondary" type="button" id="depRetry" hidden>Réessayer</button><button class="btn" type="button" data-home>Terminé</button>` }),
  frame({ screen: 'send', title: 'Envoyer', state: false, content: `
    <div class="field" id="sendWalletField" hidden><span class="label" id="sendWalletLabel">Depuis</span><div class="seg" role="group" aria-labelledby="sendWalletLabel" id="sendWallets"></div></div>
    <div class="field"><label for="sendTo">Destinataire</label><input id="sendTo" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="@pseudo ou e-mail"><p class="hint" id="sendWho"></p></div>
    <label class="label mt-lg" for="sendAmount">Montant</label>
    <div class="amount-wrap"><input class="amount-input" id="sendAmount" data-amount inputmode="numeric" autocomplete="off" placeholder="0"><div class="amount-cur" id="sendAvail">FCFA</div></div>
    <div class="field"><label for="sendNote">Message (facultatif)</label><input id="sendNote" maxlength="140" autocomplete="off" placeholder="Ex. : loyer de mars"></div>
    <div class="msg" id="sendMsg" role="status" aria-live="polite"></div>
    <div class="note">${iconSvg('bolt')}<p>Gratuit et instantané entre comptes LightPay.</p></div>`, actions: `<button class="btn" type="button" id="sendNext">Continuer</button>` }),
  frame({ screen: 'send-done', title: 'Envoi', state: true, content: `
<div class="state"><span class="state-icon" id="sendDoneIcon"></span><h2 id="sendDoneTitle"></h2><p id="sendDoneText"></p></div>`, actions: `<button class="btn btn-secondary" type="button" id="sendRetry" hidden>Réessayer</button><button class="btn" type="button" data-home>Terminé</button>` }),
  frame({ screen: 'withdraw', title: 'Retirer', state: false, content: `
    <div class="field" id="wdWalletField" hidden><span class="label" id="wdWalletLabel">Depuis</span><div class="seg" role="group" aria-labelledby="wdWalletLabel" id="wdWallets"></div></div>
    <div class="field" id="wdCountryField" hidden><span class="label" id="wdCountryLabel">Pays</span><div class="seg" role="group" aria-labelledby="wdCountryLabel" id="wdCountries"></div></div>
    <div class="field"><span class="label" id="wdNetLabel">Vers</span><div class="seg" role="group" aria-labelledby="wdNetLabel" id="wdNets"></div></div>
    <div class="field"><label for="wdPhone">Numéro qui reçoit</label><div class="input-prefix"><span id="wdDial">+242</span><input id="wdPhone" inputmode="tel" autocomplete="tel-national" placeholder="06 512 44 81" maxlength="18"></div></div>
    <label class="label mt-lg" for="wdAmount">Montant à recevoir</label>
    <div class="amount-wrap"><input class="amount-input" id="wdAmount" data-amount inputmode="numeric" autocomplete="off" placeholder="0"><div class="amount-cur" id="wdAvail">FCFA</div></div>
    <div class="fees" id="wdFees" hidden></div>
    <div class="msg" id="wdMsg" role="status" aria-live="polite"></div>
    <div class="section-head" id="wdListHead" hidden><h2>Derniers retraits</h2></div>
    <div id="wdList"></div>`, actions: `<button class="btn" type="button" id="wdNext" disabled>Continuer</button>` }),
  frame({ screen: 'withdraw-done', title: 'Retrait', state: true, content: `
<div class="state"><span class="state-icon" id="wdDoneIcon"></span><h2 id="wdDoneTitle"></h2><p id="wdDoneText"></p></div>`, actions: `<button class="btn btn-secondary" type="button" id="wdRetry" hidden>Réessayer</button><button class="btn" type="button" data-home>Terminé</button>` }),
  frame({ screen: 'move', title: 'Entre mes wallets', state: false, content: `
    <div class="field"><span class="label" id="moveFromWalletLabel">Depuis</span><div class="seg" role="group" aria-labelledby="moveFromWalletLabel" id="moveFromWallets"></div></div>
    <div class="field"><span class="label" id="moveToWalletLabel">Vers</span><div class="seg" role="group" aria-labelledby="moveToWalletLabel" id="moveToWallets"></div></div>
    <label class="label mt-lg" for="moveAmount">Montant</label>
    <div class="amount-wrap"><input class="amount-input" id="moveAmount" data-amount inputmode="numeric" autocomplete="off" placeholder="0"><div class="amount-cur" id="moveAvail">FCFA</div></div>
    <div class="msg" id="moveMsg" role="status" aria-live="polite"></div>
    <div class="note">${iconSvg('bolt')}<p>Gratuit et instantané entre vos wallets.</p></div>`, actions: `<button class="btn" type="button" id="moveNext" disabled>Continuer</button>` }),
  frame({ screen: 'move-done', title: 'Entre mes wallets', state: true, content: `
<div class="state"><span class="state-icon" id="moveDoneIcon"></span><h2 id="moveDoneTitle"></h2><p id="moveDoneText"></p></div>`, actions: `<button class="btn btn-secondary" type="button" id="moveRetry" hidden>Réessayer</button><button class="btn" type="button" data-home>Terminé</button>` }),
  ].join('\n\n');

export const FLOWS_SCRIPT = `
  const WD_STATUS = { SUCCEEDED: ['ok', 'envoyé'], PENDING: ['warn', 'en cours'], FAILED: ['err', 'échoué · restitué'] };
  // ---------------------------------------------------------------- which wallet (shown only when the person has several)
  // The wallet an action was started from (its own screen), else the default one. Ids: <p>WalletField, <p>Wallets.
  let flowWallet = null;
  // The swap fee line of a quote, only when the money changes country.
  const swapRow = (q) => (q && Number(q.swap_fee) > 0 ? [['Frais de swap (autre pays)', LP.money(q.swap_fee, q.currency || cur())]] : []);
  const myWallets = () => (me && me.wallets ? me.wallets.filter((w) => w.status === 'ACTIVE') : []);
  function walletPicker(p, changed, opts) {
    const o = opts || {};
    let chosen = null;
    const list = () => myWallets().filter((w) => !o.exclude || w.id !== o.exclude());
    const current = () => list().filter((w) => w.id === chosen)[0] || null;
    // fresh: a form being opened starts again from the wallet it was opened from (or the default one).
    function render(fresh) {
      if (fresh) chosen = null;
      const ws = list();
      if (!ws.some((w) => w.id === chosen)) chosen = ((o.start ? ws.filter((w) => w.id === o.start())[0] : null) || ws.filter((w) => w.id === flowWallet)[0] || ws.filter((w) => w.is_default)[0] || ws[0] || {}).id || null;
      if (!o.always) $(p + 'WalletField').hidden = myWallets().length < 2;
      // Each wallet says its country under its name: wallet X is for country X.
      $(p + 'Wallets').replaceChildren.apply($(p + 'Wallets'), ws.map((w) => el('button', {
        class: 'seg-opt seg-stack', type: 'button', 'aria-pressed': String(w.id === chosen),
        on: { click: () => { chosen = w.id; render(); changed(); } },
      }, [el('span', { text: w.label + ' · ' + LP.money(w.available_balance, w.currency) }), el('span', { class: 'seg-sub', text: w.country_name || 'Pays non choisi' })])));
    }
    return {
      render: render,
      id: () => chosen,
      // Without a wallet list (older page state), the default wallet's balance.
      balance: () => { const w = current(); return w ? Number(w.available_balance) : available(); },
      label: () => { const w = current(); return w ? w.label : ''; },
      // "Principal · Congo-Brazzaville": the name with its country, for the confirmation sheets.
      full: () => { const w = current(); return w ? w.label + (w.country_name ? ' · ' + w.country_name : '') : ''; },
      several: () => myWallets().length > 1,
    };
  }

  // ---------------------------------------------------------------- country, operator and number (deposit and withdrawal)
  // The country shows only when several are open; its operators follow; the number picks its operator (its prefix), and
  // choosing another operator than the number's clears the number. Ids: <p>CountryField, <p>Countries, <p>Nets, <p>Dial, <p>Phone.
  function railPicker(p, changed) {
    const st = { country: RAILS.countries[0].code, network: null };
    const phone = () => nationalOf($(p + 'Phone').value, st.country);
    const press = (host, key, value) => $(host).querySelectorAll('[' + key + ']').forEach((o) => o.setAttribute('aria-pressed', String(o.getAttribute(key) === value)));
    function pickNet(network) { st.network = network; press(p + 'Nets', 'data-net', network); }
    function render() {
      if (!RAILS.countries.some((c) => c.code === st.country)) st.country = RAILS.countries[0].code;
      $(p + 'CountryField').hidden = RAILS.countries.length < 2;
      $(p + 'Countries').replaceChildren.apply($(p + 'Countries'), RAILS.countries.map((c) =>
        el('button', { class: 'seg-opt', type: 'button', 'data-country': c.code, 'aria-pressed': String(c.code === st.country), text: c.name, on: { click: () => pickCountry(c.code) } })));
      const rails = railsIn(st.country);
      if (!rails.some((r) => r.network === st.network)) st.network = rails.length ? rails[0].network : null;
      $(p + 'Nets').replaceChildren.apply($(p + 'Nets'), rails.map((r) =>
        el('button', { class: 'seg-opt', type: 'button', 'data-net': r.network, 'aria-pressed': String(r.network === st.network), on: { click: () => {
          pickNet(r.network);
          const n = networkOf(phone(), st.country);
          if (n && n !== st.network) { $(p + 'Phone').value = ''; $(p + 'Phone').focus(); }
          changed();
        } } }, [opLogo(r), r.name])));
      const c = countryOf(st.country);
      $(p + 'Dial').textContent = '+' + c.dial;
      $(p + 'Phone').placeholder = c.example;
    }
    function pickCountry(code) {
      if (code === st.country) return;
      st.country = code; $(p + 'Phone').value = '';
      render(); changed();
    }
    $(p + 'Phone').addEventListener('input', () => { const n = networkOf(phone(), st.country); if (n && n !== st.network) pickNet(n); changed(); });
    render();
    loadRails().then(() => { render(); changed(); });
    return {
      st: st,
      phone: phone,
      complete: () => Boolean(st.network) && fitsNetwork(phone(), st.network),
      // Sent to the server in international form; shown as "+237 6 71 23 45 67".
      msisdn: () => countryOf(st.country).dial + phone(),
      shown: () => intlNumber(phone(), st.country),
      label: () => railName(st.network) + ' · ' + intlNumber(phone(), st.country),
    };
  }

  // ---------------------------------------------------------------- deposit
  // Amount, operator and the paying number are chosen here, once: confirming sends the request
  // to the phone straight away (no second payment page, no second choice).
  let depQuotes = null, depBusy = false, depState = null, depResult = null;
  const dep = railPicker('dep', () => renderDepFees());
  // Another wallet can be in another country: the swap fee may change, the quote is asked again.
  const depW = walletPicker('dep', () => loadDepQuote());
  // Entering the deposit form: the wallets and minimums as they are now.
  function enterDeposit() {
    depW.render(true); say('depMsg', ''); renderDepFees(); focusAmount('depAmount');
    loadMe().then(() => { depW.render(); renderDepFees(); }).catch(() => {});
  }
  function renderDepFees() {
    const q = depQuotes && depQuotes[dep.st.network];
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
    ].concat(swapRow(q)).concat([
      ['Frais opérateur', approx + LP.money(q.operator_fee, cur())],
      ['Total à payer', approx + LP.money(q.total, cur()), true],
    ]));
    $('depFees').hidden = false;
    say('depMsg', '');
    $('depGo').textContent = 'Déposer ' + approx + LP.money(q.total, cur());
    $('depGo').disabled = !dep.complete();
  }
  const loadDepQuote = debounce(async () => {
    const amount = amountDigits($('depAmount').value);
    if (!amount) { depQuotes = null; renderDepFees(); return; }
    try { depQuotes = (await LP.api('GET', '/v1/me/deposits/quote?amount=' + amount + (depW.id() ? '&wallet_id=' + encodeURIComponent(depW.id()) : ''))).quotes; renderDepFees(); }
    catch (e) { if (e.signIn) signIn(); else $('depFees').hidden = true; }
  }, 300);
  $('depAmount').addEventListener('input', () => {
    $('depGo').disabled = true;
    if (Number(amountDigits($('depAmount').value)) >= lim('deposit_min')) skRows($('depFees'), 4);
    loadDepQuote();
  });
  $('depGo').addEventListener('click', async () => {
    const q = depQuotes && depQuotes[dep.st.network];
    if (depBusy || !q || $('depGo').disabled) return;
    const approx = q.estimated ? '≈ ' : '';
    depBusy = true;
    const ok = await confirmSheet({
      title: 'Vous déposez',
      amount: approx + LP.money(q.total, cur()),
      rows: [
        ['Depuis', dep.label()],
        [depW.several() ? 'Sur « ' + depW.full() + ' »' : 'Sur votre wallet', LP.money(q.amount, cur())],
        ['Frais', approx + LP.money(String(Number(q.total) - Number(q.amount)), cur())],
      ],
      note: 'Une demande arrive sur ce téléphone : validez-la avec votre code secret.',
      confirm: 'Confirmer',
    });
    if (!ok) { depBusy = false; return; }
    depState = { amount: q.amount, total: approx + LP.money(q.total, cur()), msisdn: dep.msisdn(), shown: dep.shown(), network: dep.st.network, wallet: depW.id(), key: LP.uuid() };
    depResult = null;
    nav.go('deposit/done');
    await operate('dep', async () => {
      const r = await LP.api('POST', '/v1/me/deposits', { amount: depState.amount, wallet_id: depState.wallet || undefined }, depState.key);
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
      (depState.session ? 'Demande envoyée au ' : 'Au ') + depState.shown + ' pour ' + depState.total + ', frais compris.');
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
    document.querySelector('[data-screen="' + ({ wd: 'withdraw', send: 'send', dep: 'deposit', move: 'move' })[prefix] + '-done"] [data-home]').hidden = kind === 'wait';
  }
  // Runs the operation from its result screen: sign-in again if needed, any refusal shown there.
  async function operate(prefix, action) {
    await guarded(async () => {
      try { await action(); }
      catch (e) { if (e.reauth || e.signIn) throw e; result(prefix, 'err', ({ wd: 'Retrait non effectué', send: 'Envoi non effectué', dep: 'Dépôt non effectué', move: 'Déplacement non effectué' })[prefix], e.message); }
    }, prefix + 'DoneText');
  }

  // ---------------------------------------------------------------- send
  let sendState = null, sendResult = null, sendBusy = false;
  // The amount takes the keyboard as soon as its screen opens (after the slide, so it does not jump).
  const focusAmount = (id) => setTimeout(() => { const i = $(id); if (i && !i.closest('[hidden]')) i.focus(); }, 320);
  const sendW = walletPicker('send', () => { $('sendAvail').textContent = 'FCFA · disponible ' + LP.money(sendW.balance(), cur()); sendCheck(); loadSendQuote(); });
  function enterSend() {
    sendW.render(true);
    $('sendAvail').textContent = 'FCFA · disponible ' + LP.money(sendW.balance(), cur());
    say('sendMsg', '');
    sendCheck();
    focusAmount($('sendTo').value ? 'sendAmount' : 'sendTo');
  }
  let sendWho = null, sendWhoSeq = 0, sendQuote = null, sendQuoteSeq = 0;
  // Free inside a country; the swap fee when the receiver's wallet is in another one: asked once both are known.
  const sendKey = () => [$('sendTo').value.trim(), amountDigits($('sendAmount').value), sendW.id() || ''].join('|');
  const loadSendQuote = debounce(async () => {
    const seq = ++sendQuoteSeq, key = sendKey();
    const amount = amountDigits($('sendAmount').value);
    if (!sendWho || !amount) { sendQuote = null; return sendCheck(); }
    try {
      const r = await LP.api('GET', '/v1/me/transfers/quote?to=' + encodeURIComponent($('sendTo').value.trim()) + '&amount=' + amount + (sendW.id() ? '&wallet_id=' + encodeURIComponent(sendW.id()) : ''));
      if (seq !== sendQuoteSeq) return;
      sendQuote = Object.assign({ key: key }, r.quote);
    } catch (e) { if (e.signIn) return signIn(); sendQuote = null; }
    if (seq === sendQuoteSeq) sendCheck();
  }, 300);
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
    } finally { if (seq === sendWhoSeq) { sendCheck(); loadSendQuote(); } }
  }, 350);
  $('sendTo').addEventListener('input', lookupRecipient);
  // The button stays off until the form is complete: nothing to correct after the tap.
  function sendCheck() {
    const amount = Number(amountDigits($('sendAmount').value));
    const q = sendQuote && sendQuote.key === sendKey() ? sendQuote : null;
    const total = q ? Number(q.total) : amount;
    $('sendAvail').classList.toggle('below', total > sendW.balance());
    $('sendNext').disabled = !sendWho || !amount || !q || total > sendW.balance();
  }
  $('sendAmount').addEventListener('input', () => { sendCheck(); loadSendQuote(); });
  $('sendNext').addEventListener('click', async () => {
    if (sendBusy || $('sendNext').disabled) return;
    const amount = Number(amountDigits($('sendAmount').value));
    const w = sendWho || {};
    const who = [w.name, w.username ? '@' + w.username : ''].filter(Boolean).join(' · ') || $('sendTo').value.trim();
    const note = $('sendNote').value.trim();
    const q = sendQuote;
    const swap = Number(q.swap_fee);
    const fees = swap > 0 ? [['Frais de swap (autre pays)', LP.money(swap, cur())], ['Total débité', LP.money(q.total, cur()), true]] : [['Frais', 'Aucun']];
    const rows = [['À', who]].concat(sendW.several() ? [['Depuis', sendW.full()]] : []).concat(fees).concat(note ? [['Message', note]] : []).concat([['Solde après envoi', LP.money(sendW.balance() - Number(q.total), cur()), swap === 0]]);
    sendBusy = true;
    const next = { to: $('sendTo').value.trim(), who: w, amount: String(amount), note: note, wallet: sendW.id(), key: LP.uuid() };
    // « Envoyer » opens the code step; the transfer leaves once, with the 6th digit.
    const done = await confirmSheet({
      title: 'Vous envoyez', amount: LP.money(amount, cur()), rows: rows, confirm: 'Envoyer',
      pin: (code) => LP.api('POST', '/v1/me/transfers', { to: next.to, amount: next.amount, note: next.note, wallet_id: next.wallet || undefined }, next.key, code),
    });
    if (!done) { sendBusy = false; return; }
    sendState = next;
    sendResult = null;
    nav.go('send/done');
    await operate('send', async () => {
      if (done.error) throw done.error;
      const r = done.result;
      sendResult = r.transfer;
      $('sendTo').value = ''; $('sendAmount').value = ''; $('sendNote').value = ''; $('sendWho').textContent = ''; sendWho = null; sendQuote = null; sendCheck();
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
  let wdQuote = null, wdState = null, wdResult = null, wdSeq = 0, wdBusy = false, wdQuotedNet = null;
  // Another operator can mean another fee: the quote is asked again when the operator changes.
  const wd = railPicker('wd', () => { if (wd.st.network !== wdQuotedNet) loadWdQuote(); else wdCheck(); });
  // Another wallet can be in another country than the number: the swap fee may change, the quote is asked again.
  const wdW = walletPicker('wd', () => { wdAvailText(); wdQuotedNet = null; loadWdQuote(); wdCheck(); });
  function wdCheck() {
    const q = wdQuote;
    $('wdNext').disabled = true;
    // Below the minimum or above the balance: the line under the amount says it, the button stays off.
    const below = Boolean(q) && Number(q.amount) < Number(q.minimum);
    const tooMuch = Boolean(q) && !below && Number(q.total) > wdW.balance();
    $('wdAvail').classList.toggle('below', below || tooMuch);
    if (!q) return;
    if (below) { $('wdFees').hidden = true; return; }
    if (tooMuch || !wd.complete() || wdQuotedNet !== wd.st.network) return;
    $('wdNext').disabled = false;
  }
  function renderWdFees() {
    const q = wdQuote;
    if (!q) { $('wdFees').hidden = true; return; }
    feeRows($('wdFees'), [
      ['Vous recevez', LP.money(q.amount, q.currency)],
      ['Frais opérateur', LP.money(q.operator_fee, q.currency)],
    ].concat(swapRow(q)).concat([
      ['Frais LightPay', LP.money(q.lightpay_fee, q.currency)],
      ['Total débité de votre wallet', LP.money(q.total, q.currency), true],
    ]));
    $('wdFees').hidden = false;
  }
  const loadWdQuote = debounce(async () => {
    const amount = amountDigits($('wdAmount').value);
    const seq = ++wdSeq, network = wd.st.network;
    if (!amount || !network) { wdQuote = null; wdQuotedNet = null; renderWdFees(); wdCheck(); say('wdMsg', ''); return; }
    try {
      const r = await LP.api('GET', '/v1/me/withdrawals/quote?amount=' + amount + '&network=' + encodeURIComponent(network) + (wdW.id() ? '&wallet_id=' + encodeURIComponent(wdW.id()) : ''));
      if (seq !== wdSeq) return;
      wdQuote = r.quote; wdQuotedNet = network; renderWdFees(); wdCheck();
    } catch (e) { if (e.signIn) signIn(); }
  }, 300);
  $('wdAmount').addEventListener('input', () => {
    $('wdNext').disabled = true;
    if (Number(amountDigits($('wdAmount').value)) >= lim('withdrawal_min')) skRows($('wdFees'), 4);
    loadWdQuote();
  });
  function wdAvailText() { $('wdAvail').textContent = 'FCFA · disponible ' + LP.money(wdW.balance(), cur()) + ' · minimum ' + lim('withdrawal_min').toLocaleString('fr-FR'); }
  async function enterWithdraw() {
    focusAmount('wdAmount');
    wdW.render(true);
    // Minimums and balance as they are now (the admin may have changed them since the page opened).
    loadMe().then(() => { wdW.render(); wdAvailText(); wdCheck(); }).catch(() => {});
    wdAvailText();
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
    wdBusy = true;
    const next = { quote: q, network: wd.st.network, msisdn: wd.msisdn(), shown: wd.shown(), wallet: wdW.id(), key: LP.uuid() };
    // « Retirer » opens the code step; the withdrawal leaves once, with the 6th digit.
    const done = await confirmSheet({
      title: 'Vous retirez',
      amount: LP.money(q.amount, q.currency),
      rows: [
        ['Vers', wd.label()],
      ].concat(wdW.several() ? [['Depuis', wdW.full()]] : []).concat([
        ['Frais opérateur', LP.money(q.operator_fee, q.currency)],
      ]).concat(swapRow(q)).concat([
        ['Frais LightPay', LP.money(q.lightpay_fee, q.currency)],
        ['Total débité', LP.money(q.total, q.currency), true],
        ['Solde après retrait', LP.money(wdW.balance() - Number(q.total), q.currency)],
      ]),
      confirm: 'Retirer',
      pin: (code) => LP.api('POST', '/v1/me/withdrawals', { amount: next.quote.amount, msisdn: next.msisdn, network: next.network, wallet_id: next.wallet || undefined }, next.key, code),
    });
    if (!done) { wdBusy = false; return; }
    wdState = next;
    wdResult = null;
    nav.go('withdraw/done');
    await operate('wd', async () => {
      if (done.error) throw done.error;
      const r = done.result;
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
      return result('wd', 'wait', 'Retrait en cours', 'Envoi de ' + LP.money(wdState.quote.amount, wdState.quote.currency) + ' vers ' + wdState.shown + '…');
    }
    const w = wdResult;
    if (w.status === 'FAILED') result('wd', 'err', 'Retrait échoué', (w.reason || 'L’opérateur a refusé l’envoi.') + ' Les ' + LP.money(w.total, w.currency) + ' ont été restitués sur votre wallet.');
    else if (w.status === 'SUCCEEDED') result('wd', 'ok', 'Retrait envoyé', LP.money(w.amount, w.currency) + ' vers ' + w.to + '. Vous allez recevoir un SMS de votre opérateur.');
    else if (w.release_at) { result('wd', 'wait', 'Retrait programmé', LP.money(w.amount, w.currency) + ' vers ' + w.to + ' : l’envoi part à ' + new Date(w.release_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '. Vous recevrez un SMS de votre opérateur.'); followWithdrawal(w.id); }
    else { result('wd', 'wait', 'Retrait en cours', LP.money(w.amount, w.currency) + ' vers ' + w.to + ' : l’opérateur traite l’envoi, vous recevrez un SMS.'); followWithdrawal(w.id); }
  }
  // A pending withdrawal is re-read while its screen stays open: the operator usually confirms
  // within seconds, and the server settles it from the webhook or its own check.
  let wdFollow = null;
  function followWithdrawal(id, tries = 0) {
    clearTimeout(wdFollow);
    if (tries >= 400) return;
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


  // ---------------------------------------------------------------- between my wallets (instant, with the code)
  // Free inside a country; from one country to another the swap fee is paid on top.
  let moveState = null, moveResult = null, moveBusy = false, moveQuote = null, moveQuoteSeq = 0;
  const moveFrom = walletPicker('moveFrom', () => { moveTo.render(); moveCheck(); loadMoveQuote(); }, { always: true });
  const moveTo = walletPicker('moveTo', () => { moveCheck(); loadMoveQuote(); }, { always: true, exclude: () => moveFrom.id() });
  const moveKey = () => [moveFrom.id() || '', moveTo.id() || '', amountDigits($('moveAmount').value)].join('|');
  const loadMoveQuote = debounce(async () => {
    const seq = ++moveQuoteSeq, key = moveKey();
    const amount = amountDigits($('moveAmount').value);
    if (!moveFrom.id() || !moveTo.id() || !amount) { moveQuote = null; return moveCheck(); }
    try {
      const r = await LP.api('GET', '/v1/me/wallets/move/quote?from=' + encodeURIComponent(moveFrom.id()) + '&to=' + encodeURIComponent(moveTo.id()) + '&amount=' + amount);
      if (seq !== moveQuoteSeq) return;
      moveQuote = Object.assign({ key: key }, r.quote);
    } catch (e) { if (e.signIn) return signIn(); moveQuote = null; }
    if (seq === moveQuoteSeq) moveCheck();
  }, 300);
  function moveCheck() {
    const amount = Number(amountDigits($('moveAmount').value));
    const q = moveQuote && moveQuote.key === moveKey() ? moveQuote : null;
    const total = q ? Number(q.total) : amount;
    $('moveAvail').textContent = 'FCFA · disponible ' + LP.money(moveFrom.balance(), cur());
    $('moveAvail').classList.toggle('below', total > moveFrom.balance());
    $('moveNext').disabled = !moveFrom.id() || !moveTo.id() || !amount || !q || total > moveFrom.balance();
  }
  $('moveAmount').addEventListener('input', () => { moveCheck(); loadMoveQuote(); });
  function enterMove() {
    moveFrom.render(true); moveTo.render(true); moveCheck(); loadMoveQuote();
    say('moveMsg', myWallets().length < 2 ? 'Ouvrez un deuxième wallet pour déplacer de l’argent entre vos wallets.' : '');
    focusAmount('moveAmount');
  }
  $('moveNext').addEventListener('click', async () => {
    if (moveBusy || $('moveNext').disabled) return;
    const amount = String(Number(amountDigits($('moveAmount').value)));
    const next = { from: moveFrom.id(), to: moveTo.id(), fromLabel: moveFrom.label(), toLabel: moveTo.label(), fromFull: moveFrom.full(), toFull: moveTo.full(), amount: amount, key: LP.uuid() };
    const swap = Number(moveQuote.swap_fee);
    moveBusy = true;
    const done = await confirmSheet({
      title: 'Vous déplacez', amount: LP.money(amount, cur()),
      rows: [['Depuis', next.fromFull], ['Vers', next.toFull]].concat(swap > 0
        ? [['Frais de swap (autre pays)', LP.money(swap, cur())], ['Total débité', LP.money(moveQuote.total, cur()), true]]
        : [['Frais', 'Aucun']]),
      confirm: 'Déplacer',
      pin: (code) => LP.api('POST', '/v1/me/wallets/move', { from: next.from, to: next.to, amount: next.amount }, next.key, code),
    });
    if (!done) { moveBusy = false; return; }
    moveState = next; moveResult = null;
    nav.go('move/done');
    await operate('move', async () => {
      if (done.error) throw done.error;
      moveResult = done.result.move;
      $('moveAmount').value = ''; moveQuote = null;
      await loadMe().catch(() => {});
      enterMoveDone();
    });
    moveBusy = false;
  });
  $('moveRetry').addEventListener('click', () => nav.go('move', true));
  function enterMoveDone() {
    if (moveResult) return result('move', 'ok', 'Argent déplacé', LP.money(moveResult.amount, cur()) + ' de « ' + moveState.fromLabel + ' » vers « ' + moveState.toLabel + ' ».');
    if (!moveState) return nav.go('home', true);
    result('move', 'wait', 'Déplacement en cours', LP.money(moveState.amount, cur()) + ' vers « ' + moveState.toLabel + ' »…');
  }
`;
