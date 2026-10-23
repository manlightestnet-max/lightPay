import { iconSvg } from './icons.js';
import type { FlowFrame } from './flows.js';

/**
 * The person's wallets, shared by the account (/account) and the console (/account/console):
 *   #/wallets            the list (the default first) · Ouvrir un wallet · Entre mes wallets
 *   #/wallets/<id>       one wallet: balance, Dépôt / Envoyer / Retirer / Déplacer from it, name, default, close, its activity
 *   #/wallet/new         open another wallet (name, country)
 *   #/wallet-country     ask to move the wallet on screen to another country (decided by LightPay's admin, swap fee)
 * Each page frames the screens its own way (FlowFrame) and provides, besides what flows.ts needs:
 *   walletList(host, wallets)        how a list of wallets is drawn (rows on the account, table() in the console)
 *   walletActivity(host, activity)   how a wallet's operations are drawn
 * Entered with enterWallets / enterWallet(id) / enterWalletNew / enterWalletCountry.
 */
export const walletScreens = (frame: FlowFrame) =>
  [
    frame({ screen: 'wallets', title: 'Mes wallets', state: false, content: `
    <p class="hint">Chaque wallet a son nom et son solde. Celui par défaut reçoit ce qui n’en nomme aucun : les envois à votre @nom et les apps connectées.</p>
    <div class="mt" id="walletsList"></div>
    <div class="msg" id="walletsMsg" role="status" aria-live="polite"></div>`, actions: `<button class="btn btn-secondary" type="button" id="walletsMove">Entre mes wallets</button><button class="btn" type="button" id="walletsNew">${iconSvg('plus')}Ouvrir un wallet</button>` }),
    frame({ screen: 'wallet', title: 'Wallet', state: false, content: `
    <div class="hero"><div class="amount-xl" id="walletAmount"></div><div class="hero-sub" id="walletSub"></div>
      <div class="home-actions" id="walletActions">
        <button class="chip primary" type="button" data-wgo="deposit">${iconSvg('plus')}Dépôt</button>
        <button class="chip" type="button" data-wgo="withdraw">${iconSvg('withdraw')}Retrait</button>
        <button class="chip" type="button" data-wgo="send">${iconSvg('send')}Envoyer</button>
        <button class="chip" type="button" data-wgo="move" id="walletMoveChip">${iconSvg('swap')}Déplacer</button>
      </div>
    </div>
    <div class="note" id="walletCountryNote" hidden>${iconSvg('clock')}<p id="walletCountryText"></p><button class="link" type="button" id="walletCountryCancel" hidden>Annuler la demande</button></div>
    <div class="field"><label for="walletLabel">Nom du wallet</label><input id="walletLabel" maxlength="40" autocomplete="off"></div>
    <div class="btn-row"><button class="btn btn-secondary btn-sm" type="button" id="walletRename" disabled>Renommer</button><button class="btn btn-secondary btn-sm" type="button" id="walletDefault">Choisir par défaut</button><button class="btn btn-secondary btn-sm" type="button" id="walletCountryGo">Changer de pays</button></div>
    <div class="msg" id="walletMsg" role="status" aria-live="polite"></div>
    <div class="section-head"><h2>Activité</h2></div>
    <div id="walletActivityList"></div>`, actions: `<button class="btn btn-danger" type="button" id="walletClose">Fermer ce wallet</button>` }),
    frame({ screen: 'wallet-new', title: 'Ouvrir un wallet', state: false, content: `
    <div class="field"><label for="walletNewLabel">Nom</label><input id="walletNewLabel" maxlength="40" autocomplete="off" placeholder="Ex. : Épargne, Boutique"></div>
    <div class="field" id="walletNewCountryField" hidden><span class="label" id="walletNewCountryLabel">Pays</span><div class="seg" role="group" aria-labelledby="walletNewCountryLabel" id="walletNewCountries"></div></div>
    <div class="msg" id="walletNewMsg" role="status" aria-live="polite"></div>
    <div class="note">${iconSvg('info')}<p>Un wallet de plus, en FCFA, avec son propre solde. Vous déplacez de l’argent entre vos wallets gratuitement.</p></div>`, actions: `<button class="btn" type="button" id="walletNewGo" disabled>Ouvrir</button>` }),
    frame({ screen: 'wallet-country', title: 'Changer de pays', state: false, content: `
    <p class="hint" id="wcIntro"></p>
    <div class="field"><span class="label" id="wcCountryLabel">Nouveau pays</span><div class="seg" role="group" aria-labelledby="wcCountryLabel" id="wcCountries"></div></div>
    <div class="fees" id="wcFees" hidden></div>
    <div class="field"><label for="wcReason">Pourquoi (facultatif)</label><input id="wcReason" maxlength="300" autocomplete="off" placeholder="Ex. : je m’installe au Cameroun"></div>
    <div class="msg" id="wcMsg" role="status" aria-live="polite"></div>
    <div class="note">${iconSvg('info')}<p>LightPay valide la demande. Le wallet garde son solde en FCFA ; les frais de changement de pays sont pris sur le solde du jour de la validation.</p></div>`, actions: `<button class="btn" type="button" id="wcGo" disabled>Demander le changement</button>` }),
  ].join('\n\n');

