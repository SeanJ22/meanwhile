/**
 * **WHAT EACH STATE HOLDS, BEFORE WE HOLD ANY OF IT.** (2026-09-23.)
 *
 *   node_modules/.bin/tsx scripts/build-state-census-denominators.mts
 *
 * Admin tracks every state, registered or not (Sean: "it needs to be able to
 * track and keep up everywhere, not just a small subset"). A state nobody has
 * registered still has a known universe, and that is what its row shows
 * instead of a zero: the Census of Governments units by type, how many of them
 * the national lattice placed on at least one ZIP, and how many ZIP codes the
 * state reaches. All of it comes from files already built nationally —
 * `census-unit-zips.json` (the 2022 Census of Governments joined to the
 * lattice) and `zip-governments.json` (every ZCTA's county edges) — so adding a
 * state needs no code and no new source.
 *
 * About 18 KB, small enough for a page to import. It is written beside the
 * Admin code that reads it rather than under data/derived: nothing a reader
 * sees uses it, and every file under data/derived is a reader holding.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();

const units = JSON.parse(readFileSync(join(ROOT, "data", "derived", "census-unit-zips.json"), "utf8")) as {
  units: { readonly type: string; readonly state: string; readonly zips: readonly string[] }[];
};
const national = JSON.parse(readFileSync(join(ROOT, "data", "derived", "zip-governments.json"), "utf8")) as {
  zips: Record<string, { readonly layer: string; readonly id: string }[]>;
};

type Row = { governments: Record<string, { total: number; onAZip: number }>; zips: number };
const byState = new Map<string, Row>();
const row = (st: string): Row => {
  const r = byState.get(st) ?? { governments: {}, zips: 0 };
  byState.set(st, r);
  return r;
};

let noState = 0;
for (const u of units.units) {
  if (!/^[A-Z]{2}$/.test(u.state)) {
    noState++;
    continue;
  }
  const r = row(u.state);
  const t = (r.governments[u.type] ??= { total: 0, onAZip: 0 });
  t.total++;
  if (u.zips.length > 0) t.onAZip++;
}
for (const edges of Object.values(national.zips)) {
  const states = new Set(edges.filter((e) => e.layer === "county").map((e) => FIPS_TO_STATE[e.id.slice(0, 2)]?.postal).filter((s): s is string => typeof s === "string"));
  for (const st of states) row(st).zips++;
}

const states = Object.fromEntries([...byState].sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(
  join(ROOT, "app", "(admin)", "_mw", "data", "state-census-denominators.json"),
  `${JSON.stringify(
    {
      generatedAt: today(),
      source: "data/derived/census-unit-zips.json (2022 Census of Governments on the national ZIP lattice) and data/derived/zip-governments.json",
      note: "Per state: Census of Governments units by type (total, and placed on at least one ZIP), and the ZIP codes whose area reaches the state. A universe known from the Census, not a count of anything this product holds.",
      unitsWithNoState: noState,
      states,
    },
    null,
    1,
  )}\n`,
  "utf8",
);
// Every Census unit read is either placed in a state or counted as having none (RULING 159: a count carries its denominator).
console.log(floorLine(floored("Census of Governments units placed in a state", "data/derived/census-unit-zips.json", units.units.length, units.units.length - noState)));
console.log(`states and territories written: ${byState.size}`);
