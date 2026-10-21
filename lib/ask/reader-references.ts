import { normalizeName } from "../routing/exact-name.ts";
import { readerOfficialsQuestion } from "./reader-officials.ts";
import { moneyQuestionShape } from "./money-answer.ts";
import { ballotQuestionShape } from "./ballot-summary.ts";
import { composeSelectedBallots } from "./ballot-only-answer.ts";
import type { BallotForDivisions } from "./server-sources.ts";
import { overLengthBudget } from "./length-contract.ts";
import type { EvidenceRecord } from "./evidence.ts";

/** Relative offices are resolved from the reader's divisions, just like "who represents me". */
export function readerMoneyReference(question: string) {
  const money = moneyQuestionShape(question);
  if (!money || money.otherSlot || money.raceWords || !/^(?:my|our) /.test(money.slot)) return null;
  const office = readerOfficialsQuestion(`Who is ${money.slot}?`);
  return office ? { money, office } : null;
}

/** Preserve both the candidate-field request and the topic; neither clause is dropped. */
export function readerContestReference(question: string) {
  const normalized = normalizeName(question);
  const match = /^who (?:is|s|are) running for (?:my|our) (.+?) and what (?:do|does) they (?:say|think) (?:about|on) (.+)$/.exec(normalized);
  if (!match || /\b(?:and|or|but)\b/.test(match[2])) return null;
  const office = ballotQuestionShape(`Who is running for ${match[1]}?`);
  return office?.kind === "OFFICE" ? { office, topic: match[2] } : null;
}

/** A singular ballot reference requires a single held measure, otherwise a choice. */
export function readerMeasureReference(question: string): boolean {
  return /^what does (?:the|this|that) (?:measure|proposition|question) on (?:my|our) ballot (?:actually )?(?:do|mean)(?: and what (?:does|would) (?:a )?(?:yes|no) vote mean)?$/.test(normalizeName(question));
}

/** Keep a verified candidate field when the separate statements are not held. */
export function composeMissingContestStatements(reference: NonNullable<ReturnType<typeof readerContestReference>>, ballot: BallotForDivisions) {
  const field = composeSelectedBallots(ballot, reference.office);
  if (!field) return null;
  const answer = `${field.answer} We don't have their statements about ${reference.topic} yet.`;
  return overLengthBudget(answer) ? null : { answer, citedUrls: field.citedUrls, missingAnswer: true };
}

export function composeMissingReaderFunding(reference: NonNullable<ReturnType<typeof readerMoneyReference>>, person: { id: string; name: string }, records: readonly EvidenceRecord[]) {
  if (reference.money.ask.kind !== "WHO_GAVE" || records.some(record =>
    ["FINANCE_SUMMARY", "FINANCE_TRANSACTION", "FINANCE_COMMITTEE"].includes(record.kind))) return null;
  return { answer: `We don't have ${person.name}'s campaign funding sources yet.`, citedUrls: [], missingAnswer: true };
}
