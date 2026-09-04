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
