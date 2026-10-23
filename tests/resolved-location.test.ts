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
import {
  CLASSIFIED_LEVEL_KEYS,
  relationshipOfLevel,
} from "../lib/state/division-levels.ts";
import { LEVEL_ORDER } from "../lib/geo/address-resolution.ts";
import { deriveWhoGoverns } from "../lib/registry/who-governs.ts";
import type { CoveredBody } from "../lib/registry/coverage.ts";
import { codeOf } from "./read-code.ts";

/**
 * One resolved location, and what may be said about it. The fixture address resolves to a set of divisions
 * measured against the running app; the unnamed control is a different seam in a different state, because
 * the rule is about evidence strength and not about one state.
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

test("a zip alone settles nothing, and every hedge stands", () => {
  const location = zipOnly("85641");
  assert.equal(standingOf(body(`${D}/place:tucson`, true), location), "UNSETTLED");
  assert.equal(keepsCouldGovernPill(body(`${D}/place:tucson`, true), location), true);
  // An empty confirmed list is "not asked", never "asked and nothing governs".
  assert.deepEqual(location.confirmedDivisionIds, []);
});

/* ------------------------------------------------- the named regression --- */

test("a body the address CONFIRMED stops asking for the address", () => {
  const vail = body(`${D}/school_district:vail_unified_district`, true);
  assert.equal(standingOf(vail, VAIL_ADDRESS), "CONFIRMED");
  assert.equal(
    keepsCouldGovernPill(vail, VAIL_ADDRESS),
    false,
    "the reader already answered this; asking again is the product not listening",
  );
});

test("Tucson is hedged, and the hedge stops where the evidence does", () => {
  /*
   * The point's own divisions are `place:tucson_ccd` and `place:vail`; the city arrives only through the
   * ZIP-area widening. `place` is not a partition (a point can sit in two `place`-level divisions), so
   * confirming one place cannot exclude another the way confirming one house district excludes another.
   */
  const tucson = body(`${D}/place:tucson`, true);
  assert.equal(standingOf(tucson, VAIL_ADDRESS), "OVERLAP_NOT_RULED_OUT");
  // The mark STAYS, deliberately. An unmarked row reads as "this governs you",
  // so clearing it here would upgrade a body the address has not settled from a
  // hedged claim to a confident wrong one. See keepsCouldGovernPill.
  assert.equal(keepsCouldGovernPill(tucson, VAIL_ADDRESS), true);

  // And the CCD it is confused with is a different division entirely.
  assert.equal(
    standingOf(body(`${D}/county:pima/place:tucson_ccd`), VAIL_ADDRESS),
    "CONFIRMED",
  );
});

test("the district the address named is confirmed and its neighbour is not", () => {
  assert.equal(standingOf(body(`${D}/sldl:17`), VAIL_ADDRESS), "CONFIRMED");
  assert.equal(standingOf(body(`${D}/sldl:19`), VAIL_ADDRESS), "ELSEWHERE_IN_ZIP");
  assert.equal(standingOf(body(`${D}/sldl:21`), VAIL_ADDRESS), "ELSEWHERE_IN_ZIP");
});

/* --------------------------------------- partial ambiguity stays hedged --- */

