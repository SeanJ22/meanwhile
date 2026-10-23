import type { Officeholder, OfficeholderSet } from "./types.ts";
import type { ReaderOfficialAction, ReaderOfficialActions } from "./reader-actions.ts";
import type { SourcedExecutiveRecord } from "../sources/white-house/presidential-records.ts";
import type { RollCallVote, VotePosition } from "../votes/types.ts";
import { readNationalPresident } from "../reader/national.ts";
import { whiteHouseOffice } from "./white-house-offices.ts";

export interface NationalExecutiveRecordReaders {
  readonly roster: () => Promise<OfficeholderSet | null>;
}
const resident: NationalExecutiveRecordReaders = { roster: readNationalPresident };
const country = "ocd-division/country:us";
function currentPerson(subject: string, roster: OfficeholderSet | null): Officeholder | null {
  if (!/^white-house:[a-z0-9-]+$/.test(subject) || !roster) return null;
  const matches = roster.officeholders.filter(person => person.id === subject && whiteHouseOffice(person.officeTitle) && roster.divisions.some(link => link.officeholderId === person.id && link.ocdId === country &&
    person.memberships?.some(membership => membership.current === true && membership.divisionId === country && (!link.membershipId || membership.id === link.membershipId) && whiteHouseOffice(membership.officeTitle ?? person.officeTitle) === whiteHouseOffice(person.officeTitle))));
  return matches.length === 1 ? matches[0] : null;
}
const heldSource = (row: { sourceUrl: string; collectedAt: string; date: string }): boolean => {
  try { return new URL(row.sourceUrl).protocol === "https:" && Number.isFinite(Date.parse(row.collectedAt)) && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(Date.parse(row.date)); } catch { return false; }
};
const ownsRecord = (person: Officeholder, row: SourcedExecutiveRecord): boolean =>
  (row.personId === person.id || Boolean(person.personId && row.personId === person.personId)) && heldSource(row) && /^\d{4}-\d{2}-\d{2}$/.test(person.termStart) && row.date >= person.termStart && (!/^\d{4}-\d{2}-\d{2}$/.test(person.termEnd) || row.date < person.termEnd);
const sourceOrg = (sourceUrl: string): string => {
  const host = new URL(sourceUrl).hostname;
  return host === "www.federalregister.gov" ? "Federal Register" : host === "www.congress.gov" || host === "api.congress.gov" ? "Congress.gov" : host === "www.senate.gov" ? "United States Senate" : host;
};
function actionRecord(person: Officeholder, row: SourcedExecutiveRecord): ReaderOfficialAction | null {
  if (row.kind === "TIE_BREAKING_VOTE") return null;
  const label = row.kind === "EXECUTIVE_ORDER" ? "Executive order" : row.kind === "PROCLAMATION" ? "Proclamation" : row.kind === "MEMORANDUM" ? "Presidential memorandum" : null;
  const designation = row.details.designation ? ` ${row.details.designation}` : "";
  return { id: row.id, officialId: person.id, kind: row.kind,
    text: label ? `${label}${designation}: ${row.title} (${row.date}).` : `${row.title} (${row.date}).`,
    sourceUrl: row.sourceUrl, documentUrl: row.details.documentUrl ?? null, sourceOrg: sourceOrg(row.sourceUrl), collectedAt: row.collectedAt };
}

/** Existing official cards consume this same action shape. A Cabinet department's
 * acts are named as the department's, rather than attributed as personal signatures. */
export function nationalExecutiveActions(subjectId: string, roster: OfficeholderSet | null): ReaderOfficialActions {
  const person = currentPerson(subjectId, roster);
  const answer: ReaderOfficialActions = { subjectId, officialIds: person ? [person.id] : [], resolvedTargetId: person?.id ?? null,
    status: !roster ? "NOT_HELD" : person ? "NOT_HELD" : "IDENTITY_UNRESOLVED", withheldRecords: [], count: 0, records: [] };
  if (!person) return answer;
  const records = new Map<string, ReaderOfficialAction>(), dates = new Map<string, string>();
  for (const row of person.executive?.records ?? []) {
    if (row.kind === "TIE_BREAKING_VOTE") continue;
    if (!ownsRecord(person, row)) { answer.withheldRecords.push({ id: row.id, reason: "This action is not bound to the current person and term with a checked source" }); continue; }
    const record = actionRecord(person, row);
    if (record) { records.set(record.id, record); dates.set(record.id, row.date); }
  }
  const department = person.executive?.cabinet?.department;
  if (department && whiteHouseOffice(person.officeTitle)?.startsWith("cabinet:")) for (const row of department.actions) {
    if (!heldSource(row)) { answer.withheldRecords.push({ id: row.id, reason: "This department action has no checked source and date" }); continue; }
    records.set(row.id, { id: row.id, officialId: person.id, kind: "DEPARTMENT_ACTION",
      text: `${department.name}: ${row.title} (${row.kind}; ${row.date}).`,
      sourceUrl: row.sourceUrl, documentUrl: row.documentUrl, sourceOrg: "Federal Register", collectedAt: row.collectedAt });
    dates.set(row.id, row.date);
  }
  answer.records = [...records.values()].sort((a, b) => dates.get(b.id)!.localeCompare(dates.get(a.id)!) || a.id.localeCompare(b.id));
  answer.count = answer.records.length;
  answer.status = answer.count ? "RESOLVED" : "NOT_HELD";
  return answer;
}

