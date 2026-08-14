"use client";

import { relativeAge, type SnapshotStatus } from "@/lib/meetings/freshness";

/**
 * The snapshot's age, on screen — "Last checked 3 hours ago" — plus which
 * sources the last refresh could not reach.
 *
 * Always rendered when the snapshot serves the map, not only on the empty
 * tiers: a map full of pins from a two-day-old snapshot is exactly the case
 * where the age is least suspected and most needs stating. Meetings are
 * posted days ahead, so hours of staleness is normal and the line reads as
 * reassurance; days of staleness reads as the warning it is.
 */
export function DataFreshness({ snapshot }: { snapshot: SnapshotStatus }) {
  const failed = snapshot.failed;
  const when = new Date(Date.parse(snapshot.generatedAt));

  // A footnote, not a headline (3): provenance matters, but "who governs
  // here" gets the visible position. No panel chrome — quiet small text at
  // the bottom of the stack. A failed source still speaks in signal color.
  return (
    <p className="pointer-events-auto max-w-md text-[0.625rem] leading-relaxed text-muted">
      <span className="font-mono text-[0.5625rem] uppercase tracking-[0.15em]">
        Last checked
      </span>{" "}
      <time dateTime={snapshot.generatedAt} title={when.toLocaleString()}>
        {relativeAge(snapshot.generatedAt)}
      </time>
      {failed.length > 0 && (
        <>
          {" · "}
          <span className="text-signal">
            couldn&apos;t reach {failed.map((f) => f.source).join(", ")} — some
            calendars may be missing
          </span>
        </>
      )}
    </p>
  );
}
