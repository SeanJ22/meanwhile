import assert from "node:assert/strict";
import test from "node:test";

import {
  applyResolvedLocation,
  browsingSubject,
  homeSubject,
  keepsCouldGovernPill,
  levelKeyOf,
  standingOf,
  zipOnly,
  type ResolvedLocation,
} from "../lib/state/resolved-location.ts";
import { deriveWhoGoverns } from "../lib/registry/who-governs.ts";
import type { CoveredBody } from "../lib/registry/coverage.ts";
import { codeOf } from "./read-code.ts";

/**
 * WGH-12/13/14, BAL-31 — one resolved location, and what may be said about it.
 *
 * The reported geography is 85641 with `10723 South Bear Table Tank Drive`,
 * whose point resolves to `place:tucson_ccd`, `place:vail`,
 * `school_district:vail_unified_district`, `county:pima`, `sldl:17`, `sldu:17`
 * and `cd:6` — measured against the running app, not assumed.
 *
 * The unnamed control is a DIFFERENT seam in a different state, because the
 * rule is about evidence strength and not about Arizona.
 */

const D = "ocd-division/country:us/state:az";
const VAIL_ADDRESS: ResolvedLocation = {
  certainty: "ADDRESS_RESOLVED",
  zip: "85641",
  confirmedDivisionIds: [
    `${D}/county:pima/place:tucson_ccd`,
    `${D}/place:vail`,
    `${D}/school_district:vail_unified_district`,
    `${D}/county:pima`,
    `${D}/sldl:17`,
    `${D}/sldu:17`,
    `${D}/cd:6`,
  ],
  splitLevels: [],
};

const body = (ocdId: string | null, couldGovern = false) => ({ ocdId, couldGovern });

/* ------------------------------------------------------- the zip state --- */

test("WGH: a zip alone settles nothing, and every hedge stands", () => {
  const location = zipOnly("85641");
  assert.equal(standingOf(body(`${D}/place:tucson`, true), location), "UNSETTLED");
  assert.equal(keepsCouldGovernPill(body(`${D}/place:tucson`, true), location), true);
  // An empty confirmed list is "not asked", never "asked and nothing governs".
  assert.deepEqual(location.confirmedDivisionIds, []);
});

/* ------------------------------------------------- the named regression --- */

test("WGH-14: a body the address CONFIRMED stops asking for the address", () => {
  const vail = body(`${D}/school_district:vail_unified_district`, true);
  assert.equal(standingOf(vail, VAIL_ADDRESS), "CONFIRMED");
  assert.equal(
    keepsCouldGovernPill(vail, VAIL_ADDRESS),
    false,
    "the reader already answered this; asking again is the product not listening",
  );
});

test("WGH-13: Tucson is ELSEWHERE, and it is the widening that put it there", () => {
  /*
   * The point's own divisions are `place:tucson_ccd` and `place:vail`. The
   * City of Tucson arrives only through the zip-area widening, and the address
   * settles the `place` level against it.
   */
  const tucson = body(`${D}/place:tucson`, true);
  assert.equal(standingOf(tucson, VAIL_ADDRESS), "ELSEWHERE_IN_ZIP");
  // The mark STAYS, deliberately. An unmarked row reads as "this governs you",
  // so clearing it here would upgrade a body the address excludes from a hedged
  // claim to a confident wrong one. See keepsCouldGovernPill.
  assert.equal(keepsCouldGovernPill(tucson, VAIL_ADDRESS), true);

  // And the CCD it is confused with is a different division entirely.
  assert.equal(
    standingOf(body(`${D}/county:pima/place:tucson_ccd`), VAIL_ADDRESS),
    "CONFIRMED",
  );
});

test("WGH-12: the district the address named is confirmed and its neighbour is not", () => {
  assert.equal(standingOf(body(`${D}/sldl:17`), VAIL_ADDRESS), "CONFIRMED");
  assert.equal(standingOf(body(`${D}/sldl:19`), VAIL_ADDRESS), "ELSEWHERE_IN_ZIP");
  assert.equal(standingOf(body(`${D}/sldl:21`), VAIL_ADDRESS), "ELSEWHERE_IN_ZIP");
});

