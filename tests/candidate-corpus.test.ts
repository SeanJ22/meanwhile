import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  answerFor,
  answerSentence,
  type CandidateDocument,
} from "../lib/candidates/corpus.ts";
import { DEFAULT_STANCE_TOPICS } from "../lib/stances/topics.ts";
import {
  getCandidateCorpus,
  positionsFor,
  positionsHeadline,
  positionsSummary,
} from "../lib/candidates/positions.ts";
import { installCandidateCorpus, installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();
await installCandidateCorpus();

const ROOT = process.cwd();

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

test("the three answers are three, and none of them is a blank", () => {

  const none = answerFor([], ["housing"], "https://example.org");
  assert.equal(none.kind, "NOTHING_COLLECTED");
  assert.equal(answerSentence(none, "housing"), "We’re working on getting this info");

  const empty = answerFor([doc()], ["veterans"], null);
  assert.equal(empty.kind, "SEARCHED_NOTHING_MATCHED");
  const emptySentence = answerSentence(empty, "veterans");
  assert.match(emptySentence, /We searched the one page we hold/);
  assert.match(emptySentence, /2026-08-19/);
  assert.match(emptySentence, /Nothing in them mentions veterans/);

  const hit = answerFor([doc()], ["cost of housing"], null);
  assert.equal(hit.kind, "MATCHED");
  assert.match(answerSentence(hit, "housing"), /1 passage mentions housing/);
});

test("a held-but-unreadable page is not a search that came back empty", () => {
  const answer = answerFor(
    [doc({ text: null, extraction: "failed", extractionNote: "a rendered shell" })],
    ["housing"],
    "https://example.org",
  );
  assert.equal(answer.kind, "NOTHING_COLLECTED");
});

test("every answer that searched carries its own scope", () => {
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

test("a passage is a short quote with its link and date, never the page", () => {
  const long = "x ".repeat(4000) + "affordable housing " + "y ".repeat(4000);
  const answer = answerFor([doc({ text: long })], ["affordable housing"], null);
  assert.equal(answer.kind, "MATCHED");
  if (answer.kind !== "MATCHED") return;
  const passage = answer.passages[0];
  assert.ok(passage.quote.length < 500, `a passage ran to ${passage.quote.length} chars`);
  assert.match(passage.quote, /affordable housing/);
  assert.match(passage.quote, /…/, "a clipped passage must show it was clipped");
  assert.ok(passage.documentUrl);
  assert.ok(passage.retrievedAt);
});

test("no composite score exists — not a number, not an order, not a comparison", () => {
  const source = [
    readFileSync(join(ROOT, "lib", "candidates", "positions.ts"), "utf8"),
    readFileSync(join(ROOT, "lib", "candidates", "corpus.ts"), "utf8"),
    readFileSync(join(ROOT, "components", "ballot", "candidate-positions.tsx"), "utf8"),
  ].join("\n");
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
  const positions = positionsFor("does-not-exist");
  for (const p of positions) {
    assert.ok(["MATCHED", "SEARCHED_NOTHING_MATCHED", "NOTHING_COLLECTED"].includes(p.answer.kind));
  }
});

test("equal effort — the same issue list for every candidate, no exceptions", () => {
  const corpus = getCandidateCorpus();
  const keys = [...new Set(corpus.documents.map((d) => d.candidateKey))];
  assert.ok(keys.length > 20, `only ${keys.length} candidates in the corpus`);

  const expected = DEFAULT_STANCE_TOPICS.length;
  for (const key of keys) {
    const positions = positionsFor(key);
    assert.equal(positions.length, expected, `${key} was searched for ${positions.length}`);
    assert.deepEqual(
      positions.map((p) => p.issue.id),
      DEFAULT_STANCE_TOPICS.map((i) => i.id),
      `${key} was searched in a different order`,
    );
  }
  const stranger = positionsFor("nobody-at-all");
  assert.equal(stranger.length, expected);
  assert.ok(positionsSummary(stranger).nothingCollected);
  assert.equal(positionsHeadline(stranger), null);
});

test("the headline is provenance and carries no count at all", () => {
  const corpus = getCandidateCorpus();
  const key = [...new Set(corpus.documents.filter((d) => d.text).map((d) => d.candidateKey))][0];
  assert.ok(key, "no candidate in the corpus has a readable document");
  const headline = positionsHeadline(positionsFor(key));
  assert.ok(headline, "a candidate with readable documents gets a line");
  assert.ok(!/[0-9]/.test(headline), `the headline carries a digit: ${headline}`);
  assert.match(headline, /own words/i);
});

test("no issue phrase is a single loose word that turns a search into noise", () => {
  const singles: string[] = [];
  for (const issue of DEFAULT_STANCE_TOPICS) {
    for (const phrase of issue.phrases) {
      if (!phrase.includes(" ") && phrase.length < 9) singles.push(`${issue.id}:${phrase}`);
    }
  }
  // Each allowed single word has no second meaning; a seventh needs a decision.
  assert.ok(
    singles.length <= 6,
    `${singles.length} short single-word phrases: ${singles.join(", ")}`,
  );
});

test("the blurb rung reaches every candidate with a usable captured description, equally", async () => {
  const { derivedBlurbFor, candidateDescriptionQualityIssue } = await import("../lib/candidates/blurbs.ts");
  const { getCandidateCorpus } = await import("../lib/candidates/positions.ts");

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

test("a derived blurb carries its source class, exactly as a curated one does", async () => {
  const { derivedBlurbFor } = await import("../lib/candidates/blurbs.ts");
  const { getCandidateCorpus } = await import("../lib/candidates/positions.ts");
  const key = getCandidateCorpus().documents.find((d) => d.metaDescription)!.candidateKey;
  const blurb = derivedBlurbFor(key)!;

  assert.match(blurb.sourceLabel, /In the (campaign's|office's own) words — .+, read \d{4}-\d{2}-\d{2}/);
  assert.match(blurb.sourceUrl, /^https?:\/\//);
  assert.ok(blurb.text.length >= 20);
});

test("a curated bio always outranks a derived one", () => {
  const card = readFileSync(
    join(ROOT, "components", "ballot", "candidate-card.tsx"),
    "utf8",
  );
  assert.match(card, /\{!card\?\.bio && derivedBlurb && \(/);
});
