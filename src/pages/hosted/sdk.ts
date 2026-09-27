/**
 * lightpay.js — served by LightPay (checkout domain), included by apps:
 *
 *   <script src="https://checkout.smlab.xyz/lightpay.js"></script>
 *   const result = await LightPay.pay(checkoutUrl);   // { status: 'completed' | 'closed', session }
 *   LightPay.pay(checkoutUrl, { idToken })            // payer already signed in with LightPay: no second sign-in
 *
 * Opens the LightPay payment page in a dialog over the app. The page stays on LightPay's
 * origin: the app can open and close it, never read or change it. `completed` is only a hint
 * for the interface: the app confirms the payment server-side (API or signed webhook).
 * Sites not declared by the app (or a blocked frame) fall back to the full-page redirect.
 */
export const lightpaySdk = (checkoutOrigin: string) => `/* LightPay checkout · ${checkoutOrigin} */
(function () {
  'use strict';
  if (window.LightPay && window.LightPay.version) return;
  var ORIGIN = ${JSON.stringify(checkoutOrigin)};
  var PAY_PATH = /^\\/pay\\/cs_(test|live)_[A-Za-z0-9_-]{16,40}$/;
  var READY_TIMEOUT_MS = 7000;
  var open = null;

  var CSS = [
    ':host { all: initial; }',
    '.backdrop { position: fixed; inset: 0; z-index: 2147483646; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; animation: fade .18s ease; }',
    '.frame { position: relative; width: 440px; max-width: 100%; height: min(760px, calc(100dvh - 32px)); border-radius: 20px; overflow: hidden; background: #141416; box-shadow: 0 30px 80px -20px rgba(0,0,0,.6); animation: rise .22s cubic-bezier(.2,.7,.2,1); }',
    'iframe { display: block; width: 100%; height: 100%; border: 0; background: transparent; }',
    '.spin { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }',
    '.spin::after { content: ""; width: 34px; height: 34px; border-radius: 50%; border: 3px solid rgba(255,255,255,.15); border-top-color: #34d399; animation: spin .9s linear infinite; }',
    '.loaded .spin { display: none; }',
    '@media (max-width: 520px) { .backdrop { padding: 0; } .frame { width: 100%; height: 100%; border-radius: 0; } }',
    '@keyframes fade { from { opacity: 0 } } @keyframes rise { from { opacity: 0; transform: translateY(12px) } } @keyframes spin { to { transform: rotate(360deg) } }',
    '@media (prefers-reduced-motion: reduce) { .backdrop, .frame { animation: none; } }',
  ].join('\\n');

  function pay(target, options) {
    var idToken = options && typeof options.idToken === 'string' && /^[\\w-]+\\.[\\w-]+\\.[\\w-]+$/.test(options.idToken) ? options.idToken : null;
    return new Promise(function (resolve, reject) {
      var url;
      try { url = new URL(target, ORIGIN); } catch (e) { url = null; }
      if (!url || url.origin !== ORIGIN || !PAY_PATH.test(url.pathname)) { reject(new Error('LightPay: lien de paiement invalide.')); return; }
      if (open) open.close('closed');

      var session = url.pathname.split('/').pop();
      var src = new URL(url.pathname, ORIGIN);
      src.searchParams.set('embed', '1');
      src.searchParams.set('origin', location.origin);

      var host = document.createElement('div');
      host.setAttribute('data-lightpay', '');
      var root = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;
      var style = document.createElement('style');
      style.textContent = CSS;
      var backdrop = document.createElement('div');
      backdrop.className = 'backdrop';
      var frame = document.createElement('div');
      frame.className = 'frame';
      frame.setAttribute('role', 'dialog');
      frame.setAttribute('aria-modal', 'true');
      frame.setAttribute('aria-label', 'Paiement LightPay');
      var spin = document.createElement('div');
      spin.className = 'spin';
      var iframe = document.createElement('iframe');
      iframe.title = 'Paiement LightPay';
      iframe.src = src.toString();
      iframe.setAttribute('allow', 'clipboard-write');
      frame.appendChild(spin);
      frame.appendChild(iframe);
      backdrop.appendChild(frame);
      root.appendChild(style);
      root.appendChild(backdrop);

      var overflow = document.documentElement.style.overflow;
      var ready = false;
      var done = false;
      function onMessage(e) {
        if (e.origin !== ORIGIN || e.source !== iframe.contentWindow) return;
        var d = e.data || {};
        if (d.source !== 'lightpay' || d.session !== session) return;
        if (d.type === 'ready') {
          ready = true; frame.className = 'frame loaded'; clearTimeout(timer); iframe.focus();
          // Only to LightPay's own frame, never in the address.
          if (idToken) iframe.contentWindow.postMessage({ source: 'lightpay-app', type: 'identity', session: session, idToken: idToken }, ORIGIN);
        }
        else if (d.type === 'completed') close('completed');
        else if (d.type === 'closed') close('closed');
      }
      function onKey(e) { if (e.key === 'Escape') close('closed'); }
      function close(status) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        document.removeEventListener('keydown', onKey);
        document.documentElement.style.overflow = overflow;
        if (host.parentNode) host.parentNode.removeChild(host);
        open = null;
        resolve({ status: status, session: session });
      }
      // Not allowed to show the dialog here (site not declared) or blocked: full-page payment.
      var timer = setTimeout(function () {
        if (ready || done) return;
        done = true;
        window.removeEventListener('message', onMessage);
        document.removeEventListener('keydown', onKey);
        document.documentElement.style.overflow = overflow;
        if (host.parentNode) host.parentNode.removeChild(host);
        open = null;
        location.assign(url.toString());
      }, READY_TIMEOUT_MS);

      window.addEventListener('message', onMessage);
      document.addEventListener('keydown', onKey);
      document.documentElement.style.overflow = 'hidden';
      document.body.appendChild(host);
      open = { close: close };
    });
  }

  window.LightPay = { version: 1, pay: pay };
})();
`;
