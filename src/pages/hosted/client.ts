import { ICON_PATHS } from './icons.js';

export const FIREBASE_WEB_API_KEY = () => process.env.LIGHTPAY_FIREBASE_WEB_API_KEY || 'AIzaSyAyOdD8qSUfx8wvHhb5F4EJ4zKjavwnpeI';

/**
 * Browser script shared by every hosted page (plain JS, no template literals inside so it
 * can live in this TS template string).
 *
 * LP                  LightPay client
 *   LP.ENV            'production' | 'sandbox'   LP.setEnv(env): switch ledger in place (badges + URL follow)
 *   LP.signedIn() / LP.email() / LP.signIn(email, pw) / LP.signUp(email, pw, name) / LP.signOut()
 *   LP.resetPassword(email)
 *   LP.api(method, path, body?, idempotencyKey?) -> JSON   throws Error with .signIn (sign in again)
 *                                                           or .reauth (confirm password) or .status
 *   LP.live(onChange) -> stop()   onChange() when the wallet moves (server-sent signal, reconnects)
 *   LP.money(value, currency) · LP.uuid() · LP.updateIdentity({email}|{password}) · LP.deleteIdentity()
 * UI kit
 *   $(id) · el(tag, props?, children?) (props: class, text, on:{event:fn}, any attribute)
 *   icon(name, cls?) · initials(text) · digits(value) · debounce(fn, ms)
 *   say(target, text, kind?)       kind: 'err' | 'ok' | undefined (aria-live line)
 *   feeRows(container, rows)       rows: [[label, value, isTotal?]]
 *   listRow({ icon, iconClass, title, sub, end, endClass, href, onClick, chev }) -> <li>
 *   dayLabel(date) · timeLabel(date) · showOnly(section)
 *   skeleton(host, n?, tag?)       shimmer rows in an empty list while it loads
 *   createNav({ root, screens: { name: { parent, enter(param) } }, resolve(route) -> [name, param], onRootBack, onEnter(current) })
 *     -> { start(), go(route, replace?), back(), home(), current() }   (hash routes #/route; the
 *        browser back button and every [data-back] button use the same history)
 *   mountAuth(onDone, { title?, subtitle?, onBack?, aside?, noSignUp? })   sign in / sign up / reset, in <section id="auth">
 *     (aside: a brand panel shown beside the form on wide screens)
 */
