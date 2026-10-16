import type { Meeting } from "../sources/types.ts";
import type { SittingWindowSchedule } from "../civic-data/contracts.ts";

export const MEETING_DOCUMENT_TURN_URLS = 8;

export interface MeetingDocumentTarget {
  readonly url: string;
  readonly meeting: Meeting;
  readonly kind: "AGENDA" | "MINUTES" | "RESULTS";
  readonly publisherLabel?: string;
}

export interface MeetingDocumentCheck {
  readonly url: string;
  readonly contentHash?: string;
  readonly checkedAt: string | null;
  readonly attemptedAt: string | null;
  readonly nextDueAt: string;
  readonly outcome: "CHECKED" | "FAILED" | "DEFERRED";
}

export interface MeetingDocumentChecks {
  readonly documents: readonly MeetingDocumentCheck[];
  readonly calendarRetryAt?: string;
}

export function meetingDocumentChecksIssue(value: unknown, observedAt?: string): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || !Array.isArray((value as MeetingDocumentChecks).documents)) return "Meeting document checks are malformed.";
  const state = value as MeetingDocumentChecks, urls = new Set<string>();
  const instant = (at: unknown) => typeof at === "string" && Number.isFinite(Date.parse(at));
  if (state.calendarRetryAt !== undefined && !instant(state.calendarRetryAt)) return "The calendar retry time is invalid.";
  for (const check of state.documents) {
    if (!check || typeof check !== "object") return "A document check is malformed.";
    if (typeof check.url !== "string") return "A document check URL is invalid.";
    try { if (!["http:", "https:"].includes(new URL(check.url).protocol)) return "A document check URL is invalid."; }
    catch { return "A document check URL is invalid."; }
    if (check.contentHash !== undefined && !/^[a-f0-9]{64}$/.test(check.contentHash)) return "A document check hash is invalid.";
    if (urls.has(check.url)) return "A document check URL is repeated.";
    urls.add(check.url);
    if (!["CHECKED", "FAILED", "DEFERRED"].includes(check.outcome) || !instant(check.nextDueAt)) return "A document check result is invalid.";
    for (const at of [check.checkedAt, check.attemptedAt]) {
      if (at !== null && (!instant(at) || observedAt !== undefined && Date.parse(at) > Date.parse(observedAt))) return "A document check time is invalid.";
    }
    if (check.outcome === "CHECKED" && check.checkedAt === null) return "A checked document needs its actual check time.";
  }
  return null;
}

export interface MeetingDocumentClock {
  readonly nextDocumentDueAt?: string;
  readonly pendingDocumentCount?: number;
  readonly lastDocumentAttemptedAt?: string;
  readonly calendarRetryAt?: string;
}

export function meetingDocumentCheckClock(state: MeetingDocumentChecks | undefined): MeetingDocumentClock {
  if (!state) return {};
  const due = state.documents.map(check => check.nextDueAt).sort((a, b) => Date.parse(a) - Date.parse(b));
  const attempted = state.documents.flatMap(check => check.attemptedAt ?? []).sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    ...(due.length ? { nextDocumentDueAt: due[0]! } : {}),
    pendingDocumentCount: state.documents.filter(check => check.outcome !== "CHECKED").length,
    ...(attempted.length ? { lastDocumentAttemptedAt: attempted.at(-1)! } : {}),
    ...(state.calendarRetryAt ? { calendarRetryAt: state.calendarRetryAt } : {}),
  };
}

export function meetingDocumentInterval(meeting: { startsAt: string; endsAt?: string | null }, schedule: SittingWindowSchedule, now: number): number {
  const start = Date.parse(meeting.startsAt), end = Date.parse(meeting.endsAt ?? "");
  const concluded = Number.isFinite(end) && end >= start ? end : start + 86_400_000;
  return start <= now + schedule.windowMs && concluded >= now - schedule.windowMs ? schedule.hotEveryMs : schedule.baseEveryMs;
}

export function publishedMeetingDocumentLinks(meeting: Pick<Meeting, "publishedLinks" | "agendaUrl">) {
  const seen = new Set<string>();
  return (meeting.publishedLinks ?? []).flatMap(link => {
    let url: URL;
    try { url = new URL(link.href); } catch { return []; }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || link.href === meeting.agendaUrl || seen.has(url.href)) return [];
    const kind = link.kind ?? (/\bresults?\b/i.test(link.label) ? "RESULTS"
      : /\bminutes\b/i.test(link.label) || /\/ViewFile\/Minutes\//i.test(url.pathname) ? "MINUTES" : null);
    if (!kind) return [];
    seen.add(url.href);
    return [{ ...link, href: url.href, kind }];
  });
}
