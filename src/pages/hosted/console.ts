/**
 * LightPay console (the account page): a back-office layout on top of the hosted design system.
 *
 *   <div class="app console">
 *     <div class="console-shell">
 *       <aside class="side">           brand · Test/Réel switch · nav groups (.nav-item[aria-current]) · me
 *       <div class="main">
 *         <header class="main-top">    menu (phones) · breadcrumb · end slot
 *         <div class="console-body">   the only scrolling area; one .screen at a time
 *           <section class="screen"><div class="page">
 *             .page-head (.page-title, .page-actions) · .tabs (a.tab[aria-current])
 *             .panel (.panel-head > .panel-title + actions · .panel-body | .panel-flush · .panel-foot)
 *             .well > .stat (.stat-label .stat-value .stat-hint) · table.tbl · .grid-2 (list + detail)
 *     <section id="auth" class="screen">  sign in (split: brand aside + form)
 */
export const CONSOLE_CSS = `
html.console-page, html.console-page body { height: 100%; overflow: hidden; }
html.console-page body { display: block; padding: 0; background: var(--bg); }
html.console-page .foot { display: none; }
.app.console { max-width: none; width: 100%; height: 100vh; height: 100dvh; border: 0; border-radius: 0; box-shadow: none; background: var(--bg); }
.console-shell { display: flex; height: 100%; min-height: 0; }

/* ---------- sidebar ---------- */
.side { width: 252px; flex-shrink: 0; display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--line); background: var(--card); }
.side-head { display: flex; align-items: center; gap: 10px; padding: 16px 16px 14px; }
.side-head .brand { font-size: 16px; }
.side-head small { display: block; font-size: 11px; font-weight: 500; color: var(--faint); letter-spacing: 0; }
.env-switch { margin: 0 14px 6px; display: grid; grid-template-columns: 1fr 1fr; gap: 3px; padding: 3px; border: 1px solid var(--line); border-radius: 11px; }
.env-switch button { border: 0; background: none; text-align: center; padding: 6px 0; border-radius: 8px; font-size: 12px; font-weight: 600; color: var(--muted); }
.env-switch button:hover { color: var(--text); }
.env-switch button[aria-current] { background: var(--raised); color: var(--text); box-shadow: 0 0 0 1px var(--line); }
.env-switch button.test[aria-current] { color: var(--warn); }
.side-nav { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 12px 12px; scrollbar-width: none; }
.side-nav::-webkit-scrollbar { display: none; }
.nav-label { margin: 18px 10px 6px; font-size: 11px; font-weight: 650; color: var(--faint); letter-spacing: .02em; }
.nav-item { display: flex; align-items: center; gap: 10px; min-height: 36px; padding: 0 10px; border-radius: 10px; color: var(--muted); text-decoration: none; font-size: 14px; font-weight: 550; transition: background .12s, color .12s; }
.nav-item:hover { background: var(--raised); color: var(--text); }
.nav-item svg { width: 18px; height: 18px; flex-shrink: 0; }
.nav-item span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-item.sub { min-height: 32px; padding-left: 38px; font-size: 13px; }
.nav-item[aria-current="page"] { background: var(--accent); color: var(--on-accent); font-weight: 650; }
.nav-count { flex: none !important; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--raised); color: var(--muted); font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.nav-item[aria-current="page"] .nav-count { background: rgba(0,0,0,.14); color: var(--on-accent); }
.side-foot { border-top: 1px solid var(--line); padding: 10px 12px; }
.me { display: flex; align-items: center; gap: 10px; padding: 6px; border-radius: 12px; }
.me .avatar { width: 34px; height: 34px; font-size: 12px; }
.me-main { flex: 1; min-width: 0; }
.me-name, .me-mail { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.me-name { font-size: 13px; font-weight: 650; }
.me-mail { font-size: 12px; color: var(--muted); }

/* ---------- main column ---------- */
.main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.main-top { height: 56px; flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 0 16px 0 20px; border-bottom: 1px solid var(--line); background: var(--bg); }
.menu-btn { display: none; }
.crumbs { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); white-space: nowrap; overflow: hidden; }
.crumbs svg { width: 14px; height: 14px; color: var(--faint); flex-shrink: 0; }
.crumbs b { color: var(--text); font-weight: 650; overflow: hidden; text-overflow: ellipsis; }
.main-top .icon-btn { width: 38px; height: 38px; }
.main-top .icon-btn svg { width: 19px; height: 19px; }
.console-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.console-body > .screen { display: block; min-height: 0; }
.page { max-width: 1140px; margin: 0 auto; padding: 28px 28px 56px; }
.page.narrow { max-width: 640px; }
.page-head { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 12px; margin-bottom: 22px; }
.page-title { font-size: 24px; font-weight: 750; letter-spacing: -.025em; line-height: 1.2; }
.page-sub { width: 100%; margin-top: -4px; font-size: 14px; color: var(--muted); }
.page-actions { margin-left: auto; display: flex; flex-wrap: wrap; gap: 8px; }
.btn.btn-sm { width: auto; min-height: 40px; padding: 0 16px; font-size: 14px; }
.btn.btn-sm svg { width: 17px; height: 17px; }

/* ---------- tabs (sub-pages) ---------- */
.tabs { display: flex; gap: 6px; margin: -6px 0 22px; overflow-x: auto; scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }
.tab { flex-shrink: 0; height: 34px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); color: var(--muted); font-size: 13px; font-weight: 650; text-decoration: none; display: inline-flex; align-items: center; }
.tab:hover { color: var(--text); border-color: var(--line-strong); }
.tab[aria-current="page"] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }

/* ---------- panels ---------- */
.panel { border: 1px solid var(--line); border-radius: 18px; background: var(--card); min-width: 0; }
.stack > * + * { margin-top: 20px; }
/* Blocks placed directly in a page never touch: the same 20px between every panel, grid and stack. */
.page > :is(.panel, .grid-2, .stack, .well) + :is(.panel, .grid-2, .stack, .well) { margin-top: 20px; }
.grid-2 > * > :is(.panel, .stack) + :is(.panel, .stack) { margin-top: 20px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px 12px; padding: 16px 20px; }
.panel-title { display: flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 700; letter-spacing: -.01em; min-width: 0; }
.panel-title .count { color: var(--faint); font-weight: 550; font-variant-numeric: tabular-nums; }
.panel-sub { width: 100%; margin-top: -6px; font-size: 13px; color: var(--muted); }
.panel-body { padding: 0 20px 20px; }
.panel-flush { border-top: 1px solid var(--line); }
.panel-foot { padding: 12px 20px 16px; font-size: 12px; color: var(--faint); text-align: right; }
.panel-flush + .panel-foot { border-top: 1px solid var(--line); }
.panel-actions { display: flex; flex-wrap: wrap; gap: 10px; padding: 16px 20px; border-top: 1px solid var(--line); }
.panel-actions .btn { width: auto; flex: 1 1 200px; }
.panel .empty { padding: 36px 16px; }
.grid-2 { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 20px; align-items: start; }
.grid-2 > .sticky { position: sticky; top: 0; }

/* ---------- scaffold: on list screens the head and figures stay, only the lists scroll ---------- */
.console-body > .screen.fill { height: 100%; }
.screen.fill > .page { height: 100%; display: flex; flex-direction: column; padding-bottom: 20px; }
.screen.fill > .page > :is(.page-head, .well, .note, .msg) { flex-shrink: 0; }
.screen.fill > .page > :is(.grow, .grid-2) { flex: 1; min-height: 0; }
.screen.fill .grid-2 { align-items: stretch; }
.screen.fill :is(.panel.grow, .grid-2 > .panel) { display: flex; flex-direction: column; min-height: 0; max-height: 100%; }
.screen.fill .scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.scroll, .console-body, .side-nav { scrollbar-width: none; }
.scroll::-webkit-scrollbar, .console-body::-webkit-scrollbar { display: none; }
/* long titles shorten, the amount column always shows in full */
.tbl td:first-child { width: 100%; max-width: 0; }
.tbl td.num, .tbl th.num { width: 1%; }
.cell-main { overflow: hidden; }
.cell-title, .cell-sub { max-width: 100%; }
.scroll thead th { position: sticky; top: 0; z-index: 1; background: var(--card); }
.page > .well + .panel { margin-top: 20px; }
.sk-stat { width: 110px; height: 26px; margin-top: 2px; }
.show-narrow { display: none; }
.console-tabbar { display: none; }

/* ---------- key figures ---------- */
.well { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 20px 24px; padding: 18px 20px; border-radius: 14px; background: var(--raised); }
.stat { min-width: 0; }
.stat-label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.stat-value { margin-top: 6px; font-size: 26px; font-weight: 750; letter-spacing: -.025em; line-height: 1.15; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.stat-value.accent { color: var(--accent); }
.stat-hint { margin-top: 4px; font-size: 12px; color: var(--muted); }

/* ---------- help tip ---------- */
.tip { position: relative; display: inline-flex; }
.tip > button { width: 18px; height: 18px; padding: 0; border: 0; background: none; color: var(--faint); display: inline-flex; align-items: center; justify-content: center; }
.tip > button:hover, .tip > button:focus-visible { color: var(--text); }
.tip > button svg { width: 15px; height: 15px; }
.tip-text { position: absolute; z-index: 30; top: calc(100% + 8px); left: 50%; transform: translateX(-50%); width: 240px; padding: 9px 11px; border-radius: 10px; background: var(--text); color: var(--bg); font-size: 12px; font-weight: 500; line-height: 1.45; letter-spacing: 0; text-transform: none; opacity: 0; pointer-events: none; transition: opacity .15s; }
.tip:hover .tip-text, .tip:focus-within .tip-text { opacity: 1; }

/* ---------- tables ---------- */
.tbl-wrap { overflow-x: auto; }
.tbl { width: 100%; border-collapse: collapse; font-size: 14px; }
.tbl th { height: 38px; padding: 0 20px; text-align: left; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); white-space: nowrap; border-bottom: 1px solid var(--line); }
.tbl td { padding: 12px 20px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.tbl tbody tr:last-child td { border-bottom: 0; }
.tbl th.num, .tbl td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.tbl tr[data-href] { cursor: pointer; transition: background .12s; }
.tbl tr[data-href]:hover { background: var(--raised); }
.tbl tr[aria-selected="true"] { background: var(--raised); box-shadow: inset 3px 0 0 var(--accent); }
.tbl .strong { font-weight: 650; }
.tbl .in { color: var(--accent); } .tbl .void { color: var(--faint); text-decoration: line-through; } .tbl .held { color: var(--warn); }
.cell { display: flex; align-items: center; gap: 12px; min-width: 0; }
.cell .row-icon { width: 34px; height: 34px; }
.cell-main { min-width: 0; }
.cell-title, .cell-sub { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cell-title { font-weight: 600; max-width: 100%; }
.cell-sub { font-size: 12px; color: var(--muted); max-width: 100%; }
.cell-sub.err { color: var(--danger); } .cell-sub.warn { color: var(--warn); }
.muted-cell { color: var(--muted); white-space: nowrap; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }

/* ---------- compact segmented filter ---------- */
.seg-sm { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--line); border-radius: 11px; }
.seg-sm button { height: 28px; padding: 0 10px; border: 0; border-radius: 8px; background: none; color: var(--muted); font-size: 13px; font-weight: 600; white-space: nowrap; }
.seg-sm button:hover { color: var(--text); }
.seg-sm button[aria-pressed="true"] { background: var(--raised); color: var(--text); box-shadow: 0 0 0 1px var(--line); }

/* ---------- details / keys ---------- */
.kv { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 0; font-size: 14px; }
.kv > * { padding: 12px 0; border-bottom: 1px solid var(--line); }
.kv > :nth-last-child(-n+2) { border-bottom: 0; }
.kv dt { color: var(--muted); }
.kv dd { min-width: 0; overflow-wrap: anywhere; }
.keybox { display: flex; align-items: center; gap: 8px; }
.keybox code { flex: 1; min-width: 0; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--raised); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; overflow-wrap: anywhere; }
.keybox .icon-btn { width: 38px; height: 38px; border: 1px solid var(--line); border-radius: 10px; }
.keybox .icon-btn svg { width: 17px; height: 17px; }
.code { margin: 0; padding: 16px 18px; border-radius: 14px; background: #0e1110; color: #d9e6df; font: 12.5px/1.65 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-x: auto; white-space: pre; }
textarea.field-area { width: 100%; min-height: 110px; padding: 12px 14px; border-radius: var(--radius-sm); border: 1px solid var(--line-strong); background: var(--card); font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--text); resize: vertical; }
textarea.field-area:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.hero-empty { padding: 44px 24px; text-align: center; }
.hero-empty .state-icon { margin: 0 auto; background: var(--accent-soft); color: var(--accent); }
.hero-empty h2 { margin-top: 14px; font-size: 18px; font-weight: 700; }
.hero-empty p { margin: 6px auto 0; max-width: 440px; color: var(--muted); font-size: 14px; }
.hero-empty .btn { width: auto; margin-top: 18px; }
.detail-head { display: flex; align-items: center; gap: 12px; padding: 18px 20px 6px; }
.detail-head .amount { font-size: 22px; font-weight: 750; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }

/* flows (recharge, envoi, retrait) inside a panel */
.console .content { padding: 0; overflow: visible; }
.console .panel .actions-bar { padding: 16px 20px; background: none; border-top: 1px solid var(--line); border-radius: 0 0 18px 18px; }
.console .screen > .state { padding: 48px 16px; }

/* ---------- phones: drawer menu, stacked layout ---------- */
.scrim { display: none; }
@media (max-width: 960px) {
  .side { position: fixed; top: 0; bottom: 0; left: 0; z-index: 40; width: 280px; transform: translateX(-102%); transition: transform .2s var(--ease); box-shadow: var(--shadow); }
  .side.open { transform: none; }
  .scrim.open { display: block; position: fixed; inset: 0; z-index: 39; background: rgba(0,0,0,.5); }
  .menu-btn { display: inline-flex; margin-left: -8px; }
  .main-top { padding: 0 10px 0 16px; }
  .grid-2 { grid-template-columns: 1fr; }
  .grid-2 > .sticky { position: static; }
  /* one of list / detail at a time */
  .grid-2:has(> .detail-panel):not(.has-detail) > .detail-panel { display: none; }
  .grid-2.has-detail > :not(.detail-panel) { display: none; }
  .show-narrow { display: inline; }
  .console-tabbar { display: grid; }
  .screen.fill > .page { padding-bottom: 12px; }
  .well { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 16px; padding: 14px 16px; }
  .stat-value { font-size: 20px; }
  /* phones: the bottom bar's + replaces the action buttons; only the balance figures stay */
  .screen.fill .page-actions { display: none; }
  .screen.fill .well > .stat:nth-child(n+3), .screen.fill .stat-hint { display: none; }
  .page { padding: 20px 16px 48px; }
  .page-title { font-size: 21px; }
  .hide-md { display: none; }
  .kv { grid-template-columns: 1fr; }
  .kv dt { padding-bottom: 0; border-bottom: 0; }
}
@media (max-width: 560px) {
  .hide-sm { display: none; }
  .tbl th, .tbl td { padding-left: 14px; padding-right: 14px; }
  .panel-head, .panel-body, .panel-foot, .panel-actions { padding-left: 16px; padding-right: 16px; }
  .page-actions { width: 100%; margin-left: 0; }
  .page-actions .btn { flex: 1; }
}

/* ---------- sign in: brand panel + form ---------- */
html.console-page #auth { flex-direction: row; background: var(--bg); }
.auth-aside { flex: 1.1; min-width: 0; display: flex; flex-direction: column; justify-content: center; padding: 56px; background: #1c1c1c; color: #f2f2f2; position: relative; overflow: hidden; }
.auth-aside::after { content: none; }
.auth-aside .pill-brand { align-self: flex-start; display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px 6px 6px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; font-size: 13px; font-weight: 600; }
.auth-aside h2 { margin-top: 28px; font-size: 40px; line-height: 1.08; letter-spacing: -.02em; font-weight: 600; max-width: 460px; }
.auth-aside > p { margin-top: 14px; max-width: 460px; color: #a3a3a3; font-size: 15px; }
.auth-tools { margin-top: 28px; display: grid; gap: 10px; max-width: 460px; }
.auth-tool { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 16px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); }
.auth-tool .tool-icon { width: 38px; height: 38px; border-radius: 11px; background: #f2f2f2; color: #111111; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.auth-tool .tool-icon svg { width: 19px; height: 19px; }
.auth-tool b { display: block; font-size: 14px; }
.auth-tool span { display: block; font-size: 13px; color: #a3a3a3; }
.auth-points { margin-top: 26px; display: grid; gap: 10px; max-width: 460px; list-style: none; padding: 0; }
.auth-points li { display: flex; align-items: center; gap: 10px; font-size: 14px; color: #d4ded9; }
.auth-points svg { width: 18px; height: 18px; color: #f2f2f2; flex-shrink: 0; }
.auth-main { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--card); overflow-y: auto; }
.auth-main .topbar { background: transparent; }
.auth-main > form { width: 100%; max-width: 420px; margin: 0 auto; padding: 24px 24px 48px; flex: none; overflow: visible; }
@media (min-width: 961px) { .auth-main > form { margin: auto; } }
@media (max-width: 960px) { .auth-aside { display: none; } }
`;
