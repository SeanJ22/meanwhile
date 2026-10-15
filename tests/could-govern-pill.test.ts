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
import { POINT_GEOMETRY_PLANS, divisionIdsForZipArea } from "../lib/ballot/zip-divisions.ts";
import { buildCensusDistrictEdge } from "../lib/census-geography/district-edge.ts";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { codeOf } from "./read-code.ts";
import { contestsForDivisions } from "../lib/ballot/contests.ts";
import { azBallot, electionSelection } from "./helpers/ballot-district-fixtures.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const districtEdge = buildCensusDistrictEdge(JSON.parse(readFileSync(join(ROOT, "lib/census-geography/bootstrap-az.json"), "utf8")) as BuiltDataset, "pill-qualified-fixture");
const current = { purpose: "representation" as const, asOf: "2026-10-09" };
const withDistricts = <T>(read: () => T): T => withReaderAuthorityEdge({ censusDistricts: { value: districtEdge, versionId: districtEdge.versionId } }, read);

test("3.2: sampled county and school overlap cannot establish whole-ZIP certainty", async () => {
  const c = await zipCertainty("07866");
  assert.ok(c, "07866 is inside this repo's committed geometry");
  assert.equal(c.certaintyOf("ocd-division/country:us/state:nj/county:morris"), "AMBIGUOUS");
  assert.equal(
    c.certaintyOf(
      "ocd-division/country:us/state:nj/school_district:morris_hills_regional_school_district",
    ),
    "AMBIGUOUS",
    "the held sample does not establish whole-ZIP school service",
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

test("3.7: a qualified whole-area district needs no pill while sampled local divisions stay uncertain", async () => {
  const c = await withDistricts(() => zipCertainty("85635", current));
  assert.ok(c);
  assert.equal(c.certaintyOf("ocd-division/country:us/state:az/cd:6"), "CERTAIN");
  assert.equal(needsPill(c.certaintyOf("ocd-division/country:us/state:az/cd:6")), false);
  assert.equal(c.certaintyOf("ocd-division/country:us/state:az/place:sierra_vista"), "AMBIGUOUS");
});

test("3.8: a sample with no observed crossing still leaves local boundaries uncertain", async () => {
  const c = await zipCertainty("85701");
  assert.ok(c);
  assert.ok(c.partial.length > 0, "a finite sample cannot certify every address in 85701");
  assert.ok(c.partial.every(id => needsPill(c.certaintyOf(id))));
  assert.equal(c.certaintyOf("ocd-division/country:us/state:az"), "CERTAIN");
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
    readFileSync(join(ROOT, "data", "derived", "zip-divisions", "index.json"), "utf8"),
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

const ABSENCE_POLARITY =
  /\b(haven'?t|hasn'?t|no|nothing|none|missing|few|little|thin|sparse|empty|still|not yet|yet)\b/i;
const COVERAGE_OBJECT =
  /\b(collected|found|information|detail|details|data|record|records|published|research|words|profile|material|source|sources)\b/i;
const OUR_SUBJECT = /\b(we|our|us|this candidate|this card|so far)\b/i;

test("the pill makes no claim about OUR data", () => {
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

test("the pill's subject is the reader's location, and it says so", () => {
  const sentence = COULD_GOVERN_SENTENCE;
  assert.equal(sentence, `${COULD_GOVERN_TEXT} — ${COULD_GOVERN_ACTION}`);
  assert.match(sentence, /\byou\b/i, "it addresses the reader");
  assert.match(sentence, /\baddress\b/i, "it names the thing only the reader can supply");
  assert.match(sentence, /\bgovern/i, "the verb is govern");
});

test("the pill attaches to a BODY, never to a candidate", () => {

  const page = codeOf("app", "ballot", "page.tsx");
  assert.match(page, /<JurisdictionMark \/>/, "the body-level mark is not rendered by the ballot page");
  assert.match(page, /<JurisdictionNote/, "the page-level block is not rendered by the ballot page");

  const card = codeOf("components", "ballot", "candidate-card.tsx");
  assert.doesNotMatch(
    card,
    /CouldGovernPill|could-govern|JurisdictionMark|JurisdictionNote/,
    "the annotation may never reach a candidate card",
  );
});

test("the pill never gates — the page renders every contest regardless", () => {
  const page = codeOf("app", "ballot", "page.tsx");
  // `needsPill` may only decide a marker. If it ever decided a filter, a contest would vanish because of where a
  // reader might live.
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

test("the session store keeps the OUTCOME, never the address", () => {
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

test("nothing about the address reaches the server or a store", () => {
  const mod = codeOf("lib", "geo", "session-address.ts");
  assert.doesNotMatch(
    mod,
    /\bfetch\(|logEvent|insert\(|db\./,
    "the session address module makes no request and writes no row — it is browser-local, entirely",
  );
});

test("an address scope stays inside its ZIP and selected election date", async () => {
  let saved: string | null = null;
  const previous = Reflect.get(globalThis, "window");
  Reflect.set(globalThis, "window", { sessionStorage: {
    getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; },
  } });
  try {
    const { writeSessionAddress, sessionAddressFor } = await import("../lib/geo/session-address.ts");
    const scope = { zip: "85641", contestIds: [], divisionIds: ["ocd-division/country:us/state:az/sldl:17"],
      splitLevels: [], streetLabel: "South Bear Table Tank Drive" };
    writeSessionAddress({ ...scope, selection: current });
    assert.ok(sessionAddressFor("85641", current));
    assert.equal(sessionAddressFor("85701", current), null);
    const election = { purpose: "election" as const, asOf: "2026-10-13", electionDate: "2026-11-03" };
    writeSessionAddress({ ...scope, selection: election });
    assert.equal(sessionAddressFor("85641", current), null);
    assert.ok(sessionAddressFor("85641", election));
    assert.equal(sessionAddressFor("85641", { ...election, electionDate: "2026-05-19" }), null);
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "window");
    else Reflect.set(globalThis, "window", previous);
  }
});

test("the narrowing surface reads the session before it prompts", () => {
  /* There is one address form across surfaces, and the session read lives in it. */
  const narrowing = codeOf("components", "address", "address-prompt.tsx");
  assert.match(narrowing, /sessionAddressFor\(zip,\s*selection\)/, "it reads the session for this ZIP and selection");
  assert.match(narrowing, /writeSessionAddress\(/, "and it records its own answer for the others");
  assert.match(
    narrowing,
    /clearSessionAddress\(\)/,
    "undo forgets it everywhere, not only here — a reader asking for the whole zip back is asking us to forget",
  );
});

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

test("the action half of the pill is never hidden by a media query", () => {

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

test("3.3: the who-governs card carries the pill, per body", () => {

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
  /* Guards against a third surface being added on point-only behaviour. */
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

test("3.1: the held election plans widen 85641 to both legislative districts and preserve independent local facts", async () => {
  const local = "ocd-division/country:us/state:az/place:vail";
  const stale = "ocd-division/country:us/state:az/cd:7";
  const point = [local, stale, "ocd-division/country:us/state:az"];
  const serving = await withDistricts(() => divisionIdsForZipArea("85641", point, current, POINT_GEOMETRY_PLANS));
  assert.ok(serving.includes(local));
  assert.ok(serving.includes("ocd-division/country:us/state:az/cd:6"));
  assert.ok(!serving.includes(stale), "the previous point assignment does not survive a qualified replacement");
  const election = await withDistricts(() => divisionIdsForZipArea("85641", point, electionSelection, POINT_GEOMETRY_PLANS));
  assert.ok(election.includes(local));
  const districtContests = contestsForDivisions(azBallot, election).contests.filter(contest => /\/(?:cd|sldu|sldl):/.test(contest.ocdId));
  assert.deepEqual(districtContests.map(contest => contest.id.split(":").at(-1)).sort(), ["state-house-17", "state-house-19", "state-senate-17", "state-senate-19", "us-house-6"]);
  const certainty = await withDistricts(() => zipCertainty("85641", electionSelection));
  assert.ok(certainty);
  assert.equal(certainty.certaintyOf("ocd-division/country:us/state:az/cd:6"), "CERTAIN");
  for (const family of ["sldu", "sldl"]) for (const district of [17, 19]) {
    const id = `ocd-division/country:us/state:az/${family}:${district}`;
    assert.equal(certainty.certaintyOf(id), "AMBIGUOUS", `${id} covers part of the ZIP`);
    assert.ok(needsPill(certainty.certaintyOf(id)));
  }
});

test("3.1: a body arriving only through the widening must be GOVERNING", () => {

  const route = codeOf("app", "api", "meetings", "route.ts");
  assert.match(
    route,
    /pointOwnDivisionIds\.has\(body\.ocdId\)\s*\|\|\s*body\.bodyClass === "GOVERNING"/,
    "a body on a widened-in division must be GOVERNING; a body on the point's own division is untouched",
  );
});

test("3.1: filtering the body list recomputes the counts it invalidates", () => {
  /* Stated N equals rendered rows: `counts.total` goes stale the moment the filter removes a body. */
  const route = codeOf("app", "api", "meetings", "route.ts");
  assert.match(route, /total: kept\.length/, "total is recounted off the kept array");
  assert.match(route, /governing: \{/, "and so is the governing pair the lead sentence reads");
});

test("3.1: the wired-status set is imported, never a second hand-typed copy", () => {
  /* The real status set, not a hand-written copy of a closed enum. */
  const route = codeOf("app", "api", "meetings", "route.ts");
  assert.match(route, /import \{ WIRED_STATUSES \} from/, "imported from lib/registry/coverage");
  assert.doesNotMatch(route, /\["WIRED", "PARTIAL"\]/, "and not retyped");
});
