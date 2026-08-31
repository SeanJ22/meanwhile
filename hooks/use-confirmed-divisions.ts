"use client";

import { useEffect, useState } from "react";

import type { SeatHolder } from "@/lib/officials/lookup";
import type { CoverageSummary } from "@/lib/registry/coverage";
import { representationForDivision } from "@/lib/registry/representation";
import { levelKeyOf, type ResolvedLocation } from "@/lib/state/resolved-location";

/**
 * **THE READER'S OWN DIVISIONS, RESOLVED BY KEY.** (WGH-22, 2026-08-31.)
 *
 * ## The measurement that made this necessary
 *
 * `panelSeatsFor` was written on 2026-08-30 to add the reader's confirmed
 * districts to the panel by reaching `coverage.divisions`. Driven against
 * production at 85641 with the owner's own address confirmed, it added
 * nothing: State House 17 and State Senate 17 were absent from the panel
 * entirely, and the State section rendered EMPTIER than the wrong answer it
 * replaced.
 *
 * The reason is structural and it is provable from one line of
 * `summarizeCoverage`:
 *
 * ```
 *   const seats = divisions.filter((d) => SEAT_TYPES.has(d.divisionType))
 * ```
 *
 * `coverage.seats` IS `coverage.divisions` at the seat levels. They are one
 * point-in-polygon answer at the ZIP centroid, carried twice. So a district
 * missing from `seats` is missing from `divisions` by construction, and the
 * fix's second half could never fire at any ZIP, for any reader. It passed its
 * unit test because the fixture hand-built a `CoverageSummary` whose
 * `divisions` carried District 17 while its `seats` did not — a shape the
 * production derivation cannot emit. `tests/panel-seats.test.ts` now asserts
 * that impossibility directly instead of depending on it.
 *
 * ## So the answer is asked for, by the division's own key
 *
 * The client already holds the confirmed division ids — they are on the device
 * and nothing about them reaches the server as reader data. What it does not
 * hold is the division's NAME or its people, and `CLAUDE.md` forbids printing
 * an OCD-ID at a reader. `/api/representation/<ocd-id>` answers both from the
 * committed registry, keyed by the division rather than by where the reader
 * is, which is the same route the district battlecard has used since M112.
 *
 * ## The four statuses are the whole point, again
 *
 * `looking` is not an absence and `unavailable` is not `unsourced`. A district
 * the reader IS in whose people we are still fetching must never render as a
 * district with no members — that is the render-default rule broken by a
 * timing gap, and it is how a correct answer becomes a false claim about a
 * government.
 */
export type DivisionStatus = "resolved" | "looking" | "unsourced" | "unavailable";

export interface ConfirmedDivision {
  readonly ocdId: string;
  /** The division's own name. Null until known — never an OCD-ID, never a guess. */
  readonly label: string | null;
  readonly divisionType: string | null;
  readonly tier: string | null;
  readonly holders: readonly SeatHolder[];
  readonly status: DivisionStatus;
}

interface Answer {
  label: string | null;
  divisionType: string | null;
  tier: string | null;
  holders: SeatHolder[];
  failed: boolean;
}

/**
 * Ask for every confirmed division at the given levels that the ZIP-scoped
 * coverage payload does not already answer.
 *
 * `divisionTypes` is passed rather than inferred so one panel section asks only
 * about its own levels: the State section must not fetch the reader's county.
 */
export function useConfirmedDivisions(
  coverage: CoverageSummary | null | undefined,
  location: ResolvedLocation,
  divisionTypes: readonly string[],
): readonly ConfirmedDivision[] {
  const confirmed =
    location.certainty === "ADDRESS_RESOLVED" ? location.confirmedDivisionIds : [];

  /*
   * The ids this hook is responsible for: confirmed, at these levels, and NOT
   * already carried by the coverage payload. A division the payload answers is
   * answered instantly and never becomes a request.
   */
  const held = new Set((coverage?.seats ?? []).map((s) => s.ocdId));
  const wanted = confirmed.filter((id) => {
    if (held.has(id)) return false;
    const level = levelKeyOf(id);
    // An id whose level cannot be read names no level this section owns.
    return level !== null && divisionTypes.includes(level);
  });
  /* A stable key, so the effect re-runs on a CHANGE of divisions rather than
     on every render — the same identity discipline `useDivisionRepresentation`
     keeps with `localCount`. */
  const key = wanted.join("|");

  const [answers, setAnswers] = useState<Record<string, Answer>>({});

  useEffect(() => {
    const ids = key ? key.split("|") : [];
    if (ids.length === 0) return;
    const controller = new AbortController();
    for (const ocdId of ids) {
      // The OCD-ID is already a path; spelled as one so every cache keys on
      // the division rather than on a query string a CDN may drop (D40).
      const path = ocdId
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
      fetch(`/api/representation/${path}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then(
          (
            body: {
              ocdId?: string;
              label?: string | null;
              divisionType?: string | null;
              tier?: string | null;
              holders?: SeatHolder[];
            } | null,
          ) => {
            if (controller.signal.aborted) return;
            // An answer naming a different division is not this division's
            // answer. Bound at the point of use, never assumed by arrival order.
            if (!body || body.ocdId !== ocdId) {
              setAnswers((prev) => ({
                ...prev,
                [ocdId]: {
                  label: null,
                  divisionType: null,
                  tier: null,
                  holders: [],
                  failed: true,
                },
              }));
              return;
            }
            setAnswers((prev) => ({
              ...prev,
              [ocdId]: {
                label: body.label ?? null,
                divisionType: body.divisionType ?? null,
                tier: body.tier ?? null,
                holders: body.holders ?? [],
                failed: false,
              },
            }));
          },
        )
        .catch(() => {
          if (controller.signal.aborted) return;
          setAnswers((prev) => ({
            ...prev,
            [ocdId]: {
              label: null,
              divisionType: null,
              tier: null,
              holders: [],
              failed: true,
            },
          }));
        });
    }
    return () => controller.abort();
  }, [key]);

  return wanted.map((ocdId) => {
    const local = representationForDivision(coverage, ocdId);
    const answer = answers[ocdId];
    if (!answer) {
      return {
        ocdId,
        label: null,
        divisionType: levelKeyOf(ocdId),
        tier: null,
        holders: local,
        status: "looking" as const,
      };
    }
    if (answer.failed) {
      return {
        ocdId,
        label: null,
        divisionType: levelKeyOf(ocdId),
        tier: null,
        holders: [],
        status: "unavailable" as const,
      };
    }
    const holders = answer.holders.length > 0 ? answer.holders : local;
    return {
      ocdId,
      label: answer.label,
      divisionType: answer.divisionType ?? levelKeyOf(ocdId),
      tier: answer.tier,
      holders,
      status: holders.length > 0 ? ("resolved" as const) : ("unsourced" as const),
    };
  });
}
