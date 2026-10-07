/**
 * What a council decided, read off its own minutes, for tenants whose clerk does not enter actions in the
 * Legistar Web API. The portal publishes minutes on the tenant host as
 * `View.ashx?M=M&ID=<portal id>&GUID=<guid>` (the link the calendar grid's `hypMinutes` cell carries),
 * answering 200 `application/pdf` with a text layer. The accessible HTML (`hypAccessibleMinutesHTML`) is
 * read first whenever a tenant publishes it.
 *
 * The clerk's template: an item header (`*5-a.`, the asterisk marking the consent agenda), then
 * `It was moved by <member>, seconded by <member>, that <motion>.`,
 * `Upon tabulation of votes, it showed: AYES – <surnames> NAYS – <surnames|None>` and the chair's result
 * (`Carried unanimously.`, `... declared the motion carried by majority vote.`).
 *
 * Everything here parses and nothing concludes. Every field is a verbatim substring of the extracted text
 * (whitespace collapsed), so every record can be quoted back to its page.
 * - A motion with no result we could read is NOT_RECORDED, never failed.
 * - The AYES/NAYS tabulation is carried as text, never as per-member roll-call records.
 * - Minutes with no motion are a failed extraction for the caller to report, unless the minutes
 *   themselves say no formal action was taken.
 * - Action minutes are not approved minutes. The Legistar "Minutes status" field cannot tell them apart;
 *   the document's own title, the grid label and a later sitting's recorded approval are the evidence,
 *   and {@link parseCouncilMinutes} returns all three raw.
 */
import type { NeverRead, ReadStamp } from "../../ops/freshness.ts";
import type { LegistarOutcomeRecord, OutcomeDisposition } from "../legistar/outcomes.ts";

/**
 * Which reading of the minutes this is. A document whose reading failed, or left an "It was moved" passage
 * unread, is read again when this differs from the revision that read it
 * (`lib/outcomes/minutes-ingest.ts`). A change to what this file extracts must change this string;
 * `tests/mesa-minutes-outcomes.test.ts` pins this file's digest beside it.
 */
export const MINUTES_PARSER_REVISION = "2026-09-25.motion-clauses";

/** One page of extracted text, as `lib/extract/text-layer.ts` yields it. */
export interface MinutesPage {
  readonly page: number;
  readonly text: string;
}

/**
 * Which document this is, by its own title.
 *
 * `ACTION_MINUTES` is the clerk's post-meeting action record ("COUNCIL
 * STRATEGIC PLANNING ACTION MINUTES", grid label "Results"): published before
 * the council approves its minutes. `MINUTES` is titled as the council's
 * minutes. Neither says, by itself, that the council approved it.
 */
export type MinutesDocumentKind = "MINUTES" | "ACTION_MINUTES" | "UNRECOGNIZED";

/** One agenda item as the minutes print it. */
export interface MinutesItem {
  /** "5-c", "2", "7-a" — the minutes' own numbering. */
  readonly reference: string;
  /** Marked with the consent-agenda asterisk. */
  readonly consent: boolean;
  /** `*5-c. See: Items not on the Consent Agenda` — pulled for separate action. */
  readonly removedFromConsent: boolean;
  /** Verbatim text from the header to the next header or motion, bounded. */
  readonly text: string;
  /** "Resolution No. 12557", "Ordinance No. 6024", as the item names them. */
  readonly instruments: readonly string[];
  readonly page: number | null;
  readonly offset: number;
}

/** How a motion was tied to the item(s) it disposed of. */
export type MotionItemBasis =
  /** "that the consent agenda items be approved": the consent-agenda item. */
  | "CONSENT_AGENDA"
  /** The motion names a resolution or ordinance an item names. */
  | "NAMED_INSTRUMENT"
  /** The nearest item header before the motion. */
  | "PRECEDING_ITEM"
  /** No header precedes it. */
  | "NONE";

