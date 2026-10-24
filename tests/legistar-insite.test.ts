import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { collapseDuplicateSittings } from "../lib/sources/composite/index.ts";
import { CAPABILITIES } from "../lib/sources/composite/wiring.ts";
import {
  reconcileSittings,
  sittingKey,
  type MeetingLike,
} from "../lib/sources/event-identity.ts";
import {
  normalizeWithDrops as legistarNormalize,
  type LegistarEventWithClient,
} from "../lib/sources/legistar/index.ts";
import { LEGISTAR_CLIENTS } from "../lib/sources/legistar/client-registry.ts";
import {
  calendarFeedUrl,
  dateRangePostback,
  parseCalendarFeed,
  parseCalendarRows,
  parseGridNoRecords,
  parseGridPager,
  parseGridPageTargets,
  parseInSiteIcal,
  renderedRange,
  type InSiteGridPager,
  type InSiteRange,
} from "../lib/sources/legistar-insite/calendar.ts";
import {
  RANGES,
  makeLegistarInSiteSource,
  normalizeWithDrops,
  type LegistarInSiteRaw,
} from "../lib/sources/legistar-insite/index.ts";
import { INSITE_TENANTS } from "../lib/sources/legistar-insite/tenant-registry.ts";
import type { Meeting } from "../lib/sources/types.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

const NOW = new Date("2026-08-28T12:00:00Z");

const PIMA_LAST_MONTH = fixture("legistar-insite-pima-calendar-last-month.html");
const PIMA_NEXT_MONTH = fixture("legistar-insite-pima-calendar-next-month.html");
const PIMA_THIS_MONTH = fixture("legistar-insite-pima-calendar-this-month.html");
const MESA_NEXT_MONTH = fixture("legistar-insite-mesa-calendar-next-month.html");
const MESA_THIS_YEAR_PAGED = fixture("legistar-insite-mesa-calendar-this-year-paged.html");
const MESA_THIS_YEAR_PAGE2 = fixture("legistar-insite-mesa-calendar-this-year-page2.html");
const PIMA_THIS_YEAR = fixture("legistar-insite-pima-calendar-this-year.html");
const PIMA_NEXT_YEAR = fixture("legistar-insite-pima-calendar-next-year.html");
const PIMA_FEED = fixture("legistar-insite-pima-feed.xml");

const WEBAPI_AUG_OCT = JSON.parse(
  fixture("legistar-insite-pima-webapi-aug-oct.json"),
) as Record<string, unknown>[];

/** `noRecords` is read off the page itself so a test cannot assert the zero-licensing signal by hand. */
export function win(
  range: InSiteRange,
  html: string,
  pager: InSiteGridPager | null = null,
): LegistarInSiteRaw["windows"][number] {
  return {
    range,
    rendered: range,
    html,
    pager,
    pages: [],
    noRecords: parseGridNoRecords(html),
  };
}

function pimaReading(
  overrides: Partial<LegistarInSiteRaw> = {},
): LegistarInSiteRaw {
  return {
    slug: "pima",
    calendarUrl: "https://pima.legistar.com/Calendar.aspx",
    windows: [win("This Month", PIMA_THIS_MONTH), win("Next Month", PIMA_NEXT_MONTH)],
    feedXml: PIMA_FEED,
    feedUrl:
      "https://pima.legistar.com/Feed.ashx?M=Calendar&ID=43473383&GUID=88b7d677-6602-4f79-b987-4677f7f035e6",
    icalByInsiteId: {},
    clerkScheduleHtml: null,
    clerkScheduleUrl: null,
    collectedAt: "2026-08-28T18:30:00.000Z",
    ...overrides,
  };
}

function webapiMeetings(events: Record<string, unknown>[] = WEBAPI_AUG_OCT): Meeting[] {
  const raw = events.map((event) => ({
    event,
    slug: "pima",
    collectedAt: "2026-08-28T18:30:00.000Z",
    items: null,
  })) as unknown as LegistarEventWithClient[];
  return legistarNormalize(raw, NOW).meetings;
}

test("the WebAPI returns ZERO September rows — the measurement, reproduced", () => {
  const september = WEBAPI_AUG_OCT.filter((event) =>
    String(event.EventDate).startsWith("2026-09"),
  );
  assert.equal(
    september.length,
    0,
    "the recorded /events window must still contain no September row, or this whole file is testing a different world",
  );
  assert.equal(
    WEBAPI_AUG_OCT.length,
    7,
    "and it must still contain the seven August rows that were reconciled into a false conclusion",
  );
});

test("(a) zero rows from /events does NOT mean the county has no September sittings", () => {
  const fromApi = webapiMeetings();
  assert.equal(
    fromApi.filter((m) => m.startsAt.startsWith("2026-09")).length,
    0,
    "the API route alone still yields nothing in September",
  );

  const fromPortal = normalizeWithDrops([pimaReading()], NOW).meetings;
  const merged = collapseDuplicateSittings([...fromApi, ...fromPortal]).rows;
  const september = merged
    .filter((m) => m.startsAt.startsWith("2026-09"))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  assert.equal(
    september.length,
    3,
    "the composition of both routes must yield the three sittings the county actually published",
  );
  assert.deepEqual(
    september.map((m) => `${m.startsAt} ${m.title}`),
    [
      "2026-09-08T13:00:00-07:00 Study Session",
      "2026-09-08T17:00:00-07:00 Board of Supervisors",
      "2026-09-22T17:00:00-07:00 Board of Supervisors",
    ],
  );
});