/* --------------------------------------- partial ambiguity stays hedged --- */

test("WGH: an address does NOT make every fact certain — a crossed level stays hedged", () => {
  // The overreach this rule is written against. The street crosses the school
  // district line, so that level is genuinely unsettled and keeps its pill,
  // while the levels the address DID settle retire theirs.
  const partial: ResolvedLocation = {
    ...VAIL_ADDRESS,
    confirmedDivisionIds: [`${D}/county:pima`, `${D}/sldl:17`],
    splitLevels: ["school_district"],
  };
  const school = body(`${D}/school_district:vail_unified_district`, true);
  assert.equal(standingOf(school, partial), "UNSETTLED");
  assert.equal(keepsCouldGovernPill(school, partial), true);
  assert.equal(standingOf(body(`${D}/sldl:17`, true), partial), "CONFIRMED");
});

test("WGH: a level the address never spoke to is left alone, not contradicted", () => {
  const onlyState: ResolvedLocation = {
    ...VAIL_ADDRESS,
    confirmedDivisionIds: [`${D}/sldl:17`],
    splitLevels: [],
  };
  // Nothing was settled at `school_district`, so a school body is UNSETTLED
  // rather than "elsewhere" — silence is not a contradiction.
  assert.equal(
    standingOf(body(`${D}/school_district:vail_unified_district`, true), onlyState),
    "UNSETTLED",
  );
});

test("WGH: a division-less body is never contradicted by an address", () => {
  // D28 bodies — special districts, regional councils — have no level to be
  // compared at. Inferring "elsewhere" from an absence asserts an absence.
  assert.equal(standingOf(body(null, true), VAIL_ADDRESS), "UNSETTLED");
  assert.equal(keepsCouldGovernPill(body(null, true), VAIL_ADDRESS), true);
});

/* ------------------------------------------------- the unnamed control --- */

test("WGH control: a different state's zip seam behaves the same way", () => {
  /*
   * 07866 crosses Rockaway Township and Rockaway Borough — the seam NJ01 was
   * adopted over, a different state, a different level, the same rule. Nothing
   * in this module knows about Arizona.
   */
  const NJ = "ocd-division/country:us/state:nj";
  const rockaway: ResolvedLocation = {
    certainty: "ADDRESS_RESOLVED",
    zip: "07866",
    confirmedDivisionIds: [`${NJ}/county:morris`, `${NJ}/place:rockaway_township`],
    splitLevels: [],
  };
  assert.equal(standingOf(body(`${NJ}/place:rockaway_township`, true), rockaway), "CONFIRMED");
  assert.equal(standingOf(body(`${NJ}/place:rockaway_borough`, true), rockaway), "ELSEWHERE_IN_ZIP");
  assert.equal(standingOf(body(`${NJ}/county:morris`, true), rockaway), "CONFIRMED");
});

/* -------------------------------------------------------- completeness --- */

test("WGH: applying a location never drops a body", () => {
  const bodies = [
    body(`${D}/place:vail`, true),
    body(`${D}/place:tucson`, true),
    body(`${D}/sldl:19`, true),
    body(null, true),
  ];
  const applied = applyResolvedLocation(bodies, VAIL_ADDRESS);
  assert.equal(applied.length, bodies.length, "show everything we find");
  assert.deepEqual(
    applied.map((b) => b.standing),
    ["CONFIRMED", "ELSEWHERE_IN_ZIP", "ELSEWHERE_IN_ZIP", "UNSETTLED"],
  );
  // Only the CONFIRMED row stops asking. The excluded ones keep the mark
  // until there is copy that says "not yours" rather than "could govern you".
  assert.deepEqual(
    applied.filter((b) => b.couldGovern === true).map((b) => b.ocdId),
    [`${D}/place:tucson`, `${D}/sldl:19`, null],
  );
});

