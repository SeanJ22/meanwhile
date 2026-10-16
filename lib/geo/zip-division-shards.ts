import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { postalArea } from "./postal.ts";

export interface ZipDivisionShard {
  readonly divisions: readonly string[];
  readonly zips: Readonly<Record<string, readonly number[]>>;
  readonly partial: Readonly<Record<string, readonly number[]>>;
  readonly zipSamples: Readonly<Record<string, number>>;
}

export interface RawZipDivisionEntry {
  readonly ids: readonly string[];
  readonly partial: readonly string[];
  readonly samples: number;
}

const SHARDS_KEPT = 24;
const shards = new Map<string, Promise<ZipDivisionShard | null>>();

export function readZipDivisionShard(name: string): Promise<ZipDivisionShard | null> {
  const held = shards.get(name);
  if (held !== undefined) {
    shards.delete(name);
    shards.set(name, held);
    return held;
  }
  const read = readFile(join(process.cwd(), "data", "derived", "zip-divisions", `${name}.json`), "utf8")
    .then((text) => JSON.parse(text) as ZipDivisionShard)
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

export function zipDivisionEntryOf(shard: ZipDivisionShard, zip: string): RawZipDivisionEntry | null {
  const refs = shard.zips[zip];
  if (refs === undefined) return null;
  const ids = refs.map((i) => shard.divisions[i]);
  return {
    ids,
    partial: ids.filter(id => !/^ocd-division\/country:us(?:\/(?:state|territory|district):[a-z]{2})?$/.test(id)),
    samples: shard.zipSamples[zip] ?? 0,
  };
}

export async function heldZipStates(zip: string): Promise<readonly string[] | null> {
  if (!/^\d{5}$/.test(zip)) return null;
  const lookupZip = postalArea(zip)?.zcta ?? zip;
  const shard = await readZipDivisionShard(lookupZip.slice(0, 2));
  const entry = shard && zipDivisionEntryOf(shard, lookupZip);
  if (!entry) return null;
  const states = [...new Set(entry.ids.flatMap(id =>
    /^ocd-division\/country:us\/(?:state|territory|district):([a-z]{2})(?:\/|$)/i.exec(id)?.[1].toUpperCase() ?? []))].sort();
  return states.length ? states : null;
}