test("(b) the three Pima sittings reach the canonical layer with date, time, kind, location and provenance", () => {
  const result = normalizeWithDrops([pimaReading()], NOW);
  const september = result.meetings
    .filter((m) => m.startsAt.startsWith("2026-09"))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  assert.equal(september.length, 3);
  for (const meeting of september) {
    assert.equal(meeting.timeZone, "America/Phoenix");
    assert.equal(meeting.bodyId, "ocd-division/country:us/state:az/county:pima#governing");
    assert.equal(meeting.ocdId, "ocd-division/country:us/state:az/county:pima");
    assert.equal(meeting.bodyName, "Board of Supervisors");
    assert.equal(meeting.status, "SCHEDULED");
    assert.equal(
      meeting.venueGap?.publishedText,
      "Board of Supervisors' Hearing Room",
    );
    assert.equal(meeting.jurisdiction, "Pima County, AZ");
    assert.equal(meeting.provenance.sourceOrg, "Pima County Clerk of the Board");
    assert.equal(meeting.provenance.sourceUrl, "https://pima.legistar.com/Calendar.aspx");
    assert.equal(
      meeting.agendaUrl,
      null,
      'the portal says "Not Available"; a null renders as the named gap and is never filled in',
    );
    assert.equal(meeting.provenance.verifiedAt, null);
  }

  assert.deepEqual(
    september.map((m) => m.id),
    [
      "legistar-insite:pima:1381575",
      "legistar-insite:pima:1381576",
      "legistar-insite:pima:1381577",
    ],
  );
});

test("(b) the accounting conserves: every grid row is produced, dropped or named", () => {
  const result = normalizeWithDrops([pimaReading()], NOW);
  assert.equal(result.accounting.outcome, "CONSERVED");
  assert.equal(result.accounting.logicalInput, 10, "7 August rows plus 3 September rows");
  assert.equal(result.meetings.length, 10);
  assert.equal(
    result.drops.placeless,
    2,
    "the two virtual sittings are TALLIED as placeless and KEPT (D18), never dropped",
  );
  assert.equal(
    result.meetings.filter((m) => m.online).length,
    2,
    "and they arrive with an online block and a null location",
  );
});

test("(c) NAMED REGRESSION: the 8 September 1:00 PM Study Session survives to the canonical layer", () => {
  const meetings = normalizeWithDrops([pimaReading()], NOW).meetings;
  const study = meetings.find((m) => m.id === "legistar-insite:pima:1381575");

  assert.ok(
    study,
    "the sitting that could NOT have been synthesised from the committed recurrence rule is gone",
  );
  assert.equal(study.startsAt, "2026-09-08T13:00:00-07:00");
  assert.equal(study.title, "Study Session");
  assert.equal(study.timeZone, "America/Phoenix");
  assert.equal(study.status, "SCHEDULED");
  assert.equal(
    study.venueGap?.publishedText,
    "Board of Supervisors' Hearing Room",
  );

  assert.notEqual(study.startsAt.slice(11, 16), "17:00");
});

test("(c) its own iCalendar export agrees, and its FLOATING time is not read as UTC", () => {
  const ics = parseInSiteIcal(fixture("legistar-insite-pima-ical-1381575.ics"));
  assert.ok(ics?.start);
  assert.deepEqual(ics.start, { year: 2026, month: 9, day: 8, hour: 13, minute: 0 });
  assert.equal(ics.description, "Study Session");

  // `DTSTART:20260908T130000` carries no `Z` and no `TZID`: it is floating local time, not UTC.
  const asUtc = new Date("2026-09-08T13:00:00Z").toISOString();
  const meetings = normalizeWithDrops([pimaReading()], NOW).meetings;
  const study = meetings.find((m) => m.id === "legistar-insite:pima:1381575")!;
  assert.notEqual(new Date(study.startsAt).toISOString(), asUtc);
  assert.equal(new Date(study.startsAt).toISOString(), "2026-09-08T20:00:00.000Z");
});

test("the two routes number the same sittings differently — 7 of 7 agree on time, 0 of 7 on id", () => {
  const api = webapiMeetings();
  const portal = normalizeWithDrops([pimaReading()], NOW).meetings;

  const apiKeys = new Set(
    api.map((m) => sittingKey({ bodyId: m.bodyId, startsAt: m.startsAt, timeZone: m.timeZone })),
  );
  const august = portal.filter((m) => m.startsAt.startsWith("2026-08"));
  assert.equal(august.length, 7);
  for (const m of august) {
    assert.ok(
      apiKeys.has(sittingKey({ bodyId: m.bodyId, startsAt: m.startsAt, timeZone: m.timeZone })),
      `no API row shares the sitting key of ${m.id} (${m.startsAt})`,
    );
  }

  const apiIds = new Set(api.map((m) => m.id.split(":").pop()));
  for (const m of august) {
    assert.equal(
      apiIds.has(m.id.split(":").pop()!),
      false,
      `${m.id} shares an id with the API — the id spaces were meant to be disjoint`,
    );
  }
});

