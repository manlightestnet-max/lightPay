import { AIRTEL_PNG, MARK_PNG, MTN_PNG } from './brand.js';

/**
 * LightPay hosted pages — design system (one stylesheet, served under the page nonce).
 * Brand: the green ribbon mark; green for the primary action and money received, everything
 * else in neutral ink. Colours from Salacope's tokens. Night by default, day available.
 *
 * Layout
 *   <div class="app">                         full-bleed on phones, centered 440px card from 480px
 *     <section class="screen" data-screen="x"> one screen at a time (hidden attribute)
 *       <header class="topbar">               back button · title · end slot
 *       <div class="content">…</div>          the only part that scrolls
 *       <div class="actions-bar">…buttons…</div>   pinned at the bottom
 *   <nav class="tabbar">                      root screens only, icons
 *
 * Blocks
 *   .brand (.brand-mark + .brand-word)            logo
 *   .hero (.hero-label .amount-xl .hero-sub), .hero-split (+ .hero-actions)   balance block
 *   .section-head (h2 + .link)                    section title with a link
 *   .day-label                                    day heading inside an activity list (sticky)
 *   .tx (.tx-icon, .tx-main > .tx-amt + .tx-desc, .tx-end)   one operation (canvas layout)
 *   .filters > button[aria-pressed]               pinned list filter
 *   .group > .row                                 settings card (rows separated by hairlines)
 *   ul.list > li.row (.row-icon, .row-main > .row-title + .row-sub, .row-end)   generic rows
 *   .field (label, input | .input-prefix > span + input, .hint)   form fields
 *   input.amount-input                            big numeric amount
 *   .seg > button.seg-opt[aria-pressed] (.op-dot.mtn|.airtel)     segmented choice
 *   .btn (.btn-secondary .btn-danger .btn-ghost .btn-sm) , .btn-row
 *   .fees > .fees-row (span + span), .fees-row.total   fee breakdown / receipt
 *   .note (svg + p) · .msg (.err .ok) · .state (.state-icon.ok|.err|.wait, h2, p)
 *   .spinner, .avatar (.avatar-lg), .pill (.ok .warn .err), .empty
 *   .overlay > .sheet                             modal sheet
 *   .sk (+ .sk-row …)                             shimmer placeholders
 * Utilities: .muted .small .mt .mt-lg .center .num
 */
