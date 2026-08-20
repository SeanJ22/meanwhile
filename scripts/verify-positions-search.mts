/**
 * **Does the battlecard's positions search find what the battlecard holds?**
 * — F01-continued session 2, item 13, 2026-08-19.
 *
 * `pnpm verify:positions`
 *
 * The author's report: *"Mejia's 'in their own words' section carries
 * content, but opening her battlecard and searching anything under positions
 * returns nothing — including terms stated in the positions the card holds."*
 *
 * The verification the brief asks for is the only one that could have caught
 * it: for candidates across the pilot zips, take a term that appears
 * **verbatim in that candidate's own held text**, run the search that the
 * battlecard runs, and require a hit. A search tested with terms somebody
 * chose by hand would have passed against the broken index — "housing"
 * matches nobody when the index does not contain the person.
 *
 * The terms are therefore DRAWN FROM THE CORPUS, per candidate, not written
 * here. That is the whole design of the check.
 */
import { unifiedCorpus, unifiedCorpusCounts } from "../lib/corpus/unified.ts";
import { positionsFor } from "../lib/corpus/positions.ts";
import { currentExtraction } from "../lib/candidates/corpus.ts";
import { getCandidateCorpus } from "../lib/candidates/positions.ts";

const WANT = Number(
  process.argv.find((a) => a.startsWith("--want="))?.slice("--want=".length) ?? 10,
);

const counts = unifiedCorpusCounts();
console.log("=== the search index ===");
console.log(`  officeholder snapshots      ${counts.statements} (${counts.statementSubjects} subjects)`);
console.log(`  candidate documents         ${counts.candidateDocuments} (${counts.candidateSubjects} subjects)`);
console.log(`  UNION                       ${counts.total} snapshots, ${counts.subjects} subjects`);
console.log(`  readable                    ${counts.readable}\n`);

const corpus = unifiedCorpus();

/**
 * A term this candidate's own text actually contains.
 *
 * Long-ish words only, and skipped if the word is one of the stop-ish ones a
 * search would match on every page — the point is a term that identifies
 * THIS candidate's text, not one that matches any English.
 */
const COMMON = new Set([
  "about", "after", "again", "their", "there", "these", "those", "which", "while",
  "would", "should", "could", "every", "other", "under", "where", "https", "http",
  "click", "learn", "email", "please", "contact", "website", "america", "american",
]);

function termFrom(text: string): string | null {
  const words = text.toLowerCase().match(/[a-z]{6,14}/g) ?? [];
  const counted = new Map<string, number>();
  for (const w of words) {
    if (COMMON.has(w)) continue;
    counted.set(w, (counted.get(w) ?? 0) + 1);
  }
  // The most frequent distinctive word in their own pages — a term the
  // candidate genuinely uses, chosen by the data rather than by me.
  const best = [...counted].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

const docs = currentExtraction(getCandidateCorpus().documents).filter(
  (d) => d.extraction === "html" && d.text && d.text.length > 400,
);
const byCandidate = new Map<string, string>();
for (const d of docs) {
  if (!byCandidate.has(d.candidateKey)) byCandidate.set(d.candidateKey, d.text as string);
}

console.log(`=== candidates with readable held text: ${byCandidate.size} ===\n`);

let hit = 0;
let miss = 0;
const checked: string[] = [];

for (const [key, text] of byCandidate) {
  if (checked.length >= WANT && miss === 0) break;
  const term = termFrom(text);
  if (!term) {
    console.log(`  ${key}\n    NO TERM DRAWN — their text held no distinctive word; not counted either way`);
    continue;
  }
  const answer = positionsFor(key, term, corpus);
  // A term present only in an unquotable block is a HIT for this check: the
  // index found it. What the surface must not do is call it an absence, and
  // that is a separate assertion in tests/positions-search.test.ts.
  const ok =
    answer.kind === "MATCHED" || answer.searched.presentButUnquotable > 0;
  if (ok) hit += 1;
  else miss += 1;
  checked.push(key);
  console.log(
    `  ${ok ? "HIT " : "MISS"}  ${key}\n` +
      `        term "${term}" (drawn from their own text)  →  ${answer.kind}` +
      (answer.kind === "MATCHED" ? ` · ${answer.passages.length} passage(s)` : "") +
      (answer.searched.presentButUnquotable > 0
        ? ` · present in ${answer.searched.presentButUnquotable} unquotable block(s)`
        : ""),
  );
}

console.log(
  `\n${hit} hit · ${miss} miss  of ${checked.length} candidates checked ` +
    `(target ${WANT}), from a pool of ${byCandidate.size}.`,
);
if (miss > 0 || hit < Math.min(WANT, byCandidate.size)) {
  console.error(
    "A candidate whose own words are on their card must be findable by a term " +
      "from those words. A miss here is the item 13 defect, still present.",
  );
  process.exitCode = 1;
}
