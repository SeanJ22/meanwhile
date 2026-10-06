"use client";

import {
  carriedListingsDisclosure,
  relativeAge,
  type SnapshotCarriedNote,
  type SnapshotStatus,
} from "@/lib/meetings/freshness";

/**
 * The snapshot's age, on screen — "Last checked 3 hours ago" — plus which
 * sources the last refresh could not reach.
 *
 * Always rendered when the snapshot serves the map, not only on the empty
 * tiers: a map full of pins from a two-day-old snapshot is exactly the case
 * where the age is least suspected and most needs stating. Meetings are
 * posted days ahead, so hours of staleness is normal and the line reads as
 * reassurance; days of staleness reads as the warning it is.
 *
 * RLC-1 (2026-09-05): every sentence past the age comes from
 * `freshnessDisclosure` in `lib/meetings/freshness.ts`, the same contract the
 * final rendered Reader proof requires of this footer. The prose lives there
 * once; this file renders it and holds no copy.
 */
export function DataFreshness({
  snapshot,
  compact = false,
}: {
  snapshot: SnapshotStatus;
  /** The one-line "Checked … ago" form on the About this data header. */
  compact?: boolean;
}) {
  const when = new Date(Date.parse(snapshot.generatedAt));
  if (compact) {
    return (
      <>
        Checked{" "}
        <time dateTime={snapshot.generatedAt} title={when.toLocaleString()}>
          {relativeAge(snapshot.generatedAt)}
        </time>
      </>
    );
  }
  // hotfix-0817 (2026-08-17): "Last checked 6 hours ago" is true of the rows this
  // refresh fetched and FALSE of the rows it carried forward from the
  // previous one because a source refused. A carried row does not inherit the
  // snapshot's freshness — it states its own, here in the count and on each
  // row's own card.
  const carried = snapshot.carried;

  // A footnote, not a headline (3): provenance matters, but "who governs
  // here" gets the visible position. No panel chrome — quiet small text at
  // the bottom of the stack.
  //
  // The per-source unreachable line is gone (2026-09-14): it joined raw adapter
  // ids, unscoped to the reader's area, which is an internal id on a reader
  // surface. Which of a reader's OWN bodies could not be refreshed now reads on
  // that body's row in the who-governs card, in plain language. The footer keeps
  // its age and, when a run carried listings forward, that.
  return (
    <p className="pointer-events-auto max-w-md t-caption leading-relaxed text-muted">
      <span className="trailing-space-trimmed-15 font-mono t-caption uppercase tracking-[0.15em]">
        Last checked
      </span>{" "}
      <time dateTime={snapshot.generatedAt} title={when.toLocaleString()}>
        {relativeAge(snapshot.generatedAt)}
      </time>
      {carried && carried.count > 0 && (
        <CarriedListingsLine carried={carried} />
      )}
    </p>
  );
}

/**
 * The carried-rows sentence, behind the parent's gate. The `<time>` is the one
 * piece the contract cannot carry as text, so it is interleaved here around
 * the words the contract supplies.
 */
function CarriedListingsLine({ carried }: { carried: SnapshotCarriedNote }) {
  const line = carriedListingsDisclosure(carried);
  return (
    <>
      {" · "}
      {line.lead}{" "}
      {line.form === "REACHED_TOGETHER" && line.lastFreshAt ? (
        <>
          {line.reached}{" "}
          <time
            dateTime={line.lastFreshAt}
            title={new Date(Date.parse(line.lastFreshAt)).toLocaleString()}
          >
            {relativeAge(line.lastFreshAt)}
          </time>
        </>
      ) : (
        // The rows disagree on when they were last reached, so no single
        // date is true of all of them. Each card states its own.
        line.reached
      )}
    </>
  );
}
