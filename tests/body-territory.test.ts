import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  BODY_TERRITORY_FILE,
  bodyIdsAtPoint,
  bodyIdsWithTerritory,
  type BodyTerritoryFile,
} from "../lib/registry/body-territory.ts";
import { bodiesAt } from "../lib/registry/resolve.ts";
import type { Body, Registry } from "../lib/registry/types.ts";

/**
 * **NH233 — A VERIFIED GOVERNMENT THAT COULD REACH NO READER.**
 * (2026-08-27, the coverage-truth session.)
 *
 * The Rocking K South Community Facilities District is a political taxing
 * subdivision of ZIP 85641 with its own board, its own resolution series and
 * its own levy. It rendered to nobody, and its card said **"Boundary not
 * published"** — a claim about the county recorder, who publishes the boundary
 * as a recorded plat.
 *
 * `bodiesAt` matched bodies on `ocdId`, and the smallest division containing
 * this district is `county:pima`: 9,200 square miles against 2,047 acres.
 * Attaching it there would have shown a district taxing 2,047 acres to every
 * reader in the county — a false claim in the direction that looks like
 * coverage. So `ocdId` stayed null, correctly, and the body was stranded.
 *
 * The geometry was being fetched the whole time and thrown away.
 * `pnpm cfd:territory --geojson` now emits the plat polygons and `bodiesAt`
 * point-tests them, which makes the answer EXACT in both directions — and the
 * second direction is the one these guards care about most.
 */

const ROOT = process.cwd();
const ROCKING_K = "curated:az/pima-rocking-k-south-cfd#governing";

function territory(): BodyTerritoryFile {
  return JSON.parse(readFileSync(join(ROOT, BODY_TERRITORY_FILE), "utf8")) as BodyTerritoryFile;
}

function registry(): Registry {
  return JSON.parse(readFileSync(join(ROOT, "lib", "registry", "registry.json"), "utf8")) as Registry;
}

/** A representative interior point of a feature, from its own ring. */
function centroid(ring: number[][]): [number, number] {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

test("the territory file is present, non-empty, and every polygon names a real body", () => {
  const t = territory();
  assert.ok(
    t.features.length > 0,
    `${BODY_TERRITORY_FILE} holds no polygons. An empty territory file un-governs every body it ` +
      "speaks for, silently — regenerate with `pnpm cfd:territory --geojson`.",
  );

  const ids = new Set(registry().bodies.map((b) => b.id));
  const dangling = [...bodyIdsWithTerritory(t)].filter((id) => !ids.has(id));
  assert.deepEqual(
    dangling,
    [],
    `${dangling.length} territory polygon(s) name a body the registry does not hold: ${dangling.join(", ")}`,
  );
});

test("every territory polygon cites the document that makes it that body's land", () => {
  /*
   * The territory is a CLAIM about which government's authority reaches a
   * reader's home. A polygon with no formation instrument behind it is a shape
   * somebody drew, and this repository does not render those.
   */
  const problems: string[] = [];
  for (const f of territory().features) {
    const p = f.properties;
    if (!p.bodyId) problems.push("a polygon names no body");
    if (!p.formationInstrument?.trim()) problems.push(`${p.plat}: no formation instrument`);
    if (!p.formationSource?.trim()) problems.push(`${p.plat}: no formation source`);
    if (!p.platSource?.trim()) problems.push(`${p.plat}: no plat source`);
    if (!Array.isArray(f.geometry.coordinates) || f.geometry.coordinates.length === 0) {
      problems.push(`${p.plat}: no geometry`);
    }
  }
  assert.deepEqual(problems, [], problems.join("\n  "));
});

test("a reader inside a Rocking K plat is governed by the district", () => {
  const t = territory();
  const rk = t.features.find((f) => f.properties.bodyId === ROCKING_K);
  assert.ok(rk, "the Rocking K territory must be in the file for this guard to mean anything");

  const inside = centroid(rk.geometry.coordinates[0]);
  const hits = bodyIdsAtPoint(inside, t);
  assert.ok(
    hits.has(ROCKING_K),
    `a point inside ${rk.properties.plat} did not resolve to the district that levies on it`,
  );
});

test("a reader elsewhere in 85641 is NOT governed by it", () => {
  /*
   * **THE HALF THAT MAKES THE FIRST ONE HONEST.**
   *
   * 10723 S Bear Table Tank Drive, Vail AZ 85641 — the address the tracker
   * carries, two geocoders agreeing to 8 m. It is in the district's ZIP and it
   * is NOT in the district, and a repair that showed Rocking K to every 85641
   * reader would have been the over-claim the null `ocdId` was protecting
   * against, arriving by a different door.
   */
  const outside: [number, number] = [-110.717866, 32.058723];
  const hits = bodyIdsAtPoint(outside, territory());
  assert.ok(
    !hits.has(ROCKING_K),
    "an address in 85641 but outside the district's plats must not be governed by it — a ZIP is " +
      "not a territory, and 2,047 acres is not a ZIP",
  );
});

test("bodiesAt returns a territory-bound body with no division at all", () => {
  /*
   * End to end through the real resolver, with NO divisions and NO features, so
   * nothing but the territory can be producing the hit. If this passes with an
   * empty division set, the territory path is genuinely doing the work.
   */
  const t = territory();
  const rk = t.features.find((f) => f.properties.bodyId === ROCKING_K)!;
  const inside = centroid(rk.geometry.coordinates[0]);

  const body = registry().bodies.find((b) => b.id === ROCKING_K);
  assert.ok(body, "the Rocking K body must be in the registry");
  assert.equal(body.ocdId, null, "its ocdId is deliberately null — no division is this small");

  const withTerritory = bodiesAt(inside, [], new Map(), [body as Body], undefined, t);
  assert.deepEqual(
    withTerritory.bodies.map((b) => b.id),
    [ROCKING_K],
    "the body must resolve from its own territory",
  );

  /* CONTROL: without the territory it resolves to nobody — which is the exact
   * state NH233 describes, replayed, so this guard cannot pass vacuously. */
  const withoutTerritory = bodiesAt(inside, [], new Map(), [body as Body], undefined, null);
  assert.deepEqual(
    withoutTerritory.bodies,
    [],
    "with no territory loaded the body must be stranded — if it resolves anyway, something else " +
      "is matching it and these guards are measuring the wrong thing",
  );
});
