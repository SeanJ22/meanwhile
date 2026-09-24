/**
 * **THE ZIP INDEX, FOR EVERY ZIP CODE IN THE COUNTRY.** (2026-09-23.)
 *
 *   node_modules/.bin/tsx scripts/build-zip-division-shards.mts [--tiger=<dir>]
 *
 * Sean's direction: new states and areas "will be added rapidly, it needs to be
 * able to track and keep up everywhere, not just a small subset", and adding
 * one must not be a code change.
 *
 * The index it replaced (kept as the frozen baseline
 * `tests/fixtures/zip-division-ids-three-state.json`) named a government for a
 * ZIP only when this repository had committed that government's polygon, and
 * the committed geometry is clipped to three states' pilot counties — so it
 * held 279 ZIPs. The national inputs already exist: `zip-governments.json` places all 33,791
 * ZCTAs against every county, place, county subdivision and school district in
 * the country (`pnpm zipgov:build`). What was missing is each government's OCD
 * id without a committed polygon, and that comes from the Census names with the
 * same constructors the committed geometry uses (`lib/ocd/divisions.ts`, called
 * exactly as `scripts/fetch-districts.ts` calls them):
 *
 * ```
 *   county   countyIdentity(STATEFP, NAME)
 *   place    placeIdentity(STATEFP, NAME, LSAD)
 *   cousub   subdivisionIdentity(STATEFP, NAMELSADCO, NAMELSAD, LSAD)
 *   school   schoolIdentity(STATEFP, NAME)      (unified, elementary, secondary)
 * ```
 *
 * ## Two governments, one constructed id
 *
 * The committed geometry's rule (`fetch-districts.ts`, RULING 80) holds: every
 * side of a collision is disambiguated with its Census GEOID, never one kept
 * bare and one suffixed. The one exception is the one that rule already names:
 * an id that is ALREADY COMMITTED never moves, because the registry, bodies and
 * sources join on it — so a committed (layer, GEOID) keeps its committed id and
 * only the other sides take the suffix. Every such collision is printed by
 * name, never renamed silently.
 *
 * ## What is written
 *
 * One shard per two-digit ZIP prefix under `data/derived/zip-divisions/`, each
 * holding its ZIPs' divisions once and referring to them by position, and an
 * `index.json` naming every shard with its sha256, ZIP count and states. One
 * national file would be ~34 MB — too large to parse per request; a shard is
 * about a hundred kilobytes. One per ZIP3 would be ~900 files, each traced
 * into every route that can be asked for any ZIP, which is what the bundle
 * budget's file count exists to catch (R23); ~100 keeps it near its baseline.
 * A ZCTA's states come from its county edges, so a code that crosses a state
 * line is listed under each state it reaches.
 *
 * Two assertions, and the build refuses on either: no two governments share an
 * id (bar the one shared id the committed geometry already holds, carried and
 * printed rather than created), and no ZIP loses a division (or a partial
 * marking) that the committed geometry still carries — measured against the
 * three-state baseline and against the previous build. An id the baseline kept
 * after the geometry re-minted it is stale there, and printed as corrected.
 *
 * Measured 2026-09-23: 33,791 ZIPs in 99 shards (~8.7 MB, the largest 256 KB;
 * ZIP for ZIP identical to the first, one-per-ZIP3 layout), 85,541 governments,
 * every edge given an id; 278 name collisions, 16 of whose committed sides kept
 * their ids; one inherited shared id (New Jersey's Union Township unified and
 * elementary school districts); one stale id corrected (New Jersey's Washington
 * Township school districts, which the registry already keys by GEOID suffix).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readAllZipDivisions, zipShardOf, type ZipDivisionEntry } from "../lib/geo/zip-division-index.ts";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";
import { LAYERS, nationalDivisionIds } from "./lib/national-division-ids.mts";

const ROOT = process.cwd();
const TIGER = process.argv.find((a) => a.startsWith("--tiger="))?.slice(8) ?? join(ROOT, ".cache", "tiger");
const OUT = join(ROOT, "data", "derived", "zip-divisions");

/* ------------------------------------------------------------ every government's id, nationally (scripts/lib/national-division-ids.mts) */
const national = nationalDivisionIds(ROOT, TIGER);
const { pinned, collisions, pinnedKept, inheritedCollapses, pinsNotNational, rowsByLayer } = national;
const finalId = new Map([...national.divisions].map(([key, division]) => [key, division.ocdId]));

