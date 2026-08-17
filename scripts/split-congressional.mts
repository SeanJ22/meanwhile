/**
 * `pnpm cd:split` — cut the national congressional file into the three
 * covered states (g4 item 3, and the largest single load win in the item).
 *
 * ## The measurement that made this a script
 *
 * `public/geo/cd119.geojson` is **1.63 MB** — by an order of magnitude the
 * largest thing this screen can download, and larger than every other geo
 * file put together. It held all 441 districts in the country because
 * congressional boundaries were the one overlay that stayed national while
 * everything below Congress was already clipped per state.
 *
 * g4 item 3 makes the whole map per-state: only the ACTIVE state draws
 * districts, so a reader in Tucson has no use for Ohio's boundaries and no
 * reason to pay for them. Split, Arizona's share is ~9 KB.
 *
 * ## Pure derivation, no network
 *
 * This reads the committed national file and writes subsets of it. Nothing is
 * fetched, nothing is generalized, and no property is altered — the per-state
 * features are byte-identical to their national originals, so district truth
 * is unchanged by construction. `pnpm districts:fetch` remains the only thing
 * that talks to Census, and re-running it then re-running this is the whole
 * refresh procedure.
 *
 * The national file is deliberately LEFT IN PLACE. It is the input to this
 * script, and deleting a source to save space in a repository that ships its
 * own provenance would be the wrong trade.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Feature {
  type: "Feature";
  properties: { ocdId: string; state: string; district: string; label: string };
  geometry: unknown;
}

/** FIPS → USPS, the same table the rest of the geo pipeline uses. */
const STATES: Record<string, string> = { "04": "AZ", "33": "NH", "34": "NJ" };

const dir = join(process.cwd(), "public", "geo");
const source = join(dir, "cd119.geojson");

const national = JSON.parse(readFileSync(source, "utf8")) as {
  type: string;
  features: Feature[];
  [key: string]: unknown;
};

const all = national.features ?? [];
if (all.length === 0) {
  throw new Error(`${source} holds no features — refusing to write empty splits`);
}

let written = 0;
for (const [fips, abbr] of Object.entries(STATES)) {
  const features = all.filter((f) => f.properties.state === abbr);

  // An operation that can return nothing is asked what it returned. Every
  // covered state has at least one congressional district, so a zero here is
  // a real failure — a renamed property, a re-fetch that changed the state
  // code's case — and never a legitimate empty answer.
  if (features.length === 0) {
    throw new Error(
      `no congressional districts matched state ${abbr} in ${source} — ` +
        "refusing to write an empty file",
    );
  }

  const out = { ...national, features };
  const path = join(dir, `cd119-${fips}.geojson`);
  const body = JSON.stringify(out) + "\n";
  writeFileSync(path, body, "utf8");
  written += features.length;
  console.log(
    `${abbr} (${fips}): ${features.length} of ${all.length} districts → ` +
      `cd119-${fips}.geojson (${Math.round(body.length / 1024)} KB)`,
  );
}

console.log(
  `wrote ${written} of ${all.length} national districts across ` +
    `${Object.keys(STATES).length} states; ` +
    `national file kept at ${Math.round(readFileSync(source).length / 1024)} KB`,
);
