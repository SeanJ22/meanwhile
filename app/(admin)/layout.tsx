/**
 * The admin surface's own shell. (Session C final, ITEM H, 2026-09-01.)
 *
 * Styles are scoped here rather than in `app/globals.css` because the control
 * centre is not the product: it has no design tokens to honour, no reader to
 * consider, and no business being in the stylesheet every reader downloads.
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
.admin { max-width: 60rem; margin: 0 auto; padding: 2rem 1.25rem 6rem; line-height: 1.5; }
.admin h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
.admin h2 { font-size: 1.2rem; margin: 2.25rem 0 .5rem; border-top: 1px solid currentColor; padding-top: .75rem; opacity: .95; }
.admin h3 { font-size: 1rem; margin: 1.25rem 0 .35rem; }
.admin table { width: 100%; border-collapse: collapse; margin: .5rem 0 1rem; font-size: .9rem; }
.admin th, .admin td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid rgba(128,128,128,.35); vertical-align: top; }
.admin pre { overflow-x: auto; padding: .75rem; background: rgba(128,128,128,.12); border-radius: .35rem; font-size: .85rem; }
.admin .note { opacity: .75; font-size: .85rem; margin: .25rem 0; }
.admin .denom { opacity: .7; font-weight: 400; }
.admin .gap { font-style: italic; opacity: .85; }
.admin .gap-whose { text-transform: uppercase; font-size: .7rem; letter-spacing: .04em; opacity: .7; }
.admin .refusal { padding: .75rem; border: 2px solid #b3261e; border-radius: .35rem; }
.admin .state-green { color: #1b7f3b; font-weight: 600; }
.admin .state-red { color: #b3261e; font-weight: 600; }
.admin .state-amber { color: #b8860b; font-weight: 600; }
.admin .state-unknown { opacity: .75; font-weight: 600; }

/* Pilot-health primary view: overall band + three compact contract cards, so the
   first viewport answers healthy?/which?/failing-or-stale?/why?/next — with the
   run IDs, SHAs and proof classes tucked into a <details> below. */
