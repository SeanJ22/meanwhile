import type { EvidencePack } from "./evidence.ts";

export function asksForPersonalStance(question: string): boolean {
  const pageQuestion = /\b(?:page|site|website|document|article)\s+(?:say|says|said|read|reads|contain|contains)\b/i.test(question);
  const personalClaim = /\b(?:believ(?:e|es|ed)|think|thinks|thought|support(?:s|ed|ing)?|oppos(?:e|es|ed|ing)|stance|positions?|views?)\b/i.test(question);
  if (pageQuestion && !personalClaim) return false;
  return /\b(?:say|says|said|stated|believ(?:e|es|ed)|think|thinks|thought|support(?:s|ed|ing)?|oppos(?:e|es|ed|ing)|stance|positions?|views?)\b/i.test(question);
}

export function stanceAnswerability(pack: Pick<EvidencePack, "subject" | "question">): "UNVERIFIED_PERSONAL_STANCE" | "NOT_APPLICABLE" {
  return pack.subject?.kind === "PERSON" && asksForPersonalStance(pack.question)
    ? "UNVERIFIED_PERSONAL_STANCE" : "NOT_APPLICABLE";
}
