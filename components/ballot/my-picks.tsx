"use client";

import { useSyncExternalStore } from "react";

import { getAllPicks, subscribePicks } from "@/lib/ballot/picks";

/**
 * The election-day reference (4a): everything this device has marked,
 * grouped by contest. Renders nothing until at least one pick exists — an
 * empty "My picks" box would be furniture.
 */

export function MyPicks() {
  const raw = useSyncExternalStore(
    subscribePicks,
    () => JSON.stringify(getAllPicks()),
    () => "[]",
  );
  const picks = JSON.parse(raw) as {
    contestId: string;
    contestTitle: string;
    choiceIds: string[];
    labels: Record<string, string>;
  }[];

  if (picks.length === 0) return null;

  return (
    <section className="mt-6 rounded border border-dashed border-[var(--panel-border)] p-4">
      <h2 className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted">
        My picks — this device only
      </h2>
      <ul className="mt-2 space-y-1.5">
        {picks.map((pick) => (
          <li key={pick.contestId} className="text-[0.8125rem] leading-relaxed">
            <span className="text-muted">{pick.contestTitle}:</span>{" "}
            {pick.choiceIds.map((id) => pick.labels[id] ?? id).join(", ")}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[0.625rem] leading-relaxed text-muted">
        Saved on this device only — never sent anywhere. Clearing your
        browser&apos;s storage clears this list.
      </p>
    </section>
  );
}
