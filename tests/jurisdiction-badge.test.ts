import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  BADGE_COPY,
  badgeCensus,
  badgeCopyFor,
  badgeFor,
  jurisdictionClaim,
} from "../lib/meetings/jurisdiction-badge.ts";
import {
  COULD_GOVERN_ACTION,
  COULD_GOVERN_TEXT,
} from "../lib/ballot/could-govern.ts";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";

const ROOT = join(import.meta.dirname, "..");

/**
 * Impact is jurisdiction membership, not distance. The badge derives from the map's own geometry and never a
 * second source, a failed lookup never becomes a claim, and a body with no published boundary gets its own name.
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
  // A district the Census enumerates no boundary for: defaulting it into either badge would manufacture a claim.
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

test("M81: the census states every number, never one", () => {
  // The census states every state, including the zeroes.
  const census = badgeCensus(
    [{ ocdId: HERE }, { ocdId: COUNTY }, { ocdId: ELSEWHERE }, { ocdId: null }],
    AT_POINT,
  );
  assert.deepEqual(census, { GOVERNS: 2, NEARBY: 1, NO_BOUNDARY: 1, COULD_GOVERN: 0, NOT_GOVERNING: 0 });
  const total =
    census.GOVERNS + census.NEARBY + census.NO_BOUNDARY + census.COULD_GOVERN;
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
  const imported = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
  /*
   * An allowlist of modules that are text, types or string comparisons and cannot resolve a point.
   * `isDivisionsOwnGovernment` is imported from its leaf module, not `body-definitions.ts`: the latter pulls the
   * whole definition corpus into `/api/meetings` and breaks its file-trace ceiling.
   */
  assert.deepEqual(
    imported,
    [
      "../ballot/could-govern.ts",
      "../officials/division-government.ts",
      "../registry/body-class-labels.ts",
      "../registry/types.ts",
      "../sources/types.ts",
      "../text/reader-names.ts",
    ],
    "the badge module imports something other than the meeting type, the shared wording and " +
      "the two identity predicates — it must take the resolved answer, never resolve its own",
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

/**
 * A body may not both govern you and have no published boundary. The sweep covers every path that builds a
 * `Governs: <division>` row, not one instance. These calls carry the body's identity, because the govern verb is
 * a claim about a body.
 */
const MORRIS = "ocd-division/country:us/state:nj/county:morris";

test("JUR-1: the two claims are mutually exclusive, by construction", () => {
  // A real body with a real division: GOVERNS, and nothing else.
  const withBoundary = jurisdictionClaim({
    bodyId: `${MORRIS}#governing`,
    ocdId: MORRIS,
    divisionType: "county",
    divisionLabel: "Morris County",
    bodyClass: "GOVERNING",
  });
  assert.equal(withBoundary.kind, "GOVERNS");
  assert.equal(withBoundary.label, "Governs");
  assert.equal(withBoundary.value, "Morris County");

  // No division id at all.
  const noId = jurisdictionClaim({
    bodyId: "curated:az/pima-community-college#governing",
    ocdId: null,
    divisionType: null,
    divisionLabel: "Pima County",
    bodyClass: "GOVERNING",
  });
  assert.equal(noId.kind, "NO_BOUNDARY");
  assert.equal(noId.label, BADGE_COPY.NO_BOUNDARY.label);

  // A division id with an EMPTY label is the same situation from the reader's
  // side, and it is the one that produced the contradiction: the old code
  // rendered "Governs:" with nothing after it, which reads as a finding.
  for (const empty of ["", "   "]) {
    const blank = jurisdictionClaim({
      bodyId: "ocd-division/country:us/state:nj#governing",
      ocdId: "ocd-division/country:us/state:nj",
      divisionType: "county",
      divisionLabel: empty,
      bodyClass: "GOVERNING",
    });
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

/** A zip is orientation only and can never resolve a ballot: a ZCTA crosses city, county, school district and legislative lines. */

const JUR2_TOWNSHIP = "ocd-division/country:us/state:nj/place:rockaway_township";
const JUR2_COUNTY = "ocd-division/country:us/state:nj/county:morris";

test("JUR-2: a partial division resolved from a ZIP is COULD_GOVERN, never GOVERNS", () => {
  const inZip = new Set([JUR2_TOWNSHIP, JUR2_COUNTY]);
  const partial = new Set([JUR2_TOWNSHIP]);
  assert.equal(badgeFor({ ocdId: JUR2_TOWNSHIP }, inZip, "ZIP", partial), "COULD_GOVERN");
});

test("JUR-2: NEARBY is the same over-claim pointed the other way, and collapses too", () => {
  // "This body governs a different area" is as unearned from a zip as
  // "this body governs yours". Both are claims about which town the reader
  // lives in, made from a centroid.
  const elsewhere = new Set([JUR2_COUNTY]);
  const partial = new Set([JUR2_TOWNSHIP]);
  assert.equal(badgeFor({ ocdId: JUR2_TOWNSHIP }, elsewhere, "ZIP", partial), "COULD_GOVERN");
});

test("JUR-2: a division covering the WHOLE zip still answers normally", () => {
  /*
   * County, school district, state and federal do not become uncertain because a zip crosses a municipal line;
   * a pill on things it obviously does not apply to is a pill readers learn to skip.
   */
  const inZip = new Set([JUR2_TOWNSHIP, JUR2_COUNTY]);
  const partial = new Set([JUR2_TOWNSHIP]);
  assert.equal(badgeFor({ ocdId: JUR2_COUNTY }, inZip, "ZIP", partial), "GOVERNS");
});

test("JUR-2: a resolved ADDRESS answers GOVERNS and NEARBY as before", () => {
  const atPoint = new Set([JUR2_TOWNSHIP, JUR2_COUNTY]);
  const partial = new Set([JUR2_TOWNSHIP]);
  assert.equal(badgeFor({ ocdId: JUR2_TOWNSHIP }, atPoint, "ADDRESS", partial), "GOVERNS");
  assert.equal(
    badgeFor({ ocdId: "ocd-division/country:us/state:nj/place:denville" }, atPoint, "ADDRESS", partial),
    "NEARBY",
  );
});

test("JUR-2: UNMEASURED partiality is not treated as 'nothing is partial'", () => {
  /*
   * `null` means the lattice never measured this zip; an empty set means it measured and found nothing partial.
   * The two must not render alike.
   */
  const inZip = new Set([JUR2_TOWNSHIP]);
  assert.equal(badgeFor({ ocdId: JUR2_TOWNSHIP }, inZip, "ZIP", null), "GOVERNS");
  assert.equal(badgeFor({ ocdId: JUR2_TOWNSHIP }, inZip, "ZIP", new Set()), "GOVERNS");
});

test("JUR-2: a failed resolution still beats everything — NO_BOUNDARY wins", () => {
  assert.equal(badgeFor({ ocdId: null }, new Set([JUR2_TOWNSHIP]), "ZIP", new Set([JUR2_TOWNSHIP])), "NO_BOUNDARY");
  assert.equal(badgeFor({ ocdId: JUR2_TOWNSHIP }, null, "ZIP", new Set([JUR2_TOWNSHIP])), "NO_BOUNDARY");
});

test("JUR-2: the COULD_GOVERN wording is the RULING 71 wording, not a second one", () => {
  /*
   * Two wordings for one claim about one reader is how they drift. This is
   * the same sentence the ballot page's pill carries, imported rather than
   * retyped.
   */
  assert.equal(BADGE_COPY.COULD_GOVERN.label, COULD_GOVERN_TEXT);
  assert.match(BADGE_COPY.COULD_GOVERN.detail, new RegExp(COULD_GOVERN_ACTION));
  // And it is about the reader's street, never about our record.
  assert.doesNotMatch(BADGE_COPY.COULD_GOVERN.detail, /\bwe (?:haven't|don't|couldn't)\b/i);
});

test("JUR-2: the census counts the fourth state", () => {
  const partial = new Set([JUR2_TOWNSHIP]);
  const census = badgeCensus(
    [{ ocdId: JUR2_TOWNSHIP }, { ocdId: JUR2_COUNTY }, { ocdId: null }],
    new Set([JUR2_TOWNSHIP, JUR2_COUNTY]),
    "ZIP",
    partial,
  );
  assert.deepEqual(census, { GOVERNS: 1, NEARBY: 0, NO_BOUNDARY: 1, COULD_GOVERN: 1, NOT_GOVERNING: 0 });
});

test("JUR-2 third era: a centroid MISS on a zip basis does not assert NEARBY", () => {
  /* A centroid is one sample of a zip: a body governing the half the reader lives in looks like a body governing somewhere else. */
  const somewhereElse = { ocdId: "ocd-division/country:us/state:nj/place:dover" };
  const atPoint = new Set(["ocd-division/country:us/state:nj/place:rockaway"]);
  const partial = new Set(["ocd-division/country:us/state:nj/place:rockaway"]);

  // On an ADDRESS basis a miss is a real geometric answer and stays NEARBY.
  assert.equal(badgeFor(somewhereElse, atPoint, "ADDRESS", partial), "NEARBY");

  // On a ZIP basis it cannot be asserted.
  assert.equal(badgeFor(somewhereElse, atPoint, "ZIP", partial), "COULD_GOVERN");
});

test("JUR-2 third era: RULING 71 survives — a HIT on a zip basis still GOVERNS", () => {
  /*
   * A county, a regional district or a state covering the WHOLE zip does not
   * become uncertain because the zip crosses a municipal line, and a pill on
   * things it obviously does not apply to is a pill readers learn to skip.
   */
  const county = { ocdId: "ocd-division/country:us/state:nj/county:morris" };
  const atPoint = new Set([county.ocdId]);
  assert.equal(badgeFor(county, atPoint, "ZIP", new Set()), "GOVERNS");
});

test("JUR-2 third era: a caller that resolved NO partial set is unchanged", () => {
  // The new branch is guarded on `partialAtZip !== null`. A caller that passed
  // nothing has told us nothing about zip overlap, and inventing an answer for
  // it would be the opposite defect.
  const elsewhere = { ocdId: "ocd-division/country:us/state:nj/place:dover" };
  assert.equal(badgeFor(elsewhere, new Set(["other"]), "ZIP", null), "NEARBY");
});

test("S2.4: a body that may not carry the govern verb never reads \"Governs your area\"", () => {
  // The geometry answer is unchanged; the class decides whether the verb may attach.
  assert.equal(badgeFor({ ocdId: HERE }, AT_POINT, "ADDRESS", null, "ADVISORY"), "NOT_GOVERNING");
  assert.equal(badgeFor({ ocdId: HERE }, AT_POINT, "ADDRESS", null, "COMMISSION"), "NOT_GOVERNING");
  assert.equal(badgeFor({ ocdId: HERE }, AT_POINT, "ADDRESS", null, "EXECUTIVE_AGENCY"), "NOT_GOVERNING");
  // Bodies with authority are untouched, and so is an unknown class.
  assert.equal(badgeFor({ ocdId: HERE }, AT_POINT, "ADDRESS", null, "GOVERNING"), "GOVERNS");
  assert.equal(badgeFor({ ocdId: HERE }, AT_POINT, "ADDRESS", null, "REGIONAL"), "GOVERNS");
  assert.equal(badgeFor({ ocdId: HERE }, AT_POINT), "GOVERNS");
  // A body elsewhere stays "nearby" and a body with no boundary stays named.
  assert.equal(badgeFor({ ocdId: ELSEWHERE }, AT_POINT, "ADDRESS", null, "ADVISORY"), "NEARBY");
  assert.equal(badgeFor({ ocdId: null }, AT_POINT, "ADDRESS", null, "ADVISORY"), "NO_BOUNDARY");
  // The copy says what the body is, from the one labels table.
  assert.equal(badgeCopyFor("NOT_GOVERNING", "ADVISORY").label, "Advisory body");
  assert.match(badgeCopyFor("NOT_GOVERNING", "ADVISORY").detail, /does not govern/i);
  assert.equal(badgeCopyFor("GOVERNS", "ADVISORY").label, "Governs your area");
});
