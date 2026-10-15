import { readGenericBallotProjection, type GenericBallotProjection } from "./generic-projection.ts";
import { ballotForDivisions } from "./contests.ts";
import { districtFamilyKey } from "../census-geography/division-id.ts";
import { ocdStateCode } from "../ocd/state-of.ts";
import { BALLOT_STATES, requireBallotState } from "./state-scopes.ts";
import type { BallotSet, BallotSource } from "./types.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { readTranslations, withMeasureTranslations } from "../translate/projection-reader.ts";

import { readPlaceMeasureProjection } from "./place-measures.ts";

function withLocalMeasures(value: GenericBallotProjection, places: readonly BallotSet[]): GenericBallotProjection {
  const ballots = { ...value.ballots };
  for (const place of places) {
    const key = Object.keys(ballots).find(key => ballots[key].election.state === place.election.state &&
      (ballots[key].election.id === place.election.id || place.election.date && ballots[key].election.date === place.election.date));
    if (!key) { ballots[`${place.election.state}:${place.election.id}`] = place; continue; }
    const before = ballots[key], ids = new Set(place.contests.map(contest => contest.id));
    ballots[key] = { ...before, contests: [...before.contests.filter(contest => !ids.has(contest.id)), ...place.contests],
      measures: [...before.measures.filter(measure => !ids.has(measure.contestId)), ...place.measures],
      measureRecords: [...(before.measureRecords ?? []).filter(record => !ids.has(record.contestId)), ...place.measureRecords ?? []] };
  }
  return { kind: "ballot-contests", ballots };
}

export interface RegisteredBallotSource {
  readonly state: string;
  readonly source: BallotSource;
}

export const ballotStatesForDivisions = (divisions: readonly string[]) => [...new Set(divisions.flatMap(id => {
  const state = ocdStateCode(id);
  return state && BALLOT_STATES.some(value => value === state.toUpperCase()) ? [requireBallotState(state)] : [];
}))];

export function genericSourcesForDivisions(value: GenericBallotProjection, divisions: readonly string[]): RegisteredBallotSource[] {
  return sourcesForBallots(Object.values(value.ballots).map(ballot => ballotForDivisions(ballot, divisions)));
}

function sourcesForBallots(rows: BallotSet[]): RegisteredBallotSource[] {
  const today = new Date().toISOString().slice(0, 10);
  const ballots = rows.filter(ballot => {
    return ballot.contests.length > 0 || ballot.absences.length > 0 || Boolean(ballot.heldContests?.length);
  }).sort((a, b) => {
    // The nearest dated upcoming election first; retain unknown dates as
    // unknown, and concluded elections after upcoming ones.
    const order = (ballot: BallotSet) => !ballot.election.date ? `1:${ballot.election.id}`
      : ballot.election.date >= today ? `0:${ballot.election.date}` : `2:${99999999 - Number(ballot.election.date.replaceAll("-", ""))}`;
    return order(a).localeCompare(order(b)) || a.election.id.localeCompare(b.election.id);
  });
  return ballots.map(ballot => ({ state: ballot.election.state.toLowerCase(), source: {
    name: `ballot-contests:${ballot.election.id}`,
    fetch: async () => [ballot],
    normalize: () => ballot,
    upsert: async () => { throw new Error("Ballots publish through the civic-data promotion path."); },
  } }));
}

const districtFamiliesByBallot = new WeakMap<BallotSet, readonly string[]>();
function districtFamilies(ballot: BallotSet): readonly string[] {
  let families = districtFamiliesByBallot.get(ballot);
  if (!families) {
    families = [...new Set([...ballot.contests, ...(ballot.heldContests ?? [])].flatMap(contest => {
      const family = districtFamilyKey(contest.ocdId);
      return family ? [family] : [];
    }))];
    districtFamiliesByBallot.set(ballot, families);
  }
  return families;
}

