import { ICON_PATHS } from './icons.js';

export const FIREBASE_WEB_API_KEY = () => process.env.LIGHTPAY_FIREBASE_WEB_API_KEY || 'AIzaSyAyOdD8qSUfx8wvHhb5F4EJ4zKjavwnpeI';

/**
 * Browser script shared by every hosted page (plain JS, no template literals inside so it
 * can live in this TS template string).
 *
 * LP                  LightPay client
 *   LP.ENV            'production' | 'sandbox'
 *   LP.signedIn() / LP.email() / LP.signIn(email, pw) / LP.signUp(email, pw, name) / LP.signOut()
 *   LP.resetPassword(email)
 *   LP.api(method, path, body?, idempotencyKey?) -> JSON   throws Error with .signIn (sign in again)
 *                                                           or .reauth (confirm password) or .status
 *   LP.money(value, currency) · LP.uuid() · LP.updateIdentity({email}|{password}) · LP.deleteIdentity()
 * UI kit
 *   $(id) · el(tag, props?, children?) (props: class, text, on:{event:fn}, any attribute)
 *   icon(name, cls?) · initials(text) · digits(value) · debounce(fn, ms)
 *   say(target, text, kind?)       kind: 'err' | 'ok' | undefined (aria-live line)
 *   feeRows(container, rows)       rows: [[label, value, isTotal?]]
 *   listRow({ icon, iconClass, title, sub, end, endClass, href, onClick, chev }) -> <li>
 *   dayLabel(date) · timeLabel(date) · showOnly(section)
 *   createNav({ root, screens: { name: { parent, enter(param) } }, resolve(route) -> [name, param], onRootBack })
 *     -> { start(), go(route, replace?), back(), home(), current() }   (hash routes #/route; the
 *        browser back button and every [data-back] button use the same history)
 *   mountAuth(onDone, { title?, subtitle?, onBack? })   sign in / sign up / reset, in <section id="auth">
 */
export const CLIENT = (env: string) => `
  const LP = (() => {
    const KEY = ${JSON.stringify(FIREBASE_WEB_API_KEY())};
    const ENV = ${JSON.stringify(env)};
    const STORE = 'lightpay.session';
    const read = () => { try { return JSON.parse(sessionStorage.getItem(STORE) || 'null'); } catch (e) { return null; } };
    const write = (s) => { try { s ? sessionStorage.setItem(STORE, JSON.stringify(s)) : sessionStorage.removeItem(STORE); } catch (e) {} };
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
      const res = await fetch(path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && data.error === 'RECENT_SIGN_IN_REQUIRED') throw Object.assign(new Error(data.message), { reauth: true });
      if (res.status === 401) { write(null); throw Object.assign(new Error(data.message || 'Session expirée.'), { signIn: true }); }
      if (!res.ok) throw Object.assign(new Error(data.message || 'Une erreur est survenue.'), { status: res.status, code: data.error });
      return data;
    };
    return {
      ENV: ENV,
      signedIn: () => Boolean(read()),
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
      money: (v, c) => Number(v).toLocaleString('fr-FR') + ' ' + (!c || c === 'XAF' ? 'FCFA' : c),
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
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  function dayLabel(d) {
    const date = new Date(d); const today = new Date(); const y = new Date(); y.setDate(y.getDate() - 1);
    if (sameDay(date, today)) return 'Aujourd’hui';
    if (sameDay(date, y)) return 'Hier';
    return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  const timeLabel = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  // Theme: saved choice, else the system preference. Every [data-theme-toggle] flips it.
  function currentTheme() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
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
    document.querySelectorAll('.app > .screen').forEach(function (s) { s.hidden = s !== section; });
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
      current = { route: route, name: resolved[0], param: resolved[1] };
      const section = document.querySelector('[data-screen="' + resolved[0] + '"]');
      if (section) {
        showOnly(section);
        const h = section.querySelector('h1');
        if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
      }
      window.scrollTo(0, 0);
      const def = opts.screens[resolved[0]];
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
      const bar = el('header', { class: 'topbar' }, [back, el('span', { class: 'topbar-title' + (back ? '' : ' pad') }, [el('span', { class: 'brand' }, [el('span', { class: 'brand-mark' }, [icon('bolt')]), 'LightPay'])]), el('span', { class: 'topbar-end' }, [LP.ENV === 'sandbox' ? el('span', { class: 'badge', text: 'Test' }) : null, themeButton()])]);
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
      const switcher = el('p', { class: 'small muted center mt-lg' }, mode === 'in'
        ? ['Pas encore de compte ? ', el('button', { class: 'link', type: 'button', text: 'Créer un compte', on: { click: () => { mode = 'up'; render(); } } })]
        : ['Déjà un compte ? ', el('button', { class: 'link', type: 'button', text: 'Se connecter', on: { click: () => { mode = 'in'; render(); } } })]);
      const forgot = mode === 'in' ? el('p', { class: 'small mt' }, [el('button', { class: 'link', type: 'button', text: 'Mot de passe oublié ?', on: { click: () => { mode = 'reset'; render(); } } })]) : null;
      const form = el('form', { class: 'content', novalidate: true }, [
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
      box.replaceChildren(bar, form);
      showOnly(box);
      const first = fields[0]; if (first) first.focus();
    }
    render();
  }
`;