test("(g) NEGATIVE CONTROL: a viewable sitting carried by BOTH routes is not double-counted", () => {
  const api = webapiMeetings();
  const portal = normalizeWithDrops([pimaReading()], NOW).meetings;
  const merged = collapseDuplicateSittings([...api, ...portal]);

  const august = merged.rows.filter((m) => m.startsAt.startsWith("2026-08"));
  assert.equal(
    august.length,
    7,
    `seven August sittings were published; the merge kept ${august.length}`,
  );
  assert.equal(merged.collapsed, 7, "and it says out loud that it collapsed seven");

  const instants = august.map((m) => m.startsAt);
  assert.equal(new Set(instants).size, instants.length);
});

test("(d) the richer record wins: the API row supersedes the portal row on the same sitting", () => {
  const api = webapiMeetings();
  const portal = normalizeWithDrops([pimaReading()], NOW).meetings;
  const merged = collapseDuplicateSittings([...api, ...portal]).rows;

  for (const meeting of merged.filter((m) => m.startsAt.startsWith("2026-08"))) {
    assert.ok(
      meeting.id.startsWith("legistar:"),
      `${meeting.id} won the merge, but the WebAPI record carries the agenda file and should have`,
    );
    assert.ok(meeting.agendaUrl, `${meeting.id} won without the agenda that made it richer`);
  }

  for (const meeting of merged.filter((m) => m.startsAt.startsWith("2026-09"))) {
    assert.ok(meeting.id.startsWith("legistar-insite:"));
  }
});

test("(d) a September sitting APPEARING in /events later deduplicates rather than doubling", () => {
  const finalised = webapiMeetings([
    {
      ...WEBAPI_AUG_OCT[2],
      EventId: 1880,
      EventDate: "2026-09-08T00:00:00",
      EventTime: "5:00 PM",
      EventAgendaFile: "https://pima.legistar.com/View.ashx?M=A&ID=1880&GUID=stub",
      EventInSiteURL: "https://pima.legistar.com/MeetingDetail.aspx?LEGID=1880&GID=243",
    },
  ]);
  assert.equal(finalised.length, 1);

  const portal = normalizeWithDrops([pimaReading()], NOW).meetings;
  const merged = collapseDuplicateSittings([...finalised, ...portal]);

  const at5pm = merged.rows.filter((m) => m.startsAt === "2026-09-08T17:00:00-07:00");
  assert.equal(at5pm.length, 1, "the 8 September 5:00 PM sitting must render once, not twice");
  assert.ok(
    at5pm[0].id.startsWith("legistar:"),
    "and the record with the agenda must be the one that survives",
  );
  assert.ok(at5pm[0].agendaUrl);

  assert.equal(
    merged.rows.filter((m) => m.startsAt === "2026-09-08T13:00:00-07:00").length,
    1,
  );
  assert.equal(
    merged.rows.filter((m) => m.startsAt.startsWith("2026-09")).length,
    3,
    "three sittings before the API caught up, three after",
  );
});

test("(e) a cancellation on the portal supersedes the earlier future record", () => {
  const before = normalizeWithDrops([pimaReading()], NOW).meetings;

  // The portal has no cancellation field, so free text in the row's `<em>` is the only signal.
  const canceledGrid = PIMA_NEXT_MONTH.replace(
    'href="View.ashx?M=IC&amp;ID=1381577&amp;GUID=00EFD752-6A28-42D3-B329-E717E49891D0"',
    'href="View.ashx?M=IC&amp;ID=1381577&amp;GUID=00EFD752-6A28-42D3-B329-E717E49891D0" data-variant="canceled"',
  ).replace(
    /(ID=1381577[\s\S]*?)<em><\/em>/,
    "$1<em>Cancelled</em>",
  );
  assert.notEqual(canceledGrid, PIMA_NEXT_MONTH, "the variant did not apply — the test would prove nothing");

  const after = normalizeWithDrops(
    [
      pimaReading({
        windows: [win("This Month", PIMA_THIS_MONTH), win("Next Month", canceledGrid)],
      }),
    ],
    NOW,
  ).meetings;

  const changes = reconcileSittings(before, after);
  const canceled = changes.filter((c) => c.kind === "CANCELED");
  assert.equal(canceled.length, 1);
  assert.equal(canceled[0].meeting.id, "legistar-insite:pima:1381577");
  assert.equal(
    changes.filter((c) => c.kind === "UNCHANGED").length,
    9,
    "and nothing else about the calendar moved",
  );
});

