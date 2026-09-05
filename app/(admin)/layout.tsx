/**
 * The admin surface's own shell. (Session C final, ITEM H, 2026-09-01; the
 * Lumen Edge pass for the 9.4.26 evening admin feedback, ADM-21, 2026-09-05.)
 *
 * Styles are scoped here rather than in `app/globals.css` because the control
 * centre is not the product: it has no reader to consider and no business
 * being in the stylesheet every reader downloads. It DOES now have a design
 * language of its own, and this file is the whole of it.
 *
 * ## Lumen Edge, with our colours on top
 *
 * The owner licensed the Lumen Edge system (uiverse, Uiverse Design System
 * License v1 — the extracted tokens may live in this private repository; the
 * ZIP may not be redistributed) and asked for its flow on the admin dashboard
 * ONLY — the consumer app's design overhaul is tabled and stays out of this
 * file. Four signals carry the whole look, each mapped to a token below:
 *
 *   1  the surface gradient   light from underneath: an ellipse anchored at
 *                             the bottom edge, brightest at 0%, floor by ~45–65%
 *   2  the hairline rim       a 1px INSET box-shadow at low alpha — never a
 *                             border — strengthening on hover and focus
 *   3  the horizon line       a 70%-wide gradient at the base of every card and
 *                             control, dim at rest, lit on interaction
 *   4  elevation and motion   a tight contact shadow plus a long blurred drop,
 *                             and one signature 1s curve
 *
 * And the one departure the owner asked for: COLOUR WHEREVER A JURISDICTION
 * LEVEL IS EXPRESSED. Lumen Edge is chromaless by design; his words were
 * "keeping color is super important to me", and the compromise the system
 * survives is that HUE rides on the horizon line and the pill, never on the
 * surfaces or the body text. The four hues are the reader map legend's own
 * tokens (`app/globals.css` `--accent-local/state/school/national`), copied
 * here verbatim for dark and for light so the two surfaces agree.
 *
 * Fonts stay ours (no third-party font import from the licensed system). Health
 * grades and readiness cell states keep their legend colours: those are a
 * scale the owner reads, not decoration.
 *
 * `noindex` is belt to `netlify.toml`'s braces. The admin host should never be
 * crawled, and the one thing worse than a crawler finding it is a crawler
 * finding it and caching what it saw.
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
  --ce-void: #1b1c22;
  --ce-graphite: #0b151e;
  --ce-panel: #20222a;
  --ce-panel-raised: #262932;
  --ce-slate-rise: #47515c;
  --ce-hairline: #2f3441;
  --ce-fg: #ffffff;
  --ce-muted: #a8aebb;
  --ce-lumen: #cfd8e6;
  --ce-alpha-hairline: rgba(255,255,255,.10);
  --ce-alpha-hairline-strong: rgba(255,255,255,.16);
  --ce-fg-66: rgba(255,255,255,.66);
  --ce-surface-gradient: radial-gradient(ellipse at bottom, rgba(71,81,92,1) 0%, rgba(11,21,30,1) 45%);
  --ce-surface-gradient-soft: radial-gradient(ellipse at bottom, rgba(71,81,92,.55) 0%, rgba(11,21,30,.95) 55%);
  --ce-surface-panel-gradient: radial-gradient(ellipse at bottom, rgba(47,52,65,.6) 0%, rgba(20,22,30,1) 65%);
  --ce-horizon: linear-gradient(90deg, rgba(255,255,255,0) 0%, #ffffff 50%, rgba(255,255,255,0) 100%);
  --ce-horizon-lumen: linear-gradient(90deg, rgba(255,255,255,0) 0%, #cfd8e6 50%, rgba(255,255,255,0) 100%);
  --ce-rim: inset 0 0 0 1px var(--ce-alpha-hairline);
  --ce-rim-strong: inset 0 0 0 1px var(--ce-alpha-hairline-strong);
  --ce-shadow-card: 0 1px 1px rgba(0,0,0,.4), 0 12px 32px -12px rgba(0,0,0,.6);
  --ce-shadow-raised: 0 2px 4px rgba(0,0,0,.5), 0 24px 48px -16px rgba(0,0,0,.7);
  --ce-focus: 0 0 0 1px var(--ce-lumen), 0 0 16px rgba(207,216,230,.25);
  --ce-motion-slow: 1s cubic-bezier(.15,.83,.66,1);
  --ce-motion-medium: 420ms cubic-bezier(.15,.83,.66,1);
  --ce-motion-fast: 200ms cubic-bezier(.15,.83,.66,1);
  --ce-radius-md: 7px;
  --ce-radius-lg: 14px;
  /* The reader map legend's level colours — dark values from app/globals.css. */
  --lvl-local: #ffb000;
  --lvl-state: #00b894;
  --lvl-school: #e84393;
  --lvl-federal: #6c8fd4;
}
[data-theme="light"] .admin, [data-theme="light"] .console-nav {
  --ce-void: #eef0f3;
  --ce-graphite: #d3d9e1;
  --ce-panel: #ffffff;
  --ce-panel-raised: #f7f8fa;
  --ce-slate-rise: #c6ced8;
  --ce-hairline: #d5d9e0;
  --ce-fg: #101318;
  --ce-muted: #4d5666;
  --ce-lumen: #3d5f9e;
  --ce-alpha-hairline: rgba(0,0,0,.08);
  --ce-alpha-hairline-strong: rgba(0,0,0,.14);
  --ce-fg-66: rgba(16,19,24,.72);
  --ce-surface-gradient: radial-gradient(ellipse at bottom, #ffffff 0%, #dfe4eb 45%);
  --ce-surface-gradient-soft: radial-gradient(ellipse at bottom, rgba(255,255,255,.9) 0%, rgba(223,228,235,.95) 55%);
  --ce-surface-panel-gradient: radial-gradient(ellipse at bottom, rgba(255,255,255,1) 0%, #f1f3f6 65%);
  --ce-horizon: linear-gradient(90deg, rgba(0,0,0,0) 0%, #2b3340 50%, rgba(0,0,0,0) 100%);
  --ce-horizon-lumen: linear-gradient(90deg, rgba(0,0,0,0) 0%, #3d5f9e 50%, rgba(0,0,0,0) 100%);
  --ce-shadow-card: 0 1px 1px rgba(0,0,0,.2), 0 12px 32px -12px rgba(0,0,0,.3);
  --ce-shadow-raised: 0 2px 4px rgba(0,0,0,.25), 0 24px 48px -16px rgba(0,0,0,.35);
  --ce-focus: 0 0 0 1px var(--ce-lumen), 0 0 16px rgba(61,95,158,.25);
  --lvl-local: #b8860b;
  --lvl-state: #00896e;
  --lvl-school: #c2185b;
  --lvl-federal: #3d5f9e;
}
/* The whole viewport is the void, so the page never sits on the reader's ground. */
body:has(main.admin) { background: #1b1c22; }
[data-theme="light"] body:has(main.admin) { background: #eef0f3; }

/* ============================================================ base */
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
.admin code { font-size: .86em; }
.admin .note { color: var(--ce-muted); font-size: .85rem; margin: .25rem 0; }
.admin small.note { display: inline; }
.admin .denom { color: var(--ce-muted); font-weight: 400; }
.admin .gap { font-style: italic; color: var(--ce-muted); }
.admin .gap-whose { text-transform: uppercase; font-size: .68rem; letter-spacing: .06em; color: var(--ce-muted); font-style: normal; }
.admin .refusal { padding: .75rem 1rem; box-shadow: inset 0 0 0 2px #b3261e, var(--ce-shadow-card); border-radius: var(--ce-radius-md); background: var(--ce-panel); }
.admin .state-green { color: #4c9a5a; font-weight: 600; }
.admin .state-red { color: #cc4b4b; font-weight: 600; }
.admin .state-amber { color: #d99a3a; font-weight: 600; }
.admin .state-unknown { color: var(--ce-muted); font-weight: 600; }
.admin .plain { font-size: 1.05rem; margin: .35rem 0 .75rem; }
.admin .free { color: var(--ce-muted); font-variant-numeric: tabular-nums; }
.admin .when { font-variant-numeric: tabular-nums; }
.admin details summary { cursor: pointer; color: var(--ce-muted); font-size: .85rem; }
.admin details.ph-evidence { margin: .5rem 0 1rem; }
.admin details.raw-ids { margin-top: .2rem; }
.admin details.raw-ids summary { font-size: .72rem; letter-spacing: .04em; text-transform: uppercase; }
.admin hr { border: 0; height: 1px; background: var(--ce-hairline); margin: 2rem 0 1rem; }
.admin .outcome { text-transform: capitalize; }
.admin .outcome-completed { color: #4c9a5a; }
.admin .outcome-aborted, .admin .outcome-failed { color: #cc4b4b; }
.admin .outcome-running { color: var(--ce-lumen); }

/* ============================================================ the card recipe (signal 1 + 2 + 3 + 4) */
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
/* THE ADMIN COLOUR HOOK: a level-carrying card's horizon takes the level's hue. */
.admin .card.lvl-local::after { background: linear-gradient(90deg, transparent 0%, var(--lvl-local) 50%, transparent 100%); opacity: .85; }
.admin .card.lvl-state::after { background: linear-gradient(90deg, transparent 0%, var(--lvl-state) 50%, transparent 100%); opacity: .85; }
.admin .card.lvl-school::after { background: linear-gradient(90deg, transparent 0%, var(--lvl-school) 50%, transparent 100%); opacity: .85; }
.admin .card.lvl-federal::after { background: linear-gradient(90deg, transparent 0%, var(--lvl-federal) 50%, transparent 100%); opacity: .85; }

/* ============================================================ controls: the button recipe */
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
.admin button.rq-cell { padding: 0; border-radius: .25rem; background: none; box-shadow: none; }
.admin button.rq-cell::before { display: none; }
.admin button.rq-cell:hover { transform: scale(1.15); box-shadow: 0 0 0 1px var(--ce-alpha-hairline-strong); }
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
.admin form { margin-top: .5rem; }
.admin label { display: block; margin: .5rem 0; }
.admin input[type="password"] { width: 100%; max-width: 28rem; }

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
.admin .ph-l-GREEN .ph-chip { color: #4c9a5a; } .admin .ph-l-AMBER .ph-chip { color: #d99a3a; } .admin .ph-l-RED .ph-chip { color: #cc4b4b; } .admin .ph-l-UNKNOWN .ph-chip { color: var(--ce-muted); }

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
.admin .chip.receipt-done { color: #4c9a5a; }
.admin .chip.receipt-waiting { color: var(--ce-lumen); }
.admin .chip.receipt-refused { color: #cc4b4b; }
.admin .queue-card p { margin: .3rem 0; }
.admin .queue-card .options form { margin: .35rem 0 0; }
.admin .queue-card .options button.option { display: flex; flex-direction: column; align-items: flex-start; width: 100%; text-align: left; margin: .3rem 0; padding: .5rem .7rem; background: var(--ce-panel); color: var(--ce-fg); }
.admin .queue-card .options button.option:hover { background: var(--ce-panel-raised); }
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
.admin button.queue-add { margin: 0 0 0 .5rem; vertical-align: baseline; }
.admin button.queue-add.compact { padding: .1rem .5rem; font-size: .72rem; min-width: 0; color: var(--ce-muted); background: var(--ce-panel); }
.admin button.queue-add.compact:hover { color: var(--ce-fg); transform: translateY(-1px); }
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
.admin .part-model { background: var(--ce-lumen); }
.admin .part-deterministic { background: var(--ce-slate-rise); }
.admin .part-promoted { background: #4c9a5a; }
.admin .part-would { background: var(--ce-lumen); }
.admin .part-refused { background: var(--ce-slate-rise); }
.admin .part-deferred { background: #d99a3a; }
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

/* ============================================================ the console header */
.console-nav {
  position: sticky; top: 0; z-index: 20; display: flex; flex-wrap: wrap; align-items: flex-end; gap: 1rem;
  margin: 0 auto 1.25rem; max-width: 72rem; padding: .75rem 1.25rem; background: var(--ce-void); color: var(--ce-fg);
  box-shadow: 0 1px 0 var(--ce-hairline);
}
.console-nav label { display: flex; flex-direction: column; gap: .2rem; margin: 0; font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; color: var(--ce-muted); }
.console-nav select { font-size: .95rem; text-transform: none; letter-spacing: normal; padding: .35rem .5rem; min-width: 11rem; }
.console-nav-brand { margin-left: auto; align-self: center; font-size: .75rem; color: var(--ce-muted); }
.console-nav .icon-btn { align-self: center; }
.console-nav-pending { align-self: center; font-size: .8rem; color: var(--ce-lumen); }
.console-nav[aria-busy="true"] select { opacity: .7; }
.readiness, .admin.console-page { max-width: 72rem; }

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
