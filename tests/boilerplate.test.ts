import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  breaksAWord,
  chromeSignal,
  excerptAround,
  looksLikeChrome,
  repeatedBlocks,
  stripChromeHtml,
} from "../lib/text/boilerplate.ts";
import {
  answerFor,
  currentExtraction,
  type CandidateCorpus,
  type CandidateDocument,
} from "../lib/candidates/corpus.ts";
import { CANDIDATE_ISSUES } from "../lib/candidates/issues.ts";

/**
 * F01-continued item 11 (2026-08-19) — RULING 9 and RULING 10.
 *
 * Template chrome is not what a candidate said, and no reader-facing
 * quotation may begin or end mid-word. Both are correctness and neutrality
 * rules rather than formatting preferences: a candidate whose site carries a
 * "Read More" rail was being credited with issues they never addressed, while
 * a candidate on a simpler site showed "mentions 0 of them".
 */

// ── RULING 10: word boundaries ────────────────────────────────────────────

test("THE DEFECT: the old slice cut mid-word; the helper does not", () => {
  const text = "The Press Release said housing costs are rising across the district.";
  const at = text.indexOf("housing");
  // A window narrow enough that the arithmetic lands inside words either side.
  const quote = excerptAround(text, at, "housing".length, 20);
  assert.ok(quote.includes("housing"));
  assert.equal(breaksAWord(quote), false, quote);
  // The old form, for contrast — this is what shipped.
  const oldStart = Math.max(0, at - 10);
  const oldEnd = Math.min(text.length, at + 7 + 10);
  const oldQuote =
    (oldStart > 0 ? "…" : "") + text.slice(oldStart, oldEnd).trim() + (oldEnd < text.length ? "…" : "");
  assert.equal(breaksAWord(oldQuote), true, `the control must break a word: ${oldQuote}`);
});

test("the ellipsis sits outside the word, with a space", () => {
  const text = "one two three four five six seven eight nine ten eleven twelve";
  const quote = excerptAround(text, text.indexOf("six"), 3, 12);
  assert.match(quote, /^… /);
  assert.match(quote, / …$/);
});

test("a quote that reaches an end carries no ellipsis on that side", () => {
  const text = "housing costs";
  const quote = excerptAround(text, 0, 7, 400);
  assert.equal(quote, "housing costs");
});

test("the matched phrase is never cut in half by the window", () => {
  const text = `${"x ".repeat(50)}affordable housing${" y".repeat(50)}`;
  const quote = excerptAround(text, text.indexOf("affordable housing"), 18, 4);
  assert.ok(quote.includes("affordable housing"), quote);
});

// ── RULING 9: chrome ──────────────────────────────────────────────────────

test("THE NAMED INSTANCE: Mejia's press-release rail is chrome", () => {
  const rail =
    "…ess Release For Immediate Release: August 6, 2026 Contact: Beth Wiesinger | " +
    "NJ11AMPress@Mail.House.Gov Read More Rep. Mejia and Rep. Dingell Sound Alarm on " +
    "GOP Medicaid Cuts Threatening Healthcare Access For Millions August 4, 2026 " +
    "Press Release For Immediate Release: August 4, 2026 Contact: Beth Wiesinger | " +
    "NJ11AMPress@Mail.H…";
  assert.equal(looksLikeChrome(rail), true);
  assert.ok(chromeSignal(rail));
});

test("a real sentence about an issue is NOT chrome", () => {
  const said =
    "I will fight to bring down prescription drug costs and protect Medicaid for " +
    "the families in this district who depend on it.";
  assert.equal(looksLikeChrome(said), false, chromeSignal(said) ?? "");
});

test("structural exclusion removes nav, header, footer and aside", () => {
  const html = `
    <html><body>
      <nav><a href="/issues">Issues</a><a href="/news">News</a></nav>
      <header><h1>Campaign</h1></header>
      <main><p>I support building more housing near transit.</p></main>
      <aside class="related"><a>Read More</a></aside>
      <footer><p>Paid for by the committee. Contact: press@example.org</p></footer>
    </body></html>`;
  const stripped = stripChromeHtml(html);
  assert.ok(stripped.includes("building more housing"));
  for (const gone of ["Issues", "Campaign", "Read More", "Paid for by"]) {
    assert.ok(!stripped.includes(gone), `"${gone}" survived the strip`);
  }
});

test("structural exclusion removes a marked container even when it is a div", () => {
  const html = `<div class="post-list"><a>Read More</a></div><p>Water policy matters.</p>`;
  const stripped = stripChromeHtml(html);
  assert.ok(!stripped.includes("Read More"));
  assert.ok(stripped.includes("Water policy matters."));
});

test("nesting does not eat the page", () => {
  const html = `<footer><footer>inner</footer>outer</footer><p>kept</p>`;
  const stripped = stripChromeHtml(html);
  assert.ok(stripped.includes("kept"));
  assert.ok(!stripped.includes("inner"));
  assert.ok(!stripped.includes("outer"));
});

test("the repetition test says when it could not run", () => {
  const one = repeatedBlocks(["a sentence that is long enough to count here."]);
  assert.equal(one.ran, false, "one page cannot show repetition");
  assert.equal(one.fingerprints.size, 0);

  const boiler = "Paid for by the committee to elect somebody in this district.";
  const three = repeatedBlocks([
    `${boiler} We support housing.`,
    `${boiler} We support water policy.`,
    `${boiler} We support schools.`,
  ]);
  assert.equal(three.ran, true);
  assert.ok(three.fingerprints.size >= 1, "the repeated block is found");
});

