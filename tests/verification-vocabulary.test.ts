import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { candidateOwnKind, provenanceKind, verificationOf } from "../lib/officials/verification.ts";

/**
 * The sources vocabulary — g3 item 5 (2026-08-16).
 *
 * Katie Hobbs' Sources tab said "Read from azgovernor.gov · Collected
 * 2026-08-14 · **Verified: not yet**". The third row contradicted the first
 * two: the fact came off the Governor of Arizona's own office's site, on a
 * stated date, with the link on screen. **A read from the subject's own
 * official source IS the verification.** "Not yet" is reserved for provenance
 * where a second rung is genuinely owed.
 */

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
  // kearsarge.org is a public school district publishing its own board's
  // sittings on its own site — a SCHEDULEPAGE row, which the adapter defines
  // as "no portal in the path". Derived from the wiring, not hand-listed.
  assert.equal(provenanceKind({ sourceUrl: "https://kearsarge.org", kind: "OFFICIAL" }), "OFFICIAL");
  assert.equal(provenanceKind({ sourceUrl: "https://newbury.nh.gov" }), "OFFICIAL");
});

test("the Hobbs row: an official read renders as verified, by its source, on the read date", () => {
  const v = verificationOf({
    sourceUrl: "https://azgovernor.gov/office-arizona-governor",
    collectedAt: "2026-08-14T19:02:00.000Z",
    verifiedAt: null,
  });
  assert.equal(v.kind, "official");
  assert.equal(v.kind === "official" && v.date, "2026-08-14");
  assert.equal(v.kind === "official" && v.by, "azgovernor.gov");
});

test("a human confirmation still wins, and keeps its own date", () => {
  const v = verificationOf({
    sourceUrl: "https://azgovernor.gov/",
    collectedAt: "2026-08-14T19:02:00.000Z",
    verifiedAt: "2026-08-15T00:00:00.000Z",
  });
  assert.equal(v.kind, "confirmed");
  assert.equal(v.kind === "confirmed" && v.date, "2026-08-15");
});

test("'not yet' survives where it belongs, and is never filled in with a guess", () => {
  assert.equal(
    verificationOf({
      sourceUrl: "https://ballotpedia.org/Katie_Hobbs",
      collectedAt: "2026-08-14T19:02:00.000Z",
      verifiedAt: null,
    }).kind,
    "unverified",
    "a third-party aggregator was blessed as an official read",
  );
  assert.equal(
    verificationOf({ sourceUrl: null, collectedAt: "2026-08-14", verifiedAt: null }).kind,
    "unverified",
    "a row with no source at all claimed a verification",
  );
  // The render-default rule: an official host with no read date may not have
  // a plausible date supplied for it.
  assert.equal(
    verificationOf({
      sourceUrl: "https://azgovernor.gov/",
      collectedAt: null,
      verifiedAt: null,
    }).kind,
    "unverified",
    "a missing read date was filled in",
  );
});

/**
 * The audit half of the ruling: "no official-source read may say 'not yet'
 * ANYWHERE". A second surface growing its own copy of the old sentence is
 * exactly how the first one survived unnoticed, so the string is pinned to
 * the one component allowed to render it.
 */
test("only the sources list renders the not-yet sentence", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx$/.test(entry)) {
        const source = readFileSync(path, "utf8");
        if (/not yet</.test(source) || /NoValue>not yet/.test(source)) {
          offenders.push(path.replace(/\\/g, "/"));
        }
      }
    }
  };
  walk("components");
  walk("app");

  assert.deepEqual(
    offenders,
    ["components/officials/card-sources-list.tsx"],
    "a surface other than the sources list is rendering 'not yet' — route it " +
      "through verificationOf() so an official read is never called unverified",
  );
});


test("CP-04: the saved official kind verifies a government-linked vendor portal", () => {
  assert.deepEqual(verificationOf({ kind: "OFFICIAL", sourceUrl: "https://council.legistar.com/calendar", collectedAt: "2026-10-05", verifiedAt: null }),
    { kind: "official", date: "2026-10-05", by: "council.legistar.com" });
  assert.equal(provenanceKind({ kind: "CAMPAIGN", sourceUrl: "https://candidate.example" }), "CAMPAIGN");
});

test("CP-04 (failed live Oct 6): a candidate's own words and campaign links read Campaign, not Other", () => {
  // 85701 on release 8: 14 "Other · Biography in the candidate's own words", 19 "Other · Campaign contacts and website".
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
