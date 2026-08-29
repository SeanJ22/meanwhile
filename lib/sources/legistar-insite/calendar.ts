/**
 * Reading Legistar InSite's own calendar grid — the parse, with no network in
 * it.
 *
 * ## The measurement this file exists because of (2026-08-28)
 *
 * `webapi.legistar.com/v1/{client}/events` returns only the sittings whose
 * InSite **meeting-detail page is publicly viewable**. It is not an
 * agenda-status filter and it is not missing data: the events the API omits
 * have no WebAPI record at all — 40 of 40 probed ids 404 on the item endpoint —
 * and the two routes number their meetings in **disjoint id spaces**
 * (`EventInSiteURL` points at `MeetingDetail.aspx?LEGID=<apiEventId>`, while
 * the calendar grid's own links carry `ID=1381575`).
 *
 * The discriminator is in the grid HTML and nowhere else: an unpublished
 * sitting renders its "Meeting details" anchor with **no href**,
 * `class="meeting_NotViewable"` and `title="Not viewable by the public"`.
 *
 * Measured the same day, all three tenants on the same "Next Month" filter:
 *
 * | tenant | grid rows | `meeting_NotViewable` | rows `/events` returned |
 * | --- | --- | --- | --- |
 * | Mesa | 15 | 12 | exactly the 3 viewable |
 * | Phoenix | 8 | 8 | 0 |
 * | Pima | 3 | 3 | 0 |
 *
 * So this is a **class behaviour of the vendor**, not a Pima configuration. Any
 * wired Legistar tenant loses its unpublished future sittings through the API
 * alone, and the grid is the only route that enumerates them completely: the
 * RSS feed carries no location and no meeting kind, and the per-meeting
 * iCalendar export needs an ID and GUID pair that only the grid supplies.
 *
 * Everything below parses; nothing below concludes. A grid that yields zero
 * rows is a failed extraction for the caller to report as one — never an empty
 * calendar.
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
 * The date-range control, and why it is not a `<select>`.
 *
 * InSite renders the range picker as a Telerik `RadComboBox`: a readonly text
 * input carrying the LABEL, plus a hidden `_ClientState` JSON the server reads
 * the selection from. Posting only the text input leaves the server on its
 * previous range — which is the silent no-op above, and it is what a first
 * attempt at this actually did: HTTP 200, 231 KB of correct HTML, and "This
 * Month" still selected.
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
 * **THE GRID PAGES AT 100, AND IT SAYS SO OUT LOUD.** (Measured 2026-08-28.)
 *
 * Mesa's "This Year" filter answers with `items 1 to 100 of 148` and a two-page
 * pager. A parse that only counted rows would report **100 sittings and a clean
 * 200** for a range holding 148 — the same shape of failure this whole adapter
 * exists to correct, one layer down: a route answering completely about the part
 * it chose to send.
 *
 * The pager states the total, so completeness is CHECKABLE rather than assumed.
 * A window whose parsed rows fall short of `totalItems` is an **incomplete
 * enumeration**, reported as one; it is never handed upward as the range's
 * answer.
 *
 * Null when the page renders no pager. That is the normal case for a small
 * range and means "one page, nothing to reconcile against" — it is not a
 * licence to assume completeness, which is why the caller compares only when a
 * total is actually published.
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
 * **THE GRID SAYING IT HOLDS NOTHING, IN ITS OWN WORDS.** (Measured 2026-08-28.)
 *
 * `parseCalendarRows` returns `[]` for two completely different pages: one
 * where the grid rendered and the publisher stated it has no rows for this
 * filter, and one where the grid did not render at all — a challenge page, a
 * session that expired, a template change this parser no longer matches.
 * **Reporting those as the same fact is exactly the failure this adapter
 * exists to correct**, and RULING 100 is explicit that a zero-row extraction is
 * a FAILED extraction unless the source itself said zero.
 *
 * Pima's "Next Year" filter is the measured positive: HTTP 200, the grid
 * present, `class="rgNoRecords"` and the literal sentence **"No records were
 * found."**. That is Pima County stating that it has published no 2027 Board
 * sittings yet. It is a fact about the publisher, and it is the ONLY shape in
 * which this adapter will let a zero stand.
 *
 * False therefore never means "there are rows". It means **this page did not
 * say it was empty**, and a caller holding zero rows and `false` has a wall.
 */
