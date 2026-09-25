/**
 * **ONE CONCLUDED SITTING'S MINUTES → ONE DURABLE ROW**, and whether to read
 * them again. (NH332, 2026-09-25.)
 *
 * Pure, like `./ingest.ts` beside it: nothing here fetches. The routine adapter
 * (`scripts/legistar-insite-minutes-ingest.mts`) reads the portal and hands the
 * results in, so the acquisition POLICY — which sittings are owed a read, and
 * what a sitting with no minutes yet is — is tested against recorded pages.
 *
 * ## Three states a concluded sitting can be in, kept apart
 *
 * - **Minutes read.** The row carries the records the minutes support and the
 *   document they came from (`minutesDocument`), with its standing: the
 *   clerk's action minutes, minutes whose approval we have not seen, or
 *   minutes a later sitting's minutes record approving.
 * - **Not yet published** (`NOT_YET_PUBLISHED`). The portal's minutes cell
 *   says "Not available". That is a fact about the publisher, stated with the
 *   instant we read it, and never "no decision was made".
 * - **Not read** (`REQUEST_FAILED` / `ZERO_ROWS_FAILED`). Ours, retryable.
 */
import { createHash } from "node:crypto";

import { decodeEntities } from "../sources/http.ts";
import type { InSiteCalendarRow } from "../sources/legistar-insite/calendar.ts";
import {
  minutesOutcomeRecords,
  parseCouncilMinutes,
  type MinutesPage,
  type ParsedCouncilMinutes,
} from "../sources/legistar-insite/minutes.ts";
import type { InSiteTenant } from "../sources/legistar-insite/tenant-registry.ts";
import type { LegistarMinutesPointer } from "../sources/legistar/outcomes.ts";
import type { NeverRead, ReadStamp } from "../ops/freshness.ts";
import { toZonedIso } from "../time/zoned.ts";
import { observationFromGridCell } from "./publication.ts";
import type {
  MinutesApprovalState,
  OutcomeSnapshot,
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

function onHost(href: string, host: string): string | null {
  try {
    const url = new URL(href, `https://${host}/`);
    // Only the tenant's own permitted portal host. A link off it (the vendor's
    // document host refuses us in robots.txt) is never followed here.
    return url.protocol === "https:" && url.hostname.toLowerCase() === host.toLowerCase() ? url.href : null;
  } catch {
    return null;
  }
}

export function minutesLinkFor(row: InSiteCalendarRow, host: string): MinutesLink | null {
  const accessible = row.accessibleMinutes.href ? onHost(row.accessibleMinutes.href, host) : null;
  if (accessible && !/not available/i.test(row.accessibleMinutes.status)) {
    return { url: accessible, format: "HTML", label: row.accessibleMinutes.status || row.minutes.status };
  }
  const pdf = row.minutes.href ? onHost(row.minutes.href, host) : null;
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

/**
 * The wired body's concluded sittings in the window, one per portal id.
 *
 * A row the grid printed twice (two ranges overlap) keeps the reading that
 * carries a minutes link: a link published in one read is never lost to a
 * range that rendered the same sitting without it.
 */
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
  | "PRIOR_EXTRACTION_FAILED"
  /**
   * Held, but its note names "It was moved" passages the parser could not read (2026-09-25): read again, so a
   * parser that now reads them reaches readers without a forced pass. The 2026-08-13 study session held three
   * motions and named its fourth this way until the parser learned the clerk's infinitive form.
   */
  | "UNREAD_PASSAGES_HELD"
  | "FORCED"
  /** Held and unchanged. */
  | "UNCHANGED_SKIP"
  /** Still not published, as last recorded. */
  | "STILL_NOT_PUBLISHED"
  /**
   * We hold minutes read from a link the portal no longer shows. Kept as held:
   * a link withdrawn is not a decision reversed, and the pass says so.
   */
  | "LINK_WITHDRAWN_KEPT";

/** The words `minutesSitting` writes when a document leaves "It was moved" passages unread. */
const UNREAD_PASSAGES_PHRASE = "were not in the clerk's usual form and were not read";
const UNREAD_PASSAGES_NOTE = /passage\(s\) beginning "It was moved" were not in the clerk's usual form and were not read/;

export function minutesRefreshDecision(
  link: MinutesLink | null,
  held: PersistedSittingOutcomes | undefined,
): { readonly walk: boolean; readonly reason: MinutesRefreshReason } {
  if (held === undefined) return { walk: true, reason: "NEW" };
  if (held.extraction === "NOT_YET_PUBLISHED") {
    return link === null ? { walk: false, reason: "STILL_NOT_PUBLISHED" } : { walk: true, reason: "MINUTES_PUBLISHED" };
  }
  if (link === null) return { walk: false, reason: "LINK_WITHDRAWN_KEPT" };
  if (held.extraction !== "RETRIEVED") return { walk: true, reason: "PRIOR_EXTRACTION_FAILED" };
  const document = held.minutesDocument;
  if (!document || document.url !== link.url || document.publisherLabel !== link.label) {
    return { walk: true, reason: "PUBLISHER_RELABELED" };
  }
  if (UNREAD_PASSAGES_NOTE.test(held.extractionNote ?? "")) return { walk: true, reason: "UNREAD_PASSAGES_HELD" };
  return { walk: false, reason: "UNCHANGED_SKIP" };
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

/**
 * Read a fetched minutes document into pages of text.
 *
 * The sha256 is taken BEFORE the PDF engine sees the bytes: pdf.js takes
 * ownership of the buffer it is handed, and a hash taken afterwards is the
 * hash of nothing (measured while building these fixtures).
 */
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
    agendaFile: row.agenda.href ? onHost(row.agenda.href, tenant.host) : null,
    agendaLastPublishedUtc: null,
    // The portal cell's words, verbatim. Not the vendor's "Minutes status"
    // field, which reads "Draft" on approved and action minutes alike.
    minutesStatusName: (link?.label ?? row.minutes.status) || null,
    minutesStatusId: null,
    minutesFile: link?.url ?? null,
    minutesLastPublishedUtc: null,
    inSiteUrl: row.detailHref ? onHost(row.detailHref, tenant.host) : null,
    lastModifiedUtc: null,
    videoStatus: null,
    observedAt,
  };
}

function pointerFromLink(link: MinutesLink | null, row: InSiteCalendarRow, host: string, note: string): LegistarMinutesPointer {
  return { url: link?.url ?? null, status: (link?.label ?? row.minutes.status) || null, host: link ? host : null, retrievalNote: note };
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
    sourceUrl: row.detailHref ? onHost(row.detailHref, tenant.host) : null,
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
    minutesPointer: pointerFromLink(null, input.row, input.tenant.host, "The portal links no minutes for this sitting yet."),
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
    minutesPointer: pointerFromLink(input.link, input.row, input.tenant.host, "The read of this minutes document failed; it stays owed."),
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
  const pointer = pointerFromLink(document.link, input.row, input.tenant.host, "Read by the InSite minutes route; see minutesDocument.");
  if (document.unreadable !== null) {
    return {
      parsed: null,
      sitting: {
        ...base,
        extraction: "ZERO_ROWS_FAILED",
        extractionNote:
          `The minutes document was fetched and yielded no text: ${document.unreadable} A zero-row ` +
          "extraction is a FAILED extraction (RULING 100); nothing is claimed about what was decided.",
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
          "not say that no action was taken. A zero-row extraction is a FAILED extraction (RULING 100), " +
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
 * Mark every held sitting whose minutes a later held sitting's minutes record
 * approving. Recomputed over the whole projection on every write, so an
 * approval read today reaches a sitting read weeks ago.
 *
 * Only when exactly one held sitting matches the named date and kind, the
 * approving item carried, and the held document is the council's minutes (an
 * approval does not make action minutes the approved record: the approved
 * document is a different one, owed a read when the portal relabels it).
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
