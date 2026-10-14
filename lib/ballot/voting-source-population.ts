import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Body } from "../registry/types.ts";
import { publisherHostname, type PublisherSizeHolding } from "../sources/publisher-size.ts";

/** Read one state's existing Census population holding; join exact government IDs or unambiguous official hosts. */
export async function votingSourcePopulations(input: {
  state: string;
  bodies: readonly Pick<Body, "ocdId" | "censusId" | "homepageUrl">[];
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
  return new Map([...byPlace].flatMap(([id, counts]) => counts.size === 1 ? [[id, [...counts][0]] as const] : []));
}
