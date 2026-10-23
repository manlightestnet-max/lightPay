import { iconSvg } from './icons.js';
import type { FlowFrame } from './flows.js';

/**
 * The person's wallets, shared by the account (/account) and the console (/account/console):
 *   #/wallets            the list (the default first) · Ouvrir un wallet · Entre mes wallets
 *   #/wallets/<id>       one wallet: balance, Dépôt / Envoyer / Retirer / Déplacer from it, name, default, close, its activity
 *   #/wallet/new         open another wallet (name, country)
 * Each page frames the screens its own way (FlowFrame) and provides, besides what flows.ts needs:
 *   walletList(host, wallets)        how a list of wallets is drawn (rows on the account, table() in the console)
 *   walletActivity(host, activity)   how a wallet's operations are drawn
 * Entered with enterWallets / enterWallet(id) / enterWalletNew.
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
    <div class="field"><label for="walletLabel">Nom du wallet</label><input id="walletLabel" maxlength="40" autocomplete="off"></div>
    <div class="btn-row"><button class="btn btn-secondary btn-sm" type="button" id="walletRename" disabled>Renommer</button><button class="btn btn-secondary btn-sm" type="button" id="walletDefault">Choisir par défaut</button></div>
    <div class="msg" id="walletMsg" role="status" aria-live="polite"></div>
    <div class="section-head"><h2>Activité</h2></div>
    <div id="walletActivityList"></div>`, actions: `<button class="btn btn-danger" type="button" id="walletClose">Fermer ce wallet</button>` }),
    frame({ screen: 'wallet-new', title: 'Ouvrir un wallet', state: false, content: `
    <div class="field"><label for="walletNewLabel">Nom</label><input id="walletNewLabel" maxlength="40" autocomplete="off" placeholder="Ex. : Épargne, Boutique"></div>
    <div class="field" id="walletNewCountryField" hidden><span class="label" id="walletNewCountryLabel">Pays</span><div class="seg" role="group" aria-labelledby="walletNewCountryLabel" id="walletNewCountries"></div></div>
    <div class="msg" id="walletNewMsg" role="status" aria-live="polite"></div>
    <div class="note">${iconSvg('info')}<p>Un wallet de plus, en FCFA, avec son propre solde. Vous déplacez de l’argent entre vos wallets gratuitement.</p></div>`, actions: `<button class="btn" type="button" id="walletNewGo" disabled>Ouvrir</button>` }),
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
  }
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