test("(e) a rescheduled sitting is named as rescheduled, with both times", () => {
  const before: MeetingLike[] = [
    {
      id: "legistar-insite:pima:1381576",
      bodyId: "ocd-division/country:us/state:az/county:pima#governing",
      startsAt: "2026-09-08T17:00:00-07:00",
      timeZone: "America/Phoenix",
      status: "SCHEDULED",
      title: "Board of Supervisors",
    },
  ];
  const after: MeetingLike[] = [{ ...before[0], startsAt: "2026-09-09T17:00:00-07:00" }];

  const changes = reconcileSittings(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, "RESCHEDULED");
  assert.equal(
    changes[0].kind === "RESCHEDULED" ? changes[0].from : null,
    "2026-09-08T17:00:00-07:00",
  );

  // Supersession is keyed on the source's own identifier, because the sitting key moves.
  assert.notEqual(
    sittingKey({ ...before[0] }),
    sittingKey({ ...after[0] }),
  );
});

test("(e) a row missing from the later reading is NOT reported as a cancellation", () => {
  const before: MeetingLike[] = [
    {
      id: "legistar-insite:pima:1381577",
      startsAt: "2026-09-22T17:00:00-07:00",
      timeZone: "America/Phoenix",
      status: "SCHEDULED",
    },
  ];

  const changes = reconcileSittings(before, []);
  assert.equal(changes.length, 1);
  assert.equal(
    changes[0].kind,
    "ABSENT_FROM_LATEST",
    "a row leaving a grid is a fact about OUR reading, never a claim that the body called the meeting off",
  );
});

test("(f) UNNAMED CONTROL: Mesa loses 12 of 15 September sittings through the API alone", () => {
  const rows = parseCalendarRows(MESA_NEXT_MONTH);
  assert.equal(rows.length, 15, "Mesa's own portal publishes fifteen sittings next month");

  const notViewable = rows.filter((r) => r.notViewable);
  assert.equal(notViewable.length, 12);
  assert.equal(rows.length - notViewable.length, 3);

  for (const row of rows) {
    assert.equal(
      row.detailHref === null,
      row.notViewable,
      `${row.bodyName} ${row.date} disagrees with itself about being viewable`,
    );
  }

  assert.ok(
    INSITE_TENANTS.some((t) => t.slug === "mesa"),
    "the control has to be wired, or it only ever proves the parser",
  );
});

test("(f) Pima and Mesa are the same shape, measured the same way", () => {
  const measure = (html: string) => {
    const rows = parseCalendarRows(html);
    return { rows: rows.length, notViewable: rows.filter((r) => r.notViewable).length };
  };
  assert.deepEqual(measure(PIMA_NEXT_MONTH), { rows: 3, notViewable: 3 });
  assert.deepEqual(measure(MESA_NEXT_MONTH), { rows: 15, notViewable: 12 });
  assert.deepEqual(
    measure(PIMA_THIS_MONTH),
    { rows: 7, notViewable: 0 },
    "and the month the API DOES cover is the month with nothing hidden — the same finding from the other side",
  );
});

test("the two routes run on different publication clocks, and the feed says so", () => {
  const items = parseCalendarFeed(PIMA_FEED);
  assert.equal(items.length, 3);

  const twentySecond = items.find((i) => i.insiteId === "1381577");
  assert.ok(twentySecond?.pubDate);
  assert.equal(
    new Date(twentySecond.pubDate).toISOString().slice(0, 10),
    "2026-06-15",
    "InSite published the 22 September sitting in June — 74 days of notice",
  );

  const leadDays = Math.round(
    (Date.parse("2026-09-22T17:00:00-07:00") - Date.parse(twentySecond.pubDate)) / 86_400_000,
  );
  assert.ok(
    leadDays > 60,
    `the portal's own lead time was ${leadDays} days; the WebAPI's across 32 Pima 2026 events is max 5, median 0, min -2`,
  );
});

test("per-field provenance names WHICH ROUTE supplied each value", () => {
  const result = normalizeWithDrops([pimaReading()], NOW);
  const study = result.provenance.find(
    (p) => p.meetingId === "legistar-insite:pima:1381575",
  );

  assert.ok(study);
  assert.equal(study.fields.startsAt, "INSITE_CALENDAR_GRID");
  assert.equal(study.fields.location, "INSITE_CALENDAR_GRID");
  assert.equal(study.fields.title, "INSITE_CALENDAR_GRID");
  assert.equal(study.fields.firstPublishedAt, "INSITE_CALENDAR_RSS");
  assert.equal(study.insiteId, "1381575");
  assert.equal(study.insiteGuid, "416B3E6D-62A0-4A31-870B-1392A31EC0A1");
  assert.equal(
    study.legistarEventId,
    null,
    "this route has no WebAPI record for the rows it exists to recover — stated, not omitted",
  );
  assert.ok(study.firstPublishedAt);

  // A reading with no feed records NO publication clock — never "published now".
  const noFeed = normalizeWithDrops([pimaReading({ feedXml: null })], NOW);
  for (const row of noFeed.provenance) {
    assert.equal(row.firstPublishedAt, null);
    assert.equal(row.fields.firstPublishedAt, undefined);
  }
});

