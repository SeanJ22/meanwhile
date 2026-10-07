/** An appointed role never carries the Incumbent chip; the verification uses cases the fix was not derived from. */
import test from "node:test";
import assert from "node:assert/strict";

import { BODY_ROSTERS } from "../lib/registry/body-rosters.ts";
import { identityChipsFor } from "../lib/officials/identity-chips.ts";
import { roleSelectionFor, standingChipMayAttach } from "../lib/officials/elected-role.ts";
import { topOfficesFor } from "../lib/officials/top-offices.ts";

const holderWith = (officeTitle: string) =>
  ({ id: "x", name: "A Person", officeTitle, state: null, chamber: null }) as never;

test("BC-26 — THE DERIVED CASE: a superintendent gets no Incumbent chip", () => {
  const chips = identityChipsFor(holderWith("Superintendent"), "local", "INCUMBENT");
  assert.ok(!chips.includes("Incumbent"), `a superintendent still carries Incumbent: ${chips.join(", ")}`);
  assert.ok(chips.length > 0, "the gate removed every chip — it was supposed to remove one");
});

test("BC-26: an ELECTED seat still carries its chip, both ways", () => {
  // The failure that would be invisible: gating so hard that nobody gets one.
  for (const title of ["Council Member", "Mayor", "School Board Chair", "U.S. Representative"]) {
    assert.ok(
      identityChipsFor(holderWith(title), "local", "INCUMBENT").includes("Incumbent"),
      `${title} lost its Incumbent chip`,
    );
    assert.ok(
      identityChipsFor(holderWith(title), "local", "CHALLENGER").includes("Challenger"),
      `${title} lost its Challenger chip`,
    );
  }
});

test("BC-26: the elected EXCEPTIONS survive the appointed patterns", () => {
  // A County Clerk is an elected row office in New Jersey. A cleverer pattern
  // would be what silently mislabels the next state; a checked exception is
  // cheaper and visible.
  for (const title of ["County Clerk", "County Surrogate", "Sheriff"]) {
    assert.equal(roleSelectionFor(title), "ELECTED", `${title} was read as appointed`);
  }
});

test("BC-26: an unknown or empty title defaults to ELECTED, which is the safe direction", () => {
  // An elected person wrongly read as appointed loses a TRUE chip. An appointed
  // person wrongly read as elected gains a FALSE claim about a named person.
  assert.equal(roleSelectionFor(null), "ELECTED");
  assert.equal(roleSelectionFor(""), "ELECTED");
  assert.equal(roleSelectionFor("Selectboard Member"), "ELECTED");
});

test("BC-26: the electedness predicate AGREES with the runs-it-day-to-day slot", () => {
  /* Who was hired and who was elected must agree across the two vocabularies, so the agreement is asserted. */
  for (const title of ["Superintendent", "Business Administrator", "Executive Director", "Town Manager"]) {
    const top = topOfficesFor([holderWith(title)]);
    const slot = top.find((o) => o.role === "Runs it day to day");
    assert.ok(slot, `${title} does not fill the appointed-executive slot`);
    assert.equal(
      standingChipMayAttach(title),
      false,
      `${title} fills the HIRED slot and would still carry an election chip`,
    );
  }
});

test("BC-26 — THE CLASS: every non-elected role in the registry, with its denominator", () => {
  /* Three numbers, never a bare count, and the independent cases are named. */
  const rows: { body: string; name: string; title: string; selection: string }[] = [];
  for (const roster of BODY_ROSTERS) {
    for (const member of roster.members ?? []) {
      rows.push({
        body: roster.bodyName,
        name: member.name,
        title: member.officeTitle ?? "",
        selection: roleSelectionFor(member.officeTitle),
      });
    }
  }

  // The floor: an empty registry must not read as a clean bill of health.
  assert.ok(rows.length >= 100, `the audit read only ${rows.length} roster member(s)`);

  const appointed = rows.filter((r) => r.selection === "APPOINTED");
  assert.ok(
    appointed.length >= 3,
    `only ${appointed.length} appointed role(s) found — the class check is about nothing`,
  );

  // NOT ONE of them may produce a standing chip.
  const offenders = appointed.filter((r) =>
    identityChipsFor(holderWith(r.title), "local", "INCUMBENT").includes("Incumbent"),
  );
  assert.deepEqual(
    offenders.map((r) => `${r.body}: ${r.name} (${r.title})`),
    [],
    "an appointed role still renders the Incumbent chip",
  );

  // The independent cases, by name; the case the fix was derived from is deliberately not one of these.
  const independent = appointed.filter((r) => !/carruth/i.test(r.name));
  assert.ok(
    independent.length >= 2,
    `only ${independent.length} appointed role(s) outside the derived case — RULING 157 is unsatisfied`,
  );
});
