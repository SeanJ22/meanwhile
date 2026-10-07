/**
 * The statement corpus: append-only snapshots of what candidates and officials
 * publish. Never joined with votes (`lib/votes/`). A re-fetch with a matching
 * contentHash appends nothing; a changed hash appends a new snapshot beside the
 * old one. A changed page is shown as changed, with dates, never interpreted.
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
  /**
   * The day (YYYY-MM-DD) a social post was published, when its source states
   * one. Only a dated post can be tied to a vote; `retrievedAt` is never when it was said.
   */
  postedOn?: string;
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
