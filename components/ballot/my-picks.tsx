"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  getAllPicks,
  getUnsure,
  getSuppressedDerived,
  subscribePicks,
  type StoredPick,
} from "@/lib/ballot/picks";
import {
  tallyPicks,
  tallyLine,
  type PickableContest,
} from "@/lib/ballot/pick-tally";
import {
  isForeignPick,
  pickJurisdictionLabel,
} from "@/lib/ballot/pick-jurisdiction";
import { getStoredReaction, subscribeReactions } from "@/lib/reactions/client";
import { useSessionAddressScope } from "@/hooks/use-session-address";
import { PicksCardControls } from "@/components/ballot/picks-card";

/**
 * Everything this device has marked, grouped by contest, with N of M picked.
 * Renders nothing until a pick exists. Picks from a different ballot are
 * labelled. Resolves through `lib/ballot/pick-tally.ts`, as the per-contest
 * control does, so derived picks count.
 */
export function MyPicks({
  currentJurisdictionKey = null,
  pickable = [],
  zip = null,
}: {
  zip?: string | null;
  /** The ballot on screen's jurisdiction; null labels nothing. */
  currentJurisdictionKey?: string | null;
  /** Every contest on this page with a pick control; the tally's denominator. */
  pickable?: PickableContest[];
}) {
  const scope = useSessionAddressScope(zip);
  const excluded = new Set(scope?.excludedContestIds ?? []);
  pickable = pickable.filter(contest => !excluded.has(contest.contestId));
  const raw = useSyncExternalStore(
    subscribePicks,
    () => JSON.stringify({ picks: getAllPicks(), cleared: getSuppressedDerived(), unsure: getUnsure() }),
    () => JSON.stringify({ picks: [], cleared: {}, unsure: {} }),
  );
  const { picks, cleared, unsure } = JSON.parse(raw) as {
    picks: StoredPick[];
    cleared: Record<string, string[]>;
    unsure: Record<string, true>;
  };

  /*
   * Read through `useSyncExternalStore`, never in a bare render, to avoid a
   * hydration mismatch. The snapshot is JSON: a NUL-joined string makes
   * ripgrep treat the file as binary.
   */
  const yesKey = useSyncExternalStore(
    subscribeReactions,
    useCallback(
      () =>
        JSON.stringify(
          pickable
            .flatMap((c) => c.options)
            .filter(
              (o) =>
                o.reactionTargetId &&
                getStoredReaction("CANDIDATE", o.reactionTargetId) === "YES",
            )
            .map((o) => o.reactionTargetId as string)
            .sort(),
        ),
      [pickable],
    ),
    () => "[]",
  );
  const yesTargets = new Set(JSON.parse(yesKey) as string[]);

  const tally = tallyPicks(pickable, picks.filter(pick => !excluded.has(pick.contestId)), yesTargets, cleared, unsure);

  if (tally.rows.length === 0 && tally.foreign.length === 0) return null;

  /* The card and the clear act on the resolved set, derived picks included. */
  const cardPicks: StoredPick[] = [
    ...tally.rows.map((row) => ({
      contestId: row.contestId,
      contestTitle: row.contestTitle,
      choiceIds: row.chosen,
      labels: Object.fromEntries(row.chosen.map((label) => [label, label])),
    })),
    ...tally.foreign,
  ];

  return (
    <section className="mt-6 rounded-[10px] border border-dashed border-[var(--panel-border)] p-4">
      <h2 className="t-structure text-paper-dim">
        My picks
      </h2>
      {/* `data-pick-tally` carries both numbers so walks can check the denominator. */}
      {pickable.length > 0 && (
        <p
          data-pick-tally
          data-picked={tally.picked}
          data-pickable={tally.pickable}
          className="mt-1 t-detail leading-relaxed text-voice"
        >
          You&apos;ve picked in {tallyLine(tally)}.
        </p>
      )}
      <ul className="mt-2 space-y-1.5">
        {tally.rows.map((row) => (
          <li key={row.contestId} className="t-body leading-relaxed">
            <span className="text-muted">{row.contestTitle}:</span>{" "}
            {row.chosen.join(", ")}
            {row.basis === "DERIVED" && (
              <span className="ml-1.5 whitespace-nowrap t-caption text-voice">
                · from your answer above
              </span>
            )}
          </li>
        ))}
        {tally.foreign.map((pick) => {
          const foreign = isForeignPick(pick.contestId, currentJurisdictionKey);
          const where = foreign ? pickJurisdictionLabel(pick.contestId) : null;
          return (
            <li key={pick.contestId} className="t-body leading-relaxed">
              <span className="text-muted">{pick.contestTitle}:</span>{" "}
              {pick.choiceIds.map((id) => pick.labels[id] ?? id).join(", ")}
              {/* Only when the ballot on screen differs and we have a reader-facing name for it. */}
              {where && (
                <span className="ml-1.5 whitespace-nowrap t-caption text-voice">
                  · {where}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <PicksCardControls
        picks={cardPicks}
        pickable={pickable}
        yesTargets={yesTargets}
        cleared={cleared}
      />
      <p className="mt-2 t-caption leading-relaxed text-muted">
        Clearing your browser&apos;s storage clears this list.
      </p>
    </section>
  );
}
