import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { measureRecordsForBallot } from "../ballot/measure-records.ts";
import { divisionIdsForZipArea } from "../ballot/zip-divisions.ts";

import { readerBallotSourcesForDivisions } from "../ballot/reader-sources.ts";
import { contestsForDivisions } from "../sources/ballot-nj-morris/index.ts";
import { getGeneralLineup } from "../ballot/general-lineup.ts";
import { summaryForContest } from "../ballot/measure-summary.ts";
import { provisionsForContest } from "../ballot/measure-provisions.ts";
import { getMeasureAnalyses, type MeasureAnalysis } from "../ballot/analyses.ts";
import { positionsFor } from "../candidates/positions.ts";
import { readStanceTopics } from "../stances/read.ts";
import type { StanceTopic } from "../stances/topics.ts";
import type { BallotAbsence, BallotSet, Contest } from "../ballot/types.ts";
import { allSeatHolders, seatHolderById, seatHoldersForDivision } from "../registry/server.ts";
import { personIdentityKeys, statePeopleScopeForId } from "../officials/people-identity.ts";
import type { SeatHolder } from "../officials/lookup.ts";
import { membersOfBody } from "../registry/body-membership.ts";
import { bindNamedEntity } from "../routing/named-entity.ts";
import type { AskNominee } from "./ballot-inventory.ts";
import { canonicalBodyIdentity } from "./body-identity.ts";
import { stateDivisionsOf, type HeldOfficial } from "./reader-officials.ts";

export async function namedOfficeholders(question: string, explicitIds: readonly string[], divisionIds: readonly string[] = []): Promise<SeatHolder[]> {
  const states=stateDivisionsOf(divisionIds).map(id=>/\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(id)?.[1]).filter((state):state is string=>Boolean(state));
  const stateHint=new Set(states).size===1?states[0]:undefined;
  const targetedStateHolders: SeatHolder[] = [];
  for (const id of new Set(explicitIds)) {
    if (!statePeopleScopeForId(id,stateHint)) continue;
    const holder = await seatHolderById(id,stateHint);
    if (holder) targetedStateHolders.push(holder);
  }
  const heldById = new Map((await allSeatHolders(divisionIds)).map((holder) => [holder.id, holder]));
  for (const holder of targetedStateHolders) heldById.set(holder.id, holder);
  const held = [...heldById.values()];
  const binding = bindNamedEntity(question, held.map((seat) => ({
    id: seat.id, name: seat.name, nameClass: "person" as const, divisionType: "person",
  })));
  const wanted = new Set(explicitIds);
  if (binding.kind === "BOUND") wanted.add(binding.entity.id);
  if (binding.kind === "AMBIGUOUS") for (const entity of binding.candidates) wanted.add(entity.id);
  return held.filter((seat) => [...personIdentityKeys(seat)].some(id => wanted.has(id)));
}

export async function readerOfficeholders(ocdIds: readonly string[], bodyIds: readonly string[] = []): Promise<{ seats: SeatHolder[]; loaderFailures: number; held: HeldOfficial[] }> {
  const seats = new Map<string, SeatHolder>();
  const key = (seat: SeatHolder) => `${seat.id}|${seat.officeJurisdictionOcdId ?? ""}|${seat.officeTitle}`;
  const where = new Map<string, { divisionIds: Set<string>; bodyId: string | null; bodyName: string | null }>();
  const at = (seat: SeatHolder) => {
    let row = where.get(key(seat));
    if (!row) where.set(key(seat), row = { divisionIds: new Set(), bodyId: null, bodyName: null });
    return row;
  };
  for (const bodyId of bodyIds) {
    const governing = /#(?:governing|board)$/.test(bodyId);
    for (const seat of membersOfBody(bodyId).members) {
      seats.set(key(seat), seat);
      if (governing && !at(seat).bodyId) Object.assign(at(seat), { bodyId, bodyName: canonicalBodyIdentity(bodyId)?.name ?? null });
    }
  }
  let loaderFailures = 0;
  const divisions = new Set([...ocdIds, ...stateDivisionsOf(ocdIds)]);
  for (const ocdId of divisions) {
    try {
      const held = await seatHoldersForDivision(ocdId);
      for (const seat of held) {
        seats.set(key(seat), seat);
        at(seat).divisionIds.add(ocdId);
      }
      if (/\/(?:sldu|sldl):/.test(ocdId) && held.length === 0) {
        loaderFailures += 1;
      }
    } catch {
      loaderFailures += 1;
    }
  }
  return {
    seats: [...seats.values()],
    loaderFailures,
    held: [...seats.values()].map((seat) => ({ seat, divisionIds: [...(where.get(key(seat))?.divisionIds ?? [])], bodyId: where.get(key(seat))?.bodyId ?? null, bodyName: where.get(key(seat))?.bodyName ?? null })),
  };
}

