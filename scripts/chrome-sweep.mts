/**
 * **The chrome sweep** — F01-continued item 11.4, 2026-08-19.
 *
 * `pnpm chrome:sweep` re-runs issue extraction over EVERY candidate the
 * corpus holds and reports the before/after as a pair: how many quotations
 * changed, how many were withdrawn entirely, and how many candidates' issue
 * counts moved.
 *
 * It is a COUNT, not a fix — the fix is in `lib/candidates/corpus.ts` and
 * `lib/text/boilerplate.ts`. This exists because "we removed template chrome"
 * is a claim, and a claim about a live contest needs a number and a
 * denominator. It also states how many sites the REPETITION test could not run
 * on, which structural exclusion alone then covered — an unrun test reported
 * as a clean result is the empty-success shape.
 *
 * The BEFORE arm reproduces the old matcher exactly (raw character slice, no
 * chrome filter) so the comparison is against what shipped, not against a
 * description of it.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { answerFor, type CandidateCorpus, type CandidateDocument } from "../lib/candidates/corpus.ts";
import { CANDIDATE_ISSUES } from "../lib/candidates/issues.ts";
import { chromeSignal, repeatedBlocks } from "../lib/text/boilerplate.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const corpus = JSON.parse(
  readFileSync(join(ROOT, "data", "candidates", "corpus-2026.json"), "utf8"),
) as CandidateCorpus;

/** The matcher AS IT SHIPPED, so "before" is measured rather than described. */
const PASSAGE_CHARS = 320;
const MAX_PASSAGES_PER_DOCUMENT = 3;
function beforePassages(
  documents: readonly CandidateDocument[],
  phrases: readonly string[],
): string[] {
  const out: string[] = [];
  for (const doc of documents.filter((d) => d.text)) {
    const haystack = doc.text as string;
    const lower = haystack.toLowerCase();
    let found = 0;
    const seen = new Set<string>();
    for (const phrase of phrases.map((p) => p.toLowerCase()).filter(Boolean)) {
      let from = 0;
      while (found < MAX_PASSAGES_PER_DOCUMENT) {
        const at = lower.indexOf(phrase, from);
        if (at === -1) break;
        from = at + phrase.length;
        const start = Math.max(0, at - PASSAGE_CHARS / 2);
        const end = Math.min(haystack.length, at + phrase.length + PASSAGE_CHARS / 2);
        const raw = haystack.slice(start, end).replace(/\s+/g, " ").trim();
        const quote = (start > 0 ? "…" : "") + raw + (end < haystack.length ? "…" : "");
        if (seen.has(quote)) continue;
        seen.add(quote);
        out.push(quote);
        found += 1;
      }
    }
  }
  return out;
}

const candidateKeys = [...new Set(corpus.documents.map((d) => d.candidateKey))].sort();

let beforeQuotes = 0;
let afterQuotes = 0;
let beforeMentions = 0;
let afterMentions = 0;
let midWordBefore = 0;
let midWordAfter = 0;
const movedCandidates: string[] = [];
const signalCounts = new Map<string, number>();

for (const key of candidateKeys) {
  const documents = corpus.documents.filter((d) => d.candidateKey === key);
  /*
   * The BEFORE arm reads the v1 documents only — what actually shipped — and
   * the AFTER arm reads the current path, which supersedes v1 with v2. Letting
   * BEFORE see both generations would credit the fix with the de-duplication
   * of our own re-read, which is not what it did.
   */
  const shipped = documents.filter((d) => (d.extractorVersion ?? 1) === 1);
  let beforeIssues = 0;
  let afterIssues = 0;
  for (const issue of CANDIDATE_ISSUES) {
    const before = beforePassages(shipped, issue.phrases);
    const after = answerFor(documents, issue.phrases, null);
    const afterList = after.kind === "MATCHED" ? after.passages.map((p) => p.quote) : [];

    beforeQuotes += before.length;
    afterQuotes += afterList.length;
    if (before.length > 0) beforeIssues += 1;
    if (afterList.length > 0) afterIssues += 1;

    for (const quote of before) {
      if (/^…\S/.test(quote) || /\S…$/.test(quote)) midWordBefore += 1;
      const signal = chromeSignal(quote);
      if (signal) signalCounts.set(signal, (signalCounts.get(signal) ?? 0) + 1);
    }
    for (const quote of afterList) {
      if (/^…\S/.test(quote) || /\S…$/.test(quote)) midWordAfter += 1;
    }
  }
  beforeMentions += beforeIssues;
  afterMentions += afterIssues;
  if (beforeIssues !== afterIssues) {
    movedCandidates.push(`${key}: ${beforeIssues} → ${afterIssues}`);
  }
}

// How many SITES the repetition test could not run on. Stated, never implied.
const bySite = new Map<string, string[]>();
for (const doc of corpus.documents.filter((d) => d.text)) {
  let host = doc.documentUrl;
  try {
    host = new URL(doc.documentUrl).host;
  } catch {
    /* its own site */
  }
  bySite.set(host, [...(bySite.get(host) ?? []), doc.text as string]);
}
let sitesRepetitionRan = 0;
let sitesStructuralOnly = 0;
for (const [, texts] of bySite) {
  if (repeatedBlocks(texts).ran) sitesRepetitionRan += 1;
  else sitesStructuralOnly += 1;
}

console.log("=== the chrome sweep ===");
console.log(`candidates carrying at least one held document: ${candidateKeys.length}`);
console.log(`documents in the corpus: ${corpus.documents.length} (attempted ${corpus.attempted}, failures ${corpus.failures.length})`);
console.log("");
console.log("QUOTATIONS, as a pair:");
console.log(`  before ${beforeQuotes}   after ${afterQuotes}   withdrawn ${beforeQuotes - afterQuotes}`);
console.log("ISSUE MENTIONS (candidate × issue pairs with at least one passage), as a pair:");
console.log(`  before ${beforeMentions}   after ${afterMentions}   change ${afterMentions - beforeMentions}`);
console.log(`candidates whose issue-mention count moved: ${movedCandidates.length} of ${candidateKeys.length}`);
movedCandidates.forEach((m) => console.log(`    ${m}`));
console.log("");
console.log("QUOTATIONS BEGINNING OR ENDING MID-WORD:");
console.log(`  before ${midWordBefore}   after ${midWordAfter}`);
console.log("");
console.log("WHY A QUOTATION WAS EXCLUDED, by signal (counted over the BEFORE set):");
if (signalCounts.size === 0) console.log("  none");
for (const [name, n] of [...signalCounts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name.padEnd(28)} ${n}`);
}
console.log("");
console.log("THE REPETITION TEST, and where it could not run:");
console.log(`  sites with 3+ held pages (test ran):        ${sitesRepetitionRan}`);
console.log(`  sites with fewer (structural exclusion only): ${sitesStructuralOnly}`);
console.log(`  total sites: ${bySite.size}`);
