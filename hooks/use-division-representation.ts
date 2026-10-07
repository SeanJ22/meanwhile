"use client";

import { useEffect, useState } from "react";

import type { SeatHolder } from "@/lib/officials/lookup";
import type { CoverageSummary } from "@/lib/registry/coverage";
import { representationForDivision } from "@/lib/registry/representation";
import type { RosterReaderGap } from "@/lib/registry/body-rosters";
import { projectedRosterGapsForDivision } from "@/lib/registry/body-roster-client";

/**
 * Who represents a division the reader is not standing in. When the local
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

export function useDivisionRepresentation(
  coverage: CoverageSummary | null | undefined,
  ocdId: string | null,
): DivisionRepresentation {
  // What the client can answer without asking anyone.
  const local = representationForDivision(coverage, ocdId);
  const localCount = local.length;
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    // Nothing to ask: no division, or the client already holds the answer.
    if (!ocdId || localCount > 0) return;
    const controller = new AbortController();
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
          setAnswer({ ocdId, holders: [], failed: true });
          return;
        }
        setAnswer({ ocdId, holders: body.holders ?? [], rosterGaps: body.rosterGaps ?? [], failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAnswer({ ocdId, holders: [], failed: true });
        }
      });
    return () => controller.abort();
    // `localCount`, not `local`: the resolver returns a fresh array every render.
  }, [ocdId, localCount]);

  if (localCount > 0) return { holders: local, status: "resolved", rosterGaps: projectedRosterGapsForDivision(coverage, ocdId) };
  // No division to ask about is an empty answer, not a pending question.
  if (!ocdId) return { holders: [], status: "unsourced" };
  // Anything the previous division answered belongs to the previous division.
  if (answer?.ocdId !== ocdId) return { holders: [], status: "looking" };
  if (answer.failed) return { holders: [], status: "unavailable" };
  return {
    holders: answer.holders,
    rosterGaps: answer.rosterGaps ?? [],
    status: answer.holders.length > 0 ? "resolved" : "unsourced",
  };
}
