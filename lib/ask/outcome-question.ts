import { normalizeName } from "../routing/exact-name.ts";
import type { QuestionClass } from "../answerability/record-class.ts";

/**
 * **IS THE READER ASKING WHAT WAS SCHEDULED, OR WHAT ACTUALLY HAPPENED?**
 * (2026-08-29, the exact-body-identity and answerability session.)
 *
 * ## The defect this closes
 *
 * Asked in production, against the real handler:
 *
 * > *"Did the Pima County Board of Supervisors vote on the budget?"*
 * > *"How did the Pima County Board of Supervisors vote last time?"*
 * > *"What did the Pima County Board of Supervisors decide at its last meeting?"*
 *
 * All three came back with `AGENDA_ITEM` records and **zero gaps**. The
 * evidence pack handed a synthesis model a list of things that were PUT ON AN
 * AGENDA and asked it a question about a DECISION, with nothing anywhere in the
 * pack saying that no outcome record was held. The most likely sentence out of
 * that pack is a confident, well-sourced account of a vote that this product
 * has no record of.
 *
 * ## Why an agenda cannot stand in, ever
 *
 * An agenda proves what was NOTICED. It is written before the meeting. Items
 * are continued, withdrawn, tabled, pulled from consent, amended and voted down,
 * and **not one of those outcomes changes the agenda**. A body can notice
 * twenty items and act on three. Reading a decision off an agenda is not a
 * degraded answer, it is a fabricated one — and it is fabricated from a real
 * document, which is what makes it survive a skim.
 *
 * `lib/answerability/record-class.ts` already holds the rule that an `AGENDA`
 * does not answer `WHAT_WAS_DECIDED` or `HOW_DID_THEY_VOTE`. What it could not
 * do — and says so in its own doc block — is decide WHICH question a reader
 * asked, because *"what happened at the last meeting"* is genuinely ambiguous
 * between the two. It says that ambiguity has to be resolved at the
 * interpretation rung rather than papered over. This is that rung.
 *
 * ## What it deliberately does not do
 *
 * It does not claim to classify every question. It fires only on wording that
 * can ONLY be about an outcome, and returns `null` for everything else —
 * including the genuinely ambiguous *"what was the last meeting about?"*, which
 * the agenda answers honestly as *what was on the agenda* and which is left
 * alone.
 *
 * That asymmetry is the safe direction. A missed outcome question yields the
 * pre-existing behaviour; a false positive would attach a "we hold no outcome
 * record" gap to a question that never asked for one, which is noise on a
 * correct answer. Neither is good, and only one of them is a false claim about
 * a government, so the detector is written to avoid that one.
 */

/**
 * Wording that asks HOW EACH MEMBER VOTED. The strongest civic record there is,
 * and the one an agenda is furthest from being able to answer.
 *
 * Kept ahead of the decision phrases because it is strictly narrower: *"how did
 * they vote"* is a roll-call question, and answering it from a tally — let
 * alone from an agenda — would state a named person's position on a record that
 * never carried one.
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

/**
 * Wording that asks WHAT THE BODY DECIDED — the action, not the roll call.
 *
 * `\bdid (?:\w+ ){0,8}vote\b` is the one that matters most in practice, because
 * *"did they vote on the budget?"* is how a person actually asks, and it was
 * being answered from the budget's appearance on an agenda.
 */
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

/**
 * The question class this reader asked, where the wording settles it.
 *
 * `null` means *not settled here* and never *not an outcome question*: the
 * caller keeps its existing behaviour rather than treating null as a verdict.
 */
export function outcomeQuestionClass(question: string): QuestionClass | null {
  const normalized = normalizeName(question);
  if (ROLL_CALL_PHRASES.some((p) => p.test(normalized))) return "HOW_DID_THEY_VOTE";
  if (DECISION_PHRASES.some((p) => p.test(normalized))) return "WHAT_WAS_DECIDED";
  return null;
}

/**
 * The gap sentence for an outcome question we hold no outcome record for.
 *
 * **`OURS`, and that is a decision rather than a default.** We do not know
 * whether this government publishes minutes; we know that WE have not recorded
 * any. Saying "the county has not published what it decided" would be a claim
 * about a government made out of our own collection state, which is the render
 * default the constitution forbids. So the sentence is about us, and it names
 * the record class that would answer the question — because a reader who is
 * told what is missing can go and look for it.
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
