/**
 * LightPay hosted pages — design system (one stylesheet, served under the page nonce).
 *
 * Layout
 *   <div class="app">                         full-bleed on phones, centered 440px card from 480px
 *     <section class="screen" data-screen="x"> one screen at a time (hidden attribute)
 *       <header class="topbar">               back button · title · end slot
 *         <button class="icon-btn" data-back aria-label="Retour">svg</button>
 *         <h1 class="topbar-title">Titre</h1><span class="topbar-end"><span class="badge">Test</span></span>
 *       <div class="content">…</div>
 *       <div class="actions-bar">…buttons…</div>   sticky at the bottom on phones
 *   <p class="foot">…</p>
 *
 * Blocks
 *   .hero (.hero-label .amount-xl .hero-sub)      balance / amount block
 *   .quick (> button.quick-btn > .quick-icon + span) three big actions
 *   .section-head (h2 + .link)                    section title with a link
 *   ul.list > li.row (.row-icon, .row-main > .row-title + .row-sub, .row-end)   list rows;
 *     a.row / button.row for tappable rows (+ .chev)
 *   .field (label, input | .input-prefix > span + input, .hint)   form fields
 *   input.amount-input                            big numeric amount
 *   .seg > button.seg-opt[aria-pressed]           segmented choice
 *   .btn (.btn-secondary .btn-danger .btn-ghost) , .btn-row                       pill buttons
 *   .fees > .fees-row (span + span), .fees-row.total                             fee breakdown
 *   .receipt > .fees-row                          summary rows (same markup)
 *   .note (.note-icon + p)                        information box
 *   .msg (.err .ok)                               aria-live message line
 *   .state (.state-icon.ok|.err|.wait, h2, p)     centered result / waiting / error state
 *   .spinner, .avatar (.avatar-lg), .pill (.ok .warn .err), .empty, .group-label
 *   .overlay > .sheet                             modal sheet (re-authentication, confirmations)
 * Utilities: .muted .small .mt .mt-lg .center .num .hide-sm
 */