test("an address does NOT make every fact certain — a crossed level stays hedged", () => {
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

test("a level the address never spoke to is left alone, not contradicted", () => {
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

test("a division-less body is never contradicted by an address", () => {
  // Division-less bodies (special districts, regional councils) have no level to be compared at.
  assert.equal(standingOf(body(null, true), VAIL_ADDRESS), "UNSETTLED");
  assert.equal(keepsCouldGovernPill(body(null, true), VAIL_ADDRESS), true);
});

/* ------------------------------------------------- the unnamed control --- */

test("control: a different state's zip seam behaves the same way", () => {
  // A ZIP that crosses two municipalities in another state: the same rule at a different level.
  const NJ = "ocd-division/country:us/state:nj";
  const rockaway: ResolvedLocation = {
    certainty: "ADDRESS_RESOLVED",
    zip: "07866",
    confirmedDivisionIds: [`${NJ}/county:morris`, `${NJ}/place:rockaway_township`],
    splitLevels: [],
  };
  assert.equal(standingOf(body(`${NJ}/place:rockaway_township`, true), rockaway), "CONFIRMED");
  /*
   * The contract is per level, not per pair: `place` as a class overlaps (the municipal layer is built from
   * two Census files), and this module holds identifiers, not geometry. So the second municipality gets the
   * weaker sentence.
   */
  assert.equal(
    standingOf(body(`${NJ}/place:rockaway_borough`, true), rockaway),
    "OVERLAP_NOT_RULED_OUT",
  );
  // The county is a measured partition, so the exclusion survives here.
  assert.equal(standingOf(body(`${NJ}/county:morris`, true), rockaway), "CONFIRMED");
  assert.equal(
    standingOf(body(`${NJ}/county:sussex`, true), rockaway),
    "ELSEWHERE_IN_ZIP",
  );
});

/* -------------------------------------------------------- completeness --- */

test("applying a location never drops a body", () => {
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
    // A `place` row sits at an overlapping level and an `sldl` row at an exclusive one, so they read apart.
    // Both are still here.
    ["CONFIRMED", "OVERLAP_NOT_RULED_OUT", "ELSEWHERE_IN_ZIP", "UNSETTLED"],
  );
  // Only the CONFIRMED row stops asking. The excluded ones keep the mark
  // until there is copy that says "not yours" rather than "could govern you".
  assert.deepEqual(
    applied.filter((b) => b.couldGovern === true).map((b) => b.ocdId),
    [`${D}/place:tucson`, `${D}/sldl:19`, null],
  );
});

test("browsing elsewhere never rewrites where the reader lives", () => {
  // A display state, not a truth state. Nothing here mutates a location, and
  // BROWSING settles nothing.
  const browsing: ResolvedLocation = { ...VAIL_ADDRESS, certainty: "BROWSING" };
  assert.equal(standingOf(body(`${D}/sldl:21`, true), browsing), "UNSETTLED");
  assert.equal(standingOf(body(`${D}/sldl:17`, true), browsing), "UNSETTLED");
});

/* ══════════ home location is not browsing location ═══════════════════════ */

/**
 * Selecting a district never writes where the reader lives, and `BROWSING` has a producer, so a surface can
 * say which question it is answering.
 */

test("browsing is CONSTRUCTIBLE — the state has a producer now", () => {
  const subject = browsingSubject(VAIL_ADDRESS, `${D}/sldl:21`);
  assert.equal(subject.question, "BROWSING");
  assert.equal(
    subject.location.certainty,
    "BROWSING",
    "the union member that models exploring elsewhere must be reachable",
  );
});

test("the home surface and the browse surface answer DIFFERENT questions", () => {
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

test("the browse surface still knows where HOME stands, and says so", () => {
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

test("inspecting your OWN district is not browsing elsewhere", () => {
  // Use the strongest evidence there is, applied here rather than dropped here.
  const own = browsingSubject(VAIL_ADDRESS, `${D}/sldl:17`);
  assert.equal(own.standing, "CONFIRMED");
  assert.equal(own.location.certainty, "ADDRESS_RESOLVED");
  assert.equal(own.location, VAIL_ADDRESS, "the home location passes through");
});

test("a reader who gave only a zip is never told a district is not theirs", () => {
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

test("a browse surface with no subject claims nothing", () => {
  const subject = browsingSubject(VAIL_ADDRESS, null);
  assert.equal(subject.standing, "UNSETTLED");
  assert.equal(subject.subjectOcdId, null);
});

/* ─────────── the lock: browsing NEVER mutates where the reader lives ────── */

test("LOCK: browsing anywhere never rewrites the home location", () => {
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

test("LOCK: home and browse never contradict, at any district the reader picks", () => {
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

test("deriveWhoGoverns READS standing — it used to arrive and be discarded", () => {
  // `standing` must be read here, not travel through unread.
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

  /*
   * `elsewhere` counts rows the reader's address genuinely excludes; a row at an overlapping level is still
   * rendered and annotated but is not counted as excluded.
   */
  assert.equal(derived.elsewhere, 1, "only sldl:19 is genuinely excluded");
  // The annotation survives into the rows the card renders, with its type.
  assert.deepEqual(
    derived.rows.map((r) => r.standing),
    ["CONFIRMED", "ELSEWHERE_IN_ZIP", "OVERLAP_NOT_RULED_OUT", "UNSETTLED"],
  );
});

test("standing ANNOTATES and never filters — the denominator still holds", () => {
  /*
   * An address is evidence, not a display filter: the one-denominator identity
   * `governingCount === rows.length` must survive the new count.
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

test("with no address, nothing is excluded — and that zero says so", () => {
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
 * Correct logic needs consumers, so these read the components' own source, comments stripped: a rule about
 * what the code does is measured against the code, never the prose beside it.
 */

test("WIRING: the who-governs card routes its SEATS through the location", () => {
  const card = codeOf("components", "map", "coverage-notice.tsx");

  /*
   * The surface needs a scope filter that drops excluded rows and a source for the reader's own districts that
   * is not the ZIP payload, so a repair that satisfies these has changed the rendered answer.
   */
  assert.match(
    card,
    /const statePanel = panelSeatsFor\(/,
    "the STATE seats go through the shared partition, which annotates them",
  );
  assert.match(card, /const federalPanel = panelSeatsFor\(/, "and so do the FEDERAL seats");
  assert.match(card, /const stateSeats = statePanel\.yours/, "STATE renders the reader's own");
  assert.match(card, /const federalSeats = federalPanel\.yours/, "FEDERAL renders the reader's own");

  const derivation = codeOf("lib", "state", "panel-seats.ts");
  assert.match(
    derivation,
    /scopedToAddress\(inScope, location\)/,
    "the partition SCOPES through the shared filter rather than annotating in place",
  );
  assert.match(
    derivation,
    /excludedByAddress\(inScope, location\)/,
    "and the dropped rows are still computed, so a check can assert they were dropped",
  );
  assert.doesNotMatch(
    derivation,
    /coverage\.divisions/,
    "coverage.divisions IS coverage.seats at these levels — reading it adds nothing",
  );

  // The reader's own districts come from the confirmed list, asked for by key.
  assert.match(card, /useConfirmedDivisions\(coverage, subject\.location, STATE_SEAT_TYPES\)/);
  assert.match(card, /panelSeatsFor\([\s\S]{0,120}stateConfirmed/, "and they reach the splitter");

  // The standing still reaches the row, so a walk reads it off the DOM.
  assert.match(card, /data-seat-standing=\{seat\.standing\}/);
  assert.match(card, /data-seat-sourcing=\{seat\.sourcing\}/);
});

test("WIRING: the who-governs card NAMES the question it answers", () => {
  const card = codeOf("components", "map", "coverage-notice.tsx");
  assert.match(card, /homeSubject\(resolvedLocation\)/, "the HOME subject is constructed");
  assert.match(card, /<SubjectLine zip=\{zip\}/, "and it is rendered");
});

test("WIRING: the browse surfaces name THEIR question, and it is a different one", () => {
  const popup = codeOf("components", "map", "popup", "browsing-subject-line.tsx");
  assert.match(popup, /browsingSubject\(home, ocdId\)/, "the popup constructs BROWSING");

  const modal = codeOf("components", "map", "popup", "entity-modal.tsx");
  assert.match(modal, /<BrowsingSubjectLine/, "the card renders its browsing subject");

  // ONE implementation, shared. Two copies of "which question is this" is how
  // two surfaces come to answer it differently.
  assert.match(modal, /import \{ BrowsingSubjectLine \} from "\.\/browsing-subject-line"/);
});

test("WIRING: no browse surface WRITES the home store", () => {
  /*
   * The lock, at the surface layer. `writeSessionAddress` and
   * `clearSessionAddress` are the only two writers of where the reader lives,
   * and a browse surface calling either would reopen the defect for real —
   * this time as an actual mutation rather than an apparent one.
   */
  for (const parts of [
    ["components", "map", "popup", "browsing-subject-line.tsx"],
    ["components", "map", "popup", "entity-modal.tsx"],
  ]) {
    const source = codeOf(...parts);
    assert.doesNotMatch(source, /writeSessionAddress/, `${parts.join("/")} writes the home store`);
    assert.doesNotMatch(source, /clearSessionAddress/, `${parts.join("/")} clears the home store`);
  }
});

test("WIRING: BROWSING has a producer outside the tests", () => {
  // `"BROWSING"` must be assigned somewhere outside the tests.
  const stateModule = codeOf("lib", "state", "resolved-location.ts");
  assert.match(
    stateModule,
    /certainty: "BROWSING"/,
    "the module that declares BROWSING must also construct it",
  );
});

test("the level key is the deepest segment, never a string match on a label", () => {
  assert.equal(levelKeyOf(`${D}/sldl:17`), "sldl");
  assert.equal(levelKeyOf(`${D}/county:pima/place:tucson_ccd`), "place");
  assert.equal(levelKeyOf(`${D}/county:pima`), "county");
  assert.equal(levelKeyOf("not-an-ocd-id"), null);
});

/* ══════ a shared level is not an exclusive level ═════════════════════════ */

/**
 * "Your address is in a different one" is a claim about a government, earned only where a level is a
 * partition. Measured interior points inside two or more divisions at the same level:
 *
 * ```
 * LEVEL KEY        INTERIOR POINTS INSIDE 2+ DIVISIONS AT THE SAME LEVEL
 * cd                 0 / 23
 * sldl               0 / 101
 * sldu               0 / 76
 * county             0 / 22
 * state              0 / 3
 * place             75 / 113 (AZ)   364 / 477 (NJ)
 * school_district   39 / 104
 * ```
 */

/* ------- the exclusive half: the strong sentence is still available ------- */

test("a STATE LEGISLATIVE district earns the strong sentence", () => {
  /*
   * `sldl` is a measured partition — 0 of 101 sampled interior points sit in
   * two state house districts. A point is in exactly one, so confirming
   * District 17 excludes District 19 without anyone testing District 19's
   * boundary. That is the only reasoning that ever licensed the sentence, and
   * here it holds.
   */
  assert.equal(standingOf(body(`${D}/sldl:17`), VAIL_ADDRESS), "CONFIRMED");
  assert.equal(standingOf(body(`${D}/sldl:19`), VAIL_ADDRESS), "ELSEWHERE_IN_ZIP");
  assert.equal(relationshipOfLevel("sldl"), "MUTUALLY_EXCLUSIVE_PARTITION");

  // And on the surface the reader actually sees.
  assert.equal(browsingSubject(VAIL_ADDRESS, `${D}/sldl:19`).standing, "ELSEWHERE_IN_ZIP");
});

test("a CONGRESSIONAL district earns it too", () => {
  // 0 of 23 sampled interior points sit in two congressional districts.
  assert.equal(standingOf(body(`${D}/cd:6`), VAIL_ADDRESS), "CONFIRMED");
  assert.equal(standingOf(body(`${D}/cd:7`), VAIL_ADDRESS), "ELSEWHERE_IN_ZIP");
  assert.equal(relationshipOfLevel("cd"), "MUTUALLY_EXCLUSIVE_PARTITION");
  assert.equal(browsingSubject(VAIL_ADDRESS, `${D}/cd:7`).standing, "ELSEWHERE_IN_ZIP");

  // The state senate and the county are the other two the map can reach.
  assert.equal(standingOf(body(`${D}/sldu:19`), VAIL_ADDRESS), "ELSEWHERE_IN_ZIP");
  assert.equal(
    standingOf(body("ocd-division/country:us/state:az/county:cochise"), VAIL_ADDRESS),
    "ELSEWHERE_IN_ZIP",
  );
});

/* ---- the overlapping half: the named class, and why it reaches a reader --- */

test("SCHOOL DISTRICTS overlap, so one of them never excludes another", () => {
  /*
   * `school_district` is drawn by three map layers (`unsd`, `elsd`, `scsd`) that cover the same ground, and
   * every polygon is clickable, so "this does not govern you" here would be printed about a school board the
   * reader votes for.
   */
  const AZ = "ocd-division/country:us/state:az";
  const elementaryResolved: ResolvedLocation = {
    certainty: "ADDRESS_RESOLVED",
    zip: "85122",
    confirmedDivisionIds: [`${AZ}/school_district:casa_grande_elementary_district`],
    splitLevels: [],
  };
  const highSchool = body(
    `${AZ}/school_district:casa_grande_union_high_school_district`,
    true,
  );

  assert.equal(relationshipOfLevel("school_district"), "POTENTIALLY_OVERLAPPING");
  assert.notEqual(
    standingOf(highSchool, elementaryResolved),
    "ELSEWHERE_IN_ZIP",
    "the reader votes for this board; claiming it does not govern them is a false claim about a government",
  );
  assert.equal(standingOf(highSchool, elementaryResolved), "OVERLAP_NOT_RULED_OUT");

  // The hedge stays on the row, because an unmarked row reads as "yours".
  assert.equal(keepsCouldGovernPill(highSchool, elementaryResolved), true);

  // And the browse surface carries the weaker state, not the strong one.
  const browsed = browsingSubject(elementaryResolved, highSchool.ocdId);
  assert.equal(browsed.standing, "OVERLAP_NOT_RULED_OUT");
  assert.equal(browsed.question, "BROWSING");
});

test("MUNICIPAL divisions overlap too — one layer, two Census files", () => {
  /*
   * `DISTRICT_LAYERS.municipal` merges `place` and `cousub`, so a point can be inside two `place`-level
   * divisions at once, which is why `VAIL_ADDRESS` confirms two.
   */
  assert.equal(relationshipOfLevel("place"), "POTENTIALLY_OVERLAPPING");
  assert.equal(
    standingOf(body(`${D}/place:tucson`), VAIL_ADDRESS),
    "OVERLAP_NOT_RULED_OUT",
  );
  // The reader's own two place divisions are still CONFIRMED, both of them.
  assert.equal(standingOf(body(`${D}/place:vail`), VAIL_ADDRESS), "CONFIRMED");
  assert.equal(
    standingOf(body(`${D}/county:pima/place:tucson_ccd`), VAIL_ADDRESS),
    "CONFIRMED",
  );
});

/* ------------------------- the three neutral cases ----------------------- */

test("an UNSETTLED address claims nothing at any level", () => {
  /*
   * No address, no comparison. Every level reads the same way, which is the
   * point: the level contract only ever narrows what an address may license,
   * and it can never manufacture a standing where there was none.
   */
  const zip = zipOnly("85641");
  for (const id of [
    `${D}/sldl:19`,
    `${D}/cd:7`,
    `${D}/place:tucson`,
    `${D}/school_district:vail_unified_district`,
    `${D}/county:pima`,
  ]) {
    assert.equal(standingOf(body(id, true), zip), "UNSETTLED", id);
    assert.equal(browsingSubject(zip, id).standing, "UNSETTLED", id);
  }
});

test("a SPLIT level stays neutral, at an exclusive level too", () => {
  /*
   * A street that crosses a state house line has settled nothing there, and an exclusive level does not
   * rescue an unsettled one.
   */
  const crossesHouse: ResolvedLocation = {
    ...VAIL_ADDRESS,
    confirmedDivisionIds: [`${D}/county:pima`, `${D}/sldl:17`],
    splitLevels: ["sldl"],
  };
  assert.equal(standingOf(body(`${D}/sldl:19`, true), crossesHouse), "UNSETTLED");
  assert.equal(keepsCouldGovernPill(body(`${D}/sldl:19`, true), crossesHouse), true);
  assert.equal(browsingSubject(crossesHouse, `${D}/sldl:19`).standing, "UNSETTLED");

  // The level the address DID settle is untouched by the other one's split.
  assert.equal(
    standingOf(body("ocd-division/country:us/state:az/county:cochise"), crossesHouse),
    "ELSEWHERE_IN_ZIP",
  );
});

test("an UNCLASSIFIED level FAILS CLOSED to neutral", () => {
  /*
   * A new division type would be bucketed by `levelKeyOf`; `relationshipOfLevel` answers by missing from a
   * lookup, so an unclassified level reaches the cautious branch, not even `OVERLAP_NOT_RULED_OUT`.
   */
  const AZ = "ocd-division/country:us/state:az";
  const inWaterDistrict: ResolvedLocation = {
    certainty: "ADDRESS_RESOLVED",
    zip: "85641",
    confirmedDivisionIds: [`${AZ}/water_district:avra_valley`],
    splitLevels: [],
  };
  const otherId = `${AZ}/water_district:green_valley`;
  const other = body(otherId, true);

  assert.equal(levelKeyOf(otherId), "water_district", "the bucket still forms");
  assert.equal(relationshipOfLevel("water_district"), "UNKNOWN_SEMANTICS");
  assert.equal(standingOf(other, inWaterDistrict), "UNSETTLED");
  assert.equal(browsingSubject(inWaterDistrict, otherId).standing, "UNSETTLED");
  assert.equal(keepsCouldGovernPill(other, inWaterDistrict), true);

  // The reader's own one is still confirmed — caution narrows the CLAIM, never
  // the evidence the reader themselves supplied.
  assert.equal(
    standingOf(body(`${AZ}/water_district:avra_valley`), inWaterDistrict),
    "CONFIRMED",
  );

  // A malformed identifier has no level at all and is likewise never excluded.
  assert.equal(relationshipOfLevel(null), "UNKNOWN_SEMANTICS");
  assert.equal(standingOf(body("not-an-ocd-id", true), inWaterDistrict), "UNSETTLED");
});

/* -------------------- the contract, and its coverage --------------------- */

test("every level an ADDRESS can settle is classified", () => {
  /*
   * `LEVEL_ORDER` is the resolver's own enumeration of the levels a reader can
   * be resolved at — the only levels that can ever make `settledHere` true and
   * therefore the only ones whose relationship can change a sentence. Every one
   * of them must have a measured answer, or a level entered the product without
   * anyone deciding what it licenses.
   *
   * This is the assertion that turns "fails closed" from a property of the
   * lookup into a property of the DATA: adding a resolvable level fails here
   * until it is measured, rather than failing silently on a reader's screen.
   */
  for (const level of LEVEL_ORDER) {
    assert.notEqual(
      relationshipOfLevel(level),
      "UNKNOWN_SEMANTICS",
      `${level} can be settled by an address and has no measured relationship`,
    );
  }
});

test("the contract is exactly the measured set, and nothing crept in", () => {
  /*
   * Written as an exact set rather than as spot checks, because the failure
   * this guards against is an ADDITION: a level quietly filed under
   * `MUTUALLY_EXCLUSIVE_PARTITION` because it looked like the others. Each row
   * here has geometry behind it, recorded in `lib/state/division-levels.ts`.
   */
  const byRelationship: Record<string, string[]> = {};
  for (const key of CLASSIFIED_LEVEL_KEYS) {
    (byRelationship[relationshipOfLevel(key)] ??= []).push(key);
  }

  assert.deepEqual(byRelationship.MUTUALLY_EXCLUSIVE_PARTITION.sort(), [
    "cd",
    "county",
    "sldl",
    "sldu",
    "state",
  ]);
  assert.deepEqual(byRelationship.POTENTIALLY_OVERLAPPING.sort(), [
    "aiannh",
    "place",
    "school_district",
    "special_district",
  ]);
  // UNKNOWN is unreachable BY LISTING — it exists only as a lookup miss.
  assert.equal(byRelationship.UNKNOWN_SEMANTICS, undefined);
  assert.equal(
    new Set(CLASSIFIED_LEVEL_KEYS).size,
    CLASSIFIED_LEVEL_KEYS.length,
    "a level key classified twice is a level key with two answers",
  );
});

test("WIRING: the browse copy has a branch for the weaker state", () => {
  // A standing no surface reads benefits no reader: the weak sentence must exist.
  const popup = codeOf("components", "map", "popup", "browsing-subject-line.tsx");
  assert.match(popup, /subject\.standing === "OVERLAP_NOT_RULED_OUT"/);
  // JSX wraps prose, so every copy assertion here is whitespace-tolerant: a
  // guard that a re-wrap can disarm is a guard that stops guarding silently.
  assert.match(popup, /not because it\s+governs you/, "the strong sentence survives");
  assert.match(popup, /may cover you as\s+well/, "and the weaker one exists");

  // No identifier and no enum value reaches the reader on either branch.
  assert.doesNotMatch(popup, />[^<]*ocd-division/);

  const card = codeOf("components", "map", "coverage-notice.tsx");
  assert.match(card, /marksOverlap\(body\.standing\)/, "the card marks the weaker rows");
  assert.match(card, /data-standing="OVERLAP_NOT_RULED_OUT"/);
  /*
   * After a confirmed address an excluded entity is out of scope, not annotated, so there is no branch on this
   * card for the strong mark. The weak mark (`OVERLAP_NOT_RULED_OUT`) must stay.
   */
  assert.doesNotMatch(card, /marksElsewhere/, "the exclusion mark is deleted, not improved");
});
