/**
 * Reading Legistar InSite's own calendar grid: the parse, with no network in it.
 *
 * `webapi.legistar.com/v1/{client}/events` returns only sittings whose InSite meeting-detail page is
 * publicly viewable; the others have no WebAPI record at all, and the two routes number meetings in
 * disjoint id spaces. The discriminator is in the grid HTML only: an unpublished sitting renders its
 * "Meeting details" anchor with no href, `class="meeting_NotViewable"` and `title="Not viewable by the
 * public"`. This is vendor behaviour, so the grid is the only route that enumerates every sitting (the RSS
 * feed has no location or kind; the per-meeting iCalendar export needs an ID/GUID pair only the grid
 * supplies).
 *
 * Everything below parses; nothing concludes. A grid yielding zero rows is a failed extraction for the
 * caller to report, never an empty calendar.
 */
import { decodeEntities } from "../http.ts";

/**
 * The hidden and visible form fields an ASP.NET WebForm needs back.
 *
 * Every field the page rendered is returned, not a chosen subset. A postback
 * missing `__VIEWSTATE`, `__EVENTVALIDATION` or a control the page owns is
 * answered with **the page the server already had** — HTTP 200, correct
 * markup, and the filter unchanged. That failure wears a successful status
 * code, so the caller checks the rendered selection afterwards rather than
 * trusting the 200 (`assertSelection` below).
 */
export function parseFormFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    const name = attribute(tag, "name");
    if (!name) continue;
    const type = (attribute(tag, "type") ?? "text").toLowerCase();
    // A submit/button/image control posts only when it is the control clicked;
    // including them all would tell the page several buttons were pressed.
    if (type === "submit" || type === "button" || type === "image") continue;
    if ((type === "checkbox" || type === "radio") && !/\bchecked\b/i.test(tag)) continue;
    fields[name] = decodeEntities(attribute(tag, "value") ?? "");
  }

  for (const match of html.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/gi)) {
    const name = attribute(match[0], "name");
    if (!name) continue;
    const selected = /<option[^>]*\bselected\b[^>]*value="([^"]*)"/i.exec(match[0]);
    const first = /<option[^>]*value="([^"]*)"/i.exec(match[0]);
    fields[name] = decodeEntities(selected?.[1] ?? first?.[1] ?? "");
  }

  return fields;
}

/**
 * The date-range control. InSite renders it as a Telerik `RadComboBox`: a readonly text input carrying
 * the label, plus a hidden `_ClientState` JSON the server reads the selection from. Posting only the text
 * input silently leaves the server on its previous range.
 */
export const DATE_RANGE_CONTROL = "ctl00$ContentPlaceHolder1$lstYears";
const DATE_RANGE_CLIENT_STATE = "ctl00_ContentPlaceHolder1_lstYears_ClientState";

/** The ranges the grid's own dropdown offers. Read off the page, not invented. */
export type InSiteRange =
  | "Last Week"
  | "Last Month"
  | "Last Year"
  | "This Week"
  | "This Month"
  | "This Year"
  | "Next Week"
  | "Next Month"
  | "Next Year"
  | "All Years";

/** The form body that changes the grid's date range to `range`. */
export function dateRangePostback(
  html: string,
  range: InSiteRange,
): Record<string, string> {
  const form = parseFormFields(html);
  form.__EVENTTARGET = DATE_RANGE_CONTROL;
  form.__EVENTARGUMENT = "";
  form[DATE_RANGE_CONTROL] = range;
  form[DATE_RANGE_CLIENT_STATE] = JSON.stringify({
    logEntries: [],
    value: range,
    text: range,
    enabled: true,
    checkedIndices: [],
    checkedItemsTextOverflows: false,
  });
  return form;
}

/** Which range the returned page is actually showing, or null when it cannot be read. */
export function renderedRange(html: string): string | null {
  const match =
    /id="ctl00_ContentPlaceHolder1_lstYears_Input"[^>]*\bvalue="([^"]*)"/.exec(html);
  return match ? decodeEntities(match[1]) : null;
}

/**
 * The grid pages at 100 and states its total (`items 1 to 100 of 148`), so completeness is checkable: a
 * window whose parsed rows fall short of `totalItems` is an incomplete enumeration. Null when the page
 * renders no pager (one page; not a licence to assume completeness).
 */
export interface InSiteGridPager {
  page: number;
  pageCount: number;
  firstItem: number;
  lastItem: number;
  /** What the grid says the range holds, in total. */
  totalItems: number;
}

export function parseGridPager(html: string): InSiteGridPager | null {
  const num = (suffix: string): number | null => {
    const match = new RegExp(
      `<span id='[^']*_gridCalendar_ctl00${suffix}'>(\\d+)</span>`,
    ).exec(html);
    return match ? Number(match[1]) : null;
  };
  const page = num("CPITop");
  const pageCount = num("PCNTop");
  const firstItem = num("FIPTop");
  const lastItem = num("LIPTop");
  const totalItems = num("DSCTop");
  if (
    page === null ||
    pageCount === null ||
    firstItem === null ||
    lastItem === null ||
    totalItems === null
  ) {
    return null;
  }
  return { page, pageCount, firstItem, lastItem, totalItems };
}

