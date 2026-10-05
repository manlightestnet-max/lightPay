import { CSS } from './design.js';
import { CLIENT } from './client.js';
import { iconSvg } from './icons.js';
import { FAVICON_PNG } from './brand.js';

/** LightPay logo: the green ribbon mark and the wordmark. */
export const brandMarkup = `<span class="brand"><span class="brand-mark" aria-hidden="true"></span><span class="brand-word">Light<b>Pay</b></span></span>`;

/** Light/dark switch (the page script wires every [data-theme-toggle]). */
export const themeToggle = () =>
  `<button class="icon-btn" type="button" data-theme-toggle aria-label="Changer de thème"><span class="theme-light-icon">${iconSvg('sun')}</span><span class="theme-dark-icon">${iconSvg('moon')}</span></button>`;

/** `frameAncestors`: origins allowed to frame the page (payment dialog); none by default. */
export const hostedCsp = (nonce: string, frameAncestors?: string) =>
  [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}' https://fonts.googleapis.com`,
    "font-src https://fonts.gstatic.com",
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
    "img-src 'self' data:",
    "form-action 'none'",
    `frame-ancestors ${frameAncestors ?? "'none'"}`,
    "base-uri 'none'",
  ].join('; ');

/** Shimmer rows while a list loads (replaced by the real rows). */
export const skeletonRows = (n = 3, tag: 'li' | 'div' = 'li') =>
  Array.from({ length: n }, (_, i) =>
    `<${tag} class="sk-row" aria-hidden="true"><span class="sk sk-ic"></span><span class="sk-lines"><span class="sk sk-t ${['w-60', 'w-45', 'w-75'][i % 3]}"></span><span class="sk sk-s ${['w-30', 'w-45', 'w-30'][i % 3]}"></span></span><span class="sk sk-amt"></span></${tag}>`
  ).join('');

/** Shimmer version of a payment screen, shown while it loads. */
export const skeletonScreen = () =>
  `<div class="sk-screen" aria-busy="true" aria-label="Chargement"><span class="sk sk-hero"></span><span class="sk sk-sub"></span><span class="sk sk-s w-30"></span><div class="sk-pills"><span class="sk sk-pill"></span><span class="sk sk-pill"></span></div><span class="sk sk-field"></span><span class="sk sk-t w-75 sk-line"></span><span class="sk sk-t w-60 sk-line"></span><span class="sk sk-t w-45 sk-line"></span><span class="sk sk-btn"></span></div>`;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Top bar markup: optional back button (data-back, handled by the page's navigator), a title
 * (or the LightPay brand), and the environment badge.
 */
export const topbar = (o: { title?: string; back?: boolean; brand?: boolean; env: string; backId?: string; end?: string }) =>
  `<header class="topbar">${
    o.back ? `<button class="icon-btn" type="button" data-back${o.backId ? ` id="${o.backId}"` : ''} aria-label="Retour">${iconSvg('arrow-left')}</button>` : ''
  }<h1 class="topbar-title${o.back ? '' : ' pad'}">${
    o.brand ? brandMarkup : escapeHtml(o.title ?? '')
  }</h1><span class="topbar-end"><span class="badge" data-env-badge${o.env === 'sandbox' ? '' : ' hidden'}>Test</span>${themeToggle()}${o.end ?? ''}</span></header>`;

/** Full document: nonce'd design system + page css, page body in .app, shared client + page script. */
export const shell = (o: { title: string; nonce: string; env: string; body: string; script: string; css?: string; console?: boolean }) => `<!doctype html>
<html lang="fr"${o.console ? ' class="console-page"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#0c0f0e">
<link rel="icon" type="image/png" href="${FAVICON_PNG}">
<title>${escapeHtml(o.title)} · LightPay</title>
<script nonce="${o.nonce}">try { var t = localStorage.getItem('lightpay.theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}</script>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&amp;display=swap">
<style nonce="${o.nonce}">${CSS}${o.css ?? ''}</style>
</head>
<body>
<div class="app${o.console ? ' console' : ''}">
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
