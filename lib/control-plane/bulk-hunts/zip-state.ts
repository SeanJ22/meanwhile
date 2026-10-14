/**
 * A ZIP's state, and whether the national ZIP index knows it, from one shard
 * read (`data/derived/zip-divisions/<NN>.json`). `zipDivisionEntry` is far too
 * slow for thousands of pasted ZIPs. The folder is named in literal segments
 * so the bundler traces exactly the shards. An unreadable shard answers
 * "unknown" and is not cached.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ZipShard {
  readonly divisions: readonly string[];
  readonly zips: Readonly<Record<string, readonly number[]>>;
}

const shards = new Map<string, Promise<ZipShard | null>>();

function shardFor(prefix: string): Promise<ZipShard | null> {
  const held = shards.get(prefix);
  if (held !== undefined) return held;
  const read = readFile(join(process.cwd(), "data", "derived", "zip-divisions", `${prefix}.json`), "utf8")
    .then((text) => JSON.parse(text) as ZipShard)
    .catch(() => {
      shards.delete(prefix);
      return null;
    });
  shards.set(prefix, read);
  return read;
}

const STATE_IN_ID = /(?:^|\/)state:([a-z]{2})(?:\/|$)/;

/** The two-letter state of a ZIP, or null when the index does not carry it. */
export async function stateOfZip(zip: string): Promise<string | null> {
  if (!/^\d{5}$/.test(zip)) return null;
  const shard = await shardFor(zip.slice(0, 2));
  const refs = shard?.zips[zip];
  if (shard === null || refs === undefined) return null;
  for (const i of refs) {
    const hit = STATE_IN_ID.exec(shard.divisions[i] ?? "");
    if (hit) return hit[1].toUpperCase();
  }
  return null;
}

/** The ids of every division whose territory reaches this ZIP in the national ZIP index; null when the index has no such ZIP or its shard could not be read. */
export async function divisionIdsOfZip(zip: string): Promise<readonly string[] | null> {
  if (!/^\d{5}$/.test(zip)) return null;
  const shard = await shardFor(zip.slice(0, 2));
  const refs = shard?.zips[zip];
  if (shard === null || refs === undefined) return null;
  return refs.map((i) => shard.divisions[i]).filter((id): id is string => typeof id === "string");
}

const JURISDICTION_IN_ID = /(?:^|\/)(?:state|district|territory):([a-z]{2})(?:\/|$)/;
let countsByState: Promise<ReadonlyMap<string, number> | null> | null = null;

/**
 * How many ZIPs the national ZIP index carries for each state or territory (lower-case code). Reads the shards once per
 * process and keeps only the counts, never the shards; null when the index or a shard could not be read (our gap, not kept).
 */
export function zipCountsByState(): Promise<ReadonlyMap<string, number> | null> {
  if (countsByState !== null) return countsByState;
  const out = new Map<string, number>();
  const read = visitZipShards((shard) => {
    for (const refs of Object.values(shard.zips)) {
      for (const i of refs) {
        const hit = JURISDICTION_IN_ID.exec(shard.divisions[i] ?? "");
        if (hit) {
          out.set(hit[1], (out.get(hit[1]) ?? 0) + 1);
          break;
        }
      }
    }
  }).then(() => out as ReadonlyMap<string, number>)
    .catch(() => {
      countsByState = null;
      return null;
    });
  countsByState = read;
  return read;
}

/** Reads every shard of the national ZIP index in turn and hands it to `visit`; no shard is kept. */
export async function visitZipShards(visit: (shard: ZipShard) => void): Promise<void> {
  const index = JSON.parse(await readFile(join(process.cwd(), "data", "derived", "zip-divisions", "index.json"), "utf8")) as { shards: Record<string, unknown> };
  for (const name of Object.keys(index.shards).sort()) {
    visit(JSON.parse(await readFile(join(process.cwd(), "data", "derived", "zip-divisions", `${name}.json`), "utf8")) as ZipShard);
  }
}
