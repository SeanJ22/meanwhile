import { readGenericBallotProjection, type GenericBallotProjection } from "./generic-projection.ts";
import { ballotSourcesForDivisions, ballotSourceForTargetId, type RegisteredBallotSource } from "./registry.ts";
import { contestsForDivisions } from "../sources/ballot-nj-morris/index.ts";
import type { BallotSet } from "./types.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { readTranslations, withMeasureTranslations } from "../translate/projection-reader.ts";
import { readPlaceMeasureProjection, placeDivisionForMeasureTarget } from "./place-measures.ts";

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

export function genericSourcesForDivisions(value: GenericBallotProjection, divisions: readonly string[]): RegisteredBallotSource[] {
  const today = new Date().toISOString().slice(0, 10);
  const ballots = Object.values(value.ballots).filter(ballot => {
    const hit = contestsForDivisions(ballot, divisions);
    return hit.contests.length > 0 || hit.absences.length > 0 || Boolean(hit.heldContests?.length);
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

export async function readerBallotSourcesForDivisions(divisions: readonly string[], options: PromotedCivicDataReadOptions = {}): Promise<readonly RegisteredBallotSource[]> {
  if (!divisions.length) return [];
  const legacy = ballotSourcesForDivisions(divisions);
  const translationsRead = readTranslations(divisions, options).catch(() => []);
  const generalRead = readGenericBallotProjection(options);
  const localRead = Promise.all([...new Set(divisions)].filter(division => division.split("/").length > 3).map(async division => {
    try {
      const read = await readPlaceMeasureProjection(division, options);
      if (read.kind === "PROMOTED") return { ballots: Object.values(read.value.ballots), failures: [] };
      if (read.kind !== "STORE_UNREACHABLE" || read.code === "STORE_NOT_CONFIGURED") return { ballots: [], failures: [] };
      throw new Error(read.code);
    } catch (error) { return { ballots: [], failures: [{ state: division, source: { name: `ballot-measures:${division}`,
      fetch: async () => { throw error; }, normalize: () => { throw error; }, upsert: async () => { throw error; } } }] }; }
  }));
  const attach = async (sources: readonly RegisteredBallotSource[]) => {
    const translations = await translationsRead;
    return sources.map(row => ({ ...row, source: { ...row.source,
      normalize: (raw: Parameters<typeof row.source.normalize>[0]) => withMeasureTranslations(row.source.normalize(raw), translations) } }));
  };
  try {
    const [read, local] = await Promise.all([generalRead, localRead]);
    const projection = withLocalMeasures(read.kind === "PROMOTED" ? read.value : { kind: "ballot-contests", ballots: {} }, local.flatMap(row => row.ballots));
    const sources = [...local.flatMap(row => row.failures), ...genericSourcesForDivisions(projection, divisions), ...legacy];
    if (read.kind === "PROMOTED") return attach(sources);
    if (read.kind !== "STORE_UNREACHABLE" || read.code === "STORE_NOT_CONFIGURED") return attach(sources);
    throw new Error(read.code);
  } catch (error) {
    // Expose the failed general authority through each entry point's existing
    // holding-gap handling; the legacy authority keeps its own failure domain.
    const local = await localRead;
    return [{ state: "general ballot", source: { name: "ballot-contests",
      fetch: async () => { throw error; }, normalize: () => { throw error; },
      upsert: async () => { throw error; },
    } }, ...local.flatMap(row => row.failures), ...await attach([...genericSourcesForDivisions(
      withLocalMeasures({ kind: "ballot-contests", ballots: {} }, local.flatMap(row => row.ballots)), divisions), ...legacy])];
  }
}

export async function readerBallotSourceForTargetId(targetId: string, options: PromotedCivicDataReadOptions = {}): Promise<RegisteredBallotSource | null> {
  const division = placeDivisionForMeasureTarget(targetId);
  if (division) {
    const [read, translations] = await Promise.all([readPlaceMeasureProjection(division, options), readTranslations([division], options)]);
    if (read.kind !== "PROMOTED") return null;
    const ballot = Object.values(read.value.ballots).map(ballot => withMeasureTranslations(ballot, translations)).find(ballot =>
      ballot.contests.some(contest => contest.id === targetId) || ballot.measureRecords?.some(record => record.parts.some(part => part.id === targetId)));
    return ballot ? genericSourcesForDivisions({ kind: "ballot-contests", ballots: { [ballot.election.id]: ballot } }, [division])[0] ?? null : null;
  }
  const legacy = ballotSourceForTargetId(targetId);
  if (legacy) return legacy;
  const read = await readGenericBallotProjection(options);
  if (read.kind !== "PROMOTED") return null;
  for (const ballot of Object.values(read.value.ballots)) {
    const measure = ballot.contests.find(row => row.type === "MEASURE" && (row.id === targetId || targetId.startsWith(`${row.id}#`)));
    if (measure) {
      const translated = withMeasureTranslations(ballot, await readTranslations([measure.ocdId], options));
      if (targetId !== measure.id && !translated.measureRecords?.some(record => record.contestId === measure.id && record.parts.some(part => part.id === targetId))) return null;
      return genericSourcesForDivisions({ kind: "ballot-contests", ballots: { [translated.election.id]: translated } }, [measure.ocdId])[0] ?? null;
    }
    if (ballot.candidacies.some(row => row.id === targetId) || ballot.contests.some(row => row.id === targetId)) {
      return genericSourcesForDivisions({ kind: "ballot-contests", ballots: { [ballot.election.id]: ballot } }, ballot.contests.map(row => row.ocdId))[0] ?? null;
    }
  }
  return null;
}
