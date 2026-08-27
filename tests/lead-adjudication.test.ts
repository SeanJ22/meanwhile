/**
 * THE LEAD LIFECYCLE IS THE SPEC.
 * (2026-08-26, the descent-resume session. **RULING 183**.)
 *
 * These tests exist because the state machine they cover was declared,
 * validated and reported on for a whole session before anything performed a
 * single transition. `CandidateState` had `ENTITY_VERIFIED` and
 * `BODY_PROMOTED`; `workstream.ts` checked their invariants; three workstreams
 * printed `0 promoted body/bodies` as the coverage numerator — and no code
 * path anywhere could raise it.
 *
 * A type that nothing writes is a type nothing tests. So the transitions get
 * tests, and the detector calibration gets tests with the REAL strings that
 * defeated it, because every one of those was found by opening the output
 * rather than reading the count.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { readsAsBodyName } from "../lib/hunt/entity-name.ts";
import { triageLead } from "../lib/hunt/lead-triage.ts";
import {
  classifyCandidate,
  promoteCandidate,
  recordCandidate,
  unclassified,
  verifyCandidate,
} from "../lib/workstate/candidates.ts";
import { candidateId } from "../lib/workstate/frontier.ts";
import { accountCandidates } from "../lib/workstate/types.ts";
import type { Workstream } from "../lib/workstate/workstream.ts";

function blank(): Workstream {
  return {
    id: "descent:zz",
    title: "test",
    openedOn: "2026-08-26",
    universe: { authority: "test", version: "v1", members: [] },
    items: [],
    edges: [],
    candidates: [],
    permissions: [],
    cursor: "test",
    convergence: null,
    unmaterialized: [],
    routesInherited: [],
    routesLearned: [],
    methodVersion: 0,
  } as unknown as Workstream;
}

const lead = {
  state: "zz",
  tier: "state",
  url: "https://example.gov/board",
  text: "Board of Elections",
  fromEdge: "edge-1",
  discoveredOn: "2026-08-26",
};

/** ------------------------------------------------------------ the motions */

test("a recorded lead is a lead, and raises coverage by nothing", () => {
  const w = blank();
  const { isNew } = recordCandidate(w, lead);
  assert.equal(isNew, true);
  assert.equal(w.candidates[0].state, "ENTITY_CANDIDATE");
  assert.equal(accountCandidates(w.candidates).coverageNumerator, 0);
});

test("recording the same lead twice does not inflate the denominator", () => {
  const w = blank();
  recordCandidate(w, lead);
  const second = recordCandidate(w, lead);
  assert.equal(second.isNew, false);
  assert.equal(w.candidates.length, 1);
});

test("a re-record does not reset a classification already earned", () => {
  const w = blank();
  const { id } = recordCandidate(w, lead);
  classifyCandidate(w, id, "DUPLICATE", "already held");
  recordCandidate(w, lead);
  assert.equal(w.candidates[0].state, "DUPLICATE");
});

test("candidateId matches the id the migration minted, so a live walk re-finds rather than re-creates", () => {
  /* The migration hashed (state, url, text) and not the tier. If this drifts,
   * every migrated lead is re-recorded as new the first time a walk sees it
   * again — 1,672 duplicate rows, and every classification silently reset. */
  assert.equal(
    candidateId("nj", "state", "https://x.gov/a", "b"),
    candidateId("nj", "county", "https://x.gov/a", "b"),
  );
});

test("a body may not be promoted straight from a lead", () => {
  const w = blank();
  const { id } = recordCandidate(w, lead);
  assert.throws(() => promoteCandidate(w, id, "body-1"), /never straight from a lead/);
});

test("a promotion without a registry id is refused — that is a lead with a better label", () => {
  const w = blank();
  const { id } = recordCandidate(w, lead);
  verifyCandidate(w, id, "fetched it; the page names itself Board of Elections");
  assert.throws(() => promoteCandidate(w, id, "  "), /not a body/);
});

test("verification without evidence is refused", () => {
  const w = blank();
  const { id } = recordCandidate(w, lead);
  assert.throws(() => verifyCandidate(w, id, ""), /claims carry sources/);
});

test("an unexplained classification is refused", () => {
  const w = blank();
  const { id } = recordCandidate(w, lead);
  assert.throws(() => classifyCandidate(w, id, "DUPLICATE", ""), /not a verdict/);
});

test("promotion is the only motion that raises the coverage numerator", () => {
  const w = blank();
  const { id } = recordCandidate(w, lead);
  verifyCandidate(w, id, "fetched; page names itself Board of Elections");
  assert.equal(accountCandidates(w.candidates).coverageNumerator, 0, "verified is not promoted");
  promoteCandidate(w, id, "wtp-body/country:us/state:zz/board_elections#governing");
  assert.equal(accountCandidates(w.candidates).coverageNumerator, 1);
});

test("a rejection keeps the row, its url and its reason — a zero-yield route is knowledge", () => {
  const w = blank();
  const { id } = recordCandidate(w, lead);
  classifyCandidate(w, id, "REJECTED_FALSE_POSITIVE", "published by an association");
  assert.equal(w.candidates.length, 1);
  assert.equal(w.candidates[0].url, lead.url);
  assert.match(w.candidates[0].rejectedReason ?? "", /association/);
});