test("the existing Legistar fixture is STRUCTURALLY INCAPABLE of expressing this case", () => {
  const events = JSON.parse(
    readFileSync(join(FIXTURES, "legistar-pima-events.json"), "utf8"),
  ) as Record<string, unknown>[];

  assert.ok(events.length > 0);
  assert.deepEqual(
    [...new Set(events.map((e) => e.EventAgendaStatusName))],
    ["Final"],
    "every recorded event is already published, so no test built on it could ever have seen an unpublished one",
  );
});

test("fetch drives the ASP.NET postback and reads back the range that was rendered", async () => {
  const seen: { url: string; method: string; body: string | null }[] = [];
  const BY_RANGE: Record<string, string> = {
    "Last Month": PIMA_LAST_MONTH,
    "This Month": PIMA_THIS_MONTH,
    "Next Month": PIMA_NEXT_MONTH,
    "This Year": PIMA_THIS_YEAR,
    "Next Year": PIMA_NEXT_YEAR,
  };
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    seen.push({ url: String(url), method, body });

    if (String(url).includes("Feed.ashx")) {
      return new Response(PIMA_FEED, {
        status: 200,
        headers: { "content-type": "application/xml" },
      });
    }
    const asked = body
      ? new URLSearchParams(body).get("ctl00$ContentPlaceHolder1$lstYears")
      : null;
    const html = (asked && BY_RANGE[asked]) || PIMA_THIS_MONTH;
    return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;

  const pima = INSITE_TENANTS.find((t) => t.slug === "pima")!;
  const source = makeLegistarInSiteSource({ fetchImpl, tenants: [pima] });
  const raw = await source.fetch({ lat: 32.2217, lng: -110.974, radiusKm: 40 });

  assert.equal(raw.length, 1);
  assert.deepEqual(
    raw[0].windows.map((w) => [w.range, w.rendered]),
    RANGES.map((r) => [r, r]),
    "every range was requested and the returned page confirms each one took",
  );
  assert.equal(
    raw[0].windows.find((w) => w.range === "Next Year")?.noRecords,
    true,
    'the "Next Year" zero carries the publisher\'s own statement, so it is a zero we may keep',
  );

  const posted = seen.filter((r) => r.method === "POST");
  assert.ok(posted.length >= 2, "the range change must be a postback, not a query string");
  const rangePosts = posted.filter(
    (r) =>
      new URLSearchParams(r.body ?? "").get("__EVENTTARGET") ===
      "ctl00$ContentPlaceHolder1$lstYears",
  );
  const form = new URLSearchParams(rangePosts.at(-1)?.body ?? "");
  assert.equal(form.get("__EVENTTARGET"), "ctl00$ContentPlaceHolder1$lstYears");
  assert.equal(form.get("ctl00$ContentPlaceHolder1$lstYears"), RANGES.at(-1));
  assert.ok(
    (form.get("__VIEWSTATE") ?? "").length > 100,
    "the page's own __VIEWSTATE must be returned, or the server answers with the page it already had",
  );
  assert.ok(
    form.get("ctl00_ContentPlaceHolder1_lstYears_ClientState")?.includes(RANGES.at(-1)!),
    "the Telerik combo reads its selection from _ClientState; the text input alone is a silent no-op",
  );

  // The per-meeting iCalendar export is a fallback, fetched only for rows with no time.
  assert.equal(seen.filter((r) => r.url.includes("View.ashx")).length, 0);
  assert.deepEqual(raw[0].icalByInsiteId, {});
});

test("a postback that silently did not take is visible, not parsed as if it had", () => {
  assert.equal(renderedRange(PIMA_THIS_MONTH), "This Month");
  assert.equal(renderedRange(PIMA_NEXT_MONTH), "Next Month");

  const form = dateRangePostback(PIMA_THIS_MONTH, "Next Month");
  assert.ok(form.__VIEWSTATE);
  assert.ok(form.__EVENTVALIDATION);
  assert.equal(form.__EVENTTARGET, "ctl00$ContentPlaceHolder1$lstYears");
});

test("the calendar feed URL is read off the page, never constructed from a stored pair", () => {
  assert.equal(
    calendarFeedUrl(PIMA_NEXT_MONTH, "https://pima.legistar.com"),
    "https://pima.legistar.com/Feed.ashx?M=Calendar&ID=43473383&GUID=88b7d677-6602-4f79-b987-4677f7f035e6",
  );
  assert.equal(
    calendarFeedUrl(MESA_NEXT_MONTH, "https://mesa.legistar.com"),
    "https://mesa.legistar.com/Feed.ashx?M=Calendar&ID=43473386&GUID=d64aed36-08da-4c35-8ebd-8a6fe5567c74",
  );

  const pima = LEGISTAR_CLIENTS.find((c) => c.slug === "pima")!;
  assert.equal(pima.insiteHost, "pima.legistar.com");
  assert.equal(pima.insiteFeed?.range, "Next Month");
  assert.equal(pima.insiteFeed?.id, "43473383");
});

