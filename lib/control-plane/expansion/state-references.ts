import { closeSync, openSync, readFileSync, readSync } from "node:fs";
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
  exactShares: Record<string, Record<string, number>>;
}

type Span = readonly [offset: number, bytes: number];
export interface StateReferenceIndex {
  formatVersion: 2;
  state: string;
  censusSource: string;
  units: Span[];
  /** Unit rows needed by each place and its in-state district candidates. */
  byZip: Record<string, number[]>;
  shares: Record<string, Span>;
  facts: Span;
  adjacency: Span;
}

export interface StateReferenceSelection {
  units?: ReadonlySet<string> | "state";
  shares?: ReadonlySet<string>;
  facts?: boolean;
}

/** Read the selected rows by byte offset. The manifest contains addresses,
 * never the other places' civic records; no data payload is cached. */
export function readStateReference(root: string, state: string, selection?: StateReferenceSelection): StateReference {
  const key = state.toUpperCase();
  if (!/^[A-Z]{2}$/.test(key)) throw new Error(`PLACE_REFERENCE_STATE_INVALID:${state}`);
  const path = join(/* turbopackIgnore: true */ root, "data", "derived", "place-reference", `${key.toLowerCase()}.json`);
  const index = JSON.parse(readFileSync(path, "utf8")) as StateReferenceIndex;
  if (index.formatVersion !== 2 || index.state !== key) throw new Error(`PLACE_REFERENCE_INVALID:${key}`);
  const fd = openSync(join(/* turbopackIgnore: true */ root, "data", "derived", "place-reference", `${key.toLowerCase()}.jsonl`), "r");
  const read = <T>([offset, size]: Span): T => {
    const bytes = Buffer.alloc(size);
    let readBytes = 0;
    while (readBytes < size) {
      const count = readSync(fd, bytes, readBytes, size - readBytes, offset + readBytes);
      if (!count) throw new Error(`PLACE_REFERENCE_TRUNCATED:${key}`);
      readBytes += count;
    }
    return JSON.parse(bytes.toString("utf8")) as T;
  };
  try {
    const selectedUnits = selection === undefined || selection.units === "state" ? index.units.keys()
      : new Set([...(selection.units ?? [])].flatMap(zip => index.byZip[zip] ?? []));
    const shard: StateReference = { formatVersion: 1, state: key, units: [...selectedUnits].map(i => read<CensusUnitTerritory>(index.units[i])),
      zips: {}, adjacency: selection === undefined ? read(index.adjacency) : {}, facts: selection === undefined || selection.facts ? read(index.facts) : {},
      censusSource: index.censusSource, exactShares: {} };
    for (const division of selection === undefined ? Object.keys(index.shares) : selection.shares ?? []) {
      const span = index.shares[division];
      if (!span) continue;
      const rows = read<{ zips: StateReference["zips"]; exact: Record<string, number> }>(span);
      for (const [zip, row] of Object.entries(rows.zips)) {
        const entry = shard.zips[zip] ??= { total: row.total, edges: [] };
        entry.edges.push(...row.edges);
      }
      if (Object.keys(rows.exact).length) shard.exactShares[division] = rows.exact;
    }
    return shard;
  } finally { closeSync(fd); }
}
