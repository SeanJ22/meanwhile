/**
 * **THE RESPONSE RECORD — versioned, verbatim, and withdrawable to neutral.**
 * (Built 2026-08-23, the questionnaire-and-corpora brief, item 1.
 * Law: RULING 112, `CLAUDE.md`.)
 *
 * ## Verbatim is a property of the TYPE, not a promise in a comment
 *
 * There is no summary field on a response and there is no function in this
 * module that shortens, paraphrases, rewrites or compresses an answer. That is
 * deliberate and it is the enforcement: a field that does not exist cannot be
 * filled by a later session that thought a shorter version would render better.
 * `tests/questionnaire.test.ts` fails the build if a summarising field or an
 * LLM call appears anywhere under `lib/questionnaire/`.
 *
 * **The Citizens Clean Elections Commission's *in their own words* is the
 * model.** No fact-check annotation, no editorial note, no rating, no rebuttal
 * and no context sentence inside the answer block. Where the product has
 * something to say about an answer it says it somewhere that is not the answer.
 *
 * ## Editing, and why every version is kept
 *
 * A candidate may update an answer as often as they like. Every version is
 * retained with its date; **the latest renders**, marked with the date it was
 * updated. Keeping the earlier ones is not a gotcha file — it is the same
 * immutability the signal snapshots have, for the same reason: a record that
 * can be silently rewritten cannot prove what it said before an outcome was
 * known.
 *
 * ## Withdrawal returns the candidate to NEUTRAL, not to "responded then withdrew"
 *
 * *"Responded then withdrew"* reads as prejudicial — it invites a reader to
 * wonder what was taken back — and a candidate who withdraws would be rendered
 * worse than one who never answered at all, which would make answering risky
 * and answering-then-thinking-better-of-it punished. **Neutrality wins over
 * completeness here.** The withdrawal itself is retained internally with its date so the act is not
 * erased from our own record; it never reaches a reader, and the card renders
 * exactly the invited-awaiting-answer state every other silent candidate gets.
 */

import type { OfficeClass } from "./instrument.ts";

/** One answer to one question, exactly as the candidate typed it. */
export interface Answer {
  /** The `Question.id` this answers. Recorded so a renumbered set cannot re-point it. */
  questionId: string;
  /** **Verbatim. Never truncated, never summarised, never edited by us.** */
  text: string;
}

/**
 * One submission. A candidate who edits produces a NEW version; nothing here
 * is ever mutated in place.
 */
export interface ResponseVersion {
  /** 1-based, in submission order. */
  version: number;
  /** When the candidate sent it. A read stamp (RULING 107) — the moment of the write. */
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
  /**
   * Set when the candidate withdraws. **Internal only.** The card renders the
   * neutral invited state and never mentions that a withdrawal happened.
   */
  withdrawnAt: string | null;
}

/**
 * What renders, if anything.
 *
 * Returns `null` for a withdrawn record — deliberately the same `null` an
 * unanswered record returns, so the calling surface cannot tell the two apart
 * and therefore cannot render them differently.
 */
export function renderableResponse(
  record: CandidateResponseRecord | null | undefined,
): ResponseVersion | null {
  if (!record) return null;
  if (record.withdrawnAt !== null) return null;
  if (record.versions.length === 0) return null;
  return record.versions.reduce((latest, v) => (v.version > latest.version ? v : latest));
}

/**
 * The date to show beside a rendered answer set, or `null` for a first
 * submission.
 *
 * A first answer carries no "updated" line because there is nothing it was
 * updated from, and printing one would make an untouched answer look revised.
 */
export function updatedOn(record: CandidateResponseRecord): string | null {
  const latest = renderableResponse(record);
  if (!latest || latest.version <= 1) return null;
  return latest.submittedAt;
}

/**
 * Append a submission. Pure — it returns the next record and mutates nothing.
 *
 * **A submission after a withdrawal clears the withdrawal**, because a
 * candidate answering again is un-withdrawing; the earlier versions stay where
 * they are.
 */
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
