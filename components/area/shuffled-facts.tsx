"use client";

import { useState, useSyncExternalStore } from "react";

import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import type { AreaFact } from "@/lib/area/facts";

/** Hydration flag via `useSyncExternalStore`: server snapshot false, client true. */
const noSubscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * Area facts in a fresh random order per mount. The shuffle runs on the client
 * after hydration so server HTML and cached responses keep the authoring order.
 * The card markup lives here because a render function cannot cross the
 * server/client boundary.
 */
export function ShuffledFacts({ facts }: { facts: AreaFact[] }) {
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
