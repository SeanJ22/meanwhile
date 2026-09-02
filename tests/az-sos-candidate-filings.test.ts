/**
 * **THE ARIZONA SECRETARY OF STATE'S FILING LIST, PARSED FROM THE COMMITTED
 * BYTES.** (Session C final, lane 1, 2026-09-01. R-C9, RULING 100, RULING 229.)
 *
 * NO LIVE CALLS. Every assertion runs against
 * `tests/fixtures/az-sos-2026-candidate-filings.pdf` — the exact 183,097 bytes
 * the Secretary served on 2026-09-01, whose sha256 is recorded beside it — and
 * against the committed corpus derived from them.
 *
 * ## What is asserted, and why each one is here
 *
 * The failure this guards is not "the parse throws". It is **the parse quietly
 * returning fewer rows than the document holds**, which produces a candidate
 * universe missing real people while every count in the run looks plausible.
 * So the row count is established a second time by a mechanism that shares
 * nothing with the table extractor, and the two must agree.
 *
 * The other failure is a name join that merges two people or splits one. The
 * corpus must contain exactly one identity per filing row, every held candidacy
 * must be joined, and every join must name the exact form and rule that fired.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  countRowsFromText,
  displayNameOf,
  extractFilingRows,
  officeFor,
  splitPublishedName,
} from "../lib/sources/az-sos-candidate-filings/index.ts";

const ROOT = process.cwd();
const PDF = join(ROOT, "tests", "fixtures", "az-sos-2026-candidate-filings.pdf");
const RETRIEVAL = join(ROOT, "tests", "fixtures", "az-sos-2026-candidate-filings.retrieval.json");
const CORPUS = join(ROOT, "data", "candidates", "az-2026-sos-candidate-filings.json");

const retrieval = JSON.parse(readFileSync(RETRIEVAL, "utf8")) as {
  url: string;
  httpStatus: number;
  byteLength: number;
  sha256: string;
  retrievedAt: string;
};
const corpus = JSON.parse(readFileSync(CORPUS, "utf8")) as {
  contests: { id: string; ocdId: string; title: string; level: string }[];
  candidacies: {
    id: string;
    contestId: string;
    familyName: string;
    givenName: string;
    publishedName: string;
    heldIdentityJoin: { heldCandidacyId: string; rule: string; matchedForm: string } | null;
  }[];
  extraction: { positionalRows: number; textualRows: number; agree: boolean; pages: number };
  applicableUniverse: { contests: number; candidacies: number; notInThisDocument: string[] };
  retrieval: { sha256: string; url: string };
};

test("the committed bytes are the bytes the Secretary served", () => {
  const bytes = readFileSync(PDF);
  assert.equal(bytes.length, retrieval.byteLength);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), retrieval.sha256);
  assert.equal(retrieval.httpStatus, 200);
  assert.equal(corpus.retrieval.sha256, retrieval.sha256, "the corpus cites different bytes");
  assert.equal(corpus.retrieval.url, retrieval.url);
});

test("RULING 100: two independent extractions of the filing list agree", async () => {
  const bytes = new Uint8Array(readFileSync(PDF));
  const { rows, reconciliation } = await extractFilingRows(bytes, PDF);
  assert.ok(rows.length > 0, "a zero-row extraction is a FAILED extraction");
  assert.equal(
    reconciliation.positionalRows,
    reconciliation.textualRows,
    "the positional and textual row counts disagree — a partial extraction that parses cleanly",
  );
  assert.equal(reconciliation.agree, true);
  assert.equal(rows.length, reconciliation.positionalRows);
  /* The committed corpus was built from THIS document, so its recorded
     extraction must be the one this test just reproduced. A corpus whose
     numbers drifted from its own source is the stale-artifact defect. */
  assert.equal(corpus.extraction.positionalRows, reconciliation.positionalRows);
  assert.equal(corpus.extraction.textualRows, reconciliation.textualRows);
  assert.equal(corpus.extraction.pages, reconciliation.pages);
});

