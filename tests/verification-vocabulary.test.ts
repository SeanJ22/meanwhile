import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { candidateOwnKind, provenanceKind } from "../lib/officials/verification.ts";

const OFFICIAL = [
  "azgovernor.gov",
  "www.congress.gov",
  "clerk.house.gov",
  "sos.nh.gov",
];

const NOT_OFFICIAL = [
  "warner.nh.us", "ci.tucson.az.us",
  "ballotpedia.org",
  "facebook.com",
  "x.com",
  "www.nytimes.com",
  "go.boarddocs.com", // a VENDOR portal — the body's records, a third party's site
];

test("an official host is recognized, and a third party is not", () => {
  for (const host of OFFICIAL) {
    assert.ok(
      provenanceKind({ sourceUrl: `https://${host}` }) === "OFFICIAL",
      `${host} should be an official publisher`,
    );
  }
  for (const host of NOT_OFFICIAL) {
    assert.ok(provenanceKind({ sourceUrl: `https://${host}` }) !== "OFFICIAL", `${host} must not be treated as official`);
  }
});

test("a body's own page is official even off a .gov, because the wiring types it so", () => {
  // A SCHEDULEPAGE row is the body's own site by definition.
  assert.equal(provenanceKind({ sourceUrl: "https://kearsarge.org", kind: "OFFICIAL" }), "OFFICIAL");
  assert.equal(provenanceKind({ sourceUrl: "https://newbury.nh.gov" }), "OFFICIAL");
});

test("the saved source kind preserves a government-linked vendor portal", () => {
  assert.equal(provenanceKind({ kind: "OFFICIAL", sourceUrl: "https://council.legistar.com/calendar" }), "OFFICIAL");
  assert.equal(provenanceKind({ kind: "CAMPAIGN", sourceUrl: "https://candidate.example" }), "CAMPAIGN");
});

test("CP-04 (failed live Oct 6): a candidate's own words and campaign links read Campaign, not Other", () => {
  assert.equal(candidateOwnKind("https://www.kellyfornh.com/about"), "CAMPAIGN");
  assert.equal(candidateOwnKind("https://azleg.gov/members/hernandez"), "OFFICIAL", "an official page keeps Official");
  assert.equal(candidateOwnKind("https://ballotpedia.org/Kelly_Ayotte"), "REFERENCE", "a known publisher keeps its kind");
  assert.equal(candidateOwnKind(null), "OTHER", "no page, no claim about it");
  for (const file of ["components/ballot/candidate-card.tsx", "components/ballot/candidate-contact.tsx"]) {
    const src = readFileSync(file, "utf8");
    const rows = [...src.matchAll(/what: "(Biography in the candidate's own words|Campaign contacts and website)", provenance: \{ ([^}]*)\}/g)];
    assert.ok(rows.length > 0, `${file} renders its candidate rows`);
    for (const [, what, body] of rows) assert.match(body, /^kind: candidateOwnKind\(/, `${file}: "${what}" states its kind`);
  }
});
