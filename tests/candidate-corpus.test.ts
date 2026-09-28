import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  answerFor,
  answerSentence,
  type CandidateCorpus,
  type CandidateDocument,
} from "../lib/candidates/corpus.ts";
import { CANDIDATE_ISSUES } from "../lib/candidates/issues.ts";
import {
  getCandidateCorpus,
  positionsFor,
  positionsHeadline,
  positionsSummary,
} from "../lib/candidates/positions.ts";
import {
  installCandidateCorpusFirstSeed,
  installRegistryRuntimeFirstSeeds,
} from "./helpers/registry-runtime-first-seed.ts";

await Promise.all([
  installCandidateCorpusFirstSeed(),
  installRegistryRuntimeFirstSeeds(),
]);

const ROOT = process.cwd();

/**
 * D05 (the candidate statement corpus) and P02 (stated positions mapped per
 * issue), built 2026-08-19 (g20) to the design in
 * `docs/ballot-research-2026.md`.
 *
 * The doctrine: two corpora never merged; quote and link, never characterize;
 * three answers and conflating any two is the failure; every answer carries
 * its corpus scope; and no composite score, ever, at any remove.
 */

function doc(over: Partial<CandidateDocument> = {}): CandidateDocument {
  return {
    id: "k@h",
    candidateKey: "k",
    sourceClass: "CAMPAIGN_SITE",
    basis: "HUNTED_AND_VERIFIED",
    metaDescription: null,
    documentUrl: "https://example.org/",
    contentHash: "h",
    retrievedAt: "2026-08-19T00:00:00.000Z",
    contentType: "text/html",
    text: "We will build more homes and cut the cost of housing across the state.",
    extraction: "html",
    extractionNote: null,
    ...over,
  };
}