test("WGH: browsing elsewhere never rewrites where the reader lives", () => {
  // A display state, not a truth state. Nothing here mutates a location, and
  // BROWSING settles nothing.
  const browsing: ResolvedLocation = { ...VAIL_ADDRESS, certainty: "BROWSING" };
  assert.equal(standingOf(body(`${D}/sldl:21`, true), browsing), "UNSETTLED");
  assert.equal(standingOf(body(`${D}/sldl:17`, true), browsing), "UNSETTLED");
});

/* ══════════ WGH-15: home location is not browsing location ══════════════ */

/**
 * The reported screen had two panels open at once — *State House District 17*
 * on the who-governs card, *State House District 19* on the district popup —
 * and both were correct. The two stores were already disjoint and selecting a
 * district has never written where the reader lives.
 *
 * What was missing is that `BROWSING` was DECLARED AND NEVER CONSTRUCTED. The
 * only assignment of it anywhere in the repository was the display-state test
 * above, so no surface could be in the state that models *I am exploring
 * elsewhere*, so no surface could say which question it was answering.
 */

test("WGH-15: browsing is CONSTRUCTIBLE — the state has a producer now", () => {
  const subject = browsingSubject(VAIL_ADDRESS, `${D}/sldl:21`);
  assert.equal(subject.question, "BROWSING");
  assert.equal(
    subject.location.certainty,
    "BROWSING",
    "the union member that models exploring elsewhere must be reachable",
  );
});

test("WGH-15: the home surface and the browse surface answer DIFFERENT questions", () => {
  // The whole product requirement, in one assertion: a reader lives in House 17
  // and inspects House 21, and the two surfaces are distinguishable.
  const home = homeSubject(VAIL_ADDRESS);
  const browsed = browsingSubject(VAIL_ADDRESS, `${D}/sldl:21`);

  assert.equal(home.question, "HOME");
  assert.equal(browsed.question, "BROWSING");
  assert.notEqual(home.question, browsed.question);

  // The home surface reasons from the strongest evidence there is...
  assert.equal(home.location.certainty, "ADDRESS_RESOLVED");
  assert.equal(standingOf(body(`${D}/sldl:17`), home.location), "CONFIRMED");

  // ...and the browse surface settles NOTHING, so it cannot claim District 21
  // governs anyone.
  assert.equal(standingOf(body(`${D}/sldl:21`), browsed.location), "UNSETTLED");
  assert.equal(standingOf(body(`${D}/sldl:17`), browsed.location), "UNSETTLED");
});

test("WGH-15: the browse surface still knows where HOME stands, and says so", () => {
  /*
   * The ORDER inside `browsingSubject` is the design: standing is computed
   * against HOME first, and only then is the location downgraded. Without that
   * the browse card could name its subject but could never say "your address is
   * in a different one" — which is the sentence that dissolves the apparent
   * contradiction.
   */
  assert.equal(browsingSubject(VAIL_ADDRESS, `${D}/sldl:19`).standing, "ELSEWHERE_IN_ZIP");
  assert.equal(browsingSubject(VAIL_ADDRESS, `${D}/sldl:21`).standing, "ELSEWHERE_IN_ZIP");
  assert.equal(browsingSubject(VAIL_ADDRESS, `${D}/county:pima`).standing, "CONFIRMED");
});

test("WGH-15: inspecting your OWN district is not browsing elsewhere", () => {
  // Use the strongest evidence there is, applied here rather than dropped here.
  const own = browsingSubject(VAIL_ADDRESS, `${D}/sldl:17`);
  assert.equal(own.standing, "CONFIRMED");
  assert.equal(own.location.certainty, "ADDRESS_RESOLVED");
  assert.equal(own.location, VAIL_ADDRESS, "the home location passes through");
});