export function parseGridNoRecords(html: string): boolean {
  return /class="rgNoRecords"/i.test(html) && /No records were found/i.test(html);
}

/**
 * **PAGE NUMBER → THE POSTBACK THAT FETCHES IT, READ OFF THE PAGER ITSELF.**
 * (2026-08-28.)
 *
 * The trap this replaces is a measured one. The pager's controls are ASP.NET
 * auto-numbered — `…$gridCalendar$ctl00$ctl02$ctl00$ctl02`, `…$ctl04`,
 * `…$ctl06` — and the indices are neither stable nor in an order anyone can
 * derive: posting `ctl03$ctl01$ctl06` at Pima's "All Years" grid, guessed as
 * "the next-page button", returned **page 3**. It returned it with HTTP 200,
 * the right range still rendered, and 100 perfectly well-formed rows. A
 * guessed control index does not fail; it silently reads the wrong page and
 * calls it the next one, and the enumeration then skips a hundred sittings
 * while every check passes.
 *
 * So the mapping is never constructed. Telerik renders each numbered page link
 * with its intended page in its own `onclick` —
 * `Telerik.Web.UI.Grid.NavigateToPage('…gridCalendar_ctl00', '3')` — beside the
 * `__doPostBack` target that fetches it. This reads the pair the page
 * published, so "the target for page 3" is a fact off the document rather than
 * an arithmetic guess about a vendor's control tree.
 *
 * Empty map when the page renders no numbered pager. One page, nothing to walk.
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
 * Every row in `gridCalendar`.
 *
 * Anchored on the Telerik row classes and on the ASP.NET control-id suffixes
 * rather than on column position, because a tenant can reorder or hide the
 * grid's columns from its own admin screen — and a positional parse would then
 * read the minutes column as the agenda and publish the wrong link.
 *
 * Returns `[]` for a page with no grid. **That is not an empty calendar and
 * must not be reported as one**: the caller checks the count against what the
 * page said it was showing.
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
 * The RSS link the calendar page itself renders for the range in view.
 *
 * **Discovered, never constructed.** The `ID`/`GUID` pair in `Feed.ashx` is
 * minted per tenant AND per range — Pima's "Next Month" feed is
 * `ID=43473383`, and the pair recorded for a different range is a different
 * number. Reading it off the page that was just fetched is the only way the
 * URL is a fact rather than a guess.
 *
 * The page renders the link with two further parameters, `Mode` and `Title`,
 * and they are dropped: verified live 2026-08-28 that the pair alone returns
 * the identical three items with the identical `pubDate`s. They are also the
 * two parameters carrying a literal space, which is what a naive capture stops
 * on — a truncated URL that still looks like a URL.
 */
export function calendarFeedUrl(html: string, origin: string): string | null {
  const match = /Feed\.ashx\?M=Calendar&(?:amp;)?ID=(\d+)&(?:amp;)?GUID=([0-9A-Fa-f-]{36})/.exec(
    html,
  );
  if (!match) return null;
  return `${origin}/Feed.ashx?M=Calendar&ID=${match[1]}&GUID=${match[2]}`;
}

/**
 * One item of the calendar RSS.
 *
 * The feed is a poorer enumeration than the grid — no location, no meeting
 * kind — and it carries one thing the grid does not: `pubDate`, **the instant
 * InSite itself published the sitting**. That is the vendor's own publication
 * clock, and it is what makes "the API's forward horizon is short" a
 * measurement rather than an opinion.
 */
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

/**
 * The per-meeting iCalendar export.
 *
 * **`DTSTART` is FLOATING** — `20260908T130000`, no `Z`, no `TZID`. It is the
 * body's wall clock and nothing else, so it is returned as the parts that were
 * written and never as an instant: reading it as UTC would move Pima's 1:00 PM
 * study session to 6:00 AM and would do it silently.
 *
 * The `GUID` is mandatory on the request. `View.ashx?M=IC&ID=…` without it
 * answers **200 with a 19 KB HTML confirmation page**, not an error — a
 * successful status carrying the wrong document, which is why the caller
 * declares `BEGIN:VCALENDAR` as the document marker.
 */
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
