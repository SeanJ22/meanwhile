"use client";

import { useState, useSyncExternalStore } from "react";

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
 */
export function ShuffledFacts({
  facts,
  children,
}: {
  facts: AreaFact[];
  /** Renders one fact. The card's markup stays in the page. */
  children: (fact: AreaFact) => React.ReactNode;
}) {
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

  return <>{(hydrated ? order : facts).map((fact) => children(fact))}</>;
}
