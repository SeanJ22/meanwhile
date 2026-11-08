import { REGISTRY_STATES } from "../civic-data/state-scopes.ts";
import { readerDatabaseQuery } from "../reader/database.ts";
import { mapBallotsFromRows, mapBallotStatement } from "../reader/map-ballot.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { BallotSet } from "../ballot/types.ts";
import { parseDistrictOcd, resultContests, resultsByDistrict, STATE_DIVISION, type DistrictResult, type ResultContest } from "./results.ts";

/** What the results map asks for: one state's districts, or a national view. */
export type ResultsRequest =
  | { scope: "state"; state: string }
  | { scope: "us-senate" }
  | { scope: "us-house" };

export function parseResultsRequest(params: { scope: string | null; state: string | null }): ResultsRequest | null {
  const state = params.state?.toUpperCase() ?? "";
  if (params.scope === "state") return (REGISTRY_STATES as readonly string[]).includes(state) ? { scope: "state", state } : null;
  return params.scope === "us-senate" || params.scope === "us-house" ? { scope: params.scope } : null;
}

/** The election that carries filed results: a state with a primary and a general on file shows the latest one that has any. */
export function latestResultBallot(ballots: readonly BallotSet[]): BallotSet | null {
  return ballots.filter(ballot => resultContests(ballot).length > 0)
    .sort((a, b) => b.election.date.localeCompare(a.election.date))[0] ?? null;
}

const inFlight = new Map<string, Promise<ResultContest[]>>();

/**
 * The contests with filed results that the request covers, selected inside the database (lib/reader/map-ballot.ts):
 * one request returns only the contests the map draws, for one state or for every state, and readers who ask at the
 * same moment share it. Where none are filed, a district is absent and the map says so.
 */
export function readResultContests(request: ResultsRequest, query: ReadOnlyQuery | null = readerDatabaseQuery()): Promise<ResultContest[]> {
  const key = request.scope === "state" ? request.state : "nation";
  const held = inFlight.get(key);
  if (held) return held;
  const read = (async () => {
    if (!query) throw new Error("READER_STORE_NOT_CONFIGURED");
    const nation = request.scope !== "state";
    const [rows] = await query([mapBallotStatement(nation ? REGISTRY_STATES : [request.scope === "state" ? request.state : ""], nation ? "nation" : "state")]);
    const byState = new Map<string, BallotSet[]>();
    for (const ballot of mapBallotsFromRows(rows)) byState.set(ballot.election.state, [...byState.get(ballot.election.state) ?? [], ballot]);
    return [...byState.values()].flatMap(ballots => { const latest = latestResultBallot(ballots); return latest ? resultContests(latest) : []; });
  })();
  inFlight.set(key, read);
  const clear = () => { if (inFlight.get(key) === read) inFlight.delete(key); };
  read.then(clear, clear);
  return read;
}

export function inRequest(request: ResultsRequest, ocdId: string): boolean {
  if (request.scope === "us-senate") return STATE_DIVISION.test(ocdId);
  const district = parseDistrictOcd(ocdId);
  if (!district) return false;
  return request.scope === "us-house" ? district.kind === "cd" : district.state === request.state.toLowerCase();
}

export async function mapResults(request: ResultsRequest, read = readResultContests): Promise<Record<string, DistrictResult>> {
  return resultsByDistrict((await read(request)).filter(contest => inRequest(request, contest.ocdId)));
}
