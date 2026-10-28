"use client";

import { useEffect, useState } from "react";

import type { SeatHolder } from "@/lib/officials/lookup";
import type { CoverageSummary } from "@/lib/registry/coverage";
import { representationForDivision } from "@/lib/registry/representation";
import type { RosterReaderGap } from "@/lib/registry/body-rosters";
import { bodyDetailState, loadBodyDetail, projectedRosterGapsForDivision } from "@/lib/registry/body-roster-client";
import { scopedHolders } from "@/lib/officials/scoped-holders";
import { getCachedStateDivision, isStateDivisionPending } from "@/lib/reader/client";
import type { SeatVacancy } from "@/lib/officials/types";

export type RepresentationStatus =
  | "resolved"
  | "looking"
  | "unsourced"
  | "unavailable";

export interface DivisionRepresentation {
  vacancy?: SeatVacancy;
  holders: SeatHolder[];
  status: RepresentationStatus;
  rosterGaps?: RosterReaderGap[];
}

interface Answer {
  vacancy?: SeatVacancy;
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
  const cached = new Map(ids.map(id => [id,coverage?.bodies.some(body=>body.rosterSummary&&!body.readerRoster&&
    (body.bodyId===`${id}#governing`||body.bodyId===`${id}#board`))?undefined:getCachedStateDivision(id)]));
  const vacancies = new Map(ids.map(id => [id, cached.get(id)?.vacancy ?? coverage?.seats.find(seat => seat.ocdId === id)?.vacancy]));
  const local = new Map(ids.map(id => {
    const holders = representationForDivision(coverage, id);
    return [id, holders.length ? holders : cached.get(id)?.holders ?? holders];
  }));
  const localBodies = Object.fromEntries(ids.map(id => [id, (coverage?.bodies ?? [])
    .filter(body => (body.bodyId === `${id}#governing` || body.bodyId === `${id}#board`) && body.rosterSummary)
    .map(body => ({ id: body.bodyId, state: bodyDetailState(body) }))]));
  const localBodiesKey = JSON.stringify(localBodies);
  const remoteIdsKey = JSON.stringify(ids.filter(id => localBodies[id]?.length ||
    (!local.get(id)?.length && !vacancies.get(id) && !cached.get(id) && !isStateDivisionPending(id))).sort());
  const requestKey = JSON.stringify([remoteIdsKey, localBodiesKey]);
  const [answers, setAnswers] = useState<{ key: string; values: Record<string, Answer> }>({ key: requestKey, values: {} });
  if (answers.key !== requestKey) setAnswers({ key: requestKey, values: {} });

  useEffect(() => {
    const remoteIds = JSON.parse(remoteIdsKey) as string[];
    const localBodies = JSON.parse(localBodiesKey) as Record<string, { id: string; state: string | null }[]>;
    if (!remoteIds.length) return;
    const controller = new AbortController();
    const record = (answer: Answer) => {
      if (!controller.signal.aborted) {
        setAnswers(previous => ({ key: requestKey, values: {
          ...(previous.key === requestKey ? previous.values : {}), [answer.ocdId]: answer,
        } }));
      }
    };
    for (const ocdId of remoteIds) {
      const bodies = localBodies[ocdId] ?? [];
      if (bodies.length) {
        void Promise.all(bodies.map(body => body.state ? loadBodyDetail(body.state, body.id) : Promise.reject(new Error("Body state unavailable"))))
          .then(details => record({ ocdId, holders: details.flatMap(detail => detail.roster.members),
            rosterGaps: details.flatMap(detail => detail.roster.gaps), failed: false }))
          .catch(() => record({ ocdId, holders: [], failed: true }));
        continue;
      }
      // The OCD-ID in the path, so every cache keys on the division.
      const path = ocdId
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
      fetch(`/api/representation/${path}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { ocdId?: string; holders?: SeatHolder[]; rosterGaps?: RosterReaderGap[]; vacancy?: SeatVacancy } | null) => {
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
  }, [remoteIdsKey, localBodiesKey, requestKey]);

  return Object.fromEntries(ids.map(ocdId => {
    const holders = local.get(ocdId)!;
    const cachedAnswer = cached.get(ocdId);
    const answer = answers.key === requestKey ? answers.values[ocdId] : undefined;
    if (localBodies[ocdId]?.length) {
      if (!answer) return [ocdId, { holders, status: "looking" }];
      if (answer.failed) return [ocdId, { holders, status: "unavailable" }];
      const merged = scopedHolders(answer.holders, holders);
      return [ocdId, { holders: merged, vacancy: vacancies.get(ocdId), rosterGaps: answer.rosterGaps ?? [],
        status: merged.length ? "resolved" : "unsourced" }];
    }
    if (holders.length || cachedAnswer || vacancies.get(ocdId)) return [ocdId, {
      holders, status: holders.length ? "resolved" : "unsourced",
      vacancy: vacancies.get(ocdId),
      rosterGaps: cachedAnswer?.rosterGaps ?? projectedRosterGapsForDivision(coverage, ocdId),
    }];
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
