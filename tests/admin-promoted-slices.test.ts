import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import type { GeographyType } from "../lib/census-geography/contract.ts";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";
import { buildCensusDistrictEdge } from "../lib/census-geography/state-publication.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store-local.ts";
import { createLookup } from "../lib/census-geography/lookup.ts";
import { CENSUS_GEO_RECORD_CLASS, censusGeographyScope } from "../lib/census-geography/publication.ts";
import {
  containersOfCode,
  oneContainer,
  registryBodies,
  stateContainers,
  type ReadOnlyQuery,
  type Statement,
} from "../lib/control-plane/admin-view/promoted-slices.ts";

const dataset = JSON.parse(readFileSync("lib/census-geography/bootstrap-az.json", "utf8")) as BuiltDataset;
const lookup = createLookup(dataset, "cv-test");
const TYPES: readonly GeographyType[] = ["county", "congressional_district", "cbsa", "state_leg_upper", "state_leg_lower"];

const directory = mkdtempSync(join(tmpdir(), "admin-census-artifacts-"));
const store = new LocalFileArtifactStore(directory);
const index = await buildCensusDistrictEdge(structuredClone(dataset), "fixture", store);
after(() => rmSync(directory, { recursive: true, force: true }));

function postgresOver(ds: BuiltDataset | null, seen: Statement[] = []): ReadOnlyQuery {
  return async statements => {
    seen.push(...statements);
    return statements.map(() => ds === null ? [] : [{ version_id: "cv-test", payload: index }]);
  };
}

const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, "en", { numeric: true });

test("a state's slice holds exactly the refs the whole lookup lists for that state, type by type", async () => {
  const slice = await stateContainers("az", TYPES, false, postgresOver(dataset), store);
  assert.equal(slice.kind, "HELD");
  if (slice.kind !== "HELD") return;
  assert.equal(slice.versionId, "cv-test");
  assert.deepEqual(slice.value.scopes.map((s) => s.type).sort(), [...TYPES].sort());
  for (const type of TYPES) {
    const whole = (await lookup.enumerateGroupings(type)).instances.filter((g) => g.stateAbbr === "AZ" || g.memberStates.includes("AZ")).sort(byLabel);
    const sliced = slice.value.containers.filter((c) => c.ref.type === type).map((c) => c.ref).sort(byLabel);
    assert.ok(whole.length > 0, `the bootstrap lists ${type}`);
    assert.deepEqual(sliced, whole, type);
  }
  assert.ok(slice.value.containers.every((c) => c.overlaps === null), "a list asks for no codes");
});

test("one container carries the lookup's own codes and plan", async () => {
  const pima = dataset.scopes.find((s) => s.type === "county")!.groupings.find((g) => g.geoid === "04019")!;
  assert.ok(pima, "Pima County is in the bootstrap");
  const slice = await oneContainer("county", "04019", postgresOver(dataset), store);
  assert.equal(slice.kind, "HELD");
  if (slice.kind !== "HELD") return;
  const whole = await lookup.zctasForGrouping({ type: "county", geoid: "04019", version: "county:2020" });
  assert.equal(slice.value.containers.length, 1);
  assert.deepEqual(slice.value.containers[0]!.ref, whole.geography);
  assert.deepEqual(slice.value.containers[0]!.overlaps, whole.overlaps.map((o) => ({ zcta5: o.zcta5, whole: o.whole, fraction: o.fraction })));
  assert.equal(slice.value.containers[0]!.plan, whole.version.plan);

  const none = await oneContainer("county", "04999", postgresOver(dataset), store);
  assert.equal(none.kind, "HELD", "a geoid the pointer does not carry is answered, with no container, and its scope named");
  if (none.kind === "HELD") {
    assert.equal(none.value.containers.length, 0);
    assert.ok(none.value.scopes.some((s) => s.type === "county"));
  }
});

