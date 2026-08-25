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
import {
  COULD_GOVERN_ACTION,
  COULD_GOVERN_TEXT,
} from "../lib/ballot/could-govern.ts";
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

test("M81: the census states every number, never one", () => {
  // Four states since JUR-2 (2026-08-23) added COULD_GOVERN. The census
  // states all of them, including the zeroes — a state that only appears when
  // it is non-zero is a state a reader of the report cannot tell was measured.
  const census = badgeCensus(
    [{ ocdId: HERE }, { ocdId: COUNTY }, { ocdId: ELSEWHERE }, { ocdId: null }],
    AT_POINT,
  );
  assert.deepEqual(census, { GOVERNS: 2, NEARBY: 1, NO_BOUNDARY: 1, COULD_GOVERN: 0 });
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
   * An allowlist with a reason each, rather than a bare list. Both entries are
   * TEXT or TYPES, and neither can resolve a point:
   *
   * - `../sources/types.ts` — the meeting type. The original entry.
   * - `../ballot/could-govern.ts` — the RULING 71 wording, added by `JUR-2`
   *   (2026-08-23). The `COULD_GOVERN` badge says the same thing to the same
   *   reader as the ballot page's pill, and two wordings for one claim is how
   *   they drift. It is a pair of string constants, and importing it is
   *   deliberately cheaper than retyping the sentence.
   *
   * The rule this guards is unchanged and is asserted directly below: the
   * module holds no geometry and resolves nothing.
   */
  assert.deepEqual(
    imported,
    ["../ballot/could-govern.ts", "../sources/types.ts"],
    "the badge module imports something other than the meeting type and the shared wording — " +
      "it must take the resolved answer, never resolve its own",
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

/* ========================================================================== */
/* JUR-2 — a zip may not assert jurisdiction                                  */
/* ========================================================================== */

/**
 * The 8/22 capture: the Rockaway Township Municipal Building card at 07866,
 * reading **"Governs your area"** with **"Your address is inside the area this
 * body governs"** underneath it, to a reader who had given nothing but a zip.
 *
 * `CLAUDE.md`'s first geographic rule is that a zip is orientation only and can
 * never resolve a ballot — a ZCTA crosses city, county, school district and
 * legislative lines. 07866 holds Rockaway Township, Rockaway Borough and
 * Denville Township. The card picked one and told the reader it was theirs.
 */

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
   * RULING 71 is explicit: county, school district, state and federal do not
   * become uncertain because a zip crosses a municipal line. Every reader at
   * 07866 is in Morris County. A pill on things it obviously does not apply
   * to is a pill readers learn to skip, which costs the Rockaway Borough case
   * the attention it exists to get.
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
   * `null` means the lattice never measured this zip — outside the committed
   * geometry. An empty SET means it measured and found nothing partial. The
   * two must not render alike, and the honest fall-back for unmeasured is the
   * pre-JUR-2 answer rather than a pill on everything.
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
  // And it is about the READER's street, never about our record. RULING 44.
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
  assert.deepEqual(census, { GOVERNS: 1, NEARBY: 0, NO_BOUNDARY: 1, COULD_GOVERN: 1 });
});

test("JUR-2 third era: a centroid MISS on a zip basis does not assert NEARBY", () => {
  /*
   * The half that survived two passes. `COULD_GOVERN` replaced the GOVERNS
   * assertion for a partial division, and the NEARBY beside it went on
   * asserting "this body governs a different area" from a ZCTA centroid —
   * which this module's own documentation already called "the same unearned
   * certainty pointed the other way".
   *
   * A centroid is one sample of a zip. A body governing the half of the zip
   * the reader actually lives in looks exactly like a body governing
   * somewhere else.
   */
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
