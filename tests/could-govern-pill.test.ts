import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  COULD_GOVERN_ACTION,
  COULD_GOVERN_SENTENCE,
  COULD_GOVERN_TEXT,
} from "../lib/ballot/could-govern.ts";
import { needsPill, zipCertainty } from "../lib/geo/zip-certainty.ts";

/**
 * **RULING 71 — a zip cannot answer "who governs you"; a street address can.**
 * (NJ Hunt 3 item 3, 2026-08-22.)
 *
 * Borough and township are COEQUAL forms of municipality in New Jersey.
 * Rockaway Borough and Rockaway Township are two separate adjacent
 * municipalities sharing a name, and neither governs the other's residents.
 * 07866 crosses the line, so "who governs you" has two correct answers there
 * depending on which side of a street the reader lives on.
 *
 * These guard three things: that certainty is measured rather than hand-listed,
 * that the pill lands on the ambiguous bodies and on no others, and — the one
 * that matters most for the long run — that the pill is not a completeness
 * marker and cannot be mistaken for one by a later session reading RULING 44.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/**
 * Read a module's CODE, comments stripped.
 *
 * The guards below ask whether a module TOUCHES something — `localStorage`, a
 * coordinate field, a `fetch`. A doc comment explaining why it deliberately
 * does NOT touch that thing contains the word too, and the first version of
 * this file failed on its own explanation. `tests/no-suppression.test.ts`
 * strips comments for the same reason: a rule about what the code DOES must be
 * measured against the code, never against the prose beside it.
 */
function codeOf(...parts: string[]): string {
  const source = readFileSync(join(ROOT, ...parts), "utf8");
  const blockComments = new RegExp("/\\*[\\s\\S]*?\\*/", "g");
  const lineComments = new RegExp("(^|[^:])//[^\\n]*", "gm");
  return source.replace(blockComments, " ").replace(lineComments, "$1 ");
}

/* ========================================================================== */
/* 1. Certainty is MEASURED, and it lands where RULING 71 says it should      */
/* ========================================================================== */

test("3.2: at 07866 the county and the regional district govern everyone — no pill", async () => {
  const c = await zipCertainty("07866");
  assert.ok(c, "07866 is inside this repo's committed geometry");
  assert.equal(c.certaintyOf("ocd-division/country:us/state:nj/county:morris"), "CERTAIN");
  assert.equal(
    c.certaintyOf(
      "ocd-division/country:us/state:nj/school_district:morris_hills_regional_school_district",
    ),
    "CERTAIN",
    "Morris Hills Regional covers the whole zip — a school district is not automatically ambiguous",
  );
});

test("3.2: at 07866 the two Rockaways and Denville each govern PART — pill", async () => {
  const c = await zipCertainty("07866");
  assert.ok(c);
  for (const id of [
    "ocd-division/country:us/state:nj/county:morris/place:rockaway_borough",
    "ocd-division/country:us/state:nj/county:morris/place:rockaway_township",
    "ocd-division/country:us/state:nj/county:morris/place:denville_township",
    "ocd-division/country:us/state:nj/school_district:rockaway_borough_school_district",
    "ocd-division/country:us/state:nj/school_district:rockaway_township_school_district",
    "ocd-division/country:us/state:nj/school_district:denville_township_school_district",
  ]) {
    assert.equal(c.certaintyOf(id), "AMBIGUOUS", `${id} covers only part of 07866`);
    assert.equal(needsPill(c.certaintyOf(id)), true);
  }
});

test("3.7: the pill is NOT universal — Newbury governs everyone at 03255", async () => {
  /*
   * The check that stops this becoming decoration. If every municipality
   * carried the pill it would say nothing, and the reader would learn to skip
   * it. 03255 sits entirely inside Newbury, so Newbury's card is unmarked.
   */
  const c = await zipCertainty("03255");
  assert.ok(c);
  assert.equal(
    c.certaintyOf("ocd-division/country:us/state:nh/county:merrimack/place:newbury_town"),
    "CERTAIN",
  );
  assert.equal(
    c.certaintyOf("ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district"),
    "CERTAIN",
  );
});

