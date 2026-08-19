import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.match(answerSentence(none, "housing"), /gap in our research/i);
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
  assert.match(positionsHeadline(stranger), /gap in our research/i);
});

test("P02: the headline states the denominator before any count", () => {
  const corpus = getCandidateCorpus();
  const key = [...new Set(corpus.documents.map((d) => d.candidateKey))][0];
  const headline = positionsHeadline(positionsFor(key));
  // "3 issues" means nothing without "of the 12 we search for everyone".
  assert.match(headline, new RegExp(`same ${CANDIDATE_ISSUES.length} issues`));
  assert.match(headline, /every candidate in this contest/);
});

test("D05: the corpus is real, append-only, and states what it could not reach", () => {
  const corpus = JSON.parse(
    readFileSync(join(ROOT, "data", "candidates", "corpus-2026.json"), "utf8"),
  ) as CandidateCorpus;
  assert.equal(corpus.formatVersion, 1);
  assert.ok(corpus.documents.length > 30, `only ${corpus.documents.length} documents`);
  assert.ok(corpus.attempted >= corpus.documents.length);

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
  const script = readFileSync(
    join(ROOT, "scripts", "fetch-candidate-corpus.mts"),
    "utf8",
  );
  assert.match(script, /contentHashOf\(\s*text \? new TextEncoder\(\)\.encode\(text\) : bytes/);
  assert.match(script, /NOT THE RAW BYTES/);
});

test("D05: a wall is a rung, and the archive is wired in rather than walked by hand", () => {
  // Two New Hampshire hosts refuse this egress at rungs 2, 3 AND 4. The
  // Internet Archive holds their pages, and an archived copy of a
  // government's own page is that government's own words with a date. The
  // rung lives in the script so it costs the next session nothing.
  const script = readFileSync(
    join(ROOT, "scripts", "fetch-candidate-corpus.mts"),
    "utf8",
  );
  assert.match(script, /function waybackFor/);
  assert.match(script, /archive\.org\/wayback\/available/);

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
