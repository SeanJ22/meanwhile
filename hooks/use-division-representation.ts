"use client";

import { useEffect, useState } from "react";

import type { SeatHolder } from "@/lib/officials/lookup";
import type { CoverageSummary } from "@/lib/registry/coverage";
import { representationForDivision } from "@/lib/registry/representation";

/**
 * **Who represents a division the reader is not standing in** (M112,
 * 2026-08-16).
 *
 * The shared resolver answers instantly for two cases: a legislative seat in
 * the coverage summary (which only ever holds divisions containing the
 * reader's point) and a curated local roster (committed, client-side, keyed
 * by division). Every OTHER drawn district — the twelve congressional and
 * legislative overlays a reader can click without being inside them — was
 * getting the empty array and rendering it as our gap.
 *
 * So the empty array is no longer an answer. It is a question, asked of
 * `/api/representation/<ocd-id>`, which resolves seats by the division's own
 * key. Only when THAT comes back empty is the division genuinely unsourced,
 * and only then may a surface say so.
 *
 * **`status` is the whole point.** A caller must never render a named gap
 * while this says `"looking"` — that is the render-default rule (M111) in the
 * shape it took here: a not-yet-answered question is not an absence of
 * record, and the two may not render as the same sentence.
 *
 * The `ocdId` reset is deliberate and is D40's sibling rule: a client
 * component holding fetched state MUST clear it when its key changes, or
 * district 21's members render for a moment under district 30's heading.
 */
export type RepresentationStatus = "resolved" | "looking" | "unsourced";

export interface DivisionRepresentation {
  holders: SeatHolder[];
  status: RepresentationStatus;
}

export function useDivisionRepresentation(
  coverage: CoverageSummary | null | undefined,
  ocdId: string | null,
): DivisionRepresentation {
  // What the client can answer without asking anyone.
  const local = representationForDivision(coverage, ocdId);
  const [fetched, setFetched] = useState<{
    ocdId: string;
    holders: SeatHolder[];
  } | null>(null);
  const [looking, setLooking] = useState(false);

  useEffect(() => {
    // Nothing to ask: no division, or the client already holds the answer.
    if (!ocdId || local.length > 0) {
      setLooking(false);
      return;
    }
    // The key changed — drop the previous division's people before anything
    // can render them under this division's name.
    setFetched(null);
    setLooking(true);
    const controller = new AbortController();
    // The OCD-ID is already a path; it is spelled as one so every cache keys
    // on the division rather than on a dropped query string (D40).
    const path = ocdId
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    fetch(`/api/representation/${path}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { ocdId?: string; holders?: SeatHolder[] } | null) => {
        if (controller.signal.aborted) return;
        // Bind the answer to the key it was asked for. A response that names
        // a different division is discarded rather than displayed — the
        // uniqueness invariant, held at the point of use as well as at the
        // cache.
        if (!body || body.ocdId !== ocdId) {
          setLooking(false);
          return;
        }
        setFetched({ ocdId, holders: body.holders ?? [] });
        setLooking(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLooking(false);
      });
    return () => controller.abort();
    // `local.length` rather than `local`: the resolver returns a fresh array
    // every render and the identity would restart the fetch forever.
  }, [ocdId, local.length]);

  if (local.length > 0) return { holders: local, status: "resolved" };
  if (fetched?.ocdId === ocdId && fetched.holders.length > 0) {
    return { holders: fetched.holders, status: "resolved" };
  }
  if (looking) return { holders: [], status: "looking" };
  // Answered, and the answer was nobody — or there is no division to ask
  // about, which is the same honest empty for a caller.
  if (fetched?.ocdId === ocdId || !ocdId) {
    return { holders: [], status: "unsourced" };
  }
  return { holders: [], status: "looking" };
}