export interface MinutesMotion {
  /** 1-based order of the motion in the document. */
  readonly ordinal: number;
  readonly mover: string | null;
  readonly seconder: string | null;
  /** "that Resolution No. 12559 be adopted" — the motion, verbatim. */
  readonly motion: string;
  /** "AYES – Freeman–Somers–… NAYS – Goforth" — verbatim, never split into members. */
  readonly tally: string | null;
  /** "Mayor Freeman declared the motion carried by majority vote." — verbatim. */
  readonly result: string | null;
  readonly disposition: OutcomeDisposition;
  /** The exact passage from "It was moved" through the result (or as far as it was read). */
  readonly quote: string;
  readonly page: number | null;
  /** Instruments the motion itself names. */
  readonly instruments: readonly string[];
  /** The consent-agenda motion. */
  readonly consentAgenda: boolean;
  /** Item references this motion disposed of. */
  readonly items: readonly string[];
  readonly itemBasis: MotionItemBasis;
}

/** A sitting whose minutes another sitting's minutes approve. */
export interface MinutesApprovalEntry {
  readonly kind: "STUDY_SESSION" | "REGULAR" | "SPECIAL" | "STRATEGIC_PLANNING";
  /** ISO calendar date, `YYYY-MM-DD`. */
  readonly date: string;
}

/** "Approval of minutes of previous meetings as written. Minutes from …". */
export interface MinutesApprovalItem {
  readonly itemReference: string;
  readonly consent: boolean;
  /** The item's own words, verbatim. */
  readonly quote: string;
  readonly sittings: readonly MinutesApprovalEntry[];
}

