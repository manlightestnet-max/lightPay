/**
 * Hosted LightPay pages (served on the checkout domain): /pay/:id, /account, /connect.
 * Plain HTML + inline script under a nonce CSP. Sign-in uses Firebase Auth's REST API
 * (email + password); the ID token only ever goes to LightPay's own /v1/me routes.
 */

export const FIREBASE_WEB_API_KEY = () => process.env.LIGHTPAY_FIREBASE_WEB_API_KEY || 'AIzaSyAyOdD8qSUfx8wvHhb5F4EJ4zKjavwnpeI';

export const hostedCsp = (nonce: string) =>
  [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
    "img-src 'self' data:",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; ');

const CSS = `
  :root { --bg:#0b0b0c; --card:#141416; --line:#26262a; --soft:#1c1c1f; --text:#f4f4f5; --muted:#9b9ba2; --accent:#34d399; --on-accent:#04130d; --danger:#f87171; --warn:#fbbf24; }
  @media (prefers-color-scheme: light) { :root { --bg:#f4f4f6; --card:#fff; --line:#e4e4e7; --soft:#f4f4f5; --text:#18181b; --muted:#71717a; --accent:#047857; --on-accent:#fff; --danger:#dc2626; --warn:#b45309; } }
  * { box-sizing:border-box; margin:0; }
  body { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:16px; background:var(--bg); color:var(--text); font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { width:100%; max-width:420px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:20px; padding:24px; }
  .brand { display:flex; align-items:center; gap:8px; font-weight:600; font-size:13px; color:var(--muted); margin-bottom:16px; }
  .dot { width:8px; height:8px; border-radius:50%; background:var(--accent); }
  .badge { margin-left:auto; font-size:11px; padding:2px 8px; border-radius:99px; border:1px solid var(--warn); color:var(--warn); }
  h1 { font-size:20px; letter-spacing:-.01em; margin-bottom:4px; }
  .muted { color:var(--muted); font-size:13px; }
  .amount { font-size:32px; font-weight:650; letter-spacing:-.02em; margin:4px 0 2px; font-variant-numeric:tabular-nums; }
  .note { margin-top:16px; padding:10px 12px; border-radius:12px; background:color-mix(in srgb, var(--accent) 10%, transparent); font-size:12px; }
  hr { border:0; border-top:1px solid var(--line); margin:20px 0; }
  .seg, .nets { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .opt { height:44px; border-radius:12px; border:1px solid var(--line); background:transparent; color:var(--text); font:inherit; font-weight:600; cursor:pointer; }
  .opt[aria-pressed="true"] { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent) inset; }
  label { display:block; font-size:12px; color:var(--muted); margin:14px 0 6px; }
  input { width:100%; height:46px; border-radius:12px; border:1px solid var(--line); background:transparent; color:var(--text); font:inherit; font-size:16px; padding:0 14px; }
  input:focus, .opt:focus-visible, .btn:focus-visible, .link:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .btn { width:100%; height:48px; margin-top:16px; border:0; border-radius:99px; background:var(--accent); color:var(--on-accent); font:inherit; font-weight:650; cursor:pointer; }
  .btn.ghost { background:transparent; color:var(--text); border:1px solid var(--line); }
  .btn:disabled { opacity:.4; cursor:not-allowed; }
  .row { display:flex; gap:8px; } .row .btn { flex:1; }
  .msg { margin-top:12px; font-size:13px; min-height:20px; } .msg.err { color:var(--danger); }
  .link { background:none; border:0; padding:0; color:var(--accent); font:inherit; font-weight:600; cursor:pointer; text-decoration:none; }
  .state { text-align:center; padding:8px 0; } .state h2 { font-size:18px; margin:12px 0 4px; } .state p { color:var(--muted); font-size:13px; }
  .spinner { width:36px; height:36px; margin:0 auto; border-radius:50%; border:3px solid var(--line); border-top-color:var(--accent); animation:spin 1s linear infinite; }
  .ok { width:44px; height:44px; margin:0 auto; border-radius:50%; background:var(--accent); color:var(--on-accent); display:flex; align-items:center; justify-content:center; font-size:22px; }
  .list { list-style:none; padding:0; margin:12px 0 0; } .list li { display:flex; align-items:center; gap:10px; padding:10px 0; border-top:1px solid var(--line); font-size:13px; }
  .list li:first-child { border-top:0; } .grow { flex:1; min-width:0; } .num { font-variant-numeric:tabular-nums; font-weight:600; }
  .scopes li::before { content:"✓"; color:var(--accent); font-weight:700; }
  .h2 { font-size:15px; } .mt { margin-top:12px; } .center { text-align:center; }
  .foot { text-align:center; color:var(--muted); font-size:11px; margin-top:12px; }
  [hidden] { display:none !important; }
  @keyframes spin { to { transform:rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation:none; } }
`;

/** Shared client: Firebase REST sign-in/up, token refresh, calls to LightPay /v1/me. */
const CLIENT = (env: string) => `
  const LP = (() => {
    const KEY = ${JSON.stringify(FIREBASE_WEB_API_KEY())};
    const ENV = ${JSON.stringify(env)};
    const STORE = 'lightpay.session';
    const read = () => { try { return JSON.parse(sessionStorage.getItem(STORE) || 'null'); } catch { return null; } };
    const write = (s) => { try { s ? sessionStorage.setItem(STORE, JSON.stringify(s)) : sessionStorage.removeItem(STORE); } catch {} };
    const ERRORS = {
      EMAIL_EXISTS: 'Un compte existe déjà avec cet e-mail.',
      EMAIL_NOT_FOUND: 'E-mail ou mot de passe incorrect.',
      INVALID_PASSWORD: 'E-mail ou mot de passe incorrect.',
      INVALID_LOGIN_CREDENTIALS: 'E-mail ou mot de passe incorrect.',
      WEAK_PASSWORD: 'Mot de passe trop court (6 caractères minimum).',
      INVALID_EMAIL: 'Adresse e-mail invalide.',
      TOO_MANY_ATTEMPTS_TRY_LATER: 'Trop de tentatives, réessayez plus tard.',
    };
    const auth = async (path, body) => {
      const res = await fetch('https://identitytoolkit.googleapis.com/v1/' + path + '?key=' + KEY, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, returnSecureToken: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { const code = (data.error && data.error.message || '').split(' ')[0]; throw new Error(ERRORS[code] || 'Connexion impossible.'); }
      return data;
    };
    const save = (d) => write({ idToken: d.idToken, refreshToken: d.refreshToken, expiresAt: Date.now() + (Number(d.expiresIn) - 60) * 1000, email: d.email });
    const token = async () => {
      const s = read();
      if (!s) return null;
      if (s.expiresAt > Date.now()) return s.idToken;
      const res = await fetch('https://securetoken.googleapis.com/v1/token?key=' + KEY, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(s.refreshToken),
      });
      if (!res.ok) { write(null); return null; }
      const d = await res.json();
      write({ ...s, idToken: d.id_token, refreshToken: d.refresh_token, expiresAt: Date.now() + (Number(d.expires_in) - 60) * 1000 });
      return d.id_token;
    };
    const api = async (method, path, body) => {
      const t = await token();
      if (!t) throw Object.assign(new Error('Connectez-vous à LightPay.'), { signIn: true });
      const res = await fetch(path, {
        method, headers: { Authorization: 'Bearer ' + t, 'X-Environment': ENV, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { write(null); throw Object.assign(new Error(data.message || 'Session expirée.'), { signIn: true }); }
      if (!res.ok) throw new Error(data.message || 'Une erreur est survenue.');
      return data;
    };
    return {
      ENV,
      signedIn: () => Boolean(read()),
      email: () => (read() || {}).email || '',
      signIn: async (email, password) => save(await auth('accounts:signInWithPassword', { email, password })),
      signUp: async (email, password, name) => {
        const d = await auth('accounts:signUp', { email, password });
        if (name) { const u = await auth('accounts:update', { idToken: d.idToken, displayName: name }); d.idToken = u.idToken || d.idToken; }
        save(d);
      },
      signOut: () => write(null),
      api,
      money: (v, c) => Number(v).toLocaleString('fr-FR') + ' ' + (c === 'XAF' ? 'FCFA' : c),
    };
  })();

  /** Sign-in / sign-up form mounted in #auth; calls onDone once signed in. */
  function mountAuth(onDone) {
    const box = document.getElementById('auth');
    let mode = 'in';
    const render = () => {
      box.innerHTML = '';
      const title = document.createElement('h1'); title.textContent = mode === 'in' ? 'Connexion à LightPay' : 'Créer un compte LightPay';
      const sub = document.createElement('p'); sub.className = 'muted'; sub.textContent = 'Un seul compte pour payer et être payé partout.';
      box.append(title, sub);
      const fields = [];
      const field = (id, label, type, auto) => {
        const l = document.createElement('label'); l.htmlFor = id; l.textContent = label;
        const i = document.createElement('input'); i.id = id; i.type = type; i.autocomplete = auto; i.required = true;
        box.append(l, i); fields.push(i); return i;
      };
      const name = mode === 'up' ? field('lp-name', 'Nom complet', 'text', 'name') : null;
      const email = field('lp-email', 'E-mail', 'email', 'email');
      const pass = field('lp-pass', 'Mot de passe', 'password', mode === 'in' ? 'current-password' : 'new-password');
      const btn = document.createElement('button'); btn.className = 'btn'; btn.type = 'button'; btn.textContent = mode === 'in' ? 'Se connecter' : 'Créer mon compte';
      const msg = document.createElement('div'); msg.className = 'msg'; msg.setAttribute('role', 'status');
      const sw = document.createElement('p'); sw.className = 'muted mt';
      const swb = document.createElement('button'); swb.className = 'link'; swb.type = 'button'; swb.textContent = mode === 'in' ? 'Créer un compte' : 'J’ai déjà un compte';
      sw.append(mode === 'in' ? 'Pas encore de compte ? ' : '', swb);
      box.append(btn, msg, sw);
      swb.onclick = () => { mode = mode === 'in' ? 'up' : 'in'; render(); };
      const go = async () => {
        btn.disabled = true; msg.textContent = ''; msg.className = 'msg';
        try {
          mode === 'in' ? await LP.signIn(email.value.trim(), pass.value) : await LP.signUp(email.value.trim(), pass.value, name.value.trim());
          box.hidden = true; onDone();
        } catch (e) { msg.className = 'msg err'; msg.textContent = e.message; }
        finally { btn.disabled = false; }
      };
      btn.onclick = go;
      fields.forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }));
    };
    box.hidden = false;
    render();
  }
`;

const shell = (title: string, nonce: string, body: string, script: string, env = 'production') => `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · LightPay</title>
<style nonce="${nonce}">${CSS}</style>
</head>
<body>
<main>
  <div class="card">
    <div class="brand"><span class="dot"></span>LightPay${env === 'sandbox' ? '<span class="badge">Test</span>' : ''}</div>
    ${body}
  </div>
  <p class="foot">LightPay · paiements sécurisés</p>
</main>
<script nonce="${nonce}">${CLIENT(env)}
${script}</script>
</body>
</html>`;

// ---------------------------------------------------------------- /account

export const accountPage = (nonce: string, env: string) =>
  shell(
    'Mon compte',
    nonce,
    `
    <div id="auth" hidden></div>
    <div id="space" hidden>
      <p class="muted" id="who"></p>
      <div class="amount" id="available"></div>
      <p class="muted">disponible · <span id="locked"></span> bloqués</p>
      <div class="note">Les fonds bloqués sont des paiements en attente de validation de la commande.</div>
      <hr>
      <h1 class="h2">Apps autorisées</h1>
      <ul class="list" id="apps"></ul>
      <p class="muted" id="noApps" hidden>Aucune app n’a accès à votre wallet.</p>
      <hr>
      <h1 class="h2">Derniers mouvements</h1>
      <ul class="list" id="moves"></ul>
      <p class="muted" id="noMoves" hidden>Aucun mouvement pour l’instant.</p>
      <button class="btn ghost" id="out" type="button">Se déconnecter</button>
    </div>`,
    `
  const $ = (x) => document.getElementById(x);
  const li = (...cells) => { const el = document.createElement('li'); cells.forEach((c) => el.append(c)); return el; };
  const span = (text, cls) => { const s = document.createElement('span'); s.textContent = text; if (cls) s.className = cls; return s; };
  const SCOPE = { 'balance:read': 'solde', payee: 'recevoir', deposit: 'recharges', charge: 'débits' };
  async function load() {
    try {
      const me = await LP.api('GET', '/v1/me');
      $('who').textContent = (me.user.name || me.user.email || '') + (LP.ENV === 'sandbox' ? ' · environnement de test' : '');
      $('available').textContent = LP.money(me.wallet.available_balance, me.wallet.currency);
      $('locked').textContent = LP.money(me.wallet.locked_balance, me.wallet.currency);
      const { connections } = await LP.api('GET', '/v1/me/connections');
      const active = connections.filter((c) => c.status === 'ACTIVE');
      $('apps').replaceChildren(...active.map((c) => {
        const btn = document.createElement('button'); btn.className = 'link'; btn.type = 'button'; btn.textContent = 'Retirer';
        btn.onclick = async () => { btn.disabled = true; await LP.api('DELETE', '/v1/me/connections/' + encodeURIComponent(c.id)); load(); };
        const info = document.createElement('div'); info.className = 'grow';
        info.append(span(c.app_name), document.createElement('br'), span(c.scopes.map((s) => SCOPE[s] || s).join(' · '), 'muted'));
        return li(info, btn);
      }));
      $('noApps').hidden = active.length > 0;
      const { entries } = await LP.api('GET', '/v1/me/transactions?limit=15');
      $('moves').replaceChildren(...entries.map((e) => {
        const info = document.createElement('div'); info.className = 'grow';
        info.append(span(e.description || e.type), document.createElement('br'), span(new Date(e.created_at).toLocaleString('fr-FR') + (e.bucket === 'LOCKED' ? ' · bloqué' : ''), 'muted'));
        return li(info, span((e.direction === 'CREDIT' ? '+' : '−') + LP.money(e.amount, me.wallet.currency), 'num'));
      }));
      $('noMoves').hidden = entries.length > 0;
      $('space').hidden = false;
    } catch (e) {
      if (e.signIn) { $('space').hidden = true; mountAuth(load); } else { $('who').textContent = e.message; $('space').hidden = false; }
    }
  }
  $('out').onclick = () => { LP.signOut(); $('space').hidden = true; mountAuth(load); };
  LP.signedIn() ? load() : mountAuth(load);
`,
    env
  );

// ---------------------------------------------------------------- /connect

export const connectPage = (nonce: string, env: string) =>
  shell(
    'Autoriser une app',
    nonce,
    `
    <div id="loading" class="state"><div class="spinner"></div></div>
    <div id="invalid" class="state" hidden><h2>Demande invalide</h2><p id="invalidText"></p></div>
    <div id="auth" hidden></div>
    <div id="consent" hidden>
      <h1><span id="app"></span> demande l’accès à votre LightPay</h1>
      <p class="muted" id="as"></p>
      <ul class="list scopes" id="scopes"></ul>
      <div id="limitBox" hidden>
        <label for="limit">Montant maximum par paiement (FCFA)</label>
        <input id="limit" inputmode="numeric" value="50000">
      </div>
      <div class="row"><button class="btn ghost" id="deny" type="button">Refuser</button><button class="btn" id="allow" type="button">Autoriser</button></div>
      <div class="msg" id="msg" role="status"></div>
      <p class="muted mt">Vous pourrez retirer cet accès à tout moment depuis votre compte LightPay.</p>
    </div>`,
    `
  const $ = (x) => document.getElementById(x);
  const q = new URLSearchParams(location.search);
  const req = { app_id: q.get('app_id') || '', scope: q.get('scope') || '', redirect_uri: q.get('redirect_uri') || '', state: q.get('state') || '', code_challenge: q.get('code_challenge') || '' };
  let valid = null;
  const back = (params) => { const u = new URL(req.redirect_uri); Object.entries(params).forEach(([k, v]) => v && u.searchParams.set(k, v)); location.assign(u.toString()); };
  async function consent() {
    $('as').textContent = 'Connecté en tant que ' + LP.email();
    $('app').textContent = valid.app.name;
    $('scopes').replaceChildren(...valid.scopes.map((s) => { const li = document.createElement('li'); li.textContent = s.label; return li; }));
    $('limitBox').hidden = !valid.scopes.some((s) => s.scope === 'charge');
    $('loading').hidden = true; $('consent').hidden = false;
  }
  $('deny').onclick = () => back({ error: 'access_denied', state: req.state });
  $('allow').onclick = async () => {
    $('allow').disabled = true; $('msg').textContent = ''; $('msg').className = 'msg';
    try {
      const limit = $('limitBox').hidden ? undefined : String(Math.max(0, parseInt($('limit').value.replace(/\\D/g, '') || '0', 10)));
      const r = await LP.api('POST', '/v1/me/connect/approve', { ...req, charge_limit: limit });
      location.assign(r.redirect);
    } catch (e) {
      if (e.signIn) { $('consent').hidden = true; mountAuth(consent); }
      else { $('msg').className = 'msg err'; $('msg').textContent = e.message; }
    } finally { $('allow').disabled = false; }
  };
  (async () => {
    const res = await fetch('/v1/checkout/public/authorize?' + new URLSearchParams({ ...req, environment: LP.ENV }), { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { $('loading').hidden = true; $('invalid').hidden = false; $('invalidText').textContent = body.message || 'Lien d’autorisation invalide.'; return; }
    valid = body;
    if (LP.signedIn()) consent(); else { $('loading').hidden = true; mountAuth(consent); }
  })();
`,
    env
  );

// ---------------------------------------------------------------- /pay/:id

export const payPage = (nonce: string, sessionId: string, env: string) =>
  shell(
    'Paiement',
    nonce,
    `
    <div id="loading" class="state"><div class="spinner"></div></div>
    <div id="summary" hidden>
      <div class="muted" id="merchant"></div>
      <div class="amount" id="amount"></div>
      <div class="muted" id="desc"></div>
      <div class="note" id="escrow" hidden>Paiement protégé : le vendeur n’est payé qu’une fois la commande validée.</div>
    </div>
    <div id="choose" hidden>
      <hr>
      <div class="seg" id="methods" role="group" aria-label="Moyen de paiement">
        <button type="button" class="opt" data-m="mobile_money" aria-pressed="true">Mobile money</button>
        <button type="button" class="opt" data-m="lightpay_wallet" aria-pressed="false">Wallet LightPay</button>
      </div>
    </div>
    <div id="momo" hidden>
      <label>Opérateur</label>
      <div class="nets" role="group" aria-label="Opérateur">
        <button type="button" class="opt net" data-net="MTN_MOMO_COG" aria-pressed="true">MTN MoMo</button>
        <button type="button" class="opt net" data-net="AIRTEL_COG" aria-pressed="false">Airtel Money</button>
      </div>
      <label for="msisdn">Numéro de téléphone</label>
      <input id="msisdn" inputmode="tel" autocomplete="tel-national" placeholder="06 512 44 81" maxlength="16">
      <button class="btn" id="payMomo" type="button">Payer</button>
      <p class="muted mt center">Aucun compte requis</p>
    </div>
    <div id="auth" hidden></div>
    <div id="wallet" hidden>
      <p class="muted" id="walletWho"></p>
      <p class="mt">Solde disponible : <span class="num" id="walletBalance"></span></p>
      <button class="btn" id="payWallet" type="button">Payer avec mon wallet</button>
    </div>
    <div class="msg" id="msg" role="status" aria-live="polite"></div>
    <div id="waiting" class="state" hidden><div class="spinner"></div><h2>Validez sur votre téléphone</h2><p id="waitText"></p></div>
    <div id="done" class="state" hidden><div class="ok" aria-hidden="true">✓</div><h2 id="doneTitle">Paiement confirmé</h2><p>Vous pouvez revenir sur le site du marchand.</p><a class="link" id="back" hidden>Retour au site</a></div>
    <div id="closed" class="state" hidden><h2 id="closedTitle">Paiement indisponible</h2><p id="closedText"></p><a class="link" id="cancelBack" hidden>Retour au site</a></div>`,
    `
  const id = ${JSON.stringify(sessionId)};
  const $ = (x) => document.getElementById(x);
  const PANES = ['loading', 'choose', 'momo', 'auth', 'wallet', 'waiting', 'done', 'closed'];
  const show = (...ids) => PANES.forEach((k) => ($(k).hidden = !ids.includes(k)));
  const FAIL = { INSUFFICIENT_BALANCE: 'Solde insuffisant sur ce compte mobile money.', PAYER_DECLINED: 'Paiement refusé depuis le téléphone.', PAYER_TIMEOUT: 'Aucune confirmation reçue à temps. Réessayez.' };
  let session = null, method = 'mobile_money', network = 'MTN_MOMO_COG', poll = null, lastAttemptAt = null;
  const err = (t) => { $('msg').className = 'msg err'; $('msg').textContent = t; };
  const info = (t) => { $('msg').className = 'msg'; $('msg').textContent = t; };

  document.querySelectorAll('.net').forEach((b) => b.addEventListener('click', () => { network = b.dataset.net; document.querySelectorAll('.net').forEach((o) => o.setAttribute('aria-pressed', String(o === b))); }));
  document.querySelectorAll('#methods .opt').forEach((b) => b.addEventListener('click', () => { method = b.dataset.m; document.querySelectorAll('#methods .opt').forEach((o) => o.setAttribute('aria-pressed', String(o === b))); info(''); openMethod(); }));

  async function openWallet() {
    try {
      const me = await LP.api('GET', '/v1/me');
      $('walletWho').textContent = 'Connecté en tant que ' + (me.user.name || me.user.email);
      $('walletBalance').textContent = LP.money(me.wallet.available_balance, me.wallet.currency);
      show('choose', 'wallet');
    } catch (e) { if (e.signIn) { show('choose', 'auth'); mountAuth(openWallet); } else err(e.message); }
  }
  function openMethod() {
    const both = session.kind === 'PAYMENT' && session.methods.includes('mobile_money') && session.methods.includes('lightpay_wallet');
    if (!both) method = session.methods.includes('mobile_money') ? 'mobile_money' : 'lightpay_wallet';
    const extra = both ? ['choose'] : [];
    if (method === 'mobile_money') show(...extra, 'momo'); else openWallet();
  }

  const render = (s) => {
    session = s;
    $('merchant').textContent = s.kind === 'DEPOSIT' ? 'Recharge de votre wallet LightPay' : (s.payee ? s.merchant + ' · ' + s.payee : s.merchant);
    $('amount').textContent = LP.money(s.amount, s.currency);
    $('desc').textContent = s.kind === 'DEPOSIT' ? '' : [s.description, s.reference].filter(Boolean).join(' · ');
    $('escrow').hidden = !s.escrow;
    $('summary').hidden = false;
    if (s.status === 'COMPLETED') {
      stop(); info(''); show('done');
      $('doneTitle').textContent = s.kind === 'DEPOSIT' ? 'Wallet rechargé' : 'Paiement confirmé';
      if (s.return_url) { $('back').href = s.return_url; $('back').hidden = false; setTimeout(() => location.assign(s.return_url), 2500); }
    } else if (s.status === 'PROCESSING') {
      show('waiting');
      $('waitText').textContent = 'Demande envoyée au ' + (s.last_attempt ? s.last_attempt.msisdn : 'numéro indiqué') + '. Composez votre code secret pour confirmer.';
      start();
    } else if (s.status === 'OPEN') {
      const wasWaiting = !$('waiting').hidden || !$('loading').hidden;
      stop();
      if (wasWaiting) openMethod();
      const a = s.last_attempt;
      if (a && a.status === 'FAILED' && a.at !== lastAttemptAt) { lastAttemptAt = a.at; err(FAIL[a.failure_code] || 'Le paiement a échoué. Réessayez.'); }
    } else {
      stop(); show('closed');
      $('closedTitle').textContent = s.status === 'EXPIRED' ? 'Paiement expiré' : 'Paiement annulé';
      $('closedText').textContent = 'Revenez sur le site du marchand pour relancer votre commande.';
      if (s.cancel_url) { $('cancelBack').href = s.cancel_url; $('cancelBack').hidden = false; }
    }
  };
  const load = async () => {
    const res = await fetch('/v1/checkout/public/sessions/' + encodeURIComponent(id), { cache: 'no-store' });
    if (!res.ok) { stop(); show('closed'); $('closedText').textContent = 'Ce lien de paiement est invalide.'; return; }
    render((await res.json()).session);
  };
  const start = () => { if (!poll) poll = setInterval(load, 2000); };
  const stop = () => { clearInterval(poll); poll = null; };

  $('payMomo').onclick = async () => {
    const msisdn = $('msisdn').value.trim();
    if (msisdn.replace(/\\D/g, '').length < 9) return err('Entrez un numéro à 9 chiffres.');
    $('payMomo').disabled = true; info('');
    try {
      const res = await fetch('/v1/checkout/public/sessions/' + encodeURIComponent(id) + '/mobile-money', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msisdn, network }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return err(body.message || 'Le paiement n’a pas pu démarrer.');
      await load();
    } finally { $('payMomo').disabled = false; }
  };
  $('payWallet').onclick = async () => {
    $('payWallet').disabled = true; info('');
    try { render((await LP.api('POST', '/v1/checkout/public/sessions/' + encodeURIComponent(id) + '/wallet')).session); }
    catch (e) { if (e.signIn) { show('choose', 'auth'); mountAuth(openWallet); } else err(e.message); }
    finally { $('payWallet').disabled = false; }
  };

  if (!id) { show('closed'); $('closedText').textContent = 'Ce lien de paiement est invalide.'; }
  else load();
`,
    env
  );
