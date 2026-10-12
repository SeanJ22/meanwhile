/** One concluded sitting's minutes to one durable row, and whether to read them again. Pure: the caller fetches. */
import { createHash } from "node:crypto";

import { decodeEntities } from "../sources/http.ts";
import type { InSiteCalendarRow } from "../sources/legistar-insite/calendar.ts";
import {
  MINUTES_PARSER_REVISION,
  minutesOutcomeRecords,
  parseCouncilMinutes,
  type MinutesPage,
  type ParsedCouncilMinutes,
} from "../sources/legistar-insite/minutes.ts";
import type { InSiteTenant } from "../sources/legistar-insite/tenant-registry.ts";
import type { LegistarMinutesPointer } from "../sources/legistar/outcomes.ts";
import { LEGISTAR_DOCUMENT_HOSTS } from "../sources/legistar/routes.ts";
import type { NeverRead, ReadStamp } from "../ops/freshness.ts";
import { toZonedIso } from "../time/zoned.ts";
import { observationFromGridCell } from "./publication.ts";
import type {
  MinutesApprovalState,
  OutcomeSnapshot,
  PersistedFailedMinutesRead,
  PersistedMinutesDocument,
  PersistedPublicationStatus,
  PersistedSittingOutcomes,
} from "./types.ts";

/** The route id (lib/sources/legistar/routes.ts) a minutes-read sitting walked. */
export const INSITE_MINUTES_ROUTE = "INSITE_ACCESSIBLE_MINUTES";

/** `legistar-insite:<slug>:<portal id>` — byte-identical to the InSite adapter's meeting id. */
export function insiteMeetingId(slug: string, insiteId: string | number): string {
  return `legistar-insite:${slug}:${insiteId}`;
}

/** The minutes link a grid row publishes: the accessible HTML first, the PDF second. */
export interface MinutesLink {
  readonly url: string;
  readonly format: "HTML" | "PDF";
  /** The cell's own label, verbatim: "Minutes", "Results". */
  readonly label: string;
}

/** A grid link resolved against the tenant's portal when it is a public https address on one of `hosts`, else null. */
function publicLinkOn(href: string, host: string, hosts: readonly string[]): string | null {
  try {
    const url = new URL(href, `https://${host}/`);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;
    return hosts.includes(url.hostname.toLowerCase()) ? url.href : null;
  } catch {
    return null;
  }
}

/** A page of the tenant's own portal (the sitting's detail page): the portal host only. */
function onPortal(href: string, host: string): string | null {
  return publicLinkOn(href, host, [host.toLowerCase()]);
}

/** A document the grid links, on the tenant's portal host or the vendor's document host; any other host stays unfollowed. */
function documentOn(href: string, host: string): string | null {
  return publicLinkOn(href, host, [host.toLowerCase(), ...LEGISTAR_DOCUMENT_HOSTS]);
}

export function minutesLinkFor(row: InSiteCalendarRow, host: string): MinutesLink | null {
  const accessible = row.accessibleMinutes.href ? documentOn(row.accessibleMinutes.href, host) : null;
  if (accessible && !/not available/i.test(row.accessibleMinutes.status)) {
    return { url: accessible, format: "HTML", label: row.accessibleMinutes.status || row.minutes.status };
  }
  const pdf = row.minutes.href ? documentOn(row.minutes.href, host) : null;
  if (pdf && !/not available/i.test(row.minutes.status)) return { url: pdf, format: "PDF", label: row.minutes.status };
  return null;
}

function gridDate(raw: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  return match ? { year: Number(match[3]), month: Number(match[1]), day: Number(match[2]) } : null;
}

