/**
 * Retrieve the Arizona Legislative Council's adopted impartial analyses for
 * every measure on the AZ ballot file (2b): the official explainer each
 * measure's provenance already links, fetched and stored VERBATIM so the
 * surface can render the text instead of claiming absence beside a link to
 * it — data in hand, displayed as missing, was the defect.
 *
 * Same manners as every adapter: identified UA, serialized requests, no
 * refetch of an unchanged hash. Writes data/ballot/az-analyses-2026.json
 * and prints fetched/extracted/failed with the denominator.
 *
 * `pnpm tsx scripts/fetch-measure-analyses.mts`
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { extractPdfText } from "../lib/meetings/agenda-documents.ts";
import { sourceUserAgent } from "../lib/sources/http.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BALLOT_PATH = join(root, "data", "ballot", "az-pima-2026.json");
const OUT_PATH = join(root, "data", "ballot", "az-analyses-2026.json");

interface Contest {
  id: string;
  title: string;
  type: string;
  provenance: { sourceUrl: string | null; sourceOrg: string };
}

interface AnalysisRecord {
  contestId: string;
  measureTitle: string;
  analysisUrl: string;
  sourceOrg: string;
  retrievedAt: string;
  contentHash: string;
  extraction: "pdf" | "failed";
  extractionNote: string | null;
  /** The Council's adopted analysis, verbatim. Never our words. */
  text: string | null;
}

const ballot = JSON.parse(readFileSync(BALLOT_PATH, "utf8")) as {
  contests: Contest[];
};
const measures = ballot.contests.filter(
  (c) => c.type === "MEASURE" && c.provenance.sourceUrl?.includes("azleg.gov"),
);
console.log(
  `${measures.length} measures with Legislative Council analysis URLs of ${
    ballot.contests.filter((c) => c.type === "MEASURE").length
  } measures total`,
);

// Never re-fetch an unchanged document: prior hashes short-circuit nothing
// here (the PDFs are adopted analyses, not living pages), but a prior file
// means reruns are cheap and diffs are visible.
const prior: AnalysisRecord[] = existsSync(OUT_PATH)
  ? (JSON.parse(readFileSync(OUT_PATH, "utf8")).analyses as AnalysisRecord[])
  : [];
const priorById = new Map(prior.map((a) => [a.contestId, a]));

/**
 * Where the Legislature's own adopted-analysis link is broken, the next
 * rung: the Council's draft ("ballot analysis") PDF from the
 * ballot-measures-draft-analyses-2026 index, labeled as exactly that.
 * Verified 2026-08-15: `adopted analysis SCR1004 - 2026.pdf` 404s while the
 * index links it; the draft resolves (18 KB application/pdf). The primary
 * URL is still tried first on every run, so the adopted version takes over
 * the moment azleg fixes its link.
 */
const FALLBACKS: Record<string, { url: string; label: string }> = {
  "ballot-az-pima:prop-319": {
    url: "https://www.azleg.gov/alispdfs/Council/2026BallotMeasures/ballot%20analysis%20SCR1004%20-%202026.pdf",
    label:
      "Arizona Legislative Council (draft ballot analysis — the Legislature's adopted-analysis link is broken at the source)",
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const analyses: AnalysisRecord[] = [];
let fetched = 0;
let extracted = 0;
let failed = 0;

for (const measure of measures) {
  const url = measure.provenance.sourceUrl!;
  const existing = priorById.get(measure.id);
  if (existing?.extraction === "pdf" && existing.analysisUrl === url) {
    analyses.push(existing);
    extracted++;
    console.log(`  kept   ${measure.id} (already extracted, ${existing.text?.length} chars)`);
    continue;
  }

  await sleep(500); // serialized, human pace
  try {
    let effectiveUrl = url;
    let effectiveOrg = measure.provenance.sourceOrg;
    let response = await fetch(url, {
      headers: { "User-Agent": sourceUserAgent(), Accept: "application/pdf,*/*" },
    });
    const fallback = FALLBACKS[measure.id];
    if (!response.ok && fallback) {
      console.log(`  (primary ${response.status} for ${measure.id}; trying the draft-analysis rung)`);
      await sleep(500);
      effectiveUrl = fallback.url;
      effectiveOrg = fallback.label;
      response = await fetch(fallback.url, {
        headers: { "User-Agent": sourceUserAgent(), Accept: "application/pdf,*/*" },
      });
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    fetched++;
    const contentHash = createHash("sha256").update(bytes).digest("hex");

    let text: string | null = null;
    let note: string | null = null;
    try {
      text = await extractPdfText(bytes);
      if (!text || text.length < 200) {
        throw new Error(`extracted only ${text?.length ?? 0} chars`);
      }
      extracted++;
    } catch (error) {
      note = `extraction failed: ${String((error as Error).message)}`;
      failed++;
    }

    analyses.push({
      contestId: measure.id,
      measureTitle: measure.title,
      analysisUrl: effectiveUrl,
      sourceOrg: effectiveOrg,
      retrievedAt: new Date().toISOString(),
      contentHash,
      extraction: text ? "pdf" : "failed",
      extractionNote: note,
      text,
    });
    console.log(
      `  ${text ? "ok    " : "FAILED"} ${measure.id} — ${
        text ? `${text.length} chars` : note
      }`,
    );
  } catch (error) {
    failed++;
    console.log(`  FAILED ${measure.id} — ${String((error as Error).message)}`);
    analyses.push({
      contestId: measure.id,
      measureTitle: measure.title,
      analysisUrl: url,
      sourceOrg: measure.provenance.sourceOrg,
      retrievedAt: new Date().toISOString(),
      contentHash: "",
      extraction: "failed",
      extractionNote: `fetch failed: ${String((error as Error).message)}`,
      text: null,
    });
  }
}

writeFileSync(
  OUT_PATH,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      note: "Adopted impartial analyses of the Arizona Legislative Council, verbatim. The official explainer for each measure; never our words.",
      counts: { measures: measures.length, fetched, extracted, failed },
      analyses,
    },
    null,
    1,
  ) + "\n",
);

console.log(
  `\n${extracted} extracted of ${measures.length} measures (${fetched} fetched this run, ${failed} failed) → ${OUT_PATH}`,
);
if (extracted === 0) {
  console.error("ZERO extractions — refusing to call this a result");
  process.exit(1);
}
