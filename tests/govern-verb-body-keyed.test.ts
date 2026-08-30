import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  jurisdictionClaim,
  representationNoteForClaim,
  REPRESENTATION_NOTE_UNSOURCED,
} from "../lib/meetings/jurisdiction-badge.ts";
import { governVerbMayAttach } from "../lib/registry/body-class-labels.ts";
import type { BodyClass, DivisionType } from "../lib/registry/types.ts";

/**
 * **THE GOVERN VERB IS A CLAIM ABOUT A BODY, AND IT WAS BEING MADE FROM A
 * DIVISION.** (GOV-1, 2026-08-29.)
 *
 * ## The defect
 *
 * `jurisdictionClaim` took no body id. It returned
 * `{ kind: "GOVERNS", label: "Governs", value: divisionLabel }` for anything
 * that had a division at all — so the **Tucson Design Review Board** rendered
 * *"Governs: Tucson"*, and the map's representation note said *"We know this
 * body governs here because its division exists."*
 *
 * Both sentences are false, and the second says out loud what the first was
 * doing: inferring a governing relationship from the existence of a boundary.
 * `governVerbMayAttach` in `lib/registry/body-class-labels.ts` was written to
 * enforce RULING 118 — **an appointed body never carries the govern verb** —
 * and neither surface consulted it.
 *
 * Measured over the committed registry: **248 of 1,998 bodies were claiming to
 * govern a division that is not theirs.**
 *
 * ## Why this file exists separately
 *
 * `tests/jurisdiction-badge.test.ts` was updated for the new call signature but
 * asserts nothing about the two new claim kinds — the workstream that made the
 * repair stopped before writing its guard. A repair with no red control is a
 * repair that silently comes back, so the control is written here rather than
 * assumed, and every assertion below fails against the pre-GOV-1 function.
 *
 * ## The two gates, and why both are needed
 *
 * 1. **Is this body the division's own government?** A body that merely SITS in
 *    a division does not govern it. `isDivisionsOwnGovernment` decides it from
 *    the registry's own derivation rule, not from a suffix guessed at the call
 *    site.
 * 2. **May the verb attach to this CLASS of body?** RULING 118. An advisory
 *    board that IS somehow a division's own government still may not be said to
 *    govern a resident.
 *
 * A body failing (1) is `LISTED_UNDER`; one passing (1) and failing (2) is
 * `TERRITORY`. Neither is a weaker synonym for governing — they state the
 * association that IS sourced and stop there.
 */

const TUCSON = "ocd-division/country:us/state:az/place:tucson";
const PIMA = "ocd-division/country:us/state:az/county:pima";

function claimFor(bodyId: string, ocdId: string | null, divisionType: DivisionType | null, label: string, bodyClass: BodyClass) {
  return jurisdictionClaim({ bodyId, ocdId, divisionType, divisionLabel: label, bodyClass });
}

/* ══════════════════════════════════════════════════════════════════════
   RED — bodies that were claiming to govern a division that is not theirs
   ══════════════════════════════════════════════════════════════════════ */

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

/* ══════════════════════════════════════════════════════════════════════
   POSITIVE CONTROLS — a fix that silences everything is not a fix
   ══════════════════════════════════════════════════════════════════════ */

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
    assert.equal(claim.value, label);
  }
});

test("the governing body's representation note DOES still say it governs", () => {
  const claim = claimFor(`${PIMA}#governing`, PIMA, "county", "Pima", "GOVERNING");
  assert.match(representationNoteForClaim(claim), /governs here/i);
});

test("a school district's own board is derived under a DIFFERENT suffix and still governs", () => {
  /*
   * The registry derives a school district's government as `#board`, not
   * `#governing`. A check that hardcoded one suffix would silently demote every
   * school board in the corpus — which is most of the hyperlocal bodies this
   * product carries.
   */
  const VAIL = "ocd-division/country:us/state:az/school_district:vail_unified_district";
  const claim = claimFor(`${VAIL}#board`, VAIL, "school_district", "Vail Unified District", "GOVERNING");
  assert.equal(claim.kind, "GOVERNS");
});

test("a body with no division is a NAMED GAP, never an empty govern claim", () => {
  const claim = claimFor("curated:az/pima-community-college#governing", null, null, "", "GOVERNING");
  assert.equal(claim.kind, "NO_BOUNDARY");
  assert.notEqual(claim.kind, "GOVERNS");
});

/* ══════════════════════════════════════════════════════════════════════
   THE CLASS, SWEPT — not one instance, the whole registry
   ══════════════════════════════════════════════════════════════════════ */

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