export interface ParsedCouncilMinutes {
  /** "COUNCIL MINUTES", "COUNCIL STRATEGIC PLANNING ACTION MINUTES", or null. */
  readonly title: string | null;
  readonly kind: MinutesDocumentKind;
  /** The sitting date the header prints, ISO `YYYY-MM-DD`. */
  readonly sittingDate: string | null;
  /** The minutes say, in their own words, that no formal action was taken. */
  readonly statesNoFormalAction: boolean;
  readonly items: readonly MinutesItem[];
  readonly motions: readonly MinutesMotion[];
  readonly approvals: readonly MinutesApprovalItem[];
  /**
   * "It was moved…" passages not in the clerk's usual form, verbatim (bounded).
   * Reported so an unread motion is a named gap, never a silent absence.
   */
  readonly unreadMotions: readonly string[];
  /** Where the body text was cut: at the clerk's attestation, or the end of the text. */
  readonly bodyEndsAt: "ATTESTATION" | "END_OF_TEXT";
  /** Characters of body text parsed. Zero means there was no text to read. */
  readonly bodyCharacters: number;
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const MONTH_PATTERN = "(?:January|February|March|April|May|June|July|August|September|October|November|December)";

function isoDate(month: string, day: string, year: string): string | null {
  const index = MONTHS.indexOf(month.toLowerCase());
  const d = Number(day);
  const y = Number(year);
  if (index < 0 || !Number.isInteger(d) || d < 1 || d > 31 || !Number.isInteger(y)) return null;
  return `${y}-${String(index + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Each page's running header ("Regular Council Meeting July 27, 2026 Page 2",
 * OCR'd as "Study Session June 8, 2026 Page4") is the page's first words and
 * nothing the council did. Removed so a quote never carries it mid-sentence.
 */
const RUNNING_HEADER = new RegExp(
  `^[A-Z][A-Za-z&,'’ ]{2,80}? ${MONTH_PATTERN} \\d{1,2}, \\d{4},? Page ?\\d+\\s*`,
);

interface Body {
  readonly text: string;
  /** Page number for a character offset. */
  readonly pageAt: (offset: number) => number | null;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function bodyOf(pages: readonly MinutesPage[]): { body: Body; endsAt: ParsedCouncilMinutes["bodyEndsAt"]; header: string } {
  const starts: { offset: number; page: number }[] = [];
  let text = "";
  let header = "";
  for (const [index, page] of pages.entries()) {
    let pageText = collapse(page.text);
    if (index === 0) header = pageText.slice(0, 400);
    if (index > 0) pageText = pageText.replace(RUNNING_HEADER, "");
    if (pageText === "") continue;
    if (text !== "") text += " ";
    starts.push({ offset: text.length, page: page.page });
    text += pageText;
  }
  // The minutes end at the clerk's attestation; everything after it is attached presentation text.
  // The OCR of a signed copy can lose "ATTEST:"; the certification sentence survives.
  const attest = [/\bATTEST\s*:/.exec(text), /\bI hereby certify that the foregoing minutes\b/.exec(text)]
    .filter((match): match is RegExpExecArray => match !== null)
    .sort((a, b) => a.index - b.index)[0];
  const endsAt = attest ? "ATTESTATION" : "END_OF_TEXT";
  if (attest) text = text.slice(0, attest.index).trimEnd();
  return {
    body: {
      text,
      pageAt: (offset) => {
        let found: number | null = null;
        for (const start of starts) {
          if (start.offset <= offset) found = start.page;
          else break;
        }
        return found;
      },
    },
    endsAt,
    header,
  };
}

/**
 * The minutes' body text exactly as it is parsed: pages joined, whitespace
 * collapsed, running headers dropped, cut at the attestation. Every quote a
 * record carries is a substring of this.
 */
export function minutesBodyText(pages: readonly MinutesPage[]): string {
  return bodyOf(pages).body.text;
}

function titleOf(header: string): { title: string | null; kind: MinutesDocumentKind; sittingDate: string | null } {
  const match = new RegExp(`OFFICE OF THE CITY CLERK\\s+(.{3,80}?)\\s+(${MONTH_PATTERN}) (\\d{1,2}), (\\d{4})`).exec(header);
  if (!match) return { title: null, kind: "UNRECOGNIZED", sittingDate: null };
  const title = match[1]!.trim();
  const kind: MinutesDocumentKind = /\bACTION MINUTES\b/i.test(title)
    ? "ACTION_MINUTES"
    : /\bMINUTES\b/i.test(title)
      ? "MINUTES"
      : "UNRECOGNIZED";
  return { title, kind, sittingDate: isoDate(match[2]!, match[3]!, match[4]!) };
}

/**
 * "Resolution No. 12557", "Resolution Nos. 12525, 12529, and 12530",
 * "Ordinance Nos. 6008, 6009, 6010, and 6011" → one entry per number.
 */
export function instrumentsIn(text: string): string[] {
  const found: string[] = [];
  // Longest separator first: ", and 12510" must not stop at ", ".
  for (const match of text.matchAll(/\b(Resolution|Ordinance)s? Nos?\.\s*((?:\d{3,6}(?:,\s*and\s+|\s+and\s+|,\s*)?)+)/g)) {
    for (const number of match[2]!.matchAll(/\d{3,6}/g)) {
      const name = `${match[1]} No. ${number[0]}`;
      if (!found.includes(name)) found.push(name);
    }
  }
  return found;
}

/**
 * An item header: `*5-a.` or `12.` followed by the item's words. Numbers that
 * are money, dates, sections or instrument numbers are not headers, and a
 * header whose next words are the tabulation is a displaced margin number, not
 * an item.
 */
const ITEM_HEADER = /(?<=^|\s)(\*?)(\d{1,2}(?:-[a-z])?)\.\s+(?=(?:See:|["“(]|[A-Z]))/g;
const NOT_AN_ITEM_AFTER = /^(?:Upon tabulation|It was moved|A\s?YES|NAYS|Carried|Page\b)/;
/** Money, sections, instrument numbers and number lists ("Chapters 5, 6, and 7.") are not headers. */
const NOT_AN_ITEM_BEFORE = /(?:\bNos?|\bPage|\bSections?|\bChapters?|\bGMP|\bRoute|\bLoop|\bSuite|\$[\d,]*|\d,|\band|\bor|\bof)\s*$/;

interface HeaderHit {
  readonly consent: boolean;
  readonly reference: string;
  readonly offset: number;
  readonly textStart: number;
}

/**
 * Item numbers run in order, and the non-consent section only revisits numbers already seen, so a number
 * more than two past the largest seen is prose, not a header.
 */
const HEADER_SEQUENCE_SLACK = 2;

function headersIn(text: string): HeaderHit[] {
  const hits: HeaderHit[] = [];
  let largest = 0;
  for (const match of text.matchAll(ITEM_HEADER)) {
    const offset = match.index!;
    const textStart = offset + match[0].length;
    if (NOT_AN_ITEM_AFTER.test(text.slice(textStart, textStart + 20))) continue;
    if (NOT_AN_ITEM_BEFORE.test(text.slice(Math.max(0, offset - 12), offset))) continue;
    const number = Number(match[2]!.split("-")[0]);
    // The first header sets the sequence (an excerpt can begin mid-agenda).
    if (number < 1 || number > (largest === 0 ? 40 : largest + HEADER_SEQUENCE_SLACK)) continue;
    largest = Math.max(largest, number);
    hits.push({ consent: match[1] === "*", reference: match[2]!, offset, textStart });
  }
  return hits;
}

/**
 * "It was moved by <member>, seconded by <member>, " and then the motion's own words, in the three forms
 * the clerk writes: "that Resolution No. 12559 be adopted" (the usual form), "receipt of the above listed
 * minutes be acknowledged" (no "that"), and "to direct the City Attorney to …" (an infinitive). The motion
 * is read from the first word after the seconder. The clause must begin with a lower-case word that is
 * not a conjunction; any other continuation stays an unread passage, named, never guessed.
 */
const MOTION_START = /It was moved by ([^,]{3,60}), seconded by ([^,]{3,60}), (?!(?:and|but|or)\b)(?=[a-z])/g;

/**
 * The end of a motion's clause: a sentence end that is not an abbreviation.
 * A displaced margin number ("acknowledged. 4. 5. Upon tabulation", OCR of a
 * signed copy) also ends it.
 */
function clauseEnd(text: string, from: number): number {
  const sentence = /\.(?=\s+(?:[A-Z(“"]|\*?\d{1,2}(?:-[a-z])?\.\s|$)|$)/g;
  sentence.lastIndex = from;
  for (;;) {
    const match = sentence.exec(text);
    if (!match) return text.length;
    const before = text.slice(Math.max(from, match.index - 6), match.index);
    if (/\b(?:No|Nos|Mr|Ms|Mrs|Dr|St|Inc|Co|Jr|Sr|vs|a\.m|p\.m)$/.test(before)) continue;
    return match.index + 1;
  }
}

const SURNAMES = "(?:None|[A-Z][A-Za-z’'_]+(?:\\s*[-–—]\\s*[A-Z][A-Za-z’'_]+)*)";
const TALLY = new RegExp(
  `A\\s?YES\\s*[-–—]\\s*${SURNAMES}\\s+NAYS\\s*[-–—]?\\s*${SURNAMES}` +
    `(?:\\s+(?:ABSENT|ABSTAIN(?:ED|ING)?|RECUSED|EXCUSED|PRESENT)\\s*[-–—]\\s*${SURNAMES})*`,
);

/**
 * The chair's result, in the forms the clerk writes. Carried/passed read as
 * PASSED; failed/defeated/lost/died read as FAILED. Anything else is not read.
 */
const RESULTS: readonly { readonly pattern: RegExp; readonly verb: (match: RegExpExecArray) => string }[] = [
  {
    pattern: /(?:(?:Vice )?Mayor|Chair(?:man|woman|person)?|Vice Chair|Presiding Officer) [A-Z][A-Za-z’'-]+ declared the motion (carried|passed|failed|defeated|lost)[^.]*\./,
    verb: (match) => match[1]!,
  },
  { pattern: /\b(Carried|Failed)(?: unanimously)?(?: by those present)?(?: by (?:a )?(?:majority|unanimous) vote)?\./, verb: (match) => match[1]! },
  { pattern: /\bThe motion (carried|passed|failed|was defeated|died)[^.]*\./i, verb: (match) => match[1]! },
];

function dispositionOf(verb: string): OutcomeDisposition {
  return /^(?:carried|passed)$/i.test(verb) ? "PASSED" : "FAILED";
}

function firstResult(text: string, from: number, to: number): { start: number; end: number; text: string; disposition: OutcomeDisposition } | null {
  const window = text.slice(from, to);
  let best: { start: number; end: number; text: string; disposition: OutcomeDisposition } | null = null;
  for (const { pattern, verb } of RESULTS) {
    const match = pattern.exec(window);
    if (!match) continue;
    if (best === null || match.index < best.start - from) {
      best = {
        start: from + match.index,
        end: from + match.index + match[0].length,
        text: match[0],
        disposition: dispositionOf(verb(match)),
      };
    }
  }
  return best;
}

/** "Minutes from the Study Sessions held on March 26, April 2 and May 18, 2026; the Special Council meeting held on April 20, 2026; …" */
export function approvedSittingsIn(text: string): MinutesApprovalEntry[] {
  const entries: MinutesApprovalEntry[] = [];
  const clause = new RegExp(
    `(Study Sessions?|Regular Council (?:meetings?|Meetings?)|Special Council (?:meetings?|Meetings?)|Strategic Planning Sessions?)` +
      `(?: meetings?)? held on ((?:${MONTH_PATTERN} \\d{1,2}(?:, \\d{4})?(?:,? and |, )?)+)`,
    "g",
  );
  for (const match of text.matchAll(clause)) {
    const label = match[1]!.toLowerCase();
    const kind: MinutesApprovalEntry["kind"] = label.startsWith("study")
      ? "STUDY_SESSION"
      : label.startsWith("special")
        ? "SPECIAL"
        : label.startsWith("strategic")
          ? "STRATEGIC_PLANNING"
          : "REGULAR";
    const list = match[2]!;
    const years = [...list.matchAll(/\b(\d{4})\b/g)].map((year) => year[1]!);
    const lastYear = years.at(-1);
    if (!lastYear) continue;
    for (const day of list.matchAll(new RegExp(`(${MONTH_PATTERN}) (\\d{1,2})(?:, (\\d{4}))?`, "g"))) {
      const date = isoDate(day[1]!, day[2]!, day[3] ?? lastYear);
      if (date && !entries.some((entry) => entry.kind === kind && entry.date === date)) entries.push({ kind, date });
    }
  }
  return entries;
}

const ITEM_TEXT_LIMIT = 600;

/**
 * Parse one council minutes document into its items, motions and approvals.
 *
 * Pure. `pages` is the extracted text layer (or an accessible HTML rendering's
 * text as a single page). The caller decides what an empty result means; this
 * function only reports what the text says.
 */
export function parseCouncilMinutes(pages: readonly MinutesPage[]): ParsedCouncilMinutes {
  const { body, endsAt, header } = bodyOf(pages);
  const { title, kind, sittingDate } = titleOf(header);
  const text = body.text;

  // Motions first: an item header inside a motion's clause is not a header.
  const motionHits: { start: number; mover: string; seconder: string; clauseStart: number; clauseEnd: number }[] = [];
  for (const match of text.matchAll(MOTION_START)) {
    const start = match.index!;
    const clauseStart = start + match[0].length;
    motionHits.push({ start, mover: match[1]!.trim(), seconder: match[2]!.trim(), clauseStart, clauseEnd: clauseEnd(text, clauseStart) });
  }
  const insideClause = (offset: number) => motionHits.some((hit) => offset > hit.start && offset < hit.clauseEnd);
  const unreadMotions = [...text.matchAll(/\bIt was moved\b/g)]
    .filter((match) => !motionHits.some((hit) => hit.start === match.index))
    .map((match) => text.slice(match.index!, match.index! + 200));

  const headers = headersIn(text).filter((hit) => !insideClause(hit.offset));
  const items: MinutesItem[] = headers.map((hit, index) => {
    const nextHeader = headers[index + 1]?.offset ?? text.length;
    const nextMotion = motionHits.find((motion) => motion.start > hit.textStart)?.start ?? text.length;
    const end = Math.min(nextHeader, nextMotion);
    const full = text.slice(hit.textStart, end).trim();
    const itemText = full.length > ITEM_TEXT_LIMIT
      ? `${full.slice(0, full.lastIndexOf(" ", ITEM_TEXT_LIMIT) > 0 ? full.lastIndexOf(" ", ITEM_TEXT_LIMIT) : ITEM_TEXT_LIMIT)}…`
      : full;
    return {
      reference: hit.reference,
      consent: hit.consent,
      removedFromConsent: hit.consent && /^See:\s*Items not on the Consent Agenda/i.test(full),
      text: itemText,
      instruments: instrumentsIn(full),
      page: body.pageAt(hit.offset),
      offset: hit.offset,
    };
  });

  const motions: MinutesMotion[] = motionHits.map((hit, index) => {
    const segmentEnd = motionHits[index + 1]?.start ?? text.length;
    const motion = text.slice(hit.clauseStart, hit.clauseEnd).replace(/\.$/, "");
    const tallyMatch = TALLY.exec(text.slice(hit.clauseEnd, segmentEnd));
    const tallyStart = tallyMatch ? hit.clauseEnd + tallyMatch.index : null;
    const tallyEnd = tallyMatch && tallyStart !== null ? tallyStart + tallyMatch[0].length : null;
    const result = firstResult(text, tallyEnd ?? hit.clauseEnd, segmentEnd);
    const quoteEnd = result?.end ?? tallyEnd ?? hit.clauseEnd;
    const instruments = instrumentsIn(motion);
    const consentAgenda = /\bconsent agenda\b/i.test(motion);

    let itemBasis: MotionItemBasis = "NONE";
    let refs: string[] = [];
    const before = items.filter((item) => item.offset < hit.start);
    if (consentAgenda) {
      const consentItem = [...before].reverse().find((item) => /consent agenda/i.test(item.text));
      if (consentItem) {
        itemBasis = "CONSENT_AGENDA";
        refs = [consentItem.reference];
      }
    }
    if (refs.length === 0 && instruments.length > 0) {
      const named = items.filter((item) => !item.removedFromConsent && item.instruments.some((name) => instruments.includes(name)));
      // An instrument named twice (the consent placeholder's section and the
      // full item) keeps the item that carries the full text: the non-consent one.
      const byReference = new Map<string, MinutesItem>();
      for (const item of named) {
        const held = byReference.get(item.reference);
        if (!held || (held.consent && !item.consent)) byReference.set(item.reference, item);
      }
      if (byReference.size > 0) {
        itemBasis = "NAMED_INSTRUMENT";
        refs = [...byReference.keys()];
      }
    }
    if (refs.length === 0) {
      const preceding = [...before].reverse().find((item) => !item.removedFromConsent);
      if (preceding) {
        itemBasis = "PRECEDING_ITEM";
        refs = [preceding.reference];
        // "that receipt of the above listed minutes be acknowledged": the
        // motion disposes of the whole group under its parent header.
        const parent = preceding.reference.includes("-") ? preceding.reference.split("-")[0]! : null;
        if (parent && /\babove[- ]listed\b|\bthe following\b/i.test(motion) && items.some((item) => item.reference === parent)) {
          refs = [parent, ...items.filter((item) => item.reference.startsWith(`${parent}-`) && item.offset < hit.start).map((item) => item.reference)];
        }
      }
    }

    return {
      ordinal: index + 1,
      mover: hit.mover,
      seconder: hit.seconder,
      motion,
      tally: tallyMatch ? tallyMatch[0] : null,
      result: result?.text ?? null,
      disposition: result?.disposition ?? "NOT_RECORDED",
      quote: text.slice(hit.start, quoteEnd),
      page: body.pageAt(hit.start),
      instruments,
      consentAgenda,
      items: [...new Set(refs)],
      itemBasis,
    };
  });

  const approvals: MinutesApprovalItem[] = items
    .filter((item) => /\bApproval of minutes\b/i.test(item.text))
    .map((item) => ({
      itemReference: item.reference,
      consent: item.consent,
      quote: item.text,
      sittings: approvedSittingsIn(item.text),
    }));

  return {
    title,
    kind,
    sittingDate,
    statesNoFormalAction: /\bno formal action (?:was )?taken\b/i.test(text),
    items,
    motions,
    approvals,
    unreadMotions,
    bodyEndsAt: endsAt,
    bodyCharacters: text.length,
  };
}

/** The item that carries a reference, preferring the full (non-placeholder) one. */
export function minutesItem(parsed: ParsedCouncilMinutes, reference: string): MinutesItem | null {
  const matches = parsed.items.filter((item) => item.reference === reference && !item.removedFromConsent);
  return matches.find((item) => !item.consent) ?? matches[0] ?? null;
}

/**
 * The consent-agenda items the consent motion carried: every asterisked item
 * not pulled for separate action, each once.
 */
export function consentItems(parsed: ParsedCouncilMinutes): readonly MinutesItem[] {
  const seen = new Set<string>();
  const kept: MinutesItem[] = [];
  const pulled = new Set(parsed.items.filter((item) => item.removedFromConsent).map((item) => item.reference));
  for (const item of parsed.items) {
    if (!item.consent || item.removedFromConsent || pulled.has(item.reference) || seen.has(item.reference)) continue;
    seen.add(item.reference);
    kept.push(item);
  }
  return kept;
}

/* ------------------------------------------------------------------ *
 * Minutes → outcome records
 * ------------------------------------------------------------------ */

export interface MinutesRecordContext {
  /** The portal's own sitting id (`legistar-insite:<slug>:<id>`). */
  readonly eventId: number;
  /** The publisher, never the vendor (e.g. a city clerk's office). */
  readonly sourceOrg: string;
  /** The exact minutes URL read. */
  readonly documentUrl: string;
  /** The stamp minted from the document read. */
  readonly readOn: ReadStamp | NeverRead;
}

const ITEM_QUOTE_LIMIT = 320;

function bounded(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.lastIndexOf(" ", limit);
  return `${text.slice(0, cut > 0 ? cut : limit)}…`;
}

/** The items as the minutes print them: one item's own words, or each item's with its number. */
function itemQuoteFor(parsed: ParsedCouncilMinutes, references: readonly string[]): string | null {
  const items = references.map((reference) => minutesItem(parsed, reference)).filter((item): item is MinutesItem => item !== null);
  if (items.length === 0) return null;
  if (items.length === 1) return bounded(items[0]!.text, ITEM_QUOTE_LIMIT);
  return items.map((item) => `${item.reference}. ${bounded(item.text, 200)}`).join(" ");
}

/**
 * The section header one sub-item sits under. "6. Introduction of the
 * following ordinances …" is what approving the sub-item did: introduce, not
 * adopt, so the header travels with it.
 */
function sectionQuoteFor(parsed: ParsedCouncilMinutes, references: readonly string[]): string | null {
  if (references.length !== 1 || !references[0]!.includes("-")) return null;
  const item = minutesItem(parsed, references[0]!);
  const parent = minutesItem(parsed, references[0]!.split("-")[0]!);
  return item && parent && parent.offset < item.offset ? `${parent.reference}. ${bounded(parent.text, 200)}` : null;
}

function matterFileFor(parsed: ParsedCouncilMinutes, references: readonly string[], motionInstruments: readonly string[]): string | null {
  const named = motionInstruments.length > 0
    ? motionInstruments
    : references.flatMap((reference) => minutesItem(parsed, reference)?.instruments ?? []);
  if (named.length > 0) return [...new Set(named)].join(", ");
  for (const reference of references) {
    const caseNumber = /\b[A-Z]{2,5}\d{2}-\d{3,6}\b/.exec(minutesItem(parsed, reference)?.text ?? "");
    if (caseNumber) return caseNumber[0];
  }
  return null;
}

function rollCallGapFor(tally: string | null): string {
  return tally
    ? "The minutes list the ayes and nays by surname, quoted in the tally. That tabulation is " +
        "carried verbatim; it has not been turned into per-member roll-call records."
    : "The minutes record no tabulation of votes for this motion.";
}

function dispositionGapFor(disposition: OutcomeDisposition): string | null {
  return disposition === "NOT_RECORDED"
    ? "The minutes record this motion and, in the text we could read, no result for it. " +
        "That is not a record of it failing."
    : null;
}

/**
 * The outcome records one minutes document supports.
 *
 * One record per motion, and — when the consent-agenda motion is read — one
 * per consent item it carried, each carrying that motion's words, tally and
 * result: the minutes say the asterisked items were "considered by the City
 * Council as a group", so the group's recorded result is each item's recorded
 * result. An item pulled from consent is not among them; its own motion is.
 */
export function minutesOutcomeRecords(
  parsed: ParsedCouncilMinutes,
  context: MinutesRecordContext,
): LegistarOutcomeRecord[] {
  const provenance = { endpoint: context.documentUrl, sourceOrg: context.sourceOrg, readOn: context.readOn };
  const records: LegistarOutcomeRecord[] = [];
  const push = (record: Omit<LegistarOutcomeRecord, "eventItemId">) =>
    records.push({ ...record, eventItemId: records.length + 1 });

  for (const motion of parsed.motions) {
    push({
      recordClass: "ACTION_SUMMARY",
      eventId: context.eventId,
      matterFile: matterFileFor(parsed, motion.items, motion.instruments),
      action: motion.motion,
      disposition: motion.disposition,
      dispositionRaw: motion.result,
      dispositionConflict: null,
      dispositionGap: dispositionGapFor(motion.disposition),
      mover: motion.mover,
      seconder: motion.seconder,
      tallyText: motion.tally,
      matterStatus: null,
      onConsentCalendar: motion.consentAgenda,
      rollCall: "NOT_RETRIEVED",
      rollCallGap: rollCallGapFor(motion.tally),
      provenance,
      itemReference: motion.items.length > 0 ? motion.items.join(", ") : null,
      itemQuote: itemQuoteFor(parsed, motion.items),
      sectionQuote: sectionQuoteFor(parsed, motion.items),
      quote: motion.quote,
      page: motion.page,
    });

    if (!motion.consentAgenda) continue;
    for (const item of consentItems(parsed)) {
      push({
        recordClass: "ACTION_SUMMARY",
        eventId: context.eventId,
        matterFile: matterFileFor(parsed, [item.reference], []),
        action: motion.motion,
        disposition: motion.disposition,
        dispositionRaw: motion.result,
        dispositionConflict: null,
        dispositionGap: dispositionGapFor(motion.disposition),
        mover: motion.mover,
        seconder: motion.seconder,
        tallyText: motion.tally,
        matterStatus: null,
        onConsentCalendar: true,
        rollCall: "NOT_RETRIEVED",
        rollCallGap: rollCallGapFor(motion.tally),
        provenance,
        itemReference: item.reference,
        itemQuote: itemQuoteFor(parsed, [item.reference]),
        sectionQuote: sectionQuoteFor(parsed, [item.reference]),
        quote: motion.quote,
        page: item.page,
      });
    }
  }
  return records;
}
