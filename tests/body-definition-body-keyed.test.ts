/**
 * **NH270 / DATA-4, BY NAME — A DEFINITION IS KEYED ON THE BODY, NEVER ON THE
 * GROUND IT STANDS ON.** (2026-08-29.)
 *
 * ## Why this file exists alongside `tests/body-definition-identity.test.ts`
 *
 * That file proves the RULE — it sweeps all 1,998 registry bodies and asserts
 * that no body which is not its division's own government inherits a class
 * definition, and that the id grammar and `bodyOrigin` agree everywhere. A
 * sweep is the right instrument for a rule, and it is the wrong instrument for
 * a REGRESSION: it names whichever ten bodies happen to sort first, so the day
 * the Tucson boards start inheriting the municipality line again the failure
 * message is a list of ids nobody recognises, and the day the sweep's own
 * filter breaks it reports zero and passes.
 *
 * This file asserts the four NAMED cases NH270 was written about, each pinned
 * to the specific sentence and the specific statute that must or must not
 * appear. A pinned assertion cannot pass by finding nothing.
 *
 * ## The discriminator, and it is not a second taxonomy
 *
 * `isDivisionsOwnGovernment` — `bodyId === ocdId + "#" + DERIVED_BODY_SUFFIX`,
 * the grammar the registry itself builds `DERIVED_FROM_DIVISION_TYPE` ids
 * under. Nothing here re-implements it: every assertion below goes through the
 * real exported `definitionsForBody`, because a test that reproduces the rule
 * it is checking checks only that it can be typed twice.
 *
 * ## The two divisions, and the sizes that make the defect obvious
 *
 * | division | bodies on it | its own government |
 * | --- | --- | --- |
 * | `az/county:pima` | 6 | `#governing` only |
 * | `az/place:tucson` | 58 | `#governing` only |
 *
 * The other 62 are a multi-county water district, four county special
 * districts, and 57 City of Tucson boards, commissions and committees. Keying
 * on the division hands **A.R.S. § 11-251** to a water district and *"This is
 * an Arizona city or town — a municipal corporation"* to a design review board.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { definitionsForBody } from "../lib/officials/body-definitions.ts";
import type { BodyDivisionType } from "../lib/officials/body-blurbs.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface RegistryDivision {
  ocdId: string;
  divisionType: string;
  lsad: string | null;
}
interface RegistryBody {
  id: string;
  ocdId: string | null;
  name: string | null;
}

const registry = JSON.parse(
  readFileSync(join(ROOT, "lib/registry/registry.json"), "utf8"),
) as { divisions: RegistryDivision[]; bodies: RegistryBody[] };

const DIVISION = new Map(registry.divisions.map((d) => [d.ocdId, d]));

/**
 * The whole answer for one registry body id, asked for exactly as the card asks
 * for it in `components/map/map-entry.tsx`.
 *
 * The id is looked up in the registry rather than typed straight into the call,
 * so a test whose SUBJECT has moved fails saying the subject moved rather than
 * quietly asserting things about a body that does not exist.
 */
function definitionsFor(bodyId: string) {
  const body = registry.bodies.find((b) => b.id === bodyId);
  assert.ok(body, `${bodyId} is not in the registry — the test's subject moved, not the code`);
  const division = body.ocdId === null ? null : (DIVISION.get(body.ocdId) ?? null);
  return definitionsForBody({
    bodyId: body.id,
    ocdId: body.ocdId,
    divisionType: (division?.divisionType ?? "place") as BodyDivisionType,
    lsad: division?.lsad ?? null,
    // Neither division here is a school district, so the Census dependency
    // classification cannot reach any branch these assertions touch.
  });
}

/** Both layers, flattened, so one regex can ask what the reader was told. */
function everythingSaid(answer: ReturnType<typeof definitionsForBody>): string {
  return [
    answer.classDefinition?.text ?? "",
    answer.classDefinition?.basis ?? "",
    answer.formDefinition?.text ?? "",
    answer.formDefinition?.basis ?? "",
    answer.unreadNote ?? "",
  ].join(" ");
}

const PIMA = "ocd-division/country:us/state:az/county:pima";
const TUCSON = "ocd-division/country:us/state:az/place:tucson";

