import assert from "node:assert/strict";
import test from "node:test";
import { governingRosterHoldersForDivision } from "../lib/registry/body-rosters.ts";
import { representationForDivision } from "../lib/registry/representation.ts";
import { coverageAt, seatHoldersForDivision } from "../lib/registry/server.ts";
import { indexByDivision } from "../lib/officials/lookup.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";
import { installFederalDirectory, installRegistryRuntime, installStateLegislators } from "./helpers/promoted-fixtures.ts";

await installRegistryRuntime();
const federal = await installFederalDirectory();
const arizonaLegislators = installStateLegislators("US-AZ");

/**
 * A district card may not deny officeholders we hold. A coverage summary is point-scoped by construction, so a
 * division that does not contain the probe point must still resolve the officeholders we hold for it, by its own key.
 * Failures name the divisions, so a regression reports which cards started lying.
 */

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