test("a code's memberships match the lookup's reverse index, and a code outside the universe says so", async () => {
  const zcta = "85701";
  const slice = await containersOfCode(zcta, TYPES, postgresOver(dataset), store);
  assert.equal(slice.kind, "HELD");
  if (slice.kind !== "HELD") return;
  assert.equal(slice.value.known, true);
  const whole = await lookup.groupingsForZcta(zcta);
  const key = (m: { type: string; geoid: string; whole: boolean; fraction: number | null }) => `${m.type}|${m.geoid}|${m.whole}|${m.fraction}`;
  assert.deepEqual(
    slice.value.containers.map((c) => key({ type: c.ref.type, geoid: c.ref.geoid, whole: c.overlaps![0]!.whole, fraction: c.overlaps![0]!.fraction })).sort(),
    whole.memberships.map((m) => key({ type: m.geography.type, geoid: m.geography.geoid, whole: m.whole, fraction: m.fraction })).sort(),
  );
  assert.ok(slice.value.containers.every((c) => c.overlaps!.length === 1 && c.overlaps![0]!.zcta5 === zcta), "each carries that code's overlap alone");

  const outside = await containersOfCode("00000", TYPES, postgresOver(dataset), store);
  assert.equal(outside.kind, "UNREAD", "a ZIP missing from the held state graph cannot establish coverage");
});

test("no pointer is 'not published', never an empty list", async () => {
  const q = postgresOver(null);
  assert.equal((await stateContainers("AZ", TYPES, false, q)).kind, "NOT_PUBLISHED");
  assert.equal((await oneContainer("county", "04019", q)).kind, "NOT_PUBLISHED");
  assert.equal((await containersOfCode("85701", TYPES, q)).kind, "NOT_PUBLISHED");
  assert.equal((await registryBodies(q)).kind, "NOT_PUBLISHED");
});

test("a failed read names the error and never the connection", async () => {
  const failing: ReadOnlyQuery = async () => {
    throw new Error("could not connect to postgres://reader:secret@ep-example.neon.tech/neondb");
  };
  for (const read of [stateContainers("AZ", TYPES, true, failing), oneContainer("county", "04019", failing), registryBodies(failing)]) {
    const r = await read;
    assert.equal(r.kind, "UNREAD");
    if (r.kind === "UNREAD") {
      assert.match(r.detail, /\(Error\)/);
      assert.doesNotMatch(r.detail, /postgres:|secret|neon\.tech/);
    }
  }
  assert.equal((await stateContainers("AZ", TYPES, false, null)).kind, "UNREAD", "no reader store is not an empty state");
});

test("every geography statement reads only the compact promoted index", async () => {
  const seen: Statement[] = [];
  await stateContainers("az", ["county"], true, postgresOver(dataset, seen), store);
  await oneContainer("county", "04019", postgresOver(dataset, seen), store);
  await containersOfCode("85701", TYPES, postgresOver(dataset, seen), store);
  for (const s of seen) {
    assert.equal(s.params[0], CENSUS_GEO_RECORD_CLASS);
    assert.equal(s.params[1], censusGeographyScope("AZ"));
    assert.match(s.text, /^(SELECT|WITH) /, "reads only");
  }
  assert.equal(seen.length, 3);
  assert.ok(seen.every(s => s.params.length === 2 && !s.text.includes("jsonb_array_elements")));
});

test("the registry slice carries each body's six fields and skips a row with no id", async () => {
  const q: ReadOnlyQuery = async (statements) =>
    statements.map((s) =>
      s.text.startsWith("SELECT current_version_id")
        ? [{ version_id: "cv-registry" }]
        : [
            { id: "b1", name: "Board", ocd_id: "ocd-division/country:us/state:az/county:pima", also_serves: ["x"], coverage_status: "NOT_ATTEMPTED", body_class: "GOVERNING" },
            { id: null, name: "no id" },
            { id: "b2", name: null, ocd_id: null, also_serves: null, coverage_status: { state: "WALKED" }, body_class: null },
          ],
    );
  const r = await registryBodies(q);
  assert.equal(r.kind, "HELD");
  if (r.kind !== "HELD") return;
  assert.equal(r.versionId, "cv-registry");
  assert.deepEqual(r.value, [
    { id: "b1", name: "Board", ocdId: "ocd-division/country:us/state:az/county:pima", alsoServesOcdIds: ["x"], coverageStatus: "NOT_ATTEMPTED", bodyClass: "GOVERNING" },
    { id: "b2", name: null, ocdId: null, alsoServesOcdIds: [], coverageStatus: { state: "WALKED" }, bodyClass: null },
  ]);
});