/**
 * The grid saying it holds nothing, in its own words: `class="rgNoRecords"` and "No records were found."
 * The only shape in which a zero may stand. False means this page did not say it was empty; a caller
 * holding zero rows and `false` has a wall.
 */
export function parseGridNoRecords(html: string): boolean {
  return /class="rgNoRecords"/i.test(html) && /No records were found/i.test(html);
}

/**
 * Page number → the postback that fetches it, read off the pager itself. Telerik's auto-numbered control
 * ids cannot be derived (a guessed index silently reads the wrong page), so each page's target is read
 * from the `onclick` pair `Telerik.Web.UI.Grid.NavigateToPage('…gridCalendar_ctl00', '3')` beside its
 * `__doPostBack` target. Empty when the page renders no numbered pager.
 */
export function parseGridPageTargets(html: string): Map<number, string> {
  const targets = new Map<number, string>();
  const decoded = decodeEntities(html);
  for (const match of decoded.matchAll(
    /Telerik\.Web\.UI\.Grid\.NavigateToPage\('[^']*gridCalendar[^']*',\s*'(\d+)'\)[\s\S]{0,200}?__doPostBack\('([^']+)'/g,
  )) {
    const page = Number(match[1]);
    // First writer wins: the grid renders the same pager top and bottom, and
    // both copies name the same target. A later duplicate must not overwrite.
    if (!targets.has(page)) targets.set(page, match[2]);
  }
  return targets;
}

/** The form body that walks the grid to `target`, a page link's own postback id. */
export function gridPagePostback(html: string, target: string): Record<string, string> {
  const form = parseFormFields(html);
  form.__EVENTTARGET = target;
  form.__EVENTARGUMENT = "";
  return form;
}

/**
 * One sitting as the grid publishes it.
 *
 * Every field is what the row SAID. Nothing here is derived, and a cell the
 * template did not render is `null` rather than an empty string, because "the
 * portal published no agenda link" and "the portal published an empty agenda
 * link" are different facts about a meeting.
 */
export interface InSiteCalendarRow {
  /** The department/body column, e.g. "Board of Supervisors". */
  bodyName: string;
  /** `DepartmentDetail.aspx?…`, relative as published. */
  bodyHref: string | null;
  /** Verbatim `M/D/YYYY` as printed. */
  date: string;
  /** Verbatim `h:mm AM/PM` as printed — LOCAL wall clock, no zone. */
  time: string;
  /** The room, as printed. */
  location: string;
  /**
   * The `<em>` under the location: the meeting KIND ("Study Session"), which
   * is the only thing distinguishing two sittings of one body on one day.
   * Null when the element is empty — a regular sitting, not an unknown one.
   */
  kind: string | null;
  /** The grid's own meeting id — NOT the WebAPI `EventId`. Disjoint id spaces. */
  insiteId: string | null;
  /** Mandatory alongside the id: `View.ashx?M=IC` without it returns an HTML page. */
  insiteGuid: string | null;
  /** `View.ashx?M=IC&ID=…&GUID=…`, relative as published. */
  icalHref: string | null;
  /** `MeetingDetail.aspx?…` when the sitting is public; null when it is not. */
  detailHref: string | null;
  /**
   * `class="meeting_NotViewable"`, `title="Not viewable by the public"`, no
   * href. **This is the discriminator**: exactly these rows are the ones
   * `webapi /events` does not return.
   */
  notViewable: boolean;
  /** The four document columns, each as printed and each with its link or null. */
  agenda: InSiteDocumentCell;
  accessibleAgenda: InSiteDocumentCell;
  minutes: InSiteDocumentCell;
  accessibleMinutes: InSiteDocumentCell;
}

export interface InSiteDocumentCell {
  /** "Not Available", "Agenda and Addendum", "Summaries" — verbatim. */
  status: string;
  href: string | null;
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(tag);
  return match ? match[1] : null;
}

/** The anchor whose ASP.NET control id ends in `suffix`, inside one row. */
function anchor(row: string, suffix: string): { tag: string; text: string } | null {
  const match = new RegExp(
    `<a\\b[^>]*id="[^"]*_${suffix}"[^>]*>([\\s\\S]*?)</a>`,
    "i",
  ).exec(row);
  if (!match) return null;
  return { tag: match[0].slice(0, match[0].indexOf(">") + 1), text: text(match[1]) };
}

function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function documentCell(row: string, suffix: string): InSiteDocumentCell {
  const found = anchor(row, suffix);
  if (!found) return { status: "", href: null };
  const href = attribute(found.tag, "href");
  return { status: found.text, href: href ? decodeEntities(href) : null };
}

/**
 * Every row in `gridCalendar`, anchored on the Telerik row classes and ASP.NET control-id suffixes rather
 * than column position (a tenant can reorder or hide columns). Returns `[]` for a page with no grid, which
 * is not an empty calendar.
 */
