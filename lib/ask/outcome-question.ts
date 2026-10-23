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