const CAWCD = `${PIMA}#central-arizona-water-conservation-district`;
const PIMA_BOARD = `${PIMA}#governing`;
const STADIUM = `${PIMA}#stadium-district`;
const DESIGN_REVIEW = `${TUCSON}#design-review-board`;
const TUCSON_COUNCIL = `${TUCSON}#governing`;

/** The sentence the Arizona county class definition opens with. */
const COUNTY_CLASS_CLAIMS = [
  /creature of state statute/,
  /the jail/,
  /county property tax rate/,
  /unincorporated areas outside any city or town/,
];
/** The sentence the Arizona municipality class definition opens with. */
const MUNICIPALITY_CLASS_CLAIMS = [
  /Arizona city or town is a municipal corporation/,
  /decides zoning and what can be built where/,
  /adopts the city budget/,
];

/* ========================================================================== */
/* RED 1 — the water district, on the county's ground                         */
/* ========================================================================== */

test("NH270: CAWCD does not inherit the Arizona COUNTY definition from the Pima division", () => {
  const answer = definitionsFor(CAWCD);
  const said = everythingSaid(answer);

  assert.equal(answer.classKey, null, "CAWCD resolved to the division's class key");
  assert.equal(
    answer.classDefinition,
    null,
    "CAWCD carries the Arizona county class definition, which is a false claim about a named government",
  );
  assert.ok(
    !/11-251/.test(said),
    `CAWCD cites A.R.S. § 11-251, a statute that does not govern it: ${said}`,
  );
  for (const claim of COUNTY_CLASS_CLAIMS) {
    assert.ok(!claim.test(said), `CAWCD is described with a county's powers — ${claim} matched`);
  }

  // And the positive half of the same case: it is described from the statute
  // that actually creates it, so the repair is not silence.
  assert.match(answer.formDefinition?.basis ?? "", /48-3708/);
  assert.match(answer.formDefinition?.text ?? "", /multi-county water conservation district/);
});

/* ========================================================================== */
/* RED 2 — a Tucson advisory board, on the city's ground                      */
/* ========================================================================== */

test("NH270: a Tucson advisory board does not inherit the MUNICIPALITY definition", () => {
  const answer = definitionsFor(DESIGN_REVIEW);
  const said = everythingSaid(answer);

  assert.equal(answer.classKey, null, "the Design Review Board resolved to `municipality`");
  assert.equal(
    answer.classDefinition,
    null,
    "the Design Review Board carries the Arizona municipality class definition — it is not a municipality",
  );
  for (const claim of MUNICIPALITY_CLASS_CLAIMS) {
    assert.ok(
      !claim.test(said),
      `the Design Review Board is described as a city — ${claim} matched`,
    );
  }

  /*
   * The DIVISION override is the sharper half. `DIVISION_BODY_BLURBS` carries a
   * hand-written paragraph for `place:tucson` — *"This is the city's governing
   * body — the mayor and the council together"* — keyed on the division, so a
   * division-keyed lookup hands it to all 57 of Tucson's boards.
   */
  assert.ok(
    !/city's governing body/.test(said) && !/mayor and the council together/.test(said),
    `the Design Review Board is described as the mayor and council: ${said}`,
  );
  assert.ok(!/Tucson City Charter/.test(said), "the Design Review Board cites the city charter");

  /*
   * **AND THE CORRECT OUTCOME IS NOTHING.** Nobody has read the ordinance that
   * creates this board, so there is no definition for it — and a gap is never
   * wrong while a neighbour's powers always are. `entity-modal.tsx` renders
   * `NO_BODY_BLURB_LINE`, which is a fact about US.
   */
  assert.equal(answer.formDefinition, null, "a definition was invented for this board");
  assert.equal(
    answer.unreadNote,
    null,
    "an unread-charter note with no description above it is the refusal again",
  );
});

/* ========================================================================== */
/* POSITIVE CONTROL — the two governments that ARE their divisions            */
/* ========================================================================== */

