import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { positionsFor } from "../lib/corpus/positions.ts";
import { currentOfficeholderStatements } from "../lib/corpus/data-plane.ts";
import { unifiedCorpus, unifiedCorpusCounts } from "../lib/corpus/unified.ts";
import { currentExtraction } from "../lib/candidates/corpus.ts";
import { getCandidateCorpus } from "../lib/candidates/positions.ts";
import { installCandidateCorpus, installOfficeholderStatements, installRegistryAuthority, UNQUOTABLE_CANDIDATE_KEY, UNQUOTABLE_TERM } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();
await installCandidateCorpus();
await installOfficeholderStatements();

// The positions search reads the union of the officeholder statement corpus and the candidate corpus.

const ROOT = join(import.meta.dirname, "..");

test("13: the search index is the UNION of both statement corpora", () => {
  const c = unifiedCorpusCounts();
  const corpus = unifiedCorpus();
  const statementSubjects = new Set(
    currentOfficeholderStatements().snapshots.map(({ subjectId }) => subjectId),
  );
  const candidateSubjects = new Set(
    currentExtraction(getCandidateCorpus().documents).map(({ candidateKey }) => candidateKey),
  );

  // Denominators stated: a union that quietly became one corpus again would answer with a sentence, not an error.
  assert.ok(c.statements >= 19, `production-eligible officeholder snapshots collapsed to ${c.statements}`);
  assert.ok(
    corpus.snapshots.every((snapshot) => !snapshot.subjectId.startsWith("plural:")),
    "retired intermediary identities must not re-enter the canonical statement projection",
  );
  assert.ok(
    c.candidateDocuments > 40,
    `candidate documents collapsed to ${c.candidateDocuments}`,
  );
  assert.equal(
    c.total,
    c.statements + c.candidateDocuments,
    "the union must be exactly both halves",
  );

  const actualOverlap = [...statementSubjects]
    .filter((subjectId) => candidateSubjects.has(subjectId))
    .sort();
  assert.equal(
    c.subjects,
    c.statementSubjects + c.candidateSubjects - actualOverlap.length,
    "the subject union must lose exactly the reviewed shared identities and no others",
  );
  assert.equal(
    new Set(corpus.snapshots.map(({ id }) => id)).size,
    corpus.snapshots.length,
    "statement/document record identities must remain unique across the union",
  );
  console.log(
    `positions index: ${c.statements} + ${c.candidateDocuments} = ${c.total} snapshots, ` +
      `${c.subjects} subjects, ${c.readable} readable`,
  );
});

/** A term drawn from each candidate's own held text must find that candidate. */
test("13: every candidate with held text is findable by a term from that text", () => {
  const corpus = unifiedCorpus();
  const docs = currentExtraction(getCandidateCorpus().documents).filter(
    (d) => d.extraction === "html" && d.text && d.text.length > 400,
  );

  const byCandidate = new Map<string, string>();
  for (const d of docs) {
    if (!byCandidate.has(d.candidateKey)) byCandidate.set(d.candidateKey, d.text as string);
  }
  assert.ok(byCandidate.size >= 30, `only ${byCandidate.size} candidates hold readable text`);

  const misses: string[] = [];
  let checked = 0;
  for (const [key, text] of byCandidate) {
    // The most frequent long word in their own pages.
    const counted = new Map<string, number>();
    for (const w of text.toLowerCase().match(/[a-z]{6,14}/g) ?? []) {
      counted.set(w, (counted.get(w) ?? 0) + 1);
    }
    const term = [...counted].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!term) continue;
    checked += 1;
    const answer = positionsFor(key, term, corpus);
    // A term present only inside an unquotable block still counts as found; the index reached it.
    const found =
      answer.kind === "MATCHED" || answer.searched.presentButUnquotable > 0;
    if (!found) misses.push(`${key} · "${term}" → ${answer.kind}`);
  }

  console.log(`positions search: ${checked - misses.length} of ${checked} candidates findable`);
  assert.deepEqual(misses, [], `candidates whose own words cannot be found:\n${misses.join("\n")}`);
});

/** Both unsettled searches contribute to the card gap without asserting silence. */
test("13: failed and empty searches keep the card gap open", () => {
  const section = readFileSync(
    join(ROOT, "components", "officials", "positions-section.tsx"),
    "utf8",
  );
  assert.match(section, /setFailed\(true\)/, "the failure state is gone");
  assert.match(section, /failed && <CardGapContribution/);
  assert.match(section, /answer.kind === "SEARCHED_NOTHING_MATCHED" && <CardGapContribution/,
    "a search without an equal-effort record keeps the open hunt state");
});

/**
 * A term held only inside an over-long passage (e.g. a headline rail) is skipped as unquotable, and the reader must
 * not be told the person's pages do not mention it.
 */
test("13: a term we hold but will not quote is not reported as their silence", () => {
  const corpus = unifiedCorpus();
  const answer = positionsFor(UNQUOTABLE_CANDIDATE_KEY, UNQUOTABLE_TERM, corpus);

  assert.equal(answer.kind, "SEARCHED_NOTHING_MATCHED");
  assert.ok(
    answer.searched.presentButUnquotable > 0,
    "the unquotable hit must be counted, not silently dropped",
  );

  const section = readFileSync(
    join(ROOT, "components", "officials", "positions-section.tsx"),
    "utf8",
  );
  assert.match(section, /answer.kind === "SEARCHED_NOTHING_MATCHED" && <CardGapContribution/);
  assert.doesNotMatch(section, /none of\s+them mentions/, "an unquotable hit cannot become a claim of silence");
});
