import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { measureRecordsForBallot } from "../ballot/measure-records.ts";
import { divisionIdsForZipArea } from "../ballot/zip-divisions.ts";

import { readerBallotSourcesForDivisions } from "../ballot/reader-sources.ts";
import { summaryForContest } from "../ballot/measure-summary.ts";
import { provisionsForContest } from "../ballot/measure-provisions.ts";
import { type MeasureAnalysis } from "../ballot/analyses.ts";
import { positionsFor } from "../candidates/positions.ts";
import { readStanceTopics } from "../stances/read.ts";
import type { StanceTopic } from "../stances/topics.ts";
import type { BallotAbsence, BallotSet, Contest } from "../ballot/types.ts";
import { allSeatHolders, seatHolderById, seatHoldersForDivision } from "../registry/server.ts";
import { personIdentityKeys, statePeopleScopeForId } from "../officials/people-identity.ts";
import type { SeatHolder } from "../officials/lookup.ts";
import { holdersFor, indexByDivision, indexByOfficeholderId } from "../officials/lookup.ts";
import { normalizeName } from "../routing/exact-name.ts";
import { getFederalOfficeholderSet } from "../officials/federal-directory-read-model.ts";
import { statewideExecutivesFor } from "../officials/statewide-executives.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { membersOfBody } from "../registry/body-membership.ts";
import { bindNamedEntity } from "../routing/named-entity.ts";
import type { AskNominee } from "./ballot-inventory.ts";
import { canonicalBodyIdentity } from "./body-identity.ts";
import { stateDivisionsOf, type HeldOfficial } from "./reader-officials.ts";
import { ballotCandidateAliases, ballotCandidatePeople } from "../ballot/tickets.ts";

/** An exact full name in the already-read federal directory needs no state legislature lookup. */
export function namedFederalOfficeholder(question: string): SeatHolder | null {
  try {
    const seats = [...new Map([...indexByOfficeholderId([getFederalOfficeholderSet()]).values()]
      .map(seat => [seat.id, seat])).values()];
    const binding = bindNamedEntity(question, seats.map(seat => ({ id: seat.id, name: seat.name, nameClass: "person" as const })));
    if (binding.kind !== "BOUND") return null;
    const seat = seats.find(row => row.id === binding.entity.id);
    const name = seat && normalizeName(seat.name);
    return seat && name && name.split(" ").length > 1 && ` ${normalizeName(question)} `.includes(` ${name} `) ? seat : null;
  } catch { return null; }
}

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

