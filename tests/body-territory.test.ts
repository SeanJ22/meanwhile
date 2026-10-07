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

/** A body with no division reaches a reader through its recorded plat polygon, point-tested exactly in both directions. */

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
  /* An address in the district's ZIP that is not in the district must not get it. */
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

  /* Control: without the territory it resolves to nobody, so this guard cannot pass vacuously. */
  const withoutTerritory = bodiesAt(inside, [], new Map(), [body as Body], undefined, null);
  assert.deepEqual(
    withoutTerritory.bodies,
    [],
    "with no territory loaded the body must be stranded — if it resolves anyway, something else " +
      "is matching it and these guards are measuring the wrong thing",
  );
});
