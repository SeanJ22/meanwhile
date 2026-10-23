"use client";

import {
  carriedListingsDisclosure,
  relativeAge,
  type SnapshotCarriedNote,
  type SnapshotStatus,
} from "@/lib/meetings/freshness";

/**
 * The snapshot's age ("Last checked 3 hours ago"), always shown when the
 * snapshot serves the map. Every sentence past the age comes from
 * `freshnessDisclosure` in `lib/meetings/freshness.ts`.
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
  // A carried-forward row does not inherit the snapshot's freshness; it states its own.
  const carried = snapshot.carried;

  return (
    <p className="pointer-events-auto max-w-md t-caption leading-relaxed text-muted">
      <span className="trailing-space-trimmed-15 font-mono t-caption  tracking-[0.15em]">
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
