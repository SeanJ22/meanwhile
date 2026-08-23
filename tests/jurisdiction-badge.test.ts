import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  BADGE_COPY,
  badgeCensus,
  badgeFor,
  jurisdictionClaim,
} from "../lib/meetings/jurisdiction-badge.ts";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";

const ROOT = join(import.meta.dirname, "..");

/**
 * M81 — the jurisdiction badge.
 *
 * The author's insight is the whole row: impact is jurisdiction MEMBERSHIP,
 * not distance. These guards hold the three things that make the badge honest
 * — it derives from the map's own geometry and never a second source, a failed
 * lookup never becomes a claim, and a body with no published boundary gets its
 * own name rather than being defaulted into either answer.
 */

const HERE = "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town";
const ELSEWHERE = "ocd-division/country:us/state:nh/county:merrimack/place:warner_town";
const COUNTY = "ocd-division/country:us/state:nh/county:merrimack";

const AT_POINT = new Set([HERE, COUNTY]);

test("M81: a body whose division contains the reader governs them", () => {
  assert.equal(badgeFor({ ocdId: HERE }, AT_POINT), "GOVERNS");
  // The whole point of the row: the county seat is forty miles away and it
  // governs; the next town's select board is four miles away and does not.
  assert.equal(badgeFor({ ocdId: COUNTY }, AT_POINT), "GOVERNS");
  assert.equal(badgeFor({ ocdId: ELSEWHERE }, AT_POINT), "NEARBY");
});

test("M81: a body with no published boundary gets its OWN state", () => {
  // D28's shape: Pima Community College's district, which the Census
  // enumerates no boundary for. Defaulting it into either badge would be a
  // render default manufacturing a claim — "Nearby" asserts the body does not
  // govern the reader, which we do not know.
  assert.equal(badgeFor({ ocdId: null }, AT_POINT), "NO_BOUNDARY");
});

test("M81: a FAILED lookup is not an empty answer", () => {
  // The distinction the whole badge rests on. An empty set treated as an
  // answer would badge every meeting on screen "Nearby, different
  // jurisdiction" — a specific false claim produced by our own lookup
  // failing.
  assert.equal(badgeFor({ ocdId: HERE }, null), "NO_BOUNDARY");
  assert.equal(badgeFor({ ocdId: ELSEWHERE }, null), "NO_BOUNDARY");
  // And a genuinely empty set is a real answer: nothing here governs this
  // point, which is different from not knowing.
  assert.equal(badgeFor({ ocdId: HERE }, new Set()), "NEARBY");
});

test("M81: the census states all three numbers, never one", () => {
  const census = badgeCensus(
    [{ ocdId: HERE }, { ocdId: COUNTY }, { ocdId: ELSEWHERE }, { ocdId: null }],
    AT_POINT,
  );
  assert.deepEqual(census, { GOVERNS: 2, NEARBY: 1, NO_BOUNDARY: 1 });
  const total = census.GOVERNS + census.NEARBY + census.NO_BOUNDARY;
  assert.equal(total, 4, "the census lost a row");
});

test("M81: the copy is level register, geometry only, no editorialising", () => {
  for (const [state, copy] of Object.entries(BADGE_COPY)) {
    assert.ok(copy.label.length > 0 && copy.detail.length > 0, state);
    // No claim about whether the reader should care. The row says so
    // explicitly: "neutral register, geometry only, no editorialising about
    // importance."
    const text = `${copy.label} ${copy.detail}`.toLowerCase();
    for (const word of [
      "important",
      "matters",
      "relevant",
      "ignore",
      "priority",
      "affects you most",
    ]) {
      assert.ok(!text.includes(word), `"${word}" editorialises in ${state}`);
    }
    // No identifier reaches a reader.
    assert.ok(!text.includes("ocd-division"));
    assert.ok(!text.includes("polygon"));
  }
  // The named gap says whose gap it is — a fact about the published record,
  // never about the body.
  assert.match(BADGE_COPY.NO_BOUNDARY.detail, /no official boundary is published/i);
});