export const CLIENT = (env: string) => `
  // AbortSignal with a deadline (older browsers: none, the call just has no deadline).
  const deadline = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
  const LP = (() => {
    const KEY = ${JSON.stringify(FIREBASE_WEB_API_KEY())};
    let ENV = ${JSON.stringify(env)};
    const STORE = 'lightpay.session';
    // Kept on LightPay's own origin, shared by its tabs and windows: signed in once, the account,
    // a payment page or the wallet window opened from a dialog all know the person.
    // A session handed over by the app's page (payment dialog): memory only, never stored.
    let lent = null;
    const read = () => { if (lent) return lent; try { return JSON.parse(localStorage.getItem(STORE) || sessionStorage.getItem(STORE) || 'null'); } catch (e) { return null; } };
    const write = (s) => { lent = null; try { sessionStorage.removeItem(STORE); s ? localStorage.setItem(STORE, JSON.stringify(s)) : localStorage.removeItem(STORE); } catch (e) {} };
    const ERRORS = {
      EMAIL_EXISTS: 'Un compte existe déjà avec cet e-mail.',
      EMAIL_NOT_FOUND: 'E-mail ou mot de passe incorrect.',
      INVALID_PASSWORD: 'E-mail ou mot de passe incorrect.',
      INVALID_LOGIN_CREDENTIALS: 'E-mail ou mot de passe incorrect.',
      WEAK_PASSWORD: 'Mot de passe trop court (6 caractères minimum).',
      INVALID_EMAIL: 'Adresse e-mail invalide.',
      MISSING_PASSWORD: 'Entrez votre mot de passe.',
      TOO_MANY_ATTEMPTS_TRY_LATER: 'Trop de tentatives, réessayez plus tard.',
      USER_DISABLED: 'Ce compte est désactivé.',
    };
    const auth = async (path, body) => {
      const res = await fetch('https://identitytoolkit.googleapis.com/v1/' + path + '?key=' + KEY, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, body, { returnSecureToken: true })),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = ((data.error && data.error.message) || '').split(' ')[0];
        throw Object.assign(new Error(ERRORS[code] || 'Connexion impossible.'), { code: code });
      }
      return data;
    };
    const save = (d) => write({ idToken: d.idToken, refreshToken: d.refreshToken, expiresAt: Date.now() + (Number(d.expiresIn) - 60) * 1000, email: d.email });
    const token = async () => {
      const s = read();
      if (!s) return null;
      if (s.expiresAt > Date.now()) return s.idToken;
      if (!s.refreshToken) { write(null); return null; }
      const res = await fetch('https://securetoken.googleapis.com/v1/token?key=' + KEY, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(s.refreshToken),
      });
      if (!res.ok) { write(null); return null; }
      const d = await res.json();
      write(Object.assign({}, s, { idToken: d.id_token, refreshToken: d.refresh_token, expiresAt: Date.now() + (Number(d.expires_in) - 60) * 1000 }));
      return d.id_token;
    };
    const api = async (method, path, body, idem) => {
      const t = await token();
      if (!t) throw Object.assign(new Error('Connectez-vous à LightPay.'), { signIn: true });
      const headers = { Authorization: 'Bearer ' + t, 'X-Environment': ENV };
      if (body) headers['Content-Type'] = 'application/json';
      if (idem) headers['Idempotency-Key'] = idem;
      // Never waits forever: past 25 s the call is given up (an idempotency key makes a retry safe).
      const res = await fetch(path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: deadline(25000) })
        .catch((e) => { throw new Error(e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'Le serveur ne répond pas. Vérifiez votre connexion et réessayez.' : 'Connexion impossible. Vérifiez votre réseau et réessayez.'); });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && data.error === 'RECENT_SIGN_IN_REQUIRED') throw Object.assign(new Error(data.message), { reauth: true });
      if (res.status === 401) { write(null); throw Object.assign(new Error(data.message || 'Session expirée.'), { signIn: true }); }
      if (!res.ok) throw Object.assign(new Error(data.message || 'Une erreur est survenue.'), { status: res.status, code: data.error });
      return data;
    };
    return {
      get ENV() { return ENV; },
      // Test <-> real without reloading: next calls use the other ledger; [data-env-badge]
      // elements and ?env= in the address follow. The page re-reads what it shows.
      setEnv: (next) => {
        ENV = next === 'sandbox' ? 'sandbox' : 'production';
        document.querySelectorAll('[data-env-badge]').forEach((b) => { b.hidden = ENV !== 'sandbox'; });
        try {
          const u = new URL(location.href);
          if (ENV === 'sandbox') u.searchParams.set('env', 'sandbox'); else u.searchParams.delete('env');
          history.replaceState(history.state, '', u.toString());
        } catch (e) { /* address only */ }
      },
      signedIn: () => Boolean(read()),
      // The person is already signed in on the app (same LightPay identity): use their current
      // ID token for this page only. LightPay's API still verifies it on every call.
      lend: (idToken) => {
        try {
          const p = JSON.parse(atob(String(idToken).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (!p.exp || p.exp * 1000 < Date.now() + 60000) return false;
          lent = { idToken: String(idToken), refreshToken: null, expiresAt: p.exp * 1000 - 60000, email: p.email || '' };
          return true;
        } catch (e) { return false; }
      },
      email: () => (read() || {}).email || '',
      signIn: async (email, password) => save(await auth('accounts:signInWithPassword', { email: email, password: password })),
      signUp: async (email, password, name) => {
        const d = await auth('accounts:signUp', { email: email, password: password });
        if (name) { const u = await auth('accounts:update', { idToken: d.idToken, displayName: name }); d.idToken = u.idToken || d.idToken; }
        save(d);
      },
      resetPassword: async (email) => {
        const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=' + KEY, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: email }),
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); const code = ((d.error && d.error.message) || '').split(' ')[0]; if (code !== 'EMAIL_NOT_FOUND') throw new Error(ERRORS[code] || 'Envoi impossible.'); }
      },
      signOut: () => write(null),
      api: api,
      // Live signal (GET /v1/me/stream): onChange() runs shortly after the wallet moves, and once
      // after each reconnection (to catch up). Reconnects on its own; returns a stop function.
      live: (onChange) => {
        let stopped = false, first = true, wait = 1000, timer = null;
        const fire = () => { clearTimeout(timer); timer = setTimeout(() => { if (!stopped) onChange(); }, 200); };
        const run = async () => {
          while (!stopped) {
            try {
              const t = await token();
              if (!t) return;
              const res = await fetch('/v1/me/stream', { headers: { Authorization: 'Bearer ' + t, 'X-Environment': ENV, Accept: 'text/event-stream' }, cache: 'no-store' });
              if (res.status === 401) return;
              if (!res.ok || !res.body) throw new Error('stream');
              if (!first) fire();
              first = false; wait = 1000;
              const reader = res.body.getReader();
              const dec = new TextDecoder();
              let buf = '';
              for (;;) {
                const r = await reader.read();
                if (r.done || stopped) break;
                buf += dec.decode(r.value, { stream: true });
                let i;
                while ((i = buf.indexOf('\\n\\n')) >= 0) {
                  if (buf.slice(0, i).indexOf('event: change') === 0) fire();
                  buf = buf.slice(i + 2);
                }
              }
            } catch (e) { /* retry below */ }
            if (stopped) return;
            await new Promise((r) => setTimeout(r, wait));
            wait = Math.min(wait * 2, 30000);
          }
        };
        run();
        return () => { stopped = true; clearTimeout(timer); };
      },
      // Thousands with a no-break space Poppins draws (its narrow one renders as nothing).
      money:(v, c) => Number(v).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, '\u00a0') + ' ' + (!c || c === 'XAF' ? 'FCFA' : c),
      uuid: () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9_-]/g, ''),
      updateIdentity: async (fields) => {
        const t = await token();
        if (!t) throw Object.assign(new Error('Connectez-vous à LightPay.'), { signIn: true });
        try {
          const d = await auth('accounts:update', Object.assign({ idToken: t }, fields));
          const s = read();
          write(Object.assign({}, s, { idToken: d.idToken || s.idToken, refreshToken: d.refreshToken || s.refreshToken, email: d.email || s.email, expiresAt: d.idToken ? Date.now() + (Number(d.expiresIn) - 60) * 1000 : s.expiresAt }));
        } catch (e) {
          if (e.code === 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN' || e.code === 'TOKEN_EXPIRED' || /connexion impossible/i.test(e.message)) throw Object.assign(new Error('Confirmez votre mot de passe.'), { reauth: true });
          throw e;
        }
      },
      deleteIdentity: async () => {
        const t = await token();
        if (t) await fetch('https://identitytoolkit.googleapis.com/v1/accounts:delete?key=' + KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: t }) });
        write(null);
      },
    };
  })();

  // ------------------------------------------------------------------ UI kit
  const ICONS = ${JSON.stringify(ICON_PATHS)};
  const $ = (id) => document.getElementById(id);
  function icon(name, cls) {
    const s = document.createElement('span');
    s.innerHTML = '<svg class="' + (cls || 'i') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>';
    return s.firstChild;
  }
  function el(tag, props, children) {
    const n = document.createElement(tag);
    Object.entries(props || {}).forEach(function (kv) {
      const k = kv[0], v = kv[1];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'on') Object.entries(v).forEach(function (ev) { n.addEventListener(ev[0], ev[1]); });
      else n.setAttribute(k, v === true ? '' : String(v));
    });
    (children || []).forEach(function (c) { if (c === null || c === undefined || c === false) return; n.append(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  const initials = (s) => String(s || '?').replace(/@.*/, '').split(/[\\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const digits = (v) => String(v || '').replace(/\\D/g, '');
  // Amounts are whole FCFA (no centimes): spaces are fine (1 000), anything else makes the amount
  // invalid — "100,50" must never become 10050.
  const amountDigits = (v) => { const s = String(v || '').replace(/[\\s\\u00a0\\u202f]/g, ''); return /^\\d+$/.test(s) ? s : ''; };
  document.addEventListener('input', function (e) {
    const t = e.target;
    if (!t || !t.hasAttribute || !t.hasAttribute('data-amount')) return;
    const bad = /[^\\d\\s\\u00a0\\u202f]/.test(t.value);
    t.setAttribute('aria-invalid', bad ? 'true' : 'false');
    const box = t.closest('.amount-wrap, .input-prefix') || t;
    let warn = box.nextElementSibling && box.nextElementSibling.classList.contains('amount-bad') ? box.nextElementSibling : null;
    if (bad && !warn) { warn = el('p', { class: 'amount-bad', role: 'alert', text: 'Montant en FCFA entiers, sans virgule ni point (ex. 1000).' }); box.after(warn); }
    if (!bad && warn) warn.remove();
  }, true);
  // Congo prefixes: MTN 06, Airtel 05 and 04 (a number only works with its own operator).
  const networkOf = (national) => (/^06/.test(national) ? 'MTN_MOMO_COG' : /^0[45]/.test(national) ? 'AIRTEL_COG' : null);
  const debounce = (fn, ms) => { let t = null; return function () { const a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; };
  function say(target, text, kind) {
    const n = typeof target === 'string' ? $(target) : target;
    if (!n) return;
    n.className = 'msg' + (kind ? ' ' + kind : '');
    n.textContent = text || '';
  }
  function feeRows(container, rows) {
    container.replaceChildren.apply(container, rows.map(function (r) {
      return el('div', { class: 'fees-row' + (r[2] ? ' total' : '') }, [el('span', { text: r[0] }), el('span', { text: r[1] })]);
    }));
  }
  function listRow(o) {
    const inner = [
      o.icon ? el('span', { class: 'row-icon' + (o.iconClass ? ' ' + o.iconClass : '') }, [typeof o.icon === 'string' ? icon(o.icon) : o.icon]) : null,
      el('span', { class: 'row-main' }, [el('span', { class: 'row-title', text: o.title }), o.sub ? el('span', { class: 'row-sub', text: o.sub }) : null]),
      o.end !== undefined && o.end !== null ? (typeof o.end === 'string' ? el('span', { class: 'row-end' + (o.endClass ? ' ' + o.endClass : ''), text: o.end }) : el('span', { class: 'row-end' }, [o.end])) : null,
      o.chev ? icon('chevron-right', 'chev') : null,
    ];
    const cls = 'row';
    const node = o.href ? el('a', { class: cls, href: o.href }, inner) : o.onClick ? el('button', { class: cls, type: 'button', on: { click: o.onClick } }, inner) : el('div', { class: cls }, inner);
    return el('li', {}, [node]);
  }
  function skeleton(host, n, tag) {
    if (!host || host.children.length) return;
    const rows = [];
    for (let i = 0; i < (n || 3); i++) {
      rows.push(el(tag || 'li', { class: 'sk-row', 'aria-hidden': 'true' }, [
        el('span', { class: 'sk sk-ic' }),
        el('span', { class: 'sk-lines' }, [el('span', { class: 'sk sk-t ' + ['w-60', 'w-45', 'w-75'][i % 3] }), el('span', { class: 'sk sk-s ' + ['w-30', 'w-45', 'w-30'][i % 3] })]),
        el('span', { class: 'sk sk-amt' }),
      ]));
    }
    host.replaceChildren.apply(host, rows);
  }
  // Last step before money moves: a bottom sheet with what will happen. Resolves true once
  // (the confirm button locks at the first tap: a double or triple tap starts nothing twice).
  function confirmSheet(o) {
    return new Promise((resolve) => {
      const before = document.activeElement;
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        overlay.classList.add('closing');
        setTimeout(() => overlay.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
        document.removeEventListener('keydown', onKey);
        if (!ok && before && before.focus) before.focus();
        resolve(ok);
      };
      const onKey = (e) => { if (e.key === 'Escape') finish(false); };
      const go = el('button', { class: 'btn', type: 'button', text: o.confirm || 'Confirmer', on: { click: () => { go.disabled = true; finish(true); } } });
      const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title }, [
        el('p', { class: 'eyebrow', text: o.title }),
        o.amount ? el('div', { class: 'amount-xl sheet-amount', text: o.amount }) : null,
        el('div', { class: 'receipt' }, o.rows.map((r) => el('div', { class: 'fees-row' + (r[2] ? ' total' : '') }, [el('span', { text: r[0] }), el('span', { text: r[1] })]))),
        o.note ? el('p', { class: 'small muted mt', text: o.note }) : null,
        el('div', { class: 'btn-row mt-lg' }, [el('button', { class: 'btn btn-secondary', type: 'button', text: 'Annuler', on: { click: () => finish(false) } }), go]),
      ]);
      const overlay = el('div', { class: 'overlay' }, [sheet]);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
      document.addEventListener('keydown', onKey);
      // In the app frame (the bottom sheet sits on its bottom edge, on phones and in the card).
      (document.querySelector('.app') || document.body).append(overlay);
      go.focus();
    });
  }
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  function dayLabel(d) {
    const date = new Date(d); const today = new Date(); const y = new Date(); y.setDate(y.getDate() - 1);
    if (sameDay(date, today)) return 'Aujourd’hui';
    if (sameDay(date, y)) return 'Hier';
    return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  const timeLabel = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  // Theme: the app's (?theme=) or the saved choice, else night like Salacope. Every [data-theme-toggle] flips it.
  function currentTheme() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t) return t;
    return 'dark';
  }
  document.addEventListener('click', function (e) {
    const b = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (!b) return;
    const next = currentTheme() === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('lightpay.theme', next); } catch (err) {}
  });
  function themeButton() {
    return el('button', { class: 'icon-btn', type: 'button', 'data-theme-toggle': true, 'aria-label': 'Changer de thème' }, [
      el('span', { class: 'theme-light-icon' }, [icon('sun')]), el('span', { class: 'theme-dark-icon' }, [icon('moon')]),
    ]);
  }
  function showOnly(section) {
    document.querySelectorAll('.screen').forEach(function (s) { s.hidden = s !== section; });
    // Console layout: the menu and top bar go away on the sign-in screen.
    const frame = document.querySelector('.console-shell');
    if (frame) frame.hidden = !frame.contains(section);
  }

  // Hash-route navigator: #/route. The on-screen back button and the browser back button share
  // the same history; a screen opened directly falls back to its declared parent.
  function createNav(opts) {
    const stack = [];
    let replacing = false;
    let current = null;
    const parse = () => { try { return decodeURIComponent(location.hash.replace(/^#\\/?/, '')) || opts.root; } catch (e) { return opts.root; } };
    function render() {
      const route = parse();
      let resolved = opts.resolve ? opts.resolve(route) : [route, null];
      if (!resolved || !opts.screens[resolved[0]]) resolved = [opts.root, null];
      if (replacing && stack.length) stack[stack.length - 1] = route;
      else if (stack.length > 1 && stack[stack.length - 2] === route) stack.pop();
      else if (stack[stack.length - 1] !== route) stack.push(route);
      replacing = false;
      const sameScreen = current && current.name === resolved[0];
      current = { route: route, name: resolved[0], param: resolved[1] };
      const section = document.querySelector('[data-screen="' + resolved[0] + '"]');
      if (section) {
        showOnly(section);
        const h = section.querySelector('h1');
        if (h && !sameScreen) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
      }
      // A list + detail screen keeps its scroll when another item is opened.
      if (!sameScreen) {
        window.scrollTo(0, 0);
        const body = document.querySelector('.console-body');
        if (body) body.scrollTop = 0;
      }
      const def = opts.screens[resolved[0]];
      if (opts.onEnter) opts.onEnter(current);
      if (def.enter) def.enter(resolved[1]);
    }
    const api = {
      start: render,
      current: () => current,
      go: function (route, replace) {
        const hash = '#/' + route;
        if (location.hash === hash || (route === opts.root && !location.hash)) { if (replace) replacing = true; render(); return; }
        replacing = Boolean(replace);
        if (replace) location.replace(hash); else location.hash = hash;
      },
      back: function () {
        if (stack.length > 1) { history.back(); return; }
        const parent = current && opts.screens[current.name] ? opts.screens[current.name].parent : null;
        if (parent !== null && parent !== undefined) api.go(parent, true);
        else if (opts.onRootBack) opts.onRootBack();
      },
      home: function () {
        const i = stack.lastIndexOf(opts.root);
        if (i >= 0 && i < stack.length - 1) history.go(i - (stack.length - 1));
        else api.go(opts.root, true);
      },
    };
    window.addEventListener('hashchange', render);
    document.addEventListener('click', function (e) {
      const b = e.target.closest && e.target.closest('[data-back]');
      if (b && !b.closest('#auth')) { e.preventDefault(); api.back(); }
    });
    return api;
  }

  // Sign in / sign up / reset password, rendered in <section id="auth" class="screen">.
  function mountAuth(onDone, options) {
    const o = options || {};
    const box = $('auth');
    let mode = 'in';
    function render() {
      const title = mode === 'in' ? (o.title || 'Connexion à LightPay') : mode === 'up' ? 'Créer votre compte LightPay' : 'Mot de passe oublié';
      const sub = mode === 'reset' ? 'Recevez un lien pour choisir un nouveau mot de passe.' : (o.subtitle || 'Un seul compte pour payer, recevoir et envoyer de l’argent.');
      const back = o.onBack ? el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Retour', on: { click: o.onBack } }, [icon('arrow-left')]) : null;
      const bar = el('header', { class: 'topbar' }, [back, el('span', { class: 'topbar-title' + (back ? '' : ' pad') }, []), el('span', { class: 'topbar-end' }, [LP.ENV === 'sandbox' ? el('span', { class: 'badge', text: 'Test' }) : null, themeButton()])]);
      const fields = [];
      const field = (id, label, type, auto) => {
        const input = el('input', { id: id, type: type, autocomplete: auto, required: true });
        fields.push(input);
        return el('div', { class: 'field' }, [el('label', { for: id, text: label }), input]);
      };
      const nameF = mode === 'up' ? field('lp-name', 'Nom complet', 'text', 'name') : null;
      const emailF = field('lp-email', 'E-mail', 'email', 'email');
      const passF = mode === 'reset' ? null : field('lp-pass', 'Mot de passe', 'password', mode === 'in' ? 'current-password' : 'new-password');
      const msg = el('div', { class: 'msg', role: 'status', 'aria-live': 'polite' });
      const btn = el('button', { class: 'btn', type: 'submit', text: mode === 'in' ? 'Se connecter' : mode === 'up' ? 'Créer mon compte' : 'Envoyer le lien' });
      const switcher = o.noSignUp && mode === 'in' ? null : el('p', { class: 'small muted center mt-lg' }, mode === 'in'
        ? ['Pas encore de compte ? ', el('button', { class: 'link', type: 'button', text: 'Créer un compte', on: { click: () => { mode = 'up'; render(); } } })]
        : ['Déjà un compte ? ', el('button', { class: 'link', type: 'button', text: 'Se connecter', on: { click: () => { mode = 'in'; render(); } } })]);
      const forgot = mode === 'in' ? el('p', { class: 'small mt' }, [el('button', { class: 'link', type: 'button', text: 'Mot de passe oublié ?', on: { click: () => { mode = 'reset'; render(); } } })]) : null;
      const form = el('form', { class: 'content', novalidate: true }, [
        el('span', { class: 'auth-mark', 'aria-hidden': 'true' }),
        el('h1', { class: 'title mt', text: title }),
        el('p', { class: 'muted small mt', text: sub }),
        nameF, emailF, passF, forgot, msg,
        el('div', { class: 'mt-lg' }, [btn]),
        switcher,
      ]);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        btn.disabled = true; say(msg, '');
        const email = fields.find((f) => f.id === 'lp-email').value.trim();
        try {
          if (mode === 'reset') { await LP.resetPassword(email); say(msg, 'Si un compte existe pour cet e-mail, un lien vient d’être envoyé.', 'ok'); return; }
          const pass = fields.find((f) => f.id === 'lp-pass').value;
          if (mode === 'in') await LP.signIn(email, pass);
          else await LP.signUp(email, pass, fields.find((f) => f.id === 'lp-name').value.trim());
          box.hidden = true;
          onDone();
        } catch (err) { say(msg, err.message, 'err'); }
        finally { btn.disabled = false; }
      });
      if (o.aside) box.replaceChildren(o.aside, el('div', { class: 'auth-main' }, [bar, form]));
      // Console layout without a brand panel: the form stays a centred column.
      else if (document.documentElement.classList.contains('console-page')) box.replaceChildren(el('div', { class: 'auth-main' }, [bar, form]));
      else box.replaceChildren(bar, form);
      showOnly(box);
      const first = fields[0]; if (first) first.focus();
    }
    render();
  }
`;