export function parseCalendarRows(html: string): InSiteCalendarRow[] {
  const rows: InSiteCalendarRow[] = [];

  for (const chunk of html.split(/<tr[^>]*class="rg(?:Alt)?Row"/).slice(1)) {
    const row = chunk.slice(0, chunk.indexOf("</tr>") + 5 || undefined);

    const body = anchor(row, "hypBody");
    if (!body) continue;

    // The printed date. The grid renders exactly one M/D/YYYY per row.
    const date = /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/.exec(text(row));
    const time = /<span[^>]*id="[^"]*_lblTime"[^>]*>([\s\S]*?)<\/span>/i.exec(row);

    // The location cell is the one carrying the kind's <em> beneath it.
    const place = /<td[^>]*>\s*<font[^>]*>([^<]*)<br\s*\/?>\s*<em>([\s\S]*?)<\/em>/i.exec(row);

    const ical = anchor(row, "hypiCal");
    const icalHref = ical ? attribute(ical.tag, "href") : null;
    const ids = icalHref
      ? /\bID=(\d+)&(?:amp;)?GUID=([0-9A-Fa-f-]{36})/.exec(decodeEntities(icalHref))
      : null;

    const detail = anchor(row, "hypMeetingDetail");
    const detailHref = detail ? attribute(detail.tag, "href") : null;

    rows.push({
      bodyName: body.text,
      bodyHref: attribute(body.tag, "href")
        ? decodeEntities(attribute(body.tag, "href")!)
        : null,
      date: date ? date[1] : "",
      time: time ? text(time[1]) : "",
      location: place ? decodeEntities(place[1]).trim() : "",
      kind: place && text(place[2]) ? text(place[2]) : null,
      insiteId: ids ? ids[1] : null,
      insiteGuid: ids ? ids[2].toUpperCase() : null,
      icalHref: icalHref ? decodeEntities(icalHref) : null,
      detailHref: detailHref ? decodeEntities(detailHref) : null,
      notViewable:
        detail !== null && detailHref === null && /meeting_NotViewable/.test(detail.tag),
      agenda: documentCell(row, "hypAgenda"),
      accessibleAgenda: documentCell(row, "hypAccessibleAgendaHTML"),
      minutes: documentCell(row, "hypMinutes"),
      accessibleMinutes: documentCell(row, "hypAccessibleMinutesHTML"),
    });
  }

  return rows;
}

/**
 * The RSS link the calendar page itself renders for the range in view. The `ID`/`GUID` pair in
 * `Feed.ashx` is minted per tenant and per range, so it is read off the fetched page, never constructed.
 * The `Mode` and `Title` parameters are dropped (the pair alone returns the same items; those two carry a
 * literal space a naive capture stops on).
 */
export function calendarFeedUrl(html: string, origin: string): string | null {
  const match = /Feed\.ashx\?M=Calendar&(?:amp;)?ID=(\d+)&(?:amp;)?GUID=([0-9A-Fa-f-]{36})/.exec(
    html,
  );
  if (!match) return null;
  return `${origin}/Feed.ashx?M=Calendar&ID=${match[1]}&GUID=${match[2]}`;
}

export interface InSiteFeedItem {
  title: string;
  link: string;
  insiteId: string | null;
  insiteGuid: string | null;
  /** RFC 822 as published; parsed by the caller, kept verbatim here. */
  pubDate: string | null;
  category: string | null;
}

export function parseCalendarFeed(xml: string): InSiteFeedItem[] {
  const items: InSiteFeedItem[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = match[1];
    const link = decodeEntities(tag(item, "link") ?? "");
    const ids = /\bID=(\d+)&GUID=([0-9A-Fa-f-]{36})/.exec(link);
    items.push({
      title: decodeEntities(tag(item, "title") ?? ""),
      link,
      insiteId: ids ? ids[1] : null,
      insiteGuid: ids ? ids[2].toUpperCase() : null,
      pubDate: tag(item, "pubDate"),
      category: tag(item, "category"),
    });
  }
  return items;
}

function tag(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return match ? match[1].trim() : null;
}

export interface InSiteIcalEvent {
  /** Local wall clock as written: `{ year, month, day, hour, minute }`. */
  start: { year: number; month: number; day: number; hour: number; minute: number } | null;
  summary: string | null;
  description: string | null;
  location: string | null;
}

export function parseInSiteIcal(text_: string): InSiteIcalEvent | null {
  if (!/BEGIN:VEVENT/.test(text_)) return null;
  const line = (name: string) => {
    const match = new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, "mi").exec(text_);
    return match ? match[1].trim() : null;
  };
  const dtstart = line("DTSTART");
  const parts = dtstart ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(dtstart) : null;
  return {
    start: parts
      ? {
          year: Number(parts[1]),
          month: Number(parts[2]),
          day: Number(parts[3]),
          hour: Number(parts[4]),
          minute: Number(parts[5]),
        }
      : null,
    summary: line("SUMMARY"),
    description: line("DESCRIPTION"),
    location: line("LOCATION"),
  };
}
