"use client";

import { useEffect, useState } from "react";

import type { SeatHolder } from "@/lib/officials/lookup";
import type { CoverageSummary } from "@/lib/registry/coverage";
import { representationForDivision } from "@/lib/registry/representation";
import { rosterGapsForDivision, type RosterReaderGap } from "@/lib/registry/body-rosters";

/**
 * **Who represents a division the reader is not standing in** (M112,
 * 2026-08-16).
 *
 * The shared resolver answers instantly for two cases: a legislative seat in
 * the coverage summary (which only ever holds divisions containing the
 * reader's point) and a curated local roster (committed, client-side, keyed
 * by division). Every OTHER drawn district — the congressional and
 * legislative overlays a reader can click without being inside them — was
 * getting the empty array and rendering it as our gap.
 *
 * So the empty array is no longer an answer. It is a question, asked of
 * `/api/representation/<ocd-id>`, which resolves seats by the division's own
 * key. Only when THAT comes back empty is the division genuinely unsourced,
 * and only then may a surface say so.
 *
 * **`status` is the whole point**, and it has four values because there are
 * four different truths and the render-default rule (M111) forbids collapsing
 * them into one sentence:
 *
 * - `resolved` — we hold these people.
 * - `looking` — we have not finished asking. NOT an absence.
 * - `unsourced` — we asked by the division's own key and hold nobody. Ours.
 * - `unavailable` — the lookup failed. Also ours, and a DIFFERENT fact from
 *   holding nobody; a network failure that rendered as "no sourced
 *   officeholder" would be the original defect wearing a new cause.
 *
 * The answer is bound to the `ocdId` it was asked for and compared on every
 * render rather than cleared by an effect. That is D40's sibling rule — a
 * client component holding fetched state must not let it survive a key change
 * — held structurally, so district 21's members can never render for a frame
 * under district 30's heading.
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
    // The OCD-ID is already a path; it is spelled as one so every cache keys
    // on the division rather than on a dropped query string (D40).
    const path = ocdId
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    fetch(`/api/representation/${path}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { ocdId?: string; holders?: SeatHolder[]; rosterGaps?: RosterReaderGap[] } | null) => {
        if (controller.signal.aborted) return;
        // Bind the answer to the key it was asked for. A response naming a
        // different division is not this division's answer — the uniqueness
        // invariant held at the point of use as well as at the cache.
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
    // `localCount` rather than `local`: the resolver returns a fresh array
    // every render and the identity would restart the fetch forever.
  }, [ocdId, localCount]);

  if (localCount > 0) return { holders: local, status: "resolved", rosterGaps: rosterGapsForDivision(ocdId) };
  // No division to ask about is an honest empty for a caller, not a pending
  // question.
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