test("3.8: a zip that crosses nothing carries no pill at all", async () => {
  // 85701 is downtown Tucson: one county, one place, one district, all whole.
  const c = await zipCertainty("85701");
  assert.ok(c);
  assert.equal(c.partial.length, 0, "85701 crosses no governing boundary");
});

test("3.2: an UNMEASURED division gets the pill, never a certainty it never earned", async () => {
  const c = await zipCertainty("07866");
  assert.ok(c);
  assert.equal(
    c.certaintyOf("ocd-division/country:us/state:nj/place:not_a_real_division"),
    "UNKNOWN",
  );
  assert.equal(
    needsPill("UNKNOWN"),
    true,
    "a render default may never manufacture a claim out of a measurement nobody took",
  );
});

test("3.2: a zip outside our committed geometry resolves to null, not to certainty", async () => {
  assert.equal(await zipCertainty("99999"), null);
  assert.equal(await zipCertainty("abc"), null);
  assert.equal(await zipCertainty(null), null);
});

test("3.8: the index states how many zips cross, and it is a real fraction", async () => {
  const idx = JSON.parse(
    readFileSync(join(ROOT, "data", "derived", "zip-division-ids.json"), "utf8"),
  ) as { counts: { zips: number; zipsWithAPartialDivision: number; zipsWithNoCountyEdge: number } };
  assert.ok(idx.counts.zipsWithAPartialDivision > 0, "boundary-crossing zips are not exotic");
  assert.ok(
    idx.counts.zipsWithAPartialDivision < idx.counts.zips,
    "nor are they universal — a pill on everything would say nothing",
  );
  assert.equal(
    idx.counts.zipsWithNoCountyEdge,
    0,
    "every zip's total is established from its county edges; a zip without one would be unmeasurable",
  );
});

/* ========================================================================== */
/* 2. THE RULING 44 DISTINCTION — the reason this test file exists            */
/* ========================================================================== */

/**
 * RULING 44 bans a per-card COMPLETENESS statement: a marker saying *we did not
 * find this*, printed next to a named person, worn only by the shortest card in
 * the race. RULING 71's pill says *this is a fact about your street that only
 * you can settle*.
 *
 * The two are different claims about different subjects, and a later session
 * reading RULING 44 alone could reasonably delete the pill as a violation of
 * it. That would be wrong, and it is the failure this section exists to
 * prevent — so the distinction is asserted mechanically rather than left to be
 * re-derived from two documents.
 *
 * The lexicons are the ones `tests/no-suppression.test.ts` uses for the same
 * rule, restated here rather than imported: this file must keep passing on its
 * own terms if that file is ever reorganised, and the point is that the pill
 * carries NONE of this vocabulary.
 */
const ABSENCE_POLARITY =
  /\b(haven'?t|hasn'?t|no|nothing|none|missing|few|little|thin|sparse|empty|still|not yet|yet)\b/i;
const COVERAGE_OBJECT =
  /\b(collected|found|information|detail|details|data|record|records|published|research|words|profile|material|source|sources)\b/i;
const OUR_SUBJECT = /\b(we|our|us|this candidate|this card|so far)\b/i;

test("RULING 44: the pill makes no claim about OUR data", () => {
  const sentence = COULD_GOVERN_SENTENCE;
  assert.equal(sentence, `${COULD_GOVERN_TEXT} — ${COULD_GOVERN_ACTION}`);
  assert.doesNotMatch(
    sentence,
    ABSENCE_POLARITY,
    "the pill states no absence — nothing is missing, and saying so would be a completeness marker",
  );
  assert.doesNotMatch(
    sentence,
    COVERAGE_OBJECT,
    "the pill names no coverage object — it is not about records, research or what was found",
  );
  assert.doesNotMatch(
    sentence,
    OUR_SUBJECT,
    "the pill's subject is the READER and their street, never us and never this record",
  );
});

test("RULING 44: the pill's subject is the reader's location, and it says so", () => {
  const sentence = COULD_GOVERN_SENTENCE;
  assert.equal(sentence, `${COULD_GOVERN_TEXT} — ${COULD_GOVERN_ACTION}`);
  assert.match(sentence, /\byou\b/i, "it addresses the reader");
  assert.match(sentence, /\baddress\b/i, "it names the thing only the reader can supply");
  assert.match(sentence, /\bgovern/i, "the verb is govern — the whole question RULING 71 is about");
});