test("D05: the three answers are three, and none of them is a blank", () => {
  // "This candidate has said nothing about X" is itself a damaging claim
  // about a real person, and the shape refuses to let a reader arrive at it
  // by accident.

  // 1. Nothing collected — a fact about US.
  const none = answerFor([], ["housing"], "https://example.org");
  assert.equal(none.kind, "NOTHING_COLLECTED");
  assert.match(answerSentence(none, "housing"), /we haven’t collected|we haven't collected/i);
  assert.match(answerSentence(none, "housing"), /not a statement about them/i);

  // 2. Searched and nothing matched — a fact about THEIR pages, with the
  //    pages and dates named so the two cannot read alike.
  const empty = answerFor([doc()], ["veterans"], null);
  assert.equal(empty.kind, "SEARCHED_NOTHING_MATCHED");
  const emptySentence = answerSentence(empty, "veterans");
  assert.match(emptySentence, /We searched the one page we hold/);
  assert.match(emptySentence, /2026-08-19/);
  assert.match(emptySentence, /Nothing in them mentions veterans/);

  // 3. Matched — the passages, with the same scope stated.
  const hit = answerFor([doc()], ["cost of housing"], null);
  assert.equal(hit.kind, "MATCHED");
  assert.match(answerSentence(hit, "housing"), /1 passage mentions housing/);
});

test("D05: a held-but-unreadable page is not a search that came back empty", () => {
  // Our extraction failing must never become a claim about what a candidate
  // has said. A shell page is held, and the answer is NOTHING_COLLECTED.
  const answer = answerFor(
    [doc({ text: null, extraction: "failed", extractionNote: "a rendered shell" })],
    ["housing"],
    "https://example.org",
  );
  assert.equal(answer.kind, "NOTHING_COLLECTED");
});

test("D05: every answer that searched carries its own scope", () => {
  const answer = answerFor(
    [doc(), doc({ id: "k@h2", documentUrl: "https://example.org/issues", text: "nothing here" })],
    ["housing"],
    null,
  );
  assert.notEqual(answer.kind, "NOTHING_COLLECTED");
  if (answer.kind === "NOTHING_COLLECTED") return;
  assert.equal(answer.scope.documents.length, 2);
  for (const d of answer.scope.documents) {
    assert.ok(d.documentUrl);
    assert.match(d.retrievedAt, /^\d{4}-\d{2}-\d{2}/);
  }
});

test("source revisions preserve a removed passage as historical and never duplicate unchanged current text", () => {
  const old = doc({ id: "k@old", text: "We will build more homes.", retrievedAt: "2026-09-20T00:00:00.000Z",
    sourceRevision: { revisionId: "old", artifactId: "ar-old", canonicalUrl: "https://example.org/",
      rawContentHash: "raw-old", capturedAt: "2026-09-20T00:00:00.000Z", extractionVersion: 2, supersedesRevisionId: null },
    extractorVersion: 2 });
  const current = doc({ id: "k@new", text: "We will improve transit.", retrievedAt: "2026-09-21T00:00:00.000Z",
    sourceRevision: { revisionId: "new", artifactId: "ar-new", canonicalUrl: "https://example.org/",
      rawContentHash: "raw-new", capturedAt: "2026-09-21T00:00:00.000Z", extractionVersion: 2, supersedesRevisionId: "old" },
    extractorVersion: 2 });
  const historical = answerFor([old, current], ["homes"]);
  assert.equal(historical.kind, "MATCHED");
  if (historical.kind === "MATCHED") {
    assert.equal(historical.passages[0]?.revisionStatus, "HISTORICAL");
    assert.equal(old.text?.slice(historical.passages[0]!.textStart, historical.passages[0]!.textEnd), historical.passages[0]?.textQuote);
  }
  const repeated = answerFor([old, { ...current, text: old.text }], ["homes"]);
  assert.equal(repeated.kind, "MATCHED");
  if (repeated.kind === "MATCHED") {
    assert.equal(repeated.passages.length, 1);
    assert.equal(repeated.passages[0]?.revisionStatus, "CURRENT");
  }
});

test("three captured revisions of one unchanged page cannot become three chrome pages", () => {
  const same = "We will build more homes and cut the cost of housing across the state.";
  const copies = [1, 2, 3].map(number => doc({ id: `k@capture-${number}`, text: same,
    retrievedAt: `2026-09-${String(20 + number).padStart(2, "0")}T00:00:00.000Z` }));
  const answer = answerFor(copies, ["cost of housing"]);
  assert.equal(answer.kind, "MATCHED", "same-URL captures cannot suppress their own text as repeated site chrome");
  if (answer.kind === "MATCHED") assert.equal(answer.passages.length, 1);
});

test("D05: a passage is a short quote with its link and date, never the page", () => {
  const long = "x ".repeat(4000) + "affordable housing " + "y ".repeat(4000);
  const answer = answerFor([doc({ text: long })], ["affordable housing"], null);
  assert.equal(answer.kind, "MATCHED");
  if (answer.kind !== "MATCHED") return;
  const passage = answer.passages[0];
  // Campaign sites are copyrighted; quote-with-attribution-and-link is the
  // honest form and the defensible one. Never the page.
  assert.ok(passage.quote.length < 500, `a passage ran to ${passage.quote.length} chars`);
  assert.match(passage.quote, /affordable housing/);
  assert.match(passage.quote, /…/, "a clipped passage must show it was clipped");
  assert.ok(passage.documentUrl);
  assert.ok(passage.retrievedAt);
});

test("P02: no composite score exists — not a number, not an order, not a comparison", () => {
  // P02's own words: NO COMPOSITE SCORE. The check is structural rather than
  // a promise: nothing exported here returns a number for a candidate, and
  // nothing sorts candidates at all.
  const source = [
    readFileSync(join(ROOT, "lib", "candidates", "positions.ts"), "utf8"),
    readFileSync(join(ROOT, "lib", "candidates", "corpus.ts"), "utf8"),
    readFileSync(join(ROOT, "lib", "candidates", "issues.ts"), "utf8"),
    readFileSync(join(ROOT, "components", "ballot", "candidate-positions.tsx"), "utf8"),
  ].join("\n");
  // Prose that names the ban is fine; a key or a field is not.
  for (const forbidden of [
    /\bscore:/,
    /\brank:/,
    /\brating:/,
    /\bmatchScore\b/,
    /\bfit:/,
    /\bgrade:/,
    /\balignment:/,
    /\brecommendation:/,
  ]) {
    assert.doesNotMatch(source, forbidden, `a forbidden key: ${forbidden}`);
  }
  // And the shape itself cannot be summed: three answer kinds with no
  // arithmetic between them.
  const positions = positionsFor("does-not-exist");
  for (const p of positions) {
    assert.ok(["MATCHED", "SEARCHED_NOTHING_MATCHED", "NOTHING_COLLECTED"].includes(p.answer.kind));
  }
});

test("P02: equal effort — the same issue list for every candidate, no exceptions", () => {
  const corpus = getCandidateCorpus();
  const keys = [...new Set(corpus.documents.map((d) => d.candidateKey))];
  assert.ok(keys.length > 20, `only ${keys.length} candidates in the corpus`);

  // Every candidate is searched for exactly the same issues. A build where
  // one candidate got fewer would produce a ranking by accident.
  const expected = CANDIDATE_ISSUES.length;
  for (const key of keys) {
    const positions = positionsFor(key);
    assert.equal(positions.length, expected, `${key} was searched for ${positions.length}`);
    assert.deepEqual(
      positions.map((p) => p.issue.id),
      CANDIDATE_ISSUES.map((i) => i.id),
      `${key} was searched in a different order`,
    );
  }
  // Including a candidate we hold nothing for.
  const stranger = positionsFor("nobody-at-all");
  assert.equal(stranger.length, expected);
  assert.ok(positionsSummary(stranger).nothingCollected);
  // RULING 44 / RULING 47 (2026-08-20): a candidate we hold nothing published
  // for gets NO line and NO section — not a sentence about our research.
  assert.equal(positionsHeadline(stranger), null);
});

test("P02: the headline is provenance and carries no count at all", () => {
  const corpus = getCandidateCorpus();
  /*
   * A candidate with a READABLE document, chosen rather than taken first
   * (corrected 2026-08-19, F01-continued item 11). The old form took
   * `[...keys][0]`, and after the chrome strip the first key in document
   * order was a candidate whose only page is a JS-rendered shell — so the
   * headline under test was the NOTHING_COLLECTED one, which correctly has
   * no denominator in it. The test was reading a different sentence than it
   * meant to and calling that a failure of the sentence.
   */
  const key = [...new Set(corpus.documents.filter((d) => d.text).map((d) => d.candidateKey))][0];
  assert.ok(key, "no candidate in the corpus has a readable document");
  const headline = positionsHeadline(positionsFor(key));
  assert.ok(headline, "a candidate with readable documents gets a line");
  /*
   * RULING 47: the count is gone, in both directions. The old assertion
   * required the denominator ("the same 12 issues") because a bare "3 issues"
   * implies completeness; the ruling removed the whole measurement instead.
   * What must survive is provenance — whose words these are and where from.
   */
  assert.ok(!/[0-9]/.test(headline), `the headline carries a digit: ${headline}`);
  assert.match(headline, /own words/i);
});

test("D05: the corpus is real, append-only, and states what it could not reach", () => {
  const corpus = JSON.parse(
    readFileSync(join(ROOT, "data", "candidates", "corpus-2026.json"), "utf8"),
  ) as CandidateCorpus;
  assert.equal(corpus.formatVersion, 1);
  assert.ok(corpus.documents.length > 30, `only ${corpus.documents.length} documents`);
  /*
   * **This used to assert `attempted >= documents.length`, and append-only
   * guarantees that will break** (corrected 2026-08-19, F01-continued item 11).
   *
   * `attempted` is the LAST run's denominator — how many URLs that run tried.
   * `documents` accumulates across every run, because a changed page is
   * appended beside its predecessor rather than replacing it. The two were
   * only ever comparable while the corpus had had exactly one run, and the
   * first re-collection (68 attempted, 96 documents) failed an invariant the
   * file's own design forbids holding.
   *
   * What is actually true, and what the assertion should always have said:
   * `attempted` is a positive denominator, and it bounds the candidates a
   * single run could have reached rather than the history it appended to.
   */
  assert.ok(corpus.attempted > 0, "the corpus states no denominator for its last run");
  assert.ok(
    corpus.attempted >= corpus.failures.length,
    "more failures than URLs attempted — the denominator does not describe the run",
  );

  // Every document carries its revision detector and its read date.
  for (const d of corpus.documents) {
    assert.match(d.contentHash, /^[0-9a-f]{64}$/, `${d.candidateKey}: no content hash`);
    assert.match(d.retrievedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(d.id, `${d.candidateKey}@${d.contentHash}`);
    // The two source classes D05 permits, and nothing else. Never an
    // advocacy organisation, never an endorsement site, never a news
    // characterisation of what somebody said.
    assert.ok(["CAMPAIGN_SITE", "OFFICIAL_SITE"].includes(d.sourceClass));
  }
  // One row per distinct version — an append-only store, not a set of dupes.
  const ids = corpus.documents.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, "the corpus holds duplicate versions");

  // A refusal is recorded with its reason. "We tried and their site refused
  // us" and "we have never looked" are different facts.
  for (const failure of corpus.failures) {
    assert.ok(failure.reason.length > 10, `${failure.candidateKey}: a failure with no reason`);
    assert.match(failure.attemptedAt, /^\d{4}-\d{2}-\d{2}T/);
  }
});

test("D05: the revision detector hashes the TEXT, not the bytes", () => {
  // Running the fetch twice five minutes apart reported 14 REVISIONS: pages
  // whose markup carries a nonce or a build timestamp, changing on every
  // request while the words did not. A revised campaign position is one of
  // this product's real accountability signals, and a signal that fires
  // constantly cannot carry it.
  const corpus = getCandidateCorpus();
  const extracted = corpus.documents.filter((document) => document.extraction === "html");
  assert.ok(extracted.length > 0, "the first seed has no extracted publication to prove");
  for (const document of extracted) {
    const expected = createHash("sha256").update(document.text!).digest("hex");
    assert.equal(document.contentHash, expected, document.id);
    assert.equal(document.id, `${document.candidateKey}@${expected}`, document.id);
  }
});

test("D05: a wall remains durable evidence after the legacy Git collector is retired", () => {
  // Two New Hampshire hosts refuse this egress at rungs 2, 3 AND 4. The
  // Internet Archive holds their pages, and an archived copy of a
  // government's own page is that government's own words with a date. The
  // The executable is deliberately gone: reviewed candidate publications now
  // enter through the manual data-plane admission contract, never a Git writer.
  assert.equal(existsSync(join(ROOT, "scripts", "fetch-candidate-corpus.mts")), false);

  const corpus = JSON.parse(
    readFileSync(join(ROOT, "data", "candidates", "corpus-2026.json"), "utf8"),
  ) as CandidateCorpus;
  for (const failure of corpus.failures) {
    // Every failure names what happened at the live host AND what the
    // archive rung returned. A miss that does not say how far the ladder was
    // walked is not a finding.
    assert.match(
      failure.reason,
      /Internet Archive/,
      `${failure.candidateKey}: a failure that never reached rung 11`,
    );
  }
});

test("P02: no issue phrase is a single loose word that turns a search into noise", () => {
  // The agenda-topic discipline, applied here: "housing" alone matches a
  // "public housing authority" footer, and one loose word makes the reader
  // filter our noise for us.
  const singles: string[] = [];
  for (const issue of CANDIDATE_ISSUES) {
    for (const phrase of issue.phrases) {
      if (!phrase.includes(" ") && phrase.length < 9) singles.push(`${issue.id}:${phrase}`);
    }
  }
  // Six single words are allowed and every one is a proper noun or a term
  // with no second meaning: medicaid, medicare, asylum, abortion, drought,
  // veterans. "seniors" was here and came out — a high school has seniors
  // too. The cap is what makes a seventh a decision rather than a drift.
  assert.ok(
    singles.length <= 6,
    `${singles.length} short single-word phrases: ${singles.join(", ")}`,
  );
});

/* ══ B14, 2026-08-19 (g20): the blurb-equalization hunt ═════════════════════ */

test("B14: the denominator is measured from the ballot, not quoted", async () => {
  const { measureCoverage, ballotPeople } = await import("../scripts/b14-coverage.mts");
  const people = ballotPeople();
  /*
   * Every filed candidacy in the three county files plus every certified
   * nominee in the Arizona general lineup. Both are the reader's ballot and
   * both count, and they are keyed differently — which is exactly how a count
   * goes wrong when it is carried forward instead of re-derived.
   *
   * **It was 136 and it is 393** (2026-08-22). The Morris file stopped being a
   * hand transcription of six contests and became a generated read of the
   * county clerk's current filing — 272 candidacies where there were 15. The
   * jump is the point of the row rather than a break in it.
   *
   * A FLOOR, and self-consistency asserted exactly. An equality here fails
   * every time a county publishes, and the fix for a failing equality is always
   * to edit the number, which is how a guard stops guarding. What must hold
   * exactly is that the denominator is DERIVED — every person distinct, and the
   * coverage measurement counting the same set the ballot does.
   */
  assert.ok(people.length >= 390, `only ${people.length} people on the ballot`);
  assert.equal(new Set(people.map((p) => p.key)).size, people.length, "a duplicate key");

  const coverage = measureCoverage();
  assert.equal(coverage.total, people.length, "coverage counted a different set from the ballot");
  // The headline number this row turns on.
  assert.equal(coverage.bare, coverage.bareKeys.length);
  assert.ok(coverage.bare > 0, "nothing bare — the measurement stopped measuring");
});

test("B14: the blurb rung reaches every candidate with a usable captured description, equally", async () => {
  const { derivedBlurbFor, candidateDescriptionQualityIssue } = await import("../lib/candidates/blurbs.ts");
  const { getCandidateCorpus } = await import("../lib/candidates/positions.ts");

  // Equal effort: the rung is run for EVERY candidate, and the ones it
  // reaches are exactly the ones whose page carries a usable self-description.
  // There is no path that skips a candidate for being obscure.
  const withMeta = new Set(
    getCandidateCorpus()
      .documents.filter((d) => d.metaDescription && !candidateDescriptionQualityIssue(d))
      .map((d) => d.candidateKey),
  );
  for (const key of withMeta) {
    assert.ok(derivedBlurbFor(key), `${key} has a description we did not use`);
  }
  assert.ok(withMeta.size >= 25, `the rung reached only ${withMeta.size} candidates`);
});

test("B14: captured navigation, old-cycle appeals and truncated fragments do not masquerade as biographies", async () => {
  const { derivedBlurbFor, candidateDescriptionQualityIssue } = await import("../lib/candidates/blurbs.ts");
  const { getCandidateCorpus } = await import("../lib/candidates/positions.ts");
  const unusable = getCandidateCorpus().documents.filter(doc => doc.metaDescription && candidateDescriptionQualityIssue(doc));
  assert.equal(unusable.length, 7, "each suppressed description is an exact reviewed capture, not a general candidate filter");
  assert.equal(derivedBlurbFor("ballot-az-pima:state-senate-19|Bob Karp"), null);
  assert.equal(derivedBlurbFor("ballot-az-pima:attorney-general|Warren Petersen"), null);
  assert.equal(derivedBlurbFor("ballot-az-pima:state-house-19|Aiden Nicholette Swallow"), null);
  assert.equal(derivedBlurbFor("ballot-nh-merrimack:executive-council-2:liot-hill-karen"), null);
  assert.match(derivedBlurbFor("ballot-nh-merrimack:us-house-2:goodlander-maggie")?.text ?? "", /commitment to justice/i,
    "a separate usable captured description remains available for the same candidate");
});

test("B14: a derived blurb carries its source class, exactly as a curated one does", async () => {
  const { derivedBlurbFor } = await import("../lib/candidates/blurbs.ts");
  const { getCandidateCorpus } = await import("../lib/candidates/positions.ts");
  const key = getCandidateCorpus().documents.find((d) => d.metaDescription)!.candidateKey;
  const blurb = derivedBlurbFor(key)!;

  // "Every blurb carries its source class" — a description without one is
  // treated as a generated claim and removed. Same register as the curated
  // bios already ship.
  assert.match(blurb.sourceLabel, /In the (campaign's|office's own) words — .+, read \d{4}-\d{2}-\d{2}/);
  assert.match(blurb.sourceUrl, /^https?:\/\//);
  // And it is the campaign's own sentence, not one we picked out of a page.
  assert.ok(blurb.text.length >= 20);
});

test("B14: no markup ever reaches a reader inside a blurb", async () => {
  const { getCandidateCorpus } = await import("../lib/candidates/positions.ts");
  // Alexander Kolodin's description read "AZ&#x27;s Chief of Elections"
  // before the numeric references were decoded generically — the same
  // lesson extractHtmlText already learned, in a second copy that had not.
  for (const doc of getCandidateCorpus().documents) {
    if (!doc.metaDescription) continue;
    assert.doesNotMatch(
      doc.metaDescription,
      /&#\d+;|&#x[0-9a-f]+;|&amp;|&quot;|&nbsp;|<[a-z]/i,
      `${doc.candidateKey}: markup in a blurb — ${doc.metaDescription.slice(0, 60)}`,
    );
  }
});

test("B14: a curated bio always outranks a derived one", () => {
  const card = readFileSync(
    join(ROOT, "components", "ballot", "candidate-card.tsx"),
    "utf8",
  );
  // A session that hand-read a candidate's site beats a meta tag, and the
  // derived line fills the gap underneath — which is where the information
  // asymmetry actually lives.
  assert.match(card, /\{!card\?\.bio && derivedBlurb && \(/);
});
