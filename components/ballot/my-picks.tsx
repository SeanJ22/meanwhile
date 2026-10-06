"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  getAllPicks,
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
import { PicksCardControls } from "@/components/ballot/picks-card";

/**
 * The election-day reference (4a): everything this device has marked,
 * grouped by contest. Renders nothing until at least one pick exists — an
 * empty "My picks" box would be furniture.
 *
 * 4c (2026-08-15): a pick made on a DIFFERENT ballot says so. Viewing New
 * Hampshire with Arizona picks stored listed both without a sign, and a list
 * headed "My picks" under New Hampshire's contests reads as New Hampshire's.
 * Keeping the picks is right — they are the reader's private note and
 * deleting them for looking at another state would lose deliberate work — so
 * what was missing was the label, not the behaviour. Device-local rendering
 * only; nothing about the store changed.
 *
 * **F01-continued item 8: it counted half the ballot.** This list read the
 * explicit picks file alone, and a candidate pick can be DERIVED from a Yes
 * on the reaction control above (M134) — so measures, which have no
 * measure-level reaction to derive from, were always counted and candidates
 * often were not. The reader's own ballot was undercounting the reader's own
 * ballot. It resolves through `lib/ballot/pick-tally.ts` now, the same path
 * the per-contest control resolves through, and it states N of M so the
 * number is checkable against the page it sits on.
 */
export function MyPicks({
  currentJurisdictionKey = null,
  pickable = [],
}: {
  /**
   * The jurisdiction of the ballot on screen, derived from its own contest
   * ids by the page. Null when the page resolved no ballot — then there is
   * nothing for a pick to differ from and nothing is labelled.
   */
  currentJurisdictionKey?: string | null;
  /**
   * Every contest on this page that renders a pick control, built by the
   * page's own `pickOptionsFor`. This is the tally's denominator, and it is
   * the rendered rows rather than a second opinion about them.
   */
  pickable?: PickableContest[];
}) {
  const raw = useSyncExternalStore(
    subscribePicks,
    () => JSON.stringify({ picks: getAllPicks(), cleared: getSuppressedDerived() }),
    () => JSON.stringify({ picks: [], cleared: {} }),
  );
  const { picks, cleared } = JSON.parse(raw) as {
    picks: StoredPick[];
    cleared: Record<string, string[]>;
  };

  /*
   * The device's own Yes answers, read exactly as the pick control reads
   * them: through `useSyncExternalStore` and NOT during a bare render, so
   * the server snapshot is "nothing answered" and the client replaces it in
   * the same commit rather than after one. A bare localStorage read here is
   * a hydration mismatch.
   *
   * The snapshot is JSON rather than a joined string, and that is not taste:
   * both pick surfaces used to join on a LITERAL NUL, which makes ripgrep
   * classify the source file as binary and SKIP it in every class sweep. A
   * file no sweep can see, on the ballot surface, is how a defect survives a
   * sweep that reports finding nothing.
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

  const tally = tallyPicks(pickable, picks, yesTargets, cleared);

  // Unchanged rule: nothing renders until something is marked. The count
  // line arrives with the first pick rather than sitting at zero, because
  // "0 of 14" on a ballot nobody has touched is the furniture this box has
  // always refused to be.
  if (tally.rows.length === 0 && tally.foreign.length === 0) return null;

  /*
   * The card and the clear both act on the RESOLVED set, not the stored one.
   * A derived pick is as much the reader's pick as a tapped one — the race
   * states it as theirs — so it belongs on the card they screenshot and it
   * has to go when they clear.
   */
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
      {/*
        The count. `data-pick-tally` carries both numbers so `walk:all` can
        assert the denominator against the pick controls it can actually count
        on the page — a tally whose M nobody checks is how this one drifted
        away from its own ballot in the first place.
      */}
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
            {/* Where it came from, when the reader did not tap it here. The
                same reason the control says it: a mark somebody does not
                remember making is worse than none. */}
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
              {/* The sign. Rendered only when the ballot on screen is a
                  different one, and only when we have a reader-facing name
                  for it — an internal key never reaches this line. */}
              {where && (
                <span className="ml-1.5 whitespace-nowrap t-caption text-voice">
                  · {where}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {/* Item 5 (2026-08-14 second session): the screenshottable card and
          the clear control — the tester's booth workflow. */}
      <PicksCardControls
        picks={cardPicks}
        pickable={pickable}
        yesTargets={yesTargets}
        cleared={cleared}
      />
      {/* 3e: the full disclosure lives once at the page bottom; the header
          above already labels this box device-only. */}
      <p className="mt-2 t-caption leading-relaxed text-muted">
        Clearing your browser&apos;s storage clears this list.
      </p>
    </section>
  );
}
