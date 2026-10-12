import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  INCOMPLETE_NAME_LINE,
  displayPersonName,
  isIncompletePersonName,
  nameTokens,
} from "../lib/officials/person-name.ts";
import { BODY_ROSTERS } from "../lib/registry/body-rosters.ts";
import { STATEWIDE_EXECUTIVES } from "../lib/officials/statewide-executives.ts";

test("THE CONTROL: a bare surname is incomplete", () => {
  assert.equal(isIncompletePersonName("Carruth"), true);
  assert.equal(isIncompletePersonName("Superintendent Carruth"), true);
  assert.equal(isIncompletePersonName("Dr. Carruth"), true);
  assert.equal(isIncompletePersonName("Carruth Jr."), true);
});

test("a whole name is not", () => {
  assert.equal(isIncompletePersonName("John Carruth"), false);
  assert.equal(isIncompletePersonName("Dr. Gabriel Trujillo"), false);
  assert.equal(isIncompletePersonName("Linda Harriott-Gathright"), false);
  assert.equal(isIncompletePersonName("Mary-Kate O'Brien"), false);
});

test("REGRESSION: initials at the front are a name, not a credential", () => {
  // Honorifics come off the front and suffixes off the back, so leading initials stay a name.
  assert.equal(isIncompletePersonName("J.D. Mesnard"), false);
  assert.equal(isIncompletePersonName("J.D. Bernardy"), false);
  assert.equal(isIncompletePersonName("J. Edgar Hoover"), false);
  // …and a real trailing credential still comes off.
  assert.deepEqual(nameTokens("Ann Lee J.D."), ["Ann", "Lee"]);
});

test("empty and missing are incomplete — a blank slot is the same defect wearing less", () => {
  assert.equal(isIncompletePersonName(""), true);
  assert.equal(isIncompletePersonName("   "), true);
  assert.equal(isIncompletePersonName(null), true);
  assert.equal(isIncompletePersonName(undefined), true);
});

test("the display helper renders the named gap, never the fragment", () => {
  assert.equal(displayPersonName("Carruth"), INCOMPLETE_NAME_LINE);
  assert.equal(displayPersonName("John Carruth"), "John Carruth");
  // It is a fact about US, in the gap's own register — never about the person.
  assert.match(INCOMPLETE_NAME_LINE, /^We haven/);
  assert.ok(!/they|their|unknown|missing/i.test(INCOMPLETE_NAME_LINE));
});

const ROOT = process.cwd();

test("no person this product holds carries a name that cannot stand as one", () => {
  const offenders: string[] = [];
  let counted = 0;

  for (const roster of BODY_ROSTERS) {
    for (const member of roster.members) {
      counted += 1;
      if (isIncompletePersonName(member.name)) {
        offenders.push(`${roster.bodyName} ${member.id} ${JSON.stringify(member.name)}`);
      }
    }
  }

  for (const executive of STATEWIDE_EXECUTIVES) {
    counted += 1;
    if (isIncompletePersonName(executive.holder.name)) {
      offenders.push(`statewide ${executive.holder.id} ${JSON.stringify(executive.holder.name)}`);
    }
  }

  // An empty loop must not pass as a clean census.
  assert.ok(counted > 0, "the census examined nobody — it did not run");
  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} person(s) of ${counted} carry an incomplete name:\n  ${offenders.join("\n  ")}`,
  );
});

test("Vail's superintendent is held under a whole name", () => {
  const vail = BODY_ROSTERS.find((r) => /vail_unified/.test(r.bodyId));
  assert.ok(vail, "the Vail roster is in the registry");
  const supt = vail.members.find((m) => /superintendent/i.test(m.officeTitle ?? ""));
  assert.ok(supt, "Vail carries a superintendent");
  assert.equal(supt.name, "John Carruth");
  assert.equal(isIncompletePersonName(supt.name), false);
  assert.match(supt.websiteUrl ?? "", /vailschooldistrict\.org\/page\/superintendent/);
});

test("the top-office slots render through the gap-aware helper", () => {
  // Guarded at the render as well as the data: a source can change between refreshes.
  for (const file of [
    "components/map/popup/district-popup.tsx",
    "components/map/popup/entity-modal.tsx",
  ]) {
    const source = readFileSync(join(ROOT, file), "utf8");
    assert.ok(
      /displayPersonName\(office\.holder\.name\)/.test(source),
      `${file} prints a top-office holder's name without the gap-aware helper`,
    );
    assert.ok(
      !/\{office\.holder\.name\}/.test(source),
      `${file} still has a raw {office.holder.name}`,
    );
  }
});
