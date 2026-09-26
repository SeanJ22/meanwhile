/**
 * **THE ZIP INDEX, READ ONE SHARD AT A TIME.** (2026-09-23.)
 *
 * Every division whose territory reaches each ZIP code in the country, built by
 * `scripts/build-zip-division-shards.mts` into one shard per two-digit ZIP
 * prefix under `data/derived/zip-divisions/`. A request reads only the shard
 * its ZIP sits in — about a hundred kilobytes — and keeps the last few in
 * memory; a script that needs every ZIP reads them all with
 * `readAllZipDivisions`.
 *
 * It replaces the three-state index (kept as the frozen baseline
 * `tests/fixtures/zip-division-ids-three-state.json`), which named a government
 * only where this repository had committed its polygon and so held 279 ZIPs.
 * The meanings are unchanged: `ids` is every division whose territory reaches
 * inside the ZIP (never a claim that a reader there is governed by all of
 * them), `partial` is those covering only part of its sampled area (RULING 71),
 * `samples` the lattice points inside the ZCTA.
 *
 * **Every request-path read names the folder in literal segments** (R23). A
 * path the bundler cannot scope — a spread constant, a variable root — makes
 * Turbopack trace the whole project into every route that imports this; with
 * the folder spelled out it traces exactly the shards into each of them, and
 * the postbuild reader-trace check fails the build if a reader route lacks
 * one. The folder is ~100 files, not one per ZIP3, so the traced file count
 * stays near the bundle budget's.
 *
 * A shard that cannot be read is OUR gap: it answers null and is not cached, so
 * a transient failure never becomes permanent for the process.
 *
 * Congressional and legislative membership also reads the same narrow
 * promoted Census slice Admin uses. Those layers were absent from the sample
 * shards; the current published whole/partial overlap supplies their evidence.
 * An unavailable or conflicting Census plan preserves the existing index.
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