export async function readerOfficeholders(ocdIds: readonly string[], bodyIds: readonly string[] = [], offices?: readonly string[]): Promise<{ seats: SeatHolder[]; loaderFailures: number; held: HeldOfficial[] }> {
  const statewide = new Set(["governor", "us_senator", "us_representative", "attorney_general", "secretary_of_state", "state_treasurer", "superintendent_of_public_instruction"]);
  const narrow = Boolean(offices?.length && offices.every(key => statewide.has(key)));
  const readDivision = async (id: string): Promise<SeatHolder[]> => {
    if (!narrow) return seatHoldersForDivision(id);
    const federal = offices!.some(key => key === "us_senator" || key === "us_representative")
      ? holdersFor(indexByDivision([getFederalOfficeholderSet()]), id) : [];
    return [...federal, ...statewideExecutivesFor([id])].filter(seat => offices!.includes(officeIdentity(seat.officeTitle) ?? ""));
  };
  const seats = new Map<string, SeatHolder>();
  const key = (seat: SeatHolder) => `${seat.id}|${seat.officeJurisdictionOcdId ?? ""}|${seat.officeTitle}`;
  const where = new Map<string, { divisionIds: Set<string>; bodyId: string | null; bodyName: string | null }>();
  const at = (seat: SeatHolder) => {
    let row = where.get(key(seat));
    if (!row) where.set(key(seat), row = { divisionIds: new Set(), bodyId: null, bodyName: null });
    return row;
  };
  for (const bodyId of narrow ? [] : bodyIds) {
    const governing = /#(?:governing|board)$/.test(bodyId);
    for (const seat of membersOfBody(bodyId).members) {
      seats.set(key(seat), seat);
      if (governing && !at(seat).bodyId) Object.assign(at(seat), { bodyId, bodyName: canonicalBodyIdentity(bodyId)?.name ?? null });
    }
  }
  let loaderFailures = 0;
  const divisions = new Set([...ocdIds, ...stateDivisionsOf(ocdIds)]);
  const reads = await Promise.all([...divisions].map(async ocdId => {
    try { return { ocdId, held: await readDivision(ocdId) }; }
    catch { return { ocdId, held: null }; }
  }));
  for (const { ocdId, held } of reads) {
    if (held) {
      for (const seat of held) {
        seats.set(key(seat), seat);
        at(seat).divisionIds.add(ocdId);
      }
      if (!narrow && /\/(?:sldu|sldl):/.test(ocdId) && held.length === 0) {
        loaderFailures += 1;
      }
    } else {
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
  loaderFailures: string[];
  analysisLoaderFailed: boolean;
  measureAnalysis: (contestId: string) => MeasureAnalysis | null;
  set: BallotSet | null;
  sets: readonly BallotSet[];
  setForTarget: (targetId: string) => BallotSet | null;
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
  sets: [],
  setForTarget: () => null,
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
  const loaderFailures: string[] = [], sets: BallotSet[] = [];
  const stanceTopics = await readStanceTopics();
  const selectedStates = new Set<string>();
  for (const { state, source } of await readerBallotSourcesForDivisions(ocdIds, options, zip && /^\d{5}$/.test(zip) ? election =>
    divisionIdsForZipArea(zip, [...ocdIds], { purpose: "election", asOf: new Date().toISOString().slice(0, 10), electionDate: election.date }) : undefined)) {
    try {
      const ballot = source.normalize(await source.fetch());
      if (selectedStates.has(state) || !ballot.contests.length && !ballot.absences.length && !ballot.heldContests?.length) continue;
      selectedStates.add(state);
      sets.push(ballot);
    } catch {
      loaderFailures.push(state);
    }
  }
  if (!sets.length) return { ...EMPTY, loaderFailures };
  const byTarget = new Map<string, BallotSet>();
  const analyses = new Map<string, MeasureAnalysis>();
  const nominees = new Map<string, readonly AskNominee[]>();
  const measures = sets.flatMap(measureRecordsForBallot);
  for (const ballot of sets) {
    for (const row of [...ballot.contests, ...ballot.candidacies, ...ballot.filingCandidacies ?? [], ...ballot.heldContests ?? []]) byTarget.set(row.id, ballot);
    for (const contest of ballot.contests) for (const alias of contest.aliases ?? []) byTarget.set(alias, ballot);
    for (const candidate of [...ballot.candidacies, ...ballot.filingCandidacies ?? []])
      for (const person of ballotCandidatePeople(candidate)) for (const alias of ballotCandidateAliases(person)) byTarget.set(alias, ballot);
    for (const row of ballot.measureAnalyses?.analyses ?? []) analyses.set(row.contestId, row);
    const lineup = ballot.generalLineup;
    for (const contest of lineup?.contests ?? []) {
      nominees.set(contest.contestId, contest.nominees.map(nominee => ({ ...nominee,
        sourceUrl: nominee.provenance?.sourceUrl ?? lineup!.canvass.url,
        sourceOrg: nominee.provenance?.sourceOrg ?? lineup!.canvass.issuedBy,
        retrievedAt: nominee.provenance?.collectedAt ?? lineup!.canvass.readAt })));
      for (const nominee of contest.nominees) byTarget.set(`${contest.contestId}|${nominee.name}`, ballot);
    }
  }
  const set: BallotSet = sets.length === 1 ? sets[0] : { ...sets[0],
    contests: sets.flatMap(row => row.contests), candidacies: sets.flatMap(row => row.candidacies),
    filingCandidacies: sets.flatMap(row => row.filingCandidacies ?? []), measures: sets.flatMap(row => row.measures),
    absences: sets.flatMap(row => row.absences), heldContests: sets.flatMap(row => row.heldContests ?? []),
    removals: sets.flatMap(row => row.removals ?? []), contacts: sets.flatMap(row => row.contacts ?? []) };
  return { loaderFailures, analysisLoaderFailed: false, set, sets,
    setForTarget: target => byTarget.get(target) ?? null,
    contests: set.contests, absences: set.absences,
    measureAnalysis: contestId => analyses.get(contestId) ?? null,
    nominees: contestId => nominees.get(contestId) ?? [],
    positions: targetKey => {
      const ballot = byTarget.get(targetKey);
      return ballot ? sourcedPositions(ballot.election.state, targetKey, stanceTopics) : [];
    },
    measureSummary: contestId => {
      const summary = summaryForContest(contestId, measures);
      return summary ? { summary: summary.summary, summarizesUrl: summary.summarizesUrl, yesMeans: summary.yesMeans, noMeans: summary.noMeans } : null;
    },
    measureProvisions: contestId => provisionsForContest(contestId, measures).map(row => ({ id: row.id, label: row.label, what: row.what, citesUrl: row.citesUrl })) };
}

function sourcedPositions(state: string, targetKey: string, topics: readonly StanceTopic[]) {
  try {
    return positionsFor(state, targetKey, null, topics).flatMap((position) =>
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
