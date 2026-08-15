"use client";

import { useSyncExternalStore } from "react";

import { getAllPicks, subscribePicks, type StoredPick } from "@/lib/ballot/picks";
import {
  isForeignPick,
  pickJurisdictionLabel,
} from "@/lib/ballot/pick-jurisdiction";
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
 */

export function MyPicks({
  currentJurisdictionKey = null,
}: {
  /**
   * The jurisdiction of the ballot on screen, derived from its own contest
   * ids by the page. Null when the page resolved no ballot — then there is
   * nothing for a pick to differ from and nothing is labelled.
   */
  currentJurisdictionKey?: string | null;
}) {
  const raw = useSyncExternalStore(
    subscribePicks,
    () => JSON.stringify(getAllPicks()),
    () => "[]",
  );
  const picks = JSON.parse(raw) as StoredPick[];

  if (picks.length === 0) return null;

  return (
    <section className="mt-6 rounded-[10px] border border-dashed border-[var(--panel-border)] p-4">
      <h2 className="t-structure text-paper-dim">
        My picks — this device only
      </h2>
      <ul className="mt-2 space-y-1.5">
        {picks.map((pick) => {
          const foreign = isForeignPick(pick.contestId, currentJurisdictionKey);
          const where = foreign ? pickJurisdictionLabel(pick.contestId) : null;
          return (
            <li key={pick.contestId} className="text-[0.8125rem] leading-relaxed">
              <span className="text-muted">{pick.contestTitle}:</span>{" "}
              {pick.choiceIds.map((id) => pick.labels[id] ?? id).join(", ")}
              {/* The sign. Rendered only when the ballot on screen is a
                  different one, and only when we have a reader-facing name
                  for it — an internal key never reaches this line. */}
              {where && (
                <span className="ml-1.5 whitespace-nowrap text-[0.6875rem] text-voice">
                  · {where}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {/* Item 5 (2026-08-14 second session): the screenshottable card and
          the clear control — the tester's booth workflow. */}
      <PicksCardControls picks={picks} />
      {/* 3e: the full disclosure lives once at the page bottom; the header
          above already labels this box device-only. */}
      <p className="mt-2 text-[0.625rem] leading-relaxed text-muted">
        Clearing your browser&apos;s storage clears this list.
      </p>
    </section>
  );
}
