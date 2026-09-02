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
.admin .state-unknown { opacity: .75; font-weight: 600; }
.admin .card { border: 1px solid rgba(128,128,128,.45); border-radius: .4rem; padding: .75rem 1rem; margin: .75rem 0; }
.admin .card button { display: block; width: 100%; text-align: left; margin: .35rem 0; padding: .5rem .6rem; cursor: pointer; }
.admin form { margin-top: .5rem; }
.admin label { display: block; margin: .5rem 0; }
.admin input[type="password"] { width: 100%; max-width: 28rem; padding: .5rem; font: inherit; }
`;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      {children}
    </>
  );
}
