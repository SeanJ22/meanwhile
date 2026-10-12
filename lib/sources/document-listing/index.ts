/**
 * @freshness-reads-here
 *
 * The clock stamps in this file are minted by the code path that performs the
 * read: `collectedAt` is taken at the moment of the fetch, in `fetch()` below,
 * and never reconstructed afterwards.
 */
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import {
  MEETING_HELD_HORIZON_DAYS,
  MEETING_HELD_LOOKBACK_DAYS,
} from "../../meetings/constants.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { SourceHttpError, decodeEntities } from "../http.ts";
import { dateOfDay, dayNumber } from "../ical/recurrence.ts";
import { makePermissionGate, permittedText } from "../permission-gate.ts";
import {
  accountedNormalize,
  type Accounted,
} from "../normalize-account.ts";
import type {
  Meeting,
  MeetingQuery,
  MeetingStatus,
  NormalizeDropCounts,
  PartialScopeFailure,
  ReportingMeetingSource,
} from "../types.ts";

/**
 * A body's own agendas-and-minutes page, read as its list of sittings. The shape: one page per year, one
 * link per document, each labelled with its sitting and date ("Regular Meeting 9-9-2026", "Work Session
 * 03-25-26"), grouped under an "Agendas" heading and a "Minutes" heading. No vendor is in the path.
 *
 * What becomes a sitting: a link whose label is `<kind> <M-D-YYYY | M-D-YY>` with a kind the wiring row
 * names (`sittingKinds`). One sitting per kind per date. Its agenda is the link under the agendas heading
 * (the sitting's `agendaUrl`); its minutes are the link under the minutes heading. A dated link of
 * another kind is a document of a sitting, linked when that date holds exactly one sitting and counted
 * as unattached otherwise.
 *
 * What is never invented:
 * - No time: the page states none, so every sitting ships `startPrecision: "DAY"`. A time printed in the
 *   label itself would be read.
 * - No place: the sitting carries no location and no venue gap (our own "place not recorded" line).
 * - No approval state unless the city's own label or heading says draft or approved.
 * - No cancellation but the label's own word.
 *
 * A sitting appears when the publisher posts its agenda, so "no upcoming sitting" between postings is
 * the publisher's horizon.
 *
 * Year pages: the row names the page pattern (`pageTemplate`, with `{year}`), and every year the serving
 * window touches is read. The current year's page is required. Another year's 404 is named, not failed;
 * any other failure there is a PARTIAL read. Every page is read behind the robots.txt gate
 * (`lib/sources/permission-gate.ts`), on the row's own official host only.
 */

export const SOURCE_NAME = "document-listing";

const WINDOW_FORWARD_DAYS = MEETING_HELD_HORIZON_DAYS;
const WINDOW_BACK_DAYS = MEETING_HELD_LOOKBACK_DAYS;

/* ------------------------------------------------------------ parsing -- */

/** One dated document link, exactly as the page printed it. */
export interface ListedDocument {
  /** The page section (an accordion's title, e.g. "September") it sits in, or null. */
  readonly section: string | null;
  /** The nearest heading above it ("Agendas", "Minutes"), or null. */
  readonly heading: string | null;
  /** The link text, whitespace collapsed. */
  readonly label: string;
  /** The link, absolute. */
  readonly href: string;
}

function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Every link on the page, with the section and heading it sits under, in
 * document order. Section titles are the page's own accordion titles
 * (`<summary>` text); headings are `<h1>`–`<h6>`. Scripts, styles and
 * comments are skipped whole.
 */
export function listedDocuments(html: string, pageUrl: string): ListedDocument[] {
  const out: ListedDocument[] = [];
  let section: string | null = null;
  let heading: string | null = null;
  const re =
    /<!--[\s\S]*?-->|<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>|<summary\b[^>]*>([\s\S]*?)<\/summary>|<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>|<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    if (m[2] !== undefined) {
      section = text(m[2]) || null;
      heading = null;
      continue;
    }
    if (m[3] !== undefined) {
      heading = text(m[3]) || null;
      continue;
    }
    if (m[4] === undefined) continue;
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[4]);
    const raw = decodeEntities(href?.[1] ?? href?.[2] ?? "").trim();
    const label = text(m[5] ?? "");
    if (!raw || !label || raw.startsWith("#") || /^(javascript|mailto|tel):/i.test(raw)) continue;
    let abs: string;
    try {
      abs = new URL(raw, pageUrl).toString();
    } catch {
      continue;
    }
    out.push({ section, heading, label, href: abs });
  }
  return out;
}