function gridTime(raw: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(raw.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  return { hour: (hour % 12) + (match[3]!.toUpperCase() === "PM" ? 12 : 0), minute };
}

/** The sitting's start as the body's own wall clock, as an ISO instant with its offset. */
export function gridStartsAt(row: InSiteCalendarRow, timeZone: string): string | null {
  const date = gridDate(row.date);
  const time = gridTime(row.time);
  if (!date || !time) return null;
  return toZonedIso(date.year, date.month, date.day, time.hour, time.minute, timeZone);
}

/** The wired body's concluded sittings in the window, one per portal id; a duplicate keeps the reading with a minutes link. */
export function concludedSittingRows(
  rows: readonly InSiteCalendarRow[],
  tenant: Pick<InSiteTenant, "bodyNames" | "host" | "timeZone">,
  window: { readonly from: string; readonly to: string },
  now: Date,
): InSiteCalendarRow[] {
  const wired = new Set(tenant.bodyNames.map((name) => name.trim().toLowerCase()));
  const byId = new Map<string, InSiteCalendarRow>();
  for (const row of rows) {
    if (!row.insiteId || !wired.has(row.bodyName.trim().toLowerCase())) continue;
    if (/\bcancell?ed\b/i.test(`${row.kind ?? ""} ${row.location}`)) continue;
    const startsAt = gridStartsAt(row, tenant.timeZone);
    if (startsAt === null || Date.parse(startsAt) >= now.getTime()) continue;
    const day = startsAt.slice(0, 10);
    if (day < window.from || day > window.to) continue;
    const held = byId.get(row.insiteId);
    if (!held || (minutesLinkFor(held, tenant.host) === null && minutesLinkFor(row, tenant.host) !== null)) {
      byId.set(row.insiteId, row);
    }
  }
  return [...byId.values()].sort((a, b) =>
    String(gridStartsAt(b, tenant.timeZone)).localeCompare(String(gridStartsAt(a, tenant.timeZone))),
  );
}

export type MinutesRefreshReason =
  | "NEW"
  /** We recorded "not yet published"; the portal now links minutes. */
  | "MINUTES_PUBLISHED"
  /** The link or its label moved ("Results" → "Minutes"): a new document. */
  | "PUBLISHER_RELABELED"
  /** A failed request or a failure with no document identity held: read again. */
  | "PRIOR_EXTRACTION_FAILED"
  /** Held with unread "It was moved" passages under an older parser revision: read again. */
  | "UNREAD_PASSAGES_HELD"
  /** The link serves a document whose extraction failed: the caller checks whether it changed before downloading again. */
  | "FAILED_DOCUMENT_CHECK"
  /** The failed document's cheap check says it changed: read it again at once. */
  | "FAILED_DOCUMENT_CHANGED"
  /** The failed document's cheap check says it is the same document: held, not downloaded. */
  | "FAILED_DOCUMENT_UNCHANGED"
  /** The cheap check could not be made (the portal did not answer it): held until the re-verification date. */
  | "FAILED_DOCUMENT_UNCHECKED"
  /** A newer parser revision than the one that failed on these bytes: read again at once. */
  | "FAILED_DOCUMENT_PARSER_CHANGED"
  /** The failed read is `FAILED_MINUTES_REVERIFY_DAYS` old: the bytes are read once more, whatever the check says. */
  | "FAILED_DOCUMENT_REVERIFY"
  | "FORCED"
  /** A successful document is re-read on the next scheduled pass, even at the same URL. */
  | "SCHEDULED_RECHECK"
  /** Still not published, as last recorded. */
  | "STILL_NOT_PUBLISHED"
  /** Minutes held from a link the portal no longer shows: kept, since a withdrawn link is not a reversed decision. */
  | "LINK_WITHDRAWN_KEPT";

/** How long a held failed extraction goes before its bytes are re-read anyway: the HEAD check cannot see a same-length replacement. */
export const FAILED_MINUTES_REVERIFY_DAYS = 7;

/** The words `minutesSitting` writes when a document leaves "It was moved" passages unread. */
const UNREAD_PASSAGES_PHRASE = "were not in the clerk's usual form and were not read";
const UNREAD_PASSAGES_NOTE = /passage\(s\) beginning "It was moved" were not in the clerk's usual form and were not read/;

export function minutesRefreshDecision(
  link: MinutesLink | null,
  held: PersistedSittingOutcomes | undefined,
  now: Date = new Date(),
): { readonly walk: boolean; readonly reason: MinutesRefreshReason; readonly check?: PersistedFailedMinutesRead } {
  if (held === undefined) return { walk: true, reason: "NEW" };
  if (held.extraction === "NOT_YET_PUBLISHED") {
    return link === null ? { walk: false, reason: "STILL_NOT_PUBLISHED" } : { walk: true, reason: "MINUTES_PUBLISHED" };
  }
  if (link === null) return { walk: false, reason: "LINK_WITHDRAWN_KEPT" };
  const failed = held.failedMinutesRead;
  if (failed && failed.url === link.url && failed.publisherLabel === link.label) {
    if (failed.parserRevision !== MINUTES_PARSER_REVISION) return { walk: true, reason: "FAILED_DOCUMENT_PARSER_CHANGED" };
    const readAt = Date.parse(failed.readAt);
    if (!Number.isFinite(readAt) || now.getTime() - readAt >= FAILED_MINUTES_REVERIFY_DAYS * 86_400_000) {
      return { walk: true, reason: "FAILED_DOCUMENT_REVERIFY" };
    }
    return { walk: false, reason: "FAILED_DOCUMENT_CHECK", check: failed };
  }
  if (held.extraction !== "RETRIEVED") return { walk: true, reason: "PRIOR_EXTRACTION_FAILED" };
  const document = held.minutesDocument;
  if (!document || document.url !== link.url || document.publisherLabel !== link.label) {
    return { walk: true, reason: "PUBLISHER_RELABELED" };
  }
  if (UNREAD_PASSAGES_NOTE.test(held.extractionNote ?? "") && document.parserRevision !== MINUTES_PARSER_REVISION) {
    return { walk: true, reason: "UNREAD_PASSAGES_HELD" };
  }
  return { walk: true, reason: "SCHEDULED_RECHECK" };
}

/** What a HEAD of the failed document answered, or null when it could not be asked. */
export interface MinutesDocumentHead {
  readonly status: number;
  readonly contentType: string;
  readonly contentLength: number | null;
  readonly etag: string | null;
  readonly lastModified: string | null;
}

function baseType(contentType: string | null): string | null {
  const base = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  return base === "" ? null : base;
}

/**
 * Whether a document whose extraction failed changed, from one HEAD: a different length, type or validator means
 * changed. A HEAD without a 2xx and a length says nothing; the failure stays held until the re-verification bound.
 */
export function failedDocumentCheck(
  failed: PersistedFailedMinutesRead,
  head: MinutesDocumentHead | null,
): { readonly walk: boolean; readonly reason: "FAILED_DOCUMENT_CHANGED" | "FAILED_DOCUMENT_UNCHANGED" | "FAILED_DOCUMENT_UNCHECKED"; readonly detail: string } {
  if (head === null || head.status < 200 || head.status >= 300 || head.contentLength === null) {
    return {
      walk: false,
      reason: "FAILED_DOCUMENT_UNCHECKED",
      detail: head === null
        ? "the portal did not answer the check"
        : `the check answered HTTP ${head.status}${head.contentLength === null ? " with no length" : ""}`,
    };
  }
  const differences = [
    head.contentLength !== failed.byteCount ? `length ${failed.byteCount} → ${head.contentLength}` : null,
    failed.contentType !== null && baseType(head.contentType) !== baseType(failed.contentType) ? `type ${failed.contentType} → ${head.contentType}` : null,
    head.etag !== failed.etag ? `ETag ${failed.etag ?? "none"} → ${head.etag ?? "none"}` : null,
    head.lastModified !== failed.lastModified ? `Last-Modified ${failed.lastModified ?? "none"} → ${head.lastModified ?? "none"}` : null,
  ].filter((difference): difference is string => difference !== null);
  return differences.length > 0
    ? { walk: true, reason: "FAILED_DOCUMENT_CHANGED", detail: differences.join("; ") }
    : { walk: false, reason: "FAILED_DOCUMENT_UNCHANGED", detail: `the same ${failed.byteCount} bytes by length, type and validators` };
}

/**
 * The failed read to remember, when a document was read and its extraction failed on its bytes; null for any
 * other sitting (a read that succeeded, or a request that failed and read no bytes).
 */
export function failedMinutesReadFor(
  sitting: PersistedSittingOutcomes,
  document: MinutesDocumentRead,
  response: { readonly contentType: string | null; readonly etag: string | null; readonly lastModified: string | null },
  readAt: string,
): PersistedFailedMinutesRead | null {
  if (sitting.extraction !== "ZERO_ROWS_FAILED") return null;
  return {
    url: document.link.url,
    publisherLabel: document.link.label,
    sha256: document.sha256,
    byteCount: document.byteCount,
    contentType: response.contentType === "" ? null : response.contentType,
    etag: response.etag,
    lastModified: response.lastModified,
    parserRevision: MINUTES_PARSER_REVISION,
    readAt,
    reason: sitting.extractionNote ?? "The minutes were read and yielded nothing we could extract.",
  };
}

/**
 * What a read leaves held: a success replaces the sitting and clears any failure; a failed extraction is held with its
 * bytes' identity, beside (never over) verified minutes already held; a failed request is not held.
 */
export function sittingAfterRead(
  held: PersistedSittingOutcomes | undefined,
  fresh: PersistedSittingOutcomes,
  failed: PersistedFailedMinutesRead | null,
): PersistedSittingOutcomes {
  if (failed === null) return fresh;
  if (held?.extraction === "RETRIEVED") return { ...held, failedMinutesRead: failed };
  return { ...fresh, failedMinutesRead: failed };
}

/** A failed extraction held with the identity of the bytes it failed on: a named failure, not a retryable request. */
export function isHeldFailedExtraction(sitting: PersistedSittingOutcomes): boolean {
  return sitting.extraction === "ZERO_ROWS_FAILED" && sitting.failedMinutesRead !== undefined;
}

/** The document as read: its bytes' identity and its text, page by page. */
export interface MinutesDocumentRead {
  readonly link: MinutesLink;
  readonly sha256: string;
  readonly byteCount: number;
  readonly pageCount: number | null;
  readonly pages: readonly MinutesPage[];
  /** Set when the text could not be read at all (a scan without a text layer, a refused engine). */
  readonly unreadable: string | null;
}

/** Strip an accessible-minutes HTML rendering to one page of text. */
function htmlText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h\d)>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

