import { isMinutesRouteSitting, loadedFrom, outcomeEvidenceFor, outcomeGapWhose, sittingsForBody } from "../outcomes/store.ts";
import { outcomeQuestionClass } from "./outcome-question.ts";
import type { EvidenceGap, EvidenceRecord } from "./evidence.ts";
import type { QuestionClass } from "../answerability/record-class.ts";
import type { LegistarOutcomeRecord } from "../sources/legistar/outcomes.ts";
import type { PersistedSittingOutcomes } from "../outcomes/types.ts";

/**
 * A record read off a sitting's minutes is answered in the minutes' own words:
 * the item as printed, the exact passage, and where the document stands.
 * Action minutes are never presented as the approved record.
 */
function minutesActionText(rec: LegistarOutcomeRecord, sitting: PersistedSittingOutcomes | undefined): string {
  const section = rec.sectionQuote ? ` (under "${rec.sectionQuote}")` : "";
  const item = rec.itemReference ? `Item ${rec.itemReference}${section}${rec.itemQuote ? `, "${rec.itemQuote}"` : ""}: the` : "The";
  const where = rec.page ? ` (page ${rec.page})` : "";
  const standing = sitting?.minutesDocument ? ` ${sitting.minutesDocument.approval.detail}` : "";
  return `${item} minutes${where} record "${rec.quote}".${standing}`;
}

/** Agenda wording requests noticed items; decision/vote wording stays stricter. */
export function meetingRecordQuestionClass(question: string): QuestionClass | null {
  return outcomeQuestionClass(question) ?? (/\b(?:agenda|agendas|docket|noticed)\b/i.test(question) ? "WHAT_WAS_NOTICED" : null);
}

/**
 * One recorded action as a composed "what did they decide" answer reads it.
 * Every string field is a verbatim span of the `MEETING_ACTION` record's
 * `text` (re-checked by `lib/ask/sitting-answer.ts`); `disposition`, `divided`
 * and `consent` only order actions and are never printed. Travels beside the
 * records, never inside them.
 */
export interface HeldMeetingAction {
  /** The `MEETING_ACTION` record; minutes-local item IDs also name their sitting. */
  recordId: string;
  meetingId: string;
  /** Where the action was read: the publisher's structured record, or the sitting's minutes. */
  source: "PUBLISHER_RECORD" | "MINUTES";
  /** The item as the publisher titles it, or as the minutes print it. */
  item: string | null;
  /** The minutes' own item number(s), "5-c". */
  itemReference: string | null;
  matterFile: string | null;
  /** The clerk's verb ("approve") or the minutes' motion ("that Resolution No. 12559 be adopted"). */
  motion: string | null;
  /** The publisher's own result words ("Pass"; "Carried unanimously."), or null when none is recorded. */
  result: string | null;
  /** STATED: `result` is the publisher's words. ABSENT: none recorded. CONTRADICTORY: the record's two result fields disagree. */
  resultState: "STATED" | "ABSENT" | "CONTRADICTORY";
  /** The minutes' standing when it is not the approved record, in the record's own words. */
  standing: string | null;
  consent: boolean;
  /** For ordering only: the store's reading of the result. */
  disposition: LegistarOutcomeRecord["disposition"];
  /** For ordering only: the item's per-member roll call records more than one value. */
  divided: boolean;
}