/* ------------------------------------------------------------ every ZIP */
const zipGov = JSON.parse(readFileSync(join(ROOT, "data", "derived", "zip-governments.json"), "utf8")) as {
  zips: Record<string, { layer: string; id: string; samples: number }[]>;
};

interface ZipEntry {
  readonly ids: string[];
  readonly partial: string[];
  readonly samples: number;
  readonly states: string[];
}
const byShard = new Map<string, Map<string, ZipEntry>>();
const unmappedByLayer: Record<string, number> = {};
let edges = 0;
let noCountyEdge = 0;
for (const [zip, list] of Object.entries(zipGov.zips)) {
  const counties = list.filter((e) => e.layer === "county");
  const total = counties.reduce((n, e) => n + e.samples, 0);
  const states = [...new Set(counties.map((e) => FIPS_TO_STATE[e.id.slice(0, 2)]?.postal).filter((s): s is string => typeof s === "string"))].sort();
  const ids = new Set<string>();
  const partial = new Set<string>();
  for (const e of list) {
    edges++;
    const id = finalId.get(`${e.layer}:${e.id}`);
    if (id === undefined) {
      unmappedByLayer[e.layer] = (unmappedByLayer[e.layer] ?? 0) + 1;
      continue;
    }
    ids.add(id);
    // RULING 71: a zip whose total cannot be established calls nothing certain.
    if (total === 0 || e.samples < total) partial.add(id);
  }
  if (total === 0) noCountyEdge++;
  if (ids.size === 0) continue;
  const shard = zipShardOf(zip);
  const map = byShard.get(shard) ?? new Map<string, ZipEntry>();
  map.set(zip, { ids: [...ids].sort(), partial: [...partial].sort(), samples: total, states });
  byShard.set(shard, map);
}

/* ------------------------------------------------------------ no ZIP loses what an earlier index gave it */
const baseline = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "zip-division-ids-three-state.json"), "utf8")) as {
  zips: Record<string, string[]>;
  partial: Record<string, string[]>;
};
// The previous build, when there is one: a rebuild may add, and may never drop, a committed id.
const previous = existsSync(join(OUT, "index.json")) ? readAllZipDivisions(ROOT) : new Map<string, ZipDivisionEntry>();
/*
 * An id the baseline carries that the committed geometry no longer does is the
 * baseline being stale, not a loss: New Jersey's two Washington Township
 * school districts were re-minted with their GEOID suffixes (and the registry's
 * bodies follow the suffixed ids) while the three-state index kept the bare
 * one, which joins to no body. Those are printed as corrected. Losing an id the
 * committed geometry still carries refuses the build, against either the
 * baseline or the previous build; an id only the national layers minted may
 * change with a new Census vintage, and is counted.
 */
const committedIds = new Set(pinned.values());
const losses: string[] = [];
const corrected = new Set<string>();
let changedSincePrevious = 0;
function compare(zip: string, before: readonly string[], beforePartial: readonly string[], fromBaseline: boolean): void {
  const now = byShard.get(zipShardOf(zip))?.get(zip);
  const ids = new Set(now?.ids ?? []);
  const partial = new Set(now?.partial ?? []);
  for (const id of before) {
    if (ids.has(id)) continue;
    if (committedIds.has(id)) losses.push(`${zip} loses ${id}`);
    else if (fromBaseline) corrected.add(id);
    else changedSincePrevious++;
  }
  for (const id of beforePartial) if (!partial.has(id) && committedIds.has(id)) losses.push(`${zip} no longer marks ${id} partial`);
}
for (const [zip, ids] of Object.entries(baseline.zips)) compare(zip, ids, baseline.partial[zip] ?? [], true);
for (const [zip, e] of previous) compare(zip, e.ids, e.partial, false);
if (losses.length > 0) {
  throw new Error(`${losses.length} division(s) an earlier index gives a ZIP would be lost:\n  ${losses.slice(0, 20).join("\n  ")}`);
}
if (changedSincePrevious > 0) console.log(`  ${changedSincePrevious} national-layer id(s) a ZIP carried in the previous build are not carried now (a new Census vintage renames or re-draws them).`);

