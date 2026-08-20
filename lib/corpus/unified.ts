import { readFileSync } from "node:fs";
import { join } from "node:path";

import { currentExtraction } from "../candidates/corpus.ts";
import type { CandidateCorpus, CandidateDocument } from "../candidates/corpus.ts";
import type { SourceSnapshot, StatementCorpus } from "./types.ts";

/**
 * **The battlecard's positions search had two corpora and looked in one.**
 * (F01-continued session 2, item 13, 2026-08-19.)
 *
 * ## The report, and what was actually wrong
 *
 * The author, on device: *"Mejia's 'in their own words' section carries
 * content, but opening her battlecard and searching anything under positions
 * returns nothing — including terms stated in the positions the card holds."*
 *
 * The brief offered four candidate causes: an empty index, the wrong field, a
 * differently-shaped record, or not wired at all. **It is the third**, and it
 * is worth being precise because the other three would each have had a
 * different fix.
 *
 * This product holds **two** statement corpora, keyed in two spaces:
 *
 * | File | Rows | Keyed by | Read by |
 * |---|---|---|---|
 * | `data/corpus/statements.json` | 32 snapshots, 22 subjects | OFFICEHOLDER id — `congress:G000606`, `plural:6dba…` | the battlecard's Positions search |
 * | `data/candidates/corpus-2026.json` | 96 documents, 49 candidates | CANDIDATE key — `ballot-nj-morris:us-house-11:mejia` | the ballot's "in their own words" |
 *
 * `PositionsSection` is handed a subject id and searches the first file. Every
 * candidate whose words live only in the second is therefore **absent from
 * the index the search reads**, and the search answers honestly for the
 * corpus it was given — `NOT_YET_COLLECTED`, "we haven't collected anything
 * they've published" — four inches below that candidate's published words.
 *
 * Nothing was broken. Two stores drifted apart and one surface only knew
 * about one of them. The type in `./types.ts` had said all along that
 * `subjectId` is a *"roster officeholder id **or ballot candidacy id**"* —
 * the candidate corpus simply was never brought into it.
 *
 * ## The fix, and why it is a union rather than a migration
 *
 * The two files stay as they are. They are append-only evidence stores with
 * different collectors, different provenance and different retrieval
 * histories, and rewriting either to key like the other would destroy the
 * append-only guarantee that makes them worth anything.
 *
 * Instead this module builds the SEARCH INDEX as a union: every candidate
 * document normalised into the snapshot shape the search already speaks,
 * beside every statement snapshot. One index, both key spaces, and a subject
 * id or a candidate key resolves the same way.
 *
 * **`currentExtraction` is applied to the candidate half** and that is not an
 * optimisation. Session 1 gave the candidate corpus an `extractorVersion` so
 * a re-extraction could be told from a campaign changing its page; reading
 * every historical extraction here would quote a passage the current
 * extractor no longer produces, and date it today.
 *
 * ## What it does not do
 *
 * It does not merge the FILES, does not join statements to votes (`./types.ts`
 * forbids that in as many words — rhetoric and record are different evidence
 * tiers), and adds no claim of its own. Every passage the search returns is
 * still the subject's own text, with the page and the read date attached.
 */

let cached: StatementCorpus | null = null;

/** The officeholder-keyed store, as committed. */
function statements(): StatementCorpus {
  return JSON.parse(
    readFileSync(join(process.cwd(), "data", "corpus", "statements.json"), "utf8"),
  ) as StatementCorpus;
}

/** The candidate-keyed store, as committed. */
function candidates(): CandidateCorpus {
  return JSON.parse(
    readFileSync(join(process.cwd(), "data", "candidates", "corpus-2026.json"), "utf8"),
  ) as CandidateCorpus;
}

/**
 * One candidate document in the shape the search speaks.
 *
 * Every field is carried across or derived mechanically. Nothing is invented:
 * a document with no title gets `null`, not a manufactured one, and the
 * subject NAME — display only, never a join key — is the candidate key
 * itself where the corpus holds no name, because a name guessed from a key
 * is a claim about a person.
 */
export function snapshotFromCandidateDocument(doc: CandidateDocument): SourceSnapshot {
  return {
    id: doc.id,
    subjectId: doc.candidateKey,
    subjectName: doc.candidateKey,
    kind: doc.sourceClass === "CAMPAIGN_SITE" ? "CAMPAIGN_SITE" : "OFFICIAL_PAGE",
    url: doc.documentUrl,
    contentHash: doc.contentHash,
    retrievedAt: doc.retrievedAt,
    // The candidate corpus records extraction rather than status; a document
    // that is here at all was retrieved. 200 is the honest reading and it is
    // not used for any claim — nothing renders an HTTP status to a reader.
    httpStatus: 200,
    // The two stores spell success differently — `"html"` here, `"ok"`
    // there — which is one more way the same fact was written twice. The
    // mapping is explicit rather than a truthiness check, so a third value
    // added upstream lands as `failed` and is excluded, never silently read
    // as readable.
    extraction: doc.extraction === "html" ? "ok" : "failed",
    text: doc.text ?? null,
    title: null,
  };
}

/**
 * The search index: both corpora, one snapshot list.
 *
 * Cached like the two readers it wraps — the files are committed data and
 * nothing fetches per page load.
 */
export function unifiedCorpus(): StatementCorpus {
  if (cached) return cached;

  const fromStatements = statements().snapshots;

  // `currentExtraction` collapses the append-only candidate corpus to the
  // newest extraction per (candidate, url) — see the header.
  const docs = candidates().documents;
  const current = currentExtraction(docs);
  const fromCandidates = current.map(snapshotFromCandidateDocument);

  cached = { snapshots: [...fromStatements, ...fromCandidates] };
  return cached;
}

/**
 * The counts, so the union can be asked what it returned.
 *
 * An index that quietly became one corpus again would produce exactly the
 * defect this module fixes, and it would produce it silently — the search
 * would go on answering `NOT_YET_COLLECTED`, which is a sentence rather than
 * an error. `tests/positions-search.test.ts` asserts these against floors.
 */
export function unifiedCorpusCounts() {
  const fromStatements = statements().snapshots;
  const current = currentExtraction(candidates().documents);
  const all = unifiedCorpus().snapshots;
  return {
    statements: fromStatements.length,
    statementSubjects: new Set(fromStatements.map((s) => s.subjectId)).size,
    candidateDocuments: current.length,
    candidateSubjects: new Set(current.map((d) => d.candidateKey)).size,
    total: all.length,
    subjects: new Set(all.map((s) => s.subjectId)).size,
    readable: all.filter((s) => s.extraction === "ok" && s.text).length,
  };
}
