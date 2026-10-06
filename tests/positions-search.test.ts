import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { positionsFor } from "../lib/corpus/positions.ts";
import { currentOfficeholderStatements } from "../lib/corpus/data-plane.ts";
import {
  validateStatementIdentityFirstSeedEvidence,
  type StatementIdentityFirstSeedEvidence,
} from "../lib/corpus/statement-identity-transfer.ts";
import { unifiedCorpus, unifiedCorpusCounts } from "../lib/corpus/unified.ts";
import { currentExtraction } from "../lib/candidates/corpus.ts";
import { getCandidateCorpus } from "../lib/candidates/positions.ts";

/**
 * F01-continued session 2, item 13 (2026-08-19) — **the battlecard's
 * positions search looked in the wrong corpus.**
 *
 * The author: *"Mejia's 'in their own words' section carries content, but
 * opening her battlecard and searching anything under positions returns
 * nothing — including terms stated in the positions the card holds."*
 *
 * Diagnosed before fixing, and it is the third of the four causes the brief
 * proposed: **a differently-shaped record.** Two statement corpora exist and
 * the search read one —
 *
 * * `data/corpus/statements.json`, keyed by OFFICEHOLDER id
 * * `data/candidates/corpus-2026.json`, keyed by CANDIDATE key
 *
 * — so every candidate whose words live only in the second was absent from
 * the index and the search answered, honestly for the corpus it had, "we
 * haven't collected anything they've published", four inches below that
 * candidate's published words.
 */

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

  // Denominators stated. A union that quietly became one corpus again would
  // reproduce the defect SILENTLY — the search would go on answering with a
  // sentence rather than an error.
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

  // The permanent first-seed transfer deliberately aligns an officeholder's
  // historical statements with that same person's candidacy key. That makes
  // the old "at most two overlaps" heuristic false. Permit overlap only when
  // the cryptographically frozen, reviewed bridge names the exact candidacy;
  // any other shared key is still a collision and fails closed.
  const bridge = JSON.parse(
    readFileSync(
      join(ROOT, "lib", "corpus", "fixtures", "statement-identity-first-seed-v1.json"),
      "utf8",
    ),
  ) as StatementIdentityFirstSeedEvidence;
  validateStatementIdentityFirstSeedEvidence(bridge);
  const bridgeTargetsPresentInCandidateCorpus = bridge.rows
    .flatMap(({ status, candidacy }) => status === "RESOLVED" && candidacy !== null
      ? [candidacy.candidacyId]
      : [])
    .filter((subjectId) => candidateSubjects.has(subjectId))
    .sort();
  const actualOverlap = [...statementSubjects]
    .filter((subjectId) => candidateSubjects.has(subjectId))
    .sort();
  assert.deepEqual(
    actualOverlap,
    bridgeTargetsPresentInCandidateCorpus,
    "the corpora may share only exact candidacy identities established by the frozen transfer bridge",
  );
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

/**
 * The verification the brief asked for, run in the suite rather than only by
 * hand: a term drawn from the candidate's OWN held text must find that
 * candidate. Terms chosen by hand would have passed against the broken
 * index — "housing" matches nobody when the index lacks the person.
 */
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
    // A term present only inside an unquotable block still counts as FOUND —
    // the index reached it. What must never happen is the index not holding
    // the person at all, which renders as NOT_YET_COLLECTED.
    const found =
      answer.kind === "MATCHED" || answer.searched.presentButUnquotable > 0;
    if (!found) misses.push(`${key} · "${term}" → ${answer.kind}`);
  }

  console.log(`positions search: ${checked - misses.length} of ${checked} candidates findable`);
  assert.deepEqual(misses, [], `candidates whose own words cannot be found:\n${misses.join("\n")}`);
});

test("13: the named candidate from the report is findable", () => {
  const corpus = unifiedCorpus();
  const answer = positionsFor("ballot-nj-morris:us-house-11:mejia", "analilia", corpus);
  assert.equal(answer.kind, "MATCHED", "the reported candidate still returns nothing");
  assert.ok(answer.passages.length > 0);
});

/**
 * Step 4: a failure states it failed; a genuine zero states zero. Both
 * branches already existed and are pinned here so neither can collapse into
 * the other — a failed retrieval rendered as "nothing found" is a claim about
 * a person made because a request did not complete.
 */
test("13: a failed search and an empty search are different sentences", () => {
  const section = readFileSync(
    join(ROOT, "components", "officials", "positions-section.tsx"),
    "utf8",
  );
  assert.match(section, /setFailed\(true\)/, "the failure state is gone");
  assert.match(section, /failed && <WorkingOnIt/);
  assert.match(section, /answer.kind === "SEARCHED_NOTHING_MATCHED" && <WorkingOnIt/,
    "a search without an equal-effort record keeps the open hunt state");
});

/**
 * **The term that IS on the page and is not quotable.** Found by running the
 * item-13 verification rather than by reading code.
 *
 * Andy Biggs's house.gov page carries "Mining Engineering" inside a press
 * release rail — a run of headlines with no full stop, so one 1,428-character
 * passage, so over `PASSAGE_MAX_CHARS`, so skipped. The skip is CORRECT:
 * quoting a link rail as a person's own words is RULING 6, and clipping 420
 * characters out of it breaks a word, which is RULING 7.
 *
 * What was wrong is what the reader was then told — *"we read their pages and
 * none of them mentions mining"*, a checkable and false statement about a
 * named person, produced by our own passage cap. Our gap and their absence
 * may never render as the same sentence.
 */
test("13: a term we hold but will not quote is not reported as their silence", () => {
  const corpus = unifiedCorpus();
  const answer = positionsFor("ballot-az-pima:governor|Andy Biggs", "mining", corpus);

  assert.equal(answer.kind, "SEARCHED_NOTHING_MATCHED");
  assert.ok(
    answer.searched.presentButUnquotable > 0,
    "the unquotable hit must be counted, not silently dropped",
  );

  const section = readFileSync(
    join(ROOT, "components", "officials", "positions-section.tsx"),
    "utf8",
  );
  assert.match(section, /answer.kind === "SEARCHED_NOTHING_MATCHED" && <WorkingOnIt/);
  assert.doesNotMatch(section, /none of\s+them mentions/, "an unquotable hit cannot become a claim of silence");
});