/* ------------------------------------------------------------ write */
if (existsSync(OUT)) for (const f of readdirSync(OUT)) if (f.endsWith(".json")) rmSync(join(OUT, f));
mkdirSync(OUT, { recursive: true });
const index: Record<string, { readonly sha256: string; readonly zips: number; readonly states: readonly string[] }> = {};
const statesToShards: Record<string, string[]> = {};
let divisionsWritten = 0;
for (const shard of [...byShard.keys()].sort()) {
  const zips = byShard.get(shard)!;
  const divisions = [...new Set([...zips.values()].flatMap((z) => z.ids))].sort();
  const at = new Map(divisions.map((d, i) => [d, i]));
  const payload = {
    formatVersion: 1,
    divisions,
    zips: Object.fromEntries([...zips].sort(([a], [b]) => a.localeCompare(b)).map(([zip, z]) => [zip, z.ids.map((id) => at.get(id)!)])),
    partial: Object.fromEntries(
      [...zips].filter(([, z]) => z.partial.length > 0).sort(([a], [b]) => a.localeCompare(b)).map(([zip, z]) => [zip, z.partial.map((id) => at.get(id)!)]),
    ),
    zipSamples: Object.fromEntries([...zips].sort(([a], [b]) => a.localeCompare(b)).map(([zip, z]) => [zip, z.samples])),
  };
  const text = `${JSON.stringify(payload)}\n`;
  writeFileSync(join(OUT, `${shard}.json`), text, "utf8");
  const states = [...new Set([...zips.values()].flatMap((z) => z.states))].sort();
  index[shard] = { sha256: createHash("sha256").update(text).digest("hex"), zips: zips.size, states };
  for (const st of states) (statesToShards[st] ??= []).push(shard);
  divisionsWritten += divisions.length;
}
const zipsWritten = Object.values(index).reduce((n, s) => n + s.zips, 0);
writeFileSync(
  join(OUT, "index.json"),
  `${JSON.stringify(
    {
      formatVersion: 1,
      generatedAt: today(),
      source: "data/derived/zip-governments.json (national TIGER lattice sampling), with each government's OCD id built from the Census names by lib/ocd/divisions.ts",
      note:
        "Every division whose territory reaches each ZCTA, one shard per two-digit ZIP prefix. Not a claim that a reader at the ZIP is governed by all of them: `partial` lists those covering only part of the ZIP's sampled area (RULING 71). Committed OCD ids never move; a name collision elsewhere is suffixed with the Census GEOID.",
      counts: {
        zips: zipsWritten,
        shards: Object.keys(index).length,
        divisionReferences: divisionsWritten,
        edges,
        edgesWithNoOcdId: unmappedByLayer,
        zipsWithAPartialDivision: [...byShard.values()].reduce((n, zips) => n + [...zips.values()].filter((z) => z.partial.length > 0).length, 0),
        zipsWithNoCountyEdge: noCountyEdge,
        collisions: collisions.length,
        committedIdsKept: pinnedKept,
        committedIdsNotInTheNationalLayers: pinsNotNational.length,
      },
      /** Committed ids that already name more than one government, carried as committed rather than renamed. */
      inheritedSharedIds: Object.fromEntries([...inheritedCollapses].map(([id, holders]) => [id, [...holders].sort()])),
      /** Ids the three-state baseline carried that the committed geometry no longer does: stale there, corrected here. */
      staleInTheOldIndex: [...corrected].sort(),
      shards: index,
      statesToShards,
    },
    null,
    1,
  )}\n`,
  "utf8",
);

console.log(`Census rows read: ${LAYERS.map((l) => `${l} ${rowsByLayer[l]}`).join(", ")}`);
console.log(`governments with an id: ${finalId.size}; committed ids pinned: ${pinned.size}`);
console.log(`name collisions: ${collisions.length} (committed sides kept: ${pinnedKept})`);
for (const c of collisions.filter((c) => /state:(az|nh|nj)\//.test(c)).slice(0, 25)) console.log(`  ${c}`);
for (const [id, holders] of inheritedCollapses) console.log(`INHERITED shared id (committed geometry, not created here): ${id} names ${[...holders].join(" and ")}`);
if (pinsNotNational.length > 0) console.log(`committed ids with no row in the 2023 national layers (a vintage difference, kept out rather than guessed): ${pinsNotNational.join(", ")}`);
console.log(`ZIPs written: ${zipsWritten} in ${Object.keys(index).length} shards; the baseline's ${Object.keys(baseline.zips).length} ZIPs and the previous build's ${previous.size} keep every committed division they had; stale ids corrected: ${[...corrected].join(", ") || "none"}`);
console.log(`edges with no id: ${JSON.stringify(unmappedByLayer)}`);
// Every ZIP written either reaches a county or is counted as reaching none (RULING 159: a count carries its denominator).
console.log(floorLine(floored("ZIPs written that reach a county", "the national ZIP shards", zipsWritten, zipsWritten - noCountyEdge)));
