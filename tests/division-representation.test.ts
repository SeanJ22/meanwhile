import { rosterPath, stateDomainFiles } from "../lib/holdings/files.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

await installRegistryRuntimeFirstSeeds();

import { governingRosterHoldersForDivision } from "../lib/registry/body-rosters.ts";
import { representationForDivision } from "../lib/registry/representation.ts";
import { coverageAt, seatHoldersForDivision } from "../lib/registry/server.ts";
import { indexByDivision } from "../lib/officials/lookup.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";

/**
 * M112 — A DISTRICT CARD MAY NOT DENY OFFICEHOLDERS WE HOLD.
 *
 * The defect, live on production and found while verifying another fix:
 * every drawn district the reader is NOT standing in rendered "No sourced
 * officeholder for this division yet". State House District 21 said it over
 * Consuelo Hernandez and Stephanie Stahl Hamilton, both sitting in the index
 * the same page had already loaded.
 *
 * The cause was scope, not sourcing. `representationForDivision` reads
 * `coverage.seats`, and a coverage summary is POINT-SCOPED by construction:
 * it carries only the divisions containing the reader. Every other division
 * came back empty, and the empty array was rendered as a claim about a
 * government. That is the render-default rule (M111) broken by a resolver
 * rather than by a component.
 *
 * This is the M86 guard's shape, aimed one level up: for every division type,
 * a division that does NOT contain the probe point must still render the
 * officeholders we hold for it. The test names the divisions it fails on, so
 * a regression reports WHICH cards started lying rather than that one did.
 */

/** Downtown Tucson — the reader's point for every case below. */
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

/**
 * Every division we hold people for, from the committed stores, keyed the way
 * the fix keys them. Read straight off the roster files rather than through a
 * point, because "what we hold" must not be defined by where anyone stands.
 */
async function heldDivisions(): Promise<Map<string, number>> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const root = process.cwd();
  const files = [
    rosterPath("officeholders-us.json"),
    ...stateDomainFiles(root, "officials").filter((file) => /\/officeholders-\d{2}\.json$/.test(file)),
  ];
  const held = new Map<string, number>();

  for (const file of files) {
    const set = JSON.parse(await readFile(join(root, file), "utf8")) as OfficeholderSet;
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
    // A division of this type that we hold people for and that the reader is
    // NOT in — the exact case every district card got wrong.
    const elsewhere = [...held.keys()]
      .filter((ocdId) => type.pattern.test(ocdId) && !pointScoped.has(ocdId))
      .sort();
    if (elsewhere.length === 0) continue;
    covered.push(type.key);

    for (const ocdId of elsewhere.slice(0, 8)) {
      const expected = held.get(ocdId)!;

      // The point-scoped resolver — what the card used to ask, and the reason
      // it lied. Recorded, not asserted: if it ever starts answering these,
      // the fix has been superseded and that is fine.
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

test("the named case: State House District 21 holds its two members from a Tucson point", async () => {
  const AZ_SLDL_21 = "ocd-division/country:us/state:az/sldl:21";
  const coverage = await coverageAt(...PROBE, 1);

  // The reader is in a different state house district — this is the setup
  // that produced the false sentence, and it must stay true or the test is
  // proving nothing.
  assert.ok(
    !coverage.seats.some((s) => s.ocdId === AZ_SLDL_21),
    "the probe point must NOT be in District 21 for this case to bite",
  );
  assert.equal(
    representationForDivision(coverage, AZ_SLDL_21).length,
    0,
    "the point-scoped resolver is expected to be empty here — that is the bug",
  );

  const resolved = await seatHoldersForDivision(AZ_SLDL_21);
  const names = resolved.map((h) => h.name).sort();
  assert.deepEqual(names, ["Consuelo Hernandez", "Stephanie Stahl Hamilton"]);
  for (const holder of resolved) {
    assert.ok(
      holder.sourceUrl,
      `${holder.name} renders without a source — same sourcing, same render`,
    );
  }
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

  // The uniqueness invariant (D40): identical payloads across distinct keys
  // are presumed broken. Two districts, two different sets of people.
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

  // Not an identifier: refused in the same shape, never a guess. WGH-22 added
  // the division's own facts to the answer; the refusal carries them as nulls
  // so the shape is genuinely the same one and a caller needs no second branch.
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

  /*
   * WGH-22: the label travels with the people. The panel asks this route for a
   * district the ZIP-scoped payload cannot carry, and it may not print an
   * OCD-ID at a reader — so an answer with holders and no name would leave the
   * row unrenderable.
   */
  assert.equal(typeof twentyOne.body.label, "string");
  assert.ok(twentyOne.body.label.length > 0);
  assert.equal(twentyOne.body.divisionType, "sldl");
  assert.notEqual(twentyOne.body.label, twenty.body.label);
});

test("three different empties get three different sentences", async () => {
  const { representationNoteFor: note, noteStateFor } = await import(
    "../lib/registry/representation.ts"
  );
  // M111's rule in the shape it took here. A question in flight is not an
  // absence; a FAILED question is not an absence either, and it is not the
  // same fact as a question in flight. Each sentence is about us.
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
  // And a status maps to exactly one of them — a failed lookup can never be
  // routed to the gap sentence by a caller.
  assert.equal(noteStateFor("looking"), "looking");
  assert.equal(noteStateFor("unavailable"), "unavailable");
  assert.equal(noteStateFor("unsourced"), "gap");
  assert.equal(noteStateFor("resolved"), "gap");
});