.admin .ph-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: .75rem; margin: .5rem 0 1.25rem; }
.admin .ph-card { border: 1px solid rgba(128,128,128,.4); border-left-width: 4px; border-radius: .4rem; padding: .6rem .75rem; }
.admin .ph-card h3 { display: flex; justify-content: space-between; align-items: baseline; gap: .5rem; margin: 0 0 .25rem; font-size: .95rem; }
.admin .ph-chip { font-size: .68rem; text-transform: uppercase; letter-spacing: .04em; padding: 0 .35rem; border-radius: .25rem; border: 1px solid currentColor; white-space: nowrap; }
.admin .ph-num { font-size: 1.25rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.admin .ph-meta { font-size: .72rem; opacity: .7; margin: .1rem 0 0; }
.admin .ph-reason { font-size: .82rem; margin: .35rem 0 0; }
.admin .ph-next { font-size: .8rem; margin: .35rem 0 0; }
.admin .ph-l-GREEN { border-left-color: #1b7f3b; } .admin .ph-l-GREEN .ph-chip { color: #1b7f3b; }
.admin .ph-l-AMBER { border-left-color: #b8860b; } .admin .ph-l-AMBER .ph-chip { color: #b8860b; }
.admin .ph-l-RED { border-left-color: #b3261e; } .admin .ph-l-RED .ph-chip { color: #b3261e; }
.admin .ph-l-UNKNOWN { border-left-color: rgba(128,128,128,.55); } .admin .ph-l-UNKNOWN .ph-chip { opacity: .7; }
.admin details.ph-evidence { margin: .5rem 0 1rem; } .admin details.ph-evidence summary { cursor: pointer; font-size: .85rem; opacity: .8; }
.admin .card { border: 1px solid rgba(128,128,128,.45); border-radius: .4rem; padding: .75rem 1rem; margin: .75rem 0; }
.admin .card button { display: block; width: 100%; text-align: left; margin: .35rem 0; padding: .5rem .6rem; cursor: pointer; }
.admin form { margin-top: .5rem; }
.admin label { display: block; margin: .5rem 0; }
.admin input[type="password"] { width: 100%; max-width: 28rem; padding: .5rem; font: inherit; }

/* ---- The one visual language both console views share (9.4.26). The tiles,
   legend and swatches were the readiness panel's; they are the reference the
   owner expected Pilot Health to resemble, so they live under .admin now.
   Every colour reads on the dark default and under [data-theme="light"]:
   fills are mid-saturation, borders are neutral rgba, and nothing relies on a
   white ring or a light-only grey. ---- */
.admin .rq-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: .6rem; margin: .5rem 0 1.5rem; }
.admin .rq-tile { border: 1px solid rgba(128,128,128,.4); border-radius: .4rem; padding: .6rem .75rem; }
.admin .rq-tile .rq-figure { font-size: 1.4rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.admin .rq-tile .rq-caption { font-size: .75rem; opacity: .7; margin-top: .15rem; }
.admin .rq-legend { display: flex; flex-wrap: wrap; gap: .9rem; font-size: .78rem; margin: .5rem 0 1rem; opacity: .9; }
.admin .rq-legend span { display: inline-flex; align-items: center; gap: .35rem; }
.admin .rq-cell { display: inline-block; width: 1rem; height: 1rem; border-radius: .25rem; border: 1px solid rgba(128,128,128,.55); vertical-align: middle; }
.admin button.rq-cell { cursor: pointer; padding: 0; }
.admin button.rq-cell:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
.admin .rq-current { background: #4c9a5a; border-color: #3c7a48; }
.admin .rq-partial { background: #d99a3a; border-color: #b57e26; }
.admin .rq-notwalked { background: transparent; }
/* ARGUED_ABSENT: a hatched swatch, distinct from NOT_WALKED (empty) and from
   PARTIAL (amber) in BOTH themes; the old near-white fill vanished on light. */
.admin .rq-argued { background: repeating-linear-gradient(45deg, rgba(128,128,128,.55) 0 2px, transparent 2px 5px); border-color: rgba(128,128,128,.8); }
.admin .rq-blocked { background: #cc4b4b; border-color: #a93838; }
.admin .rq-gated { background: #8b7fd6; border-color: #6f61c4; }
.admin .rq-violation { box-shadow: 0 0 0 2px #cc4b4b, 0 0 0 3px Canvas; }
/* The health grades use the same swatch shape as the readiness cells. */
.admin .hl-GREEN { background: #4c9a5a; border-color: #3c7a48; }
.admin .hl-AMBER { background: #d99a3a; border-color: #b57e26; }
.admin .hl-RED { background: #cc4b4b; border-color: #a93838; }
.admin .hl-UNKNOWN { background: transparent; }
.admin .band { display: inline-flex; align-items: center; gap: .35rem; font-size: .95rem; }
.admin h1 .band { font-size: 1.1rem; vertical-align: middle; }
.admin .rq-legend.scale { margin-top: .25rem; }
.admin .plain { font-size: 1.05rem; margin: .35rem 0 .75rem; }
.admin .rq-unpublished { border: 2px solid #d99a3a; border-radius: .4rem; padding: .6rem .8rem; margin: .25rem 0 1rem; font-size: .9rem; background: rgba(217,154,58,.12); }
.admin .rq-unpublished code { font-size: .85em; }

/* ---- Pilot Health as the fleet view (ADM-7). ---- */
.admin .fleet { display: grid; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); gap: .75rem; margin: .5rem 0 1rem; }
.admin .fleet-card { border: 1px solid rgba(128,128,128,.4); border-radius: .4rem; padding: .7rem .85rem; }
.admin .fleet-card h3 { margin: 0 0 .2rem; font-size: 1.05rem; }
.admin .fleet-card .fleet-what { font-size: .85rem; opacity: .85; margin: 0 0 .5rem; }
.admin .fleet-card .fleet-doing { font-size: .9rem; margin: .25rem 0 .5rem; }
.admin .fleet-nums { display: grid; grid-template-columns: repeat(3, 1fr); gap: .4rem; margin: .4rem 0; }
.admin .fleet-nums .rq-tile { padding: .4rem .5rem; }
.admin .fleet-nums .rq-figure { font-size: 1.15rem; }
.admin .fleet-where { font-size: .8rem; margin: .35rem 0; }
.admin .fleet-where .where { display: inline-block; border: 1px solid rgba(128,128,128,.5); border-radius: 1rem; padding: 0 .5rem; margin: .1rem .2rem .1rem 0; }
.admin .fleet-latest { font-size: .78rem; opacity: .8; margin: .35rem 0 0; padding-left: 1rem; }
.admin .fleet-roles { font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; opacity: .6; }
.admin .deploy { border: 1px dashed rgba(128,128,128,.6); border-radius: .4rem; padding: .75rem 1rem; margin: .75rem 0 1rem; }
.admin .deploy textarea { width: 100%; max-width: 40rem; min-height: 4.5rem; font: inherit; padding: .5rem; color-scheme: inherit; background-color: Canvas; color: CanvasText; border: 1px solid rgba(128,128,128,.5); border-radius: .3rem; }
.admin .deploy .actions { display: flex; gap: .5rem; align-items: center; margin-top: .5rem; }
.admin button.primary { font: inherit; cursor: pointer; padding: .45rem .9rem; border-radius: .3rem; border: 1px solid currentColor; background: transparent; color: inherit; font-weight: 600; }
.admin button.primary:hover { background: rgba(128,128,128,.15); }
.admin .deployments li { margin: .25rem 0; font-size: .9rem; }

/* ---- Runner standing (ADM-5). ---- */
.admin .runner-card { border: 1px solid rgba(128,128,128,.4); border-left-width: 4px; border-radius: .4rem; padding: .7rem .85rem; margin: .5rem 0 1rem; }
.admin .runner-card.l-GREEN { border-left-color: #4c9a5a; } .admin .runner-card.l-AMBER { border-left-color: #d99a3a; }
.admin .runner-card.l-RED { border-left-color: #cc4b4b; } .admin .runner-card.l-UNKNOWN { border-left-color: rgba(128,128,128,.55); }
.admin .runner-card form { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-top: .5rem; }
.admin .runner-card input[type="text"] { font: inherit; padding: .4rem .5rem; min-width: 18rem; color-scheme: inherit; background-color: Canvas; color: CanvasText; border: 1px solid rgba(128,128,128,.5); border-radius: .3rem; }
.admin .runner-card button { width: auto; display: inline-block; margin: 0; }

/* ---- The decision queue (ADM-4). ---- */
.admin .queue-card { border: 1px solid rgba(128,128,128,.45); border-radius: .4rem; padding: .7rem .9rem; margin: .6rem 0; }
.admin .queue-card .queue-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem; margin: 0 0 .2rem; }
.admin .queue-card .queue-head h3 { margin: 0; font-size: 1rem; }
.admin .queue-card .queue-id { font-family: var(--font-jetbrains-mono), monospace; font-size: .8rem; opacity: .75; }
.admin .queue-card .queue-meta { font-size: .78rem; opacity: .7; margin: 0 0 .45rem; }
.admin .queue-card .chip { font-size: .66rem; text-transform: uppercase; letter-spacing: .05em; border: 1px solid currentColor; border-radius: .25rem; padding: 0 .35rem; opacity: .85; }
.admin .queue-card p { margin: .3rem 0; }
.admin .queue-card .options form { margin: .35rem 0 0; }
.admin .queue-card .options button { display: block; width: 100%; text-align: left; margin: .3rem 0; padding: .45rem .6rem; cursor: pointer; font: inherit; border: 1px solid rgba(128,128,128,.55); border-radius: .3rem; background: rgba(128,128,128,.08); color: inherit; }
.admin .queue-card .options button:hover { background: rgba(128,128,128,.18); }
.admin .queue-card .options button .consequence { display: block; font-size: .8rem; opacity: .75; font-weight: 400; }
.admin .queue-card .own-words textarea { width: 100%; max-width: 40rem; min-height: 3.5rem; font: inherit; padding: .45rem; color-scheme: inherit; background-color: Canvas; color: CanvasText; border: 1px solid rgba(128,128,128,.5); border-radius: .3rem; }
.admin .queue-card .own-words button { width: auto; display: inline-block; margin: .35rem 0 0; }
.admin .queue-card .decided { border: 1px solid #4c9a5a; border-radius: .3rem; padding: .45rem .6rem; margin-top: .4rem; font-size: .9rem; }
.admin .queue-card.acknowledge { opacity: .9; }
.admin .queue-card.blocked { border-style: dashed; }
.admin .queue-card details summary { cursor: pointer; font-size: .82rem; opacity: .8; }

/* ---- Cost (ADM-6): a table of numbers, gaps as one short line. ---- */
.admin table.cost td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.admin table.cost .gap { font-size: .85rem; }
.admin .cost-summary { margin: .25rem 0 .5rem; }

/* The unified console header, shared by pilot health and state readiness. */
.console-nav { position: sticky; top: 0; z-index: 20; display: flex; flex-wrap: wrap; align-items: flex-end; gap: 1rem;
  margin: 0 auto 1.25rem; max-width: 72rem; padding: .75rem 1.25rem; background: Canvas;
  border-bottom: 1px solid rgba(128,128,128,.35); }
.console-nav label { display: flex; flex-direction: column; gap: .2rem; margin: 0; font-size: .72rem;
  text-transform: uppercase; letter-spacing: .05em; opacity: .7; }
.console-nav select { font: inherit; font-size: .95rem; text-transform: none; letter-spacing: normal;
  padding: .35rem .5rem; min-width: 11rem;
  /* Dark by default; light under [data-theme="light"]. Pin the control and its
     options to the theme's own system colours so the dropdown is not a light box
     of low-contrast text on the dark console. Never rely on native <select>
     inheritance for this. */
  color-scheme: inherit; background-color: Canvas; color: CanvasText;
  border: 1px solid rgba(128,128,128,.5); border-radius: .3rem; }
.console-nav select option { background-color: Canvas; color: CanvasText; }
.console-nav-brand { margin-left: auto; align-self: center; font-size: .75rem; opacity: .5; }
/* The theme switch (ADM-9) sits at the right edge, beside the brand; it is the
   map's own button, styled by globals' .icon-btn, so one implementation serves
   both surfaces. */
.console-nav .icon-btn { align-self: center; }
/* Selection is acknowledged the moment it is made (ADM-2): the chosen value
   shows at once and this status line says what is loading while the server
   renders the new view. */
.console-nav-pending { align-self: center; font-size: .8rem; opacity: .8; }
.console-nav[aria-busy="true"] select { opacity: .7; }
/* Readiness and pilot health share the wider console frame. */
.readiness, .admin.console-page { max-width: 72rem; }
`;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      {children}
    </>
  );
}