export interface BallotForDivisions {
  authorityKind?: "GENERAL" | "LEGACY";
  loaderFailures: string[];
  analysisLoaderFailed: boolean;
  measureAnalysis: (contestId: string) => MeasureAnalysis | null;
  set: BallotSet | null;
  contests: Contest[];
  absences: BallotAbsence[];
  nominees: (contestId: string) => readonly AskNominee[];
  positions: (targetKey: string) => readonly {
    issueLabel: string;
    quote: string;
    documentUrl: string;
    retrievedAt: string;
  }[];
  measureSummary: (contestId: string) => { summary: string; summarizesUrl: string; yesMeans?: string | null; noMeans?: string | null } | null;
  measureProvisions: (contestId: string) => readonly {
    id: string;
    label: string;
    what: string;
    citesUrl: string;
  }[];
}

const EMPTY: BallotForDivisions = {
  loaderFailures: [],
  analysisLoaderFailed: false,
  measureAnalysis: () => null,
  set: null,
  contests: [],
  absences: [],
  nominees: () => [],
  positions: () => [],
  measureSummary: () => null,
  measureProvisions: () => [],
};

export async function loadBallotForDivisions(
  ocdIds: readonly string[],
  options: PromotedCivicDataReadOptions = {},
  zip?: string,
): Promise<BallotForDivisions> {
  if (ocdIds.length === 0) return EMPTY;
  const loaderFailures: string[] = [];
  const stanceTopics = await readStanceTopics();
  for (const { state, source } of await readerBallotSourcesForDivisions(ocdIds, options)) {
    try {
      const candidate = source.normalize(await source.fetch());
      const electionIds = zip && /^\d{5}$/.test(zip) ? await divisionIdsForZipArea(zip, [...ocdIds], {
        purpose: "election", asOf: new Date().toISOString().slice(0, 10), electionDate: candidate.election.date,
      }) : ocdIds;
      const hit = contestsForDivisions(candidate, electionIds);
      if (hit.contests.length === 0 && hit.absences.length === 0) continue;
      const analyses = heldOrUnreadable(getMeasureAnalyses);
      const lineup = heldOrUnreadable(getGeneralLineup) ?? null;
      const measureRecords = measureRecordsForBallot(candidate);
      return {
        authorityKind: source.name.startsWith("ballot-contests:") ? "GENERAL" : "LEGACY",
        loaderFailures,
        analysisLoaderFailed: analyses === undefined,
        measureAnalysis: (contestId) => analyses?.analyses.find((analysis) => analysis.contestId === contestId) ?? null,
        set: candidate,
        contests: hit.contests,
        absences: hit.absences,
        nominees: (contestId) => (lineup?.contests.find((contest) => contest.contestId === contestId)?.nominees ?? []).map((nominee) => ({ ...nominee, sourceUrl: lineup!.canvass.url, sourceOrg: lineup!.canvass.issuedBy, retrievedAt: lineup!.canvass.readAt })),
        positions: (targetKey: string) => sourcedPositions(targetKey, stanceTopics),
        measureSummary: (contestId) => {
          const summary = summaryForContest(contestId, measureRecords);
          return summary
            ? { summary: summary.summary, summarizesUrl: summary.summarizesUrl, yesMeans: summary.yesMeans, noMeans: summary.noMeans }
            : null;
        },
        measureProvisions: (contestId) =>
          provisionsForContest(contestId, measureRecords).map((p) => ({
            id: p.id,
            label: p.label,
            what: p.what,
            citesUrl: p.citesUrl,
          })),
      };
    } catch {
      loaderFailures.push(state);
    }
  }
  return { ...EMPTY, loaderFailures };
}

/** `undefined` when the holding cannot be read; another state's ballot still loads. */
function heldOrUnreadable<T>(read: () => T | null): T | null | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function sourcedPositions(targetKey: string, topics: readonly StanceTopic[]) {
  try {
    return positionsFor(targetKey, null, topics).flatMap((position) =>
      position.answer.kind === "MATCHED"
        ? position.answer.passages.map((passage) => ({
            issueLabel: position.issue.label,
            quote: passage.quote,
            documentUrl: passage.documentUrl,
            retrievedAt: passage.retrievedAt,
            sourceClass: passage.sourceClass,
            sourceRevisionId: passage.sourceRevisionId,
            sourceArtifactId: passage.sourceArtifactId,
            sourceContentHash: passage.sourceContentHash,
            textStart: passage.textStart,
            textEnd: passage.textEnd,
            revisionStatus: passage.revisionStatus,
            publicationDate: passage.publicationDate,
          }))
        : [],
    );
  } catch {
    return [];
  }
}