test("a PAGED grid is an incomplete enumeration, and it is reported rather than counted", () => {
  const pager = parseGridPager(MESA_THIS_YEAR_PAGED);
  assert.ok(pager, "the recorded page carries a pager and the parser must read it");
  assert.deepEqual(pager, {
    page: 1,
    pageCount: 2,
    firstItem: 1,
    lastItem: 100,
    totalItems: 148,
  });

  const rows = parseCalendarRows(MESA_THIS_YEAR_PAGED);
  assert.equal(rows.length, 100, "the page really does hold only the first hundred");
  assert.ok(rows.length < pager.totalItems);

  const mesa = INSITE_TENANTS.find((t) => t.slug === "mesa")!;
  const result = normalizeWithDrops(
    [
      {
        slug: "mesa",
        calendarUrl: "https://mesa.legistar.com/Calendar.aspx",
        windows: [win("This Year", MESA_THIS_YEAR_PAGED, pager)],
        feedXml: null,
        feedUrl: null,
        icalByInsiteId: {},
        clerkScheduleHtml: null,
        clerkScheduleUrl: null,
        collectedAt: "2026-08-28T18:30:00.000Z",
      },
    ],
    NOW,
  );

  assert.equal(result.partialScopes.length, 1, "the shortfall must be reported, not swallowed");
  assert.deepEqual(result.partialScopes[0].ocdIds, [mesa.ocdId]);
  assert.match(result.partialScopes[0].cause, /1 page\(s\) walked of 2/);
  assert.match(result.partialScopes[0].cause, /100 row\(s\) read of 148/);
  assert.match(
    result.partialScopes[0].cause,
    /INCOMPLETE, not empty/,
    "the wording has to distinguish a short answer from an empty calendar",
  );
  assert.equal(
    result.partialScopes[0].scope,
    "UPCOMING",
    '"This Year" reaches the future, so a shortfall in it is an UPCOMING gap — ' +
      "attributing it to ARCHIVE would let carry-forward treat the future as whole",
  );
});

test("the SECOND page is walked, and the completed range reports no shortfall", () => {
  const page1 = parseGridPager(MESA_THIS_YEAR_PAGED)!;
  const page2 = parseGridPager(MESA_THIS_YEAR_PAGE2)!;
  assert.equal(page2.page, 2);
  assert.equal(page2.totalItems, 148);

  const walked = normalizeWithDrops(
    [
      {
        slug: "mesa",
        calendarUrl: "https://mesa.legistar.com/Calendar.aspx",
        windows: [
          {
            ...win("This Year", MESA_THIS_YEAR_PAGED, page1),
            pages: [{ page: 2, html: MESA_THIS_YEAR_PAGE2, pager: page2 }],
          },
        ],
        feedXml: null,
        feedUrl: null,
        icalByInsiteId: {},
        clerkScheduleHtml: null,
        clerkScheduleUrl: null,
        collectedAt: "2026-08-28T18:30:00.000Z",
      },
    ],
    NOW,
  );

  assert.deepEqual(
    walked.partialScopes,
    [],
    "148 rows read against a published total of 148 is a COMPLETE enumeration",
  );
  assert.equal(
    walked.accounting.logicalInput,
    148,
    "every row of both pages must reach the accounting, or the walk lost one silently",
  );
});

test("a page target is READ OFF THE PAGER, never derived from the control index", () => {
  // Telerik states each link's page in its own onclick; a guessed control index can land on the wrong page.
  const targets = parseGridPageTargets(MESA_THIS_YEAR_PAGED);
  assert.deepEqual([...targets.keys()], [1, 2], "both numbered pages are published");
  assert.notEqual(targets.get(1), targets.get(2), "two pages, two distinct postback targets");
  for (const target of targets.values()) {
    assert.match(target, /^ctl00\$ContentPlaceHolder1\$gridCalendar\$/);
  }
  assert.deepEqual(
    [...parseGridPageTargets(PIMA_NEXT_MONTH).keys()],
    [],
    "an unpaged range publishes no page links, and none are invented for it",
  );
});

test("a single-page range reports no shortfall — the check is not a blanket warning", () => {
  assert.equal(
    parseGridPager(PIMA_NEXT_MONTH),
    null,
    "a three-row range renders no pager, so there is no total to reconcile against",
  );
  assert.deepEqual(normalizeWithDrops([pimaReading()], NOW).partialScopes, []);
});

test("the range set reaches the whole PUBLISHED future, not one month of it", () => {
  assert.ok(
    RANGES.includes("This Year"),
    'without "This Year" the adapter cannot see past next month — measured 3 sittings against 14',
  );
  assert.ok(
    RANGES.includes("Next Year"),
    '"Next Year" is how January arrives the day Pima files it; today it answers ' +
      'the publisher\'s own "No records were found."',
  );
  assert.ok(
    RANGES.includes("Last Month"),
    "the backward reach is unchanged; this correction is about the future only",
  );

  assert.equal(parseGridPager(PIMA_THIS_YEAR), null);
  assert.equal(
    parseCalendarRows(PIMA_THIS_YEAR).length,
    46,
    "the recorded page is the real one — 46 rows, no pager, nothing to reconcile",
  );
});