test("WGH-15: a reader who gave only a zip is never told a district is not theirs", () => {
  /*
   * `UNSETTLED`, never `ELSEWHERE_IN_ZIP`. Nothing has settled which district
   * is theirs, and saying "this is not yours" on no evidence is an absence
   * asserted as a fact about the reader.
   */
  const subject = browsingSubject(zipOnly("85641"), `${D}/sldl:19`);
  assert.equal(subject.standing, "UNSETTLED");
  assert.equal(subject.location.certainty, "BROWSING");

  // And with no home at all — a reader who panned the map and named nothing.
  assert.equal(browsingSubject(zipOnly(null), `${D}/sldl:19`).standing, "UNSETTLED");
});

test("WGH-15: a browse surface with no subject claims nothing", () => {
  const subject = browsingSubject(VAIL_ADDRESS, null);
  assert.equal(subject.standing, "UNSETTLED");
  assert.equal(subject.subjectOcdId, null);
});

/* ─────────── the lock: browsing NEVER mutates where the reader lives ────── */

test("WGH-15 LOCK: browsing anywhere never rewrites the home location", () => {
  /*
   * The two stores are already disjoint and this test exists so they STAY that
   * way. It is written against the OBJECT, not against the reducer, because the
   * reducer path is locked by `tests/one-at-a-time.test.ts` and this is the
   * other half: a pure function that took a home location and handed back a
   * mutated one would reopen the defect with no dispatch involved at all.
   */
  const before = JSON.parse(JSON.stringify(VAIL_ADDRESS)) as ResolvedLocation;

  for (const subject of [
    `${D}/sldl:19`,
    `${D}/sldl:21`,
    `${D}/place:tucson`,
    `${D}/school_district:vail_unified_district`,
    null,
  ]) {
    const browsed = browsingSubject(VAIL_ADDRESS, subject);
    // Nothing about WHERE THE READER LIVES may differ. Only `certainty` — the
    // surface's own reading state — is allowed to change.
    assert.equal(browsed.location.zip, before.zip);
    assert.deepEqual(browsed.location.confirmedDivisionIds, before.confirmedDivisionIds);
    assert.deepEqual(browsed.location.splitLevels, before.splitLevels);
  }

  // And the home object itself is untouched after every one of those calls.
  assert.deepEqual(VAIL_ADDRESS, before, "browsing mutated the reader's home");

  // The home surface still answers exactly as it did before anyone browsed.
  assert.equal(standingOf(body(`${D}/sldl:17`), homeSubject(VAIL_ADDRESS).location), "CONFIRMED");
  assert.equal(standingOf(body(`${D}/sldl:19`), homeSubject(VAIL_ADDRESS).location), "ELSEWHERE_IN_ZIP");
});

test("WGH-15 LOCK: home and browse never contradict, at any district the reader picks", () => {
  /*
   * The product requirement stated as an invariant rather than as a scenario.
   * For EVERY district in the zip, the home answer about District 17 is stable
   * and the browse answer never claims the browsed district governs the reader.
   */
  for (const picked of ["17", "19", "21", "18", "2"]) {
    const browsed = browsingSubject(VAIL_ADDRESS, `${D}/sldl:${picked}`);

    // The home question's answer does not move because a reader tapped a map.
    assert.equal(
      standingOf(body(`${D}/sldl:17`), homeSubject(VAIL_ADDRESS).location),
      "CONFIRMED",
      `picking ${picked} moved the home answer`,
    );

    // And the browse surface can only ever say CONFIRMED about the reader's own.
    if (picked !== "17") {
      assert.notEqual(browsed.standing, "CONFIRMED", `${picked} claimed to be home`);
    }
  }
});

/* ────────────── who-governs READS standing, rather than dropping it ─────── */

const covered = (
  ocdId: string | null,
  bodyClass: CoveredBody["bodyClass"] = "GOVERNING",
): CoveredBody =>
  ({
    bodyId: `${ocdId ?? "none"}#governing`,
    ocdId,
    name: null,
    divisionLabel: ocdId ?? "no division",
    divisionType: null,
    lsad: null,
    bodyClass,
    coverageStatus: "NOT_ATTEMPTED",
    homepageUrl: null,
    agendaSourceRef: null,
    lookedAt: false,
    tier: "local",
  }) as CoveredBody;

