/**
 * Hosted LightPay pages (served on the checkout domain): /pay/:id, /account (+ /account/console), /connect.
 * Design system, shared client and pages live in ./hosted/ ; this barrel keeps the public API.
 */
export { FIREBASE_WEB_API_KEY } from './hosted/client.js';
export { hostedCsp } from './hosted/shell.js';
export { accountPage } from './hosted/account.js';
export { consolePage } from './hosted/console-page.js';
export { connectPage } from './hosted/connect.js';
export { payPage } from './hosted/pay.js';
export { lightpaySdk } from './hosted/sdk.js';