export const CSS = `
/* Colours: Salacope's tokens are the source of truth (src/styles/tokens.css there).
   Night by default, like Salacope; day with data-theme="light". */
:root {
  color-scheme: dark;
  --mark: url("${MARK_PNG}"); --mtn: url("${MTN_PNG}"); --airtel: url("${AIRTEL_PNG}");
  --bg: #0b0b0c; --card: #131314; --raised: #1c1c1e; --line: #2a2a2d; --line-strong: #3a3a3e;
  --text: #f4f4f5; --muted: #9b9ba2; --faint: #6e6e75;
  --accent: #34d399; --on-accent: #04130d; --accent-soft: rgba(52, 211, 153, .12); --accent-ink: #34d399;
  --danger: #f87171; --danger-soft: rgba(248, 113, 113, .12); --warn: #fbbf24; --warn-soft: rgba(251, 191, 36, .12);
  --sk: #1c1c1e; --sk-hi: #2e2e32;
  --focus: #34d399; --shadow: 0 1px 0 rgba(255,255,255,.03), 0 30px 80px -24px rgba(0,0,0,.8);
  --radius: 24px; --radius-sm: 10px; --ease: cubic-bezier(.2,.7,.2,1);
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #f4f4f6; --card: #ffffff; --raised: #f4f4f5; --line: #e4e4e7; --line-strong: #d4d4d8;
  --text: #18181b; --muted: #71717a; --faint: #a1a1aa;
  --accent: #047857; --on-accent: #ffffff; --accent-soft: #ecfdf5; --accent-ink: #047857;
  --danger: #dc2626; --danger-soft: #fef2f2; --warn: #d97706; --warn-soft: #fffbeb;
  --sk: #ececee; --sk-hi: #f8f8f9;
  --focus: #047857; --shadow: 0 1px 2px rgba(0,0,0,.04), 0 30px 80px -28px rgba(0,0,0,.2);
}
/* Theme toggle shows the icon of the theme you would switch to. */
.theme-dark-icon { display: none; }
:root[data-theme="light"] .theme-dark-icon { display: inline-flex; }
:root[data-theme="light"] .theme-light-icon { display: none; }
* { box-sizing: border-box; margin: 0; }
html { -webkit-text-size-adjust: 100%; -webkit-tap-highlight-color: transparent; }
body {
  min-height: 100vh; min-height: 100dvh; background: var(--bg); color: var(--text);
  font: 15px/1.5 'Poppins', system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
button, input, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
[hidden] { display: none !important; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
h1[tabindex="-1"]:focus, h2[tabindex="-1"]:focus { outline: none; }

/* ---------- layout: a fixed-height app frame; only the content area scrolls ---------- */
html, body { height: 100%; overflow: hidden; }
.app { position: relative; width: 100%; height: 100vh; height: 100dvh; background: var(--card); display: flex; flex-direction: column; overflow: hidden; }
.screen { flex: 1; min-height: 0; display: flex; flex-direction: column; animation: enter .2s var(--ease); }
.screen[data-nav="fwd"] { animation: push-in .3s var(--ease); }
.screen[data-nav="back"] { animation: pop-in .3s var(--ease); }
.screen[data-nav="fade"] { animation: fade .22s var(--ease); }
@keyframes push-in { from { opacity: 0; transform: translateX(32px); } to { opacity: 1; transform: none; } }
@keyframes pop-in { from { opacity: 0; transform: translateX(-32px); } to { opacity: 1; transform: none; } }
.content, .screen > .state { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.content::-webkit-scrollbar, .screen > .state::-webkit-scrollbar { display: none; }
.content { padding: 0 24px 28px; }
.foot { display: none; }
@media (min-width: 480px) {
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 16px; }
  .app { max-width: 440px; height: min(780px, calc(100dvh - 72px)); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
  .content { padding: 0 32px 28px; }
  .foot { display: block; text-align: center; color: var(--faint); font-size: 11px; padding-top: 14px; }
}
@keyframes enter { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pop { from { transform: scale(.8); opacity: 0; } to { transform: none; opacity: 1; } }

/* ---------- top bar ---------- */
.topbar { flex-shrink: 0; z-index: 5; display: flex; align-items: center; gap: 8px; min-height: 60px; padding: 8px 12px; background: var(--card); }
@media (min-width: 480px) { .topbar { padding: 10px 18px; } }
.topbar-title { flex: 1; min-width: 0; text-align: center; font-size: 11px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.topbar-title.pad { padding-left: 44px; }
.topbar-end { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.brand { display: inline-flex; align-items: center; gap: 8px; text-transform: none; letter-spacing: 0; }
.brand-mark { width: 26px; height: 26px; flex-shrink: 0; background: var(--mark) center / contain no-repeat; }
.brand-mark svg { display: none; }
.brand-word { font-size: 18px; font-weight: 600; letter-spacing: -.01em; color: var(--text); }
.brand-word b { font-weight: 600; color: var(--accent-ink); }
.icon-btn { width: 44px; height: 44px; flex-shrink: 0; border: 0; border-radius: 999px; background: transparent; display: inline-flex; align-items: center; justify-content: center; color: var(--text); transition: background .15s; }
.icon-btn:hover { background: var(--raised); }
.icon-btn svg { width: 21px; height: 21px; }
.amount-cur.below { color: var(--warn); font-weight: 600; }
.badge { font-size: 10px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; padding: 3px 9px; border-radius: 999px; color: var(--warn); background: var(--warn-soft); }

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
.hero { padding: 26px 0 8px; text-align: center; }
.hero-label { font-size: 11px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); }
.amount-xl { font-size: 40px; font-weight: 600; letter-spacing: -.02em; line-height: 1.15; margin-top: 4px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.amount-xl .cur { font-size: .42em; font-weight: 500; letter-spacing: 0; color: var(--muted); margin-left: 4px; }
.hero-sub { margin-top: 6px; font-size: 12px; color: var(--muted); display: flex; align-items: center; justify-content: center; gap: 6px; letter-spacing: .02em; }
.hero-sub svg { width: 15px; height: 15px; }
.hero-split { display: flex; align-items: center; justify-content: space-between; gap: 16px; text-align: left; padding: 18px 0 22px; }
.hero-split .hero-main { min-width: 0; }
.hero-split .hero-sub { justify-content: flex-start; }
.hero-split .amount-xl { font-size: 36px; }
.hero-actions { display: grid; gap: 8px; flex-shrink: 0; }
.chip { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 38px; padding: 0 16px 0 12px; border-radius: 999px; border: 0; background: var(--raised); color: var(--text); font-size: 13px; font-weight: 500; text-decoration: none; transition: transform .08s, filter .15s; white-space: nowrap; }
.chip svg { width: 17px; height: 17px; }
.chip.primary { background: var(--accent); color: var(--on-accent); }
.chip:active { transform: scale(.97); }
.chip:hover { filter: brightness(1.06); }
.home-hero { min-height: 42vh; min-height: 42dvh; display: flex; flex-direction: column; justify-content: center; padding: 40px 0 30px; }
.home-hero .amount-xl { font-size: 52px; }
.home-hero .hero-sub { margin-top: 10px; }
/* The three actions fill the row, edge to edge. */
.home-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 36px; }
.home-actions .chip { height: 50px; border-radius: 16px; padding: 0 8px; font-size: 14px; }
.home-more { display: block; margin: 8px 0 4px; padding: 14px; border-radius: 14px; background: var(--raised); text-align: center; color: var(--text); text-decoration: none; font-size: 13px; font-weight: 500; }
.send-link { display: flex; align-items: center; gap: 12px; padding: 13px 14px; border-radius: 14px; background: var(--raised); color: var(--text); text-decoration: none; font-size: 14px; }
.send-link svg { width: 18px; height: 18px; } .send-link .chev { color: var(--faint); } .send-link span { flex: 1; }
/* home: compact bar (motion on scroll) */
[data-screen="home"] { position: relative; }
.home-compact { position: absolute; top: var(--compact-top, 60px); left: 0; right: 0; z-index: 4; padding: 6px 24px 12px; background: var(--card); box-shadow: 0 10px 18px -14px rgba(0,0,0,.5);
  opacity: 0; visibility: hidden; transform: translateY(-14px); transition: opacity .22s var(--ease), transform .26s var(--ease), visibility 0s linear .26s; }
.compact-on .home-compact { opacity: 1; visibility: visible; transform: none; transition: opacity .22s var(--ease), transform .26s var(--ease), visibility 0s; }
@media (min-width: 480px) { .home-compact { padding: 6px 32px 12px; } }
.compact-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.compact-main { min-width: 0; }
.compact-amount { font-size: 24px; font-weight: 600; letter-spacing: -.02em; line-height: 1.2; font-variant-numeric: tabular-nums; white-space: nowrap; }
.compact-amount .cur { font-size: .5em; font-weight: 500; color: var(--muted); margin-left: 3px; }
.compact-actions { display: flex; gap: 6px; flex-shrink: 0; }
.compact-actions .chip { height: 36px; padding: 0 12px 0 10px; font-size: 12.5px; }
.home-compact .send-link { margin-top: 10px; padding: 11px 14px; }
.home-hero { transition: opacity .25s var(--ease), transform .3s var(--ease); }
.compact-on .home-hero { opacity: 0; transform: scale(.96); }
.compact-on .section-head.sticky { top: var(--compact-h, 116px); }
.section-head.sticky { transition: top .26s var(--ease); }

/* ---------- sections / activity ---------- */
.section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 28px 0 4px; }
.section-head h2 { font-size: 11px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); }
.day-label, .group-label { font-size: 12px; font-weight: 500; color: var(--muted); padding: 16px 0 4px; margin: 0; }
.tx { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 16px; padding: 10px 0; color: inherit; text-decoration: none; border-radius: 8px; }
.tx-icon { color: var(--muted); display: inline-flex; }
.tx-icon svg { width: 19px; height: 19px; }
.tx-main { min-width: 0; }
.tx-amt { display: block; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: .005em; }
.tx-desc { display: block; font-size: 11px; color: var(--muted); letter-spacing: .05em; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tx-end { font-size: 10px; font-weight: 500; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); font-variant-numeric: tabular-nums; }
.tx.in .tx-amt { color: var(--accent-ink); }
.tx.in .tx-icon { color: var(--accent-ink); }
.tx.void .tx-amt { color: var(--faint); text-decoration: line-through; font-weight: 500; }
.tx.wait .tx-end, .tx.held .tx-end { color: var(--warn); }
.tx.void .tx-end { color: var(--danger); }
a.tx:active { background: var(--raised); }
.filters { display: flex; justify-content: space-between; gap: 8px; padding: 2px 24px 0; flex-shrink: 0; border-bottom: 1px solid var(--line); }
@media (min-width: 480px) { .filters { padding: 2px 32px 0; } }
.filters button { border: 0; background: none; padding: 10px 0 9px; font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--faint); border-bottom: 2px solid transparent; margin-bottom: -1px; }
.filters button[aria-pressed="true"] { color: var(--text); border-bottom-color: var(--accent); }
.list { list-style: none; padding: 0; }
.row { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 52px; padding: 10px 0; border: 0; border-bottom: 1px solid var(--line); background: none; text-align: left; text-decoration: none; color: inherit; }
.list > li:last-child .row, .list > .row:last-child, .list > li.row:last-child { border-bottom: 0; }
.row-icon { width: 24px; height: 24px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; color: var(--muted); }
.row-icon.in { color: var(--accent-ink); }
.row-icon svg { width: 19px; height: 19px; }
.row-main { flex: 1; min-width: 0; }
.row-title, .row-sub { display: block; }
.row-title { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-sub { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-end { flex-shrink: 0; text-align: right; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.row-end.in { color: var(--accent-ink); }
.row-end.void { color: var(--faint); text-decoration: line-through; }
.row-end.held { color: var(--warn); }
.row-sub.err { color: var(--danger); }
.row-sub.warn { color: var(--warn); }
.chev { color: var(--faint); width: 18px; height: 18px; flex-shrink: 0; }
.empty { padding: 36px 8px; text-align: center; color: var(--muted); font-size: 13px; list-style: none; }
/* settings card */
.group { margin-top: 10px; padding: 0 16px; border-radius: 16px; background: var(--raised); list-style: none; }
.group .row { border-bottom-color: var(--line-strong); border-bottom-color: color-mix(in srgb, var(--line-strong) 55%, transparent); min-height: 56px; }
.group > li:last-child .row { border-bottom: 0; }
.group .row-title { font-weight: 400; font-size: 15px; }
.group .row.danger .row-title, .group .row.danger .row-icon { color: var(--danger); }
.group-title { font-size: 11px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); margin: 26px 4px 0; }

/* ---------- forms ---------- */
.field { margin-top: 18px; }
.field label, .label { display: block; font-size: 10px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); margin-bottom: 7px; }
.field input, .input-prefix { width: 100%; height: 52px; border-radius: var(--radius-sm); border: 1px solid var(--line-strong); background: transparent; padding: 0 14px; font-size: 16px; transition: border-color .15s, box-shadow .15s; }
.field input:focus, .input-prefix:focus-within { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.input-prefix { display: flex; align-items: center; gap: 10px; padding: 0 0 0 14px; }
.input-prefix span { color: var(--muted); font-variant-numeric: tabular-nums; }
.input-prefix input { flex: 1; min-width: 0; height: 100%; border: 0; background: transparent; padding: 0 14px 0 0; font-size: 16px; }
/* The box carries the border and the focus ring; the input inside never draws its own (no double stroke). */
.field .input-prefix input, .field .input-prefix input:focus, .input-prefix input:focus { outline: none; border: 0; box-shadow: none; border-radius: 0; height: 100%; padding: 0 14px 0 0; }
.amount-wrap { margin-top: 8px; padding: 20px 16px 16px; border-radius: 16px; background: var(--raised); border: 1px solid transparent; text-align: center; transition: border-color .15s, box-shadow .15s; }
.amount-wrap:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.amount-input { width: 100%; border: 0; background: transparent; text-align: center; font-size: 38px; font-weight: 600; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.amount-input::placeholder { color: var(--faint); }
.amount-input:focus { outline: none; }
.amount-cur { font-size: 12px; color: var(--muted); font-weight: 500; letter-spacing: .02em; }
.hint { margin-top: 6px; font-size: 12px; color: var(--muted); }

/* ---------- segmented choice ---------- */
.seg { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.seg-opt { min-height: 46px; padding: 8px 10px; border: 1px solid var(--line-strong); border-radius: 999px; background: transparent; font-weight: 500; font-size: 13px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: border-color .15s, background .15s; }
.seg-opt[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent); }
.op-logo { width: 22px; height: 22px; flex-shrink: 0; border-radius: 6px; background: center / cover no-repeat; }
.op-logo.mtn { background-image: var(--mtn); }
.op-logo.airtel { background-image: var(--airtel); }
.op-logo.lp { background-image: var(--mark); background-size: 78%; background-color: var(--card); box-shadow: inset 0 0 0 1px var(--line-strong); }

/* ---------- buttons ---------- */
.btn { width: 100%; min-height: 52px; padding: 0 20px; border: 0; border-radius: 14px; background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: filter .15s, opacity .15s, transform .08s; text-decoration: none; }
.btn:hover { filter: brightness(1.05); }
.btn:active { transform: scale(.99); }
.btn:disabled, .btn[aria-disabled="true"] { opacity: .35; cursor: not-allowed; filter: none; transform: none; }
.btn-secondary { background: transparent; color: var(--text); box-shadow: inset 0 0 0 1px var(--line-strong); }
.btn-danger { background: transparent; color: var(--danger); box-shadow: inset 0 0 0 1px var(--danger); }
.btn-ghost { background: transparent; color: var(--text); min-height: 44px; }
.btn.btn-sm { min-height: 40px; padding: 0 14px; font-size: 11px; border-radius: 999px; }
.btn.btn-sm svg { width: 16px; height: 16px; }
.btn-row { display: flex; gap: 10px; }
.btn-row .btn { flex: 1; }
.link { border: 0; background: none; padding: 0; color: var(--text); font-weight: 500; font-size: 12px; text-decoration: none; }
.link:hover { text-decoration: underline; text-underline-offset: 3px; }
.actions-bar { flex-shrink: 0; padding: 12px 24px calc(14px + env(safe-area-inset-bottom)); background: var(--card); }
@media (min-width: 480px) { .actions-bar { padding: 14px 32px 22px; } }
.actions-bar .btn + .btn { margin-top: 10px; }
.actions-bar > a.btn { display: inline-flex; }

/* ---------- fee breakdown / receipt ---------- */
.fees, .receipt { margin-top: 18px; padding: 6px 2px; }
.receipt.card { padding: 8px 16px; border-radius: 16px; background: var(--raised); }
.fees-row { display: flex; justify-content: space-between; gap: 16px; padding: 5px 0; font-size: 13px; letter-spacing: .02em; color: var(--muted); }
.fees-row span:last-child { color: var(--text); font-variant-numeric: tabular-nums; text-align: right; overflow-wrap: anywhere; }
.fees-row.total { margin-top: 6px; padding-top: 10px; border-top: 1px solid var(--line-strong); color: var(--text); font-weight: 600; font-size: 14px; }
.receipt.card .fees-row { padding: 9px 0; border-bottom: 1px solid var(--line); }
.receipt.card .fees-row:last-child { border-bottom: 0; }
.receipt.card .fees-row.total { margin: 0; border-top: 0; font-weight: 400; font-size: 13px; color: var(--muted); }
.receipt.card .fees-row.total span:last-child { font-size: 12px; color: var(--muted); }

/* ---------- operation detail ---------- */
.detail-head { text-align: center; padding: 22px 0 6px; }
.detail-icon { width: 56px; height: 56px; margin: 0 auto; border-radius: 999px; background: var(--raised); color: var(--text); display: flex; align-items: center; justify-content: center; }
.detail-icon svg { width: 24px; height: 24px; }
.detail-icon.in { background: var(--accent-soft); color: var(--accent-ink); }
.detail-icon.err { background: var(--danger-soft); color: var(--danger); }
.detail-kind { margin-top: 12px; font-size: 13px; color: var(--muted); }
.detail-head .amount-xl { margin-top: 2px; }
.detail-head .amount-xl.in { color: var(--accent-ink); }
.detail-head .amount-xl.void { color: var(--faint); text-decoration: line-through; }
.status { display: inline-flex; align-items: center; gap: 7px; margin-top: 10px; font-size: 12px; font-weight: 500; color: var(--muted); }
.status::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--faint); }
.status.ok::before { background: var(--accent); } .status.warn::before { background: var(--warn); } .status.err::before { background: var(--danger); }

/* ---------- notes / messages / states ---------- */
.note { display: flex; gap: 10px; align-items: flex-start; margin-top: 18px; padding: 12px 14px; border-radius: 14px; background: var(--raised); font-size: 13px; color: var(--muted); }
.note svg { width: 18px; height: 18px; color: var(--text); margin-top: 1px; flex-shrink: 0; }
.note.warn { background: var(--warn-soft); color: var(--text); } .note.warn svg { color: var(--warn); }
.msg { margin-top: 12px; font-size: 13px; min-height: 0; }
.terms { margin: 8px 0 0; padding-left: 18px; font-size: 13px; color: var(--muted); }
.terms li + li { margin-top: 6px; }
.agree { display: flex; gap: 10px; align-items: flex-start; margin-top: 12px; font-size: 14px; cursor: pointer; }
.agree input { width: 18px; height: 18px; margin: 1px 0 0; flex-shrink: 0; accent-color: var(--accent); }
.amount-bad { margin-top: 6px; font-size: 13px; color: var(--danger); }
[data-amount][aria-invalid="true"] { border-color: var(--danger); }
.msg:empty { margin-top: 0; }
.msg.err { color: var(--danger); } .msg.ok { color: var(--text); }
.state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 32px 24px; }
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
.avatar { width: 40px; height: 40px; flex-shrink: 0; border-radius: 999px; background: var(--raised); color: var(--text); display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px; }
.avatar-lg { width: 60px; height: 60px; font-size: 21px; background: var(--accent-soft); color: var(--accent-ink); }
.pill { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: var(--raised); color: var(--muted); }
.pill.ok { background: var(--accent-soft); color: var(--accent-ink); }
.pill.warn { background: var(--warn-soft); color: var(--warn); }
.pill.err { background: var(--danger-soft); color: var(--danger); }
.card-block { margin-top: 16px; padding: 16px; border-radius: 16px; background: var(--raised); }
.danger-zone { margin-top: 28px; padding: 16px; border-radius: 16px; background: var(--danger-soft); }

/* ---------- overlay sheet ---------- */
/* Bottom sheet: inside the app frame, attached to its bottom edge, slides up; a handle on top. */
.overlay { position: absolute; inset: 0; z-index: 50; background: rgba(0,0,0,.55); display: flex; align-items: flex-end; justify-content: center; padding: 0; animation: fade .18s var(--ease); }
.sheet { position: relative; width: 100%; max-height: 92%; overflow-y: auto; background: var(--card); border-radius: 24px 24px 0 0; padding: 30px 24px calc(22px + env(safe-area-inset-bottom)); box-shadow: 0 -12px 40px -12px rgba(0,0,0,.45); animation: sheet-up .28s var(--ease); }
.sheet::before { content: ''; position: absolute; top: 10px; left: 50%; width: 40px; height: 4px; margin-left: -20px; border-radius: 999px; background: var(--line-strong); }
@media (min-width: 480px) { .sheet { padding: 32px 32px 26px; } }
@keyframes sheet-up { from { transform: translateY(100%); } to { transform: none; } }
.overlay.closing { animation: fade-out .2s var(--ease) forwards; }
.overlay.closing .sheet { animation: sheet-down .2s var(--ease) forwards; }
@keyframes sheet-down { to { transform: translateY(100%); } }
@keyframes fade-out { to { opacity: 0; } }
.sheet .eyebrow { text-align: center; }
.sheet-amount { text-align: center; font-size: 34px; margin-top: 6px; }
.sheet .receipt { margin-top: 10px; }
.sheet .btn-row .btn { min-height: 50px; }

/* ---------- scaffold: pinned blocks, sticky headings, bottom bar ---------- */
.pinned { flex-shrink: 0; padding: 0 24px 10px; border-bottom: 1px solid var(--line); }
@media (min-width: 480px) { .pinned { padding: 0 32px 12px; } }
.section-head.sticky, .day-label, .group-label { position: sticky; top: 0; z-index: 2; background: var(--card); }
.section-head.sticky { margin: 0; padding: 22px 0 8px; box-shadow: 0 -12px 0 var(--card); }
.tabbar { flex-shrink: 0; display: flex; justify-content: space-around; padding: 4px 32px env(safe-area-inset-bottom); background: var(--card); border-top: 1px solid var(--line); }
.tabbar > a, .tabbar > button { position: relative; width: 64px; min-height: 58px; border: 0; background: none; display: flex; align-items: center; justify-content: center; color: var(--faint); text-decoration: none; transition: color .15s; }
.tabbar > a > span, .tabbar > button > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.tabbar svg { width: 23px; height: 23px; stroke-width: 1.7; }
.tabbar > [aria-current="page"] { color: var(--text); }
.tabbar > [aria-current="page"]::after { content: ''; position: absolute; bottom: 8px; width: 4px; height: 4px; border-radius: 50%; background: var(--accent); }
.profile { display: flex; align-items: center; gap: 14px; padding: 14px 0 0; }
.profile-main { min-width: 0; }
.profile-name { font-size: 17px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.profile-handle { font-size: 13px; color: var(--muted); }
.hint.err { color: var(--danger); }
.field textarea { width: 100%; border-radius: var(--radius-sm); border: 1px solid var(--line-strong); background: transparent; padding: 12px 14px; font-size: 15px; resize: vertical; min-height: 96px; }
.field textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.auth-mark { display: block; width: 52px; height: 52px; margin: 18px 0 4px; background: var(--mark) center / contain no-repeat; }

/* ---------- shimmer placeholders (while a screen loads) ---------- */
.sk { display: block; border-radius: 7px; background: linear-gradient(100deg, var(--sk) 20%, var(--sk-hi) 50%, var(--sk) 80%); background-size: 250% 100%; animation: shimmer 1.2s linear infinite; }
.sk.inline { display: inline-block; vertical-align: middle; }
.sk-row { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 16px; padding: 12px 0; list-style: none; }
.sk-lines { display: grid; gap: 7px; }
.sk-screen { padding: 8px 24px 24px; }
.sk-pad { padding: 4px 20px; }
@media (min-width: 480px) { .sk-screen { padding: 8px 32px 24px; } }
.sk-ic { width: 20px; height: 20px; border-radius: 6px; }
.sk-t { height: 13px; } .sk-s { height: 9px; } .sk-amt { width: 42px; height: 10px; }
.w-30 { width: 30%; } .w-45 { width: 45%; } .w-60 { width: 60%; } .w-75 { width: 75%; }
.sk-amount { width: 170px; height: 38px; margin-top: 6px; }
.hero .sk-amount { margin-left: auto; margin-right: auto; }
.hero-split .sk-amount { margin-left: 0; }
.sk-circle { width: 56px; height: 56px; border-radius: 999px; margin: 0 auto; }
.sk-hero { width: 55%; height: 44px; margin: 14px auto 10px; }
.sk-sub { width: 40%; height: 10px; margin: 0 auto 30px; }
.sk-pills { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 30px; }
.sk-pill { height: 74px; border-radius: 16px; }
.sk-field { height: 48px; margin-top: 14px; }
.sk-line { margin-top: 12px; }
.sk-btn { height: 52px; margin-top: 30px; border-radius: 14px; }
.sk-card { height: 200px; margin-top: 22px; border-radius: 16px; }
.sk-kv { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; }
.sk-kv .sk-v { width: 72px; }
.sk-block { padding-top: 18px; }
.sk-block .sk + .sk { margin-top: 12px; }
.sk-center { margin: 12px auto 0; }
.detail-head .sk-amount { height: 40px; }
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: -150% 0; } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; }
  .screen, .overlay, .sheet, .state-icon { animation: none !important; }
  .spinner { animation: spin 2.4s linear infinite !important; }
  .sk { animation-duration: 2.4s !important; }
}
`;