test("M81: the badge derives from the map's own geometry, never a second source", () => {
  // The row's stated guard, made mechanical. The cheapest way to break it is
  // to add a boundary import "just for the badge", so the module is asserted
  // to hold no geometry at all.
  const source = readFileSync(
    join(process.cwd(), "lib", "meetings", "jurisdiction-badge.ts"),
    "utf8",
  );
  const imported = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    imported,
    ["../sources/types.ts"],
    "the badge module imports something other than the meeting type — it must take the resolved answer, never resolve its own",
  );
  for (const forbidden of ["node:fs", "tiger", "geojson", "boundaries", "districts"]) {
    assert.ok(
      !source.toLowerCase().includes(`import`) ||
        !imported.some((i) => i.toLowerCase().includes(forbidden)),
      `the badge imports ${forbidden}`,
    );
  }
});

test("M81: the API sends the resolved divisions, and null when it failed", () => {
  const route = readFileSync(
    join(process.cwd(), "app", "api", "meetings", "route.ts"),
    "utf8",
  );
  assert.ok(route.includes("governingOcdIds"), "the route sends no division set");
  // The failed-resolution branch must survive. `resolvedDivisions` is null on
  // failure and the field has to carry that through rather than flattening to
  // an empty array.
  assert.match(
    route,
    /governingOcdIds\s*=\s*resolvedDivisions\s*\n?\s*\?\s*resolvedDivisions\.map/,
    "the route flattens a failed resolution into an answer",
  );
});

/* ========================================================================== */
/* JUR-1 — a body may not both govern you and have no boundary                */
/* ========================================================================== */

/**
 * (2026-08-22, the author's 8/22 walkthrough, item 12.)
 *
 * Morris County's Board of County Commissioners rendered **"Governs your
 * area"** and **"Boundary not published"** at the same time. Those cannot both
 * be true: if no boundary is published, whether it governs the reader is a
 * question that cannot be asked.
 *
 * `badgeFor` was never the defect — it returns exactly one value. The
 * contradiction came from a SECOND code path: the body card built its
 * `Governs: <division>` row straight off the division label, with no reference
 * to whether a boundary existed. Two paths, one subject, nothing making them
 * agree — which is the class this sweeps, not the instance.
 */
test("JUR-1: the two claims are mutually exclusive, by construction", () => {
  // A real body with a real division: GOVERNS, and nothing else.
  const withBoundary = jurisdictionClaim({
    ocdId: "ocd-division/country:us/state:nj/county:morris",
    divisionLabel: "Morris County",
  });
  assert.equal(withBoundary.kind, "GOVERNS");
  assert.equal(withBoundary.label, "Governs");
  assert.equal(withBoundary.value, "Morris County");

  // No division id at all — Pima Community College's district is the live case.
  const noId = jurisdictionClaim({ ocdId: null, divisionLabel: "Pima County" });
  assert.equal(noId.kind, "NO_BOUNDARY");
  assert.equal(noId.label, BADGE_COPY.NO_BOUNDARY.label);

  // A division id with an EMPTY label is the same situation from the reader's
  // side, and it is the one that produced the contradiction: the old code
  // rendered "Governs:" with nothing after it, which reads as a finding.
  for (const empty of ["", "   "]) {
    const blank = jurisdictionClaim({ ocdId: "ocd-division/country:us/state:nj", divisionLabel: empty });
    assert.equal(blank.kind, "NO_BOUNDARY", `an empty label must not produce a Governs row (${JSON.stringify(empty)})`);
    assert.notEqual(blank.label, "Governs");
  }
});

test("JUR-1: no surface builds a Governs row without going through the one claim", () => {
  /*
   * The sweep, not the instance. A second place that assembles
   * `{ label: "Governs", ... }` from a division label is the defect coming
   * back, and it would look exactly as reasonable as the first one did.
   */
  const swept = filesThatWouldBeCommitted({
    cwd: ROOT,
    paths: ["app", "components", "lib"],
  })
    .map((f) => f.trim())
    .filter((f) => /\.(ts|tsx)$/.test(f));

  assert.ok(swept.length > 100, `only ${swept.length} files swept — the corpus shrank`);

  const offenders: string[] = [];
  for (const file of swept) {
    if (file.endsWith("lib/meetings/jurisdiction-badge.ts")) continue;
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const m of text.matchAll(/label:\s*"Governs"/g)) {
      offenders.push(`${file} (offset ${m.index})`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a Governs row is built outside `jurisdictionClaim`, so nothing stops it appearing\n" +
      `beside "Boundary not published" again:\n${offenders.join("\n")}`,
  );
});
