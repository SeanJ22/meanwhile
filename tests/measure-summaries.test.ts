import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { MEASURE_SUMMARIES } from "../lib/ballot/measure-summaries.ts";

/**
 * The plain-language summary rules (4d), held mechanically:
 *
 * 1. Every summary cites the official source text it was written from, and
 *    that citation resolves — the contest exists in the analyses store with
 *    extracted text, and the cited URL is that record's URL exactly.
 * 2. Every extracted analysis HAS a summary — a measure whose official
 *    text is on the page without its plain-language layer is the register
 *    gap the author reported (2b), reversed.
 * 3. Summaries describe, never advocate. What it does, not whether it's
 *    good — a summary is one adjective away from a recommendation, and the
 *    no-recommendation rule is the product's neutrality claim.
 * 4. The surface labels the summary and renders the official text — the
 *    label and the verbatim block both exist in the page source.
 */

interface AnalysisRecord {
  contestId: string;
  analysisUrl: string;
  extraction: string;
  text: string | null;
}

const analysesFile = JSON.parse(
  readFileSync(
    join(process.cwd(), "data", "ballot", "az-analyses-2026.json"),
    "utf8",
  ),
) as { counts: { measures: number; extracted: number }; analyses: AnalysisRecord[] };

test("the analyses store is populated, with its counts stated and consistent", () => {
  assert.ok(
    analysesFile.counts.extracted >= 10,
    `expected the 11 AZ measures' analyses, found ${analysesFile.counts.extracted} extracted`,
  );
  const withText = analysesFile.analyses.filter(
    (a) => a.extraction === "pdf" && a.text && a.text.length > 200,
  );
  assert.equal(
    withText.length,
    analysesFile.counts.extracted,
    "the stated extracted count must match rows that actually hold text",
  );
  for (const a of analysesFile.analyses) {
    assert.match(a.analysisUrl, /^https:\/\/www\.azleg\.gov\//, `${a.contestId}: analysis must cite azleg.gov`);
  }
});

test("every statewide summary cites the exact official analysis it was written from", () => {
  const byContest = new Map(analysesFile.analyses.map((a) => [a.contestId, a]));
  for (const summary of MEASURE_SUMMARIES) {
    // BAL-46: the local measures are written from their own held authority
    // text, not a Legislative Council analysis — they resolve in the next test.
    if (summary.citation === "measure-source") continue;
    const analysis = byContest.get(summary.contestId);
    assert.ok(analysis, `${summary.contestId}: summary with no analysis record`);
    assert.equal(
      summary.summarizesUrl,
      analysis.analysisUrl,
      `${summary.contestId}: the summary's citation must be the analysis it summarizes`,
    );
    assert.ok(analysis.text, `${summary.contestId}: cited analysis has no text`);
    assert.ok(summary.summary.length >= 100, `${summary.contestId}: summary too thin to be one`);
  }
});

/**
 * BAL-46 (2026-09-02): a local measure's summary cites the measure's OWN held
 * authority text. The citation must resolve — the measure exists in the ballot
 * data, it holds authority text (a question, and where published a statement),
 * and the summary's URL is that measure's provenance URL exactly. Same
 * describe-never-advocate rule as the statewide layer (held by the test below),
 * same thinness floor.
 */
test("every local summary cites the exact measure source it was written from", () => {
  const ballot = JSON.parse(
    readFileSync(
      join(process.cwd(), "data", "ballot", "az-pima-2026.json"),
      "utf8",
    ),
  ) as { measures?: { contestId: string; questionText?: string; provenance: { sourceUrl: string | null } }[] };
  const byContest = new Map((ballot.measures ?? []).map((m) => [m.contestId, m]));
  for (const summary of MEASURE_SUMMARIES) {
    if (summary.citation !== "measure-source") continue;
    const measure = byContest.get(summary.contestId);
    assert.ok(measure, `${summary.contestId}: local summary with no measure record`);
    assert.ok(
      measure.questionText && measure.questionText.length > 0,
      `${summary.contestId}: cited measure holds no authority text to summarize`,
    );
    assert.equal(
      summary.summarizesUrl,
      measure.provenance.sourceUrl,
      `${summary.contestId}: the summary's citation must be the measure's own source`,
    );
    assert.ok(summary.summary.length >= 100, `${summary.contestId}: summary too thin to be one`);
  }
});

test("every extracted analysis has its plain-language summary", () => {
  const summarized = new Set(MEASURE_SUMMARIES.map((s) => s.contestId));
  for (const analysis of analysesFile.analyses) {
    if (analysis.extraction === "pdf" && analysis.text) {
      assert.ok(
        summarized.has(analysis.contestId),
        `${analysis.contestId}: official text on the page with no plain-language layer`,
      );
    }
  }
});

test("summaries describe, never advocate", () => {
  // Advocacy vocabulary and reader-directed instruction. Word-boundaried so
  // "would" does not match "should", etc.
  const forbidden =
    /\b(should|must vote|vote yes|vote no|good|bad|unfortunately|fortunately|sadly|dangerous|important victory|we recommend|we support|we oppose)\b/i;
  for (const summary of MEASURE_SUMMARIES) {
    const match = summary.summary.match(forbidden);
    assert.equal(
      match,
      null,
      `${summary.contestId}: summary contains advocacy vocabulary "${match?.[0]}"`,
    );
  }
});

test("the ballot surface labels the summary and renders the official text", () => {
  const page = readFileSync(
    join(process.cwd(), "app", "ballot", "page.tsx"),
    "utf8",
  );
  assert.ok(
    page.includes("Plain-language summary — read the official text below"),
    "the summary label is the contract: labeled, above, never replacing",
  );
  assert.ok(
    page.includes("analysis.text"),
    "the page must render the analysis text itself, not merely link it",
  );
});