/** A label's kind and date: "Regular Meeting 01-14-2026", "Work Session 03-25-26". */
export interface DatedLabel {
  /** The kind as printed: "Regular Meeting". */
  readonly kind: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** A time the label itself prints, if any. */
  readonly time: { readonly hour: number; readonly minute: number } | null;
}

/** A document's own qualifier words, never part of a sitting's kind. */
const QUALIFIER = /\b(?:draft|approved|amended|revised|cancell?ed)\b/gi;

/**
 * A calendar date that exists, read through the shared calendar arithmetic
 * (`lib/sources/ical/recurrence.ts`): 2/30 is not rolled into March, because
 * its day number does not come back as the date written.
 */
function existingDate(year: number, month: number, day: number): string | null {
  const back = dateOfDay(dayNumber(year, month, day));
  if (back.y !== year || back.m !== month || back.d !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The kind and date a label states, or null when it states no full date.
 * Numeric dates read month first, the only order an American clerk writes; a
 * two-digit year is this century's. A label whose numbers are not a real date
 * is `{ kind, date: null }` — dated in form, not in fact — so it is counted.
 */
export function datedLabel(label: string): DatedLabel | { readonly kind: string; readonly date: null } | null {
  // A clerk's qualifier on the document ("DRAFT", "(Amended)", "CANCELLED")
  // is read by `minutesLabel` and the cancellation check from the label
  // itself; it is not part of the sitting's kind.
  const bare = label.replace(QUALIFIER, " ").replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").trim();
  const m = /^(.*?[A-Za-z].*?)[\s,:–—-]+(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:\s*[,@-]?\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?\s*[Mm]\.?)?[\s,:–—-]*(?:\.pdf)?$/.exec(bare);
  if (!m) return null;
  const kind = m[1].replace(/^[\s,:–—-]+|[\s,:–—-]+$/g, "").trim();
  if (!/[A-Za-z]/.test(kind)) return null;
  const year = m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4]);
  const date = existingDate(year, Number(m[2]), Number(m[3]));
  if (!date) return { kind, date: null };
  let time: { hour: number; minute: number } | null = null;
  if (m[5] !== undefined) {
    let hour = Number(m[5]);
    const minute = m[6] ? Number(m[6]) : 0;
    if (hour >= 1 && hour <= 12 && minute <= 59) {
      if (hour === 12) hour = 0;
      if (m[7].toLowerCase() === "p") hour += 12;
      time = { hour, minute };
    }
  }
  return { kind, date, time };
}

const CANCELED = /\bcancell?ed\b/i;

