import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Body, Division } from "../registry/types.ts";
import { publisherHostname, type PublisherSizeHolding } from "../sources/publisher-size.ts";
import type { VotingDoorScope } from "./voting-source-types.ts";
import type { CountyCivicCoverageMap } from "../sources/google-civic/coverage.ts";

/** An observed Google gap leads unknown/covered counties; population orders each group. */
export function votingSourcePlaceOrder(coverage?: CountyCivicCoverageMap): (a: VotingDoorScope, b: VotingDoorScope) => number {
  const rank = (scope: VotingDoorScope) => {
    const row = scope.countyFips ? coverage?.get(scope.countyFips) : undefined;
    return row ? row.available ? 2 : 0 : 1;
  };
  const population = (scope: VotingDoorScope) => Number.isFinite(scope.population) && scope.population! >= 0 ? scope.population! : -1;
  return (a, b) => rank(a) - rank(b) || population(b) - population(a) || a.ocdId.localeCompare(b.ocdId);
}

/** Read one state's existing Census population holding; join exact government IDs or unambiguous official hosts. */
export async function votingSourcePopulations(input: {
  state: string;
  bodies: readonly Pick<Body, "ocdId" | "censusId" | "homepageUrl">[];
  divisions?: readonly Pick<Division, "ocdId" | "geoid" | "divisionType">[];
  coverage?: CountyCivicCoverageMap;
  root?: string;
}): Promise<ReadonlyMap<string, number>> {
  const state = input.state.toLowerCase();
  if (!/^[a-z]{2}$/.test(state)) throw new Error("VOTING_POPULATION_STATE_INVALID");
  const census = new Map<string, string[]>(), hosts = new Map<string, string[]>();
  for (const body of input.bodies) {
    if (!body.ocdId || !new RegExp(`/(?:state|district|territory):${state}(?:/|$)`).test(body.ocdId)) continue;
    if (body.censusId) census.set(body.censusId, [...(census.get(body.censusId) ?? []), body.ocdId]);
    const host = body.homepageUrl ? publisherHostname(body.homepageUrl) : null;
    if (host) hosts.set(host, [...(hosts.get(host) ?? []), body.ocdId]);
  }
  const byPlace = new Map<string, Set<number>>();
  const byHost = new Map<string, Map<string, { population: number | null; conflicted: boolean }>>();
  const add = (id: string, count: number) => { const values = byPlace.get(id) ?? new Set<number>(); values.add(count); byPlace.set(id, values); };
  const stream = createReadStream(join(input.root ?? process.cwd(), "data", "states", state, "reference", "publisher-sizes.jsonl"), "utf8");
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as PublisherSizeHolding;
      if (row.state !== state || row.kind !== "local-government") continue;
      const count = typeof row.population === "number" && Number.isFinite(row.population) && row.population >= 0 ? row.population : null;
      if (count !== null) for (const id of census.get(row.censusId) ?? []) add(id, count);
      if (!hosts.has(row.host)) continue;
      const publishers = byHost.get(row.host) ?? new Map();
      const prior = publishers.get(row.censusId);
      publishers.set(row.censusId, { population: count ?? prior?.population ?? null,
        conflicted: prior?.conflicted === true || (count !== null && prior?.population != null && prior.population !== count) });
      byHost.set(row.host, publishers);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  } finally { lines.close(); stream.destroy(); }
  for (const [host, publishers] of byHost) {
    if (publishers.size !== 1) continue;
    const only = [...publishers.values()][0];
    if (only.population === null || only.conflicted) continue;
    for (const id of hosts.get(host) ?? []) if (!byPlace.has(id)) add(id, only.population);
  }
  const countyFips = new Map((input.divisions ?? []).filter(row => row.divisionType === "county" && row.geoid?.length === 5)
    .map(row => [row.ocdId, row.geoid!]));
  const order = votingSourcePlaceOrder(input.coverage);
  return new Map([...byPlace].flatMap(([id, counts]) => counts.size === 1 ? [[id, [...counts][0]] as const] : [])
    .sort(([a, left], [b, right]) => order(
      { state, name: a, ocdId: a, countyFips: countyFips.get(a), population: left },
      { state, name: b, ocdId: b, countyFips: countyFips.get(b), population: right })));
}
