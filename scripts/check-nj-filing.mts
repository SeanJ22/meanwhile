/**
 * **THE CLERK'S PUBLISHED COUNT AGAINST WHAT THIS PRODUCT RENDERS.**
 * (NJ Hunt 3 item 2.4, 2026-08-22.)
 *
 *   corepack pnpm nj:filing:check          # compare, and report the pair
 *   corepack pnpm nj:filing:check --max-age-days 1
 *
 * ## Why this exists
 *
 * `data/ballot/nj-morris-2026.json` is GENERATED from the Morris County Clerk's
 * filed-candidate PDFs, and the clerk republishes at a new version path on their
 * own schedule — `/v/9/...-082126.pdf` superseded `/v/6/...-080726.pdf` while NJ
 * Hunt 2 was running, and the older path stayed reachable the whole time. A
 * generated file whose source moves underneath it goes stale silently, and
 * **a hand transcription's only symptom is a contest that does not render.**
 * A reader in a municipality whose race was added after our last pull sees a
 * ballot with their race missing, and nothing anywhere says so.
 *
 * So the two numbers are stated and made to reconcile (the D68 pair rule):
 * what the clerk PUBLISHES today, and what this repo RENDERS. Divergence is the
 * finding, and it exits non-zero.
 *
 * ## The RULING 53 clock, and why the window is a day
 *
 * RULING 53 puts candidate fields on 7 days. This is tighter deliberately. A
 * county filing document is not a candidate field — it IS the ballot, it is
 * revised on the authority's own schedule, and near a filing deadline or a
 * ballot-position drawing it moves daily. Seven days of staleness on a
 * candidate's phone number is a gap; seven days of staleness here is a wrong
 * ballot rendered as a right one. So the default window is ONE DAY, and the
 * scheduled workflow runs daily.
 *
 * ## What it refuses to do
 *
 * It does not rebuild anything. Rebuilding is `pnpm nj:ballot --write`, and it
 * belongs to a run that then gates and commits. This only measures, so that
 * "the source moved" and "we rebuilt" stay two separate facts.
 *
 * A fetch it cannot make is reported as a fetch it could not make — exit 2,
 * CANNOT TELL — and never as agreement. RULING 12: a walled source is not a
 * broken job, and neither one is a clean board.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { extractTextLayer } from "../lib/extract/text-layer.ts";
import { politeGetText } from "../lib/sources/http.ts";
import {
  NJ_FILING_SOURCES,
  newestFilingPdfs,
  parseNjFiling,
  type FiledCandidate,
} from "../lib/hunt/nj-filing.ts";
import { compareFiling } from "../lib/hunt/nj-filing-clock.ts";
import { today as stampToday } from "./doc-dates.mjs";

const UA = "we-the-people civic data (contact: seanj22@gmail.com)";
const ROOT = process.cwd();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const MAX_AGE_DAYS = Number(arg("--max-age-days") ?? 1);

/* -------------------------------------------------------------------------- */
/* The CLI half: fetch, count, compare.                                       */
/* -------------------------------------------------------------------------- */

async function publishedCount(): Promise<number | null> {
  try {
    const page = await politeGetText(NJ_FILING_SOURCES.morrisClerkCandidates, {
      profile: "browser",
    });
    if (!page?.text) return null;
    /*
     * The ballot-position scan is excluded by name, exactly as `pnpm nj:ballot`
     * excludes it: it is an image-only document with no text layer, and a
     * rung-9 OCR of it is a different branch. Including it here would produce a
     * guaranteed zero-row parse and turn every run into CANNOT TELL.
     */
    const pdfs = newestFilingPdfs(page.text, "https://www.morriscountyclerk.org").filter(
      (url) => !/order/i.test(url),
    );
    if (pdfs.length === 0) return null;

    let total = 0;
    for (const url of pdfs) {
      const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const text = await extractTextLayer(bytes, url);
      if (text.outcome !== "EXTRACTED") return null;
      const parsed = parseNjFiling(text.items.map((p) => p.text).join("\n"), url);
      if (parsed.outcome !== "EXTRACTED") return null;
      const candidates = parsed.items.filter((r): r is FiledCandidate => "familyName" in r);
      // A zero from any one document is a FAILED parse of that document, and
      // summing it into a total would launder the failure into a smaller number.
      if (candidates.length === 0) return null;
      total += candidates.length;
    }
    return total;
  } catch {
    return null;
  }
}

const ballot = JSON.parse(
  readFileSync(join(ROOT, "data", "ballot", "nj-morris-2026.json"), "utf8"),
) as { contests: unknown[]; candidacies: unknown[]; curatedAt: string };

const verdict = compareFiling({
  published: await publishedCount(),
  rendered: ballot.candidacies.length,
  contestsRendered: ballot.contests.length,
  curatedAt: ballot.curatedAt,
  today: stampToday(),
  maxAgeDays: MAX_AGE_DAYS,
});

console.log("\nNJ FILING · the clerk's published count against what this repo renders\n");
if (verdict.state === "CANNOT_TELL") {
  console.log(`  CANNOT TELL — ${verdict.why}`);
  console.log("  This says NOTHING about whether the ballot is current.");
  process.exit(2);
}
console.log(`  clerk publishes   ${verdict.published} candidacies`);
console.log(`  this repo renders ${verdict.rendered} candidacies across ${ballot.contests.length} contests`);
console.log(`  last pulled       ${ballot.curatedAt} (${verdict.ageDays} day(s) ago, window ${MAX_AGE_DAYS})`);
console.log("");
if (verdict.state === "AGREES") {
  console.log("  AGREES — the pair reconciles and the pull is inside its window.");
  process.exit(0);
}
console.log(`  ${verdict.state} — ${verdict.why}`);
process.exit(1);