test("a zero is only ever the PUBLISHER'S zero", () => {
  // A zero without the publisher's "No records were found." is a failed retrieval, not an empty calendar.
  assert.equal(parseCalendarRows(PIMA_NEXT_YEAR).length, 0);
  assert.equal(
    parseGridNoRecords(PIMA_NEXT_YEAR),
    true,
    "the publisher stated the emptiness, and only that licenses a zero",
  );
  assert.equal(
    parseGridNoRecords(PIMA_THIS_YEAR),
    false,
    "a page WITH rows must never read as a no-records statement",
  );

  const windows = (nextYear: string) => [
    win("This Month", PIMA_THIS_MONTH),
    win("Next Month", PIMA_NEXT_MONTH),
    win("Next Year", nextYear),
  ];

  const stated = normalizeWithDrops([pimaReading({ windows: windows(PIMA_NEXT_YEAR) })], NOW);
  assert.deepEqual(
    stated.partialScopes,
    [],
    "a publisher's own zero is a complete answer, not a shortfall",
  );

  const silent = PIMA_NEXT_YEAR.replace(/No records were found\./g, "&nbsp;");
  assert.notEqual(silent, PIMA_NEXT_YEAR, "the variant did not apply — the test would prove nothing");
  assert.equal(parseCalendarRows(silent).length, 0, "still the same zero rows");

  const unstated = normalizeWithDrops([pimaReading({ windows: windows(silent) })], NOW);
  assert.equal(unstated.partialScopes.length, 1);
  assert.match(unstated.partialScopes[0].cause, /FAILED RETRIEVAL, never an empty calendar/);
  assert.equal(
    unstated.meetings.length,
    stated.meetings.length,
    "the two readings produce the same meetings — only the honesty of the zero differs",
  );
});

test("the portal route is registered on the same bodies, BELOW the API route", () => {
  const names = CAPABILITIES.map((c) => c.name);
  const api = names.indexOf("legistar");
  const portal = names.indexOf("legistar-insite");

  assert.ok(api >= 0 && portal >= 0, "both Legistar routes must be registered capabilities");
  assert.ok(
    api < portal,
    "registration order breaks the merge's informativeness tie; the API record must be seen first",
  );
  assert.deepEqual(
    CAPABILITIES.find((c) => c.name === "legistar-insite")?.types,
    ["LEGISTAR"],
    "it serves the same wired bodies, so a failure attributes to the same bodies",
  );
});

test("every tenant states its own body, zone and official host", () => {
  assert.ok(INSITE_TENANTS.length >= 2);
  for (const tenant of INSITE_TENANTS) {
    assert.ok(tenant.bodyId.includes("#"), `${tenant.slug} states no registry body`);
    assert.ok(tenant.bodyNames.length > 0, `${tenant.slug} matches no department name`);
    assert.match(tenant.timeZone, /^[A-Za-z]+\/[A-Za-z_]+$/);
    assert.ok(tenant.host.endsWith(".legistar.com"));
  }
});

