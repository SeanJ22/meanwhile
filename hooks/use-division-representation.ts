"use client";

import { useEffect, useState } from "react";

import type { SeatHolder } from "@/lib/officials/lookup";
import type { CoverageSummary } from "@/lib/registry/coverage";
import { representationForDivision } from "@/lib/registry/representation";
import type { RosterReaderGap } from "@/lib/registry/body-rosters";
import { projectedRosterGapsForDivision } from "@/lib/registry/body-roster-client";
import { getCachedStateDivision, isStateDivisionPending } from "@/lib/reader/client";
import type { FederalVacancy } from "@/lib/officials/chamber-directory";

export type RepresentationStatus =
  | "resolved"
  | "looking"
  | "unsourced"
  | "unavailable";

export interface DivisionRepresentation {
  vacancy?: FederalVacancy;
  holders: SeatHolder[];
  status: RepresentationStatus;
  rosterGaps?: RosterReaderGap[];
}

interface Answer {
  vacancy?: FederalVacancy;
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
  const cached = new Map(ids.map(id => [id, getCachedStateDivision(id)]));
  const vacancies = new Map(ids.map(id => [id, cached.get(id)?.vacancy ?? coverage?.seats.find(seat => seat.ocdId === id)?.vacancy]));
  const local = new Map(ids.map(id => {
    const holders = representationForDivision(coverage, id);
    return [id, holders.length ? holders : cached.get(id)?.holders ?? holders];
  }));
  const remoteIdsKey = JSON.stringify(ids.filter(id => !local.get(id)?.length && !vacancies.get(id) && !cached.get(id) && !isStateDivisionPending(id)).sort());
  const [answers, setAnswers] = useState<{ key: string; values: Record<string, Answer> }>({ key: remoteIdsKey, values: {} });
  if (answers.key !== remoteIdsKey) setAnswers({ key: remoteIdsKey, values: {} });

  useEffect(() => {
    const remoteIds = JSON.parse(remoteIdsKey) as string[];
    if (!remoteIds.length) return;
    const controller = new AbortController();
    const record = (answer: Answer) => {
      if (!controller.signal.aborted) {
        setAnswers(previous => ({ key: remoteIdsKey, values: {
          ...(previous.key === remoteIdsKey ? previous.values : {}), [answer.ocdId]: answer,
        } }));
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
        .then((body: { ocdId?: string; holders?: SeatHolder[]; rosterGaps?: RosterReaderGap[]; vacancy?: FederalVacancy } | null) => {
          if (controller.signal.aborted) return;
          // A response naming a different division is not this one's answer.
          if (!body || body.ocdId !== ocdId) {
            record({ ocdId, holders: [], failed: true });
            return;
          }
          record({ ocdId, holders: body.holders ?? [], rosterGaps: body.rosterGaps ?? [], vacancy: body.vacancy, failed: false });
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
    const cachedAnswer = cached.get(ocdId);
    if (holders.length || cachedAnswer || vacancies.get(ocdId)) return [ocdId, {
      holders, status: holders.length ? "resolved" : "unsourced",
      vacancy: vacancies.get(ocdId),
      rosterGaps: cachedAnswer?.rosterGaps ?? projectedRosterGapsForDivision(coverage, ocdId),
    }];
    const answer = answers.key === remoteIdsKey ? answers.values[ocdId] : undefined;
    if (!answer) return [ocdId, { holders: [], status: "looking" }];
    if (answer.failed) return [ocdId, { holders: [], status: "unavailable" }];
    return [ocdId, {
      holders: answer.holders,
      vacancy: answer.vacancy,
      rosterGaps: answer.rosterGaps ?? [],
      status: answer.holders.length ? "resolved" : "unsourced",
    }];
  }));
}
