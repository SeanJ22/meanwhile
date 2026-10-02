import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CensusUnitTerritory } from "./membership.ts";

export interface StateReference {
  formatVersion: 1;
  state: string;
  units: CensusUnitTerritory[];
  zips: Record<string, { total: number; edges: { layer: string; id: string; samples: number }[] }>;
  /** Shared-ZIP candidates inside this state; membership still checks overlap. */
  adjacency: Record<string, string[]>;
  facts: Record<string, { web: string; county: string }>;
  censusSource: string;
}

export function readStateReference(root: string, state: string): StateReference {
  const key = state.toUpperCase();
  if (!/^[A-Z]{2}$/.test(key)) throw new Error(`PLACE_REFERENCE_STATE_INVALID:${state}`);
  const path = join(/* turbopackIgnore: true */ root, "data", "derived", "place-reference", `${key.toLowerCase()}.json`);
  const shard = JSON.parse(readFileSync(path, "utf8")) as StateReference;
  if (shard.formatVersion !== 1 || shard.state !== key) throw new Error(`PLACE_REFERENCE_INVALID:${key}`);
  return shard;
}

export function stateReferenceNames(root: string): string[] {
  return (JSON.parse(readFileSync(join(/* turbopackIgnore: true */ root, "data", "derived", "place-reference", "index.json"), "utf8")) as { states: string[] }).states;
}