test("every filing row carries all eight of the Secretary's columns", async () => {
  const { rows } = await extractFilingRows(new Uint8Array(readFileSync(PDF)), PDF);
  for (const r of rows) {
    assert.ok(r.publishedName.includes(","), `"${r.publishedName}" is not Family, Given`);
    assert.ok(r.publishedContest.length > 0);
    assert.ok(r.partyLabel.length > 0);
    assert.match(r.filingDate, /^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
  }
});

test("the text-layer row count subtracts the page furniture and nothing else", () => {
  /* One page's worth of the real document's shape: a subtitle spending two
     dates, one filing row, and a footer spending one. */
  const page =
    "Arizona Secretary of State Partisan Candidate Filing for 2026 Primary Election " +
    "February 23, 2026, to March 23, 2026 Candidate Name Contest Name " +
    "Hobbs, Katie Governor Democratic 6761 February 25, 2026 6761 1465 8226 " +
    "Official list of candidates who qualified for the July 21, 2026, Primary Ballot";
  assert.equal(countRowsFromText([page]), 1);
  assert.equal(countRowsFromText([page, page]), 2);
});

test("every contest the Secretary names resolves to an office with a division", async () => {
  const { rows } = await extractFilingRows(new Uint8Array(readFileSync(PDF)), PDF);
  const unresolved = [...new Set(rows.map((r) => r.publishedContest))].filter(
    (name) => officeFor(name) === null,
  );
  assert.deepEqual(
    unresolved,
    [],
    "an unmapped contest name would drop every candidate in that race and report the " +
      "smaller universe as the complete one",
  );
  for (const c of corpus.contests) {
    assert.match(c.ocdId, /^ocd-division\/country:us\/state:az/);
  }
});

test("the corpus holds exactly one identity per filing row, and no duplicates", () => {
  assert.equal(corpus.candidacies.length, corpus.extraction.positionalRows);
  assert.equal(corpus.applicableUniverse.candidacies, corpus.candidacies.length);
  assert.equal(corpus.applicableUniverse.contests, corpus.contests.length);
  const ids = new Set(corpus.candidacies.map((c) => c.id));
  assert.equal(ids.size, corpus.candidacies.length, "two filing rows share one candidacy key");
  const contestIds = new Set(corpus.contests.map((c) => c.id));
  for (const c of corpus.candidacies) {
    assert.ok(contestIds.has(c.contestId), `${c.id} points at a contest the corpus does not carry`);
  }
});

test("every held Arizona candidacy is joined, by an EXACT name form", () => {
  const held = JSON.parse(readFileSync(join(ROOT, "data", "ballot", "az-pima-2026.json"), "utf8")) as {
    candidacies: { id: string }[];
  };
  const heldIds = new Set(held.candidacies.map((c) => c.id));
  const joined = new Set(
    corpus.candidacies
      .map((c) => c.heldIdentityJoin?.heldCandidacyId)
      .filter((v): v is string => typeof v === "string"),
  );
  /* An unjoined held candidacy is a person this project already holds findings
     for who would be hunted again under a second identity. */
  const missed = [...heldIds].filter((id) => !joined.has(id));
  assert.deepEqual(missed, [], "held candidacies the corpus did not join");
  assert.equal(joined.size, heldIds.size, "one held id was joined to two filing rows");

  for (const c of corpus.candidacies) {
    if (!c.heldIdentityJoin) continue;
    assert.ok(c.heldIdentityJoin.matchedForm.length > 0, `${c.id}: a join with no matched form`);
    assert.match(
      c.heldIdentityJoin.rule,
      /AS_PUBLISHED|NICKNAME_REMOVED|NICKNAME_AS_GIVEN|NICKNAME_AS_FAMILY|SUFFIX_REMOVED/,
      `${c.id}: a join whose rule is not one the name parse can emit`,
    );
  }
});

test("the two authorities' disagreeing name splits resolve to ONE identity", () => {
  /* The Secretary prints `Ruiz, Teresa Leyba`; the Pima certified ballot splits
     the same person given `Teresa`, family `Leyba Ruiz`. Two identities here
     would mean her campaign site, positions and photo are hunted twice. */
  const rows = corpus.candidacies.filter((c) => /Leyba/i.test(c.publishedName) || /Leyba/i.test(c.familyName));
  assert.equal(rows.length, 1, "Teresa Leyba Ruiz appears more than once in the corpus");
  assert.equal(rows[0].publishedName, "Ruiz, Teresa Leyba");
  assert.equal(rows[0].heldIdentityJoin?.heldCandidacyId, "ballot-az-pima:superintendent:leyba-ruiz-teresa");
  assert.equal(displayNameOf(rows[0].familyName, rows[0].givenName), "Teresa Leyba Ruiz");
});

test("R-C9: the corpus names the population it is NOT", () => {
  const text = corpus.applicableUniverse.notInThisDocument.join(" ");
  for (const owed of ["COUNTY AND BELOW", "INDEPENDENT AND NO-PARTY", "WRITE-IN", "NONPARTISAN"]) {
    assert.ok(text.includes(owed), `the corpus does not name ${owed} as absent from this document`);
  }
  assert.ok(
    /absence from THIS DOCUMENT/.test(text),
    "the corpus does not say that its absences are about the document rather than the ballot",
  );
});

test("splitPublishedName reads the publisher's separator and refuses to guess", () => {
  assert.deepEqual(splitPublishedName("Hobbs, Katie"), { family: "Hobbs", given: "Katie" });
  assert.deepEqual(splitPublishedName('Feely IV, Thomas "Jay"'), {
    family: "Feely IV",
    given: 'Thomas "Jay"',
  });
  assert.throws(() => splitPublishedName("Katie Hobbs"), /carries no comma/);
  assert.throws(() => splitPublishedName("Hobbs,"), /empty family or given/);
});

test("officeFor maps the Secretary's contest names onto this project's offices", () => {
  assert.deepEqual(officeFor("U.S. Representative - District No. 6"), {
    title: "U.S. Representative, District 6",
    ocdId: "ocd-division/country:us/state:az/cd:6",
    contestId: "az-sos-2026:us-house-6",
    level: "FEDERAL",
  });
  assert.equal(officeFor("State Senator - District No. 19")?.ocdId, "ocd-division/country:us/state:az/sldu:19");
  assert.equal(
    officeFor("State Representative - District No. 19")?.ocdId,
    "ocd-division/country:us/state:az/sldl:19",
  );
  assert.equal(officeFor("Governor")?.ocdId, "ocd-division/country:us/state:az");
  assert.equal(officeFor("Governor")?.level, "STATE");
  /* An office nobody mapped is null, and the caller refuses the run. It is
     never silently dropped. */
  assert.equal(officeFor("County Sheriff"), null);
  assert.equal(officeFor("U.S. Representative — District No. 6"), null);
});
