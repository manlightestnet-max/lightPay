import { shell, topbar } from './shell.js';
import { iconSvg } from './icons.js';

/**
 * /connect — LightPay Connect consent screen. The back button means "Refuser": the person
 * goes back to the app with error=access_denied.
 */
export const connectPage = (nonce: string, env: string) => {
  const body = `
<section class="screen" data-screen="loading">
  ${topbar({ title: 'Autorisation', back: true, env })}
  <div class="state"><div class="spinner" aria-label="Chargement"></div></div>
</section>

<section class="screen" data-screen="invalid" hidden>
  ${topbar({ title: 'Autorisation', back: false, env })}
  <div class="state"><span class="state-icon err">${iconSvg('alert')}</span><h2>Demande invalide</h2><p id="invalidText"></p></div>
</section>

<section class="screen" data-screen="consent" hidden>
  ${topbar({ title: 'Autorisation', back: true, env })}
  <div class="content">
    <div class="center mt">
      <span class="avatar avatar-lg" id="appAvatar" aria-hidden="true"></span>
      <h2 class="title mt"><span id="appName"></span> souhaite accéder à votre compte LightPay</h2>
    </div>
    <ul class="list mt">
      <li><div class="row"><span class="avatar" id="meAvatar" aria-hidden="true"></span><span class="row-main"><span class="row-title" id="meEmail"></span><span class="row-sub">Compte LightPay connecté</span></span><button class="link" type="button" id="switchAccount">Changer</button></div></li>
    </ul>
    <div class="section-head"><h2>L’app pourra</h2></div>
    <ul class="list" id="scopes"></ul>
    <div class="field" id="limitBox" hidden>
      <label for="limit">Montant maximum par débit (FCFA)</label>
      <input id="limit" inputmode="numeric" autocomplete="off" value="50000">
      <p class="hint">Au-delà, chaque paiement vous sera demandé sur la page LightPay.</p>
    </div>
    <div id="termsBox" hidden>
      <div class="section-head"><h2>Conditions de <span id="termsApp"></span></h2></div>
      <ul class="terms" id="terms"></ul>
      <label class="agree"><input type="checkbox" id="agree"><span>J’accepte que <span id="agreeApp"></span> retienne automatiquement sa commission sur mes ventes.</span></label>
    </div>
    <div class="note">${iconSvg('shield')}<p>L’app ne voit jamais votre mot de passe. Vous pourrez retirer cet accès à tout moment depuis votre compte LightPay.</p></div>
    <div class="msg" id="msg" role="status" aria-live="polite"></div>
  </div>
  <div class="actions-bar"><div class="btn-row"><button class="btn btn-secondary" type="button" id="deny">Refuser</button><button class="btn" type="button" id="allow">Autoriser</button></div></div>
</section>`;

  const script = `
  const screen = (name) => showOnly(document.querySelector('[data-screen="' + name + '"]'));
  const q = new URLSearchParams(location.search);
  const req = { app_id: q.get('app_id') || '', scope: q.get('scope') || '', redirect_uri: q.get('redirect_uri') || '', state: q.get('state') || '', code_challenge: q.get('code_challenge') || '' };
  const SCOPE_ICON = { 'balance:read': 'wallet', payee: 'receive', deposit: 'plus', charge: 'send' };
  let valid = null;

  // Only a redirect_uri validated by the server is ever used.
  function back(params) {
    if (!valid) return;
    const u = new URL(req.redirect_uri);
    Object.keys(params).forEach((k) => { if (params[k]) u.searchParams.set(k, params[k]); });
    location.assign(u.toString());
  }
  const deny = () => back({ error: 'access_denied', state: req.state });
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-back]'); if (b && !b.closest('#auth')) { e.preventDefault(); if (valid) deny(); else if (history.length > 1) history.back(); } });
  $('deny').addEventListener('click', deny);

  function consent() {
    const email = LP.email();
    $('meAvatar').textContent = initials(email);
    $('meEmail').textContent = email;
    $('appAvatar').textContent = initials(valid.app.name);
    $('appName').textContent = valid.app.name;
    $('scopes').replaceChildren.apply($('scopes'), valid.scopes.map((s) => listRow({ icon: SCOPE_ICON[s.scope] || 'check', iconClass: 'in', title: s.label })));
    $('limitBox').hidden = !valid.scopes.some((s) => s.scope === 'charge');
    const terms = valid.terms || [];
    $('termsBox').hidden = !terms.length;
    $('termsApp').textContent = valid.app.name;
    $('agreeApp').textContent = valid.app.name;
    $('terms').replaceChildren.apply($('terms'), terms.map((t) => el('li', { text: t })));
    $('agree').checked = false;
    say('msg', '');
    screen('consent');
  }
  const signInThen = () => mountAuth(consent, { title: 'Connexion à LightPay', subtitle: valid.app.name + ' vous demande de vous connecter.', onBack: deny });
  $('switchAccount').addEventListener('click', () => { LP.signOut(); signInThen(); });

  $('allow').addEventListener('click', async () => {
    $('allow').disabled = true; say('msg', '');
    try {
      let limit;
      if (!$('limitBox').hidden) {
        limit = digits($('limit').value);
        if (!limit || Number(limit) <= 0) { say('msg', 'Indiquez un montant maximum par débit.', 'err'); return; }
      }
      const needsAgree = (valid.terms || []).length > 0;
      if (needsAgree && !$('agree').checked) { say('msg', 'Cochez la case pour accepter les conditions de ' + valid.app.name + '.', 'err'); return; }
      const r = await LP.api('POST', '/v1/me/connect/approve', Object.assign({}, req, { charge_limit: limit, accept_terms: needsAgree }));
      location.assign(r.redirect);
    } catch (e) {
      if (e.signIn) signInThen(); else say('msg', e.message, 'err');
    } finally { $('allow').disabled = false; }
  });

  (async () => {
    const params = new URLSearchParams({ app_id: req.app_id, scope: req.scope, redirect_uri: req.redirect_uri, code_challenge: req.code_challenge, environment: LP.ENV });
    const res = await fetch('/v1/checkout/public/authorize?' + params.toString(), { cache: 'no-store' }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) { $('invalidText').textContent = body.message || 'Ce lien d’autorisation est invalide ou incomplet.'; screen('invalid'); return; }
    valid = body;
    if (LP.signedIn()) consent(); else signInThen();
  })();
`;

  return shell({ title: 'Autoriser une app', nonce, env, body, script });
};
