import type { EvidencePack } from "./evidence.ts";

/** A source-page phrase hit identifies text, not its speaker or a person's belief. */
export function asksForPersonalStance(question: string): boolean {
  const pageQuestion = /\b(?:page|site|website|document|article)\s+(?:say|says|said|read|reads|contain|contains)\b/i.test(question);
  const personalClaim = /\b(?:believ(?:e|es|ed)|think|thinks|thought|support(?:s|ed|ing)?|oppos(?:e|es|ed|ing)|stance|positions?|views?)\b/i.test(question);
  if (pageQuestion && !personalClaim) return false;
  return /\b(?:say|says|said|stated|believ(?:e|es|ed)|think|thinks|thought|support(?:s|ed|ing)?|oppos(?:e|es|ed|ing)|stance|positions?|views?)\b/i.test(question);
}

/**
 * The current candidate-page and statement-snapshot readers prove only page
 * membership and exact text. None verifies that a named person spoke a passage
 * or adopted it as a position. A model must not turn those pages, or unrelated
 * filing and biography rows, into a personal stance answer.
 *
 * Recorded roll-call votes answer vote questions through their own evidence
 * path; this gate does not classify a question about how someone voted as a
 * broad position question.
 */
export function stanceAnswerability(pack: Pick<EvidencePack, "subject" | "question">): "UNVERIFIED_PERSONAL_STANCE" | "NOT_APPLICABLE" {
  return pack.subject?.kind === "PERSON" && asksForPersonalStance(pack.question)
    ? "UNVERIFIED_PERSONAL_STANCE" : "NOT_APPLICABLE";
}