/** Read a fetched minutes document into pages of text. The sha256 is taken before pdf.js takes ownership of the buffer. */
export async function readMinutesDocument(link: MinutesLink, bytes: Uint8Array): Promise<MinutesDocumentRead> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const byteCount = bytes.byteLength;
  if (link.format === "HTML") {
    const text = htmlText(new TextDecoder("utf-8").decode(bytes));
    return { link, sha256, byteCount, pageCount: 1, pages: text ? [{ page: 1, text }] : [], unreadable: text ? null : "The accessible minutes page carried no readable text." };
  }
  const { extractTextLayer } = await import("../extract/text-layer.ts");
  const result = await extractTextLayer(bytes.slice(), link.url);
  const pageCount = typeof result.counts.pages === "number" ? result.counts.pages : null;
  return {
    link,
    sha256,
    byteCount,
    pageCount,
    pages: result.outcome === "EXTRACTED" ? result.items : [],
    unreadable: result.outcome === "EXTRACTED" ? null : result.reason || `The text layer returned ${result.outcome}.`,
  };
}

function publicationFromRow(
  row: InSiteCalendarRow,
  tenant: Pick<InSiteTenant, "host">,
  link: MinutesLink | null,
  observedAt: string,
): PersistedPublicationStatus {
  return {
    agendaStatusName: row.agenda.status || null,
    agendaStatusId: null,
    agendaFile: row.agenda.href ? documentOn(row.agenda.href, tenant.host) : null,
    agendaLastPublishedUtc: null,
    // The portal cell's words, verbatim. Not the vendor's "Minutes status"
    // field, which reads "Draft" on approved and action minutes alike.
    minutesStatusName: (link?.label ?? row.minutes.status) || null,
    minutesStatusId: null,
    minutesFile: link?.url ?? null,
    minutesLastPublishedUtc: null,
    inSiteUrl: row.detailHref ? onPortal(row.detailHref, tenant.host) : null,
    lastModifiedUtc: null,
    videoStatus: null,
    observedAt,
  };
}