test("NH270: Pima County's own board STILL gets the Arizona county definition", () => {
  const answer = definitionsFor(PIMA_BOARD);

  assert.equal(answer.classKey, "county");
  assert.ok(answer.classDefinition, "Pima County's own board lost its class definition");
  assert.match(answer.classDefinition?.basis ?? "", /11-251/);
  assert.match(answer.classDefinition?.text ?? "", /creature of state statute/);
  // Layer two: the by-division blurb for an Arizona county board.
  assert.match(answer.formDefinition?.basis ?? "", /11-251/);
  assert.match(answer.formDefinition?.text ?? "", /county budget and property tax rate/);
});

test("NH270: Tucson's Mayor and Council STILL get the municipality definition and the charter", () => {
  const answer = definitionsFor(TUCSON_COUNCIL);

  assert.equal(answer.classKey, "municipality");
  assert.ok(answer.classDefinition, "Tucson's Mayor and Council lost the municipality definition");
  assert.match(answer.classDefinition?.text ?? "", /municipal corporation/);
  // The division override is legitimate HERE, and only here: this body IS the
  // division's government, so the paragraph written about the division is about
  // it. Losing this would mean the gate had been drawn too wide.
  assert.match(answer.formDefinition?.basis ?? "", /Tucson City Charter/);
  assert.match(answer.formDefinition?.text ?? "", /city's governing body/);
  assert.equal(answer.unreadNote, null, "the charter HAS been read, so nothing should say it has not");
});

/* ========================================================================== */
/* POSITIVE CONTROL — a curated body with its own sourced definition          */
/* ========================================================================== */

test("NH270: a curated body with its OWN BODY_KINDS row still gets that definition", () => {
  /*
   * The other half a silencing "fix" would fail. The Stadium District is not
   * Pima County and must not be described as one — and somebody HAS read
   * A.R.S. § 48-4203 for it, so the correct answer is that statute, not a gap.
   * Gating the division layer must not gate the body layer with it.
   */
  const stadium = definitionsFor(STADIUM);
  assert.equal(stadium.classKey, null, "the Stadium District resolved to a division's class");
  assert.equal(stadium.classDefinition, null);
  assert.match(stadium.formDefinition?.basis ?? "", /48-4203/);
  assert.match(stadium.formDefinition?.text ?? "", /county stadium district/);
  assert.ok(
    !/11-251/.test(everythingSaid(stadium)),
    "the Stadium District cites the county's statute",
  );

  /*
   * And the case with NO DIVISION AT ALL, which is why the body layer is looked
   * up ahead of every division guard rather than after it: Pima Community
   * College's Governing Board has a null `ocdId`, so a lookup that needed a
   * division would render nothing for a LIVE, reader-reachable body.
   */
  const pcc = definitionsFor("curated:az/pima-community-college#governing");
  assert.equal(pcc.classDefinition, null, "a body with no division may not get a class line");
  assert.equal(pcc.classKey, null);
  assert.match(pcc.formDefinition?.basis ?? "", /15-1444/);
  assert.match(pcc.formDefinition?.text ?? "", /community college district/);
});

/* ========================================================================== */
/* The two divisions, counted, so the named cases cannot go stale silently    */
/* ========================================================================== */

test("NH270: the Pima and Tucson divisions each carry exactly ONE body that is their government", () => {
  /*
   * The premise every assertion above rests on. If the registry ever grew a
   * second `DERIVED_FROM_DIVISION_TYPE` body on either division, or lost the
   * neighbours, the named cases would still pass while meaning something else.
   */
  for (const division of [PIMA, TUCSON]) {
    const onIt = registry.bodies.filter((b) => b.ocdId === division);
    assert.ok(onIt.length > 1, `${division} carries ${onIt.length} bodies — the sharing is gone`);
    const own = onIt.filter((b) => b.id === `${division}#governing`);
    assert.equal(own.length, 1, `${division} does not carry exactly one #governing body`);

    // Not one of the neighbours may carry a class definition.
    const inheriting = onIt
      .filter((b) => b.id !== `${division}#governing`)
      .filter((b) => definitionsFor(b.id).classDefinition !== null)
      .map((b) => b.name ?? b.id);
    assert.deepEqual(
      inheriting,
      [],
      `${inheriting.length} bodies on ${division} inherit the definition of a government that merely shares their ground`,
    );
  }
});
