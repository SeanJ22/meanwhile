import { readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { GeographySelection } from "../census-geography/selection.ts";
import { postalArea, zipNeedsAddress } from "./postal.ts";
import { isTownOrCountyDivision } from "./postal-core.ts";
import { readZipDivisionShard, zipDivisionEntryOf, type ZipDivisionShard, type RawZipDivisionEntry } from "./zip-division-shards.ts";

export interface ZipDivisionEntry extends RawZipDivisionEntry {
  /** State/families replaced by qualified Census ZIP rows, such as az/sldu. */
  readonly qualifiedDistricts?: readonly string[];
}

const SHARD_FILE = /^\d{2}\.json$/;

/** A ZIP's divisions, or null when it is not indexed or its shard could not be read — our gap, never a claim about the place. */
export async function zipDivisionEntry(zip: string | null, selection?: GeographySelection): Promise<ZipDivisionEntry | null> {
  if (zip === null || !/^\d{5}$/.test(zip)) return null;
  // A mail-only ZIP opens its place, with no residential district membership.
  const area = postalArea(zip);
  const lookupZip = area?.zcta ?? zip;
  if (zipNeedsAddress(zip)) {
    const shard = await readZipDivisionShard(lookupZip.slice(0, 2));
    const entry = shard === null ? null : zipDivisionEntryOf(shard, lookupZip);
    if (!entry) return null;
    const ids = entry.ids.filter(isTownOrCountyDivision);
    return { ids, partial: ids.filter(id => id.split("/").length > 3), samples: 0 };
  }
  const { publishedZipDistricts, withCensusDistricts } = await import("./zip-census-districts.ts");
  const [shard, districts] = await Promise.all([readZipDivisionShard(lookupZip.slice(0, 2)), publishedZipDistricts(lookupZip)]);
  const entry = shard === null ? null : zipDivisionEntryOf(shard, lookupZip);
  const base = entry ?? { ids: [], partial: [], samples: 0 };
  const qualified = withCensusDistricts(base, districts, lookupZip, selection);
  return entry === null && qualified.ids.length === 0 ? null : qualified;
}

const lowestByState = new Map<string, Promise<ReadonlyMap<string, string> | null>>();

export function lowestZipByDivision(state: string): Promise<ReadonlyMap<string, string> | null> {
  const st = state.toUpperCase();
  const held = lowestByState.get(st);
  if (held !== undefined) return held;
  const read = readFile(join(process.cwd(), "data", "derived", "zip-divisions", "index.json"), "utf8")
    .then(async (text) => {
      const names = (JSON.parse(text) as { statesToShards: Record<string, readonly string[]> }).statesToShards[st] ?? [];
      const out = new Map<string, string>();
      for (const name of [...names].sort()) {
        const shard = JSON.parse(await readFile(join(process.cwd(), "data", "derived", "zip-divisions", `${name}.json`), "utf8")) as ZipDivisionShard;
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
    const shard = JSON.parse(readFileSync(join(dir, file), "utf8")) as ZipDivisionShard;
    for (const zip of Object.keys(shard.zips)) {
      const entry = zipDivisionEntryOf(shard, zip);
      if (entry !== null) out.set(zip, entry);
    }
  }
  return out;
}

/** The shard files of an index directory, by name: for trace and manifest checks. */
export function zipShardFiles(dir: string): string[] {
  return readdirSync(/* turbopackIgnore: true */ dir).filter((f) => SHARD_FILE.test(f)).sort();
}