/** The pointer's host is the link's own: the portal's, or the vendor's document host. */
function pointerFromLink(link: MinutesLink | null, row: InSiteCalendarRow, note: string): LegistarMinutesPointer {
  return {
    url: link?.url ?? null,
    status: (link?.label ?? row.minutes.status) || null,
    host: link ? new URL(link.url).hostname.toLowerCase() : null,
    retrievalNote: note,
  };
}

interface SittingInput {
  readonly tenant: Pick<InSiteTenant, "slug" | "host" | "bodyId" | "ocdId" | "jurisdiction" | "publishingOrg" | "timeZone">;
  readonly row: InSiteCalendarRow;
  readonly calendarUrl: string;
  readonly observedAt: string;
}

function sittingBase(input: SittingInput, link: MinutesLink | null): Omit<PersistedSittingOutcomes, "extraction" | "extractionNote" | "minutesPointer" | "outcomes" | "routesWalked"> {
  const { tenant, row } = input;
  const meetingId = insiteMeetingId(tenant.slug, row.insiteId!);
  return {
    meetingId,
    bodyId: tenant.bodyId,
    ocdId: tenant.ocdId,
    slug: tenant.slug,
    eventId: Number(row.insiteId),
    bodyName: row.bodyName,
    jurisdiction: tenant.jurisdiction,
    startsAt: gridStartsAt(row, tenant.timeZone),
    sourceOrg: tenant.publishingOrg,
    sourceUrl: row.detailHref ? onPortal(row.detailHref, tenant.host) : null,
    publication: publicationFromRow(row, tenant, link, input.observedAt),
    agenda: [],
    rollCalls: [],
    failedRollCallExtractions: [],
    voteRequestFailures: [],
    publicationObservations: [
      observationFromGridCell({
        meetingId,
        status: row.agenda.status,
        href: row.agenda.href,
        calendarUrl: input.calendarUrl,
        sourceOrg: tenant.publishingOrg,
        observedAt: input.observedAt,
      }),
    ],
  };
}

