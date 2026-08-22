/**
 * RULING 67 — an enumeration states its geography and is checked against the
 * zip's own, externally.
 *
 * The defect this guards is not "a tool got the state wrong". It is "a tool got
 * the state wrong and every downstream number agreed with every other number
 * about it". `pnpm zip:universe 07866` enumerated New Hampshire for a New
 * Jersey zip; `pnpm twig:pair` then printed its coverage pair under that and
 * reported `(reconciles)`.
 *
 * So the assertions here are about the SHAPE of the check, not only its answers:
 * a wrong claim must throw, a right one must pass, and a scope limit must read
 * as ours rather than as a fact about the zip.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveZipGeography,
  assertEnumerationGeography,
  geographyLine,
} from "../lib/geo/zip-geography.ts";

test("every pilot zip resolves to the state it is actually in", () => {
  const cases: Array<[string, string, string]> = [
    ["07866", "34", "NJ"],
    ["03255", "33", "NH"],
    ["85641", "04", "AZ"],
    ["85701", "04", "AZ"],
  ];
  for (const [zip, fips, abbr] of cases) {
    const g = resolveZipGeography(zip);
    assert.equal(g.ok, true, `${zip} did not resolve`);
    if (!g.ok) continue;
    assert.equal(g.stateFips, fips, `${zip} resolved to FIPS ${g.stateFips}`);
    assert.equal(g.stateAbbr, abbr);
  }
});

test("07866 resolves to Morris County, New Jersey — not to New Hampshire", () => {
  const g = resolveZipGeography("07866");
  assert.equal(g.ok, true);
  if (!g.ok) return;
  assert.equal(g.countyFips, "34027");
  assert.equal(g.countyName, "Morris");
  assert.notEqual(g.stateFips, "33");
});

test("the witnesses are distinct publishers, and one of them is not the Census", () => {
  const g = resolveZipGeography("07866");
  assert.equal(g.ok, true);
  if (!g.ok) return;
  const publishers = new Set(g.witnesses.map((w) => w.through));
  assert.equal(publishers.size, g.witnesses.length, "two witnesses share a dependency");
  assert.ok(
    g.witnesses.some((w) => /Department of Education/.test(w.through)),
    "no witness outside the Census — independence is counted over dependencies, not names",
  );
});

test("a witness with nothing to say is UNAVAILABLE, never agreement and never disagreement", () => {
  // Newbury NH has no school district in the NCES directory at its zip.
  const g = resolveZipGeography("03255");
  assert.equal(g.ok, true);
  if (!g.ok) return;
  assert.equal(g.unavailable, 1);
  assert.equal(g.agreed, 1);
  const silent = g.witnesses.find((w) => w.says === null);
  assert.ok(silent, "the silent witness is not recorded");
  assert.match(silent!.detail, /UNAVAILABLE/);
});

test("an enumeration that read the wrong state THROWS, and the message names both", () => {
  assert.throws(
    () => assertEnumerationGeography("07866", { stateFips: "33", by: "a test" }),
    (err: Error) => {
      assert.match(err.message, /New Jersey/);
      assert.match(err.message, /33/);
      assert.match(err.message, /self-reconciling/);
      return true;
    },
  );
});

test("an enumeration that read the wrong county THROWS", () => {
  assert.throws(
    () => assertEnumerationGeography("07866", { stateFips: "34", countyFips: "34013", by: "a test" }),
    /Morris/,
  );
});

test("an enumeration that read the right geography passes and hands back the truth", () => {
  const truth = assertEnumerationGeography("07866", {
    stateFips: "34",
    countyFips: "34027",
    by: "a test",
  });
  assert.equal(truth.ok, true);
  if (!truth.ok) return;
  assert.equal(truth.stateName, "New Jersey");
});

test("a zip outside the committed geometry states OUR scope, never the zip's absence", () => {
  const g = resolveZipGeography("10001");
  assert.equal(g.ok, false);
  if (g.ok) return;
  assert.equal(g.reason, "out-of-scope");
  assert.match(g.detail, /committed here/);
  assert.match(g.detail, /says nothing about the zip/);
});

test("a malformed or unknown zip is distinguished from an out-of-scope one", () => {
  const bad = resolveZipGeography("abc");
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, "malformed");
  const unknown = resolveZipGeography("00000");
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.reason, "unknown-zcta");
});

test("the printed line names the ruling, the state, and how many witnesses spoke", () => {
  const line = geographyLine(resolveZipGeography("07866"));
  assert.match(line, /RULING 67/);
  assert.match(line, /New Jersey/);
  assert.match(line, /witness/);
});

/**
 * The instrument's own failure mode, guarded.
 *
 * `assertEnumerationGeography` is only worth anything if it refuses to pass a
 * zip it cannot check. A version that returned "fine" for an unknown zip would
 * let exactly the runs that most need checking through.
 */
test("a zip that cannot be geography-checked STOPS the enumeration rather than passing it", () => {
  assert.throws(
    () => assertEnumerationGeography("10001", { stateFips: "36", by: "a test" }),
    /RULING 67 requires an external check/,
  );
});