// ── the tally may not be fed by chrome ────────────────────────────────────

const doc = (text: string, url = "https://example.org/issues"): CandidateDocument => ({
  id: "k@hash",
  candidateKey: "k",
  sourceClass: "CAMPAIGN_SITE",
  basis: "HUNTED_AND_VERIFIED",
  metaDescription: null,
  documentUrl: url,
  contentHash: "hash",
  retrievedAt: "2026-08-19T00:00:00.000Z",
  contentType: "text/html",
  text,
  extraction: "html",
  extractionNote: null,
  extractorVersion: 2,
});

test("a chrome-only match answers SEARCHED_NOTHING_MATCHED, not MATCHED", () => {
  const railOnly =
    "Press Release For Immediate Release: August 6, 2026 Contact: Beth Wiesinger | " +
    "press@example.org Read More Sound Alarm on Medicaid Cuts Threatening Health Care " +
    "Access For Millions August 4, 2026 Press Release.";
  const answer = answerFor([doc(railOnly)], ["health care"], null);
  assert.equal(
    answer.kind,
    "SEARCHED_NOTHING_MATCHED",
    "crediting a candidate with their CMS is the defect this replaces",
  );
});

test("a real statement still matches", () => {
  const answer = answerFor(
    [doc("Bringing down health care costs is the first thing I will work on.")],
    ["health care"],
    null,
  );
  assert.equal(answer.kind, "MATCHED");
});

test("no passage this matcher produces breaks a word", () => {
  const corpus = JSON.parse(
    readFileSync(join(process.cwd(), "data", "candidates", "corpus-2026.json"), "utf8"),
  ) as CandidateCorpus;
  const keys = [...new Set(corpus.documents.map((d) => d.candidateKey))];
  let checked = 0;
  const offenders: string[] = [];
  for (const key of keys) {
    const documents = corpus.documents.filter((d) => d.candidateKey === key);
    for (const issue of CANDIDATE_ISSUES) {
      const answer = answerFor(documents, issue.phrases, null);
      if (answer.kind !== "MATCHED") continue;
      for (const passage of answer.passages) {
        checked += 1;
        if (breaksAWord(passage.quote)) offenders.push(`${key} / ${issue.label}: ${passage.quote.slice(0, 80)}`);
      }
    }
  }
  // The denominator, asserted: a loop that examined nothing must not pass.
  assert.ok(checked > 0, "no passages were examined — the guard did not run");
  assert.deepEqual(offenders, [], `${offenders.length} of ${checked} quotations break a word`);
});

test("no passage this matcher produces is template chrome", () => {
  const corpus = JSON.parse(
    readFileSync(join(process.cwd(), "data", "candidates", "corpus-2026.json"), "utf8"),
  ) as CandidateCorpus;
  const keys = [...new Set(corpus.documents.map((d) => d.candidateKey))];
  let checked = 0;
  const offenders: string[] = [];
  for (const key of keys) {
    const documents = corpus.documents.filter((d) => d.candidateKey === key);
    for (const issue of CANDIDATE_ISSUES) {
      const answer = answerFor(documents, issue.phrases, null);
      if (answer.kind !== "MATCHED") continue;
      for (const passage of answer.passages) {
        checked += 1;
        const signal = chromeSignal(passage.quote);
        if (signal) offenders.push(`${key} / ${issue.label} [${signal}]`);
      }
    }
  }
  assert.ok(checked > 0, "no passages were examined — the guard did not run");
  assert.deepEqual(offenders, [], `${offenders.length} of ${checked} quotations are chrome`);
});

// ── the extractor version ─────────────────────────────────────────────────

test("a re-extracted page supersedes its own older copy for reading", () => {
  const older: CandidateDocument = { ...doc("old text"), id: "k@1", extractorVersion: 1 };
  const newer: CandidateDocument = { ...doc("new text"), id: "k@2", extractorVersion: 2 };
  const current = currentExtraction([older, newer]);
  assert.equal(current.length, 1);
  assert.equal(current[0].id, "k@2");
});

test("two revisions at the SAME extractor both survive — that is the record", () => {
  const a: CandidateDocument = { ...doc("september text"), id: "k@a", extractorVersion: 2 };
  const b: CandidateDocument = { ...doc("october text"), id: "k@b", extractorVersion: 2 };
  assert.equal(currentExtraction([a, b]).length, 2);
});

test("a document with no extractorVersion is treated as version 1", () => {
  const legacy = { ...doc("legacy"), id: "k@legacy" };
  delete (legacy as { extractorVersion?: number }).extractorVersion;
  const newer: CandidateDocument = { ...doc("fresh"), id: "k@fresh", extractorVersion: 2 };
  const current = currentExtraction([legacy as CandidateDocument, newer]);
  assert.equal(current.length, 1);
  assert.equal(current[0].id, "k@fresh");
});

test("the legacy Git collector cannot bypass permanent manual data-plane admission", () => {
  assert.equal(
    existsSync(join(process.cwd(), "scripts", "fetch-candidate-corpus.mts")),
    false,
  );
});