export async function readerBallotSourcesForDivisions(divisions: readonly string[], options: PromotedCivicDataReadOptions = {},
  electionDivisions?: (election: BallotSet["election"], districtFamilies: readonly string[]) => Promise<readonly string[]>): Promise<readonly RegisteredBallotSource[]> {
  const states = [...new Set([...ballotStatesForDivisions(divisions), ...divisions.filter(division => division.split("/").length > 3)
    .flatMap(division => ocdStateCode(division)?.toUpperCase() ?? [])])];
  if (!states.length) return [];
  const translationDivisions = [...new Set(divisions.flatMap(division => [division, division.split("/").slice(0, 3).join("/")]))];
  const translationsRead = readTranslations(translationDivisions, options).catch(() => []);
  const rows = await Promise.all(states.map(async state => {
    const failure = (name: string, error: unknown): RegisteredBallotSource => ({ state: state.toLowerCase(), source: { name,
      fetch: async () => { throw error; }, normalize: () => { throw error; }, upsert: async () => { throw error; } } });
    const local = await Promise.all([...new Set(divisions)].filter(division => division.split("/").length > 3 && ocdStateCode(division)?.toUpperCase() === state)
      .map(async division => {
        try {
          const read = await readPlaceMeasureProjection(division, options);
          if (read.kind === "PROMOTED") return { ballots: Object.values(read.value.ballots), failures: [] };
          if (read.kind !== "STORE_UNREACHABLE" || read.code === "STORE_NOT_CONFIGURED") return { ballots: [], failures: [] };
          throw new Error(read.code);
        } catch (error) { return { ballots: [], failures: [failure(`ballot-measures:${division}`, error)] }; }
      }));
    const localBallots = local.flatMap(row => row.ballots), failures = local.flatMap(row => row.failures);
    try {
      const read = BALLOT_STATES.some(value => value === state) ? await readGenericBallotProjection(state, options) : { kind: "NOT_RECORDED" as const };
      const projection = withLocalMeasures(read.kind === "PROMOTED" ? read.value : { kind: "ballot-contests", ballots: {} }, localBallots);
      if (read.kind === "STORE_UNREACHABLE" && read.code !== "STORE_NOT_CONFIGURED") throw new Error(read.code);
      return [...failures, ...sourcesForBallots(await Promise.all(Object.values(projection.ballots).map(async ballot =>
        ballotForDivisions(ballot, electionDivisions ? await electionDivisions(ballot.election, districtFamilies(ballot)) : divisions))))];
    } catch (error) {
      return [failure(`ballot-contests:${state}`, error), ...failures,
        ...genericSourcesForDivisions(withLocalMeasures({ kind: "ballot-contests", ballots: {} }, localBallots), divisions)];
    }
  }));
  const translations = await translationsRead;
  return rows.flat().map(row => ({ ...row, source: { ...row.source,
    normalize: (raw: Parameters<typeof row.source.normalize>[0]) => withMeasureTranslations(row.source.normalize(raw), translations) } }));
}

export async function readerBallotSourceForTargetId(targetId: string, divisions: readonly string[], options: PromotedCivicDataReadOptions = {}): Promise<RegisteredBallotSource | null> {
  for (const source of await readerBallotSourcesForDivisions(divisions, options)) {
    const ballot = source.source.normalize(await source.source.fetch());
    if (ballot.generalLineup?.contests.some(row => row.nominees.some(nominee => `${row.contestId}|${nominee.name}` === targetId))
      || ballot.candidacies.some(row => row.id === targetId) || ballot.filingCandidacies?.some(row => row.id === targetId)
      || ballot.contests.some(row => row.id === targetId)
      || ballot.heldContests?.some(row => row.id === targetId)
      || ballot.measureRecords?.some(row => row.parts.some(part => part.id === targetId))) return source;
  }
  return null;
}

export async function readerBallotSources(divisions: readonly string[], options: PromotedCivicDataReadOptions = {}): Promise<readonly RegisteredBallotSource[]> {
  return readerBallotSourcesForDivisions(divisions, options);
}
