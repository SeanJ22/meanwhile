/**
 * The statement corpus — snapshots of what candidates and officials publish,
 * append-only (3e).
 *
 * **Two corpora, never merged**: statements (what they said — this store)
 * and votes (how they voted — `lib/votes/`). They answer different questions
 * with different evidence tiers and a join between them is how a summary
 * starts blending rhetoric into record.
 *
 * **Append-only is the product.** A candidate who says one thing Monday and
 * another Friday is exactly what this store exists to catch. Snapshots are
 * never overwritten or amended; a re-fetch whose `contentHash` matches the
 * latest snapshot for the same (subject, url) appends nothing, and a changed
 * hash appends a NEW snapshot beside the old one.
 *
 * **Design constraint for position rendering (recorded 2026-08-14, the
 * author's requirement — next session inherits it):** every displayed
 * position carries its "last checked" date; when the current snapshot of a
 * source differs from a prior snapshot on the same ground, the surface shows
 * a visible changed marker — "this page changed since we last checked" —
 * with the prior version's date and, as rendering matures, access to what it
 * said before. The never-characterize rule applies to change too: the
 * surface says THAT it changed and shows both records — never "flip-flopped",
 * never an interpretation.
 *
 * **Positions are not rendered from this store yet.** Rendering requires the
 * three-answer machinery first — matched / searched-and-nothing /
 * not-yet-collected, each with its denominator — because without it an empty
 * match silently reads as "this person has no position on X", which is a
 * false claim about a person.
 */

import type { CandidateSourceRevision } from "../candidates/corpus.ts";

import type { SnapshotKind } from "./source-kinds.ts";
export type { SnapshotKind } from "./source-kinds.ts";

export interface SourceSnapshot {
  /** `${subjectId}|${url}|${contentHash}` — content-addressed, stable. */
  id: string;
  /** Roster officeholder id or ballot candidacy id. */
  subjectId: string;
  /** For a reader of the raw file. Display only, never a join key. */
  subjectName: string;
  kind: SnapshotKind;
  url: string;
  /** SHA-256 of the extracted text (or of the raw body when extraction failed). */
  contentHash: string;
  /** Original captured-source identity when held; older snapshots may lack it. */
  sourceRevision?: CandidateSourceRevision;
  retrievedAt: string;
  httpStatus: number;
  extraction: "ok" | "failed";
  /** Extracted visible text. Null when extraction failed. */
  text: string | null;
  title: string | null;
}

export interface StatementCorpus {
  /** Append-only. Never rewritten, never amended. */
  snapshots: SourceSnapshot[];
}