/** The same exact body/sitting query serves current-calendar and older held outcomes. */
export function meetingOutcomeEvidenceFor(input: { bodyId: string; meetingId: string; startsAt: string; question: string }) {
  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const denominators: Record<string, number> = {};
  const actions: HeldMeetingAction[] = [];
  const questionClass = meetingRecordQuestionClass(input.question);
  if (!questionClass) return { records, gaps, denominators, actions };
  if (loadedFrom() === "EMPTY_STORE") return { records, gaps: [{ whose: "OURS" as const, statement: "The held structured meeting records could not be read for this answer. This is a holding failure, not evidence that the body published no agenda, actions or votes." }], denominators: { outcomeLoaderFailures: 1 }, actions };
  const evidence = outcomeEvidenceFor({ bodyId: input.bodyId, meetingId: input.meetingId, questionClass });
  // The ordinary document/notice selector answers agenda availability when
  // this separate structured source has no sitting. Its outcome-store absence
  // must not become a claim that an already held document has no agenda.
  if (questionClass === "WHAT_WAS_NOTICED" && evidence.state === "NO_SITTING_HELD") return { records, gaps, denominators, actions };
  // A minutes-read sitting holds decisions, never agenda items: its agenda is
  // answered by the meeting's own agenda document, exactly as for a sitting
  // this store does not hold.
  if (questionClass === "WHAT_WAS_NOTICED" && evidence.sittings.length > 0 && evidence.sittings.every(isMinutesRouteSitting)) return { records, gaps, denominators, actions };
  const sitting = sittingsForBody(input.bodyId).find((row) => row.meetingId === input.meetingId);
  const titles = new Map((sitting?.agenda ?? []).map((record) => [record.eventItemId, record.title]));
  for (const rec of evidence.records) if (rec.recordClass === "AGENDA") {
    records.push({ kind: "AGENDA_ITEM", id: `${rec.eventItemId}#agenda`, bodyId: input.bodyId, meetingId: input.meetingId, text: rec.title, occurredAt: input.startsAt, sourceUrl: rec.provenance.endpoint, sourceOrg: rec.provenance.sourceOrg, retrievedAt: rec.provenance.readOn === "NEVER_READ" ? null : rec.provenance.readOn });
  }
  const questionTokens = [...new Set(input.question.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 5))];
  const rolls = evidence.records.filter((record) => record.recordClass === "ROLL_CALL");
  const ranked = rolls.map((rec, index) => ({ rec, index, votes: rec.votes.filter((vote) => vote.personName && vote.value), named: questionTokens.filter((term) => (titles.get(rec.eventItemId) ?? "").toLowerCase().includes(term)).length >= 2, divided: new Set(rec.votes.map((vote) => vote.value)).size > 1 }))
    .filter((row) => row.votes.length).sort((a, b) => Number(b.named) - Number(a.named) || Number(b.divided) - Number(a.divided) || a.index - b.index);
  for (const { rec, votes } of ranked) for (const vote of votes) {
    const title = titles.get(rec.eventItemId);
    records.push({ kind: "MEETING_MEMBER_VOTE", id: `${rec.eventItemId}#${vote.personId ?? vote.personName}`, bodyId: input.bodyId, text: title ? `On "${title}", ${vote.personName} voted ${vote.value}.` : `${vote.personName} voted ${vote.value}.`, occurredAt: input.startsAt, sourceUrl: rec.provenance.endpoint, sourceOrg: rec.provenance.sourceOrg, retrievedAt: rec.provenance.readOn === "NEVER_READ" ? null : rec.provenance.readOn });
  }
  const dividedItems = new Set(ranked.filter((row) => row.divided).map((row) => row.rec.eventItemId));
  for (const rec of evidence.records) if (rec.recordClass === "ACTION_SUMMARY") {
    // Parsed minutes number their items locally. Two same-day sittings can
    // both have item 1; preserve both records with distinct sitting identity.
    const recordId = rec.quote ? `${input.meetingId}#${rec.eventItemId}#action` : `${rec.eventItemId}#action`;
    const file = rec.matterFile ? `${rec.matterFile}: ` : "";
    if (rec.quote) {
      /* Read off the minutes: the motion and its result are spans of the quoted
         passage. A result the parser could not read is said, in the store's words. */
      const standing = sitting?.minutesDocument && sitting.minutesDocument.approval.state !== "APPROVED"
        ? sitting.minutesDocument.approval.detail.split(" The council has since approved")[0]!
        : null;
      records.push({ kind: "MEETING_ACTION", id: recordId, bodyId: input.bodyId, text: `${file}${minutesActionText(rec, sitting)}${rec.dispositionGap ? ` ${rec.dispositionGap}` : ""}`, occurredAt: input.startsAt, sourceUrl: rec.provenance.endpoint, sourceOrg: rec.provenance.sourceOrg, retrievedAt: rec.provenance.readOn === "NEVER_READ" ? null : rec.provenance.readOn });
      actions.push({ recordId, meetingId: input.meetingId, source: "MINUTES", item: rec.itemQuote ?? null, itemReference: rec.itemReference ?? null, matterFile: rec.matterFile, motion: rec.action, result: rec.dispositionRaw, resultState: rec.dispositionRaw ? "STATED" : "ABSENT", standing, consent: rec.onConsentCalendar, disposition: rec.disposition, divided: false });
      continue;
    }
    /*
     * The publisher's structured record: the item's title and the pass/fail word
     * travel in the text, unmapped. Disagreeing result fields say so; no result
     * says so in the store's sentence. None is read as a defeat.
     */
    const title = titles.get(rec.eventItemId) ?? null;
    const resultState = rec.dispositionConflict ? "CONTRADICTORY" as const : rec.dispositionRaw ? "STATED" as const : "ABSENT" as const;
    const parts = [
      rec.action ? `${title ? `On "${title}", the` : "The"} board's recorded action was "${rec.action}".` : title ? `On "${title}":` : null,
      resultState === "STATED" ? `The published result was "${rec.dispositionRaw}".`
        : resultState === "CONTRADICTORY" ? `The published result contradicts itself: ${rec.dispositionConflict}`
          : rec.dispositionGap ?? "The published record carries no pass or fail result for this item.",
      rec.mover ? `Moved by ${rec.mover}${rec.seconder ? `, seconded by ${rec.seconder}` : ""}.` : null,
      rec.tallyText ? `The clerk recorded: "${rec.tallyText}"` : null,
      rec.rollCall === "OUTCOME_WITHOUT_ROLL_CALL" ? "No per-member roll call was published for this item." : null,
    ].filter(Boolean);
    records.push({ kind: "MEETING_ACTION", id: recordId, bodyId: input.bodyId, text: `${file}${parts.join(" ")}`, occurredAt: input.startsAt, sourceUrl: rec.provenance.endpoint, sourceOrg: rec.provenance.sourceOrg, retrievedAt: rec.provenance.readOn === "NEVER_READ" ? null : rec.provenance.readOn });
    actions.push({ recordId, meetingId: input.meetingId, source: "PUBLISHER_RECORD", item: title, itemReference: null, matterFile: rec.matterFile, motion: rec.action, result: resultState === "STATED" ? rec.dispositionRaw : null, resultState, standing: null, consent: rec.onConsentCalendar, disposition: rec.disposition, divided: dividedItems.has(rec.eventItemId) });
  }
  denominators.outcomeRecordsForThatMeeting = evidence.records.length;
  denominators.structuredAgendaItemsForThatMeeting = records.filter((record) => record.kind === "AGENDA_ITEM").length;
  denominators.outcomeRecordClassesRefused = evidence.refused.length;
  denominators.personVotesHeldForThatMeeting = rolls.reduce((n, roll) => n + roll.votes.length, 0);
  denominators.personVoteRowsInPack = records.filter((record) => record.kind === "MEETING_MEMBER_VOTE").length;
  denominators.rollCallItemsHeldForThatMeeting = rolls.length;
  denominators.rollCallItemsInPack = ranked.length;
  if (evidence.gap) gaps.push({ whose: outcomeGapWhose(evidence.state), statement: evidence.gap });
  return { records, gaps, denominators, actions };
}

/** The source persists an ISO instant with its published offset; do not invent a zone. */
export function outcomeSittingsOnDate(bodyId: string, date: string) {
  return sittingsForBody(bodyId).filter((sitting) => sitting.startsAt && /^\d{4}-\d{2}-\d{2}T.*[+-]\d{2}:\d{2}$/.test(sitting.startsAt) && Number.isFinite(Date.parse(sitting.startsAt)) && sitting.startsAt.slice(0, 10) === date);
}