/** A concluded sitting whose minutes the portal does not link yet. A fact about the publisher. */
export function notYetPublishedSitting(input: SittingInput): PersistedSittingOutcomes {
  const cell = input.row.minutes.status || "(an empty minutes cell)";
  return {
    ...sittingBase(input, null),
    extraction: "NOT_YET_PUBLISHED",
    extractionNote:
      `${input.tenant.publishingOrg} has not published minutes for this sitting yet: the portal's ` +
      `minutes cell read "${cell}" at ${input.observedAt}. Its decisions are not yet in the public ` +
      "record we read. That is not a record that nothing was decided.",
    minutesPointer: pointerFromLink(null, input.row, "The portal links no minutes for this sitting yet."),
    outcomes: [],
    routesWalked: ["INSITE_CALENDAR"],
  };
}

/** A sitting whose minutes read failed. Ours, retryable, never an absence. */
export function failedMinutesSitting(
  input: SittingInput & { readonly link: MinutesLink; readonly error: string },
): PersistedSittingOutcomes {
  return {
    ...sittingBase(input, input.link),
    extraction: "REQUEST_FAILED",
    extractionNote:
      `The minutes request for this sitting failed: ${input.error}. Nothing is claimed about what ` +
      "the sitting decided; the read is retryable and stays open.",
    minutesPointer: pointerFromLink(input.link, input.row, "The read of this minutes document failed; it stays owed."),
    outcomes: [],
    routesWalked: ["INSITE_CALENDAR"],
  };
}

