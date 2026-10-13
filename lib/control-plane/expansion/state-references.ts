import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import type { CensusUnitTerritory } from "./membership.ts";

export interface StateReference {
  listings?: import("../../registration/listings.ts").RegistrationGovernmentListing[];
  formatVersion: 1;
  state: string;
  units: CensusUnitTerritory[];
  zips: Record<string, { total: number; edges: { layer: string; id: string; samples: number }[] }>;
  facts: Record<string, { web: string; county: string; countyFips?: string | null }>;
  censusSource: string;
  exactShares: Record<string, Record<string, number>>;
}

type Span = readonly [offset: number, bytes: number, sha256?: string];
export interface StateReferenceIndex {
  formatVersion: 2;
  state: string;
  censusSource: string;
  units: Span[];
  /** Unit rows needed by each place and its in-state district candidates. */
  byZip: Record<string, number[]>;
  /** Exact acquired intersections can select units missing from the sampled ZIP graph. */
  byDivision?: Record<string, number[]>;
  shares: Record<string, Span>;
  facts: Span;
  listings?: Span;
  /** Immutable payload filename selected by this atomically swapped index. */
  dataFile?: string;
  dataSha256?: string;
}

export interface StateReferenceSelection {
  listings?: boolean;
  units?: ReadonlySet<string> | "state";
  shares?: ReadonlySet<string>;
  facts?: boolean;
  divisions?: ReadonlySet<string>;
}

/** Read the selected rows by byte offset. The manifest contains addresses,
 * never the other places' civic records; no data payload is cached. */
export function readStateReference(root: string, state: string, selection?: StateReferenceSelection): StateReference {
  const key = state.toUpperCase();
  if (!/^[A-Z]{2}$/.test(key)) throw new Error(`PLACE_REFERENCE_STATE_INVALID:${state}`);
  const path = join(/* turbopackIgnore: true */ root, "data", "derived", "place-reference", `${key.toLowerCase()}.json`);
  const index = JSON.parse(readFileSync(path, "utf8")) as StateReferenceIndex;
  if (index.formatVersion !== 2 || index.state !== key) throw new Error(`PLACE_REFERENCE_INVALID:${key}`);
  const dataFile = index.dataFile ?? `${key.toLowerCase()}.jsonl`;
  if (!/^[a-z]{2}(?:\.[a-f0-9]{64})?\.jsonl$/.test(dataFile) || !dataFile.startsWith(`${key.toLowerCase()}.`)) throw new Error(`PLACE_REFERENCE_DATA_INVALID:${key}`);
  const fd = openSync(join(/* turbopackIgnore: true */ root, "data", "derived", "place-reference", dataFile), "r");
  const read = <T>([offset, size, expectedHash]: Span): T => {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 1 || size > 32 * 1024 * 1024) throw new Error(`PLACE_REFERENCE_SPAN_INVALID:${key}`);
    const bytes = Buffer.alloc(size);
    let readBytes = 0;
    while (readBytes < size) {
      const count = readSync(fd, bytes, readBytes, size - readBytes, offset + readBytes);
      if (!count) throw new Error(`PLACE_REFERENCE_TRUNCATED:${key}`);
      readBytes += count;
    }
    if (expectedHash && createHash("sha256").update(bytes).digest("hex") !== expectedHash) throw new Error(`PLACE_REFERENCE_HASH_MISMATCH:${key}`);
    return JSON.parse(bytes.toString("utf8")) as T;
  };
  try {
    const selectedUnits = selection === undefined || selection.units === "state" ? index.units.keys()
      : new Set([...[...(selection.units ?? [])].flatMap(zip => index.byZip[zip] ?? []),
        ...[...(selection.divisions ?? [])].flatMap(division => index.byDivision?.[division] ?? [])]);
    const shard: StateReference = { formatVersion: 1, state: key, units: [...selectedUnits].map(i => read<CensusUnitTerritory>(index.units[i])),
      zips: {}, facts: selection === undefined || selection.facts ? read(index.facts) : {},
      censusSource: index.censusSource, exactShares: {},
      ...(selection?.listings && index.listings ? { listings: read<import("../../registration/listings.ts").RegistrationGovernmentListing[]>(index.listings) } : {}) };
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
