import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  groupBySeatLabel,
  pluralizeOffice,
} from "../lib/officials/seat-grouping.ts";

/**
 * One heading per body, however many seats it holds. The guard exercises the
 * class: a five-member county board and a two-member state house district.
 */

test("ALIGN-2: two senators collapse to ONE heading, pluralised", () => {
  const groups = groupBySeatLabel([
    { label: "U.S. Senator", member: "Mark Kelly" },
    { label: "U.S. Senator", member: "Ruben Gallego" },
  ]);

  assert.equal(groups.length, 1, "the Senate printed two headings");
  assert.equal(groups[0].label, "U.S. Senators");
  assert.equal(groups[0].singular, "U.S. Senator", "the callback needs the office");
  assert.deepEqual(groups[0].members, ["Mark Kelly", "Ruben Gallego"]);
});

test("ALIGN-2: the class, not the instance — cases the fix was NOT derived from", () => {
  // A five-member county board.
  const supervisors = groupBySeatLabel(
    ["Rex Scott", "Matt Heinz", "Jennifer Allen", "Steve Christy", "Andrés Cano"].map(
      (member) => ({ label: "County Supervisor", member }),
    ),
  );
  assert.equal(supervisors.length, 1);
  assert.equal(supervisors[0].label, "County Supervisors");
  assert.equal(supervisors[0].members.length, 5);

  // A two-member Arizona state house district.
  const house = groupBySeatLabel([
    { label: "State House District 19", member: "Gail Griffin" },
    { label: "State House District 19", member: "Lupe Diaz" },
  ]);
  assert.equal(house.length, 1);
  assert.equal(
    house[0].label,
    "State House District 19",
    "a district label ending in a number is not pluralised",
  );

  // A multi-member school board.
  const board = groupBySeatLabel(
    ["Alison Mastin", "Kristen Schultz", "James MacKenna"].map((member) => ({
      label: "School Board Member",
      member,
    })),
  );
  assert.equal(board.length, 1);
  assert.equal(board[0].label, "School Board Members");
});

test("ALIGN-2: a single seat keeps its singular heading and is never pluralised", () => {
  for (const label of ["U.S. Senator", "County Supervisor", "Mayor", "Governor"]) {
    const groups = groupBySeatLabel([{ label, member: "one person" }]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].label, label, `${label} was pluralised for one person`);
  }
});

test("ALIGN-2: grouping is CONSECUTIVE, so a chosen order is never reordered", () => {
  const groups = groupBySeatLabel([
    { label: "U.S. Representative", member: "a" },
    { label: "U.S. Senator", member: "b" },
    { label: "U.S. Representative", member: "c" },
  ]);
  assert.equal(groups.length, 3, "a global regroup silently reordered the card");
  assert.deepEqual(
    groups.map((g) => g.singular),
    ["U.S. Representative", "U.S. Senator", "U.S. Representative"],
  );
});

test("ALIGN-2: the pluraliser declines to guess rather than inventing a title", () => {
  // Already plural — never doubled.
  assert.equal(pluralizeOffice("Board of Supervisors"), "Board of Supervisors");
  // Sibilants take -es.
  assert.equal(pluralizeOffice("Borough Sheriff"), "Borough Sheriffs");
  assert.equal(pluralizeOffice("Coach"), "Coaches");
  // Consonant + y takes -ies.
  assert.equal(pluralizeOffice("Deputy"), "Deputies");
  // -man takes -men, which is the New England case.
  assert.equal(pluralizeOffice("Selectman"), "Selectmen");
  // Offices held by exactly one person stay singular, so two arriving under
  // one of them stays visible as the finding it is.
  assert.equal(pluralizeOffice("Mayor"), "Mayor");
  assert.equal(pluralizeOffice("Chair"), "Chair");
  // Nothing at all is nothing at all, not a crash.
  assert.equal(pluralizeOffice(""), "");
  assert.equal(pluralizeOffice("   "), "");
});

test("ALIGN-2: the who-governs card calls the shared helper and indents the block", () => {
  const source = readFileSync("components/map/coverage-notice.tsx", "utf8");

  assert.ok(
    source.includes("groupBySeatLabel"),
    "the card still maps over PEOPLE and emits a heading per person",
  );
  // The reader's route: the heading sits at the margin, the names step in
  // beneath it. The wrapper is what indents, never the row — a five-member
  // body indents once as a group.
  assert.ok(
    source.includes('className="block person-under-heading"'),
    "the holder block lost its subparagraph indent",
  );
  /* Four member-name blocks and the mutually exclusive vacancy alternative
     indent beneath their headings. The vacancy text adds no heading. */
  assert.equal(
    (source.match(/className="block person-under-heading"/g) ?? []).length,
    5,
    "member names and the vacancy alternative must indent beneath their headings",
  );

  const css = readFileSync("app/globals.css", "utf8");
  assert.ok(
    /\.person-under-heading\s*\{[^}]*padding-left/.test(css),
    "the indent class has no rule, so it renders flush",
  );
});