function approvalDetail(state: MinutesApprovalState, label: string): string {
  if (state === "DRAFT_ACTION_MINUTES") {
    return `The clerk's action minutes ("${label}"), published before the council approves its minutes. ` +
      "They are not the approved record.";
  }
  if (state === "APPROVAL_NOT_SEEN") {
    return `Published as the council's minutes ("${label}"). No later sitting we hold records approving ` +
      "them, so they are not described as approved.";
  }
  return "Approved by the council at a later sitting.";
}

/**
 * One sitting's minutes, read. The records, the document's standing, and the
 * approvals this document records for OTHER sittings (applied across the
 * whole projection by {@link applyMinutesApprovals}).
 */
export function minutesSitting(
  input: SittingInput & { readonly document: MinutesDocumentRead; readonly readOn: ReadStamp | NeverRead },
): { readonly sitting: PersistedSittingOutcomes; readonly parsed: ParsedCouncilMinutes | null } {
  const { document } = input;
  const base = sittingBase(input, document.link);
  const pointer = pointerFromLink(document.link, input.row, "Read by the InSite minutes route; see minutesDocument.");
  if (document.unreadable !== null) {
    return {
      parsed: null,
      sitting: {
        ...base,
        extraction: "ZERO_ROWS_FAILED",
        extractionNote:
          `The minutes document was fetched and yielded no text: ${document.unreadable} A zero-row ` +
          "extraction is a FAILED extraction; nothing is claimed about what was decided.",
        minutesPointer: pointer,
        outcomes: [],
        routesWalked: ["INSITE_CALENDAR"],
      },
    };
  }

  const parsed = parseCouncilMinutes(document.pages);
  const outcomes = minutesOutcomeRecords(parsed, {
    eventId: Number(input.row.insiteId),
    sourceOrg: input.tenant.publishingOrg,
    documentUrl: document.link.url,
    readOn: input.readOn,
  });
  const draft = parsed.kind === "ACTION_MINUTES" || /^results?\b/i.test(document.link.label);
  const state: MinutesApprovalState = draft ? "DRAFT_ACTION_MINUTES" : "APPROVAL_NOT_SEEN";
  const approvalItem = parsed.approvals[0] ?? null;
  const approvalCarried = approvalItem !== null && (
    approvalItem.consent
      ? parsed.motions.some((motion) => motion.consentAgenda && motion.disposition === "PASSED")
      : parsed.motions.some((motion) => motion.items.includes(approvalItem.itemReference) && motion.disposition === "PASSED")
  );
  const minutesDocument: PersistedMinutesDocument = {
    url: document.link.url,
    format: document.link.format,
    publisherLabel: document.link.label,
    title: parsed.title,
    sha256: document.sha256,
    byteCount: document.byteCount,
    pageCount: document.pageCount,
    sittingKind: input.row.kind,
    approval: { state, detail: approvalDetail(state, document.link.label), approvedAt: null },
    approves: approvalItem?.sittings ?? [],
    approvesQuote: approvalItem ? `${approvalItem.consent ? "*" : ""}${approvalItem.itemReference}. ${approvalItem.quote}` : null,
    approvalCarried,
    parserRevision: MINUTES_PARSER_REVISION,
  };

  const empty = outcomes.length === 0;
  const unread = parsed.unreadMotions.length > 0
    ? ` ${parsed.unreadMotions.length} passage(s) beginning "It was moved" ${UNREAD_PASSAGES_PHRASE}: ` +
      parsed.unreadMotions.map((passage) => `"${passage}"`).join("; ")
    : "";
  if (empty && !parsed.statesNoFormalAction) {
    return {
      parsed,
      sitting: {
        ...base,
        extraction: "ZERO_ROWS_FAILED",
        extractionNote:
          `The minutes were read (${parsed.bodyCharacters} characters) and yielded no motion, and they do ` +
          "not say that no action was taken. A zero-row extraction is a FAILED extraction, " +
          `not a sitting where nothing was decided.${unread}`,
        minutesPointer: pointer,
        outcomes: [],
        routesWalked: ["INSITE_CALENDAR", INSITE_MINUTES_ROUTE],
        minutesDocument,
      },
    };
  }
  return {
    parsed,
    sitting: {
      ...base,
      extraction: "RETRIEVED",
      extractionNote: empty
        ? `The minutes record no motion and say, in their own words, that no formal action was taken.${unread}`
        : unread.trim() || null,
      minutesPointer: pointer,
      outcomes,
      routesWalked: ["INSITE_CALENDAR", INSITE_MINUTES_ROUTE],
      minutesDocument,
    },
  };
}

