import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { CheckoutError, publicView, startMobileMoney } from '../db/checkout.js';

/** Per-IP brake on payment requests (each one rings a phone). */
const hits = new Map<string, number[]>();
const allow = (ip: string, max = 10, windowMs = 60_000) => {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) return false;
  recent.push(now);
  hits.set(ip, recent);
  return true;
};

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9_-]{16,40}$/;

/**
 * Public side of the checkout. The session id is an unguessable capability; nothing here
 * exposes wallet ids, balances or full phone numbers.
 *   GET  /pay/:id                                     hosted payment page
 *   GET  /v1/checkout/public/sessions/:id             what the page shows (polled)
 *   POST /v1/checkout/public/sessions/:id/mobile-money   { msisdn, network }
 */
export async function checkoutPublicRoutes(fastify: FastifyInstance) {
  fastify.get('/v1/checkout/public/sessions/:id', async (request, reply) => {
    const { id } = request.params as any;
    if (!SESSION_ID.test(id)) return reply.status(404).send({ error: 'Session not found' });
    const view = await publicView(id);
    if (!view) return reply.status(404).send({ error: 'Session not found' });
    reply.header('Cache-Control', 'no-store');
    return { status: 'success', session: view };
  });

  fastify.post('/v1/checkout/public/sessions/:id/mobile-money', async (request, reply) => {
    const { id } = request.params as any;
    if (!SESSION_ID.test(id)) return reply.status(404).send({ error: 'Session not found' });
    if (!allow(request.ip)) return reply.status(429).send({ error: 'TOO_MANY_REQUESTS', message: 'Trop de tentatives, réessayez dans une minute.' });
    const { msisdn, network } = (request.body ?? {}) as any;
    try {
      return { status: 'success', attempt: await startMobileMoney(id, String(msisdn ?? ''), String(network ?? '')) };
    } catch (err: any) {
      return reply.status(err instanceof CheckoutError ? err.statusCode : 400).send({ status: 'error', error: err.code || 'CHECKOUT_ERROR', message: err.message });
    }
  });

  fastify.get('/pay/:id', async (request, reply) => {
    const { id } = request.params as any;
    const nonce = crypto.randomBytes(16).toString('base64');
    reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .header(
        'Content-Security-Policy',
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`
      );
    return page(SESSION_ID.test(id) ? id : '', nonce);
  });
}

const page = (sessionId: string, nonce: string) => `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Paiement · LightPay</title>
<style nonce="${nonce}">
  :root { --bg:#0b0b0c; --card:#141416; --line:#26262a; --text:#f4f4f5; --muted:#9b9ba2; --accent:#34d399; --on-accent:#04130d; --danger:#f87171; --warn:#fbbf24; }
  @media (prefers-color-scheme: light) { :root { --bg:#f4f4f6; --card:#fff; --line:#e4e4e7; --text:#18181b; --muted:#71717a; --accent:#047857; --on-accent:#fff; } }
  * { box-sizing:border-box; margin:0; }
  body { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:16px; background:var(--bg); color:var(--text); font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { width:100%; max-width:400px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:20px; padding:24px; }
  .brand { display:flex; align-items:center; gap:8px; font-weight:600; font-size:13px; color:var(--muted); margin-bottom:16px; }
  .dot { width:8px; height:8px; border-radius:50%; background:var(--accent); }
  .badge { margin-left:auto; font-size:11px; padding:2px 8px; border-radius:99px; border:1px solid var(--warn); color:var(--warn); }
  .merchant { color:var(--muted); font-size:13px; }
  .amount { font-size:32px; font-weight:650; letter-spacing:-.02em; margin:4px 0 2px; font-variant-numeric:tabular-nums; }
  .desc { color:var(--muted); font-size:13px; }
  .escrow { margin-top:16px; padding:10px 12px; border-radius:12px; background:color-mix(in srgb, var(--accent) 10%, transparent); font-size:12px; color:var(--text); }
  hr { border:0; border-top:1px solid var(--line); margin:20px 0; }
  .nets { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .net { height:44px; border-radius:12px; border:1px solid var(--line); background:transparent; color:var(--text); font:inherit; font-weight:600; cursor:pointer; }
  .net[aria-pressed="true"] { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent) inset; }
  label { display:block; font-size:12px; color:var(--muted); margin:16px 0 6px; }
  input { width:100%; height:46px; border-radius:12px; border:1px solid var(--line); background:transparent; color:var(--text); font:inherit; font-size:16px; padding:0 14px; letter-spacing:.04em; }
  input:focus, .net:focus-visible, .pay:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .pay { width:100%; height:48px; margin-top:16px; border:0; border-radius:99px; background:var(--accent); color:var(--on-accent); font:inherit; font-weight:650; cursor:pointer; }
  .pay:disabled { opacity:.4; cursor:not-allowed; }
  .msg { margin-top:12px; font-size:13px; min-height:20px; }
  .msg.err { color:var(--danger); }
  .state { text-align:center; padding:8px 0; }
  .state h2 { font-size:18px; margin:12px 0 4px; }
  .state p { color:var(--muted); font-size:13px; }
  .spinner { width:36px; height:36px; margin:0 auto; border-radius:50%; border:3px solid var(--line); border-top-color:var(--accent); animation:spin 1s linear infinite; }
  .ok { width:44px; height:44px; margin:0 auto; border-radius:50%; background:var(--accent); color:var(--on-accent); display:flex; align-items:center; justify-content:center; font-size:22px; }
  .link { display:inline-block; margin-top:16px; color:var(--accent); font-weight:600; text-decoration:none; }
  .foot { text-align:center; color:var(--muted); font-size:11px; margin-top:12px; }
  [hidden] { display:none !important; }
  @keyframes spin { to { transform:rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation:none; } }
</style>
</head>
<body>
<main>
  <div class="card">
    <div class="brand"><span class="dot"></span>LightPay<span class="badge" id="env" hidden>Test</span></div>
    <div id="loading" class="state"><div class="spinner"></div></div>
    <div id="summary" hidden>
      <div class="merchant" id="merchant"></div>
      <div class="amount" id="amount"></div>
      <div class="desc" id="desc"></div>
      <div class="escrow" id="escrow" hidden>Paiement protégé : le vendeur n'est payé qu'une fois la commande validée.</div>
    </div>
    <form id="form" hidden novalidate>
      <hr>
      <div class="nets" role="group" aria-label="Opérateur">
        <button type="button" class="net" data-net="MTN_MOMO_COG" aria-pressed="true">MTN MoMo</button>
        <button type="button" class="net" data-net="AIRTEL_COG" aria-pressed="false">Airtel Money</button>
      </div>
      <label for="msisdn">Numéro de téléphone</label>
      <input id="msisdn" inputmode="tel" autocomplete="tel-national" placeholder="06 512 44 81" maxlength="16" required>
      <button class="pay" id="pay" type="submit">Payer</button>
      <div class="msg" id="msg" role="status" aria-live="polite"></div>
    </form>
    <div id="waiting" class="state" hidden>
      <div class="spinner"></div>
      <h2>Validez sur votre téléphone</h2>
      <p id="waitText">Une demande de paiement a été envoyée. Composez votre code secret pour confirmer.</p>
    </div>
    <div id="done" class="state" hidden>
      <div class="ok" aria-hidden="true">✓</div>
      <h2>Paiement confirmé</h2>
      <p>Vous pouvez revenir sur le site du marchand.</p>
      <a class="link" id="back" hidden>Retour au site</a>
    </div>
    <div id="closed" class="state" hidden>
      <h2 id="closedTitle">Paiement indisponible</h2>
      <p id="closedText"></p>
      <a class="link" id="cancelBack" hidden>Retour au site</a>
    </div>
  </div>
  <p class="foot">Paiement sécurisé par LightPay · aucun compte requis</p>
</main>
<script nonce="${nonce}">
(() => {
  const id = ${JSON.stringify(sessionId)};
  const $ = (x) => document.getElementById(x);
  const show = (...ids) => ['loading', 'form', 'waiting', 'done', 'closed'].forEach((k) => ($(k).hidden = !ids.includes(k)));
  const FAIL = {
    INSUFFICIENT_BALANCE: 'Solde insuffisant sur ce compte mobile money.',
    PAYER_DECLINED: 'Paiement refusé depuis le téléphone.',
    PAYER_TIMEOUT: 'Aucune confirmation reçue à temps. Réessayez.',
  };
  let network = 'MTN_MOMO_COG';
  let poll = null;
  let lastAttemptAt = null;

  document.querySelectorAll('.net').forEach((b) => b.addEventListener('click', () => {
    network = b.dataset.net;
    document.querySelectorAll('.net').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
  }));

  const fmt = (s) => Number(s.amount).toLocaleString('fr-FR') + ' ' + (s.currency === 'XAF' ? 'FCFA' : s.currency);

  const render = (s) => {
    $('env').hidden = s.environment !== 'sandbox';
    $('merchant').textContent = s.payee ? s.merchant + ' · ' + s.payee : s.merchant;
    $('amount').textContent = fmt(s);
    $('desc').textContent = [s.description, s.reference].filter(Boolean).join(' · ');
    $('escrow').hidden = !s.escrow;
    $('summary').hidden = false;
    if (s.status === 'COMPLETED') {
      stop();
      show('done');
      if (s.return_url) { $('back').href = s.return_url; $('back').hidden = false; setTimeout(() => location.assign(s.return_url), 2500); }
    } else if (s.status === 'PROCESSING') {
      show('waiting');
      $('waitText').textContent = 'Demande envoyée au ' + (s.last_attempt ? s.last_attempt.msisdn : 'numéro indiqué') + '. Composez votre code secret pour confirmer.';
      start();
    } else if (s.status === 'OPEN') {
      stop();
      show('form');
      const a = s.last_attempt;
      if (a && a.status === 'FAILED' && a.at !== lastAttemptAt) {
        lastAttemptAt = a.at;
        $('msg').className = 'msg err';
        $('msg').textContent = FAIL[a.failure_code] || 'Le paiement a échoué. Réessayez.';
      }
    } else {
      stop();
      show('closed');
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

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msisdn = $('msisdn').value.trim();
    if (msisdn.replace(/\\D/g, '').length < 9) { $('msg').className = 'msg err'; $('msg').textContent = 'Entrez un numéro à 9 chiffres.'; return; }
    $('pay').disabled = true;
    $('msg').textContent = '';
    try {
      const res = await fetch('/v1/checkout/public/sessions/' + encodeURIComponent(id) + '/mobile-money', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msisdn, network }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { $('msg').className = 'msg err'; $('msg').textContent = body.message || 'Le paiement n\\'a pas pu démarrer.'; return; }
      await load();
    } finally {
      $('pay').disabled = false;
    }
  });

  if (!id) { show('closed'); $('closedText').textContent = 'Ce lien de paiement est invalide.'; return; }
  load();
})();
</script>
</body>
</html>`;