test("one verdict lands on every row naming the same entity", () => {
  /* Canonical state holds a row per SIGHTING and the id excludes the tier, so
   * the New Jersey Legislature is two rows. They may not disagree about what
   * the entity is. */
  const w = blank();
  recordCandidate(w, lead);
  recordCandidate(w, { ...lead, tier: "county" });
  assert.equal(w.candidates.length, 1, "same id, so one row — the tier is not part of identity");

  const w2 = blank();
  recordCandidate(w2, lead);
  w2.candidates.push({ ...w2.candidates[0], tier: "county" });
  const { id } = recordCandidate(w2, lead);
  verifyCandidate(w2, id, "fetched; page names itself Board of Elections");
  promoteCandidate(w2, id, "body-1");
  assert.deepEqual(
    w2.candidates.map((c) => c.state),
    ["BODY_PROMOTED", "BODY_PROMOTED"],
  );
});

test("unclassified counts leads AND the ones the method could not read", () => {
  const w = blank();
  const { id } = recordCandidate(w, lead);
  assert.equal(unclassified(w).length, 1);
  classifyCandidate(w, id, "NEEDS_CLASSIFICATION", "the name test could not read it");
  assert.equal(unclassified(w).length, 1, "NEEDS_CLASSIFICATION is still owed work");
  classifyCandidate(w, id, "DUPLICATE", "already held");
  assert.equal(unclassified(w).length, 0);
});

/** --------------------------------------------------- triage, on real leads */

test("an association's own material is not a unit of government", () => {
  for (const url of [
    "https://www.njsba.org/wp-content/uploads/2019/01/13-things.pdf",
    "https://www.njlm.org/1479/Municipal-Operations-Licensing",
    "https://www.nhmunicipal.org/advertising-opportunities/municipal-marketplace",
    "https://www.azleague.org/86/Executive-Committee",
  ]) {
    const v = triageLead({ text: "board of something", url });
    assert.equal(v.keep, false, url);
    assert.equal(v.rule, "not-a-government-publisher");
  }
});

test("a municipality found ON an association's directory still survives", () => {
  /* njlm.org is where 208 New Jersey municipalities' own sites were found. The
   * rule is about the TARGET's publisher, never where the link was seen. */
  const v = triageLead({ text: "aberdeen township", url: "http://www.aberdeennj.org/" });
  assert.equal(v.keep, true);
});

test("a partisan caucus office is not a body of government", () => {
  const v = triageLead({ text: "assembly democratic office", url: "https://www.assemblydems.com/" });
  assert.equal(v.keep, false);
});

test("triage rejects notices, assets and case records, each with its own reason", () => {
  const cases: [string, string, string][] = [
    ["agency hours monday - friday: 8 a.m. – 4:30 p.m.", "https://www.nj.gov/mvc/x.html", "prose-not-entity"],
    ["agency closures & delays", "https://www.nj.gov/mvc/locations/closing.htm", "prose-not-entity"],
    ["thank you school board members image", "https://x.gov/a/b.png", "asset-not-page"],
    ["borough of seaside park v. shree jyoti", "https://www.njcourts.gov/system/files/court-opinions/2026/a.pdf", "court-opinion"],
    ["federal funding dashboard", "https://app.powerbi.com/view?r=abc", "not-a-document-host"],
    ["departments", "https://www.morriscountynj.gov/Government/Departments", "navigation-label"],
  ];
  for (const [text, url, rule] of cases) {
    const v = triageLead({ text, url });
    assert.equal(v.keep, false, `${text} should not be kept`);
    assert.equal(v.rule, rule, text);
  }
});

test("a menu label is rejected whole, never as a substring of a real name", () => {
  assert.equal(triageLead({ text: "departments", url: "https://x.gov/d" }).keep, false);
  assert.equal(
    triageLead({ text: "department of environmental protection", url: "https://x.gov/dep" }).keep,
    true,
    "a substring rule here would lose every department in the country",
  );
});

/** ------------------------------------------- the name, on the real strings */

test("a body word is necessary and nowhere near sufficient", () => {
  for (const s of [
    "assembly seating chart",
    "change a court order",
    "civil ecourts access",
    "artificial intelligence - use in the courts",
    "assembly committees",
    "superior court locations",
    "rules of court",
    "represent yourself in court",
    "copies of court records",
    "expunging your court record",
    "burlington county affordable housing documents",
    "county offices of education",
    "school and district leaders",
    "county coordinators",
    "court rule 1:38-3(16)",
  ]) {
    assert.equal(readsAsBodyName(s).isBody, false, `"${s}" is not a body`);
  }
});

test("the bodies these rules must never reject", () => {
  /* Four of these were rejected by an earlier version of the stop list, and one
   * of them runs the ballot this product exists to show. */
  for (const s of [
    "Board of Elections",
    "Morris County Board of Elections",
    "Department of Human Services",
    "Division of Revenue and Enterprise Services",
    "Board of County Commissioners",
    "Board of Selectmen",
    "Vail Unified School District",
    "Town of Newbury",
    "State Board of Education",
    "Supreme Court Committee on Access and Fairness",
  ]) {
    assert.equal(readsAsBodyName(s).isBody, true, `"${s}" IS a body`);
  }
});

test("a hyphenated word is not an acronym gloss", () => {
  /* `\s*[-]\s*` ate the hyphen inside "Self-Help" and promoted the body
   * "Municipal Court Self". The spaces around a gloss are mandatory. */
  assert.equal(readsAsBodyName("Municipal Court Self-Help").isBody, false);
  assert.equal(readsAsBodyName("nj motor vehicle commission - njmvc").name, "nj motor vehicle commission");
});

test("page furniture comes off the front of the recorded name", () => {
  assert.equal(readsAsBodyName("About the Supreme Court").name, "Supreme Court");
});

test("a plural organ anywhere means the page is a directory of bodies", () => {
  const v = readsAsBodyName("County Offices of Education");
  assert.equal(v.isBody, false);
  assert.match(v.basis, /SET of bodies/);
});