test("RULING 44: the pill attaches to a BODY, never to a candidate", () => {
  /*
   * The structural half. A completeness marker's defining harm was that it
   * printed next to a named person on the thinnest card. This renders on the
   * contest heading, which is a body — so it can never single out a candidate,
   * whatever it says.
   */
  const page = codeOf("app", "ballot", "page.tsx");
  assert.match(page, /<CouldGovernPill/, "the pill is rendered by the ballot page");

  const card = codeOf("components", "ballot", "candidate-card.tsx");
  assert.doesNotMatch(
    card,
    /CouldGovernPill|could-govern/,
    "the pill may never reach a candidate card — that is the RULING 44 harm exactly",
  );
});

test("RULING 71: the pill never gates — the page renders every contest regardless", () => {
  const page = codeOf("app", "ballot", "page.tsx");
  // `needsPill` may only decide a MARKER. If it ever decided a filter, a
  // contest would vanish because of where a reader might live, which is
  // RULING 26 broken by the rule that was meant to respect the reader.
  assert.doesNotMatch(
    page,
    /\.filter\([^)]*needsPill/,
    "certainty may never filter a contest out of the page",
  );
  assert.doesNotMatch(
    page,
    /needsPill\([^)]*\)\s*(&&\s*)?\?\s*null/,
    "certainty may never render a contest as nothing",
  );
});

/* ========================================================================== */
/* 3. RULING 74 — what the session keeps, and what it must never keep         */
/* ========================================================================== */

test("RULING 74: the session store keeps the OUTCOME, never the address", () => {
  const mod = codeOf("lib", "geo", "session-address.ts");
  // The shape is the guarantee. A field for a house number or a coordinate
  // would make this a location record, which is the one thing it must not be.
  assert.doesNotMatch(
    mod,
    /\b(houseNumber|house_number|lat\??:|lng\??:|latitude|longitude)\b/,
    "no coordinate and no house number may enter the session payload",
  );
  assert.match(mod, /sessionStorage/, "the lifetime is the tab, not the device");
  assert.doesNotMatch(
    mod,
    /localStorage|document\.cookie/,
    "localStorage survives the session and a cookie reaches the server's access logs",
  );
});