test("WGH-15: deriveWhoGoverns READS standing — it used to arrive and be discarded", () => {
  /*
   * The annotation reached this function and travelled through unread: the
   * parameter was typed `readonly CoveredBody[]`, so `standing` was invisible
   * to the compiler and to every line inside. That is the WGH-12/13/14 defect
   * — *correct, and had zero consumers* — one level further down.
   */
  const annotated = applyResolvedLocation(
    [
      covered(`${D}/sldl:17`),
      covered(`${D}/sldl:19`),
      covered(`${D}/place:tucson`),
      covered(null),
    ],
    VAIL_ADDRESS,
  );

  const derived = deriveWhoGoverns(annotated, new Set<string>());

  assert.equal(derived.elsewhere, 2, "sldl:19 and place:tucson are both excluded");
  // The annotation survives into the rows the card renders, with its type.
  assert.deepEqual(
    derived.rows.map((r) => r.standing),
    ["CONFIRMED", "ELSEWHERE_IN_ZIP", "ELSEWHERE_IN_ZIP", "UNSETTLED"],
  );
});

test("WGH-15: standing ANNOTATES and never filters — the denominator still holds", () => {
  /*
   * RULING 26 and RULING 27. An address is evidence, not a display filter, and
   * a body that governs somewhere else in the zip is one we hold in full. The
   * one-denominator identity `governingCount === rows.length` must survive the
   * new count, or item 1a is reopened.
   */
  const bodies = [
    covered(`${D}/sldl:17`),
    covered(`${D}/sldl:19`),
    covered(`${D}/place:tucson`),
    covered(`${D}/place:vail`, "COMMISSION"),
  ];

  const plain = deriveWhoGoverns(bodies, new Set<string>());
  const annotated = deriveWhoGoverns(
    applyResolvedLocation(bodies, VAIL_ADDRESS),
    new Set<string>(),
  );

  assert.equal(
    annotated.rows.length,
    plain.rows.length,
    "annotating a location removed a row",
  );
  assert.equal(annotated.governingCount, annotated.rows.length, "one denominator");
  assert.equal(annotated.others, plain.others);
  assert.ok(annotated.elsewhere > 0, "and the exclusions are still COUNTED");
});

test("WGH-15: with no address, nothing is excluded — and that zero says so", () => {
  // Zero here is "we have not been told", never "none of these are excluded".
  const bodies = [covered(`${D}/sldl:17`), covered(`${D}/sldl:19`)];
  const zip = deriveWhoGoverns(
    applyResolvedLocation(bodies, zipOnly("85641")),
    new Set<string>(),
  );
  assert.equal(zip.elsewhere, 0);

  // And a BROWSING location cannot exclude anything either — a reader who is
  // exploring elsewhere has not told us anything new about their home.
  const browsed = deriveWhoGoverns(
    applyResolvedLocation(
      bodies,
      browsingSubject(VAIL_ADDRESS, `${D}/sldl:21`).location,
    ),
    new Set<string>(),
  );
  assert.equal(browsed.elsewhere, 0, "browsing may not exclude a body from home");
});

/* ═══════════════ WIRING IS ITS OWN STEP — the surfaces are guarded ═══════ */

/**
 * **The whole of WGH-12/13/14 and of WGH-15 is that correct logic had no
 * consumers.** A test that only exercises the pure functions above would have
 * passed on the day of the bug report, with the store correct, `standingOf`
 * correct, and the STATE section on screen still never asking.
 *
 * So these read the components' own SOURCE, comments stripped — the same
 * instrument `tests/could-govern-pill.test.ts` uses, and for the same reason: a
 * rule about what the code DOES must be measured against the code, never
 * against the prose beside it.
 */
