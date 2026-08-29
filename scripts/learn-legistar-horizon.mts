/**
 * **ENUMERATE EVERY FIRST-PARTY ROUTE TO ONE BODY'S FUTURE, AND PRINT WHAT EACH
 * ONE ACTUALLY ANSWERED.** (2026-08-28.)
 *
 * ## Why this is an instrument and not a one-off
 *
 * MTG-13 shipped three Pima Board sittings because three is what the two routes
 * anyone had wired AGREED on. The county had fourteen published. Nothing in the
 * repository could have shown that, because nothing enumerated the routes side
 * by side and printed their counts against each other — the disagreement was
 * only ever visible as one number at a time.
 *
 * This prints the whole table. Route, mechanism, observation time, raw count,
 * unique count, earliest, latest, enumeration state, and — the column the
 * defect hid in — **the instances that route is the ONLY publisher of.**
 *
 * ```
 * pnpm tsx scripts/learn-legistar-horizon.mts --tenant pima
 * pnpm tsx scripts/learn-legistar-horizon.mts --tenant mesa --record
 * ```
 *
 * `--record` writes the retrieved documents into `tests/fixtures/` so the
 * suite keeps running against real recorded responses and never a live call.
 *
 * ## What it will not do
 *
 * `pima.granicus.com` publishes `User-agent: * / Disallow: /`. It is printed as
 * a wall with its verdict, the date the rule was read and a null claim about
 * its content, and **it is not fetched, at any rung**. RULING 148: a disallow
 * is never re-walked on a clock. If a route is unreachable the honest output is
 * the wall and the instances we could not confirm — never a fetch anyway, and
 * never an absence claim.
 *
 * The legistar.com apex publishes `Crawl-delay: 2`; `InSiteSession` paces every
 * vendor request at it. `www.pima.gov` publishes no delay for `User-agent: *`.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { localWallClock } from "../lib/sources/event-identity.ts";
import {
  calendarFeedUrl,
  dateRangePostback,
  gridPagePostback,
  parseCalendarRows,
  parseGridNoRecords,
  parseGridPager,
  parseGridPageTargets,
  renderedRange,
  type InSiteRange,
} from "../lib/sources/legistar-insite/calendar.ts";
import { parseClerkSchedule } from "../lib/sources/legistar-insite/clerk-schedule.ts";
import {
  granicusWallObservation,
  intersectionOfRoutes,
  summarizeRoute,
  timelessInstances,
  unionFutureInstances,
  type FirstPartyRoute,
  type RouteInstance,
  type RouteObservation,
} from "../lib/sources/legistar-insite/horizon.ts";
import { InSiteSession } from "../lib/sources/legistar-insite/http.ts";
import { findTenant, INSITE_TENANTS } from "../lib/sources/legistar-insite/tenants.ts";
import { sourceUserAgent } from "../lib/sources/http.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? (args[index + 1] ?? "") : null;
};
const slug = flag("tenant") ?? "pima";
const record = args.includes("--record");
const ROOT = join(import.meta.dirname, "..");

const tenant = findTenant(slug);
if (!tenant) {
  throw new Error(
    `no InSite tenant "${slug}". Known: ${INSITE_TENANTS.map((t) => t.slug).join(", ")}`,
  );
}

const today = localWallClock(new Date().toISOString(), tenant.timeZone)!.date;
const save = (name: string, body: string) => {
  if (!record) return;
  writeFileSync(join(ROOT, "tests/fixtures", name), body);
  console.log(`    recorded tests/fixtures/${name} (${body.length}B)`);
};

/** `M/D/YYYY` + `h:mm AM/PM` as the vendor prints them, to ISO local parts. */
function isoDate(raw: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}
function isoTime(raw: string): string | null {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(raw.trim());
  if (!m) return null;
  const hour = (Number(m[1]) % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${m[2]}`;
}

const observations: RouteObservation[] = [];
const session = new InSiteSession();
const host = tenant.host;
const origin = `https://${host}`;
const calendarUrl = `${origin}/Calendar.aspx`;

// -------------------------------------------------------------------------
// Routes 1 and 2 — the vendor's JSON API. Varied deliberately: the adapter's
// default window is not the route's limit, and the only way to know a route's
// horizon is to ask past it.
// -------------------------------------------------------------------------
const api = tenant.slug;
async function json(url: string): Promise<{ at: string; status: number; body: unknown }> {
  const at = new Date().toISOString();
  const res = await fetch(url, {
    headers: { "User-Agent": sourceUserAgent(), Accept: "application/json" },
  });
  const text = await res.text();
  await new Promise((r) => setTimeout(r, 2000));
  try {
    return { at, status: res.status, body: JSON.parse(text) };
  } catch {
    return { at, status: res.status, body: null };
  }
}

const eventsUrl = `https://webapi.legistar.com/v1/${api}/events?$orderby=EventDate+desc&$top=1000`;
const events = await json(eventsUrl);
const eventRows = Array.isArray(events.body) ? (events.body as Record<string, string>[]) : [];
observations.push(
  summarizeRoute(
    "LEGISTAR_WEBAPI_EVENTS",
    `${eventsUrl} (also probed $filter=EventDate ge datetime'${today}' — 0 rows)`,
    events.at,
    eventRows
      .filter((e) => String(e.EventDate ?? "").slice(0, 10) >= today)
      .map((e) => ({
        route: "LEGISTAR_WEBAPI_EVENTS" as const,
        sourceUrl: eventsUrl,
        observedAt: events.at,
        bodyId: tenant.bodyId,
        date: String(e.EventDate).slice(0, 10),
        time: isoTime(String(e.EventTime ?? "")),
        kind: null,
        location: String(e.EventLocation ?? "") || null,
        vendorId: String(e.EventId ?? "") || null,
        vendorIdSpace: "legistar-webapi",
        publishedText: `${e.EventBodyName} ${e.EventDate} ${e.EventTime}`,
      })),
    eventRows.length > 0 ? "COMPLETE_AS_OBSERVED" : "NOT_RETRIEVED",
    `${eventRows.length} row(s) all-time; the LATEST EventDate this route holds is ` +
      `${eventRows.map((e) => String(e.EventDate).slice(0, 10)).sort().pop() ?? "(none)"}. ` +
      "A zero here is a fact about THIS ROUTE and never about the body.",
  ),
);

for (const future of ["true", "false"]) {
  const url = `https://webapi.legistar.com/v1/${api}/EventDates/${
    api === "pima" ? 138 : 0
  }?FutureDatesOnly=${future}`;
  const dates = await json(url);
  const rows = Array.isArray(dates.body) ? (dates.body as string[]) : [];
  if (future === "true") {
    observations.push(
      summarizeRoute(
        "LEGISTAR_WEBAPI_EVENTDATES",
        url,
        dates.at,
        rows
          .filter((d) => d.slice(0, 10) >= today)
          .map((d) => ({
            route: "LEGISTAR_WEBAPI_EVENTDATES" as const,
            sourceUrl: url,
            observedAt: dates.at,
            bodyId: tenant.bodyId,
            date: d.slice(0, 10),
            // The route publishes DATES. It states no hour, so it cannot key an
            // instance — recorded as timeless rather than given a made-up time.
            time: null,
            kind: null,
            location: null,
            vendorId: null,
            vendorIdSpace: null,
            publishedText: d,
          })),
        rows.length > 0 ? "COMPLETE_AS_OBSERVED" : "NOT_RETRIEVED",
        `HTTP ${dates.status}, ${rows.length} row(s).`,
      ),
    );
  }
  console.log(
    `  EventDates FutureDatesOnly=${future}: HTTP ${dates.status}, ${rows.length} date(s), ` +
      `latest ${rows.slice().sort().pop() ?? "(none)"}`,
  );
  if (record && api === "pima") {
    save(`legistar-pima-eventdates-138-${future === "true" ? "future" : "all"}.json`, JSON.stringify(rows));
  }
}

// -------------------------------------------------------------------------
// Route 3 — Calendar.aspx, every range the dropdown offers that can reach the
// future, each walked through its own pager.
// -------------------------------------------------------------------------
const RANGES_TO_ENUMERATE: InSiteRange[] = [
  "This Month",
  "Next Month",
  "This Year",
  "Next Year",
  "All Years",
];
let latest = (await session.get(calendarUrl, "text/html,application/xhtml+xml")).text;
const gridInstances: RouteInstance[] = [];
const perRange: string[] = [];
let gridComplete = true;

for (const range of RANGES_TO_ENUMERATE) {
  const at = new Date().toISOString();
  if (renderedRange(latest) !== range) {
    latest = (await session.postForm(calendarUrl, dateRangePostback(latest, range))).text;
  }
  const rendered = renderedRange(latest);
  // **The postback is only believed when the page says the filter took.** A
  // missing form field is answered with the page the server already had — 200,
  // correct markup, unchanged filter.
  if (rendered !== range) {
    perRange.push(`  ${range}: POSTBACK DID NOT TAKE — page still renders "${rendered}"`);
    gridComplete = false;
    continue;
  }

  const pager = parseGridPager(latest);
  let rows = parseCalendarRows(latest);
  let walked = 1;
  if (pager && pager.pageCount > 1) {
    let page = latest;
    for (let index = 2; index <= pager.pageCount; index++) {
      const target = parseGridPageTargets(page).get(index);
      if (!target) break;
      page = (await session.postForm(calendarUrl, gridPagePostback(page, target))).text;
      const p = parseGridPager(page);
      if (!p || p.page !== index) break;
      rows = rows.concat(parseCalendarRows(page));
      walked += 1;
      if (record && index === 2) {
        save(`legistar-insite-${tenant.slug}-calendar-${range.replace(/\s+/g, "-").toLowerCase()}-page2.html`, page);
      }
    }
  }
  const short = pager ? rows.length < pager.totalItems : false;
  if (short) gridComplete = false;

  const future = rows.filter((r) => {
    const d = isoDate(r.date);
    return d !== null && d >= today && isWired(r.bodyName);
  });
  for (const row of future) {
    gridInstances.push({
      route: "INSITE_CALENDAR_GRID",
      sourceUrl: calendarUrl,
      observedAt: at,
      bodyId: tenant.bodyId,
      date: isoDate(row.date)!,
      time: isoTime(row.time),
      kind: row.kind,
      location: row.location || null,
      vendorId: row.insiteId,
      vendorIdSpace: "insite",
      publishedText: `${row.date} ${row.time} ${row.bodyName}${row.kind ? ` — ${row.kind}` : ""}`,
    });
  }

  perRange.push(
    `  ${range}: ${rows.length} row(s) across ${walked} page(s)` +
      (pager ? ` of ${pager.pageCount} (pager total ${pager.totalItems})` : " (no pager)") +
      `, ${future.length} future ${tenant.bodyName} sitting(s)` +
      (rows.length === 0
        ? parseGridNoRecords(latest)
          ? ' — publisher stated "No records were found."'
          : " — ZERO WITHOUT THE PUBLISHER SAYING SO: A FAILED RETRIEVAL"
        : "") +
      (short ? " — INCOMPLETE" : ""),
  );

  if (record && ["This Year", "Next Year"].includes(range)) {
    save(
      `legistar-insite-${tenant.slug}-calendar-${range.replace(/\s+/g, "-").toLowerCase()}.html`,
      latest,
    );
  }
}

function isWired(bodyName: string): boolean {
  const wanted = bodyName.trim().toLowerCase();
  return tenant!.bodyNames.some((n) => n.trim().toLowerCase() === wanted);
}

observations.push(
  summarizeRoute(
    "INSITE_CALENDAR_GRID",
    `${calendarUrl} — ranges ${RANGES_TO_ENUMERATE.map((r) => `"${r}"`).join(", ")}`,
    new Date().toISOString(),
    gridInstances,
    gridComplete ? "COMPLETE_AS_OBSERVED" : "INCOMPLETE",
    perRange.join("\n"),
  ),
);

// -------------------------------------------------------------------------
// Route 4 — what Calendar.aspx's own machinery issues. Read off the document,
// not assumed: an assumption about a backing endpoint is how a route gets
// declared missing.
// -------------------------------------------------------------------------
const backing = {
  formAction: /<form[^>]*action="([^"]*)"[^>]*method="post"|<form[^>]*method="post"[^>]*action="([^"]*)"/i.exec(latest),
  pageRequestManager: latest.includes("Sys.WebForms.PageRequestManager"),
  asyncPost: latest.includes("__ASYNCPOST"),
  xhr: latest.includes("XMLHttpRequest"),
};
console.log("\nROUTE 4 — the backing request Calendar.aspx issues, read off the page:");
console.log(
  `  full-page synchronous WebForms postback to its own URL. ` +
    `Sys.WebForms.PageRequestManager=${backing.pageRequestManager}, ` +
    `__ASYNCPOST=${backing.asyncPost}, XMLHttpRequest=${backing.xhr}. ` +
    "No JSON/XHR endpoint behind the grid — the postback IS the backing request.",
);

// -------------------------------------------------------------------------
// Route 6 — the calendar RSS. Its ID/GUID pair is minted per tenant AND per
// range, so it is discovered on the page in hand and never reused.
// -------------------------------------------------------------------------
const feedUrl = calendarFeedUrl(latest, origin);
const feedInstances: RouteInstance[] = [];
let feedState: RouteObservation["enumeration"] = "NOT_RETRIEVED";
let feedNote = `no Feed.ashx link was rendered on ${host}'s calendar page`;
if (feedUrl) {
  const at = new Date().toISOString();
  const xml = (await session.get(feedUrl, "application/rss+xml, application/xml")).text;
  if (record) save(`legistar-insite-${tenant.slug}-feed-widest.xml`, xml);
  const { parseCalendarFeed } = await import("../lib/sources/legistar-insite/calendar.ts");
  for (const item of parseCalendarFeed(xml)) {
    const m = /^(.*?)\s+-\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+-\s+(.+)$/.exec(item.title);
    if (!m || !isWired(m[1])) continue;
    const d = isoDate(m[2]);
    if (!d || d < today) continue;
    feedInstances.push({
      route: "INSITE_CALENDAR_RSS",
      sourceUrl: item.link || feedUrl,
      observedAt: at,
      bodyId: tenant.bodyId,
      date: d,
      time: isoTime(m[3]),
      kind: null,
      location: null,
      vendorId: item.insiteId,
      vendorIdSpace: "insite",
      publishedText: `${item.title}${item.pubDate ? ` (first published ${item.pubDate})` : ""}`,
    });
  }
  feedState = "COMPLETE_AS_OBSERVED";
  feedNote =
    `discovered on the page just fetched — the pair is minted per tenant and per ` +
    `range. It carries pubDate, which nothing else does, and no location or kind.`;
}
observations.push(
  summarizeRoute(
    "INSITE_CALENDAR_RSS",
    feedUrl ?? `${origin}/Feed.ashx?M=Calendar`,
    new Date().toISOString(),
    feedInstances,
    feedState,
    feedNote,
  ),
);

// -------------------------------------------------------------------------
// Routes 5 and 6b — the per-meeting detail page and iCalendar export, probed
// on ONE future row. Corroboration rungs, not per-row fetches.
// -------------------------------------------------------------------------
const sample = gridInstances.find((i) => i.vendorId);
const detailInstances: RouteInstance[] = [];
if (sample) {
  const guid = parseCalendarRows(latest).find((r) => r.insiteId === sample.vendorId)?.insiteGuid;
  if (guid) {
    const icalUrl = `${origin}/View.ashx?M=IC&ID=${sample.vendorId}&GUID=${guid}`;
    const ics = await session.get(icalUrl, "text/calendar");
    console.log(
      `\nROUTE 6b — ${icalUrl}\n  ${ics.text.length}B, BEGIN:VCALENDAR=${/BEGIN:VCALENDAR/.test(ics.text)}. ` +
        "GUID is MANDATORY: ID alone answers 200 with an HTML confirmation page, which is not an error and is not data.",
    );
    if (record) save(`legistar-insite-${tenant.slug}-ical-${sample.vendorId}.ics`, ics.text);

    const detailUrl = `${origin}/MeetingDetail.aspx?ID=${sample.vendorId}&GUID=${guid}&Options=info&Search=`;
    const at = new Date().toISOString();
    const detail = await session.get(detailUrl, "text/html");
    const title = /<title>([\s\S]*?)<\/title>/i.exec(detail.text)?.[1]?.trim() ?? "";
    console.log(
      `\nROUTE 5 — ${detailUrl}\n  HTTP ${detail.status}, ${detail.text.length}B, title="${title}"`,
    );
    detailInstances.push({
      route: "INSITE_MEETING_DETAIL",
      sourceUrl: detailUrl,
      observedAt: at,
      bodyId: tenant.bodyId,
      date: sample.date,
      time: sample.time,
      kind: sample.kind,
      location: sample.location,
      vendorId: sample.vendorId,
      vendorIdSpace: "insite",
      publishedText: title,
    });
  }
}
const notViewable = parseCalendarRows(latest).filter((r) => r.notViewable).length;
observations.push(
  summarizeRoute(
    "INSITE_MEETING_DETAIL",
    `${origin}/MeetingDetail.aspx?ID=…&GUID=…`,
    new Date().toISOString(),
    detailInstances,
    detailInstances.length > 0 ? "COMPLETE_AS_OBSERVED" : "NOT_RETRIEVED",
    `${notViewable} of the rows in view carry class="meeting_NotViewable" and render ` +
      "NO href — that is why the grid publishes no link for them, and it is recorded " +
      "as the reason rather than as an absence. The page ITSELF is reachable when the " +
      "ID/GUID pair is taken from the grid: probed on one future row and it answers 200 " +
      "with the meeting's own title. Not fetched per row on a refresh.",
  ),
);

// -------------------------------------------------------------------------
// Route 7 — the body's OWN publication.
// -------------------------------------------------------------------------
const clerkInstances: RouteInstance[] = [];
let clerkState: RouteObservation["enumeration"] = "NOT_RETRIEVED";
let clerkNote = `no clerk-schedule route is declared for ${tenant.slug} — NOBODY HAS LOOKED. That is a gap in our registry, not a finding about the body.`;
if (tenant.clerkScheduleUrl) {
  const at = new Date().toISOString();
  const res = await fetch(tenant.clerkScheduleUrl, {
    headers: { "User-Agent": sourceUserAgent(), Accept: "text/html" },
  });
  const html = await res.text();
  if (record) save(`legistar-insite-${tenant.slug}-clerk-schedule.html`, html);
  const parsed = parseClerkSchedule(html);
  for (const row of parsed) {
    if (row.date < today) continue;
    clerkInstances.push({
      route: "CLERK_SCHEDULE_PAGE",
      sourceUrl: tenant.clerkScheduleUrl,
      observedAt: at,
      bodyId: tenant.bodyId,
      date: row.date,
      time: row.startTime,
      kind: row.kind,
      location: null,
      vendorId: null,
      vendorIdSpace: null,
      publishedText: row.publishedText,
    });
  }
  clerkState = parsed.length > 0 ? "COMPLETE_AS_OBSERVED" : "NOT_RETRIEVED";
  clerkNote =
    parsed.length > 0
      ? `HTTP ${res.status}, ${parsed.length} scheduled sitting(s) in the table, ${clerkInstances.length} of them future.`
      : `HTTP ${res.status} but no table with "Board Meeting" and "Meeting Type" headers — A FAILED EXTRACTION, never an empty schedule.`;
}
observations.push(
  summarizeRoute(
    "CLERK_SCHEDULE_PAGE",
    tenant.clerkScheduleUrl ?? "(none declared)",
    new Date().toISOString(),
    clerkInstances,
    clerkState,
    clerkNote,
  ),
);

// -------------------------------------------------------------------------
// Route 8 — NOT FETCHED. A permission wall, stated as one.
// -------------------------------------------------------------------------
observations.push(granicusWallObservation());

// -------------------------------------------------------------------------
// The table, the union, and the counterfactual that is forbidden.
// -------------------------------------------------------------------------
const union = unionFutureInstances(observations);
const onlyOn = (route: FirstPartyRoute) =>
  union.filter((i) => i.onlyOn === route).map((i) => `${i.date} ${i.time}`);

console.log(`\n=== ${tenant.slug.toUpperCase()} — ${tenant.bodyName} — future as of ${today} ===\n`);
for (const o of observations) {
  console.log(`${o.route}`);
  console.log(`  mechanism   ${o.mechanism}`);
  console.log(`  observed    ${o.observedAt}`);
  console.log(`  enumeration ${o.enumeration}`);
  console.log(`  raw future  ${o.rawFutureCount}   unique ${o.uniqueFutureCount}`);
  console.log(`  earliest    ${o.earliest ?? "(none)"}   latest ${o.latest ?? "(none)"}`);
  console.log(`  ONLY here   ${onlyOn(o.route).join(", ") || "(none)"}`);
  if (o.note) console.log(`  note        ${o.note.replace(/\n/g, "\n              ")}`);
  console.log("");
}

console.log(`UNION — ${union.length} distinct future sitting(s), the ACCEPTANCE SET:`);
for (const i of union) {
  console.log(
    `  ${i.date} ${i.time}  ${(i.kind ?? "Regular").padEnd(22)} ${(i.location ?? "-").padEnd(38)} ` +
      `routes=[${i.routes.join(", ")}]${i.onlyOn ? `  ONLY ON ${i.onlyOn}` : ""}`,
  );
}

const timeless = timelessInstances(observations).filter((i) => i.date >= today);
console.log(
  `\nTIMELESS — ${timeless.length} future record(s) whose route published no hour ` +
    "(no canonical identity; never given an invented time):",
);
for (const i of timeless) console.log(`  ${i.date}  ${i.route}  "${i.publishedText}"`);

/*
 * **THE DENOMINATOR FLOOR** (RULING 159, RULING 100).
 *
 * Every number above is a count, and a count printed by an instrument that
 * matched nothing is the exact failure this script was written to expose — one
 * layer up, pointed at ourselves. `0 sittings` from a route that answered and
 * `0 sittings` from a parser that stopped matching the vendor's markup print
 * identically, and only one of them is a fact about a county.
 *
 * So the run REFUSES rather than reports when every retrievable route came back
 * empty and not one of them was a publisher's own zero. `PERMISSION_DISALLOWED`
 * does not count as an answer — we never asked — and `PUBLISHER_STATED_EMPTY`
 * does, because the page said so in its own words.
 */
const answering = observations.filter((o) => o.enumeration !== "PERMISSION_DISALLOWED");
const spoke = answering.filter(
  (o) => o.rawFutureCount > 0 || o.enumeration === "PUBLISHER_STATED_EMPTY",
);
const gridRows = parseCalendarRows(latest).length;
if (spoke.length === 0 && gridRows === 0) {
  throw new Error(
    `learn-legistar-horizon: every retrievable route for ${tenant.slug} returned 0 rows ` +
      `and none rendered the publisher's own "No records were found." — ` +
      `routes asked: ${answering.map((o) => o.route).join(", ")}. ` +
      "This is a FAILED ENUMERATION, not a body with no meetings, and it is refused " +
      "rather than printed as a zero.",
  );
}

const wired: FirstPartyRoute[] = ["LEGISTAR_WEBAPI_EVENTS", "INSITE_CALENDAR_GRID"];
console.log(
  `\nTHE FORBIDDEN COUNTERFACTUAL — intersection of [${wired.join(", ")}]: ` +
    `${intersectionOfRoutes(union, wired).length} sitting(s). ` +
    `Union: ${union.length}. Intersection semantics would ship ` +
    `${union.length - intersectionOfRoutes(union, wired).length} fewer.`,
);
