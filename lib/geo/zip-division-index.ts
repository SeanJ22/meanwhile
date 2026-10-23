import { ocdStateCode } from "../ocd/state-of.ts";
import { readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { GeographySelection } from "../census-geography/selection.ts";
import { postalArea, zipNeedsAddress } from "./postal.ts";
import { isTownOrCountyDivision } from "./postal-core.ts";

export interface ZipDivisionEntry {
  /** Every division whose territory reaches inside this ZIP. */
  readonly ids: readonly string[];
  /** Those covering only part of the ZIP's sampled area. */
  readonly partial: readonly string[];
  /** Lattice sample points inside this ZCTA. Zero means unmeasured. */
  readonly samples: number;
  /** State/families replaced by qualified Census ZIP rows, such as az/sldu. */
  readonly qualifiedDistricts?: readonly string[];
  /** Divisions reaching into the ZIP where too few of its residents live to be shown as theirs: named, never listed as governing. */
  readonly fringe?: readonly string[];
}

export interface ZipDivisionShard {
  readonly divisions: readonly string[];
  readonly zips: Readonly<Record<string, readonly number[]>>;
  readonly partial: Readonly<Record<string, readonly number[]>>;
  readonly zipSamples: Readonly<Record<string, number>>;
  /** 2020 residents of each `zips` division inside the ZIP, index-aligned; -1 where the blocks do not measure it. */
  readonly residents?: Readonly<Record<string, readonly number[]>>;
  readonly zipResidents?: Readonly<Record<string, number>>;
}
type Shard = ZipDivisionShard;

/** A division home to a smaller share of a ZIP's residents than this is named for the ZIP, never shown as governing it. */
export const ZIP_RESIDENT_SHARE_SHOWN = 0.05;
/** At this share a division holds the whole ZIP; below it the ZIP is split. */
const WHOLE_ZIP_SHARE = 0.995;
const STATEWIDE = /^ocd-division\/country:us(?:\/(?:state|territory|district):[a-z]{2})?$/;

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

/** One ZIP's entry from its shard, judged by where its residents live when the shard counts them. */
export function shardEntry(shard: Shard, zip: string): ZipDivisionEntry | null {
  const refs = shard.zips[zip];
  if (refs === undefined) return null;
  const counts = shard.residents?.[zip], total = shard.zipResidents?.[zip] ?? 0;
  const ids: string[] = [], partial: string[] = [], fringe: string[] = [];
  refs.forEach((ref, k) => {
    const id = shard.divisions[ref];
    if (STATEWIDE.test(id)) { ids.push(id); return; }
    const residents = counts && total > 0 ? counts[k] ?? -1 : -1;
    if (residents >= 0 && residents / total < ZIP_RESIDENT_SHARE_SHOWN) { fringe.push(id); return; }
    ids.push(id);
    if (residents < 0 || residents / total < WHOLE_ZIP_SHARE) partial.push(id);
  });
  return { ids, partial, samples: shard.zipSamples[zip] ?? 0, ...(fringe.length ? { fringe } : {}) };
}

/** The held local divisions in one ZIP shard, before Census district qualification. */
export async function indexedZipDivisionEntry(zip: string | null): Promise<ZipDivisionEntry | null> {
  if (zip === null || !/^\d{5}$/.test(zip)) return null;
  const shard = await shardFor(zipShardOf(zip));
  return shard === null ? null : shardEntry(shard, zip);
}

/** A ZIP's divisions, or null when it is not indexed or its shard could not be read — our gap, never a claim about the place. */
export async function zipDivisionEntry(zip: string | null, selection?: GeographySelection): Promise<ZipDivisionEntry | null> {
  if (zip === null || !/^\d{5}$/.test(zip)) return null;
  // A mail-only ZIP opens its place, with no residential district membership.
  const area = postalArea(zip);
  const lookupZip = area?.zcta ?? zip;
  if (zipNeedsAddress(zip)) {
    const entry = await indexedZipDivisionEntry(lookupZip);
    if (!entry) return null;
    const ids = entry.ids.filter(isTownOrCountyDivision);
    return { ids, partial: ids.filter(id => id.split("/").length > 3), samples: 0 };
  }
  const { publishedZipDistricts, withCensusDistricts } = await import("./zip-census-districts.ts");
  const [entry, districts] = await Promise.all([indexedZipDivisionEntry(lookupZip), publishedZipDistricts(lookupZip)]);
  const base = entry ?? { ids: [], partial: [], samples: 0 };
  const qualified = withCensusDistricts(base, districts, lookupZip, selection);
  return entry === null && qualified.ids.length === 0 ? null : qualified;
}

const lowestByState = new Map<string, Promise<ReadonlyMap<string, string> | null>>();

export function lowestZipByDivision(state: string): Promise<ReadonlyMap<string, string> | null> {
  const st = state.toUpperCase();
  const held = lowestByState.get(st);
  if (held !== undefined) {
    lowestByState.delete(st);
    lowestByState.set(st, held);
    return held;
  }
  const read = readFile(join(process.cwd(), "data", "derived", "zip-divisions", "index.json"), "utf8")
    .then(async (text) => {
      const names = (JSON.parse(text) as { statesToShards: Record<string, readonly string[]> }).statesToShards[st] ?? [];
      const out = new Map<string, string>();
      for (const name of [...names].sort()) {
        const shard = JSON.parse(await readFile(join(process.cwd(), "data", "derived", "zip-divisions", `${name}.json`), "utf8")) as Shard;
        for (const zip of Object.keys(shard.zips).sort()) {
          for (const i of shard.zips[zip]) {
            const division = shard.divisions[i];
            if (ocdStateCode(division)?.toUpperCase() === st && !out.has(division)) out.set(division, zip);
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
  while (lowestByState.size > 4) lowestByState.delete(lowestByState.keys().next().value!);
  return read;
}

/** Every indexed ZIP, read synchronously from a repository root: for scripts and build-time checks, never a request path. */
export function readAllZipDivisions(root: string): Map<string, ZipDivisionEntry> {
  const out = new Map<string, ZipDivisionEntry>();
  const dir = join(/* turbopackIgnore: true */ root, "data", "derived", "zip-divisions");
  for (const file of readdirSync(dir).filter((f) => SHARD_FILE.test(f)).sort()) {
    const shard = JSON.parse(readFileSync(join(dir, file), "utf8")) as Shard;
    for (const zip of Object.keys(shard.zips)) {
      const entry = shardEntry(shard, zip);
      if (entry !== null) out.set(zip, entry);
    }
  }
  return out;
}

/** The shard files of an index directory, by name: for trace and manifest checks. */
export function zipShardFiles(dir: string): string[] {
  return readdirSync(/* turbopackIgnore: true */ dir).filter((f) => SHARD_FILE.test(f)).sort();
}
