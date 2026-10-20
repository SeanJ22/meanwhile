import assert from "node:assert/strict";
import test from "node:test";
import { governingRosterHoldersForDivision } from "../lib/registry/body-rosters.ts";
import { representationForDivision } from "../lib/registry/representation.ts";
import { coverageAt, seatHoldersForDivision } from "../lib/registry/server.ts";
import { indexByDivision } from "../lib/officials/lookup.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";
import { installFederalDirectory, installStateLegislators } from "./helpers/promoted-fixtures.ts";
import { recordedSpotFederalDirectory } from "./helpers/map-representation-fixtures.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { registryTransferImport } from "./helpers/promoted-fixtures.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";
import { installPromotedValue } from "./helpers/promoted-fixtures.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { activateCanonicalFixture } from "./helpers/canonical-reader-fixtures.ts";
import type { CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";


function served<T>(read: CivicDataReadResult<T>, what: string): T {
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") throw new Error(`${what} fixture did not install: ${read.kind} ${"detail" in read ? read.detail : ""}`);
  return read.value as T;
}

function registryFixtureForState(state: string, value: RegistryRuntimeReadModel = registryTransferImport().projection.payload): RegistryRuntimeReadModel {
  const own = (id: string | null) => registryJurisdictions(id).includes(state.toUpperCase());
  const bodies = value.registry.bodies.filter(row => own(row.id) || own(row.ocdId) || row.alsoServesOcdIds?.some(own));
  const bodyIds = new Set(bodies.map(row => row.id));
  const bodyRosters = value.bodyRosters.filter(row => bodyIds.has(row.bodyId));
  const statewideExecutives = value.statewideExecutives.filter(row => own(row.stateOcdId));
  const bridge = value.officialCandidacies.rows.filter(row => row.holder.divisions.some(own));
  const holders = new Set([...bodyRosters.flatMap(row => row.members.map(member => member.id)),
    ...statewideExecutives.map(row => row.holder.id), ...bridge.map(row => row.holder.id)]);
  return { ...value, registry: { ...value.registry, bodies,
    divisions: value.registry.divisions.filter(row => row.ocdId === "ocd-division/country:us" || own(row.ocdId)) },
    bodyRosters, statewideExecutives, officialCandidacies: { ...value.officialCandidacies, rows: bridge },
    officialPhotos: { photos: value.officialPhotos.photos.filter(row => holders.has(row.officeholderId)) },
    rosterPhotos: Object.fromEntries(Object.entries(value.rosterPhotos).filter(([id]) => holders.has(id) || own(id))),
    rosterReaderDispositions: value.rosterReaderDispositions.filter(row => own(row.sourceId) || holders.has(row.sourceId) || (row.canonicalId !== null && holders.has(row.canonicalId)) ||
      [...holders].some(id => id.startsWith("roster:") && id.split("#")[0] === row.sourceId.split("#")[0])) };
}

async function installRegistryRuntime(states?: readonly string[]): Promise<{ readonly value: RegistryRuntimeReadModel; readonly versionId: string }> {
  const { projection } = registryTransferImport();
  const selected = states ?? [...new Set(projection.payload.registry.divisions.flatMap(row => registryJurisdictions(row.ocdId)))];
  for (const state of selected) installPromotedValue({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope(state),
    sourceId: projection.sourceId, versionId: `${projection.versionId}:${state}`, value: registryFixtureForState(state) });
  activateCanonicalFixture("default");
  const value = served(await readRegistryRuntimeProjection(selected), "Registry runtime");
  return { value, versionId: selected.map(state => `${projection.versionId}:${state}`).join("|") };
}


await installRegistryRuntime();
const federal = await installFederalDirectory(recordedSpotFederalDirectory());
const arizonaLegislators = installStateLegislators("US-AZ");



/** The reader's point for every case below. */
const PROBE: [number, number] = [32.21696, -110.971];

/** The division types a card can be opened for, and what they are called. */
const DIVISION_TYPES = [
  { key: "cd", label: "congressional district", pattern: /\/cd:[^/]+$/ },
  { key: "sldu", label: "state senate district", pattern: /\/sldu:[^/]+$/ },
  { key: "sldl", label: "state house district", pattern: /\/sldl:[^/]+$/ },
  {
    key: "school_district",
    label: "school district",
    pattern: /\/school_district:[^/]+$/,
  },
  { key: "county", label: "county", pattern: /\/county:[^/]+$/ },
  { key: "place", label: "municipality", pattern: /\/place:[^/]+$/ },
] as const;

/** Every division we hold people for, read off the held rosters themselves rather than through a point. */
async function heldDivisions(): Promise<Map<string, number>> {
  const held = new Map<string, number>();
  for (const set of [federal.value.roster, arizonaLegislators.roster] as OfficeholderSet[]) {
    for (const [ocdId, holders] of indexByDivision([set])) {
      if (holders.length > 0) held.set(ocdId, holders.length);
    }
  }
  return held;
}

test("a division we hold people for answers by its OWN key, wherever the reader is", async () => {
  const coverage = await coverageAt(...PROBE, 1);
  const held = await heldDivisions();
  assert.ok(held.size > 0, "the committed rosters should hold divisions");

  const pointScoped = new Set(coverage.seats.map((s) => s.ocdId));
  const failures: string[] = [];
  const covered: string[] = [];

  for (const type of DIVISION_TYPES) {
    // A division of this type that we hold people for and that the reader is not in.
    const elsewhere = [...held.keys()]
      .filter((ocdId) => type.pattern.test(ocdId) && !pointScoped.has(ocdId))
      .sort();
    if (elsewhere.length === 0) continue;
    covered.push(type.key);

    for (const ocdId of elsewhere.slice(0, 8)) {
      const expected = held.get(ocdId)!;

      // The point-scoped resolver, recorded rather than asserted: if it ever answers these, that is fine.
      const scoped = representationForDivision(coverage, ocdId);

      // The division-keyed resolution — what the card asks now.
      const resolved = await seatHoldersForDivision(ocdId);
      if (resolved.length !== expected) {
        failures.push(
          `${type.label} ${ocdId}: we hold ${expected} officeholder(s), the ` +
            `division-keyed resolver returned ${resolved.length} ` +
            `(point-scoped returned ${scoped.length})`,
        );
      }
      for (const holder of resolved) {
        assert.ok(holder.name, `${ocdId}: a resolved holder has no name`);
      }
    }
  }

  assert.ok(
    covered.length >= 3,
    `only ${covered.length} division type(s) had a non-containing division to ` +
      `test — the guard is not reaching the cards it is meant to protect`,
  );
  assert.deepEqual(
    failures,
    [],
    `district cards would deny officeholders we hold:\n${failures.join("\n")}`,
  );
});

test("the route answers by path, and distinct divisions get distinct answers", async () => {
  const { GET } = await import("../app/api/representation/[...division]/route.ts");

  async function ask(ocdId: string) {
    const division = ocdId.split("/").map(encodeURIComponent);
    const response = await GET(
      new Request(`https://example.test/api/representation/${division.join("/")}`),
      { params: Promise.resolve({ division }) },
    );
    return { status: response.status, body: await response.json() };
  }

  const twentyOne = await ask("ocd-division/country:us/state:az/sldl:21");
  const twenty = await ask("ocd-division/country:us/state:az/sldl:20");

  assert.equal(twentyOne.status, 200);
  assert.equal(twenty.status, 200);
  assert.equal(twentyOne.body.ocdId, "ocd-division/country:us/state:az/sldl:21");
  assert.equal(twenty.body.ocdId, "ocd-division/country:us/state:az/sldl:20");
  assert.ok(twentyOne.body.holders.length > 0);
  assert.ok(twenty.body.holders.length > 0);

  // Identical payloads across distinct keys are presumed broken.
  assert.notDeepEqual(
    twentyOne.body.holders.map((h: { id: string }) => h.id).sort(),
    twenty.body.holders.map((h: { id: string }) => h.id).sort(),
    "two distinct districts returned the same officeholders",
  );

  // A local division resolves through the curated rosters on the same route,
  // so one call answers for every division type a card can be opened for.
  const county = await ask("ocd-division/country:us/state:az/county:pima");
  assert.equal(county.status, 200);
  assert.equal(
    county.body.holders.length,
    governingRosterHoldersForDivision(
      "ocd-division/country:us/state:az/county:pima",
    ).length,
  );

  for (const [state, names] of [
    ["tx", ["John Cornyn", "Ted Cruz"]],
    ["ia", ["Chuck Grassley", "Joni Ernst"]],
  ] as const) {
    const statewide = await ask(`ocd-division/country:us/state:${state}`);
    assert.equal(statewide.status, 200);
    assert.equal(statewide.body.ocdId, `ocd-division/country:us/state:${state}`);
    assert.deepEqual(statewide.body.holders.filter((holder: { officeTitle: string }) => holder.officeTitle === "U.S. Senator")
      .map((holder: { name: string }) => holder.name).sort(), [...names].sort());
    assert.ok(statewide.body.holders.every((holder: { officeTitle: string }) => holder.officeTitle !== "U.S. Representative"));
  }

  // Not an identifier: refused in the same shape, with the division's own facts as nulls, never a guess.
  const junk = await ask("not-a-division");
  assert.equal(junk.status, 400);
  assert.deepEqual(junk.body, {
    ocdId: null,
    label: null,
    divisionType: null,
    tier: null,
    holderStatus: "HOLDING_UNAVAILABLE",
    holders: [],
  });

  /* The label travels with the people: a reader is never shown an OCD-ID. */
  assert.equal(typeof twentyOne.body.label, "string");
  assert.ok(twentyOne.body.label.length > 0);
  assert.equal(twentyOne.body.divisionType, "sldl");
  assert.notEqual(twentyOne.body.label, twenty.body.label);
});

test("three different empties get three different sentences", async () => {
  const { representationNoteFor: note, noteStateFor } = await import(
    "../lib/registry/representation.ts"
  );
  // A question in flight is not an absence; a failed question is not an absence either, nor the same fact.
  for (const tier of ["state", "local"]) {
    const said = new Set([
      note(tier, "gap"),
      note(tier, "looking"),
      note(tier, "unavailable"),
    ]);
    assert.equal(said.size, 3, `${tier}: two empties share one sentence`);
    assert.ok(!/haven't sourced|No sourced/.test(note(tier, "looking")));
    assert.ok(!/haven't sourced|No sourced/.test(note(tier, "unavailable")));
  }
  // A status maps to exactly one sentence, so a failed lookup is never routed to the gap sentence.
  assert.equal(noteStateFor("looking"), "looking");
  assert.equal(noteStateFor("unavailable"), "unavailable");
  assert.equal(noteStateFor("unsourced"), "gap");
  assert.equal(noteStateFor("resolved"), "gap");
});
