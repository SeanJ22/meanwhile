/**
 * Scoped styles for the readiness panel. The `(admin)` surface deliberately holds
 * no design tokens and does not touch the reader's `app/globals.css` — the control
 * centre is not the product. So the six cell-state colours live here, chosen to
 * read on a light or a dark host, and matched to the legend the panel prints.
 *
 * Density beats decoration (§7): this is an operator instrument, not a reader page.
 * The level tag is plain admin type, NOT the reader's EB Garamond — that register
 * is reserved for quoted public records (ITEM J), and a coverage level is not one.
 */
export const READINESS_STYLES = `
.readiness .rq-controls { display: flex; flex-wrap: wrap; gap: .75rem; align-items: flex-end; margin: .5rem 0 1rem; }
.readiness .rq-controls label { display: flex; flex-direction: column; font-size: .8rem; opacity: .8; gap: .2rem; margin: 0; }
.readiness .rq-controls input, .readiness .rq-controls select { font: inherit; padding: .4rem .5rem; min-width: 12rem; }
.readiness .rq-source { font-size: .8rem; opacity: .65; margin: 0 0 1rem; }

.readiness .rq-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: .6rem; margin: .5rem 0 1.5rem; }
.readiness .rq-tile { border: 1px solid rgba(128,128,128,.4); border-radius: .4rem; padding: .6rem .75rem; }
.readiness .rq-tile .rq-figure { font-size: 1.4rem; font-weight: 600; }
.readiness .rq-tile .rq-caption { font-size: .75rem; opacity: .7; margin-top: .15rem; }

.readiness .rq-legend { display: flex; flex-wrap: wrap; gap: .9rem; font-size: .78rem; margin: .5rem 0 1rem; opacity: .9; }
.readiness .rq-legend span { display: inline-flex; align-items: center; gap: .35rem; }

.readiness .rq-cell { display: inline-block; width: 1rem; height: 1rem; border-radius: .25rem; border: 1px solid rgba(128,128,128,.55); vertical-align: middle; }
.readiness button.rq-cell { cursor: pointer; padding: 0; }
.readiness button.rq-cell:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
.readiness .rq-current { background: #4c9a5a; border-color: #3c7a48; }
.readiness .rq-partial { background: #d99a3a; border-color: #b57e26; }
.readiness .rq-notwalked { background: transparent; }
.readiness .rq-argued { background: #e9e7e2; border-color: #b9b6ae; }
.readiness .rq-blocked { background: #cc4b4b; border-color: #a93838; }
.readiness .rq-gated { background: #8b7fd6; border-color: #6f61c4; }
.readiness .rq-violation { box-shadow: 0 0 0 2px #cc4b4b, 0 0 0 3px #fff; }

.readiness .rq-grid { width: 100%; border-collapse: collapse; font-size: .85rem; }
.readiness .rq-grid th, .readiness .rq-grid td { padding: .3rem .5rem; border-bottom: 1px solid rgba(128,128,128,.25); text-align: left; vertical-align: middle; }
.readiness .rq-grid th.rq-gatecol { text-align: center; font-weight: 500; font-size: .78rem; width: 5.5rem; }
.readiness .rq-grid td.rq-gatecell { text-align: center; }
.readiness .rq-grid td.rq-cov { text-align: right; white-space: nowrap; opacity: .9; }
.readiness .rq-domain td { padding-top: 1rem; font-size: .72rem; letter-spacing: .05em; text-transform: uppercase; opacity: .55; border-bottom: none; }
.readiness .rq-gridwrap { overflow-x: auto; }

.readiness .rq-zip { width: 100%; border-collapse: collapse; font-size: .85rem; }
.readiness .rq-zip th, .readiness .rq-zip td { padding: .4rem .5rem; border-bottom: 1px solid rgba(128,128,128,.25); text-align: left; vertical-align: top; }
.readiness .rq-zip th button { font: inherit; background: none; border: none; cursor: pointer; padding: 0; text-decoration: underline dotted; }
.readiness .rq-zip tr.rq-pilot { outline: 2px solid #8b7fd6; outline-offset: -2px; }
.readiness .rq-pilot-tag { font-size: .62rem; text-transform: uppercase; letter-spacing: .05em; border: 1px solid #8b7fd6; border-radius: .25rem; padding: 0 .25rem; margin-left: .35rem; opacity: .85; }
.readiness .rq-barwrap { display: flex; align-items: center; gap: .5rem; }
.readiness .rq-bar { height: .5rem; border-radius: .25rem; min-width: 2px; }
.readiness .rq-bartrack { flex: 1; background: rgba(128,128,128,.2); border-radius: .25rem; overflow: hidden; max-width: 12rem; }
.readiness .rq-pct { font-variant-numeric: tabular-nums; opacity: .85; min-width: 2.5rem; text-align: right; }
.readiness .rq-worstgap { font-size: .75rem; opacity: .65; margin-top: .15rem; }

.readiness .rq-level { font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; opacity: .8; }

.readiness .rq-violations { border: 1px solid #cc4b4b; border-radius: .4rem; padding: .5rem .75rem; margin: 1rem 0; }
.readiness .rq-violations h3 { margin: 0 0 .35rem; color: #cc4b4b; }

.readiness .rq-drawer-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; justify-content: flex-end; z-index: 50; }
.readiness .rq-drawer { background: Canvas; color: CanvasText; width: min(38rem, 100%); height: 100%; overflow-y: auto; padding: 1.25rem 1.5rem; box-shadow: -8px 0 24px rgba(0,0,0,.3); }
.readiness .rq-drawer h2 { margin: 0 0 .25rem; font-size: 1.2rem; }
.readiness .rq-drawer .rq-drawer-meta { font-size: .8rem; opacity: .7; margin: 0 0 1rem; }
.readiness .rq-rung { border-left: 2px solid rgba(128,128,128,.4); padding: .35rem 0 .75rem .75rem; margin-left: .3rem; position: relative; }
.readiness .rq-rung .rq-rung-mark { position: absolute; left: -.55rem; top: .35rem; width: .8rem; height: .8rem; border-radius: 50%; background: Canvas; border: 2px solid rgba(128,128,128,.6); }
.readiness .rq-rung.rq-found .rq-rung-mark { border-color: #4c9a5a; }
.readiness .rq-rung.rq-empty .rq-rung-mark { border-color: #d99a3a; }
.readiness .rq-rung.rq-none .rq-rung-mark { border-color: #999; background: #999; }
.readiness .rq-rung .rq-rung-when { font-size: .72rem; opacity: .6; }
.readiness .rq-argument { border: 1px solid rgba(128,128,128,.4); border-radius: .4rem; padding: .6rem .8rem; margin: 1rem 0; }
.readiness .rq-drawer-close { float: right; font: inherit; cursor: pointer; background: none; border: 1px solid currentColor; border-radius: .3rem; padding: .25rem .6rem; }
`;
