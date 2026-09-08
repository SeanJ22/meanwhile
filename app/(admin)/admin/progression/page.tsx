/**
 * **PROGRESSION — A WORKBENCH, DELIBERATELY EMPTY.** (ADM-59, the 9.7.26 admin
 * feedback.)
 *
 * The owner, verbatim:
 *
 * > *"On the dropdown I want a Progression tab, just a staging page for now,
 * > because I want to put a mind map and whatnot in there. I do want a
 * > progression on just the overall company and business and also, like I said,
 * > a mind map of different things that we need to work through. Again I just
 * > want that place right now so I can build and work through it."*
 *
 * And the master directive, in as many words: **do not build another
 * tracker/scoring system.**
 *
 * ## Why this page renders no numbers at all
 *
 * Every other console surface reads the control plane and audits its own
 * figures before rendering. This one reads nothing, and that is the feature.
 * A staging page that invented a progress bar would be exactly the tracker the
 * directive forbids, and it would be a *second* authority beside the one the
 * tracker stores already hold — the thing the Pilot Health brief's section 6
 * bans for the changelog and which is no more allowed here.
 *
 * So there are no counts, no denominators and no self-audit obligation,
 * because there is nothing to audit. When the owner puts real content here it
 * will bring its own source, and the audit comes with it.
 *
 * ## An empty page that is not a broken page
 *
 * §15 and the rendering-neutrality policy: a surface never renders a blank and
 * never renders a zero, and it never announces its own failure. An empty
 * workbench is not a gap in the data — nobody is missing anything, and no
 * collection has failed. It is a STANDING DECISION, and it says so. That is
 * why the copy below states what the page is for and who fills it, rather than
 * apologising for having nothing on it.
 *
 * Reachable only on the admin host with a valid session, both enforced upstream
 * in `middleware.ts` before this component is invoked.
 */

import Link from "next/link";

import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";

import { ConsoleNav } from "../../console-nav.tsx";

/**
 * Never statically rendered, for the same reason as every other console page:
 * this is the admin host and its output depends on a cookie.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ProgressionPage() {
  return (
    <main className="admin console-page">
      <ConsoleNav view="progression" currentState={null} states={US_STATES} />
      <h1>Progression</h1>
      <p className="plain">
        A workbench for where the company and the product are going. It is empty because nothing has been put
        here yet, and it stays empty until you put something in it — this page reads no records and keeps no
        score of its own.
      </p>

      <h2>What this is for</h2>
      <p className="plain">
        Two things you asked for: the progression of the business as a whole, and a map of the things still to
        work through. Both are yours to shape. The page is the place, not the plan.
      </p>

      <h2>What this is deliberately not</h2>
      <p className="plain">
        It is not a second tracker. Work that is already owed lives on the decision queue and the work queue,
        and it is counted there once. A progress figure invented on this page would be a second answer to a
        question that already has one, and the two would disagree the first time either moved.
      </p>

      <h2>Where the real counts live</h2>
      <ul>
        <li>
          <a href="/admin">Pilot health</a> — what is proven, what changed, and what the fleet is doing.
        </li>
        <li>
          <a href="/admin/research">Research detail</a> — every attempt and the numbers behind the fleet.
        </li>
        <li>
          {/* A dynamic route, so it goes through next/link — the two static
              admin paths above are plain anchors, as everywhere else here. */}
          <Link href="/readiness/az">State readiness</Link> — what is served to readers, holding by holding.
        </li>
      </ul>
    </main>
  );
}