const APPROVAL_KIND_MATCH: Readonly<Record<string, (sitting: PersistedSittingOutcomes) => boolean>> = {
  REGULAR: (sitting) => sitting.bodyName === "City Council" && !/special/i.test(sitting.minutesDocument?.sittingKind ?? ""),
  SPECIAL: (sitting) => /special/i.test(sitting.minutesDocument?.sittingKind ?? ""),
  STUDY_SESSION: (sitting) => sitting.bodyName === "City Council Study Session" && !/special/i.test(sitting.minutesDocument?.sittingKind ?? ""),
  STRATEGIC_PLANNING: (sitting) => sitting.bodyName === "City Council Strategic Planning Session",
};

/**
 * Mark every held sitting whose minutes a later held sitting's minutes record approving, recomputed over the whole
 * projection. Only when exactly one held sitting matches, the approving item carried, and the held document is the
 * council's minutes.
 */
export function applyMinutesApprovals(snapshot: OutcomeSnapshot): OutcomeSnapshot {
  const approvals = new Map<string, { meetingId: string; startsAt: string | null; quote: string }>();
  for (const approving of snapshot.sittings) {
    const document = approving.minutesDocument;
    if (!document || !document.approvalCarried || document.approvesQuote === null) continue;
    for (const entry of document.approves) {
      const matches = snapshot.sittings.filter((sitting) =>
        sitting.slug === approving.slug &&
        sitting.meetingId !== approving.meetingId &&
        sitting.startsAt?.slice(0, 10) === entry.date &&
        (APPROVAL_KIND_MATCH[entry.kind]?.(sitting) ?? false),
      );
      if (matches.length !== 1) continue;
      approvals.set(matches[0]!.meetingId, { meetingId: approving.meetingId, startsAt: approving.startsAt, quote: document.approvesQuote });
    }
  }
  const sittings = snapshot.sittings.map((sitting) => {
    const document = sitting.minutesDocument;
    if (!document) return sitting;
    const approvedAt = approvals.get(sitting.meetingId) ?? null;
    const draft = document.approval.state === "DRAFT_ACTION_MINUTES";
    const state: MinutesApprovalState = draft ? "DRAFT_ACTION_MINUTES" : approvedAt ? "APPROVED" : "APPROVAL_NOT_SEEN";
    const detail = state === "APPROVED" && approvedAt
      ? `Approved by the council at its sitting of ${approvedAt.startsAt?.slice(0, 10) ?? "an unrecorded date"}, whose minutes record: "${approvedAt.quote}"`
      : draft && approvedAt
        ? `${approvalDetail(state, document.publisherLabel)} The council has since approved its minutes (${approvedAt.meetingId}); the approved document is owed a read.`
        : approvalDetail(state, document.publisherLabel);
    return { ...sitting, minutesDocument: { ...document, approval: { state, detail, approvedAt: state === "APPROVED" ? approvedAt : null } } };
  });
  return { ...snapshot, sittings };
}