export interface NationalExecutiveVote extends Pick<RollCallVote, "id" | "date" | "title" | "titleSource" | "question" | "legisNum" | "result" | "billUrl" | "rollCallUrl" | "retrievedAt"> {
  readonly position: VotePosition;
  readonly sourceOrg: string;
  readonly partyBreakdown: null;
  readonly billSummary: null;
  readonly billSummaryPending: false;
}
export interface NationalExecutiveVotes {
  readonly member: string;
  readonly holdingStatus: "HELD" | "NOT_HELD" | "IDENTITY_UNRESOLVED";
  readonly count: number;
  readonly generatedAt: string | null;
  readonly chamber: "senate" | null;
  readonly votes: readonly NationalExecutiveVote[];
  readonly keyVotes: readonly never[];
  readonly pickedKeyVotes: readonly never[];
}
/** VP positions use the existing congressional roll-call response fields. */
export function nationalExecutiveVotes(member: string, roster: OfficeholderSet | null): NationalExecutiveVotes {
  const person = currentPerson(member, roster), vice = person && whiteHouseOffice(person.officeTitle) === "vice-president";
  const votes = new Map<string, NationalExecutiveVote>();
  if (vice) for (const row of person.executive?.records ?? []) {
    if (row.kind !== "TIE_BREAKING_VOTE" || !ownsRecord(person, row) || !["Yea", "Nay"].includes(row.details.vote ?? "")) continue;
    const tally = Number.isSafeInteger(row.details.yeas) && Number.isSafeInteger(row.details.nays) ? ` (${row.details.yeas}–${row.details.nays})` : "";
    votes.set(row.id, { id: row.id, date: row.date, title: row.title, titleSource: "CHAMBER_QUESTION", question: "Vice President's tie-breaking vote",
      legisNum: null, result: `${row.details.result ?? row.quote}${tally}`, billUrl: null, rollCallUrl: row.sourceUrl,
      retrievedAt: row.collectedAt, position: row.details.vote === "Yea" ? "YES" : "NO", sourceOrg: "United States Senate", partyBreakdown: null, billSummary: null, billSummaryPending: false });
  }
  const ordered = [...votes.values()].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { member, holdingStatus: !roster ? "NOT_HELD" : person ? "HELD" : "IDENTITY_UNRESOLVED", count: ordered.length,
    generatedAt: roster?.generatedAt ?? null, chamber: vice ? "senate" : null, votes: ordered, keyVotes: [], pickedKeyVotes: [] };
}

export async function readNationalExecutiveActions(subject: string, readers: NationalExecutiveRecordReaders = resident): Promise<Response> {
  try { return Response.json(nationalExecutiveActions(subject, await readers.roster())); }
  catch { return Response.json({ error: "National executive action records are temporarily unavailable", holdingStatus: "HOLDING_UNAVAILABLE", unavailableAuthorities: ["NATIONAL_EXECUTIVES"] }, { status: 503 }); }
}
export async function readNationalExecutiveVotes(member: string, historical = false, readers: NationalExecutiveRecordReaders = resident): Promise<Response> {
  try {
    const roster = await readers.roster();
    if (historical) {
      const person = currentPerson(member, roster), complete = whiteHouseOffice(person?.officeTitle) === "vice-president" && person?.executive?.coverage?.tieBreakingVotes === true;
      return Response.json({ member, historyStatus: complete ? "COMPLETE" : "UNAVAILABLE", historicalVotes: [], historicalCount: 0, nextHistoricalVersionId: null,
        ...(!complete ? { historyIssue: "Earlier tie-breaking votes have not been acquired." } : {}) });
    }
    return Response.json(nationalExecutiveVotes(member, roster));
  } catch { return Response.json({ member, generatedAt: null, holdingStatus: "HOLDING_UNAVAILABLE", votes: [] }, { status: 503 }); }
}
