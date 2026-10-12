/**
 * Which state and counties a ZIP reaches, so a slice can be a county or a state. The reader's own ZIP index
 * (`data/derived/zip-divisions/<NN>.json`, one shard per two-digit prefix, the same files `bulk-hunts/zip-state.ts` reads) names
 * every division whose territory reaches each ZIP; the state and county ids are in those names. A ZIP that reaches two counties is
 * in both. The folder is spelled in literal path segments so the bundler traces exactly the shards.
 *
 * A shard that cannot be read answers "unknown" for its ZIPs and is not kept, so one failed read is never permanent.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PlaceFilter } from "./types.ts";
import { stateOfDivision, type ZipPlaces } from "./slice.ts";

export interface PlaceIndex {
  /** The places of each ZIP the index knows; a ZIP it does not know is simply absent. */
  readonly of: (zips: readonly string[]) => Promise<ReadonlyMap<string, ZipPlaces>>;
  /** Every ZIP in a state or county, or null when the index cannot say (a shard was unreadable). */
  readonly zipsIn: (place: PlaceFilter) => Promise<readonly string[] | null>;
}

interface Shard {
  readonly divisions: readonly string[];
  readonly zips: Readonly<Record<string, readonly number[]>>;
}
const COUNTY_IN_ID = /^(ocd-division\/country:us\/state:[a-z]{2}\/county:[^/]+)(?:\/|$)/;

function placesFromShard(shard: Shard, zip: string): ZipPlaces | null {
  const refs = shard.zips[zip];
  if (refs === undefined) return null;
  let state: string | null = null;
  const counties = new Set<string>();
  for (const i of refs) {
    const id = shard.divisions[i] ?? "";
    state = state ?? stateOfDivision(id);
    const county = COUNTY_IN_ID.exec(id)?.[1];
    if (county !== undefined) counties.add(county);
  }
  return { state, counties: [...counties].sort() };
}

/** A place index over shard reads. `readShard` is injectable so tests and scripts can supply their own. */
export function shardPlaceIndex(readShard: (prefix: string) => Promise<Shard | null>): PlaceIndex {
  const held = new Map<string, Promise<Shard | null>>();
  const shard = (prefix: string) => {
    const known = held.get(prefix);
    if (known !== undefined) return known;
    const read = readShard(prefix).catch(() => null).then((s) => { if (s === null) held.delete(prefix); return s; });
    held.set(prefix, read);
    return read;
  };
  /** Every state and county with its ZIPs, built once. Null when a shard that should exist could not be read. */
  let everything: Promise<Map<string, string[]> | null> | null = null;
  const scanAll = async (): Promise<Map<string, string[]> | null> => {
    const out = new Map<string, string[]>();
    for (let n = 0; n < 100; n += 1) {
      const prefix = String(n).padStart(2, "0");
      const s = await shard(prefix);
      // 09 is military mail and has no shard; any other missing shard is a failed read, so the answer is unknown, not short.
      if (s === null) { if (prefix === "09") continue; return null; }
      for (const zip of Object.keys(s.zips)) {
        const p = placesFromShard(s, zip);
        if (p === null) continue;
        const keys = [...(p.state === null ? [] : [`state:${p.state}`]), ...p.counties.map((c) => `county:${c}`)];
        for (const key of keys) (out.get(key) ?? out.set(key, []).get(key)!).push(zip);
      }
    }
    for (const zips of out.values()) zips.sort();
    return out;
  };
  return {
    async of(zips) {
      const out = new Map<string, ZipPlaces>();
      for (const zip of new Set(zips)) {
        if (!/^\d{5}$/.test(zip)) continue;
        const s = await shard(zip.slice(0, 2));
        const places = s === null ? null : placesFromShard(s, zip);
        if (places !== null) out.set(zip, places);
      }
      return out;
    },
    async zipsIn(place) {
      if (place.kind !== "state" && place.kind !== "county") return null;
      everything ??= scanAll();
      const found = await everything;
      if (found === null) { everything = null; return null; }
      return found.get(`${place.kind}:${place.id}`) ?? [];
    },
  };
}

/** The live index: reads the shards from the deployed data folder. */
export const liveZipPlaceIndex: PlaceIndex = shardPlaceIndex(async (prefix) =>
  JSON.parse(await readFile(join(process.cwd(), "data", "derived", "zip-divisions", `${prefix}.json`), "utf8")) as Shard);
