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
  --bg: #0b0b0c; --card: #141416; --raised: #1b1b1e; --line: #26262a; --line-strong: #34343a;
  --text: #f4f4f5; --muted: #9b9ba2; --faint: #6f6f77;
  --accent: #34d399; --on-accent: #04130d; --accent-soft: rgba(52, 211, 153, .12);
  --danger: #f87171; --danger-soft: rgba(248, 113, 113, .12); --warn: #fbbf24; --warn-soft: rgba(251, 191, 36, .12);
  --focus: #34d399; --shadow: 0 1px 0 rgba(255,255,255,.03), 0 20px 50px -20px rgba(0,0,0,.6);
  --radius: 20px; --radius-sm: 14px; --ease: cubic-bezier(.2,.7,.2,1);
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    color-scheme: light;
    --bg: #f4f4f6; --card: #ffffff; --raised: #f7f7f8; --line: #e4e4e7; --line-strong: #d4d4d8;
    --text: #18181b; --muted: #71717a; --faint: #a1a1aa;
    --accent: #047857; --on-accent: #ffffff; --accent-soft: rgba(4, 120, 87, .09);
    --danger: #dc2626; --danger-soft: rgba(220, 38, 38, .08); --warn: #b45309; --warn-soft: rgba(180, 83, 9, .09);
    --focus: #047857; --shadow: 0 1px 2px rgba(0,0,0,.04), 0 20px 50px -24px rgba(0,0,0,.18);
  }
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #f4f4f6; --card: #ffffff; --raised: #f7f7f8; --line: #e4e4e7; --line-strong: #d4d4d8;
  --text: #18181b; --muted: #71717a; --faint: #a1a1aa;
  --accent: #047857; --on-accent: #ffffff; --accent-soft: rgba(4, 120, 87, .09);
  --danger: #dc2626; --danger-soft: rgba(220, 38, 38, .08); --warn: #b45309; --warn-soft: rgba(180, 83, 9, .09);
  --focus: #047857; --shadow: 0 1px 2px rgba(0,0,0,.04), 0 20px 50px -24px rgba(0,0,0,.18);
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
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
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
.topbar-title { flex: 1; min-width: 0; font-size: 16px; font-weight: 650; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.topbar-title.pad { padding-left: 8px; }
.topbar-end { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; letter-spacing: -.01em; }
.brand-mark { width: 26px; height: 26px; border-radius: 8px; background: var(--accent); color: var(--on-accent); display: inline-flex; align-items: center; justify-content: center; }
.brand-mark svg { width: 16px; height: 16px; }
.icon-btn { width: 44px; height: 44px; flex-shrink: 0; border: 0; border-radius: 999px; background: transparent; display: inline-flex; align-items: center; justify-content: center; color: var(--text); transition: background .15s; }
.icon-btn:hover { background: var(--raised); }
.icon-btn svg { width: 22px; height: 22px; }
.badge { font-size: 11px; font-weight: 650; padding: 3px 9px; border-radius: 999px; color: var(--warn); background: var(--warn-soft); }

/* ---------- type ---------- */
.eyebrow { font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: .02em; }
.title { font-size: 22px; font-weight: 700; letter-spacing: -.02em; line-height: 1.25; }
.muted { color: var(--muted); }
.small { font-size: 13px; }
.num { font-variant-numeric: tabular-nums; }
.mt { margin-top: 12px; } .mt-lg { margin-top: 24px; }
.center { text-align: center; }
svg.i { width: 20px; height: 20px; flex-shrink: 0; }

/* ---------- hero / amounts ---------- */
.hero { padding: 20px; border-radius: var(--radius); background: var(--raised); border: 1px solid var(--line); }
.hero-label { font-size: 13px; color: var(--muted); }
.amount-xl { font-size: 36px; font-weight: 750; letter-spacing: -.03em; line-height: 1.15; margin-top: 4px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.hero-sub { margin-top: 8px; font-size: 13px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
.hero-sub svg { width: 16px; height: 16px; }

/* ---------- quick actions ---------- */
.quick { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 16px; }
.quick-btn { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 14px 6px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--card); font-size: 13px; font-weight: 600; transition: border-color .15s, background .15s; }
.quick-btn:hover { border-color: var(--line-strong); background: var(--raised); }
.quick-icon { width: 40px; height: 40px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); display: inline-flex; align-items: center; justify-content: center; }

/* ---------- sections / lists ---------- */
.section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 28px 0 6px; }
.section-head h2 { font-size: 15px; font-weight: 650; }
.group-label { font-size: 12px; font-weight: 600; color: var(--muted); margin: 18px 0 2px; }
.list { list-style: none; padding: 0; }
.row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 56px; padding: 10px 0; border: 0; border-bottom: 1px solid var(--line); background: none; text-align: left; text-decoration: none; color: inherit; }
.list > li:last-child .row, .list > .row:last-child, .list > li.row:last-child { border-bottom: 0; }
a.row:hover .row-title, button.row:hover .row-title { text-decoration: underline; text-underline-offset: 3px; }
.row-icon { width: 38px; height: 38px; flex-shrink: 0; border-radius: 999px; background: var(--raised); border: 1px solid var(--line); display: inline-flex; align-items: center; justify-content: center; color: var(--muted); }
.row-icon.in { color: var(--accent); background: var(--accent-soft); border-color: transparent; }
.row-icon svg { width: 18px; height: 18px; }
.row-main { flex: 1; min-width: 0; }
.row-title, .row-sub { display: block; }
.row-title { font-size: 14px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-sub { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-end { flex-shrink: 0; text-align: right; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.row-end.in { color: var(--accent); }
.chev { color: var(--faint); width: 18px; height: 18px; }
.empty { padding: 28px 8px; text-align: center; color: var(--muted); font-size: 13px; }

/* ---------- forms ---------- */
.field { margin-top: 16px; }
.field label, .label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.field input, .input-prefix { width: 100%; height: 50px; border-radius: var(--radius-sm); border: 1px solid var(--line-strong); background: var(--card); padding: 0 14px; font-size: 16px; transition: border-color .15s, box-shadow .15s; }
.field input:focus, .input-prefix:focus-within { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.input-prefix { display: flex; align-items: center; gap: 10px; padding: 0 0 0 14px; }
.input-prefix span { color: var(--muted); font-variant-numeric: tabular-nums; }
.input-prefix input { flex: 1; min-width: 0; height: 100%; border: 0; background: transparent; padding: 0 14px 0 0; font-size: 16px; }
.input-prefix input:focus { outline: none; }
.amount-wrap { margin-top: 8px; padding: 18px 16px; border-radius: var(--radius); background: var(--raised); border: 1px solid var(--line); text-align: center; }
.amount-wrap:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.amount-input { width: 100%; border: 0; background: transparent; text-align: center; font-size: 36px; font-weight: 750; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.amount-input:focus { outline: none; }
.amount-cur { font-size: 13px; color: var(--muted); font-weight: 600; }
.hint { margin-top: 6px; font-size: 12px; color: var(--muted); }

/* ---------- segmented choice ---------- */
.seg { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.seg-opt { min-height: 48px; padding: 8px 10px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--card); font-weight: 600; font-size: 14px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: border-color .15s, background .15s; }
.seg-opt[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent); }

/* ---------- buttons ---------- */
.btn { width: 100%; min-height: 52px; padding: 0 20px; border: 0; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-weight: 700; font-size: 15px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: filter .15s, opacity .15s, transform .05s; text-decoration: none; }
.btn:hover { filter: brightness(1.06); }
.btn:active { transform: translateY(1px); }
.btn:disabled, .btn[aria-disabled="true"] { opacity: .4; cursor: not-allowed; filter: none; transform: none; }
.btn-secondary { background: transparent; color: var(--text); box-shadow: inset 0 0 0 1px var(--line-strong); }
.btn-danger { background: transparent; color: var(--danger); box-shadow: inset 0 0 0 1px var(--danger); }
.btn-ghost { background: transparent; color: var(--accent); min-height: 44px; }
.btn-row { display: flex; gap: 10px; }
.btn-row .btn { flex: 1; }
.link { border: 0; background: none; padding: 0; color: var(--accent); font-weight: 600; font-size: 13px; text-decoration: none; }
.link:hover { text-decoration: underline; text-underline-offset: 3px; }
.actions-bar { flex-shrink: 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid var(--line); background: var(--card); }
@media (min-width: 480px) { .actions-bar { padding: 14px 24px 20px; } }
.actions-bar .btn + .btn { margin-top: 10px; }

/* ---------- fee breakdown / receipt ---------- */
.fees, .receipt { margin-top: 16px; padding: 12px 16px; border-radius: var(--radius-sm); border: 1px solid var(--line); background: var(--raised); }
.fees-row { display: flex; justify-content: space-between; gap: 16px; padding: 5px 0; font-size: 14px; color: var(--muted); }
.fees-row span:last-child { color: var(--text); font-variant-numeric: tabular-nums; text-align: right; overflow-wrap: anywhere; }
.fees-row.total { margin-top: 6px; padding-top: 10px; border-top: 1px solid var(--line); color: var(--text); font-weight: 700; font-size: 15px; }

/* ---------- notes / messages / states ---------- */
.note { display: flex; gap: 10px; align-items: flex-start; margin-top: 16px; padding: 12px 14px; border-radius: var(--radius-sm); background: var(--accent-soft); font-size: 13px; }
.note svg { width: 18px; height: 18px; color: var(--accent); margin-top: 1px; }
.note.warn { background: var(--warn-soft); } .note.warn svg { color: var(--warn); }
.msg { margin-top: 12px; font-size: 13px; min-height: 0; }
.msg:empty { margin-top: 0; }
.msg.err { color: var(--danger); } .msg.ok { color: var(--accent); }
.state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 32px 16px; }
.content > .state { flex: none; overflow: visible; padding: 24px 8px 8px; }
.state h2 { font-size: 20px; font-weight: 700; letter-spacing: -.01em; margin-top: 16px; }
.state p { color: var(--muted); font-size: 14px; margin-top: 6px; max-width: 320px; }
.state-icon { width: 64px; height: 64px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; animation: pop .25s var(--ease); }
.state-icon svg { width: 30px; height: 30px; }
.state-icon.ok { background: var(--accent); color: var(--on-accent); }
.state-icon.err { background: var(--danger-soft); color: var(--danger); }
.state-icon.wait { background: var(--warn-soft); color: var(--warn); }
.spinner { width: 44px; height: 44px; border-radius: 999px; border: 3px solid var(--line); border-top-color: var(--accent); animation: spin .9s linear infinite; }
.spinner.sm { width: 18px; height: 18px; border-width: 2px; }
.avatar { width: 40px; height: 40px; flex-shrink: 0; border-radius: 999px; background: var(--accent-soft); color: var(--accent); display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; }
.avatar-lg { width: 64px; height: 64px; font-size: 22px; }
.pill { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 999px; font-size: 11px; font-weight: 650; background: var(--raised); color: var(--muted); }
.pill.ok { background: var(--accent-soft); color: var(--accent); }
.pill.warn { background: var(--warn-soft); color: var(--warn); }
.pill.err { background: var(--danger-soft); color: var(--danger); }
.card-block { margin-top: 16px; padding: 16px; border-radius: var(--radius-sm); border: 1px solid var(--line); }
.danger-zone { margin-top: 28px; padding: 16px; border-radius: var(--radius-sm); border: 1px solid var(--danger-soft); background: var(--danger-soft); }

/* ---------- overlay sheet ---------- */
.overlay { position: fixed; inset: 0; z-index: 50; background: rgba(0,0,0,.55); display: flex; align-items: flex-end; justify-content: center; padding: 0; animation: enter .15s var(--ease); }
.sheet { width: 100%; max-width: 440px; background: var(--card); border-radius: var(--radius) var(--radius) 0 0; padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); box-shadow: var(--shadow); }
@media (min-width: 480px) { .overlay { align-items: center; padding: 16px; } .sheet { border-radius: var(--radius); padding: 24px; } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .spinner { animation: spin 2.4s linear infinite !important; }
}
`;