/*
 * ONE implementation, shared with `could-govern-pill.test.ts` — RULING 103.
 * A second byte-identical copy landed here first and the duplicate sweep
 * caught it, which is the guard doing exactly its job: two copies of "what
 * counts as code" are two places for the stripping rule to drift, and a guard
 * that strips differently from its sibling silently guards something else.
 */

test("WGH-15 WIRING: the who-governs card routes its SEATS through the location", () => {
  /*
   * The exact surface in the report. `bodies` was annotated on 2026-08-28 and
   * `seats` was not, so the STATE section — the rows the reader photographed —
   * was the one list on the card that never asked.
   */
  const card = codeOf("components", "map", "coverage-notice.tsx");

  assert.match(
    card,
    /const seatsHere = applyResolvedLocation\(seats,/,
    "the seats must go through the same function the bodies do",
  );
  assert.match(card, /const stateSeats = seatsHere\./, "STATE reads the annotated seats");
  assert.match(card, /const federalSeats = seatsHere\./, "FEDERAL reads them too");

  // And the exclusion actually reaches the row rather than being computed and
  // dropped a third time.
  assert.match(card, /data-seat-standing=\{seat\.standing\}/);
  assert.match(card, /marksElsewhere\(seat\.standing\)/);
});

test("WGH-15 WIRING: the who-governs card NAMES the question it answers", () => {
  const card = codeOf("components", "map", "coverage-notice.tsx");
  assert.match(card, /homeSubject\(resolvedLocation\)/, "the HOME subject is constructed");
  assert.match(card, /<SubjectLine zip=\{zip\}/, "and it is rendered");
});

test("WGH-15 WIRING: the browse surfaces name THEIR question, and it is a different one", () => {
  const popup = codeOf("components", "map", "popup", "district-popup.tsx");
  assert.match(popup, /browsingSubject\(home, ocdId\)/, "the popup constructs BROWSING");
  assert.match(popup, /<BrowsingSubjectLine/, "and renders the line");

  const modal = codeOf("components", "map", "popup", "entity-modal.tsx");
  assert.match(modal, /<BrowsingSubjectLine/, "the large card carries it too");

  // ONE implementation, shared. Two copies of "which question is this" is how
  // two surfaces come to answer it differently.
  assert.match(modal, /import \{ BrowsingSubjectLine \} from "\.\/district-popup"/);
});

test("WGH-15 WIRING: no browse surface WRITES the home store", () => {
  /*
   * The lock, at the surface layer. `writeSessionAddress` and
   * `clearSessionAddress` are the only two writers of where the reader lives,
   * and a browse surface calling either would reopen the defect for real —
   * this time as an actual mutation rather than an apparent one.
   */
  for (const parts of [
    ["components", "map", "popup", "district-popup.tsx"],
    ["components", "map", "popup", "entity-modal.tsx"],
  ]) {
    const source = codeOf(...parts);
    assert.doesNotMatch(source, /writeSessionAddress/, `${parts.join("/")} writes the home store`);
    assert.doesNotMatch(source, /clearSessionAddress/, `${parts.join("/")} clears the home store`);
  }
});

test("WGH-15 WIRING: BROWSING has a producer outside the tests", () => {
  /*
   * The defect in one assertion. Before this change the ONLY assignment of
   * `"BROWSING"` anywhere in the repository was in this file — a declared union
   * member with no producer, which is a state no surface could ever be in.
   */
  const stateModule = codeOf("lib", "state", "resolved-location.ts");
  assert.match(
    stateModule,
    /certainty: "BROWSING"/,
    "the module that declares BROWSING must also construct it",
  );
});

test("WGH: the level key is the deepest segment, never a string match on a label", () => {
  assert.equal(levelKeyOf(`${D}/sldl:17`), "sldl");
  assert.equal(levelKeyOf(`${D}/county:pima/place:tucson_ccd`), "place");
  assert.equal(levelKeyOf(`${D}/county:pima`), "county");
  assert.equal(levelKeyOf("not-an-ocd-id"), null);
});
