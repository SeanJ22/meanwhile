import { normalizeName } from "../routing/exact-name.ts";
import type { QuestionClass } from "../answerability/record-class.ts";

/**
 * Is the reader asking what was scheduled, or what happened? An agenda proves
 * only what was noticed, so an outcome question must not be answered from it
 * (`lib/answerability/record-class.ts`). This fires only on wording that can
 * only be about an outcome and returns null otherwise, including for the
 * ambiguous "what was the last meeting about?".
 */

/**
 * Wording that asks how each member voted. Checked before the decision phrases
 * because it is narrower: a roll-call question is never answered from a tally.
 */
const ROLL_CALL_PHRASES: readonly RegExp[] = [
  /\bhow did (?:\w+ ){0,8}vote\b/,
  /\bwho voted (?:for|against|yes|no|in favor)\b/,
  /\bhow did (?:\w+ ){0,8}(?:supervisors?|members?|councill?ors?|board) vote\b/,
  /\broll call\b/,
  /\bvote breakdown\b/,
  /\bwas it unanimous\b/,
  /\bvoted (?:for|against) it\b/,
];

/** Wording that asks what the body decided: the action, not the roll call. */
const DECISION_PHRASES: readonly RegExp[] = [
  /\bwhat did (?:\w+ ){0,8}decide\b/,
  /\bwhat was decided\b/,
  /\bdid (?:\w+ ){0,8}vote\b/,
  /\bdid (?:\w+ ){0,8}(?:approve|reject|adopt|pass|deny|authorize|award)\b/,
  /\bwas it (?:approved|rejected|adopted|passed|denied|defeated)\b/,
  /\bdid it pass\b/,
  /\bwhat (?:was|were) the (?:outcome|result|results|decision)\b/,
  /\bwhat action did (?:\w+ ){0,8}take\b/,
  /\bhave they (?:approved|decided|voted)\b/,
  /\bdid they (?:end up|actually)\b/,
];

/** The question class, where the wording settles it. Null means "not settled here", never "not an outcome question". */
export function outcomeQuestionClass(question: string): QuestionClass | null {
  const normalized = normalizeName(question);
  if (ROLL_CALL_PHRASES.some((p) => p.test(normalized))) return "HOW_DID_THEY_VOTE";
  if (DECISION_PHRASES.some((p) => p.test(normalized))) return "WHAT_WAS_DECIDED";
  return null;
}

/**
 * The gap for an outcome question we hold no outcome record for: OURS, naming
 * the record class that would answer it, never a claim the government did not
 * publish.
 */
export function outcomeGapStatement(
  subjectName: string,
  questionClass: QuestionClass,
  holdsAgenda: boolean,
): string {
  const wanted =
    questionClass === "HOW_DID_THEY_VOTE"
      ? "a roll call recording how each member voted"
      : "minutes or an action summary recording what was decided";
  const held = holdsAgenda
    ? `We hold the agenda for that ${subjectName} meeting, which is what was scheduled to be taken up — not what was settled. `
    : "";
  return (
    `${held}We have not recorded ${wanted} for that sitting, so anything here describes what was ` +
    `on the agenda rather than what the board did with it.`
  );
}
