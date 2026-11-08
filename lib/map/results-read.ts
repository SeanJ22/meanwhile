import { readGenericBallotProjection } from "../ballot/generic-projection.ts";
import type { BallotSet } from "../ballot/types.ts";
import { parseDistrictOcd, resultContests, resultsByDistrict, STATE_DIVISION, type DistrictResult, type ResultContest } from "./results.ts";

/** What the results map asks for: one state's districts, or a national view. */
export type ResultsRequest =
  | { scope: "state"; state: string }
  | { scope: "us-senate" }
  | { scope: "us-house" };

export function parseResultsRequest(params: { scope: string | null; state: string | null }): ResultsRequest | null {
  const state = params.state?.toUpperCase() ?? "";
  if (params.scope === "state") return /^[A-Z]{2}$/.test(state) ? { scope: "state", state } : null;
  return params.scope === "us-senate" || params.scope === "us-house" ? { scope: params.scope } : null;
}

/** The election that carries filed results: a state with a primary and a general on file shows the latest one that has any. */
export function latestResultBallot(ballots: readonly BallotSet[]): BallotSet | null {
  return ballots.filter(ballot => resultContests(ballot).length > 0)
    .sort((a, b) => b.election.date.localeCompare(a.election.date))[0] ?? null;
}

/** One state's filed results, from the same promoted ballot the reader's ballot page reads. A failed read is an error, never an empty answer. */
async function stateResultContests(state: string): Promise<ResultContest[]> {
  const read = await readGenericBallotProjection(state);
  if (read.kind === "NOT_RECORDED") return [];
  if (read.kind !== "PROMOTED") throw new Error(`${state} ballot read failed: ${read.kind}`);
  const ballot = latestResultBallot(Object.values(read.value.ballots));
  return ballot ? resultContests(ballot) : [];
}

/**
 * The contests with filed results that the request covers. Where none are filed, a district is absent and the map says so.
 * The one national summary the results job writes holds chamber seat totals only, with no state or district rows,
 * so the national views have nothing to color yet and show their banner.
 */
export async function readResultContests(request: ResultsRequest): Promise<ResultContest[]> {
  return request.scope === "state" ? stateResultContests(request.state) : [];
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
