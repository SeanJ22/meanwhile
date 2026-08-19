import assert from "node:assert/strict";
import { test } from "node:test";

import { TOP_OFFICES_GAP, topOfficesFor } from "../lib/officials/top-offices.ts";
import { BODY_ROSTERS } from "../lib/registry/body-rosters.ts";

/** F01 1.2 / 2.2 — who runs this body, on every card. */

const h = (id: string, name: string, officeTitle: string) =>
  ({ id, name, officeTitle }) as never;

test("F01 1.2: the presiding officer leads, then the hired executive", () => {
  const top = topOfficesFor([
    h("1", "Jennifer Eckstrom", "Governing Board Member"),
    h("2", "Dr. Ravi Shah", "Governing Board President"),
    h("3", "Someone Else", "Superintendent"),
    h("4", "Natalie Luna Rose", "Governing Board Clerk"),
  ]);
  assert.deepEqual(
    top.map((t) => t.holder.name),
    ["Dr. Ravi Shah", "Someone Else"],
  );
  assert.equal(top[0].role, "Presides");
  assert.equal(top[1].role, "Runs it day to day");
});

test("F01 1.2: a specific title never falls through to a generic one", () => {
  // "Governing Board President" must not be read as a plain member, and a
  // plain member must never be promoted into the presiding slot.
  const top = topOfficesFor([
    h("1", "A Member", "Governing Board Member"),
    h("2", "The Chair", "Chairman of the Board of Supervisors"),
  ]);
  assert.equal(top.length, 1);
  assert.equal(top[0].holder.name, "The Chair");
});

test("F01 1.2: a body publishing only one of the two returns ONE, never padded", () => {
  // Padding with a rank-and-file member would put a person under a heading
  // that is not true of them.
  const top = topOfficesFor([
    h("1", "Board President", "Board President"),
    h("2", "Just A Member", "Board Member"),
    h("3", "Also A Member", "Board Member"),
  ]);
  assert.equal(top.length, 1);
  assert.equal(top[0].holder.name, "Board President");
});

test("F01 1.2: a single-seat division returns its one officeholder", () => {
  // AZ-6 is the author's own example. A US Representative presides over
  // nothing, so a positional rule would have shown an empty card for the
  // best-covered body in the product.
  const top = topOfficesFor([h("1", "Juan Ciscomani", "U.S. Representative")]);
  assert.equal(top.length, 1);
  assert.equal(top[0].holder.name, "Juan Ciscomani");
  assert.equal(top[0].role, "U.S. Representative");
});

test("F01 1.2: a mayor presides, and a town manager runs it", () => {
  const top = topOfficesFor([
    h("1", "The Manager", "Town Manager"),
    h("2", "The Mayor", "Mayor"),
    h("3", "Ward 3", "Council Member, Ward 3"),
  ]);
  assert.deepEqual(top.map((t) => t.holder.name), ["The Mayor", "The Manager"]);
});

test("F01 1.2: a vice chair is never mistaken for the chair", () => {
  // Pima publishes the VICE chair ABOVE the chair in roster order, so a naive
  // first-match returned the wrong person. A real roster, not a hypothetical.
  const top = topOfficesFor([
    h("1", "District 1", "County Supervisor, District 1"),
    h("2", "The Vice Chair", "County Supervisor, District 2 (Vice Chair)"),
    h("3", "The Chair", "County Supervisor, District 3 (Chair)"),
  ]);
  assert.equal(top.length, 1);
  assert.equal(top[0].holder.name, "The Chair");
});

test("F01 1.2: New Jersey's Commissioner Director presides", () => {
  // No generic chair/president pattern reaches this published title.
  const top = topOfficesFor([
    h("1", "The Director", "Commissioner Director"),
    h("2", "The Deputy", "Commissioner Deputy Director"),
    h("3", "A Commissioner", "County Commissioner"),
  ]);
  assert.equal(top.length, 1);
  assert.equal(top[0].holder.name, "The Director");
});

test("F01 1.2: a body with a Mayor AND a Council President shows both", () => {
  // Rockaway Township. Two different people doing two different jobs, and the
  // second slot takes the second elected head when no appointed executive is
  // on record.
  const top = topOfficesFor([
    h("1", "The Mayor", "Mayor"),
    h("2", "The President", "Council President, At-Large"),
    h("3", "The VP", "Council Vice President, Ward 4"),
    h("4", "A Member", "Council Member, Ward 1"),
  ]);
  assert.deepEqual(top.map((t) => t.holder.name), ["The Mayor", "The President"]);
});

test("F01 1.2: nothing sourced returns nothing, and the gap line is OURS", () => {
  assert.deepEqual(topOfficesFor([]), []);
  // A body always has someone presiding; the absence is a fact about our
  // research, and the sentence says so.
  assert.match(TOP_OFFICES_GAP, /We haven’t sourced/);
  assert.ok(
    !/no leader|has none|does not have/i.test(TOP_OFFICES_GAP),
    "the gap line must never make a claim about the body",
  );
});

test("F01 1.2: every curated roster resolves at least a presiding officer", () => {
  // The denominator, stated. This is what the render will actually show at
  // the four covered zips, so a regression in a title string shows up here
  // rather than as a blank card.
  const results = BODY_ROSTERS.map((roster) => ({
    body: roster.bodyName,
    top: topOfficesFor(
      roster.members.map(
        (m) => ({ id: m.id, name: m.name, officeTitle: m.officeTitle }) as never,
      ),
    ),
  }));
  const empty = results.filter((r) => r.top.length === 0);
  assert.deepEqual(
    empty.map((r) => r.body),
    [],
    `these rosters resolve no presiding officer: ${empty.map((r) => r.body).join(", ")}`,
  );
  assert.equal(results.length, BODY_ROSTERS.length);
});