export const WALLETS_SCRIPT = `
  // ---------------------------------------------------------------- my wallets
  const walletById = (id) => (me && me.wallets ? me.wallets.filter((w) => w.id === id)[0] : null) || null;
  async function enterWallets() {
    const show = () => {
      const open = me && me.wallets ? me.wallets.filter((w) => w.status === 'ACTIVE') : [];
      walletList($('walletsList'), open);
      $('walletsMove').hidden = open.length < 2;
      $('walletsNew').disabled = Boolean(me) && open.length >= (me.max_wallets || 1);
      say('walletsMsg', me && open.length >= (me.max_wallets || 1) ? 'Vous avez atteint le nombre maximum de wallets (' + me.max_wallets + ').' : '');
    };
    // Already seen: the last known list at once, then the server's.
    if (me && me.wallets) show(); else skeleton($('walletsList'), 3, 'div');
    await guarded(async () => { await loadMe(); show(); }, 'walletsMsg');
  }
  $('walletsNew').addEventListener('click', () => nav.go('wallet/new'));
  $('walletsMove').addEventListener('click', () => { flowWallet = null; nav.go('move'); });

  let walletShown = null;
  function showWallet(w) {
    walletShown = w;
    const title = document.querySelector('[data-screen="wallet"] .page-title, [data-screen="wallet"] .topbar-title');
    if (title) title.textContent = w.label;
    amountParts($('walletAmount'), w.available_balance, w.currency);
    const locked = Number(w.locked_balance);
    $('walletSub').textContent = [w.is_default ? 'Par défaut' : '', w.country_name || '', locked ? LP.money(locked, w.currency) + ' bloqués' : ''].filter(Boolean).join(' · ');
    $('walletLabel').value = w.label;
    $('walletRename').disabled = true;
    $('walletDefault').hidden = w.is_default;
    $('walletClose').hidden = w.is_default;
    $('walletMoveChip').hidden = me.wallets.filter((x) => x.status === 'ACTIVE').length < 2;
    // A country change asked: waiting for LightPay, or its answer of the past week.
    const rq = w.country_request;
    $('walletCountryNote').hidden = !rq;
    $('walletCountryCancel').hidden = !rq || rq.status !== 'PENDING';
    $('walletCountryGo').hidden = Boolean(rq && rq.status === 'PENDING') || RAILS.countries.length < 2;
    if (rq) $('walletCountryText').textContent = rq.status === 'PENDING' ? 'Changement vers ' + rq.to_country_name + ' en attente de validation par LightPay.'
      : rq.status === 'APPROVED' ? 'Changement vers ' + rq.to_country_name + ' accepté.'
      : 'Changement vers ' + rq.to_country_name + ' refusé' + (rq.note ? ' : ' + rq.note : '.');
  }
  $('walletCountryGo').addEventListener('click', () => { if (walletShown) nav.go('wallet-country'); });
  $('walletCountryCancel').addEventListener('click', () => guarded(async () => {
    $('walletCountryCancel').disabled = true;
    try {
      await LP.api('DELETE', '/v1/me/wallets/' + encodeURIComponent(walletShown.id) + '/country');
      await loadMe(); showWallet(walletById(walletShown.id));
      say('walletMsg', 'Demande annulée.', 'ok');
    } finally { $('walletCountryCancel').disabled = false; }
  }, 'walletMsg'));
  async function enterWallet(id) {
    say('walletMsg', '');
    const known = walletById(id);
    // Another wallet than the one on screen: the shimmer, never its numbers.
    if (known) showWallet(known); else { $('walletAmount').replaceChildren(el('span', { class: 'sk sk-amount' })); $('walletSub').textContent = ''; }
    if (!walletShown || walletShown.id !== id) skeleton($('walletActivityList'), 4, 'div');
    await guarded(async () => {
      await loadMe();
      const w = walletById(id);
      if (!w || w.status !== 'ACTIVE') { nav.go('wallets', true); return; }
      showWallet(w);
      const act = await LP.api('GET', '/v1/me/activity?limit=30&wallet_id=' + encodeURIComponent(id));
      walletActivity($('walletActivityList'), act.activity);
    }, 'walletMsg');
  }
  document.querySelectorAll('[data-wgo]').forEach((b) => b.addEventListener('click', () => {
    if (!walletShown) return;
    // The forms open on this wallet.
    flowWallet = walletShown.id;
    nav.go(b.dataset.wgo);
  }));
  $('walletLabel').addEventListener('input', () => { $('walletRename').disabled = !walletShown || !$('walletLabel').value.trim() || $('walletLabel').value.trim() === walletShown.label; });
  $('walletRename').addEventListener('click', () => guarded(async () => {
    $('walletRename').disabled = true;
    const r = await LP.api('PATCH', '/v1/me/wallets/' + encodeURIComponent(walletShown.id), { label: $('walletLabel').value.trim() });
    await loadMe(); showWallet(walletById(r.wallet.id) || r.wallet);
    say('walletMsg', 'Nom enregistré.', 'ok');
  }, 'walletMsg'));
  $('walletDefault').addEventListener('click', () => guarded(async () => {
    $('walletDefault').disabled = true;
    try {
      const r = await LP.api('POST', '/v1/me/wallets/' + encodeURIComponent(walletShown.id) + '/default');
      await loadMe(); showWallet(walletById(r.wallet.id) || r.wallet);
      say('walletMsg', 'Ce wallet reçoit maintenant les envois à votre @nom et l’argent des apps connectées.', 'ok');
    } finally { $('walletDefault').disabled = false; }
  }, 'walletMsg'));
  $('walletClose').addEventListener('click', async () => {
    if (!walletShown) return;
    const w = walletShown;
    const ok = await confirmSheet({
      title: 'Fermer ce wallet', amount: w.label,
      rows: [['Solde', LP.money(w.available_balance, w.currency)]],
      note: 'Il doit être vide, sans paiement ni retrait en attente. Son historique reste consultable par LightPay.',
      confirm: 'Fermer',
    });
    if (!ok) return;
    await guarded(async () => {
      await LP.api('DELETE', '/v1/me/wallets/' + encodeURIComponent(w.id));
      await loadMe();
      nav.go('wallets', true);
    }, 'walletMsg');
  });

  // ---------------------------------------------------------------- moving the wallet on screen to another country
  let wcCountry = null, wcQuote = null;
  async function enterWalletCountry() {
    say('wcMsg', '');
    if (!walletShown) return nav.go('wallets', true);
    const w = walletShown;
    $('wcIntro').textContent = '« ' + w.label + ' » est aujourd’hui ' + (w.country_name ? 'au pays : ' + w.country_name : 'sans pays') + '. Choisissez le pays où vous voulez l’utiliser.';
    const render = () => {
      const others = RAILS.countries.filter((c) => c.code !== w.country);
      if (!others.some((c) => c.code === wcCountry)) wcCountry = null;
      $('wcCountries').replaceChildren.apply($('wcCountries'), others.map((c) => el('button', {
        class: 'seg-opt', type: 'button', 'aria-pressed': String(c.code === wcCountry), text: c.name,
        on: { click: () => { wcCountry = c.code; render(); } },
      })));
      $('wcGo').disabled = !wcCountry;
    };
    render();
    loadRails().then(render);
    $('wcFees').hidden = true;
    await guarded(async () => {
      wcQuote = (await LP.api('GET', '/v1/me/wallets/' + encodeURIComponent(w.id) + '/country-quote')).quote;
      feeRows($('wcFees'), [['Solde du wallet', LP.money(wcQuote.balance, w.currency)], ['Frais de changement de pays (aujourd’hui)', LP.money(wcQuote.fee, w.currency)], ['Restera sur le wallet', LP.money(Number(wcQuote.balance) - Number(wcQuote.fee), w.currency), true]]);
      $('wcFees').hidden = false;
    }, 'wcMsg');
  }
  $('wcGo').addEventListener('click', async () => {
    if (!walletShown || !wcCountry || $('wcGo').disabled) return;
    const w = walletShown;
    const to = RAILS.countries.filter((c) => c.code === wcCountry)[0];
    const ok = await confirmSheet({
      title: 'Changer de pays', amount: to ? to.name : wcCountry,
      rows: [['Wallet', w.label], ['Aujourd’hui', w.country_name || '—']].concat(wcQuote ? [['Frais estimés', LP.money(wcQuote.fee, w.currency)]] : []),
      note: 'LightPay valide la demande ; vous pouvez l’annuler tant qu’elle attend.',
      confirm: 'Demander',
    });
    if (!ok) return;
    await guarded(async () => {
      $('wcGo').disabled = true;
      try {
        await LP.api('POST', '/v1/me/wallets/' + encodeURIComponent(w.id) + '/country', { country: wcCountry, reason: $('wcReason').value.trim() || undefined });
        $('wcReason').value = ''; wcCountry = null;
        await loadMe();
        nav.go('wallets/' + w.id, true);
      } finally { $('wcGo').disabled = !wcCountry; }
    }, 'wcMsg');
  });

  let walletNewCountry = null;
  function enterWalletNew() {
    say('walletNewMsg', '');
    const render = () => {
      if (!RAILS.countries.some((c) => c.code === walletNewCountry)) walletNewCountry = RAILS.countries[0].code;
      $('walletNewCountryField').hidden = RAILS.countries.length < 2;
      $('walletNewCountries').replaceChildren.apply($('walletNewCountries'), RAILS.countries.map((c) => el('button', {
        class: 'seg-opt', type: 'button', 'aria-pressed': String(c.code === walletNewCountry), text: c.name,
        on: { click: () => { walletNewCountry = c.code; render(); } },
      })));
    };
    render();
    loadRails().then(render);
    setTimeout(() => $('walletNewLabel').focus(), 320);
  }
  $('walletNewLabel').addEventListener('input', () => { $('walletNewGo').disabled = !$('walletNewLabel').value.trim(); });
  $('walletNewGo').addEventListener('click', () => guarded(async () => {
    $('walletNewGo').disabled = true;
    try {
      const r = await LP.api('POST', '/v1/me/wallets', { label: $('walletNewLabel').value.trim(), country: walletNewCountry });
      $('walletNewLabel').value = '';
      await loadMe();
      nav.go('wallets/' + r.wallet.id, true);
    } finally { $('walletNewGo').disabled = !$('walletNewLabel').value.trim(); }
  }, 'walletNewMsg'));
`;
