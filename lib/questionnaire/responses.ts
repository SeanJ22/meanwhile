/**
 * Questionnaire responses: versioned, verbatim, and withdrawable to neutral. There is no summary field
 * and nothing here shortens or rewrites an answer. Every version is kept; the latest renders with its
 * date. A withdrawal is kept internally and the card returns to the neutral invited state.
 */

import type { OfficeClass } from "./instrument.ts";

/** One answer to one question, exactly as the candidate typed it. */
export interface Answer {
  /** The `Question.id` this answers. Recorded so a renumbered set cannot re-point it. */
  questionId: string;
  /** **Verbatim. Never truncated, never summarised, never edited by us.** */
  text: string;
}

/** One submission. An edit produces a new version; nothing is mutated in place. */
export interface ResponseVersion {
  /** 1-based, in submission order. */
  version: number;
  /** When the candidate sent it. */
  submittedAt: string;
  /** The instrument version they answered. Never inferred from the current one. */
  instrumentVersion: string;
  /** The office class whose class questions they were asked. */
  officeClass: OfficeClass;
  answers: readonly Answer[];
}

export interface CandidateResponseRecord {
  /** The ballot candidacy this belongs to. Public content, not reader data. */
  candidacyId: string;
  /** Every version, oldest first. Append-only. */
  versions: readonly ResponseVersion[];
  /** Set when the candidate withdraws. Internal only; never rendered. */
  withdrawnAt: string | null;
}

/**
 * What renders, if anything. A withdrawn record returns the same `null` as an unanswered one, so
 * surfaces cannot render them differently.
 */
export function renderableResponse(
  record: CandidateResponseRecord | null | undefined,
): ResponseVersion | null {
  if (!record) return null;
  if (record.withdrawnAt !== null) return null;
  if (record.versions.length === 0) return null;
  return record.versions.reduce((latest, v) => (v.version > latest.version ? v : latest));
}

/** The date to show beside a rendered answer set, or `null` for a first submission. */
export function updatedOn(record: CandidateResponseRecord): string | null {
  const latest = renderableResponse(record);
  if (!latest || latest.version <= 1) return null;
  return latest.submittedAt;
}

/** Append a submission. Pure. A submission after a withdrawal clears the withdrawal; earlier versions stay. */
export function withSubmission(
  record: CandidateResponseRecord,
  submission: Omit<ResponseVersion, "version">,
): CandidateResponseRecord {
  const version = record.versions.length + 1;
  return {
    candidacyId: record.candidacyId,
    versions: [...record.versions, { ...submission, version }],
    withdrawnAt: null,
  };
}

/** Withdraw. Versions are retained; the card returns to the neutral state. */
export function withWithdrawal(
  record: CandidateResponseRecord,
  withdrawnAt: string,
): CandidateResponseRecord {
  return { ...record, withdrawnAt };
}
