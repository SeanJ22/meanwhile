"use client";

import { useEffect, useState } from "react";

import type { SeatHolder } from "@/lib/officials/lookup";
import type { CoverageSummary } from "@/lib/registry/coverage";
import { representationForDivision } from "@/lib/registry/representation";
import type { RosterReaderGap } from "@/lib/registry/body-rosters";
import { projectedRosterGapsForDivision } from "@/lib/registry/body-roster-client";

/**
 * Who represents each requested division. When the local
 * resolver has nobody, `/api/representation/<ocd-id>` is asked by the
 * division's own key. `status`: `resolved`, `looking` (not an absence),
 * `unsourced` (asked and hold nobody) or `unavailable` (the lookup failed).
 * The answer is bound to its `ocdId` and compared on every render, so another
 * division's members never show under this heading.
 */
export type RepresentationStatus =
  | "resolved"
  | "looking"
  | "unsourced"
  | "unavailable";

export interface DivisionRepresentation {
  holders: SeatHolder[];
  status: RepresentationStatus;
  rosterGaps?: RosterReaderGap[];
}

interface Answer {
  ocdId: string;
  holders: SeatHolder[];
  /** The lookup itself failed — not an answer about the division. */
  failed: boolean;
  rosterGaps?: RosterReaderGap[];
}

export function useDivisionsRepresentation(
  coverage: CoverageSummary | null | undefined,
  ocdIds: readonly string[],
): Record<string, DivisionRepresentation> {
  const ids = [...new Set(ocdIds)];
  const local = new Map(ids.map(id => [id, representationForDivision(coverage, id)]));
  const remoteIdsKey = JSON.stringify(ids.filter(id => !local.get(id)?.length).sort());
  const [answers, setAnswers] = useState<Record<string, Answer>>({});

  useEffect(() => {
    const remoteIds = JSON.parse(remoteIdsKey) as string[];
    if (!remoteIds.length) return;
    const controller = new AbortController();
    const record = (answer: Answer) => {
      if (!controller.signal.aborted) {
        setAnswers(previous => ({ ...previous, [answer.ocdId]: answer }));
      }
    };
    for (const ocdId of remoteIds) {
      // The OCD-ID in the path, so every cache keys on the division.
      const path = ocdId
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
      fetch(`/api/representation/${path}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { ocdId?: string; holders?: SeatHolder[]; rosterGaps?: RosterReaderGap[] } | null) => {
          if (controller.signal.aborted) return;
          // A response naming a different division is not this one's answer.
          if (!body || body.ocdId !== ocdId) {
            record({ ocdId, holders: [], failed: true });
            return;
          }
          record({ ocdId, holders: body.holders ?? [], rosterGaps: body.rosterGaps ?? [], failed: false });
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            record({ ocdId, holders: [], failed: true });
          }
        });
    }
    return () => controller.abort();
  }, [remoteIdsKey]);

  return Object.fromEntries(ids.map(ocdId => {
    const holders = local.get(ocdId)!;
    if (holders.length) return [ocdId, { holders, status: "resolved", rosterGaps: projectedRosterGapsForDivision(coverage, ocdId) }];
    const answer = answers[ocdId];
    if (!answer) return [ocdId, { holders: [], status: "looking" }];
    if (answer.failed) return [ocdId, { holders: [], status: "unavailable" }];
    return [ocdId, {
      holders: answer.holders,
      rosterGaps: answer.rosterGaps ?? [],
      status: answer.holders.length ? "resolved" : "unsourced",
    }];
  }));
}