function slugOf(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function norm(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** How the city's own words label a set of minutes. */
export function minutesLabel(label: string, heading: string | null): string {
  const words = `${label} ${heading ?? ""}`;
  if (/\bdraft\b/i.test(words)) return "Minutes (draft)";
  if (/\bapproved\b/i.test(words)) return "Minutes (approved)";
  return "Minutes (not marked draft or approved)";
}

/** One sitting a listing page states, with every document the page links for it. */
export interface ListedSitting {
  readonly date: string;
  /** The kind as first printed: "Regular Meeting". */
  readonly kind: string;
  readonly time: { readonly hour: number; readonly minute: number } | null;
  /** The first agenda linked for it under the agendas heading, or null. */
  readonly agenda: string | null;
  /** Every other document the page links for it, labelled for a reader. */
  readonly links: readonly { readonly label: string; readonly href: string }[];
  readonly canceled: boolean;
  /** Its own section carried an agendas heading and no agenda for it: the publisher's slot, observed empty. */
  readonly agendaSlotEmpty: boolean;
  /** The labels it was read from, as printed. */
  readonly evidence: readonly string[];
}

export interface ListingCounts {
  /** Dated document links read. */
  readonly documents: number;
  /** Links folded into a sitting already held (its second document, or a related one). */
  readonly folded: number;
  /** Dated links of another kind that could not be tied to exactly one sitting. */
  readonly unattached: number;
  /** Labels shaped like a date that are not a real date. */
  readonly undated: number;
}

/**
 * The sittings a listing page states. Pure: no clock, no network.
 *
 * Only links under the row's agendas or minutes heading are read at all; the
 * page's navigation, footer and every other list are not documents of a
 * sitting.
 */
export function listedSittings(
  documents: readonly ListedDocument[],
  rule: { readonly sittingKinds: readonly string[]; readonly agendaHeading: string; readonly minutesHeading: string },
): { readonly sittings: ListedSitting[]; readonly counts: ListingCounts } {
  const kinds = new Set(rule.sittingKinds.map(norm));
  const agendaHeading = norm(rule.agendaHeading);
  const minutesHeading = norm(rule.minutesHeading);
  const sectionsWithAgendaSlot = new Set<string | null>();
  for (const d of documents) if (d.heading && norm(d.heading) === agendaHeading) sectionsWithAgendaSlot.add(d.section);

  type Draft = {
    date: string; kind: string; time: DatedLabel["time"]; agenda: string | null;
    links: { label: string; href: string }[]; canceled: boolean; sections: Set<string | null>; evidence: string[];
  };
  const byKey = new Map<string, Draft>();
  const related: { date: string; kind: string; label: string; href: string; heading: string }[] = [];
  let read = 0;
  let folded = 0;
  let undated = 0;

  for (const d of documents) {
    const heading = d.heading ? norm(d.heading) : null;
    const isAgenda = heading === agendaHeading;
    const isMinutes = heading === minutesHeading;
    if (!isAgenda && !isMinutes) continue;
    const dated = datedLabel(d.label);
    if (!dated) continue;
    read += 1;
    if (dated.date === null) {
      undated += 1;
      continue;
    }
    if (!kinds.has(norm(dated.kind))) {
      related.push({ date: dated.date, kind: dated.kind, label: d.label, href: d.href, heading: d.heading! });
      continue;
    }
    const key = `${dated.date}|${norm(dated.kind)}`;
    let sitting = byKey.get(key);
    if (!sitting) {
      sitting = {
        date: dated.date, kind: dated.kind, time: dated.time, agenda: null, links: [],
        canceled: false, sections: new Set(), evidence: [],
      };
      byKey.set(key, sitting);
    } else {
      folded += 1;
    }
    sitting.time ??= dated.time;
    sitting.canceled ||= CANCELED.test(d.label);
    sitting.sections.add(d.section);
    sitting.evidence.push(`${d.heading}: ${d.label}`);
    if (isAgenda && sitting.agenda === null) sitting.agenda = d.href;
    else if (isAgenda) sitting.links.push({ label: "Agenda (another posting)", href: d.href });
    else sitting.links.push({ label: minutesLabel(d.label, d.heading), href: d.href });
  }

  let unattached = 0;
  for (const r of related) {
    const onDate = [...byKey.values()].filter((s) => s.date === r.date);
    if (onDate.length !== 1) {
      unattached += 1;
      continue;
    }
    folded += 1;
    onDate[0].links.push({ label: r.kind, href: r.href });
    onDate[0].evidence.push(`${r.heading}: ${r.label}`);
  }

  const sittings = [...byKey.values()]
    .map((s): ListedSitting => ({
      date: s.date,
      kind: s.kind,
      time: s.time,
      agenda: s.agenda,
      links: s.links,
      canceled: s.canceled,
      agendaSlotEmpty: s.agenda === null && [...s.sections].some((section) => sectionsWithAgendaSlot.has(section)),
      evidence: s.evidence,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  return { sittings, counts: { documents: read, folded, unattached, undated } };
}

/* ------------------------------------------------------------ fetching -- */

/** One year page read, or named as not posted. */
export interface ListingPage {
  readonly year: number;
  readonly url: string;
  readonly html: string;
}

export interface DocumentListingRaw {
  wiring: BodySourceWiring;
  pages: ListingPage[];
  /** Year pages the publisher answered 404 for: not posted (yet), named. */
  notPosted: { year: number; url: string }[];
  /** Year pages other than the current one that failed another way: a partial read, named. */
  unread: { year: number; url: string; reason: string; scope: "UPCOMING" | "ARCHIVE" }[];
  collectedAt: string;
  /** The row's required read failed; nothing was produced from it. */
  error?: string;
}

/** The year pages the serving window touches, and which one is required. */
export function yearsToRead(input: { now: Date; startsAfter?: string; startsBefore?: string }): { years: number[]; required: number } {
  const after = input.startsAfter ? Date.parse(input.startsAfter) : Number.NaN;
  const before = input.startsBefore ? Date.parse(input.startsBefore) : Number.NaN;
  const from = new Date(Number.isFinite(after) ? after : input.now.getTime() - WINDOW_BACK_DAYS * 86_400_000).getUTCFullYear();
  const to = new Date(Number.isFinite(before) ? before : input.now.getTime() + WINDOW_FORWARD_DAYS * 86_400_000).getUTCFullYear();
  const required = input.now.getUTCFullYear();
  const years: number[] = [];
  for (let y = Math.min(from, required); y <= Math.max(to, required); y++) years.push(y);
  return { years, required };
}

export function pageUrlFor(wiring: BodySourceWiring, year: number): string {
  const template = wiring.config.pageTemplate ?? "";
  if (!template.includes("{year}")) throw new Error(`DOCUMENT_LISTING_TEMPLATE_INVALID:${wiring.bodyId}`);
  return template.replace("{year}", String(year));
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ the source -- */

function statusOf(startsAt: string, precision: "DAY" | "MINUTE", canceled: boolean, now: Date): MeetingStatus {
  if (canceled) return "CANCELED";
  // A date-only sitting is over when its day is; a timed one at its start.
  const over = Date.parse(startsAt) + (precision === "DAY" ? 86_400_000 : 0);
  return over <= now.getTime() ? "CONCLUDED" : "SCHEDULED";
}

export function makeDocumentListingSource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
  /** Which year is "this year" for the required page; the wall clock unless a test fixes it. */
  clock: () => Date = () => new Date(),
): ReportingMeetingSource<DocumentListingRaw> {
  const normalizeWithDrops = (
    raw: DocumentListingRaw[],
    now: Date = new Date(),
  ): Accounted<{
    meetings: Meeting[];
    drops: NormalizeDropCounts;
    unreachableOcdIds: string[];
    partialScopes?: PartialScopeFailure[];
  }> => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 };
    const unreachable = new Set<string>();
    const partial = new Map<string, PartialScopeFailure>();
    const windowStart = now.getTime() - WINDOW_BACK_DAYS * 86_400_000;
    const windowEnd = now.getTime() + WINDOW_FORWARD_DAYS * 86_400_000;
    let considered = 0;
    let duplicates = 0;
    let outOfWindow = 0;
    let keptUnplaced = 0;
    let unretrieved = 0;

    for (const row of raw) {
      const { wiring } = row;
      if (row.error) {
        // A refused row publishes nothing THIS run, counted rather than
        // shortening the input; its division is reported upward.
        considered += 1;
        unretrieved += 1;
        drops.notConfigured += 1;
        if (wiring.ocdId) unreachable.add(wiring.ocdId);
        continue;
      }
      for (const miss of row.unread) {
        const key = `${miss.scope}|${miss.reason}`;
        const at = partial.get(key) ?? { scope: miss.scope, ocdIds: [], cause: miss.reason };
        partial.set(key, { ...at, ocdIds: [...at.ocdIds, wiring.ocdId ?? null] });
      }
      const bodyName = wiring.config.bodyName ?? wiring.publishingOrg;
      const rule = {
        sittingKinds: (wiring.config.sittingKinds ?? "").split("|").map((k) => k.trim()).filter(Boolean),
        agendaHeading: wiring.config.agendaHeading ?? "Agendas",
        minutesHeading: wiring.config.minutesHeading ?? "Minutes",
      };
      const seen = new Set<string>();
      for (const page of row.pages) {
        const { sittings, counts } = listedSittings(listedDocuments(page.html, page.url), rule);
        considered += counts.documents;
        duplicates += counts.folded;
        drops.notConfigured += counts.unattached;
        drops.unplaceableInTime += counts.undated;
        for (const s of sittings) {
          const [y, mo, d] = s.date.split("-").map(Number);
          const precision = s.time ? "MINUTE" as const : "DAY" as const;
          // With no stated time, local midnight is an ORDERING position and
          // never a claim (M59).
          const startsAt = toZonedIso(y, mo, d, s.time?.hour ?? 0, s.time?.minute ?? 0, wiring.timeZone);
          const t = Date.parse(startsAt);
          if (t < windowStart || t > windowEnd) {
            outOfWindow += 1;
            continue;
          }
          const id = `${SOURCE_NAME}:${wiring.config.slug}:${s.date}:${slugOf(s.kind)}`;
          // Two year pages listing one sitting (a January agenda posted on the
          // previous year's page) are one sitting.
          if (seen.has(id)) {
            duplicates += 1;
            continue;
          }
          seen.add(id);
          // No place is stated on the page: our own named gap, never online.
          drops.unknownVenue += 1;
          keptUnplaced += 1;
          meetings.push({
            id,
            ocdId: wiring.ocdId,
            bodyId: wiring.bodyId,
            bodyName,
            title: s.kind,
            startsAt,
            startPrecision: precision,
            timeZone: wiring.timeZone,
            location: null,
            ...(s.links.length > 0 ? { publishedLinks: [...s.links] } : {}),
            agendaUrl: s.agenda,
            ...(s.agenda === null && s.agendaSlotEmpty ? { agendaSlotObservedEmpty: true } : {}),
            jurisdiction: wiring.jurisdiction,
            status: statusOf(startsAt, precision, s.canceled, now),
            provenance: {
              sourceUrl: page.url,
              sourceOrg: wiring.publishingOrg,
              collectedAt: row.collectedAt,
              verifiedAt: null,
              evidenceExcerpt: s.evidence.join(" | "),
            },
          });
        }
      }
    }

    meetings.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return accountedNormalize(
      SOURCE_NAME,
      raw,
      {
        meetings,
        drops,
        unreachableOcdIds: [...unreachable],
        ...(partial.size > 0 ? { partialScopes: [...partial.values()] } : {}),
      },
      { logicalInput: considered, duplicates, outOfWindow, countedButProduced: keptUnplaced, unretrieved },
    );
  };

  return {
    name: SOURCE_NAME,

    /**
     * Serialized, isolated per body, robots.txt asked first (one gate per
     * run). A body whose required page fails is recorded with its error and
     * returned, so the gap is attributed to its own division; every row
     * failing is the source failing.
     */
    async fetch(query?: MeetingQuery): Promise<DocumentListingRaw[]> {
      const gate = makePermissionGate({ fetchImpl, signal: query?.signal });
      const collected: DocumentListingRaw[] = [];
      for (const wiring of wiringRows) {
        const pages: ListingPage[] = [];
        const notPosted: { year: number; url: string }[] = [];
        const unread: DocumentListingRaw["unread"] = [];
        try {
          const official = (wiring.config.officialHost ?? "").toLowerCase();
          const { years, required } = yearsToRead({ now: clock(), startsAfter: query?.startsAfter, startsBefore: query?.startsBefore });
          for (const year of years) {
            const url = pageUrlFor(wiring, year);
            if (!official || hostOf(url) !== official) {
              throw new Error(`DOCUMENT_LISTING_HOST_NOT_OFFICIAL:${hostOf(url)}`);
            }
            try {
              pages.push({ year, url, html: await permittedText(gate, url, { fetchImpl, signal: query?.signal }) });
            } catch (error) {
              if (year === required) throw error;
              if (error instanceof SourceHttpError && error.status === 404) {
                notPosted.push({ year, url });
                continue;
              }
              unread.push({ year, url, reason: String((error as Error)?.message ?? error), scope: year > required ? "UPCOMING" : "ARCHIVE" });
            }
          }
          collected.push({ wiring, pages, notPosted, unread, collectedAt: new Date().toISOString() });
        } catch (error) {
          collected.push({
            wiring,
            pages: [],
            notPosted,
            unread,
            collectedAt: new Date().toISOString(),
            error: String((error as Error)?.message ?? error),
          });
        }
      }
      if (collected.length > 0 && collected.every((row) => row.error)) {
        throw new Error(collected[0].error);
      }
      return collected;
    },

    normalize(raw, now: Date = new Date()): Meeting[] {
      return normalizeWithDrops(raw, now).meetings;
    },

    normalizeWithDrops,

    async upsert(meetings: Meeting[]) {
      // Persistence is the promotion door's, not the adapter's.
      return { inserted: 0, updated: meetings.length };
    },
  };
}
