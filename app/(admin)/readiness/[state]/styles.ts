/**
 * Scoped styles for the readiness panel. The `(admin)` layout carries the
 * console's design language (Lumen Edge with the reader legend's level
 * colours, ADM-21); what stays here is what only the readiness grid, zip
 * table and drawer use, written in the same tokens.
 *
 * Density beats decoration (§7): this is an operator instrument, not a reader
 * page. The level tag is plain admin type, NOT the reader's EB Garamond — that
 * register is reserved for quoted public records (ITEM J), and a coverage level
 * is not one.
 *
 * The panel's own element-level control rules sit in the console's
 * `@layer ce-recipe` (see the layout) so that, like every recipe, they can never
 * outrank an unlayered state class; the swatch and grid rules below stay
 * unlayered on purpose.
 */
export const READINESS_STYLES = `
.readiness .rq-controls { display: flex; flex-wrap: wrap; gap: .75rem; align-items: flex-end; margin: .5rem 0 1rem; }
.readiness .rq-controls label { display: flex; flex-direction: column; font-size: .8rem; color: var(--ce-muted); gap: .2rem; margin: 0; }
@layer ce-recipe {
.readiness .rq-controls input, .readiness .rq-controls select { min-width: 12rem; }
/* The control and its option popup are pinned to the theme's own system
   colours and follow the inherited color-scheme explicitly — never native
   <select> inheritance — so the dropdown is legible in dark AND light
   (tests/admin-select-contrast.test.ts). The rim, radius, hover and focus
   ring are the console recipe's own and are not repeated here: a second
   box-shadow declared later in the document used to win the tie against the
   recipe's :focus rule and erase the keyboard focus ring. */
.readiness .rq-controls select {
  color-scheme: inherit;
  background-color: Canvas;
  color: CanvasText;
}
.readiness .rq-controls select option { background-color: Canvas; color: CanvasText; }
/* The zip-table sort headers are text buttons, not recipe buttons: the recipe's
   surface and rim come off, so the recipe's focus glow would too — they carry
   their own outline focus ring. */
.readiness .rq-zip th button { font: inherit; background: none; box-shadow: none; border: none; cursor: pointer; padding: 0; text-decoration: underline dotted; color: var(--ce-muted); text-transform: uppercase; font-size: .78rem; letter-spacing: .04em; }
.readiness .rq-zip th button::before { display: none; }
.readiness .rq-zip th button:hover { transform: none; color: var(--ce-fg); }
.readiness .rq-zip th button:focus-visible { outline: 2px solid var(--ce-lumen); outline-offset: 2px; }
.readiness .deploy-here button { padding: .3rem .7rem; font-size: .8rem; }
}
.readiness .rq-source { font-size: .8rem; color: var(--ce-muted); margin: 0 0 1rem; }

.readiness .rq-grid { width: 100%; border-collapse: collapse; font-size: .85rem; }
.readiness .rq-grid th, .readiness .rq-grid td { padding: .3rem .5rem; border-bottom: 1px solid var(--ce-alpha-hairline); text-align: left; vertical-align: middle; }
.readiness .rq-grid th.rq-gatecol { text-align: center; font-weight: 500; font-size: .74rem; width: 8.5rem; }
.readiness .rq-grid td.rq-gatecell { text-align: center; vertical-align: top; padding-top: .45rem; }
.readiness .rq-grid td.rq-cov { text-align: right; color: var(--ce-muted); max-width: 16rem; }
/* Why a row has no fraction, beside the counts it does hold (ADM-40). */
.readiness .rq-grid td.rq-cov .rq-covsays { font-size: .72rem; opacity: .85; margin-top: .15rem; text-align: right; white-space: normal; }
/* The words under a cell's swatch. The swatch says which state; these say WHICH
   state in language, so "no data" and "live, proof stale" can never read alike
   (§9A.9). The full sentence is on the hover and in the drawer. */
.readiness .rq-grid td.rq-gatecell .rq-cellword { display: block; font-size: .66rem; line-height: 1.15; color: var(--ce-muted); margin-top: .2rem; max-width: 7.5rem; margin-inline: auto; overflow-wrap: anywhere; }
.readiness .rq-domain td { padding-top: 1rem; font-size: .72rem; letter-spacing: .05em; text-transform: uppercase; color: var(--ce-muted); border-bottom: none; }
.readiness .rq-gridwrap { overflow-x: auto; }

.readiness .rq-zip { width: 100%; border-collapse: collapse; font-size: .85rem; }
.readiness .rq-zip th, .readiness .rq-zip td { padding: .45rem .5rem; border-bottom: 1px solid var(--ce-alpha-hairline); text-align: left; vertical-align: top; }
/* .rq-zip th button is in the recipe layer above. */
.readiness .rq-zip tr.rq-pilot { outline: 2px solid #8b7fd6; outline-offset: -2px; }
.readiness .rq-pilot-tag { font-size: .62rem; text-transform: uppercase; letter-spacing: .05em; box-shadow: inset 0 0 0 1px #8b7fd6; border-radius: .25rem; padding: 0 .25rem; margin-left: .35rem; color: var(--ce-muted); }
.readiness .rq-barwrap { display: flex; align-items: center; gap: .5rem; }
.readiness .rq-bar { height: .5rem; border-radius: .25rem; min-width: 2px; }
.readiness .rq-bartrack { flex: 1; background: var(--ce-panel); box-shadow: var(--ce-rim); border-radius: .25rem; overflow: hidden; max-width: 12rem; }
.readiness .rq-pct { font-variant-numeric: tabular-nums; color: var(--ce-muted); min-width: 2.5rem; text-align: right; }
.readiness .rq-worstgap { font-size: .75rem; color: var(--ce-muted); margin-top: .15rem; }
.readiness .rq-next { min-width: 14rem; font-size: .82rem; }
.readiness .rq-next strong { color: var(--ce-fg); }
.readiness .deploy-here { margin: .35rem 0 0; }

.readiness .rq-level { font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; color: var(--ce-muted); white-space: nowrap; }
.readiness .rq-level .lvl-dot { width: .45rem; height: .45rem; }

/* What the Reader is declared to be served (ADM-40). Deliberately a plain list
   and not a card grid: it is read once, top to bottom, against the grid above. */
.readiness .rq-delivery { list-style: none; padding: 0; margin: .5rem 0 1.5rem; display: grid; gap: .5rem; }
.readiness .rq-delivery li { box-shadow: var(--ce-rim); border-radius: var(--ce-radius-md); padding: .5rem .75rem; font-size: .85rem; }
.readiness .rq-delivery .rq-delivery-where { color: var(--ce-muted); }
.readiness .rq-delivery .rq-delivery-src { font-size: .75rem; color: var(--ce-muted); margin-top: .2rem; }

.readiness .rq-violations { box-shadow: inset 0 0 0 1px #cc4b4b; border-radius: var(--ce-radius-md); padding: .5rem .75rem; margin: 1rem 0; }
.readiness .rq-violations h3 { margin: 0 0 .35rem; color: var(--ce-text-bad); }

.readiness .rq-drawer-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; justify-content: flex-end; z-index: 50; }
.readiness .rq-drawer { background: var(--ce-panel); background-image: var(--ce-surface-panel-gradient); color: var(--ce-fg); width: min(38rem, 100%); height: 100%; overflow-y: auto; padding: 1.25rem 1.5rem; box-shadow: var(--ce-rim), -8px 0 24px rgba(0,0,0,.3); }
/* The drawer heading must NOT be positioned: the console's h2 recipe is
   position: relative for its hairline, and a positioned block paints over the
   floated Close button beside it, which made Close unclickable by mouse
   (measured 2026-09-06: the h2 intercepted every click). The hairline is off
   in the drawer anyway, so the heading flows around the float as plain text. */
.readiness .rq-drawer h2 { margin: 0 0 .25rem; font-size: 1.2rem; position: static; padding-top: 0; }
.readiness .rq-drawer h2::before { display: none; }
.readiness .rq-drawer .rq-drawer-meta { font-size: .8rem; color: var(--ce-muted); margin: 0 0 1rem; }
.readiness .rq-rung { border-left: 2px solid var(--ce-alpha-hairline-strong); padding: .35rem 0 .75rem .75rem; margin-left: .3rem; position: relative; }
.readiness .rq-rung .rq-rung-mark { position: absolute; left: -.55rem; top: .35rem; width: .8rem; height: .8rem; border-radius: 50%; background: var(--ce-panel); border: 2px solid var(--ce-alpha-hairline-strong); }
.readiness .rq-rung.rq-found .rq-rung-mark { border-color: #4c9a5a; }
.readiness .rq-rung.rq-empty .rq-rung-mark { border-color: #d99a3a; }
.readiness .rq-rung.rq-none .rq-rung-mark { border-color: var(--ce-muted); background: var(--ce-muted); }
.readiness .rq-rung .rq-rung-when { font-size: .72rem; color: var(--ce-muted); }
.readiness .rq-argument { box-shadow: var(--ce-rim); border-radius: var(--ce-radius-md); padding: .6rem .8rem; margin: 1rem 0; }
.readiness .rq-drawer-close { float: right; }
`;
