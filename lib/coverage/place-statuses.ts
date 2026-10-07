import { LIFECYCLE, NO_PRODUCER_REASON, applicabilityOf, checklistItem, hasProducer } from "./checklist-map.ts";

/**
 * The six statuses of one owed blank: applies, due, found, published by the
 * government, freshness, and reader visibility, each from data already held.
 * `state` stays beside them as the old blended field. Pure.
 */
export type AppliesStatus = "applies" | "depends" | "unresolved";
export type DueStatus = "due" | "not-yet-due" | "unresolved";
/** "attempted" says what we did, never what the government has: a try with nothing held yet. */
export type FoundStatus = "found" | "checked-not-posted" | "in-progress" | "attempted" | "nothing-yet";
export type PublishedStatus = "published" | "awaiting-publication" | "not-published" | "not-known";
export type FreshStatus = "fresh" | "refresh-due" | "not-captured";
export type SeenStatus = "seen" | "not-seen" | "not-checked";

export interface RowStatuses {
  readonly applies: AppliesStatus;
  readonly due: DueStatus;
  readonly found: FoundStatus;
  readonly published: PublishedStatus;
  readonly fresh: FreshStatus;
  readonly seen: SeenStatus;
  /** When the next check is due, for a blank that is awaiting publication or due for a refresh. */
  readonly nextCheck: string | null;
  /** The plain sentence for an item awaiting publication, e.g. "Agenda not published yet". Null otherwise. */
  readonly waitingWords: string | null;
  /** Whether any squad or door can fill this item today. */
  readonly hasProducer: boolean;
  /** Why an uncaptured item is not being hunted: "No squad or door covers this item yet". Null when it has a producer or is captured. */
  readonly noProducerWords: string | null;
}

export interface StatusHeldField {
  readonly state: "published" | "held" | "unpublished";
  readonly checkedAt: string;
  readonly freshUntil: string;
  readonly workItemId?: string;
}

export interface StatusRow {
  readonly checklistId: string;
  readonly subject: { readonly id: string; readonly startsAt?: string };
  readonly held: readonly StatusHeldField[];
}

/** What the hunt is doing about a blank, from work items and attempts. Absent means no record, not "nothing to do". */
export interface HuntEvidence { readonly inProgress: boolean; readonly attempts: number }

export interface StatusContext {
  readonly now: string;
  readonly hunt?: (subjectId: string, checklistId: string) => HuntEvidence | null;
  /** The latest served-reader witness for a held work item. Others stay "not checked" until page witnesses are recorded. */
  readonly witness?: (workItemId: string) => "CONFIRMED" | "NOT_OBSERVED" | null;
}

const HOUR = 3_600_000;

function dueOf(row: StatusRow, now: number): DueStatus {
  const item = checklistItem(row.checklistId);
  if (!item) return "unresolved";
  if (item.lifecycle) {
    // The lifecycle rule: an agenda falls due shortly before its meeting, outcomes some days after it.
    const start = Date.parse(row.subject.startsAt ?? "");
    if (!Number.isFinite(start)) return "unresolved";
    const dueAt = item.lifecycle === "agenda" ? start - LIFECYCLE.agendaDueHoursBeforeMeeting * HOUR
      : start + LIFECYCLE.outcomeDueDaysAfterMeeting * 24 * HOUR;
    return now >= dueAt ? "due" : "not-yet-due";
  }
  if (item.due === "unknown") return "unresolved";
  // A meeting-level item is owed as soon as the meeting is known.
  if (item.due === "now" || item.due === "on-change" || item.due === "per-meeting") return "due";
  // Dates owed per election, session, filing period or fiscal year have no clock here; held evidence shows it is due.
  return row.held.length > 0 ? "due" : "unresolved";
}

export function rowStatuses(row: StatusRow, ctx: StatusContext): RowStatuses {
  const now = Date.parse(ctx.now);
  const item = checklistItem(row.checklistId);
  const kept = row.held.filter(f => f.state !== "unpublished");
  const absent = row.held.filter(f => f.state === "unpublished");
  const latest = <T extends StatusHeldField>(fields: readonly T[]) => [...fields].sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0] ?? null;
  const absence = latest(absent);
  const hunt = ctx.hunt?.(row.subject.id, row.checklistId) ?? null;
  const found: FoundStatus = kept.length ? "found" : absence ? "checked-not-posted"
    : hunt?.inProgress ? "in-progress" : hunt && hunt.attempts > 0 ? "attempted" : "nothing-yet";
  // A posting-deadline item that is reported not posted is awaiting publication, with a next check. Anything else the
  // government is verified not to publish.
  const awaiting = !kept.length && absence !== null && item?.lifecycle !== undefined;
  const published: PublishedStatus = kept.length ? "published" : awaiting ? "awaiting-publication"
    : absence ? "not-published" : "not-known";
  const fresh: FreshStatus = !row.held.length ? "not-captured"
    : row.held.some(f => Date.parse(f.freshUntil) >= now) ? "fresh" : "refresh-due";
  const witnessed = kept.map(f => (f.workItemId ? ctx.witness?.(f.workItemId) ?? null : null));
  const seen: SeenStatus = witnessed.includes("CONFIRMED") ? "seen" : witnessed.includes("NOT_OBSERVED") ? "not-seen" : "not-checked";
  const nextCheck = awaiting && absence ? absence.freshUntil
    : fresh === "refresh-due" ? latest(row.held)?.freshUntil ?? null : null;
  const noun = item?.noun;
  return { applies: applicabilityOf(row.checklistId) === "applies" ? "applies" : applicabilityOf(row.checklistId) === "unresolved" ? "unresolved" : "depends",
    due: dueOf(row, now), found, published, fresh, seen, nextCheck,
    waitingWords: awaiting && noun ? `${noun} not published yet` : null,
    hasProducer: hasProducer(row.checklistId),
    noProducerWords: !kept.length && !absence && !hasProducer(row.checklistId) ? NO_PRODUCER_REASON : null };
}