test("RULING 74: nothing about the address reaches the server or a store", () => {
  const mod = codeOf("lib", "geo", "session-address.ts");
  assert.doesNotMatch(
    mod,
    /\bfetch\(|logEvent|insert\(|db\./,
    "the session address module makes no request and writes no row — it is browser-local, entirely",
  );
});

test("RULING 74: an address given for one zip does not answer for another", () => {
  const mod = codeOf("lib", "geo", "session-address.ts");
  assert.match(
    mod,
    /scope\.zip === zip/,
    "a scope resolved in one zip says nothing about another, and asserting otherwise would be the product claiming a location the reader never gave it",
  );
});

test("RULING 74: the narrowing surface reads the session before it prompts", () => {
  /*
   * WGH-5 (2026-08-22): the ballot page and the map card had two separate
   * address forms; there is now ONE, and the session read lives in it. The
   * guard follows the behaviour rather than the file — same claim, same
   * strength, and it now covers every surface at once instead of one.
   */
  const narrowing = codeOf("components", "address", "address-prompt.tsx");
  assert.match(narrowing, /sessionAddressFor\(zip\)/, "it asks what the session already holds");
  assert.match(narrowing, /writeSessionAddress\(/, "and it records its own answer for the others");
  assert.match(
    narrowing,
    /clearSessionAddress\(\)/,
    "undo forgets it everywhere, not only here — a reader asking for the whole zip back is asking us to forget",
  );
});

/* ========================================================================== */
/* 4. Statewide is certain; a congressional district is not                   */
/* ========================================================================== */

/*
 * Found by READING THE DOM of a production capture before opening the image —
 * which is the whole reason RULING 2 asks for facts printed before evidence.
 * The first deploy put the pill on "Member of the United States Senate" at
 * 07866 and on five contests at 03255 where Newbury governs everyone, because
 * a statewide division is absent from the lattice index and fell through to
 * UNKNOWN.
 */

test("3.3: a statewide office is CERTAIN — every reader at this zip votes in it", async () => {
  const nj = await zipCertainty("07866");
  assert.ok(nj);
  assert.equal(nj.certaintyOf("ocd-division/country:us/state:nj"), "CERTAIN");
  assert.equal(nj.certaintyOf("ocd-division/country:us"), "CERTAIN");

  const nh = await zipCertainty("03255");
  assert.ok(nh);
  assert.equal(nh.certaintyOf("ocd-division/country:us/state:nh"), "CERTAIN");
});

test("3.3: a congressional district is NOT statewide and keeps the pill", async () => {
  /*
   * `cd:11` looks federal and is not statewide. A zip can cross a
   * congressional line exactly as it crosses a municipal one, this repo has
   * not measured whether 07866 does, and the district reached the page by
   * being resolved from the ZCTA CENTROID — one point, which is the thing
   * `CLAUDE.md` says a zip may never be used for. The pill is true.
   */
  const c = await zipCertainty("07866");
  assert.ok(c);
  assert.notEqual(
    c.certaintyOf("ocd-division/country:us/state:nj/cd:11"),
    "CERTAIN",
    "a House district resolved from one point may not render as settled",
  );
  assert.equal(needsPill(c.certaintyOf("ocd-division/country:us/state:nj/cd:11")), true);
});

test("3.3: the statewide rule matches the SHAPE exactly, not a prefix", async () => {
  const c = await zipCertainty("07866");
  assert.ok(c);
  // A county sits under `state:nj/` and must never be swept up as statewide.
  assert.equal(
    c.certaintyOf("ocd-division/country:us/state:nj/county:morris/place:rockaway_borough"),
    "AMBIGUOUS",
  );
  assert.notEqual(c.certaintyOf("ocd-division/country:us/state:nj/sldl:25"), "CERTAIN");
});

/* ========================================================================== */
/* 5. The INVITATION half survives every viewport                             */
/* ========================================================================== */

test("RULING 71: the action half of the pill is never hidden by a media query", () => {
  /*
   * Found by reading a 430×932 production capture as an image (RULING 2). The
   * DOM reported the full sentence and the PICTURE showed only "Could govern
   * you", because a `max-width: 460px` rule dropped `.could-govern-action`.
   *
   * That is not a cosmetic trim. Stripping the invitation leaves a bare
   * uncertainty marker beside a body's name, which is far closer to the
   * per-card completeness statement RULING 44 deleted than to the offer
   * RULING 71 specifies — the words "add your address to confirm" are the
   * whole reason this pill is a fact about the reader and not about our data.
   * It may wrap. It may not vanish.
   */
  const css = codeOf("app", "globals.css");
  assert.doesNotMatch(
    css,
    /\.could-govern-action[^{}]*\{[^{}]*display\s*:\s*none/i,
    "the invitation may never be hidden — a bare 'Could govern you' reads as a completeness marker",
  );
  assert.doesNotMatch(
    css,
    /\.could-govern-action[^{}]*\{[^{}]*(visibility\s*:\s*hidden|font-size\s*:\s*0)/i,
    "nor by any other way of removing it",
  );
  assert.match(css, /\.could-govern-pill\s*\{/, "the pill's own rule is still here");
});


/* ========================================================================== */
/* 6. The card whose heading IS the question                                  */
/* ========================================================================== */

test("3.3: the who-governs card carries the pill, per body", () => {
  /*
   * The map card is headed "Who governs here". Widening it to the zip's area
   * made Rockaway Borough appear beside Rockaway Township — and on its own that
   * trades one wrong answer for a longer one: eight bodies listed identically,
   * when two govern everyone at 07866 and six govern some readers and not
   * others. The pill is what tells them apart.
   *
   * WGH-1 (2026-08-22): the SENTENCE moved off the rows and is said once,
   * between the Local listing and the State listing; the rows carry an
   * asterisk. What this guard defends is unchanged and is the part that
   * matters — the marking is still PER BODY, from the body's own flag, never
   * per card and never per page — so it checks the mark and the single notice
   * rather than the retired per-row pill.
   */
  const card = codeOf("components", "map", "coverage-notice.tsx");
  assert.match(card, /CouldGovernMark/, "the card marks the affected rows");
  assert.match(
    card,
    /body\.couldGovern\s*&&/,
    "per BODY, from the body's own flag — never per card and never per page",
  );
  assert.match(card, /<CouldGovernNotice/, "and the sentence is said ONCE, between Local and State");
  assert.equal(
    (card.match(/<CouldGovernNotice/g) ?? []).length,
    1,
    "once means once — a second notice is the repetition this replaced",
  );
});

test("3.3: couldGovern is only set on a TYPED zip, never on a panned viewport", () => {
  const route = codeOf("app", "api", "meetings", "route.ts");
  assert.match(
    route,
    /coverage\s*&&\s*zipRead\.value/,
    "a reader who panned has named no place, so there is no zip for a body to be partial about",
  );
});

test("3.1: the class sweep — both zip-resolving surfaces widen to the AREA", () => {
  /*
   * NJ01 fixed one and left the other. Two instances found, two fixed. This is
   * the guard that stops a third surface being added on the point-only
   * behaviour without anybody noticing.
   */
  const ballot = codeOf("app", "ballot", "page.tsx");
  const meetings = codeOf("app", "api", "meetings", "route.ts");
  for (const [name, src] of [["ballot page", ballot], ["meetings route", meetings]] as const) {
    assert.match(
      src,
      /divisionIdsForZipArea\(/,
      `${name} must resolve a zip as an AREA — a ZCTA centroid is one point and may never resolve who governs a reader`,
    );
  }
});

test("3.1: the widening can only ADD divisions, never remove them", () => {
  const route = codeOf("app", "api", "meetings", "route.ts");
  assert.match(
    route,
    /widened\.length\s*>=\s*resolvedDivisions\.length/,
    "a resolver change that could shrink the set is how a full surface goes quietly empty",
  );
});

/* ========================================================================== */
/* 7. A widened division brings its GOVERNMENTS, not its committee room      */
/* ========================================================================== */

test("3.1: a body arriving only through the widening must be GOVERNING", () => {
  /*
   * Caught by `pnpm walk:all` before it reached a reader, as a NAMED
   * REGRESSION (M135, shipped by g15) rather than as a coverage number nobody
   * was reading.
   *
   * The widening is right about DIVISIONS and was catastrophically wrong about
   * BODIES. 85641 is Vail; the City of Tucson's territory clips that ZCTA; and
   * Tucson carries 59 curated boards and commissions. The coverage payload at
   * 85641 went from 2 bodies to 61 — a Vail reader handed Tucson's Design
   * Review Board and its Outdoor Lighting Code Committee, every one wearing a
   * 'Could govern you' pill. That is worse than the defect it was fixing.
   *
   * Rockaway Borough was missing a COUNCIL and a SCHOOL BOARD. Those are
   * governments of a municipality a reader may actually live in. An advisory
   * committee is not, and the card's own code already says so.
   */
  const route = codeOf("app", "api", "meetings", "route.ts");
  assert.match(
    route,
    /pointOwnDivisionIds\.has\(body\.ocdId\)\s*\|\|\s*body\.bodyClass === "GOVERNING"/,
    "a body on a widened-in division must be GOVERNING; a body on the point's own division is untouched",
  );
});

test("3.1: filtering the body list recomputes the counts it invalidates", () => {
  /*
   * Stated N equals rendered rows. `counts.total` counts every body and goes
   * stale the moment the filter removes one — a number produced by one list
   * standing in front of a different list, in the payload rather than in the
   * component.
   */
  const route = codeOf("app", "api", "meetings", "route.ts");
  assert.match(route, /total: kept\.length/, "total is recounted off the kept array");
  assert.match(route, /governing: \{/, "and so is the governing pair the lead sentence reads");
});

test("3.1: the wired-status set is imported, never a second hand-typed copy", () => {
  /*
   * The first draft hand-wrote ["WIRED", "PARTIAL"]. The real set is
   * ["LIVE", "MANUAL"] — two invented statuses matching nothing, which would
   * have reported every body as having no source while the array underneath
   * was unchanged. A second copy of a closed enum is a second thing that can
   * be wrong about it.
   */
  const route = codeOf("app", "api", "meetings", "route.ts");
  assert.match(route, /import \{ WIRED_STATUSES \} from/, "imported from lib/registry/coverage");
  assert.doesNotMatch(route, /\["WIRED", "PARTIAL"\]/, "and not retyped");
});
