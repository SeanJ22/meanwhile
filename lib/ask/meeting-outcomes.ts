import { loadedFrom, outcomeEvidenceFor, outcomeGapWhose, sittingsForBody } from "../outcomes/store.ts";
import { outcomeQuestionClass } from "./outcome-question.ts";
import type { EvidenceGap, EvidenceRecord } from "./evidence.ts";

/** The same exact body/sitting query serves current-calendar and older held outcomes. */
export function meetingOutcomeEvidenceFor(input: { bodyId: string; meetingId: string; startsAt: string; question: string }) {
  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const denominators: Record<string, number> = {};
  const questionClass = outcomeQuestionClass(input.question);
  if (!questionClass) return { records, gaps, denominators };
  if (loadedFrom() === "EMPTY_STORE") return { records, gaps: [{ whose: "OURS" as const, statement: "The held meeting outcome records could not be read for this answer. This is a holding failure, not evidence that the body recorded no actions or votes." }], denominators: { outcomeLoaderFailures: 1 } };
  const evidence = outcomeEvidenceFor({ bodyId: input.bodyId, meetingId: input.meetingId, questionClass });
  const sitting = sittingsForBody(input.bodyId).find((row) => row.meetingId === input.meetingId);
  const titles = new Map((sitting?.agenda ?? []).map((record) => [record.eventItemId, record.title]));
  const questionTokens = [...new Set(input.question.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 5))];
  const rolls = evidence.records.filter((record) => record.recordClass === "ROLL_CALL");
  const ranked = rolls.map((rec, index) => ({ rec, index, votes: rec.votes.filter((vote) => vote.personName && vote.value), named: questionTokens.filter((term) => (titles.get(rec.eventItemId) ?? "").toLowerCase().includes(term)).length >= 2, divided: new Set(rec.votes.map((vote) => vote.value)).size > 1 }))
    .filter((row) => row.votes.length).sort((a, b) => Number(b.named) - Number(a.named) || Number(b.divided) - Number(a.divided) || a.index - b.index);
  for (const { rec, votes } of ranked) for (const vote of votes) {
    const title = titles.get(rec.eventItemId);
    records.push({ kind: "MEETING_MEMBER_VOTE", id: `${rec.eventItemId}#${vote.personId ?? vote.personName}`, bodyId: input.bodyId, text: title ? `On "${title}", ${vote.personName} voted ${vote.value}.` : `${vote.personName} voted ${vote.value}.`, occurredAt: input.startsAt, sourceUrl: rec.provenance.endpoint, sourceOrg: rec.provenance.sourceOrg, retrievedAt: rec.provenance.readOn === "NEVER_READ" ? null : rec.provenance.readOn });
  }
  for (const rec of evidence.records) if (rec.recordClass === "ACTION_SUMMARY") {
    const parts = [rec.action ? `The board's recorded action was "${rec.action}".` : null, rec.mover ? `Moved by ${rec.mover}${rec.seconder ? `, seconded by ${rec.seconder}` : ""}.` : null, rec.tallyText ? `The clerk recorded: "${rec.tallyText}"` : null, rec.rollCall === "OUTCOME_WITHOUT_ROLL_CALL" ? "No per-member roll call was published for this item." : null].filter(Boolean);
    records.push({ kind: "MEETING_ACTION", id: `${rec.eventItemId}#action`, bodyId: input.bodyId, text: `${rec.matterFile ? `${rec.matterFile}: ` : ""}${parts.join(" ")}`, occurredAt: input.startsAt, sourceUrl: rec.provenance.endpoint, sourceOrg: rec.provenance.sourceOrg, retrievedAt: rec.provenance.readOn === "NEVER_READ" ? null : rec.provenance.readOn });
  }
  denominators.outcomeRecordsForThatMeeting = evidence.records.length;
  denominators.outcomeRecordClassesRefused = evidence.refused.length;
  denominators.personVotesHeldForThatMeeting = rolls.reduce((n, roll) => n + roll.votes.length, 0);
  denominators.personVoteRowsInPack = records.filter((record) => record.kind === "MEETING_MEMBER_VOTE").length;
  denominators.rollCallItemsHeldForThatMeeting = rolls.length;
  denominators.rollCallItemsInPack = ranked.length;
  if (evidence.gap) gaps.push({ whose: outcomeGapWhose(evidence.state), statement: evidence.gap });
  return { records, gaps, denominators };
}

/** The source persists an ISO instant with its published offset; do not invent a zone. */
export function outcomeSittingsOnDate(bodyId: string, date: string) {
  return sittingsForBody(bodyId).filter((sitting) => sitting.startsAt && /^\d{4}-\d{2}-\d{2}T.*[+-]\d{2}:\d{2}$/.test(sitting.startsAt) && Number.isFinite(Date.parse(sitting.startsAt)) && sitting.startsAt.slice(0, 10) === date);
}
