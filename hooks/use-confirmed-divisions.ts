"use client";

import { useEffect, useState } from "react";

import type { SeatHolder } from "@/lib/officials/lookup";
import type { CoverageSummary } from "@/lib/registry/coverage";
import { representationForDivision } from "@/lib/registry/representation";
import { levelKeyOf, type ResolvedLocation } from "@/lib/state/resolved-location";
import type { FederalVacancy } from "@/lib/officials/chamber-directory";

/**
 * The reader's confirmed divisions, resolved by key. `coverage.seats` is the
 * ZIP-centroid answer, so a confirmed district missing from it must be asked
 * for: `/api/representation/<ocd-id>` returns its name and people. `looking`
 * is not an absence and `unavailable` is not `unsourced`.
 */
export type DivisionStatus = "resolved" | "looking" | "unsourced" | "unavailable";

export interface ConfirmedDivision {
  readonly vacancy?: FederalVacancy;
  readonly ocdId: string;
  /** The division's own name. Null until known — never an OCD-ID, never a guess. */
  readonly label: string | null;
  readonly divisionType: string | null;
  readonly tier: string | null;
  readonly holders: readonly SeatHolder[];
  readonly status: DivisionStatus;
}

interface Answer {
  vacancy?: FederalVacancy;
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

  /* Confirmed ids at these levels that the coverage payload does not already answer. */
  const held = new Set((coverage?.seats ?? []).map((s) => s.ocdId));
  const wanted = confirmed.filter((id) => {
    if (held.has(id)) return false;
    const level = levelKeyOf(id);
    // An id whose level cannot be read names no level this section owns.
    return level !== null && divisionTypes.includes(level);
  });
  /* A stable key, so the effect re-runs only when the divisions change. */
  const key = wanted.join("|");

  const [answers, setAnswers] = useState<Record<string, Answer>>({});

  useEffect(() => {
    const ids = key ? key.split("|") : [];
    if (ids.length === 0) return;
    const controller = new AbortController();
    for (const ocdId of ids) {
      // The OCD-ID in the path, so every cache keys on the division.
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
              vacancy?: FederalVacancy;
            } | null,
          ) => {
            if (controller.signal.aborted) return;
            // An answer naming a different division is not this one's.
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
                vacancy: body.vacancy,
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
      vacancy: answer.vacancy,
      status: holders.length > 0 ? ("resolved" as const) : ("unsourced" as const),
    };
  });
}
