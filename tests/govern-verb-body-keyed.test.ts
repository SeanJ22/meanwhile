import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  jurisdictionClaim,
  representationNoteForClaim,
  REPRESENTATION_NOTE_UNSOURCED,
} from "../lib/meetings/jurisdiction-badge.ts";
import { governVerbMayAttach } from "../lib/registry/body-class-labels.ts";
import { readerGovernmentName } from "../lib/text/reader-names.ts";
import type { BodyClass, DivisionType } from "../lib/registry/types.ts";

/**
 * The govern verb attaches only to a body that is its division's own government and whose class may carry
 * the verb; a body failing the first is LISTED_UNDER, one failing only the second is TERRITORY.
 */

const TUCSON = "ocd-division/country:us/state:az/place:tucson";
const PIMA = "ocd-division/country:us/state:az/county:pima";

function claimFor(bodyId: string, ocdId: string | null, divisionType: DivisionType | null, label: string, bodyClass: BodyClass) {
  return jurisdictionClaim({ bodyId, ocdId, divisionType, divisionLabel: label, bodyClass });
}

test("an advisory board on a city's division does NOT claim to govern it", () => {
  const claim = claimFor(`${TUCSON}#design-review-board`, TUCSON, "place", "Tucson", "ADVISORY");
  assert.notEqual(
    claim.kind,
    "GOVERNS",
    "the Tucson Design Review Board is claiming to govern Tucson — GOV-1 has regressed",
  );
  assert.equal(claim.kind, "LISTED_UNDER");
  assert.equal(claim.label, "Listed under");
  /* The association that IS true still travels. Refusing the verb is not the
     same as refusing to say where the body sits. */
  assert.equal(claim.value, "Tucson");
});

test("a commission on a county's division does NOT claim to govern it", () => {
  const claim = claimFor(
    `${PIMA}#central-arizona-water-conservation-district`,
    PIMA,
    "county",
    "Pima",
    "COMMISSION",
  );
  assert.notEqual(claim.kind, "GOVERNS");
  assert.equal(claim.kind, "LISTED_UNDER");
});

test("the representation note never asserts governing for a body that does not", () => {
  const claim = claimFor(`${TUCSON}#planning-commission`, TUCSON, "place", "Tucson", "COMMISSION");
  const note = representationNoteForClaim(claim);
  assert.ok(
    !/governs here/i.test(note),
    `the note still infers a governing relationship from the division: "${note}"`,
  );
  assert.equal(note, REPRESENTATION_NOTE_UNSOURCED);
});

test("a division's OWN governing body still carries the verb", () => {
  for (const [bodyId, ocdId, type, label] of [
    [`${TUCSON}#governing`, TUCSON, "place", "Tucson"],
    [`${PIMA}#governing`, PIMA, "county", "Pima"],
  ] as const) {
    const claim = claimFor(bodyId, ocdId, type, label, "GOVERNING");
    assert.equal(
      claim.kind,
      "GOVERNS",
      `${bodyId} lost the govern verb — the repair over-corrected and silenced a true claim`,
    );
    assert.equal(claim.label, "Governs");
    // The area is printed as the government it is, not as the Census's short label.
    assert.equal(claim.value, readerGovernmentName(label, type));
  }
});

test("the governing body's representation note DOES still say it governs", () => {
  const claim = claimFor(`${PIMA}#governing`, PIMA, "county", "Pima", "GOVERNING");
  assert.match(representationNoteForClaim(claim), /governs here/i);
});

test("a school district's own board is derived under a DIFFERENT suffix and still governs", () => {
  /* A school district's government derives as `#board`, not `#governing`. */
  const VAIL = "ocd-division/country:us/state:az/school_district:vail_unified_district";
  const claim = claimFor(`${VAIL}#board`, VAIL, "school_district", "Vail Unified District", "GOVERNING");
  assert.equal(claim.kind, "GOVERNS");
});

test("a body with no division is a NAMED GAP, never an empty govern claim", () => {
  const claim = claimFor("curated:az/pima-community-college#governing", null, null, "", "GOVERNING");
  assert.equal(claim.kind, "NO_BOUNDARY");
  assert.notEqual(claim.kind, "GOVERNS");
});

test("no body in the registry claims to govern a division that is not its own", () => {
  const registry = JSON.parse(readFileSync("lib/registry/registry.json", "utf8")) as {
    bodies: { id: string; ocdId: string | null; bodyClass: string }[];
    divisions: { ocdId: string; divisionType: string; label: string }[];
  };
  const divisions = new Map(registry.divisions.map((d) => [d.ocdId, d]));

  /* A floor on the sweep itself: a registry that stopped loading would find no
     offenders, and "0 offenders" is exactly what that looks like. */
  assert.ok(registry.bodies.length > 1000, `the registry sweep found only ${registry.bodies.length} bodies`);

  const offenders: string[] = [];
  let governs = 0;
  for (const body of registry.bodies) {
    const division = body.ocdId ? divisions.get(body.ocdId) : null;
    const claim = jurisdictionClaim({
      bodyId: body.id,
      ocdId: body.ocdId,
      divisionType: (division?.divisionType ?? null) as DivisionType | null,
      divisionLabel: division?.label ?? "",
      bodyClass: body.bodyClass as BodyClass,
    });
    if (claim.kind !== "GOVERNS") continue;
    governs += 1;
    /* Every surviving GOVERNS must pass BOTH gates, checked here against the
       authorities themselves rather than against this function's own opinion. */
    const derived = body.id === `${body.ocdId}#governing` || body.id === `${body.ocdId}#board`;
    if (!derived || !governVerbMayAttach(body.bodyClass as BodyClass)) {
      offenders.push(`${body.id} [${body.bodyClass}]`);
    }
  }

  assert.deepEqual(offenders.slice(0, 10), [], `${offenders.length} bodies claim to govern a division that is not their own`);
  /* And the sweep is not passing by refusing everyone. */
  assert.ok(governs > 500, `only ${governs} bodies carry the verb — the repair silenced legitimate claims`);
});
