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
  .fees { margin-top:16px; border:1px solid var(--line); border-radius:12px; padding:10px 14px; font-size:13px; }
  .fees div { display:flex; justify-content:space-between; gap:12px; padding:3px 0; color:var(--muted); }
  .fees .total { color:var(--text); font-weight:650; border-top:1px solid var(--line); margin-top:6px; padding-top:8px; }
  .tabs { display:flex; gap:4px; margin-bottom:18px; overflow-x:auto; scrollbar-width:none; }
  .tab { flex:1; height:34px; border:1px solid var(--line); border-radius:99px; background:transparent; color:var(--muted); font:inherit; font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap; }
  .tab[aria-selected="true"] { background:var(--text); color:var(--bg); border-color:var(--text); }
  .actions { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:16px; }
  .panel { margin-top:4px; }
  .appcard { border:1px solid var(--line); border-radius:14px; padding:14px; margin-top:12px; }
  .apphead { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
  .btn.danger { background:transparent; color:var(--danger); border:1px solid color-mix(in srgb, var(--danger) 45%, transparent); }
  .linkbtn { display:flex; align-items:center; justify-content:center; text-decoration:none; }
  main:has(.tabs) { max-width:480px; }
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
    const api = async (method, path, body, idem) => {
      const t = await token();
      if (!t) throw Object.assign(new Error('Connectez-vous à LightPay.'), { signIn: true });
      const res = await fetch(path, {
        method, headers: { Authorization: 'Bearer ' + t, 'X-Environment': ENV, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(idem ? { 'Idempotency-Key': idem } : {}) },
        body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && data.error === 'RECENT_SIGN_IN_REQUIRED') throw Object.assign(new Error(data.message), { reauth: true });
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
      uuid: () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9_-]/g, ''),
      /** Change e-mail or password (Firebase asks for a recent sign-in). */
      updateIdentity: async (fields) => {
        const t = await token();
        if (!t) throw Object.assign(new Error('Connectez-vous à LightPay.'), { signIn: true });
        try {
          const d = await auth('accounts:update', { idToken: t, ...fields });
          const s = read();
          write({ ...s, idToken: d.idToken || s.idToken, refreshToken: d.refreshToken || s.refreshToken, email: d.email || s.email, expiresAt: d.idToken ? Date.now() + (Number(d.expiresIn) - 60) * 1000 : s.expiresAt });
        } catch (e) {
          if (/connexion impossible/i.test(e.message)) throw Object.assign(new Error('Confirmez votre mot de passe.'), { reauth: true });
          throw e;
        }
      },
      /** Deletes the sign-in identity (after the LightPay account was closed). */
      deleteIdentity: async () => {
        const t = await token();
        if (t) await fetch('https://identitytoolkit.googleapis.com/v1/accounts:delete?key=' + KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: t }) });
        write(null);
      },
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
    <div id="reauth" hidden>
      <h1>Confirmez votre identité</h1>
      <p class="muted">Pour votre sécurité, entrez votre mot de passe.</p>
      <label for="rePass">Mot de passe</label>
      <input id="rePass" type="password" autocomplete="current-password">
      <div class="row"><button class="btn ghost" id="reCancel" type="button">Annuler</button><button class="btn" id="reGo" type="button">Confirmer</button></div>
      <div class="msg" id="reMsg" role="status"></div>
    </div>
    <div id="space" hidden>
      <div class="tabs" role="tablist">
        <button class="tab" role="tab" data-tab="home" aria-selected="true">Accueil</button>
        <button class="tab" role="tab" data-tab="activity" aria-selected="false">Activité</button>
        <button class="tab" role="tab" data-tab="apps" aria-selected="false">Apps</button>
        <button class="tab" role="tab" data-tab="security" aria-selected="false">Sécurité</button>
      </div>

      <section data-pane="home">
        <p class="muted" id="who"></p>
        <div class="amount" id="available"></div>
        <p class="muted">disponible · <span id="locked"></span> bloqués</p>
        <p class="muted mt" id="closedNote" hidden>Ce compte est fermé.</p>
        <div class="actions" id="actions">
          <button class="opt" data-action="deposit" type="button">Recharger</button>
          <button class="opt" data-action="send" type="button">Envoyer</button>
          <button class="opt" data-action="withdraw" type="button">Retirer</button>
        </div>

        <div class="panel" data-panel="deposit" hidden>
          <label for="depAmount">Montant à recharger (FCFA, minimum 200)</label>
          <input id="depAmount" inputmode="numeric" placeholder="10 000">
          <button class="btn" id="depGo" type="button">Continuer vers le paiement mobile money</button>
        </div>

        <div class="panel" data-panel="send" hidden>
          <label for="sendTo">E-mail du destinataire LightPay</label>
          <input id="sendTo" type="email" autocomplete="off" placeholder="nom@exemple.com">
          <label for="sendAmount">Montant (FCFA)</label>
          <input id="sendAmount" inputmode="numeric">
          <label for="sendNote">Message (facultatif)</label>
          <input id="sendNote" maxlength="140">
          <button class="btn" id="sendGo" type="button">Envoyer</button>
        </div>

        <div class="panel" data-panel="withdraw" hidden>
          <label>Opérateur</label>
          <div class="nets" role="group" aria-label="Opérateur">
            <button type="button" class="opt wnet" data-net="MTN_MOMO_COG" aria-pressed="true">MTN MoMo</button>
            <button type="button" class="opt wnet" data-net="AIRTEL_COG" aria-pressed="false">Airtel Money</button>
          </div>
          <label for="wdNumber">Numéro qui reçoit</label>
          <input id="wdNumber" inputmode="tel" autocomplete="tel-national" placeholder="06 512 44 81">
          <label for="wdAmount">Montant (FCFA, minimum 500)</label>
          <input id="wdAmount" inputmode="numeric">
          <button class="btn" id="wdGo" type="button">Retirer</button>
          <ul class="list" id="withdrawals"></ul>
        </div>
        <div class="msg" id="homeMsg" role="status" aria-live="polite"></div>
        <div class="note">Les fonds bloqués sont des paiements en attente de validation d’une commande : ils ne peuvent être ni envoyés ni retirés.</div>
      </section>

      <section data-pane="activity" hidden>
        <ul class="list" id="moves"></ul>
        <p class="muted" id="noMoves" hidden>Aucun mouvement pour l’instant.</p>
      </section>

      <section data-pane="apps" hidden>
        <p class="muted">Les apps que vous avez autorisées et ce qu’elles peuvent faire.</p>
        <div id="apps"></div>
        <p class="muted mt" id="noApps" hidden>Aucune app n’a accès à votre compte.</p>
        <div class="msg" id="appsMsg" role="status"></div>
      </section>

      <section data-pane="security" hidden>
        <label>E-mail du compte</label>
        <p id="curEmail"></p>
        <label for="newEmail">Nouvel e-mail</label>
        <input id="newEmail" type="email" autocomplete="email">
        <button class="btn ghost" id="emailGo" type="button">Changer l’e-mail</button>
        <label for="newPass">Nouveau mot de passe</label>
        <input id="newPass" type="password" autocomplete="new-password" placeholder="6 caractères minimum">
        <button class="btn ghost" id="passGo" type="button">Changer le mot de passe</button>
        <div class="msg" id="secMsg" role="status"></div>
        <hr>
        <h1 class="h2">Supprimer mon compte</h1>
        <p class="muted">Possible uniquement si votre wallet est à zéro (réel et test) et qu’aucun paiement n’est en attente. Les apps connectées perdent leur accès. L’historique comptable est conservé.</p>
        <label for="delConfirm">Tapez SUPPRIMER pour confirmer</label>
        <input id="delConfirm" autocomplete="off">
        <button class="btn danger" id="delGo" type="button" disabled>Supprimer définitivement</button>
        <div class="msg" id="delMsg" role="status"></div>
        <hr>
        <div class="row">
          <a class="btn ghost linkbtn" id="envSwitch"></a>
          <button class="btn ghost" id="out" type="button">Se déconnecter</button>
        </div>
      </section>
    </div>
    <div id="bye" class="state" hidden><h2>Compte supprimé</h2><p>Votre compte LightPay a été fermé. Merci d’avoir utilisé LightPay.</p></div>`,
    `
  const $ = (x) => document.getElementById(x);
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  let me = null;
  const cur = () => (me ? me.wallet.currency : 'XAF');
  const digits = (v) => String(v || '').replace(/\\D/g, '');
  const say = (id, text, bad) => { $(id).className = 'msg' + (bad ? ' err' : ''); $(id).textContent = text || ''; };

  // Sensitive actions: ask the password again, then retry.
  let pending = null;
  async function guarded(action, msgId) {
    try { return await action(); }
    catch (e) {
      if (e.reauth) { pending = { action, msgId }; $('space').hidden = true; $('reauth').hidden = false; $('rePass').value = ''; $('rePass').focus(); return; }
      if (e.signIn) { $('space').hidden = true; mountAuth(boot); return; }
      say(msgId, e.message, true);
    }
  }
  $('reCancel').onclick = () => { pending = null; $('reauth').hidden = true; $('space').hidden = false; };
  $('reGo').onclick = async () => {
    $('reGo').disabled = true; say('reMsg', '');
    try {
      await LP.signIn(LP.email(), $('rePass').value);
      $('reauth').hidden = true; $('space').hidden = false;
      const p = pending; pending = null;
      if (p) await guarded(p.action, p.msgId);
    } catch (e) { say('reMsg', e.message, true); }
    finally { $('reGo').disabled = false; }
  };
  $('rePass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('reGo').click(); });

  // Tabs.
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((o) => o.setAttribute('aria-selected', String(o === t)));
    document.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== t.dataset.tab));
    if (t.dataset.tab === 'activity') loadActivity();
    if (t.dataset.tab === 'apps') loadApps();
  }));

  // Home actions.
  let openPanel = null;
  document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => {
    openPanel = openPanel === b.dataset.action ? null : b.dataset.action;
    document.querySelectorAll('[data-action]').forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.action === openPanel)));
    document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== openPanel));
    say('homeMsg', '');
    if (openPanel === 'withdraw') loadWithdrawals();
  }));
  let wnet = 'MTN_MOMO_COG';
  document.querySelectorAll('.wnet').forEach((b) => b.addEventListener('click', () => { wnet = b.dataset.net; document.querySelectorAll('.wnet').forEach((o) => o.setAttribute('aria-pressed', String(o === b))); }));

  $('depGo').onclick = () => guarded(async () => {
    const amount = digits($('depAmount').value);
    if (!amount) return say('homeMsg', 'Indiquez un montant.', true);
    const r = await LP.api('POST', '/v1/me/deposits', { amount }, LP.uuid());
    location.assign(r.checkout_path);
  }, 'homeMsg');

  let sendKey = LP.uuid();
  $('sendGo').onclick = () => guarded(async () => {
    const amount = digits($('sendAmount').value);
    if (!amount) return say('homeMsg', 'Indiquez un montant.', true);
    $('sendGo').disabled = true;
    try {
      const r = await LP.api('POST', '/v1/me/transfers', { to: $('sendTo').value.trim(), amount, note: $('sendNote').value.trim() }, sendKey);
      sendKey = LP.uuid();
      $('sendAmount').value = ''; $('sendNote').value = '';
      say('homeMsg', LP.money(r.transfer.amount, cur()) + ' envoyés à ' + (r.transfer.to.name || r.transfer.to.email) + '.');
      loadHome();
    } finally { $('sendGo').disabled = false; }
  }, 'homeMsg');

  let wdKey = LP.uuid();
  $('wdGo').onclick = () => guarded(async () => {
    const amount = digits($('wdAmount').value);
    if (!amount) return say('homeMsg', 'Indiquez un montant.', true);
    $('wdGo').disabled = true;
    try {
      const r = await LP.api('POST', '/v1/me/withdrawals', { amount, msisdn: $('wdNumber').value, network: wnet }, wdKey);
      wdKey = LP.uuid();
      const w = r.withdrawal;
      say('homeMsg', w.status === 'FAILED' ? 'Le retrait a échoué, le montant a été restitué.' : LP.money(w.amount, cur()) + ' envoyés au ' + w.to + '.', w.status === 'FAILED');
      $('wdAmount').value = '';
      loadHome(); loadWithdrawals();
    } finally { $('wdGo').disabled = false; }
  }, 'homeMsg');

  async function loadWithdrawals() {
    try {
      const { withdrawals } = await LP.api('GET', '/v1/me/withdrawals');
      $('withdrawals').replaceChildren(...withdrawals.slice(0, 5).map((w) => {
        const li = el('li'); const info = el('div', undefined, 'grow');
        info.append(el('span', 'Retrait vers ' + w.to), el('br'), el('span', new Date(w.created_at).toLocaleString('fr-FR') + ' · ' + ({ SUCCEEDED: 'envoyé', PENDING: 'en cours', FAILED: 'échoué, restitué' }[w.status] || w.status), 'muted'));
        li.append(info, el('span', LP.money(w.amount, w.currency), 'num'));
        return li;
      }));
    } catch {}
  }

  async function loadHome() {
    me = await LP.api('GET', '/v1/me');
    $('who').textContent = (me.user.name || me.user.email || '') + (LP.ENV === 'sandbox' ? ' · environnement de test' : '');
    $('available').textContent = LP.money(me.wallet.available_balance, cur());
    $('locked').textContent = LP.money(me.wallet.locked_balance, cur());
    const closed = me.wallet.status !== 'ACTIVE';
    $('closedNote').hidden = !closed; $('actions').hidden = closed;
    $('curEmail').textContent = me.user.email || '—';
  }

  async function loadActivity() {
    await guarded(async () => {
      const { entries } = await LP.api('GET', '/v1/me/transactions?limit=50');
      $('moves').replaceChildren(...entries.map((e) => {
        const li = el('li'); const info = el('div', undefined, 'grow');
        info.append(el('span', e.description || e.type), el('br'), el('span', new Date(e.created_at).toLocaleString('fr-FR') + (e.bucket === 'LOCKED' ? ' · bloqué' : ''), 'muted'));
        li.append(info, el('span', (e.direction === 'CREDIT' ? '+' : '−') + LP.money(e.amount, cur()), 'num'));
        return li;
      }));
      $('noMoves').hidden = entries.length > 0;
    }, 'homeMsg');
  }

  async function loadApps() {
    await guarded(async () => {
      const { connections, scope_labels } = await LP.api('GET', '/v1/me/connections');
      const active = connections.filter((c) => c.status === 'ACTIVE');
      $('apps').replaceChildren(...active.map((c) => {
        const card = el('div', undefined, 'appcard');
        const head = el('div', undefined, 'apphead');
        head.append(el('strong', c.app_name), el('span', 'depuis le ' + new Date(c.created_at).toLocaleDateString('fr-FR'), 'muted'));
        const perms = el('ul', undefined, 'list');
        c.scopes.forEach((s) => {
          const li = el('li'); li.append(el('span', scope_labels[s] || s, 'grow'));
          if (c.scopes.length > 1) {
            const rm = el('button', 'Retirer', 'link'); rm.type = 'button';
            rm.onclick = () => guarded(async () => { await LP.api('PATCH', '/v1/me/connections/' + encodeURIComponent(c.id), { scopes: c.scopes.filter((x) => x !== s) }); loadApps(); }, 'appsMsg');
            li.append(rm);
          }
          perms.append(li);
        });
        card.append(head, perms);
        if (c.scopes.includes('charge')) {
          const lab = el('label', 'Montant maximum par débit (FCFA)'); const inp = el('input'); inp.inputMode = 'numeric'; inp.value = c.charge_limit;
          const save = el('button', 'Enregistrer la limite', 'btn ghost'); save.type = 'button';
          save.onclick = () => guarded(async () => { await LP.api('PATCH', '/v1/me/connections/' + encodeURIComponent(c.id), { charge_limit: digits(inp.value) }); say('appsMsg', 'Limite mise à jour.'); }, 'appsMsg');
          card.append(lab, inp, save);
        }
        const revoke = el('button', 'Révoquer l’accès de ' + c.app_name, 'btn danger'); revoke.type = 'button';
        revoke.onclick = () => guarded(async () => { await LP.api('DELETE', '/v1/me/connections/' + encodeURIComponent(c.id)); say('appsMsg', c.app_name + ' n’a plus accès à votre compte.'); loadApps(); }, 'appsMsg');
        card.append(revoke);
        return card;
      }));
      $('noApps').hidden = active.length > 0;
    }, 'appsMsg');
  }

  // Security.
  $('emailGo').onclick = () => guarded(async () => {
    const email = $('newEmail').value.trim();
    if (!email) return say('secMsg', 'Indiquez le nouvel e-mail.', true);
    await LP.updateIdentity({ email });
    $('newEmail').value = ''; say('secMsg', 'E-mail mis à jour.'); loadHome();
  }, 'secMsg');
  $('passGo').onclick = () => guarded(async () => {
    const password = $('newPass').value;
    if (password.length < 6) return say('secMsg', 'Mot de passe trop court (6 caractères minimum).', true);
    await LP.updateIdentity({ password });
    $('newPass').value = ''; say('secMsg', 'Mot de passe mis à jour.');
  }, 'secMsg');
  $('delConfirm').addEventListener('input', () => { $('delGo').disabled = $('delConfirm').value.trim() !== 'SUPPRIMER'; });
  $('delGo').onclick = () => guarded(async () => {
    $('delGo').disabled = true;
    try {
      await LP.api('DELETE', '/v1/me');
      await LP.deleteIdentity();
      $('space').hidden = true; $('bye').hidden = false;
    } finally { $('delGo').disabled = $('delConfirm').value.trim() !== 'SUPPRIMER'; }
  }, 'delMsg');

  $('envSwitch').textContent = LP.ENV === 'sandbox' ? 'Passer au compte réel' : 'Voir mon compte de test';
  $('envSwitch').href = LP.ENV === 'sandbox' ? '/account' : '/account?env=sandbox';
  $('out').onclick = () => { LP.signOut(); $('space').hidden = true; mountAuth(boot); };

  async function boot() {
    try { await loadHome(); $('space').hidden = false; }
    catch (e) { if (e.signIn) { $('space').hidden = true; mountAuth(boot); } else { $('space').hidden = false; say('homeMsg', e.message, true); } }
  }
  LP.signedIn() ? boot() : mountAuth(boot);
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
      <div class="fees" id="feeBox" aria-live="polite"></div>
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
  const FAIL = {
    INSUFFICIENT_BALANCE: 'Solde insuffisant sur ce compte mobile money.',
    PAYER_DECLINED: 'Paiement refusé depuis le téléphone.',
    PAYER_TIMEOUT: 'Aucune confirmation reçue à temps. Réessayez.',
    PROVIDER_FAILED: 'Paiement refusé par l’opérateur : solde insuffisant, code secret incorrect ou validation non faite à temps. Vérifiez votre solde, puis réessayez.',
    PROVIDER_CANCELLED: 'Paiement annulé depuis le téléphone.',
    PROVIDER_EXPIRED: 'La demande a expiré sans validation. Réessayez.',
  };
  const failText = (code) => FAIL[code] || (code && code.startsWith('PROVIDER_') ? 'L’opérateur a refusé ce paiement (' + code.slice(9).toLowerCase().replace(/_/g, ' ') + '). Réessayez ou changez de numéro.' : 'Le paiement a échoué. Réessayez.');
  let session = null, method = 'mobile_money', network = 'MTN_MOMO_COG', poll = null, lastAttemptAt = null;
  const err = (t) => { $('msg').className = 'msg err'; $('msg').textContent = t; };
  const info = (t) => { $('msg').className = 'msg'; $('msg').textContent = t; };

  document.querySelectorAll('.net').forEach((b) => b.addEventListener('click', () => { network = b.dataset.net; document.querySelectorAll('.net').forEach((o) => o.setAttribute('aria-pressed', String(o === b))); renderFees(); }));

  // Full transparency: amount, LightPay fee, operator fee, total, before paying.
  function renderFees() {
    const q = session && session.fees && session.fees[network];
    if (!q) { $('feeBox').hidden = true; $('payMomo').textContent = 'Payer'; return; }
    const cur = session.currency;
    const row = (label, value, cls) => { const d = document.createElement('div'); if (cls) d.className = cls; const a = document.createElement('span'); a.textContent = label; const b = document.createElement('span'); b.textContent = value; d.append(a, b); return d; };
    const approx = q.estimated ? '≈ ' : '';
    $('feeBox').replaceChildren(
      row(session.kind === 'DEPOSIT' ? 'Recharge' : 'Montant', LP.money(q.amount, cur)),
      row('Frais LightPay', LP.money(q.lightpay_fee, cur)),
      row('Frais opérateur', q.operator_fee === '0' ? 'inclus' : approx + LP.money(q.operator_fee, cur)),
      row('Total à payer', approx + LP.money(q.total, cur), 'total'),
    );
    $('feeBox').hidden = false;
    const tooSmall = Number(q.amount) < Number(q.minimum);
    $('payMomo').disabled = tooSmall;
    if (tooSmall) { $('payMomo').textContent = 'Minimum ' + LP.money(q.minimum, cur) + ' par mobile money'; return; }
    $('payMomo').textContent = 'Payer ' + approx + LP.money(q.total, cur);
  }
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
    renderFees();
    if (s.status === 'COMPLETED') {
      stop(); info(''); show('done');
      $('doneTitle').textContent = s.kind === 'DEPOSIT' ? 'Wallet rechargé' : 'Paiement confirmé';
      if (s.return_url) { $('back').href = s.return_url; $('back').hidden = false; setTimeout(() => location.assign(s.return_url), 2500); }
      else if (s.kind === 'DEPOSIT') { $('back').href = s.environment === 'sandbox' ? '/account?env=sandbox' : '/account'; $('back').textContent = 'Retour à mon compte'; $('back').hidden = false; }
    } else if (s.status === 'PROCESSING') {
      show('waiting');
      const a = s.last_attempt;
      const total = a && a.charged ? LP.money(a.charged, s.currency) : (s.fees && a && s.fees[a.network] ? (s.fees[a.network].estimated ? '≈ ' : '') + LP.money(s.fees[a.network].total, s.currency) : '');
      $('waitText').textContent = 'Demande envoyée au ' + (a ? a.msisdn : 'numéro indiqué') + (total ? ' pour ' + total + ' (frais compris)' : '') + '. Composez votre code secret pour confirmer.';
      start();
    } else if (s.status === 'OPEN') {
      const wasWaiting = !$('waiting').hidden || !$('loading').hidden;
      stop();
      if (wasWaiting) openMethod();
      const a = s.last_attempt;
      if (a && a.status === 'FAILED' && a.at !== lastAttemptAt) { lastAttemptAt = a.at; err(failText(a.failure_code)); }
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
