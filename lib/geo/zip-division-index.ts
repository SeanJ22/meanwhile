/**
 * Divisions reaching each ZIP, built by `scripts/build-zip-division-shards.mts`
 * into one shard per two-digit ZIP prefix. A request reads only its ZIP's shard
 * and keeps a few recent ones in memory. A shard that cannot be read answers
 * null and is not cached.
 *
 * Request-path reads spell the folder as literal path segments so Turbopack
 * traces only the shard files; a variable or spread path makes it trace the
 * whole project.
 */
import { readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ZipDivisionEntry {
  /** Every division whose territory reaches inside this ZIP. */
  readonly ids: readonly string[];
  /** Those covering only part of the ZIP's sampled area. */
  readonly partial: readonly string[];
  /** Lattice sample points inside this ZCTA. Zero means unmeasured. */
  readonly samples: number;
}

interface Shard {
  readonly divisions: readonly string[];
  readonly zips: Readonly<Record<string, readonly number[]>>;
  readonly partial: Readonly<Record<string, readonly number[]>>;
  readonly zipSamples: Readonly<Record<string, number>>;
}

export const ZIP_DIVISIONS_DIR = ["data", "derived", "zip-divisions"] as const;
/** A shard's name: the ZIP's first two digits. */
export const zipShardOf = (zip: string): string => zip.slice(0, 2);
const SHARD_FILE = /^\d{2}\.json$/;
const SHARDS_KEPT = 24;
const shards = new Map<string, Promise<Shard | null>>();

function shardFor(name: string): Promise<Shard | null> {
  const held = shards.get(name);
  if (held !== undefined) {
    // Most recently used last, so the oldest is the one let go.
    shards.delete(name);
    shards.set(name, held);
    return held;
  }
  const read = readFile(join(process.cwd(), "data", "derived", "zip-divisions", `${name}.json`), "utf8")
    .then((text) => JSON.parse(text) as Shard)
    .catch(() => {
      shards.delete(name);
      return null;
    });
  shards.set(name, read);
  while (shards.size > SHARDS_KEPT) {
    const oldest = shards.keys().next().value;
    if (oldest === undefined) break;
    shards.delete(oldest);
  }
  return read;
}

function entryOf(shard: Shard, zip: string): ZipDivisionEntry | null {
  const refs = shard.zips[zip];
  if (refs === undefined) return null;
  return {
    ids: refs.map((i) => shard.divisions[i]),
    partial: (shard.partial[zip] ?? []).map((i) => shard.divisions[i]),
    samples: shard.zipSamples[zip] ?? 0,
  };
}

/** A ZIP's divisions, or null when it is not indexed or its shard could not be read — our gap, never a claim about the place. */
export async function zipDivisionEntry(zip: string | null): Promise<ZipDivisionEntry | null> {
  if (zip === null || !/^\d{5}$/.test(zip)) return null;
  const { publishedZipDistricts, withCensusDistricts } = await import("./zip-census-districts.ts");
  const [shard, districts] = await Promise.all([shardFor(zipShardOf(zip)), publishedZipDistricts(zip)]);
  const entry = shard === null ? null : entryOf(shard, zip);
  return entry === null ? null : withCensusDistricts(entry, districts, zip);
}

const lowestByState = new Map<string, Promise<ReadonlyMap<string, string> | null>>();

/**
 * For one state (postal code), the lowest ZIP each division reaches: a stable
 * public destination for a division's readers. Reads that state's shards once
 * per process; null when the index or a shard cannot be read (our gap, not
 * cached), an empty map for a state the index carries no ZIP for.
 */
export function lowestZipByDivision(state: string): Promise<ReadonlyMap<string, string> | null> {
  const st = state.toUpperCase();
  const held = lowestByState.get(st);
  if (held !== undefined) return held;
  const read = readFile(join(process.cwd(), "data", "derived", "zip-divisions", "index.json"), "utf8")
    .then(async (text) => {
      const names = (JSON.parse(text) as { statesToShards: Record<string, readonly string[]> }).statesToShards[st] ?? [];
      const out = new Map<string, string>();
      for (const name of [...names].sort()) {
        const shard = JSON.parse(await readFile(join(process.cwd(), "data", "derived", "zip-divisions", `${name}.json`), "utf8")) as Shard;
        for (const zip of Object.keys(shard.zips).sort()) {
          for (const i of shard.zips[zip]) {
            const division = shard.divisions[i];
            if (!out.has(division)) out.set(division, zip);
          }
        }
      }
      return out as ReadonlyMap<string, string>;
    })
    .catch(() => {
      lowestByState.delete(st);
      return null;
    });
  lowestByState.set(st, read);
  return read;
}

/** Every indexed ZIP, read synchronously from a repository root: for scripts and build-time checks, never a request path. */
export function readAllZipDivisions(root: string): Map<string, ZipDivisionEntry> {
  const out = new Map<string, ZipDivisionEntry>();
  const dir = join(/* turbopackIgnore: true */ root, "data", "derived", "zip-divisions");
  for (const file of readdirSync(dir).filter((f) => SHARD_FILE.test(f)).sort()) {
    const shard = JSON.parse(readFileSync(join(dir, file), "utf8")) as Shard;
    for (const zip of Object.keys(shard.zips)) {
      const entry = entryOf(shard, zip);
      if (entry !== null) out.set(zip, entry);
    }
  }
  return out;
}

/** The shard files of an index directory, by name: for trace and manifest checks. */
export function zipShardFiles(dir: string): string[] {
  return readdirSync(/* turbopackIgnore: true */ dir).filter((f) => SHARD_FILE.test(f)).sort();
}
