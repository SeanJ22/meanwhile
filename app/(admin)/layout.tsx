/**
 * Every generic rule lives in `@layer ce-recipe`, which ranks below every unlayered rule whatever its
 * specificity, so a state or semantic class declared outside the layer is never outranked by a recipe.
 * A control rule outside the layer may not declare a background or a box-shadow.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Control centre",
  robots: { index: false, follow: false, nocache: true },
};

const STYLES = `
/* ============================================================ tokens */
.admin, .console-nav {
  /* ADMIN PARITY (design handoff 2026-09-13). The control-centre now speaks the
     READER's shared visual language. The whole --ce-* recipe below is unchanged;
     only these token VALUES are re-pointed at the shared tokens in
     app/globals.css, so every admin surface inherits the reader's material,
     palette, interactive accent, hairlines, motion, radii and tier accents
     WITHOUT a component rewrite (layouts, functionality and structure preserved).
     Supersedes the standalone Lumen Edge palette (ADM-21) per the newer
     ADMIN-PARITY directive. The bridged tokens auto-theme through the shared
     tokens, so the light block below only restates the admin-LOCAL per-theme
     literals: the health-grade legend (--ce-text-*) and the chart bar tone
     (--ce-slate-rise) — a grade scale and a bar colour are operational tooling,
     never the reader's tier/party/funding vocabulary. */
  /* Each token is var(--shared, <original literal>): production renders under the
     root layout's globals.css, so the shared token wins → parity; an isolated
     render without globals.css (e.g. tests/admin-readiness-cell-state) falls back
     to the admin's original self-contained value, so the surface still works. */
  --ce-void: var(--bg, #1b1c22);
  --ce-graphite: var(--panel, #0b151e);
  --ce-panel: var(--panel-bg, #20222a);
  --ce-panel-raised: var(--surface, #262932);
  --ce-slate-rise: #47515c;
  --ce-hairline: var(--panel-border, #2f3441);
  --ce-fg: var(--text, #ffffff);
  --ce-muted: var(--text-dim, #a8aebb);
  /* The one interactive accent, shared with the reader (was a bespoke slate). */
  --ce-lumen: var(--link, #cfd8e6);
  --ce-alpha-hairline: var(--lumen-rim, rgba(255,255,255,.10));
  --ce-alpha-hairline-strong: var(--lumen-rim-strong, rgba(255,255,255,.16));
  /* Button rest ink → the shared secondary; hover lifts to --ce-fg (--text). */
  --ce-fg-66: var(--text-dim, rgba(255,255,255,.72));
  /* Grade colours AS TEXT — the owner's health legend, an operational grade
     scale, never a reader tier/party/funding colour. Kept, both themes. */
  --ce-text-ok: #74c986;
  --ce-text-warn: #d99a3a;
  --ce-text-bad: #ef8a8a;
  /* The Lumen material, expressed through the bridged surface tokens (so it
     inherits their fallbacks): cards lit from --ce-panel, controls from the
     lighter --ce-panel-raised so a button still reads apart from its card. */
  --ce-surface-gradient: radial-gradient(ellipse 130% 100% at 50% 100%, color-mix(in srgb, var(--ce-panel-raised) 88%, white) 0%, var(--ce-panel-raised) 66%);
  --ce-surface-gradient-soft: radial-gradient(ellipse 130% 100% at 50% 100%, color-mix(in srgb, var(--ce-panel-raised) 94%, white) 0%, var(--ce-panel-raised) 66%);
  --ce-surface-panel-gradient: radial-gradient(ellipse 120% 100% at 50% 100%, color-mix(in srgb, var(--ce-panel) 88%, white) 0%, var(--ce-panel) 66%);
  --ce-horizon: linear-gradient(90deg, rgba(255,255,255,0) 0%, #ffffff 50%, rgba(255,255,255,0) 100%);
  --ce-horizon-lumen: linear-gradient(90deg, rgba(255,255,255,0) 0%, var(--ce-lumen) 50%, rgba(255,255,255,0) 100%);
  --ce-rim: inset 0 0 0 1px var(--ce-alpha-hairline);
  --ce-rim-strong: inset 0 0 0 1px var(--ce-alpha-hairline-strong);
  --ce-shadow-card: 0 1px 1px rgba(0,0,0,.4), 0 12px 32px -12px rgba(0,0,0,.6);
  --ce-shadow-raised: 0 2px 4px rgba(0,0,0,.5), 0 24px 48px -16px rgba(0,0,0,.7);
  --ce-focus: 0 0 0 1px var(--ce-lumen), 0 0 16px color-mix(in srgb, var(--ce-lumen) 38%, transparent);
  --ce-motion-slow: 1s cubic-bezier(.15,.83,.66,1);
  --ce-motion-medium: 420ms cubic-bezier(.15,.83,.66,1);
  --ce-motion-fast: 200ms cubic-bezier(.15,.83,.66,1);
  --ce-radius-md: var(--radius-sm, 7px);
  --ce-radius-lg: var(--radius, 14px);
  /* Level colours ARE the reader's tier accents — one source (app/globals.css),
     with the map legend's own values as the self-contained fallback. */
  --lvl-local: var(--accent-local, #ffb000);
  --lvl-state: var(--accent-state, #00b894);
  --lvl-school: var(--accent-school, #e84393);
  --lvl-federal: var(--accent-national, #6c8fd4);
}
[data-theme="light"] .admin, [data-theme="light"] .console-nav {
  /* Light: the bridged tokens auto-theme through the shared tokens; the fallback
     is the admin's original light literal, and only the tokens whose light value
     does NOT derive from a bridged token (the horizon line, the softer shadows,
     the health legend) are restated here. */
  --ce-void: var(--bg, #eef0f3);
  --ce-graphite: var(--panel, #d3d9e1);
  --ce-panel: var(--panel-bg, #ffffff);
  --ce-panel-raised: var(--surface, #f7f8fa);
  --ce-slate-rise: #c6ced8;
  --ce-hairline: var(--panel-border, #d5d9e0);
  --ce-fg: var(--text, #101318);
  --ce-muted: var(--text-dim, #4d5666);
  --ce-lumen: var(--link, #3d5f9e);
  --ce-alpha-hairline: var(--lumen-rim, rgba(0,0,0,.08));
  --ce-alpha-hairline-strong: var(--lumen-rim-strong, rgba(0,0,0,.14));
  --ce-fg-66: var(--text-dim, rgba(16,19,24,.72));
  --ce-horizon: linear-gradient(90deg, rgba(0,0,0,0) 0%, #2b3340 50%, rgba(0,0,0,0) 100%);
  --ce-shadow-card: 0 1px 1px rgba(0,0,0,.2), 0 12px 32px -12px rgba(0,0,0,.3);
  --ce-shadow-raised: 0 2px 4px rgba(0,0,0,.25), 0 24px 48px -16px rgba(0,0,0,.35);
  --ce-text-ok: #176f36;
  --ce-text-warn: #7f5400;
  --ce-text-bad: #b3261e;
  --lvl-local: var(--accent-local, #b8860b);
  --lvl-state: var(--accent-state, #00896e);
  --lvl-school: var(--accent-school, #c2185b);
  --lvl-federal: var(--accent-national, #3d5f9e);
}
/* The viewport is the reader's own ground in production (parity), the admin's
   own void when globals.css is absent. */
body:has(main.admin) { background: var(--bg, #1b1c22); }
[data-theme="light"] body:has(main.admin) { background: var(--bg, #eef0f3); }

/* ============================================================ the recipe layer
   Generic rules only: elements under .admin, the card, the button, the field,
   the select. Unlayered rules below beat everything in here regardless of
   specificity — that is the whole point (see the header). A control rule that
   declares a background or box-shadow belongs in here or nowhere. */
@layer ce-recipe {
.admin { max-width: 60rem; margin: 0 auto; padding: 1.5rem 1.25rem 6rem; line-height: 1.5; color: var(--ce-fg); background: var(--ce-void); }
.admin h1 { font-size: 1.7rem; margin: 0 0 .25rem; letter-spacing: -.02em; line-height: 1.15; }
.admin h2 { font-size: 1.25rem; margin: 2.5rem 0 .6rem; padding-top: .9rem; letter-spacing: -.01em; position: relative; border: 0; }
.admin h2::before { content: ""; position: absolute; top: 0; left: 0; width: 100%; height: 1px; background: var(--ce-hairline); }
.admin h3 { font-size: 1rem; margin: 1.25rem 0 .35rem; }
.admin p { color: var(--ce-fg); }
.admin a { color: var(--ce-lumen); text-decoration-color: var(--ce-alpha-hairline-strong); }
.admin table { width: 100%; border-collapse: collapse; margin: .5rem 0 1rem; font-size: .9rem; }
.admin th, .admin td { text-align: left; padding: .4rem .55rem; border-bottom: 1px solid var(--ce-alpha-hairline); vertical-align: top; }
.admin th { color: var(--ce-muted); font-weight: 500; font-size: .78rem; letter-spacing: .04em; text-transform: uppercase; }
.admin tbody th { color: var(--ce-fg); font-weight: 600; font-size: inherit; letter-spacing: 0; text-transform: none; }
.admin td.n, .admin th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.admin pre { overflow-x: auto; padding: .75rem; background: var(--ce-panel); box-shadow: var(--ce-rim); border-radius: var(--ce-radius-md); font-size: .85rem; }
.admin code { font-size: .86em; overflow-wrap: anywhere; }
.admin details summary { cursor: pointer; color: var(--ce-muted); font-size: .85rem; }
.admin hr { border: 0; height: 1px; background: var(--ce-hairline); margin: 2rem 0 1rem; }
.admin form { margin-top: .5rem; }
.admin label { display: block; margin: .5rem 0; }

/* ---- the card recipe (signal 1 + 2 + 3 + 4) ---- */
.admin .card {
  position: relative;
  background-color: var(--ce-panel);
  background-image: var(--ce-surface-panel-gradient);
  border: 0;
  border-radius: var(--ce-radius-lg);
  box-shadow: var(--ce-rim), var(--ce-shadow-card);
  padding: .9rem 1.1rem;
  isolation: isolate;
  overflow: hidden;
  transition: box-shadow var(--ce-motion-slow), transform var(--ce-motion-slow);
}
.admin .card::after {
  content: ""; position: absolute; bottom: 0; left: 15%; width: 70%; height: 1px;
  background: var(--ce-horizon); opacity: .18; pointer-events: none;
  transition: opacity var(--ce-motion-slow);
}
.admin .card:hover { box-shadow: var(--ce-rim-strong), var(--ce-shadow-card); }
.admin .card:hover::after { opacity: .45; }
.admin .card:focus-within::after { opacity: .85; background: var(--ce-horizon-lumen); }
/* ---- the button recipe ---- */
.admin button, .console-nav button {
  position: relative; display: inline-flex; align-items: center; justify-content: center; gap: .4rem;
  padding: .5rem .9rem; border: 0; border-radius: var(--ce-radius-md);
  background: var(--ce-surface-gradient); box-shadow: var(--ce-rim);
  color: var(--ce-fg-66); font: inherit; font-weight: 500; line-height: 1.2; cursor: pointer; user-select: none; isolation: isolate;
  transition: color var(--ce-motion-slow), transform var(--ce-motion-slow), box-shadow var(--ce-motion-slow);
}
.admin button::before, .console-nav button::before {
  content: ""; position: absolute; bottom: 0; left: 15%; width: 70%; height: 1px;
  background: var(--ce-horizon); opacity: .2; transition: opacity var(--ce-motion-slow); pointer-events: none;
}
.admin button:hover, .console-nav button:hover { color: var(--ce-fg); transform: scale(1.04) translateY(-3px); box-shadow: var(--ce-rim-strong); }
.admin button:hover::before, .console-nav button:hover::before { opacity: 1; }
.admin button:focus-visible, .console-nav button:focus-visible { outline: none; box-shadow: var(--ce-rim-strong), var(--ce-focus); }
.admin button:focus-visible::before { opacity: 1; }
.admin button:active { transform: translateY(-1px) scale(1.01); transition-duration: 240ms; }
.admin button[disabled] { opacity: .45; cursor: not-allowed; transform: none; }
.admin button.primary { color: var(--ce-fg); font-weight: 600; }
/* The recipe at other sizes: a decision option, and the queue button a gap carries. */
.admin .queue-card .options button.option { display: flex; flex-direction: column; align-items: flex-start; width: 100%; text-align: left; margin: .3rem 0; padding: .5rem .7rem; background: var(--ce-panel); color: var(--ce-fg); }
.admin .queue-card .options button.option:hover { background: var(--ce-panel-raised); }
.admin button.queue-add { margin: 0 0 0 .5rem; vertical-align: baseline; }
.admin button.queue-add.compact { padding: .1rem .5rem; font-size: .72rem; min-width: 0; color: var(--ce-muted); background: var(--ce-panel); }
.admin button.queue-add.compact:hover { color: var(--ce-fg); transform: translateY(-1px); }
.admin button.copy { padding: .1rem .5rem; font-size: .72rem; min-width: 0; color: var(--ce-muted); background: var(--ce-panel); vertical-align: baseline; margin-left: .35rem; }

/* ---- fields and selects ---- */
.admin textarea, .admin input[type="text"], .admin input[type="password"] {
  font: inherit; color: var(--ce-fg); background: var(--ce-panel); border: 0; border-radius: var(--ce-radius-md);
  box-shadow: var(--ce-rim); padding: .5rem .65rem; color-scheme: inherit;
  transition: box-shadow var(--ce-motion-medium), background var(--ce-motion-medium);
}
/* A native <select> renders its closed field AND its option popup in the UA's
   default (light) chrome even on a dark page unless the control is pinned to
   the theme's own system colours and follows the inherited color-scheme
   explicitly (tests/admin-select-contrast.test.ts). The rim is Lumen's; the
   surface is the system canvas, which tracks dark and light. */
.admin select, .console-nav select {
  font: inherit; color-scheme: inherit; background-color: Canvas; color: CanvasText; border: 0; border-radius: var(--ce-radius-md);
  box-shadow: var(--ce-rim); padding: .5rem .65rem;
  transition: box-shadow var(--ce-motion-medium);
}
.admin select option, .console-nav select option { background-color: Canvas; color: CanvasText; }
.admin textarea:hover, .admin input:hover, .admin select:hover, .console-nav select:hover { box-shadow: var(--ce-rim-strong); }
.admin textarea:focus, .admin input:focus, .admin select:focus, .console-nav select:focus { outline: none; box-shadow: var(--ce-rim-strong), var(--ce-focus); }
.admin textarea:focus, .admin input:focus { background: var(--ce-panel-raised); }
.admin input[type="password"] { width: 100%; max-width: 28rem; }
/* The console header's own controls: the label is a caption, the select is the recipe one size down. */
.console-nav label { display: flex; flex-direction: column; gap: .2rem; margin: 0; font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; color: var(--ce-muted); }
.console-nav select { font-size: .95rem; text-transform: none; letter-spacing: normal; padding: .35rem .5rem; min-width: 11rem; }
}

/* ============================================================ semantic text (unlayered: meaning a recipe may never override) */
.admin .note { color: var(--ce-muted); font-size: .85rem; margin: .25rem 0; }
.admin small.note { display: inline; }
.admin .denom { color: var(--ce-muted); font-weight: 400; }
.admin .gap { font-style: italic; color: var(--ce-muted); }
.admin .gap-whose { text-transform: uppercase; font-size: .68rem; letter-spacing: .06em; color: var(--ce-muted); font-style: normal; }
/* ---- MAP PROVIDER (MAPQ-6): the bill, and the row that must be visible when it is not zero. ---- */
.admin .mt-panel .mt-what { color: var(--ce-muted); font-size: .85rem; margin: .1rem 0 .4rem; }
.admin .mt-panel .mt-status { margin: .2rem 0 .8rem; }
.admin .mt-panel h3 { font-size: .78rem; text-transform: uppercase; letter-spacing: .05em; color: var(--ce-muted); margin: 1rem 0 .2rem; font-weight: 500; }
.admin .mt-panel .mt-tiles { margin-bottom: 1rem; }
.admin .mt-panel table th[scope="row"] { color: var(--ce-fg); text-transform: none; letter-spacing: 0; font-size: .85rem; font-weight: 500; }
.admin .mt-panel .mt-next { font-size: .85rem; margin: .25rem 0; }
.admin .mt-panel .mt-blocked { font-size: .85rem; color: var(--ce-muted); margin-top: 1rem; }
/* An undeclared key with traffic is the finding, so it is not a subtle row. */
.admin .mt-panel tr.mt-unexpected th, .admin .mt-panel tr.mt-unexpected td { box-shadow: inset 3px 0 0 0 #b3261e; }
.admin .mt-panel tr.mt-unexpected td.n { color: var(--ce-text-bad); font-weight: 600; }
.admin .mt-panel .mt-flag { display: block; font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: var(--ce-text-bad); font-weight: 500; }
.admin .refusal { padding: .75rem 1rem; box-shadow: inset 0 0 0 2px #b3261e, var(--ce-shadow-card); border-radius: var(--ce-radius-md); background: var(--ce-panel); }
.admin .state-green { color: var(--ce-text-ok); font-weight: 600; }
.admin .state-red { color: var(--ce-text-bad); font-weight: 600; }
.admin .state-amber { color: var(--ce-text-warn); font-weight: 600; }
.admin .state-unknown { color: var(--ce-muted); font-weight: 600; }

/* OPERATIONAL BADGES (ADMIN-PARITY §3, design handoff 2026-09-13). An operational
   state carries its meaning by SHAPE (filled / outline / dashed) in a neutral ink,
   or by the two existing status tokens — never by a tier, party or funding colour,
   because every one of those already means something a reader learned from the map.
   Each state keeps its OWN label/type (data-op), so a blocked job can never read as
   a jurisdiction result. Same shape grammar the JurisdictionBadge uses. */
.admin .op-badge {
  display: inline-flex; align-items: center; gap: .3rem;
  padding: .12rem .5rem; border-radius: var(--ce-radius-md);
  font-size: .66rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
  font-family: inherit; white-space: nowrap; border: 1px solid transparent;
}
/* fresh / confirmed → FILLED in the foreground ink (the GOVERNS move). */
.admin .op-badge[data-op="fresh"] { background: var(--ce-fg); border-color: var(--ce-fg); color: var(--ce-void); }
/* stale / awaiting → 1px OUTLINE, dimmer ink. */
.admin .op-badge[data-op="stale"] { border-color: var(--ce-hairline); color: var(--ce-muted); }
/* unpublished / blocked / device-local → the same outline, DASHED. */
.admin .op-badge[data-op="blocked"] { border-style: dashed; border-color: var(--ce-hairline); color: var(--ce-muted); }
/* exporting / active → the awaiting OUTLINE shape, set apart from stale by a
   full-WEIGHT foreground ink (ADMIN-PARITY §4: a shape/weight/mono numeral, never
   a new hue). It does not repurpose the interactive accent (--ce-lumen/--link) or
   any semantic colour. */
.admin .op-badge[data-op="exporting"] { border-color: var(--ce-hairline); color: var(--ce-fg); font-weight: 700; }
/* the two allowed status tokens: did not happen, and finished. */
.admin .op-badge[data-op="did-not-happen"] { border-color: color-mix(in srgb, var(--canceled, #e17055) 60%, transparent); color: var(--canceled, #e17055); }
.admin .op-badge[data-op="finished"] { border-color: color-mix(in srgb, var(--concluded, #6fa8a5) 60%, transparent); color: var(--concluded, #6fa8a5); }
.admin .plain { font-size: 1.05rem; margin: .35rem 0 .75rem; }
.admin .free { color: var(--ce-muted); font-variant-numeric: tabular-nums; }
.admin .when { font-variant-numeric: tabular-nums; }
.admin details.ph-evidence { margin: .5rem 0 1rem; }
.admin details.raw-ids { margin-top: .2rem; }
.admin details.raw-ids summary { font-size: .72rem; letter-spacing: .04em; text-transform: uppercase; }
.admin .outcome { text-transform: capitalize; }
.admin .outcome-completed { color: var(--ce-text-ok); }
.admin .outcome-aborted, .admin .outcome-failed { color: var(--ce-text-bad); }
.admin .outcome-running { color: var(--ce-lumen); }
/* Wide tables scroll inside their own box; the page never scrolls sideways (measured at 390px, Admin Pass A). */
.admin .scroll-x { overflow-x: auto; max-width: 100%; }
/* THE ADMIN COLOUR HOOK: a level-carrying card's horizon takes the level's hue. */
.admin .card.lvl-local::after { background: linear-gradient(90deg, transparent 0%, var(--lvl-local) 50%, transparent 100%); opacity: .85; }
.admin .card.lvl-state::after { background: linear-gradient(90deg, transparent 0%, var(--lvl-state) 50%, transparent 100%); opacity: .85; }
.admin .card.lvl-school::after { background: linear-gradient(90deg, transparent 0%, var(--lvl-school) 50%, transparent 100%); opacity: .85; }
.admin .card.lvl-federal::after { background: linear-gradient(90deg, transparent 0%, var(--lvl-federal) 50%, transparent 100%); opacity: .85; }
/* ADMIN PARITY (2026-09-13): a card ABOUT a level of government wears the
   reader's TIER RING — a 1px inset at 62% + a 1px halo at 22% — not only a
   tinted horizon. Same treatment as the reader's popup/battlecard tier ring;
   the colour is the level's own, set by the .lvl-* class, never at the call
   site. Health-grade and runner-standing cards (.ph-l-*, .l-*) are NOT levels
   and keep their own horizon, no ring. */
.admin .card.lvl-local { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--lvl-local) 62%, transparent), 0 0 0 1px color-mix(in srgb, var(--lvl-local) 22%, transparent), var(--ce-shadow-card); }
.admin .card.lvl-state { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--lvl-state) 62%, transparent), 0 0 0 1px color-mix(in srgb, var(--lvl-state) 22%, transparent), var(--ce-shadow-card); }
.admin .card.lvl-school { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--lvl-school) 62%, transparent), 0 0 0 1px color-mix(in srgb, var(--lvl-school) 22%, transparent), var(--ce-shadow-card); }
.admin .card.lvl-federal { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--lvl-federal) 62%, transparent), 0 0 0 1px color-mix(in srgb, var(--lvl-federal) 22%, transparent), var(--ce-shadow-card); }

/* ============================================================ pilot health */
.admin .ph-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: .75rem; margin: .5rem 0 1.25rem; }
.admin .ph-card h3 { display: flex; justify-content: space-between; align-items: baseline; gap: .5rem; margin: 0 0 .25rem; font-size: .95rem; }
.admin .ph-chip { font-size: .68rem; text-transform: uppercase; letter-spacing: .04em; padding: 0 .35rem; border-radius: .25rem; box-shadow: inset 0 0 0 1px currentColor; white-space: nowrap; }
.admin .ph-num { font-size: 1.25rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.admin .ph-meta { font-size: .72rem; color: var(--ce-muted); margin: .1rem 0 0; }
.admin .ph-reason { font-size: .82rem; margin: .35rem 0 0; }
.admin .ph-next { font-size: .8rem; margin: .35rem 0 0; }
/* Health grades keep their scale colours (ADM-3), as a lit band at the base, not a border. */
.admin .ph-l-GREEN::after { background: linear-gradient(90deg, transparent, #4c9a5a, transparent); opacity: .9; }
.admin .ph-l-AMBER::after { background: linear-gradient(90deg, transparent, #d99a3a, transparent); opacity: .9; }
.admin .ph-l-RED::after { background: linear-gradient(90deg, transparent, #cc4b4b, transparent); opacity: .9; }
.admin .ph-l-GREEN .ph-chip { color: var(--ce-text-ok); } .admin .ph-l-AMBER .ph-chip { color: var(--ce-text-warn); } .admin .ph-l-RED .ph-chip { color: var(--ce-text-bad); } .admin .ph-l-UNKNOWN .ph-chip { color: var(--ce-muted); }

/* ---- The one visual language both console views share: tiles, legend, swatches. ---- */
.admin .rq-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: .6rem; margin: .5rem 0 1.5rem; }
.admin .rq-tile { background: var(--ce-panel); background-image: var(--ce-surface-gradient-soft); box-shadow: var(--ce-rim); border-radius: var(--ce-radius-md); padding: .6rem .75rem; position: relative; isolation: isolate; overflow: hidden; }
.admin .rq-tile::after { content: ""; position: absolute; bottom: 0; left: 15%; width: 70%; height: 1px; background: var(--ce-horizon); opacity: .14; pointer-events: none; }
.admin .rq-tile .rq-figure { font-size: 1.4rem; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.admin .rq-tile .rq-caption { font-size: .75rem; color: var(--ce-muted); margin-top: .15rem; }
.admin .rq-legend { display: flex; flex-wrap: wrap; gap: .9rem; font-size: .78rem; margin: .5rem 0 1rem; color: var(--ce-muted); }
.admin .rq-legend span { display: inline-flex; align-items: center; gap: .35rem; }
.admin .rq-cell { display: inline-block; width: 1rem; height: 1rem; border-radius: .25rem; box-shadow: inset 0 0 0 1px var(--ce-alpha-hairline-strong); vertical-align: middle; }
.admin .rq-current { background: #4c9a5a; }
.admin .rq-partial { background: #d99a3a; }
.admin .rq-notwalked { background: transparent; }
.admin .rq-argued { background: repeating-linear-gradient(45deg, rgba(128,128,128,.55) 0 2px, transparent 2px 5px); }
.admin .rq-blocked { background: #cc4b4b; }
.admin .rq-gated { background: #8b7fd6; }
.admin .rq-violation { box-shadow: 0 0 0 2px #cc4b4b, 0 0 0 3px var(--ce-void); }
/* A readiness cell is a swatch first and a button second. The swatch, its state
   and its violation ring own background and box-shadow (unlayered, above); the
   button loses only its padding and gains keyboard affordances. Never declare a
   background or a box-shadow here: the reset that did was the #281 regression,
   and tests/admin-readiness-cell-state.test.ts refuses it. The focus ring is an
   outline, drawn outside the box, so it can never paint over the state. */
.admin button.rq-cell { padding: 0; }
.admin button.rq-cell::before { display: none; }
.admin button.rq-cell:hover { transform: scale(1.15); }
.admin button.rq-cell:active { transform: scale(1.05); }
.admin button.rq-cell:focus-visible { outline: 2px solid var(--ce-lumen); outline-offset: 2px; }
.admin .hl-GREEN { background: #4c9a5a; } .admin .hl-AMBER { background: #d99a3a; } .admin .hl-RED { background: #cc4b4b; } .admin .hl-UNKNOWN { background: transparent; }
.admin .band { display: inline-flex; align-items: center; gap: .35rem; font-size: .95rem; }
.admin h1 .band { font-size: 1.1rem; vertical-align: middle; }
.admin .rq-legend.scale { margin-top: .25rem; }
.admin .rq-unpublished { box-shadow: inset 0 0 0 2px #d99a3a; border-radius: var(--ce-radius-md); padding: .6rem .8rem; margin: .25rem 0 1rem; font-size: .9rem; background: rgba(217,154,58,.12); }
/* The level legend and dots: hue on the dot and the pill, never on the surface. */
.admin .level-legend { margin-top: -.25rem; }
.admin .lvl-swatch { border-radius: 50%; width: .7rem; height: .7rem; }
.admin .lvl-local .lvl-swatch, .admin .lvl-local .lvl-dot { background: var(--lvl-local); }
.admin .lvl-state .lvl-swatch, .admin .lvl-state .lvl-dot { background: var(--lvl-state); }
.admin .lvl-school .lvl-swatch, .admin .lvl-school .lvl-dot { background: var(--lvl-school); }
.admin .lvl-federal .lvl-swatch, .admin .lvl-federal .lvl-dot { background: var(--lvl-federal); }
.admin .lvl-dot { display: inline-block; width: .5rem; height: .5rem; border-radius: 50%; margin-right: .35rem; vertical-align: middle; box-shadow: 0 0 6px currentColor; }
.admin .name { display: inline; }
.admin .name-unrecognised { font-style: italic; }

/* ---- Pilot Health as the fleet view (ADM-7), coloured by level (ADM-21). ---- */
.admin .fleet { display: grid; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); gap: .8rem; margin: .5rem 0 1rem; }
.admin .fleet-card h3 { margin: 0 0 .2rem; font-size: 1.05rem; }
.admin .fleet-card .fleet-what, .admin .role-section .fleet-what { font-size: .85rem; color: var(--ce-muted); margin: 0 0 .5rem; }
.admin .fleet-card .fleet-doing, .admin .role-doing { font-size: .9rem; margin: .25rem 0 .5rem; }
.admin .role-lead { font-size: .95rem; margin: .35rem 0; }
.admin .fleet-nums { display: grid; grid-template-columns: repeat(3, 1fr); gap: .4rem; margin: .4rem 0; }
.admin .fleet-nums .rq-tile { padding: .4rem .5rem; }
.admin .fleet-nums .rq-figure { font-size: 1.15rem; }
.admin .fleet-where { font-size: .8rem; margin: .35rem 0; display: flex; flex-wrap: wrap; gap: .3rem .35rem; align-items: center; }
.admin .where-wrap { display: inline-flex; align-items: center; gap: .3rem; }
.admin .where-count { font-size: .75rem; color: var(--ce-muted); font-variant-numeric: tabular-nums; }
.admin .where, .admin .chip {
  display: inline-flex; align-items: center; gap: .3rem; padding: .1rem .55rem; border-radius: 999px;
  background: var(--ce-panel); box-shadow: var(--ce-rim); color: var(--ce-muted); font-size: .76rem; letter-spacing: .01em;
  position: relative; isolation: isolate; white-space: nowrap; max-width: 100%;
}
.admin .where.lvl-local { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--lvl-local) 60%, transparent); color: var(--ce-fg); }
.admin .where.lvl-state { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--lvl-state) 60%, transparent); color: var(--ce-fg); }
.admin .where.lvl-school { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--lvl-school) 60%, transparent); color: var(--ce-fg); }
.admin .where.lvl-federal { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--lvl-federal) 60%, transparent); color: var(--ce-fg); }
.admin .where .lvl-dot { margin-right: 0; width: .45rem; height: .45rem; }
.admin .fleet-latest { font-size: .78rem; color: var(--ce-muted); margin: .35rem 0 0; padding-left: 1rem; }
.admin .fleet-latest .name { color: var(--ce-fg); }
.admin .fleet-roles { font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: var(--ce-muted); font-weight: 400; }
.admin .deploy {
  position: relative; border-radius: var(--ce-radius-lg); padding: .9rem 1.1rem; margin: .75rem 0 1rem;
  background: var(--ce-surface-gradient); box-shadow: var(--ce-rim), var(--ce-shadow-raised); isolation: isolate; overflow: hidden;
}
.admin .deploy::before { content: ""; position: absolute; bottom: 0; left: 15%; width: 70%; height: 1px; background: var(--ce-horizon-lumen); opacity: .9; pointer-events: none; }
/* The raised surface is brightest at its base, where the note sits: muted text measured 3.63:1 there (Admin Pass A); the note reads in the foreground colour instead. */
.admin .deploy .note { color: var(--ce-fg); opacity: .85; }
.admin .deploy textarea { width: 100%; max-width: 40rem; min-height: 4.5rem; display: block; margin-top: .3rem; }
.admin .deploy .actions { display: flex; gap: .5rem; align-items: center; margin-top: .5rem; }
.admin .deploy label { font-size: .9rem; margin: 0; }
.admin .deployments li { margin: .25rem 0; font-size: .9rem; }

/* ---- Runner standing (ADM-5). ---- */
.admin .runner-card { margin: .5rem 0 1rem; }
.admin .runner-card.l-GREEN::after { background: linear-gradient(90deg, transparent, #4c9a5a, transparent); opacity: .9; }
.admin .runner-card.l-AMBER::after { background: linear-gradient(90deg, transparent, #d99a3a, transparent); opacity: .9; }
.admin .runner-card.l-RED::after { background: linear-gradient(90deg, transparent, #cc4b4b, transparent); opacity: .9; }
.admin .runner-card form { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-top: .5rem; }
.admin .runner-card input[type="text"] { min-width: 18rem; }
.admin .runner-card button { width: auto; display: inline-flex; margin: 0; }

/* ---- The decision queue (ADM-4), the receipt (ADM-16) and the fix queue (ADM-20). ---- */
.admin .queue-card { margin: .7rem 0; }
.admin .queue-card .queue-head, .admin .fix-queue .queue-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem; margin: 0 0 .2rem; }
.admin .queue-card .queue-head h3, .admin .fix-queue .queue-head h3 { margin: 0; font-size: 1rem; }
.admin .queue-card .queue-id { font-family: var(--font-jetbrains-mono), ui-monospace, monospace; font-size: .8rem; color: var(--ce-muted); }
.admin .queue-card .queue-meta { font-size: .78rem; color: var(--ce-muted); margin: 0 0 .45rem; }
.admin .chip { text-transform: uppercase; font-size: .66rem; letter-spacing: .05em; }
.admin .chip.receipt-done { color: var(--ce-text-ok); }
.admin .chip.receipt-waiting { color: var(--ce-lumen); }
.admin .chip.receipt-refused { color: var(--ce-text-bad); }
.admin .queue-card p { margin: .3rem 0; }
.admin .queue-card .options form { margin: .35rem 0 0; }
/* button.option itself is the button recipe at another size — declared in the recipe layer. */
.admin .queue-card .options button .consequence { display: block; font-size: .8rem; color: var(--ce-muted); font-weight: 400; }
.admin .queue-card .own-words label { font-size: .85rem; color: var(--ce-muted); margin: .5rem 0 0; }
.admin .queue-card .own-words textarea { display: block; margin-top: .3rem; width: 100%; max-width: 40rem; min-height: 3.5rem; }
.admin .queue-card .own-words button { width: auto; display: inline-flex; margin: .35rem 0 0; }
.admin .queue-card.acknowledge { opacity: .92; }
.admin .queue-card.blocked { background-image: none; box-shadow: inset 0 0 0 1px var(--ce-alpha-hairline-strong); }
.admin .queue-card details summary { font-size: .82rem; }
.admin .receipt { list-style: none; margin: .5rem 0 0; padding: 0; display: grid; gap: .35rem; }
.admin .receipt-step { display: flex; gap: .55rem; align-items: flex-start; font-size: .9rem; }
.admin .receipt-mark { flex: 0 0 auto; width: .8rem; height: .8rem; border-radius: 50%; margin-top: .3rem; box-shadow: inset 0 0 0 1px var(--ce-alpha-hairline-strong); background: transparent; transition: background var(--ce-motion-slow), box-shadow var(--ce-motion-slow); }
.admin .step-done .receipt-mark, .admin .fix-opened .receipt-mark { background: var(--ce-lumen); box-shadow: 0 0 10px color-mix(in srgb, var(--ce-lumen) 60%, transparent); }
.admin .step-waiting .receipt-mark, .admin .fix-queued .receipt-mark, .admin .fix-sent .receipt-mark { background: transparent; }
.admin .fix-sent .receipt-mark { box-shadow: inset 0 0 0 1px var(--ce-lumen); }
.admin .step-refused .receipt-mark, .admin .fix-refused .receipt-mark { background: #cc4b4b; }
.admin .decided-card::after { background: var(--ce-horizon-lumen); opacity: .55; }
.admin .fix-queue { margin: 1rem 0; }
.admin .fix-items { list-style: none; margin: .5rem 0; padding: 0; display: grid; gap: .4rem; }
.admin .fix-item { display: flex; gap: .55rem; align-items: flex-start; font-size: .9rem; }
.admin .fix-item small { display: block; color: var(--ce-muted); font-size: .78rem; }
.admin .go-fix { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem; margin-top: .6rem; }
/* button.queue-add is the recipe one size down — declared in the recipe layer; only its placement is here. */
.admin .rq-caption button.queue-add { display: inline-flex; margin: .3rem 0 0; }

/* ---- Cost (ADM-6/17): a table of numbers, gaps as one short line, charts beside. ---- */
.admin table.cost td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.admin table.cost .gap { font-size: .85rem; }
.admin .cost-summary { margin: .25rem 0 .5rem; }
.admin tr.cost-free-by-design td { color: var(--ce-muted); }

/* ---- Charts (ADM-11/13/17): lit bars, hue only by level. ---- */
.admin .chart { margin: .6rem 0 1rem; }
.admin .chart figcaption { font-size: .78rem; color: var(--ce-muted); letter-spacing: .03em; text-transform: uppercase; margin-bottom: .35rem; }
.admin .chart-row { display: flex; flex-wrap: wrap; gap: 1rem 2rem; align-items: flex-start; }
.admin .chart-row .chart { flex: 1 1 18rem; margin: .5rem 0; }
.admin .chart ul, .admin .chart ol { list-style: none; margin: 0; padding: 0; display: grid; gap: .3rem; }
.admin .bars li, .admin .funnel li { display: grid; grid-template-columns: minmax(7rem, 12rem) 1fr auto; align-items: center; gap: .6rem; font-size: .85rem; }
.admin .bar-label small, .admin .funnel-label small { display: block; color: var(--ce-muted); font-size: .72rem; }
.admin .bar-track, .admin .funnel-track, .admin .stack-track { display: block; height: .55rem; border-radius: 999px; background: var(--ce-panel); box-shadow: var(--ce-rim); overflow: hidden; position: relative; }
.admin .bar-fill, .admin .funnel-fill { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--ce-slate-rise), var(--ce-lumen)); transition: width var(--ce-motion-slow); }
.admin .lvl-local .bar-fill { background: linear-gradient(90deg, color-mix(in srgb, var(--lvl-local) 45%, var(--ce-slate-rise)), var(--lvl-local)); }
.admin .lvl-state .bar-fill { background: linear-gradient(90deg, color-mix(in srgb, var(--lvl-state) 45%, var(--ce-slate-rise)), var(--lvl-state)); }
.admin .lvl-school .bar-fill { background: linear-gradient(90deg, color-mix(in srgb, var(--lvl-school) 45%, var(--ce-slate-rise)), var(--lvl-school)); }
.admin .lvl-federal .bar-fill { background: linear-gradient(90deg, color-mix(in srgb, var(--lvl-federal) 45%, var(--ce-slate-rise)), var(--lvl-federal)); }
.admin .bar-value, .admin .funnel-value { font-variant-numeric: tabular-nums; white-space: nowrap; font-size: .85rem; }
.admin .funnel li { grid-template-columns: minmax(7rem, 11rem) 1fr auto; }
.admin .funnel-track { text-align: center; }
.admin .funnel-fill { margin: 0 auto; }
.admin .stack-track { display: flex; height: .8rem; }
.admin .stack-part { display: block; height: 100%; background: var(--ce-slate-rise); }
.admin .stack-part + .stack-part { box-shadow: -1px 0 0 var(--ce-void); }
/* The part colours belong to the BAR SEGMENT only. Unscoped, .part-* also
   matched the legend's li.part-* and painted every legend item as a solid
   coloured box with muted text on it — 1.09:1 to 3.6:1 (Admin Pass A). */
.admin .stack-part.part-model { background: var(--ce-lumen); }
.admin .stack-part.part-deterministic { background: var(--ce-slate-rise); }
.admin .stack-part.part-promoted { background: #4c9a5a; }
.admin .stack-part.part-would { background: var(--ce-lumen); }
.admin .stack-part.part-refused { background: var(--ce-slate-rise); }
.admin .stack-part.part-deferred { background: #d99a3a; }
.admin .stack-legend { display: flex; flex-wrap: wrap; gap: .3rem 1rem; font-size: .8rem; margin-top: .35rem; color: var(--ce-muted); }
.admin .stack-legend li { display: inline-flex; align-items: center; gap: .35rem; }
.admin .swatch { width: .6rem; height: .6rem; border-radius: 2px; background: var(--ce-slate-rise); display: inline-block; }
.admin .part-model .swatch, .admin .part-would .swatch { background: var(--ce-lumen); }
.admin .part-promoted .swatch { background: #4c9a5a; }
.admin .part-deferred .swatch { background: #d99a3a; }
.admin .ring { display: inline-flex; flex-direction: column; align-items: center; gap: .25rem; flex: 0 0 auto; }
.admin .ring-track { fill: none; stroke: var(--ce-panel); stroke-width: 6; }
.admin .ring-fill { fill: none; stroke: var(--ce-lumen); stroke-width: 6; stroke-linecap: round; transition: stroke-dasharray var(--ce-motion-slow); }
.admin .ring-text { fill: var(--ce-fg); font-size: 12px; font-weight: 600; }
.admin .ring figcaption { text-transform: none; letter-spacing: 0; text-align: center; max-width: 9rem; }
.admin .daybar { fill: var(--ce-lumen); opacity: .8; }
.admin .daybar-text { fill: var(--ce-muted); font-size: 9px; }
.admin .daybars svg { max-width: 100%; height: auto; }

/* ---- Research detail (ADM-10/11/13). ---- */
.admin .role-section { margin: .8rem 0; }
.admin .role-section h3 { margin: 0 0 .2rem; font-size: 1.05rem; }
.admin .metric-group { margin: .8rem 0; }
.admin .metric-group h3 { margin: 0 0 .2rem; }
.admin table.metrics td { font-size: .88rem; }
.admin .glossary { display: grid; gap: .3rem; margin: .4rem 0; font-size: .82rem; }
.admin .glossary dt { color: var(--ce-muted); }
.admin .glossary dd { margin: 0; }
.admin .findings { margin: .3rem 0 0; padding-left: 1rem; font-size: .82rem; }
.admin .stage-strip { list-style: none; display: flex; flex-wrap: wrap; gap: .5rem; margin: .5rem 0; padding: 0; }
.admin .stage { display: inline-flex; align-items: center; gap: .4rem; padding: .25rem .7rem; border-radius: 999px; background: var(--ce-panel); box-shadow: var(--ce-rim); font-size: .82rem; }
.admin .stage-mark { width: .55rem; height: .55rem; border-radius: 50%; box-shadow: inset 0 0 0 1px var(--ce-alpha-hairline-strong); }
.admin .stage-ok .stage-mark { background: #4c9a5a; box-shadow: 0 0 8px rgba(76,154,90,.6); }
.admin .stage-failed .stage-mark { background: #cc4b4b; }
.admin table.window-classes { max-width: 40rem; }
.admin .controls-row { display: flex; flex-wrap: wrap; gap: .6rem; }
.admin .controls-row form { margin: 0; }
.admin .worker-fleet-metric summary { font-size: .85rem; color: var(--ce-fg); }

/* ---- Software release review (Admin Pass B). ---- */
/* A status word is one unbreakable token (VISUAL_WORK_IN_PROGRESS measured 386px at a 390px viewport); it may break anywhere rather than push the page sideways. */
.admin .rr-status { overflow-wrap: anywhere; display: inline; }
.admin .rr-identity { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(20rem, 100%), 1fr)); gap: .8rem; margin: .5rem 0 .75rem; }
/*
 * THE FOUR PLAIN ANSWERS AT THE TOP OF THE RELEASE REVIEW (ACLOSE-6).
 * A definition list, because that is what it is: a question and its answer.
 */
.admin .rr-plain { display: grid; grid-template-columns: minmax(9rem, max-content) 1fr; gap: .35rem 1rem; margin: .75rem 0; }
.admin .rr-plain dt { font-size: .78rem; letter-spacing: .04em; text-transform: uppercase; color: var(--ce-muted); }
.admin .rr-plain dd { margin: 0; }
@media (max-width: 34rem) { .admin .rr-plain { grid-template-columns: 1fr; } .admin .rr-plain dd { margin-bottom: .4rem; } }
.admin details.rr-build-identity { margin: .75rem 0; }
.admin details.rr-build-identity > summary { cursor: pointer; font-size: .78rem; letter-spacing: .04em; text-transform: uppercase; color: var(--ce-muted); }
.admin .rr-sha { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: .3rem; }
.admin .rr-sha code { overflow-wrap: anywhere; }
.admin .rr-sections { display: grid; gap: .8rem; margin: .5rem 0 1rem; }
.admin .rr-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem; }
.admin .rr-head h3 { margin: 0; }
.admin .rr-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin-top: .5rem; }
.admin .rr-decide textarea { width: 100%; max-width: 40rem; min-height: 3rem; display: block; margin-top: .3rem; }
.admin .rr-decide label { font-size: .85rem; color: var(--ce-muted); margin: .5rem 0 0; }
.admin .rr-conditions { list-style: none; margin: .5rem 0; padding: 0; display: grid; gap: .3rem; font-size: .9rem; }
.admin .rr-ok { color: var(--ce-text-ok); }
.admin .rr-fail { color: var(--ce-text-bad); }
.admin .rr-history { font-size: .85rem; }
.admin .chip.rr-approve { color: var(--ce-text-ok); }
.admin .chip.rr-needs { color: var(--ce-text-warn); }
.admin .chip.rr-discard { color: var(--ce-text-bad); }

/* ============================================================ the console header */
.console-nav {
  position: sticky; top: 0; z-index: 20; display: flex; flex-wrap: wrap; align-items: flex-end; gap: 1rem;
  margin: 0 auto 1.25rem; max-width: 72rem; padding: .75rem 1.25rem; background: var(--ce-void); color: var(--ce-fg);
  box-shadow: 0 1px 0 var(--ce-hairline);
}
/*
 * ANYTHING A FRAGMENT LINK LANDS ON CLEARS THE STICKY HEADER.
 * (9.6.26 owner feedback, ACLOSE-6.)
 *
 * .console-nav above is position:sticky top:0, and this repository had no
 * scroll-margin-top anywhere — so every in-page anchor scrolled its target to
 * y=0 and the header then sat on top of it. The one live fragment on the
 * console (#runner) landed underneath the navigation for exactly this reason,
 * and the two dead ones would have done the same once they existed.
 *
 * The value is the header's own height: .75rem padding, top and bottom, around
 * a control row, plus the gap the heading needs to read as a heading.
 */
.admin .reveal-target, .admin [id]:target { scroll-margin-top: 5.5rem; }
.admin .reveal-target { outline: none; }
/* The keyboard user is told where they landed; the mouse user is not shouted at. */
.admin .reveal-target:focus-visible { outline: 2px solid var(--ce-lumen); outline-offset: .5rem; border-radius: .25rem; }
/* .console-nav label and select are in the recipe layer with the other controls. */
.console-nav-brand { margin-left: auto; align-self: center; display: inline-flex; align-items: center; gap: .5rem; }
/* The surface-context caption beside the Logo lockup (design handoff 2026-09-13). */
.console-nav-context { font-size: .75rem; color: var(--ce-muted); }
.console-nav .icon-btn { align-self: center; }
.console-nav-pending { align-self: center; font-size: .8rem; color: var(--ce-lumen); }
.console-nav[aria-busy="true"] select { opacity: .7; }
.readiness, .admin.console-page { max-width: 72rem; }


/* ============================================================ Admin C — the four-layer status shape (§9A.2) */
.admin .status-block { display: grid; gap: .35rem; }
.admin .status-what { font-weight: 600; margin: 0; }
.admin .status-happened, .admin .status-next { margin: 0; color: var(--ce-fg-66); }
.admin .status-detail { margin-top: .6rem; font-size: .85rem; }
.admin .status-detail > summary { color: var(--ce-muted); cursor: pointer; }
.admin .needs-you { margin: .35rem 0 0; font-size: .9rem; }
.admin .needs-no { color: var(--ce-text-ok); }
.admin .needs-yes { color: var(--ce-text-warn); }
.admin .plain-code { border-bottom: 1px dotted var(--ce-hairline); }
.admin .plain-means { color: var(--ce-fg-66); }
.admin .gap-inline { color: var(--ce-muted); font-style: italic; }
.admin .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* the defined tile: a number, its label, what it MEANS, and whether it needs you (ADM-28) */
.admin .defined-tile .rq-caption { display: grid; gap: .25rem; }
.admin .tile-label { color: var(--ce-fg); font-weight: 600; }
.admin .tile-means { color: var(--ce-fg-66); font-size: .82rem; line-height: 1.35; }
.admin .tile-needs { font-size: .78rem; letter-spacing: .02em; }
.admin .tile-needs.needs-no { color: var(--ce-text-ok); }
.admin .tile-needs.needs-yes { color: var(--ce-text-warn); }
.admin .tile-gap { color: var(--ce-muted); font-size: .82rem; }

/* bars: how much is done, waiting and blocked, in one glance (§9A.15) */
.admin .sbar { display: inline-flex; align-items: center; gap: .5rem; min-width: 6rem; }
.admin .sbar-track { position: relative; display: inline-block; flex: 1 1 auto; height: .45rem; border-radius: 999px; background: var(--ce-hairline); overflow: hidden; }
.admin .sbar-fill, .admin .sbar-seg { display: block; height: 100%; float: left; }
.admin .sbar-ok .sbar-fill, .admin .seg-ok { background: var(--ce-text-ok); }
.admin .sbar-warn .sbar-fill, .admin .seg-warn { background: var(--ce-text-warn); }
.admin .sbar-bad .sbar-fill, .admin .seg-bad { background: var(--ce-text-bad); }
.admin .sbar-info .sbar-fill, .admin .seg-info { background: var(--ce-lumen); }
.admin .sbar-none .sbar-fill, .admin .seg-none { background: var(--ce-muted); }
.admin .sbar-label { font-size: .78rem; color: var(--ce-muted); white-space: nowrap; }

/* ============================================================ Admin C — the live-update strip (ADM-34) */
.console-strip { max-width: 72rem; margin: 0 auto .75rem; padding: 0 1.25rem; display: flex; justify-content: flex-end; }
.live-refresh { display: inline-flex; align-items: center; gap: .5rem; font-size: .8rem; color: var(--ce-muted); }
.live-dot { width: .5rem; height: .5rem; border-radius: 999px; display: inline-block; }
.live-dot-ok { background: var(--ce-text-ok); }
.live-dot-bad { background: var(--ce-text-bad); }
.live-stopped .live-words { color: var(--ce-text-bad); }
.live-now { font: inherit; color: var(--ce-lumen); background: none; border: 0; padding: .1rem .35rem; cursor: pointer; text-decoration: underline; }
.live-now[disabled] { opacity: .6; cursor: default; }

/* ============================================================ Admin C — the runner card in four lines (ADM-24) */
.admin .runner-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: .6rem; margin: 0 0 .4rem; }
.admin .runner-what { color: var(--ce-fg-66); font-size: .9rem; }
.admin .runner-when { margin: .2rem 0; }
.admin .runner-did { margin: .2rem 0; font-weight: 600; }
.admin .runner-stopped { margin: .2rem 0; }
.admin .runner-circuits { margin: .5rem 0 .2rem; color: var(--ce-fg-66); font-size: .9rem; }
.admin .runner-deferred { font-size: .85rem; }
.admin .runner-deferred > summary { cursor: pointer; }
.admin .runner-control { margin-top: .75rem; display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
.admin .spend-table { width: 100%; border-collapse: collapse; margin: .75rem 0; font-size: .88rem; }
.admin .spend-table caption { text-align: left; color: var(--ce-muted); font-size: .8rem; padding-bottom: .3rem; }
.admin .spend-table th, .admin .spend-table td { text-align: left; padding: .3rem .5rem .3rem 0; border-bottom: 1px solid var(--ce-hairline); vertical-align: top; }
.admin .spend-table thead th { color: var(--ce-muted); font-weight: 500; font-size: .78rem; }
.admin .spend-table tbody th { font-weight: 600; }
.admin .spend-means { display: block; font-weight: 400; color: var(--ce-fg-66); font-size: .78rem; }
.admin .spend-figure { font-variant-numeric: tabular-nums; white-space: nowrap; }
.admin .spend-bar-col { width: 8rem; }

/* ============================================================ Admin C — incidents as groups (ADM-30) */
.admin .incident-group { border-left: 2px solid var(--ce-hairline); padding-left: .75rem; margin: .6rem 0; }
.admin .incident-group > summary { cursor: pointer; display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem; }
.admin .ig-needs-you { border-left-color: var(--ce-text-warn); }
.admin .ig-will-retry { border-left-color: var(--ce-text-ok); }
.admin .ig-waiting { border-left-color: var(--ce-lumen); }
.admin .ig-not-reached { border-left-color: var(--ce-muted); }
.admin .ig-count { font-variant-numeric: tabular-nums; color: var(--ce-fg); font-weight: 600; }
.admin .ig-says { color: var(--ce-fg-66); font-size: .85rem; }
.admin .incident-list { list-style: none; margin: .4rem 0; padding: 0; display: grid; gap: .3rem; font-size: .88rem; }
.admin .incident-says { color: var(--ce-fg-66); }

/* ============================================================ Admin C — pilot health cards (ADM-37) */
.admin .ph-overall { font-size: 1.05rem; margin: .5rem 0 1rem; }
.admin .ph-head { display: flex; align-items: baseline; justify-content: space-between; gap: .75rem; }
.admin .ph-head h2 { margin: 0; font-size: 1rem; letter-spacing: .06em; }
.admin .ph-what { color: var(--ce-fg-66); font-size: .85rem; margin: .35rem 0; }
.admin .ph-status { margin: .35rem 0; }
.admin .ph-next { margin: .35rem 0; }
.admin .ph-control { margin: .5rem 0; display: grid; gap: .3rem; }
.admin .ph-age { color: var(--ce-muted); font-size: .8rem; margin: .35rem 0 0; }
.admin .ph-published { margin-top: .75rem; }

/* ============================================================ Admin C — the decision queue (ADM-31, ADM-32) */
.admin .dq { margin: 1.5rem 0; }
.admin .dq-header { display: flex; flex-wrap: wrap; align-items: baseline; gap: .6rem; width: 100%; text-align: left; font: inherit; color: inherit; background: none; border: 0; padding: .4rem 0; cursor: pointer; }
.admin .dq-header h2 { margin: 0; }
.admin .dq-caret { color: var(--ce-muted); }
.admin .dq-count { font-variant-numeric: tabular-nums; color: var(--ce-lumen); font-weight: 700; }
.admin .dq-summary { color: var(--ce-fg-66); font-size: .85rem; }
.admin .dq-just { list-style: none; margin: .5rem 0; padding: 0; display: grid; gap: .4rem; }
.admin .dq-just-row { display: flex; align-items: flex-start; gap: .5rem; padding: .5rem .6rem; border-radius: .4rem; background: var(--ce-panel-raised); }
.admin .dq-just-text { display: grid; gap: .2rem; flex: 1 1 auto; }
.admin .dq-next { color: var(--ce-fg-66); font-size: .85rem; }
.admin .dq-detail { color: var(--ce-muted); font-size: .8rem; }
.admin .dq-mark { width: .55rem; height: .55rem; border-radius: 999px; margin-top: .35rem; background: var(--ce-text-ok); flex: 0 0 auto; }
.admin .dq-saving .dq-mark { background: var(--ce-lumen); }
.admin .dq-failed .dq-mark { background: var(--ce-text-bad); }
.admin .dq-undone .dq-mark { background: var(--ce-text-warn); }
.admin .dq-undo { font: inherit; font-size: .8rem; color: var(--ce-lumen); background: none; border: 0; cursor: pointer; text-decoration: underline; }
.admin .dq-priority { margin: 1rem 0 0; }
.admin .dq-priority > h3 { margin: .5rem 0 .25rem; }
.admin .dq-type { margin: .5rem 0 .5rem 1rem; }
.admin .dq-type > h4 { margin: .35rem 0; font-size: .9rem; display: flex; flex-wrap: wrap; gap: .5rem; align-items: baseline; }
.admin .dq-type-means { font-weight: 400; color: var(--ce-fg-66); font-size: .8rem; }
.admin .dq-cards { list-style: none; margin: 0; padding: 0; display: grid; gap: .25rem; }
.admin .dq-card { border-bottom: 1px solid var(--ce-hairline); }
.admin .dq-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: .6rem; width: 100%; text-align: left; font: inherit; color: inherit; background: none; border: 0; padding: .45rem 0; cursor: pointer; }
.admin .dq-rowid { font-size: .75rem; letter-spacing: .06em; color: var(--ce-muted); min-width: 3.5rem; }
.admin .dq-card-title { flex: 1 1 16rem; }
.admin .dq-meta { font-size: .78rem; color: var(--ce-muted); }
.admin .dq-body { padding: .35rem 0 .75rem 4.1rem; display: grid; gap: .5rem; }
.admin .dq-options { display: grid; gap: .4rem; }
.admin .dq-card-open { background: var(--ce-panel-raised); }

/* the decided list and its lifecycle chips (§9A.18) */
.admin .decided > details > summary { cursor: pointer; display: flex; flex-wrap: wrap; align-items: baseline; gap: .6rem; }
.admin .decided > details > summary h2 { margin: 0; display: inline; }
.admin .decided-says { margin: .35rem 0; }
.admin .decided-next { margin: .35rem 0; color: var(--ce-fg-66); }
.admin .chip.stage-decided { color: var(--ce-text-warn); }
.admin .chip.stage-queued { color: var(--ce-lumen); }
.admin .chip.stage-implemented, .admin .chip.stage-on_main, .admin .chip.stage-live, .admin .chip.stage-verified { color: var(--ce-text-ok); }

/* ============================================================ Admin C — misc */
.admin .fleet-does { display: block; font-weight: 400; font-size: .82rem; color: var(--ce-fg-66); margin-top: .2rem; }
.admin .fleet-nums { display: flex; flex-wrap: wrap; gap: 1rem; margin: .4rem 0; font-size: .85rem; }
.admin .fleet-says { margin: .35rem 0; color: var(--ce-fg-66); font-size: .88rem; }
.admin .zip-rows { list-style: none; margin: .5rem 0; padding: 0; display: grid; gap: .3rem; font-size: .9rem; }
.admin pre.digest { white-space: pre-wrap; word-break: break-word; font-size: .78rem; color: var(--ce-fg-66); max-height: 28rem; overflow: auto; }
.admin .audit-footer { font-size: .78rem; }

/* ---- Two-clock strip (§3): labels the two time sources on the fleet page. ---- */
.admin .two-clock { display: flex; flex-wrap: wrap; align-items: baseline; gap: .2rem .5rem; font-size: .82rem; color: var(--ce-muted); margin: .1rem 0 .35rem; }
.admin .two-clock code { color: var(--ce-fg); }
.admin .two-clock-gap { padding: .1rem .5rem; border-radius: .25rem; background: color-mix(in srgb, var(--ce-text-warn) 15%, transparent); color: var(--ce-text-warn); font-weight: 500; }

/* ============================================================ Fleet triage rework (BUILD.md §0–§G) */
.admin.fleet-console { --ft-mono: var(--font-app-mono, ui-monospace, monospace); }
.admin .fleet-header { display: grid; gap: .5rem; margin: 0 0 1rem; }
.admin .fleet-header h1 { font-size: 1.6rem; letter-spacing: -.02em; margin: 0; }
.admin .fleet-read-clock { display: grid; gap: .2rem; }
.admin .frc-line { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin: 0; font-size: .95rem; }
.admin .frc-dot { width: 8px; height: 8px; border-radius: 999px; border: 1.5px dashed #6fa8a5; }
.admin .frc-age { font-family: var(--ft-mono); color: var(--ce-fg); }
.admin .frc-again { font-size: .8rem; padding: .25rem .7rem; }
.admin .frc-note { margin: 0; font-size: .82rem; color: var(--ce-muted); max-width: 70ch; }

.admin .fleet-bands { display: grid; gap: 6px; margin: 0 0 1rem; }
.admin .fleet-band { --band: var(--ce-muted); display: grid; grid-template-columns: 14px 1fr auto; gap: .75rem; align-items: center; padding: .7rem .9rem; border-radius: 10px; background: var(--ce-panel); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--band) 40%, transparent); color: inherit; text-decoration: none; }
.admin .fleet-band:hover { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--band, #888) 78%, transparent); }
.admin .fleet-band-chip { width: 14px; height: 14px; border-radius: 3px; background: var(--band, #888); }
.admin .fleet-band-chip-dashed { background: transparent; border: 1.5px dashed var(--band, #6fa8a5); }
.admin .fleet-band-body { display: grid; grid-template-columns: auto 1fr; gap: .1rem .6rem; align-items: baseline; }
.admin .fleet-band-count { grid-row: span 2; font-family: var(--ft-mono); font-size: 1.2rem; color: var(--band); align-self: center; }
.admin .fleet-band-label { font-size: .95rem; }
.admin .fleet-band-reason { grid-column: 2; font-size: .82rem; color: var(--ce-muted); }
.admin .fleet-band-go { font-family: var(--ft-mono); font-size: .8rem; color: var(--ce-muted); }

.admin .fleet-tabs { display: flex; flex-wrap: wrap; gap: .3rem; border-bottom: 1px solid var(--ce-hairline); margin: 0 0 1.25rem; }
.admin .fleet-tab-link { display: inline-flex; align-items: center; gap: .4rem; padding: .5rem .8rem; border-radius: 7px 7px 0 0; color: var(--ce-muted); text-decoration: none; font-size: .9rem; }
.admin .fleet-tab-link:hover { color: var(--ce-fg); }
.admin .fleet-tab-active { color: var(--ce-fg); background: var(--ce-panel); box-shadow: inset 0 1px 0 var(--ce-hairline), inset 1px 0 0 var(--ce-hairline), inset -1px 0 0 var(--ce-hairline); }
.admin .fleet-tab-badge { font-family: var(--ft-mono); font-size: .72rem; padding: .05rem .35rem; border-radius: 999px; background: var(--ce-panel-raised); color: var(--ce-muted); }

.admin .fleet-tab { display: grid; gap: 1rem; }
.admin .fleet-tab-head { display: flex; gap: 1rem; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
.admin .fleet-tab h2 { font-size: 1.15rem; margin: 0 0 .2rem; }
.admin .ft-accent { color: var(--ce-muted); font-weight: 500; }
.admin .ft-toggle { font-size: .8rem; }
.admin .ft-mono { font-family: var(--ft-mono); overflow-wrap: anywhere; }

.admin .ft-group-header { display: grid; grid-template-columns: 11px auto 1fr; gap: .5rem; align-items: center; margin: .5rem 0 .1rem; }
.admin .ft-chip { width: 11px; height: 11px; border-radius: 3px; background: #4c9a5a; }
.admin .ft-chip-dashed { background: transparent; border: 1.5px dashed #6fa8a5; }
.admin .ft-group-label { font-family: var(--ft-mono); font-size: .78rem; text-transform: uppercase; letter-spacing: .05em; color: var(--ce-muted); }
.admin .ft-rule { height: 1px; background: var(--ce-hairline); }

.admin .ft-lede { font-size: .95rem; color: var(--ce-fg); margin: 0; }
.admin .ft-red-cards { display: grid; gap: .75rem; }
.admin .ft-finding { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 1.25rem; padding: 1rem; border-radius: 14px; background: var(--ce-panel); box-shadow: var(--ce-shadow-card); }
.admin .ft-finding-red { box-shadow: inset 0 0 0 1px rgba(204,75,75,.45), 0 0 0 1px rgba(204,75,75,.16), var(--ce-shadow-card); }
.admin .ft-finding-main { display: grid; gap: .5rem; align-content: start; }
.admin .ft-badge-row { display: flex; flex-wrap: wrap; gap: .5rem; align-items: baseline; }
.admin .ft-kind-badge { font-family: var(--ft-mono); font-size: .68rem; text-transform: uppercase; letter-spacing: .06em; padding: .15rem .45rem; border-radius: 4px; background: color-mix(in srgb, #cc4b4b 18%, transparent); color: #ff8a8a; }
.admin .ft-verdict { font-size: 1.05rem; font-weight: 600; margin: 0; }
.admin .ft-explain { max-width: 74ch; }
.admin .ft-arith dl { display: grid; gap: .1rem; margin: .3rem 0 0; }
.admin .ft-arith dl > div { display: grid; grid-template-columns: 1fr auto; gap: .75rem; padding: .3rem .5rem; background: rgba(11,21,30,.55); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }
.admin .ft-arith dt { color: var(--ce-muted); font-size: .82rem; }
.admin .ft-arith dd { margin: 0; font-family: var(--ft-mono); font-size: .82rem; }
.admin .ft-arith-inference { border-top: 1px solid var(--ce-hairline); }
.admin .ft-arith-inference dd { font-family: inherit; }
.admin .ft-action-stack { display: grid; gap: .25rem; align-content: start; min-width: 190px; }
.admin .ft-action-disabled { cursor: not-allowed; opacity: .5; }
.admin .ft-action-caption { font-family: var(--ft-mono); font-size: .72rem; color: var(--ce-muted); }

.admin .ft-ledger-head { font-size: 1rem; margin: .5rem 0 0; }
.admin .ft-ledger-grid, .admin .ft-panels-grid { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.admin .ft-panel-card { display: grid; gap: .4rem; align-content: start; padding: .8rem .9rem; border-radius: 12px; background: var(--ce-panel); box-shadow: var(--ce-shadow-card); }
.admin .ft-panel-card-dashed { background: transparent; box-shadow: none; border: 1.5px dashed #6fa8a5; }
.admin .ft-panel-head { display: flex; gap: .5rem; align-items: baseline; justify-content: space-between; }
.admin .ft-status { font-family: var(--ft-mono); font-size: .72rem; }
.admin .ft-status-wired { color: #6fcf8f; }
.admin .ft-status-partial { color: #eec779; }
.admin .ft-inline-link { font-size: .82rem; color: #4fc9e8; }
.admin .ft-no-producer-lede { max-width: 76ch; }
.admin .ft-panel-caveat { border-top: 1px solid var(--ce-hairline); padding-top: .4rem; }
.admin .ft-panels-footer { font-family: var(--ft-mono); font-size: .74rem; }
.admin .ft-spend { display: grid; gap: .25rem; margin: 0; }
.admin .ft-spend > div { display: grid; grid-template-columns: 1fr auto; gap: .5rem; }
.admin .ft-spend dt { color: var(--ce-muted); font-size: .85rem; }
.admin .ft-spend dd { margin: 0; font-family: var(--ft-mono); }
.admin .ft-warn { color: #d99a3a; }

.admin .ft-summary-grid { display: grid; gap: .6rem; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.admin .ft-summary-card { display: grid; gap: .2rem; padding: .7rem .8rem; border-radius: 12px; background: transparent; box-shadow: inset 0 0 0 1px var(--ce-hairline); }
.admin .ft-summary-count { font-family: var(--ft-mono); font-size: 1.1rem; }
.admin .ft-worked { display: grid; gap: .3rem; padding: .8rem .9rem; border-radius: 12px; background: var(--ce-panel); box-shadow: var(--ce-rim); }
.admin .ft-worked h3 { margin: 0; font-size: 1rem; }
.admin .ft-correction { padding: .7rem .9rem; border-radius: 10px; border: 1.5px dashed #6fa8a5; }

.admin .ft-exceptions { display: grid; gap: .75rem; }
.admin .ft-exceptions .ft-finding { grid-template-columns: minmax(0,1fr); }
.admin .ft-fieldrows { display: grid; gap: .2rem; margin: 0; }
.admin .ft-fieldrows > div { display: grid; grid-template-columns: 130px 1fr; gap: .5rem; }
.admin .ft-fieldrows dt { font-family: var(--ft-mono); font-size: .74rem; text-transform: uppercase; color: var(--ce-muted); }
.admin .ft-fieldrows dd { margin: 0; }
.admin .ft-subhead { font-size: 1rem; margin: 0 0 .3rem; }
.admin .ft-shape { display: grid; gap: .4rem; }
.admin .ft-shape-row { display: grid; grid-template-columns: 1fr auto auto; gap: .75rem; align-items: center; padding: .5rem .7rem; border-radius: 10px; box-shadow: inset 0 0 0 1px var(--ce-hairline); }
.admin .ft-shape-name { display: grid; gap: .1rem; }
.admin .ft-nocount { font-family: var(--ft-mono); font-size: .75rem; padding: .1rem .5rem; border-radius: 999px; border: 1px dashed rgba(111,168,165,.5); color: var(--ce-muted); }
.admin .ft-shape-foot { max-width: 78ch; }
.admin .ft-samples { margin: .3rem 0 0; padding-left: 1rem; }

.admin .ft-blindspots { display: grid; gap: .5rem; }
.admin .ft-blindspot { display: grid; gap: .35rem; padding: .8rem .9rem; border-radius: 11px; background: var(--ce-panel); box-shadow: inset 0 0 0 1px var(--ce-hairline); }
.admin .ft-blindspot-red { box-shadow: inset 0 0 0 1px rgba(204,75,75,.4); }
.admin .ft-blindspot-amber { box-shadow: inset 0 0 0 1px rgba(217,154,58,.4); }
.admin .ft-blindspot-dashed { box-shadow: none; border: 1.5px dashed #6fa8a5; }
.admin .ft-blindspot-head { display: flex; gap: .5rem; align-items: baseline; justify-content: space-between; }
.admin .ft-blindspot-title { font-size: .95rem; font-weight: 600; }
.admin .ft-copy { font-size: .78rem; }
.admin .ft-copy-result { color: #6fcf8f; }
.admin .ft-blindspot-summary { max-width: 78ch; }
.admin .ft-blindspot-paths { font-family: var(--ft-mono); font-size: .72rem; color: var(--ce-muted); overflow-wrap: anywhere; margin: 0; }
.admin .ft-blindspot-order { max-width: 80ch; margin-top: .5rem; }

@media (max-width: 640px) {
  .admin .ft-finding { grid-template-columns: minmax(0,1fr); }
  .admin .ft-action-stack { min-width: 0; }
}

/* ============================================================ Admin C — the command centre strip (ADM-C1) */
.admin .cc { margin: 0 0 1.5rem; }
.admin .cc-next { margin: .25rem 0 .75rem; padding: .6rem .8rem; border-radius: .4rem; background: var(--ce-panel-raised); box-shadow: var(--ce-rim); }
.admin .cc-next-yes { border-left: 3px solid var(--ce-text-warn); }
.admin .cc-next-no { border-left: 3px solid var(--ce-text-ok); }
.admin .cc-cards { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
.admin .cc-card { display: grid; gap: .25rem; padding: .6rem .7rem; border-radius: .4rem; background: var(--ce-panel); box-shadow: var(--ce-rim); }
.admin .cc-needs { box-shadow: var(--ce-rim-strong); }
.admin .cc-q { font-size: .78rem; color: var(--ce-muted); }
.admin .cc-a { font-size: .95rem; font-weight: 600; }
.admin .cc-gap { font-size: .8rem; color: var(--ce-fg-66); }
.admin .cc-foot { display: flex; align-items: center; justify-content: space-between; gap: .5rem; font-size: .75rem; }


/* ============================================================ Admin C — the shipping and integration view (ADM-C2) */
.admin .st-identity-grid { display: grid; gap: .5rem; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); margin: .5rem 0 1rem; }
.admin .st-identity-cell { display: grid; gap: .2rem; padding: .55rem .65rem; border-radius: .4rem; background: var(--ce-panel); box-shadow: var(--ce-rim); }
.admin .st-identity-label { font-size: .72rem; letter-spacing: .04em; text-transform: uppercase; color: var(--ce-muted); }
.admin .st-identity-means { font-size: .78rem; color: var(--ce-fg-66); }
.admin code.st-commit, .admin .st-commit { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .82rem; white-space: nowrap; padding: .05rem .3rem; border-radius: .2rem; background: var(--ce-panel-raised); }
.admin .st-check { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .78rem; white-space: nowrap; padding: .05rem .3rem; border-radius: .2rem; background: var(--ce-panel-raised); margin-inline-end: .35rem; }
.admin .st-candidate { margin: .75rem 0; }
.admin .st-candidate-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem; }
.admin .st-candidate-head h3 { margin: 0; }
.admin .st-position { font-variant-numeric: tabular-nums; color: var(--ce-muted); font-size: .8rem; }
.admin .st-farthest { opacity: .8; }
.admin .st-stages { list-style: none; margin: .6rem 0; padding: 0; display: flex; flex-wrap: wrap; gap: .75rem; }
.admin .st-stage { display: grid; grid-template-columns: auto 1fr; align-items: center; column-gap: .35rem; row-gap: 0; font-size: .82rem; }
.admin .st-stage-mark { width: .55rem; height: .55rem; border-radius: 999px; background: var(--ce-hairline); grid-row: span 2; }
.admin .st-stage-reached .st-stage-mark { background: var(--ce-text-ok); }
.admin .st-stage-not-reached .st-stage-mark { background: var(--ce-hairline); box-shadow: inset 0 0 0 1px var(--ce-muted); }
.admin .st-stage-cannot-tell .st-stage-mark { background: transparent; box-shadow: inset 0 0 0 2px var(--ce-lumen); }
.admin .st-stage-label { color: var(--ce-fg); }
.admin .st-stage-state { grid-column: 2; font-size: .74rem; color: var(--ce-muted); }
.admin .st-facts, .admin .st-detail { display: grid; grid-template-columns: max-content 1fr; gap: .2rem .6rem; margin: .5rem 0; font-size: .86rem; }
.admin .st-facts dt, .admin .st-detail dt { font-size: .74rem; letter-spacing: .04em; text-transform: uppercase; color: var(--ce-muted); }
.admin .st-facts dd, .admin .st-detail dd { margin: 0; }
.admin .st-blocked { color: var(--ce-text-warn); }
.admin .st-responsible { color: var(--ce-muted); }
.admin .st-controls { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin-top: .6rem; }
.admin .st-link { color: var(--ce-lumen); text-decoration: underline; }
.admin .st-current { margin: .5rem 0; font-weight: 600; }
.admin .st-action-list, .admin .st-refused-list { list-style: none; margin: .5rem 0; padding: 0; display: grid; gap: .4rem; }
.admin .st-action-list > li, .admin .st-refused-list > li { padding: .5rem .6rem; border-radius: .4rem; box-shadow: var(--ce-rim); }
.admin .st-refused-list > li { opacity: .78; }
.admin .st-doesnot { color: var(--ce-muted); }
.admin .st-seam > summary { font-size: .78rem; color: var(--ce-muted); cursor: pointer; }

/* ============================================================ Admin C — the feedback inbox (ADM-C13) */
.admin .fi-privacy { margin: .25rem 0 1rem; padding-inline-start: .75rem; border-inline-start: 2px solid var(--ce-hairline); color: var(--ce-fg-66); font-size: .85rem; }
.admin .fi-tiles { display: grid; gap: .5rem; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); margin: .75rem 0; }
.admin .fi-spread { margin: .75rem 0; }
.admin .fi-legend { list-style: none; display: flex; flex-wrap: wrap; gap: .75rem; margin: .4rem 0 0; padding: 0; font-size: .8rem; }
.admin .fi-legend > li { padding-inline-start: .55rem; border-inline-start: 3px solid var(--ce-hairline); }
.admin .fi-legend-ok { border-inline-start-color: var(--ce-text-ok); }
.admin .fi-legend-warn { border-inline-start-color: var(--ce-text-warn); }
.admin .fi-legend-bad { border-inline-start-color: var(--ce-text-bad); }
.admin .fi-legend-info { border-inline-start-color: var(--ce-lumen); }
.admin .fi-environments { display: grid; gap: .6rem; margin: .75rem 0; }
.admin .fi-env-production { border-inline-start: 3px solid var(--ce-text-ok); }
.admin .fi-env-staging { border-inline-start: 3px solid var(--ce-lumen); }
.admin .fi-census { list-style: none; margin: .4rem 0; padding: 0; font-variant-numeric: tabular-nums; line-height: 1.35; font-size: .84rem; }
.admin .fi-list-section { margin-top: 1.25rem; }
.admin .fi-count { color: var(--ce-muted); font-size: .8rem; font-weight: 400; margin-inline-start: .4rem; }
.admin .fi-list { list-style: none; margin: .5rem 0; padding: 0; display: grid; gap: .75rem; }
.admin .fi-item { padding: .7rem .8rem; border-radius: .45rem; background: var(--ce-panel); box-shadow: var(--ce-rim); }
.admin .fi-head { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; font-size: .8rem; }
.admin .fi-head .when { margin-inline-start: auto; }
.admin .fi-badge { font-size: .68rem; letter-spacing: .05em; text-transform: uppercase; padding: .05rem .35rem; border-radius: .25rem; box-shadow: inset 0 0 0 1px currentColor; }
.admin .fi-badge-production { color: var(--ce-text-ok); }
.admin .fi-badge-staging { color: var(--ce-lumen); }
.admin .fi-state { font-size: .68rem; letter-spacing: .05em; text-transform: uppercase; padding: .05rem .35rem; border-radius: .25rem; }
.admin .fi-state-ok { color: var(--ce-text-ok); }
.admin .fi-state-warn { color: var(--ce-text-warn); }
.admin .fi-state-bad { color: var(--ce-text-bad); }
.admin .fi-state-info { color: var(--ce-lumen); }
.admin .fi-context { color: var(--ce-muted); font-size: .82rem; margin: .35rem 0; }
.admin .fi-message { margin: .5rem 0; padding-inline-start: .75rem; border-inline-start: 3px solid var(--ce-hairline); line-height: 1.55; overflow-wrap: anywhere; }
.admin .fi-held { color: var(--ce-text-warn); font-size: .84rem; }
.admin .fi-mark { color: var(--ce-muted); font-size: .82rem; }
.admin .fi-triage { margin-top: .6rem; padding-top: .6rem; border-top: 1px solid var(--ce-hairline); display: grid; gap: .35rem; }
.admin .fi-note-label { font-size: .78rem; color: var(--ce-muted); }
.admin .fi-note { width: 100%; resize: vertical; }
.admin .fi-actions { display: flex; flex-wrap: wrap; gap: .4rem; }
.admin .fi-set-ok { color: var(--ce-text-ok); }
.admin .fi-set-warn { color: var(--ce-text-warn); }
.admin .fi-set-bad { color: var(--ce-text-bad); }
.admin .fi-set-info { color: var(--ce-lumen); }
.admin .fi-consequence { color: var(--ce-muted); font-size: .78rem; }
.admin .fi-technical code { overflow-wrap: anywhere; }
.admin .fi-queue { margin: .4rem 0; }
.admin .fi-warn { color: var(--ce-text-warn); }
.admin .fi-empty { color: var(--ce-muted); }

/* ============================================================ Admin C — cost classes and role colours (ADM-33, ADM-36) */
.admin table.cost tr.group-head th { font-size: .72rem; letter-spacing: .04em; text-transform: uppercase; color: var(--ce-muted); padding-top: .6rem; border-bottom: 0; text-align: left; }
.admin .cost-class { display: inline-block; font-size: .68rem; letter-spacing: .04em; text-transform: uppercase; padding: 0 .35rem; border-radius: .25rem; box-shadow: inset 0 0 0 1px currentColor; white-space: nowrap; }
.admin .cost-class-paid-model { color: var(--ce-lumen); }
.admin .cost-class-plain-code { color: var(--ce-text-ok); }
.admin .cost-class-subscription-job { color: var(--ce-text-ok); }
.admin .cost-class-zero-this-run { color: var(--ce-muted); }
.admin .cost-class-not-measured { color: var(--ce-text-warn); }
.admin .cost-class-predates-measurement { color: var(--ce-muted); }
.admin tr.cost-plain-code td, .admin tr.cost-zero-this-run td, .admin tr.cost-predates-measurement td { color: var(--ce-muted); }
.admin tr.cost-not-measured td, .admin tr.cost-unmeasured td { color: var(--ce-text-warn); }
.admin .role-scout .bar-fill { background: linear-gradient(90deg, color-mix(in srgb, var(--lvl-state) 45%, var(--ce-slate-rise)), var(--lvl-state)); }
.admin .role-acquirer .bar-fill { background: linear-gradient(90deg, color-mix(in srgb, var(--lvl-local) 45%, var(--ce-slate-rise)), var(--lvl-local)); }
.admin .role-detective .bar-fill { background: linear-gradient(90deg, color-mix(in srgb, var(--lvl-school) 45%, var(--ce-slate-rise)), var(--lvl-school)); }
.admin .role-parser .bar-fill { background: linear-gradient(90deg, color-mix(in srgb, var(--lvl-school) 45%, var(--ce-slate-rise)), var(--lvl-school)); }
.admin .role-validator .bar-fill { background: linear-gradient(90deg, color-mix(in srgb, var(--lvl-federal) 45%, var(--ce-slate-rise)), var(--lvl-federal)); }
.admin .role-adversarial-auditor .bar-fill { background: linear-gradient(90deg, color-mix(in srgb, var(--ce-text-warn) 45%, var(--ce-slate-rise)), var(--ce-text-warn)); }
.admin .role-engineering .bar-fill { background: linear-gradient(90deg, color-mix(in srgb, var(--ce-lumen) 45%, var(--ce-slate-rise)), var(--ce-lumen)); }
.admin .role-release-orchestrator .bar-fill { background: linear-gradient(90deg, color-mix(in srgb, var(--ce-lumen) 45%, var(--ce-slate-rise)), var(--ce-lumen)); }
.admin .subscription-block { margin-top: 1.25rem; padding-top: .75rem; border-top: 1px solid var(--ce-hairline); }
.admin table.cost.billed td, .admin table.cost.billed th { white-space: nowrap; }


/* ============================================================ Admin C — research detail (ADM-42..48) */
.admin .wf-id { display: inline-block; max-width: 100%; white-space: normal; }
.admin .wf-id .raw-ids { display: inline-block; margin-inline-start: .35rem; }
.admin table.scout-attempts td, .admin table.wf-attempts td { vertical-align: top; }
.admin table.scout-attempts td:nth-child(2) { min-width: 24rem; }
.admin table.scout-attempts td:last-child { white-space: normal; min-width: 12rem; }
.admin table.wf-attempts td:nth-child(2), .admin table.wf-attempts td:nth-child(3) { min-width: 18rem; }
.admin .scout-trying { font-weight: 500; color: var(--ce-fg); margin-bottom: .2rem; }
.admin td.needs-no { color: var(--ce-muted); }
.admin td.needs-yes { color: var(--ce-text-warn); font-weight: 600; }

/* ============================================================ Admin C — the source and API registry (ADM-C11) */
.admin .src-summary { display: grid; gap: .5rem; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); margin: .75rem 0; }
.admin .src-family { margin-top: 1.5rem; }
.admin .src-count { font-size: .78rem; font-weight: 400; color: var(--ce-muted); margin-inline-start: .4rem; }
.admin .src-table-scroll { overflow-x: auto; }
.admin table.src-table { width: 100%; border-collapse: collapse; font-size: .82rem; }
.admin table.src-table th, .admin table.src-table td { text-align: left; vertical-align: top; padding: .35rem .5rem; border-bottom: 1px solid var(--ce-hairline); }
.admin table.src-table thead th { position: sticky; top: 0; background: var(--ce-void); font-size: .72rem; letter-spacing: .04em; text-transform: uppercase; color: var(--ce-muted); font-weight: 500; }
.admin .src-row { border-inline-start: 3px solid transparent; }
.admin .src-ok { border-inline-start-color: var(--ce-text-ok); }
.admin .src-warn { border-inline-start-color: var(--ce-text-warn); }
.admin .src-bad { border-inline-start-color: var(--ce-text-bad); }
.admin .src-info { border-inline-start-color: var(--ce-lumen); }
.admin .src-none { border-inline-start-color: var(--ce-muted); }
.admin .src-name { width: 22ch; font-weight: 400; }
.admin .src-source { display: block; font-weight: 600; }
.admin .src-provider { display: block; font-size: .76rem; color: var(--ce-muted); }
.admin .src-detail > summary { font-size: .76rem; color: var(--ce-muted); cursor: pointer; }
.admin .src-detail dl { display: grid; grid-template-columns: max-content 1fr; gap: .15rem .5rem; margin: .3rem 0; }
.admin .src-detail dt { font-size: .72rem; color: var(--ce-muted); }
.admin .src-detail dd { margin: 0; }
.admin .src-evidence { list-style: none; margin: .3rem 0; padding: 0; }
.admin .src-evidence code { font-size: .74rem; }
.admin .src-note { display: block; font-size: .76rem; color: var(--ce-muted); }
.admin .src-key { display: block; }
.admin .src-key-yes { color: var(--ce-text-ok); }
.admin .src-key-no { color: var(--ce-text-warn); }
.admin .src-key-unknown, .admin .src-key-none { color: var(--ce-muted); }
.admin .src-last, .admin .src-next, .admin .src-health, .admin .src-coverage { white-space: nowrap; }
.admin .src-gap { color: var(--ce-muted); font-style: italic; border-bottom: 1px dotted var(--ce-hairline); }
.admin .src-blocker { font-size: .76rem; padding-inline-start: .6rem; margin: .2rem 0; }
.admin .src-blocker-whose { font-size: .7rem; letter-spacing: .04em; text-transform: uppercase; color: var(--ce-muted); margin-inline-end: .3rem; }
.admin .src-needs-list, .admin .src-legacy { list-style: none; margin: .4rem 0; padding: 0; display: grid; gap: .25rem; }
.admin .src-legacy code { font-size: .76rem; }
.admin .src-disagreements { line-height: 1.6; }
.admin .src-legend, .admin .src-grades { display: grid; grid-template-columns: 16ch 1fr; gap: .2rem .6rem; font-size: .82rem; margin: .5rem 0; }
.admin .src-legend dt, .admin .src-grades dt { color: var(--ce-muted); }
.admin .src-legend dd, .admin .src-grades dd { margin: 0; }
.admin .src-legend-item { padding-inline-start: .5rem; border-inline-start: 3px solid transparent; }
.admin .src-limits > li { margin-bottom: .4rem; }

/* ============================================================ Admin C — ask the console (ADM-C7) */
.admin .chat-console { display: grid; gap: 1.25rem; }
.admin .chat-transcript { list-style: none; margin: 0; padding: 0; display: grid; gap: 1.25rem; }
.admin .chat-exchange { padding-top: 1rem; border-top: 1px solid var(--ce-hairline); }
.admin .chat-exchange:first-child { border-top: 0; padding-top: 0; }
.admin .chat-asked { color: var(--ce-muted); font-size: .9rem; margin: 0 0 .5rem; }
.admin .chat-waiting { color: var(--ce-muted); font-style: italic; }
.admin .chat-line { margin: .35rem 0; }
.admin .chat-denominator { margin: .5rem 0; padding-inline-start: .75rem; border-inline-start: 3px solid var(--ce-lumen); font-size: .88rem; }
.admin .chat-denominator-source { display: block; font-size: .76rem; color: var(--ce-muted); }
.admin .chat-gap, .admin .chat-gaps > li { color: var(--ce-text-warn); font-size: .86rem; }
.admin .chat-gaps, .admin .chat-sources, .admin .chat-detail, .admin .chat-suggestions, .admin .chat-reads { list-style: none; margin: .4rem 0; padding: 0; display: grid; gap: .25rem; }
.admin .chat-sources > li { font-size: .78rem; color: var(--ce-muted); }
.admin .chat-detail { overflow-x: auto; }
.admin .chat-detail code { font-size: .76rem; }
.admin .chat-suggestions { display: flex; flex-wrap: wrap; gap: .4rem; }
.admin .chat-subject { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .82rem; padding: .05rem .3rem; border-radius: .2rem; background: var(--ce-panel-raised); }
.admin .chat-refusals { font-size: .78rem; color: var(--ce-muted); }
.admin .chat-composer { display: flex; flex-wrap: wrap; align-items: flex-end; gap: .5rem; margin-top: 1rem; }
.admin .chat-label { font-size: .78rem; color: var(--ce-muted); display: block; }
.admin .chat-input { flex: 1 1 22rem; resize: vertical; font: inherit; }
.admin .chat-limits, .admin .chat-controls { margin-top: 1.5rem; }
.admin .chat-limits ul, .admin .chat-controls ul { line-height: 1.6; }


/* ============================================================ Admin C — the agent bridge (ADM-C8, ADM-C9) */
.admin .ab-providers, .admin .ab-reviews { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(24rem, 1fr)); }
.admin .ab-provider, .admin .ab-review, .admin .ab-fallback { margin-block: 1rem; }
.admin .ab-review h3, .admin .ab-review h4 { margin: .4rem 0 .2rem; }
.admin .ab-fields { display: grid; grid-template-columns: max-content 1fr; gap: .35rem .75rem; margin: .4rem 0; font-size: .85rem; }
.admin .ab-fields dt { color: var(--ce-muted); font-size: .78rem; white-space: nowrap; }
.admin .ab-fields dd { color: var(--ce-fg); margin-inline-start: 0; }
.admin .ab-seats { display: grid; gap: .6rem; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); }
.admin .ab-seat { padding: .5rem; border-radius: var(--ce-radius-md); box-shadow: inset 0 0 0 1px var(--ce-hairline); }
.admin .ab-independence { margin: .6rem 0; padding: .75rem; background: var(--ce-panel-raised); box-shadow: var(--ce-rim); border-radius: var(--ce-radius-md); }
.admin .ab-checks, .admin .ab-points-one { list-style: none; margin: .4rem 0; padding: 0; font-size: .84rem; line-height: 1.4; color: var(--ce-muted); }
.admin .ab-holds { color: var(--ce-text-ok); }
.admin .ab-points { display: grid; gap: .5rem; margin: .5rem 0; }
.admin .ab-point dt, .admin .ab-points dt { font-weight: 600; font-size: .86rem; }
.admin .ab-point-split { display: grid; gap: .35rem; }
.admin .ab-point-split > p + p { padding-top: .35rem; border-top: 1px solid var(--ce-hairline); }
.admin .ab-evidence { display: block; font-size: .78rem; color: var(--ce-muted); }
.admin .ab-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-block-start: .5rem; }
.admin .ab-arm { margin-block-start: .5rem; }
.admin .ab-arm > summary { display: inline-block; cursor: pointer; padding: .4rem .8rem; border-radius: var(--ce-radius-md); box-shadow: inset 0 0 0 1px var(--ce-lumen); color: var(--ce-lumen); }
.admin .ab-arm > div, .admin .ab-arm > form, .admin .ab-arm > p { padding: .5rem 0 0; }
.admin .ab-decide { margin-block-start: .5rem; }
.admin table.ab-jobs { width: 100%; border-collapse: collapse; font-size: .84rem; }
.admin table.ab-jobs th, .admin table.ab-jobs td { text-align: start; vertical-align: top; padding: .35rem .5rem; border-block-end: 1px solid var(--ce-hairline); }
.admin .ab-asked, .admin .ab-why { display: block; font-size: .78rem; color: var(--ce-muted); }
.admin .ab-why-refused { color: var(--ce-text-warn); }
.admin .ab-detail > summary { font-size: .78rem; color: var(--ce-muted); cursor: pointer; }
.admin .ab-detail > * { max-width: 28rem; }
.admin .ab-unreadable { color: var(--ce-text-warn); }

/* ============================================================ Admin C — reader intelligence (ADM-C12) */
/*
 * The four traffic classes on the census bar. Scoped to the SEGMENT and to the
 * legend swatch separately — the layout's own comment records that the
 * unscoped form was a 1.09:1 contrast defect. ORGANIC is the lit tone because
 * it is the only one that is a demand figure; UNKNOWN is deliberately the
 * dullest, because an unattributable row is neither a reader nor a finding.
 */
.admin .stack-part.part-readers { background: var(--ce-lumen); }
.admin .part-readers .swatch { background: var(--ce-lumen); }
.admin .stack-part.part-author { background: #4c9a5a; }
.admin .part-author .swatch { background: #4c9a5a; }
.admin .stack-part.part-automated { background: #d99a3a; }
.admin .part-automated .swatch { background: #d99a3a; }
.admin .stack-part.part-unattributed { background: var(--ce-slate-rise); }
.admin .part-unattributed .swatch { background: var(--ce-slate-rise); }


/* ============================================================ Admin C — the deploy-fleet preview (§9A.16) */
.admin .deploy { margin: .75rem 0; display: grid; gap: .4rem; }
.admin .deploy-preview { padding: .8rem 1rem; border-radius: var(--ce-radius-md); background: var(--ce-panel); box-shadow: var(--ce-rim); }
.admin .deploy-preview h4 { margin: 0 0 .4rem; }
.admin .deploy-preview h5 { margin: .7rem 0 .2rem; font-size: .78rem; letter-spacing: .04em; text-transform: uppercase; color: var(--ce-muted); }
.admin .dp-means { margin: .2rem 0 .5rem; font-weight: 600; }
.admin .dp-list, .admin .dp-after { margin: .2rem 0; padding-inline-start: 1.1rem; font-size: .88rem; line-height: 1.5; }
.admin .dp-list { list-style: disc; }
.admin .dp-will-not > li { color: var(--ce-fg-66); }
.admin .dp-unmeasured { color: var(--ce-text-warn); }
.admin .dp-after { list-style: decimal; color: var(--ce-fg-66); }
.admin .deploy .actions { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin-top: .6rem; }
.admin .deploy textarea { width: 100%; min-height: 3.5rem; resize: vertical; }
.admin .deploy-sent .state-green, .admin .deploy-failed .refusal { margin: 0; }
.admin .console-loading { opacity: .85; }

/* ============================================================ motion guard */
@media (prefers-reduced-motion: reduce) {
  .admin *, .admin *::before, .admin *::after, .console-nav *, .console-nav *::before { transition-duration: 1ms !important; animation-duration: 1ms !important; animation-iteration-count: 1 !important; }
}
`;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      {children}
    </>
  );
}
