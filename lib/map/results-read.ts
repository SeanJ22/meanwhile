import { REGISTRY_STATES } from "../civic-data/state-scopes.ts";
import { readerDatabaseQuery } from "../reader/database.ts";
import { mapBallotsFromRows, mapBallotStatement } from "../reader/map-ballot.ts";
import { readNationalElectionResults, readStateElectionResults } from "../reader/election-results.ts";
import { resultFeedStore, type ElectionResultFeedStore } from "../election-results/feed-store.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { BallotResultFacts } from "../ballot/election-results.ts";
import type { BallotSet } from "../ballot/types.ts";
import { nationalDistrictResults, nationalResults, resultContests, resultsByDistrict, type DistrictResult } from "./results.ts";

/** What the results map asks for: one state's districts, or one chamber's states. */
export type ResultsRequest =
  | { scope: "state"; state: string }
  | { scope: "us-senate" }
  | { scope: "us-house" };

export function parseResultsRequest(params: { scope: string | null; state: string | null }): ResultsRequest | null {
  const state = params.state?.toUpperCase() ?? "";
  if (params.scope === "state") return (REGISTRY_STATES as readonly string[]).includes(state) ? { scope: "state", state } : null;
  return params.scope === "us-senate" || params.scope === "us-house" ? { scope: params.scope } : null;
}

/** The election that carries results: a state with a primary and a general on file shows the latest one the results job has filed. */
export function latestResultBallot(ballots: readonly BallotSet[], facts: BallotResultFacts): BallotSet | null {
  return ballots.filter(ballot => resultContests(ballot, facts).length > 0)
    .sort((a, b) => b.election.date.localeCompare(a.election.date))[0] ?? null;
}

export interface ResultsSources { readonly query?: ReadOnlyQuery | null; readonly store?: ElectionResultFeedStore }

const inFlight = new Map<string, Promise<Record<string, DistrictResult>>>();

/**
 * One state's districts. The sliced ballot (contests and candidates only, selected inside the database) says which
 * contest is which district; the state's published results feed says how each came out. A state the results job has
 * published nothing for costs one small blob read and no database request.
 */
function stateResults(state: string, { query = readerDatabaseQuery(), store = resultFeedStore() }: ResultsSources): Promise<Record<string, DistrictResult>> {
  const held = inFlight.get(state);
  if (held) return held;
  const read = (async () => {
    const feed = await readStateElectionResults(state, undefined, store);
    if (!feed) return {};
    if (!query) throw new Error("READER_STORE_NOT_CONFIGURED");
    const [rows] = await query([mapBallotStatement(state)]);
    const ballot = latestResultBallot(mapBallotsFromRows(rows), feed.facts);
    return ballot ? resultsByDistrict(resultContests(ballot, feed.facts)) : {};
  })();
  inFlight.set(state, read);
  const clear = () => { if (inFlight.get(state) === read) inFlight.delete(state); };
  read.then(clear, clear);
  return read;
}

/** The map's answer for a request, keyed by the division it colors. An empty answer means nothing is published there yet. */
export async function mapResults(request: ResultsRequest, sources: ResultsSources = {}): Promise<Record<string, DistrictResult>> {
  if (request.scope === "state") return stateResults(request.state, sources);
  if (request.scope === "us-house") return nationalDistrictResults(await readNationalElectionResults(sources.store ?? resultFeedStore()));
  const summary = await readNationalElectionResults(sources.store ?? resultFeedStore());
  return summary ? nationalResults(summary, request.scope === "us-senate" ? "us_senate" : "us_house") : {};
}
