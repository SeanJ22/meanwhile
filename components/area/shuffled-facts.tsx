"use client";

import { useState, useSyncExternalStore } from "react";

import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import type { AreaFact } from "@/lib/area/facts";

/**
 * "Has this hydrated yet?" without setting state in an effect.
 *
 * `useSyncExternalStore` is the sanctioned shape for a value that differs
 * between server and client: the server snapshot is `false`, the client
 * snapshot is `true`, and React switches between them as part of hydration
 * rather than as a cascading render an effect kicked off. The store never
 * changes, so `subscribe` has nothing to do.
 */
const noSubscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * The moving-here questions, in a different order every time (6g,
 * 2026-08-15, the author: "marijuana shouldn't lead every time").
 *
 * ## Why this is a real fix and not a gimmick
 *
 * The list order was the authoring order, and the authoring order put
 * marijuana first in all three states. Nothing about that was a judgement —
 * and that is exactly the problem: a page that opens on the same charged
 * question every time reads as an editorial choice, on a product whose
 * entire claim is that it does not make them. The content is untouched; only
 * which honest answer a reader happens to see first changes.
 *
 * ## Why it shuffles on the CLIENT, after mount
 *
 * A server-side shuffle would render one order into the HTML and a different
 * one on hydration — a mismatch React would (rightly) complain about, and
 * worse, a shuffle baked into a cacheable response would be the SAME "random"
 * order for everyone until the cache turned over, which is not a shuffle at
 * all. So the server renders the authoring order, and the first client pass
 * permutes it. A reader with JavaScript off gets the full list in a fixed
 * order, which is a fine page.
 *
 * Nothing is stored and nothing is sent: the permutation lives in this
 * component's state for as long as the page is open.
 *
 * ## Why the CARD is in here (fixed 2026-08-16, g3 item 2)
 *
 * This component used to take a render prop — `children(fact)` — so the card
 * markup could stay in the page. **A function cannot cross the server/client
 * boundary.** React refuses it outright ("Functions are not valid as a child
 * of Client Components"), and since the whole page is a Server Component, the
 * refusal was a 500: `/about-area?zip=…` answered HTTP 500 at every zip on
 * production, and `?state=…` with it. Only the zip-with-no-coverage path —
 * which renders no facts and therefore never constructs this element — stayed
 * green, which is why the route looked half-alive.
 *
 * The card is plain presentational markup over serializable data, so it lives
 * here now and nothing crosses the boundary but the facts themselves. A page
 * that wants a different card gets a prop with a discriminated value, never a
 * function.
 */
export function ShuffledFacts({ facts }: { facts: AreaFact[] }) {
  /*
   * The permutation is computed once, lazily; hydration is what switches to
   * it. Deliberately NOT `setState` inside an effect — that cascades a
   * render and the lint rule is right to catch it.
   */
  const hydrated = useSyncExternalStore(noSubscribe, onClient, onServer);
  const [order] = useState<AreaFact[]>(() => {
    // Fisher–Yates, on a copy. Computed once per mount, which is once per open.
    const next = [...facts];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
  });

  return (
    <>
      {(hydrated ? order : facts).map((fact) => (
        <section
          key={fact.topic}
          className="mt-4 rounded border border-[var(--panel-border)] p-4"
        >
          <h2 className="t-body font-semibold">{fact.question}</h2>
          <p className="mt-1.5 t-body leading-relaxed text-paper-dim">
            {fact.answer}
          </p>
          <CardSourcesContribution id={`area-fact:${fact.topic}`} sources={[{ what: fact.question, provenance: { sourceUrl: fact.sourceUrl, sourceOrg: fact.sourceOrg, collectedAt: fact.verification.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "", verifiedAt: null } }]} />
        </section>
      ))}
    </>
  );
}
