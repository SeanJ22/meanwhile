/**
 * **WHICH STATE A ZIP IS IN, AND WHETHER THE NATIONAL ZIP INDEX KNOWS IT — FAST.** (S11.)
 *
 * The reader's index (`data/derived/zip-divisions/<NN>.json`, one shard per
 * two-digit ZIP prefix) answers both from one file read. `zipDivisionEntry`
 * answers more (it also asks the published Census slice for districts and
 * school divisions, one database read per ZIP), which is right for a reader
 * page and far too slow for checking two thousand pasted ZIPs: measured 47.9 s
 * for the 1,948 ZIPs of the Cook toss-up file. A state needs none of that, so
 * this reads the shard and nothing else. The folder is named in literal
 * segments so the bundler traces exactly the shards (R23).
 *
 * A shard that cannot be read answers "unknown" for its ZIPs and is not kept,
 * so a transient failure never becomes permanent for the process.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface Shard {
  readonly divisions: readonly string[];
  readonly zips: Readonly<Record<string, readonly number[]>>;
}

const shards = new Map<string, Promise<Shard | null>>();

function shardFor(prefix: string): Promise<Shard | null> {
  const held = shards.get(prefix);
  if (held !== undefined) return held;
  const read = readFile(join(process.cwd(), "data", "derived", "zip-divisions", `${prefix}.json`), "utf8")
    .then((text) => JSON.parse(text) as Shard)
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
