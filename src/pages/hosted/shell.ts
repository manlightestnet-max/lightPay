import { CSS } from './design.js';
import { CLIENT } from './client.js';
import { iconSvg } from './icons.js';

/** Light/dark switch (the page script wires every [data-theme-toggle]). */
export const themeToggle = () =>
  `<button class="icon-btn" type="button" data-theme-toggle aria-label="Changer de thème"><span class="theme-light-icon">${iconSvg('sun')}</span><span class="theme-dark-icon">${iconSvg('moon')}</span></button>`;

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

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Top bar markup: optional back button (data-back, handled by the page's navigator), a title
 * (or the LightPay brand), and the environment badge.
 */
export const topbar = (o: { title?: string; back?: boolean; brand?: boolean; env: string; backId?: string; end?: string }) =>
  `<header class="topbar">${
    o.back ? `<button class="icon-btn" type="button" data-back${o.backId ? ` id="${o.backId}"` : ''} aria-label="Retour">${iconSvg('arrow-left')}</button>` : ''
  }<h1 class="topbar-title${o.back ? '' : ' pad'}">${
    o.brand ? `<span class="brand"><span class="brand-mark">${iconSvg('bolt')}</span>LightPay</span>` : escapeHtml(o.title ?? '')
  }</h1><span class="topbar-end">${o.env === 'sandbox' ? '<span class="badge">Test</span>' : ''}${themeToggle()}${o.end ?? ''}</span></header>`;

/** Full document: nonce'd design system + page css, page body in .app, shared client + page script. */
export const shell = (o: { title: string; nonce: string; env: string; body: string; script: string; css?: string }) => `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(o.title)} · LightPay</title>
<script nonce="${o.nonce}">try { var t = localStorage.getItem('lightpay.theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}</script>
<style nonce="${o.nonce}">${CSS}${o.css ?? ''}</style>
</head>
<body>
<div class="app">
${o.body}
<section class="screen" id="auth" hidden></section>
</div>
<p class="foot">Paiements sécurisés par LightPay</p>
<script nonce="${o.nonce}">(function () {
${CLIENT(o.env)}
${o.script}
})();</script>
</body>
</html>`;