export const CSS = `
:root {
  color-scheme: dark;
  --bg: #0f0f0f; --card: #1c1c1c; --raised: #242424; --line: #2e2e2e; --line-strong: #444444;
  --text: #f2f2f2; --muted: #a3a3a3; --faint: #8a8a8a;
  --accent: #f2f2f2; --on-accent: #111111; --accent-soft: rgba(255, 255, 255, .08);
  --danger: #f87171; --danger-soft: rgba(248, 113, 113, .12); --warn: #fbbf24; --warn-soft: rgba(251, 191, 36, .12);
  --focus: #f2f2f2; --shadow: 0 1px 0 rgba(255,255,255,.03), 0 30px 80px -24px rgba(0,0,0,.7);
  --radius: 24px; --radius-sm: 6px; --ease: cubic-bezier(.2,.7,.2,1);
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    color-scheme: light;
    --bg: #f1f1f1; --card: #ffffff; --raised: #f6f6f6; --line: #ececec; --line-strong: #cfcfcf;
    --text: #111111; --muted: #6b6b6b; --faint: #8c8c8c;
    --accent: #111111; --on-accent: #ffffff; --accent-soft: rgba(17, 17, 17, .06);
    --danger: #dc2626; --danger-soft: rgba(220, 38, 38, .08); --warn: #b45309; --warn-soft: rgba(180, 83, 9, .09);
    --focus: #111111; --shadow: 0 1px 2px rgba(0,0,0,.04), 0 30px 80px -28px rgba(0,0,0,.22);
  }
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #f1f1f1; --card: #ffffff; --raised: #f6f6f6; --line: #ececec; --line-strong: #cfcfcf;
  --text: #111111; --muted: #6b6b6b; --faint: #8c8c8c;
  --accent: #111111; --on-accent: #ffffff; --accent-soft: rgba(17, 17, 17, .06);
  --danger: #dc2626; --danger-soft: rgba(220, 38, 38, .08); --warn: #b45309; --warn-soft: rgba(180, 83, 9, .09);
  --focus: #111111; --shadow: 0 1px 2px rgba(0,0,0,.04), 0 30px 80px -28px rgba(0,0,0,.22);
}
/* Theme toggle shows the icon of the theme you would switch to. */
.theme-dark-icon { display: none; }
:root[data-theme="light"] .theme-dark-icon { display: inline-flex; }
:root[data-theme="light"] .theme-light-icon { display: none; }
@media (prefers-color-scheme: light) {
  :root:not([data-theme]) .theme-dark-icon { display: inline-flex; }
  :root:not([data-theme]) .theme-light-icon { display: none; }
}
* { box-sizing: border-box; margin: 0; }
html { -webkit-text-size-adjust: 100%; }
body {
  min-height: 100vh; min-height: 100dvh; background: var(--bg); color: var(--text);
  font: 15px/1.5 'Poppins', system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
button, input { font: inherit; color: inherit; }
button { cursor: pointer; }
[hidden] { display: none !important; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
h1[tabindex="-1"]:focus, h2[tabindex="-1"]:focus { outline: none; }

/* ---------- layout: a fixed-height app frame; only the content area scrolls ---------- */
html, body { height: 100%; overflow: hidden; }
.app { width: 100%; height: 100vh; height: 100dvh; background: var(--card); display: flex; flex-direction: column; overflow: hidden; }
.screen { flex: 1; min-height: 0; display: flex; flex-direction: column; animation: enter .18s var(--ease); }
.content, .screen > .state { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.content::-webkit-scrollbar, .screen > .state::-webkit-scrollbar { display: none; }
.content { padding: 4px 16px 24px; }
.foot { display: none; }
@media (min-width: 480px) {
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 16px; }
  .app { max-width: 440px; height: min(760px, calc(100dvh - 72px)); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
  .content { padding: 4px 24px 24px; }
  .foot { display: block; text-align: center; color: var(--faint); font-size: 11px; padding-top: 14px; }
}
@keyframes enter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pop { from { transform: scale(.8); opacity: 0; } to { transform: none; opacity: 1; } }

/* ---------- top bar ---------- */
.topbar { flex-shrink: 0; z-index: 5; display: flex; align-items: center; gap: 8px; min-height: 60px; padding: 8px 12px; background: var(--card); }
@media (min-width: 480px) { .topbar { padding: 10px 16px; } }
.topbar-title { flex: 1; min-width: 0; text-align: center; font-size: 11px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.topbar-title.pad { padding-left: 44px; }
.topbar-end { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; }
.brand-mark { width: 22px; height: 22px; border-radius: 6px; background: var(--accent); color: var(--on-accent); display: inline-flex; align-items: center; justify-content: center; }
.brand-mark svg { width: 13px; height: 13px; }
.icon-btn { width: 44px; height: 44px; flex-shrink: 0; border: 0; border-radius: 999px; background: transparent; display: inline-flex; align-items: center; justify-content: center; color: var(--text); transition: background .15s; }
.icon-btn:hover { background: var(--raised); }
.icon-btn svg { width: 22px; height: 22px; }
.amount-cur.below { color: var(--warn); font-weight: 650; }
.badge { font-size: 11px; font-weight: 650; padding: 3px 9px; border-radius: 999px; color: var(--warn); background: var(--warn-soft); }

/* ---------- type ---------- */
.eyebrow { font-size: 11px; font-weight: 600; color: var(--muted); letter-spacing: .16em; text-transform: uppercase; }
.title { font-size: 22px; font-weight: 600; letter-spacing: -.02em; line-height: 1.25; }
.muted { color: var(--muted); }
.small { font-size: 13px; }
.num { font-variant-numeric: tabular-nums; }
.mt { margin-top: 12px; } .mt-lg { margin-top: 24px; }
.center { text-align: center; }
svg.i { width: 20px; height: 20px; flex-shrink: 0; }

/* ---------- hero / amounts ---------- */
.hero { padding: 22px 0 6px; text-align: center; }
.hero-label { font-size: 11px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); }
.amount-xl { font-size: 40px; font-weight: 600; letter-spacing: -.01em; line-height: 1.15; margin-top: 4px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.hero-sub { margin-top: 6px; font-size: 12px; color: var(--muted); display: flex; align-items: center; justify-content: center; gap: 6px; letter-spacing: .02em; }
.hero-sub svg { width: 16px; height: 16px; }

/* ---------- quick actions ---------- */
.quick { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 20px; }
.quick-btn { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 6px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--card); font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; transition: border-color .15s, background .15s; }
.quick-btn:hover { border-color: var(--line-strong); background: var(--raised); }
.quick-icon { width: 32px; height: 32px; border-radius: 999px; background: transparent; color: var(--text); display: inline-flex; align-items: center; justify-content: center; }

/* ---------- sections / lists ---------- */
.section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 28px 0 6px; }
.section-head h2 { font-size: 11px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); }
.group-label { font-size: 12px; font-weight: 500; color: var(--muted); margin: 18px 0 2px; }
.list { list-style: none; padding: 0; }
.row { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 52px; padding: 9px 0; border: 0; border-bottom: 1px solid var(--line); background: none; text-align: left; text-decoration: none; color: inherit; }
.list > li:last-child .row, .list > .row:last-child, .list > li.row:last-child { border-bottom: 0; }
a.row:hover .row-title, button.row:hover .row-title { text-decoration: underline; text-underline-offset: 3px; }
.row-icon { width: 24px; height: 24px; flex-shrink: 0; border-radius: 0; background: transparent; border: 0; display: inline-flex; align-items: center; justify-content: center; color: var(--muted); }
.row-icon.in { color: var(--text); }
.row-icon svg { width: 18px; height: 18px; }
.row-main { flex: 1; min-width: 0; }
.row-title, .row-sub { display: block; }
.row-title { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-sub { font-size: 11px; letter-spacing: .04em; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-end { flex-shrink: 0; text-align: right; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.row-end.in { color: var(--text); }
.row-end.void { color: var(--faint); text-decoration: line-through; }
.row-end.held { color: var(--warn); }
.row-sub.err { color: var(--danger); }
.row-sub.warn { color: var(--warn); }
.chev { color: var(--faint); width: 18px; height: 18px; }
.empty { padding: 28px 8px; text-align: center; color: var(--muted); font-size: 13px; }

/* ---------- forms ---------- */
.field { margin-top: 16px; }
.field label, .label { display: block; font-size: 10px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
.field input, .input-prefix { width: 100%; height: 50px; border-radius: var(--radius-sm); border: 1px solid var(--line-strong); background: var(--card); padding: 0 14px; font-size: 16px; transition: border-color .15s, box-shadow .15s; }
.field input:focus, .input-prefix:focus-within { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.input-prefix { display: flex; align-items: center; gap: 10px; padding: 0 0 0 14px; }
.input-prefix span { color: var(--muted); font-variant-numeric: tabular-nums; }
.input-prefix input { flex: 1; min-width: 0; height: 100%; border: 0; background: transparent; padding: 0 14px 0 0; font-size: 16px; }
.input-prefix input:focus { outline: none; }
.amount-wrap { margin-top: 8px; padding: 18px 16px; border-radius: var(--radius-sm); background: var(--card); border: 1px solid var(--line); text-align: center; }
.amount-wrap:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.amount-input { width: 100%; border: 0; background: transparent; text-align: center; font-size: 36px; font-weight: 600; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
.amount-input:focus { outline: none; }
.amount-cur { font-size: 13px; color: var(--muted); font-weight: 600; }
.hint { margin-top: 6px; font-size: 12px; color: var(--muted); }

/* ---------- segmented choice ---------- */
.seg { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.seg-opt { min-height: 44px; padding: 8px 10px; border: 1px solid var(--line-strong); border-radius: 999px; background: var(--card); font-weight: 500; font-size: 13px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: border-color .15s, background .15s; }
.seg-opt[aria-pressed="true"] { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }

/* ---------- buttons ---------- */
.btn { width: 100%; min-height: 48px; padding: 0 20px; border: 0; border-radius: var(--radius-sm); background: var(--accent); color: var(--on-accent); font-weight: 500; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: filter .15s, opacity .15s, transform .05s; text-decoration: none; }
.btn:hover { opacity: .88; }
.btn:active { transform: translateY(1px); }
.btn:disabled, .btn[aria-disabled="true"] { opacity: .4; cursor: not-allowed; filter: none; transform: none; }
.btn-secondary { background: transparent; color: var(--text); box-shadow: inset 0 0 0 1px var(--line-strong); }
.btn-danger { background: transparent; color: var(--danger); box-shadow: inset 0 0 0 1px var(--danger); }
.btn-ghost { background: transparent; color: var(--text); min-height: 44px; }
.btn-row { display: flex; gap: 10px; }
.btn-row .btn { flex: 1; }
.link { border: 0; background: none; padding: 0; color: var(--text); font-weight: 500; font-size: 12px; text-decoration: none; }
.link:hover { text-decoration: underline; text-underline-offset: 3px; }
.actions-bar { flex-shrink: 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid var(--line); background: var(--card); }
@media (min-width: 480px) { .actions-bar { padding: 14px 24px 20px; } }
.actions-bar .btn + .btn { margin-top: 10px; }

/* ---------- fee breakdown / receipt ---------- */
.fees, .receipt { margin-top: 16px; padding: 4px 2px; border-radius: 0; border: 0; background: transparent; }
.fees-row { display: flex; justify-content: space-between; gap: 16px; padding: 4px 0; font-size: 13px; letter-spacing: .02em; color: var(--muted); }
.fees-row span:last-child { color: var(--text); font-variant-numeric: tabular-nums; text-align: right; overflow-wrap: anywhere; }
.fees-row.total { margin-top: 6px; padding-top: 10px; border-top: 1px solid var(--line); color: var(--text); font-weight: 600; font-size: 14px; }

/* ---------- notes / messages / states ---------- */
.note { display: flex; gap: 10px; align-items: flex-start; margin-top: 16px; padding: 12px 14px; border-radius: var(--radius-sm); background: var(--accent-soft); font-size: 13px; }
.note svg { width: 18px; height: 18px; color: var(--text); margin-top: 1px; }
.note.warn { background: var(--warn-soft); } .note.warn svg { color: var(--warn); }
.msg { margin-top: 12px; font-size: 13px; min-height: 0; }
.terms { margin: 8px 0 0; padding-left: 18px; font-size: 13px; color: var(--muted); }
.terms li + li { margin-top: 6px; }
.agree { display: flex; gap: 10px; align-items: flex-start; margin-top: 12px; font-size: 14px; cursor: pointer; }
.agree input { width: 18px; height: 18px; margin: 1px 0 0; flex-shrink: 0; accent-color: var(--accent); }
.amount-bad { margin-top: 6px; font-size: 13px; color: var(--danger); }
[data-amount][aria-invalid="true"] { border-color: var(--danger); }
.msg:empty { margin-top: 0; }
.msg.err { color: var(--danger); } .msg.ok { color: var(--text); }
.state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 32px 16px; }
.content > .state { flex: none; overflow: visible; padding: 24px 8px 8px; }
.state h2 { font-size: 20px; font-weight: 600; letter-spacing: -.01em; margin-top: 16px; }
.state p { color: var(--muted); font-size: 14px; margin-top: 6px; max-width: 320px; }
.state-icon { width: 64px; height: 64px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; animation: pop .25s var(--ease); }
.state-icon svg { width: 30px; height: 30px; }
.state-icon.ok { background: var(--accent); color: var(--on-accent); }
.state-icon.err { background: var(--danger-soft); color: var(--danger); }
.state-icon.wait { background: var(--warn-soft); color: var(--warn); }
.spinner { width: 44px; height: 44px; border-radius: 999px; border: 3px solid var(--line); border-top-color: var(--accent); animation: spin .9s linear infinite; }
.spinner.sm { width: 18px; height: 18px; border-width: 2px; }
.avatar { width: 40px; height: 40px; flex-shrink: 0; border-radius: 999px; background: var(--accent-soft); color: var(--text); display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; }
.avatar-lg { width: 64px; height: 64px; font-size: 22px; }
.pill { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 999px; font-size: 11px; font-weight: 650; background: var(--raised); color: var(--muted); }
.pill.ok { background: var(--accent-soft); color: var(--text); }
.pill.warn { background: var(--warn-soft); color: var(--warn); }
.pill.err { background: var(--danger-soft); color: var(--danger); }
.card-block { margin-top: 16px; padding: 16px; border-radius: var(--radius-sm); border: 1px solid var(--line); }
.danger-zone { margin-top: 28px; padding: 16px; border-radius: var(--radius-sm); border: 1px solid var(--danger-soft); background: var(--danger-soft); }

/* ---------- overlay sheet ---------- */
.overlay { position: fixed; inset: 0; z-index: 50; background: rgba(0,0,0,.55); display: flex; align-items: flex-end; justify-content: center; padding: 0; animation: enter .15s var(--ease); }
.sheet { width: 100%; max-width: 440px; background: var(--card); border-radius: var(--radius) var(--radius) 0 0; padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); box-shadow: var(--shadow); }
@media (min-width: 480px) { .overlay { align-items: center; padding: 16px; } .sheet { border-radius: var(--radius); padding: 24px; } }

/* ---------- shimmer placeholders (while a screen loads) ---------- */
.sk { display: block; border-radius: 6px; background: linear-gradient(90deg, var(--raised) 0%, var(--line) 45%, var(--raised) 90%); background-size: 220% 100%; animation: shimmer 1.3s ease-in-out infinite; }
.sk.inline { display: inline-block; vertical-align: middle; }
.sk-row { display: flex; align-items: center; gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--line); list-style: none; }
.sk-row:last-child { border-bottom: 0; }
.sk-lines { flex: 1; display: grid; gap: 7px; }
.sk-screen { padding: 8px 16px 24px; }
.sk-pad { padding: 4px 20px; }
@media (min-width: 480px) { .sk-screen { padding: 8px 24px 24px; } }
.sk-ic { width: 20px; height: 20px; flex-shrink: 0; }
.sk-t { height: 12px; } .sk-s { height: 9px; } .sk-amt { width: 56px; height: 12px; flex-shrink: 0; }
.w-30 { width: 30%; } .w-45 { width: 45%; } .w-60 { width: 60%; } .w-75 { width: 75%; }
.sk-amount { width: 160px; height: 36px; margin: 4px auto 0; }
.sk-hero { width: 55%; height: 40px; margin: 28px auto 8px; }
.sk-sub { width: 40%; height: 10px; margin: 0 auto 30px; }
.sk-pills { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 14px; }
.sk-pill { height: 44px; border-radius: 999px; }
.sk-field { height: 48px; margin-top: 14px; }
.sk-line { margin-top: 12px; }
.sk-btn { height: 48px; margin-top: 26px; }
@keyframes shimmer { from { background-position: 120% 0; } to { background-position: -120% 0; } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .spinner { animation: spin 2.4s linear infinite !important; }
}
`;