test("a clerk schedule page that moved is not followed: the grid's sittings survive, no retained response leaves the registered routes, and the move is named", async () => {
  const { captureSourceAcquisitions } = await import("../lib/sources/acquisition-trace.ts");
  const { authorityFor } = await import("../lib/civic-data/source-authority.ts");
  const pima = INSITE_TENANTS.find((t) => t.slug === "pima")!;
  assert.ok(pima.clerkScheduleUrl, "Pima declares its clerk schedule page");
  // The page is made to move to an address nobody has registered.
  const MOVED = "https://www.pima.gov/government/board-of-supervisors/schedule";
  const BY_RANGE: Record<string, string> = {
    "Last Month": PIMA_LAST_MONTH,
    "This Month": PIMA_THIS_MONTH,
    "Next Month": PIMA_NEXT_MONTH,
    "This Year": PIMA_THIS_YEAR,
    "Next Year": PIMA_NEXT_YEAR,
  };
  const clerkAsked: (RequestRedirect | undefined)[] = [];
  const requested: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);
    if (url === pima.clerkScheduleUrl) {
      clerkAsked.push(init?.redirect);
      if (init?.redirect === "manual") return new Response(null, { status: 301, headers: { location: MOVED } });
      // What fetch does by itself: follow the move and answer 200 from the new URL.
      const followed = new Response("<html><body>Board of Supervisors Meeting Schedule</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(followed, "url", { value: MOVED });
      return followed;
    }
    if (url.includes("Feed.ashx")) {
      return new Response(PIMA_FEED, { status: 200, headers: { "content-type": "application/xml" } });
    }
    const body = typeof init?.body === "string" ? init.body : null;
    const asked = body ? new URLSearchParams(body).get("ctl00$ContentPlaceHolder1$lstYears") : null;
    return new Response((asked && BY_RANGE[asked]) || PIMA_THIS_MONTH, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;
  let captured: Awaited<ReturnType<typeof captureSourceAcquisitions<LegistarInSiteRaw[]>>>;
  try {
    const source = makeLegistarInSiteSource({
      fetchImpl: ((u: RequestInfo | URL, i?: RequestInit) => globalThis.fetch(u, i)) as typeof fetch,
      tenants: [pima],
    });
    captured = await captureSourceAcquisitions((run) =>
      run("legistar-insite", () => source.fetch({ lat: 32.2217, lng: -110.974, radiusKm: 40 })),
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.deepEqual(clerkAsked, ["manual"], "the clerk page is asked once and told not to follow a move");
  assert.ok(!requested.includes(MOVED), "the page it moved to is never requested");
  const reading = captured.value[0]!;
  assert.equal(reading.clerkScheduleHtml, null);
  assert.match(reading.clerkScheduleNote ?? "", /moved to https:\/\/www\.pima\.gov\/government\/board-of-supervisors\/schedule/);

  assert.ok(captured.evidence.length > 0, "the grid's responses are retained as evidence");
  for (const row of captured.evidence) {
    const final = authorityFor("meetings-public-bodies", "MEETING", row.finalUrl);
    assert.ok(final.ok, `${row.finalUrl} would refuse the partition: ${final.ok ? "" : final.code}`);
  }
  const unregistered = authorityFor("meetings-public-bodies", "MEETING", MOVED);
  assert.equal(unregistered.ok ? null : unregistered.code, "FINAL_ROUTE_NOT_REGISTERED");

  const normalized = normalizeWithDrops(captured.value, NOW);
  assert.ok(normalized.meetings.length > 0, "the grid's sittings are still produced");
  const clerk = normalized.routes.find((r) => r.route === "CLERK_SCHEDULE_PAGE")!;
  assert.equal(clerk.enumeration, "NOT_RETRIEVED");
  assert.match(clerk.note ?? "", /moved to https:\/\/www\.pima\.gov\/government\/board-of-supervisors\/schedule/);
  assert.match(clerk.note ?? "", /UNKNOWN, not absent/);
});

test("Pima's clerk schedule is read at the county's current page, and that page is a registered route", async () => {
  const { captureSourceAcquisitions } = await import("../lib/sources/acquisition-trace.ts");
  const { authorityFor } = await import("../lib/civic-data/source-authority.ts");
  const pima = INSITE_TENANTS.find((t) => t.slug === "pima")!;
  assert.equal(pima.clerkScheduleUrl, "https://www.pima.gov/board-of-supervisors-meeting-schedule");
  const CURRENT = readFileSync(join(FIXTURES, "legistar-insite-pima-clerk-schedule-2026-09-24.html"), "utf8");
  const BY_RANGE: Record<string, string> = {
    "Last Month": PIMA_LAST_MONTH,
    "This Month": PIMA_THIS_MONTH,
    "Next Month": PIMA_NEXT_MONTH,
    "This Year": PIMA_THIS_YEAR,
    "Next Year": PIMA_NEXT_YEAR,
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === pima.clerkScheduleUrl) {
      const page = new Response(CURRENT, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      Object.defineProperty(page, "url", { value: url });
      return page;
    }
    if (url.includes("Feed.ashx")) {
      return new Response(PIMA_FEED, { status: 200, headers: { "content-type": "application/xml" } });
    }
    const body = typeof init?.body === "string" ? init.body : null;
    const asked = body ? new URLSearchParams(body).get("ctl00$ContentPlaceHolder1$lstYears") : null;
    return new Response((asked && BY_RANGE[asked]) || PIMA_THIS_MONTH, { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  let captured: Awaited<ReturnType<typeof captureSourceAcquisitions<LegistarInSiteRaw[]>>>;
  try {
    const source = makeLegistarInSiteSource({
      fetchImpl: ((u: RequestInfo | URL, i?: RequestInit) => globalThis.fetch(u, i)) as typeof fetch,
      tenants: [pima],
    });
    captured = await captureSourceAcquisitions((run) =>
      run("legistar-insite", () => source.fetch({ lat: 32.2217, lng: -110.974, radiusKm: 40 })),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  const reading = captured.value[0]!;
  assert.ok(reading.clerkScheduleHtml, "the county's schedule page was not read");
  assert.equal(reading.clerkScheduleNote, undefined, "a read page carries no refusal note");
  assert.ok(captured.evidence.some((row) => row.finalUrl === pima.clerkScheduleUrl), "the page's answer is retained as evidence");
  for (const row of captured.evidence) {
    const final = authorityFor("meetings-public-bodies", "MEETING", row.finalUrl);
    assert.ok(final.ok, `${row.finalUrl} would refuse the partition: ${final.ok ? "" : final.code}`);
  }
  const clerk = normalizeWithDrops(captured.value, NOW).routes.find((r) => r.route === "CLERK_SCHEDULE_PAGE")!;
  assert.notEqual(clerk.enumeration, "NOT_RETRIEVED");
  assert.equal(clerk.mechanism, pima.clerkScheduleUrl);
});
