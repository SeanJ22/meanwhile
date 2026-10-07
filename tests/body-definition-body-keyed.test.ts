/** A definition is keyed on the body, never on the division it stands on: named cases, each pinned to the sentence and statute that must or must not appear. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { definitionsForBody } from "../lib/officials/body-definitions.ts";
import type { BodyDivisionType } from "../lib/officials/body-description.ts";

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

/** The whole answer for one registry body id, looked up in the registry so a moved subject fails by name. */
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

  /* The division override must not reach a body that is not the division's own government. */
  assert.ok(
    !/city's governing body/.test(said) && !/mayor and the council together/.test(said),
    `the Design Review Board is described as the mayor and council: ${said}`,
  );
  assert.ok(!/Tucson City Charter/.test(said), "the Design Review Board cites the city charter");

  /* The correct outcome is no definition: nobody has read the ordinance that creates this board. */
  assert.equal(answer.formDefinition, null, "a definition was invented for this board");
  assert.equal(
    answer.unreadNote,
    null,
    "an unread-charter note with no description above it is the refusal again",
  );
});

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
  // The division override is legitimate here: this body is the division's government.
  assert.match(answer.formDefinition?.basis ?? "", /Tucson City Charter/);
  assert.match(answer.formDefinition?.text ?? "", /city's governing body/);
  assert.equal(answer.unreadNote, null, "the charter HAS been read, so nothing should say it has not");
});

test("NH270: a curated body with its OWN BODY_KINDS row still gets that definition", () => {
  /* A curated body with its own sourced statute keeps it: gating the division layer must not gate the body layer. */
  const stadium = definitionsFor(STADIUM);
  assert.equal(stadium.classKey, null, "the Stadium District resolved to a division's class");
  assert.equal(stadium.classDefinition, null);
  assert.match(stadium.formDefinition?.basis ?? "", /48-4203/);
  assert.match(stadium.formDefinition?.text ?? "", /county stadium district/);
  assert.ok(
    !/11-251/.test(everythingSaid(stadium)),
    "the Stadium District cites the county's statute",
  );

  /* A body with no division still reaches its body-layer definition. */
  const pcc = definitionsFor("curated:az/pima-community-college#governing");
  assert.equal(pcc.classDefinition, null, "a body with no division may not get a class line");
  assert.equal(pcc.classKey, null);
  assert.match(pcc.formDefinition?.basis ?? "", /15-1444/);
  assert.match(pcc.formDefinition?.text ?? "", /community college district/);
});

test("NH270: the Pima and Tucson divisions each carry exactly ONE body that is their government", () => {
  /* The premise: each division holds exactly one derived government, so the named cases cannot go stale silently. */
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
