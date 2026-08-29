/**
 * **THE UNION IS THE ACCEPTANCE.** (2026-08-28.)
 *
 * MTG-13 shipped three Pima Board of Supervisors sittings. Three is what the
 * two routes anyone had wired AGREED on; the county had fourteen published,
 * running to 15 December, each one carried by three separate first-party
 * routes. The three are real, they still ship, and every one of them is
 * asserted below as a regression floor. They were never the answer.
 *
 * Everything here runs against RECORDED responses in `tests/fixtures/`, taken
 * live on 2026-08-28 by `scripts/learn-legistar-horizon.mts`. No live calls.
 *
 * ## The rule these tests exist to hold
 *
 * > An instance published by ANY materially distinct first-party route is owed
 * > to the reader. Absence from another route is never evidence against it.
 *
 * And its named counterfactual, which must FAIL: shipping only what the routes
 * agree on. On Pima's live routes that intersection is **zero sittings** for a
 * county with fourteen published meetings.
 *
 * ## Why Mesa is in here and is not just a second parser fixture
 *
 * Pima's asymmetry runs one way — the portal has everything, the WebAPI has
 * nothing forward. If that were the whole story the fix would be "prefer the
 * portal", and it would be wrong. **Mesa's asymmetry runs BOTH ways**: on the
 * same day the WebAPI carried nineteen future sittings the portal grid did not,
 * and the grid carried eleven the WebAPI did not, out of a union of 33 with an
 * intersection of 2. A composition rule that preferred either route would lose
 * a fifth of one tenant's calendar or a third of the other's. Only the union
 * survives both, which is why the SECOND tenant exercises the composition and
 * not merely the parse.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { sittingKey, sittingKeyFromLocal } from "../lib/sources/event-identity.ts";
import {
  clerkDate,
  clerkTime,
  parseClerkSchedule,
  parseMeetingTypeCell,
} from "../lib/sources/legistar-insite/clerk-schedule.ts";
import { parseCalendarRows, parseGridPager } from "../lib/sources/legistar-insite/calendar.ts";
import {
  GRANICUS_LIVE_PROCEEDINGS_WALL,
  granicusWallObservation,
  intersectionOfRoutes,
  summarizeRoute,
  unaccounted,
  unionFutureInstances,
  type FirstPartyRoute,
  type RouteInstance,
} from "../lib/sources/legistar-insite/horizon.ts";
import { normalizeWithDrops } from "../lib/sources/legistar-insite/index.ts";
import { INSITE_TENANTS } from "../lib/sources/legistar-insite/tenants.ts";
import type { LegistarInSiteRaw } from "../lib/sources/legistar-insite/index.ts";
import type { InSiteRange } from "../lib/sources/legistar-insite/calendar.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

/** The instant every clock-dependent assertion is judged against. */
const NOW = new Date("2026-08-28T12:00:00Z");
const OBSERVED = "2026-08-29T00:13:00.000Z";

const PIMA_THIS_MONTH = fixture("legistar-insite-pima-calendar-this-month.html");
const PIMA_THIS_YEAR = fixture("legistar-insite-pima-calendar-this-year.html");
const PIMA_NEXT_YEAR = fixture("legistar-insite-pima-calendar-next-year.html");
const PIMA_FEED_THIS_YEAR = fixture("legistar-insite-pima-feed-this-year.xml");
const PIMA_CLERK = fixture("legistar-insite-pima-clerk-schedule.html");
const PIMA_EVENTDATES_FUTURE = JSON.parse(
  fixture("legistar-pima-eventdates-138-future.json"),
) as string[];
const PIMA_EVENTS_LATEST = JSON.parse(
  fixture("legistar-pima-events-latest30.json"),
) as Record<string, string>[];

const MESA_THIS_YEAR = fixture("legistar-insite-mesa-calendar-this-year-paged.html");
const MESA_THIS_YEAR_PAGE2 = fixture("legistar-insite-mesa-calendar-this-year-page2.html");
const MESA_NEXT_MONTH = fixture("legistar-insite-mesa-calendar-next-month.html");
const MESA_EVENTS_FUTURE = JSON.parse(
  fixture("legistar-mesa-events-future.json"),
) as Record<string, string>[];

const pima = INSITE_TENANTS.find((t) => t.slug === "pima")!;
const mesa = INSITE_TENANTS.find((t) => t.slug === "mesa")!;

function win(
  range: InSiteRange,
  html: string,
  pages: LegistarInSiteRaw["windows"][number]["pages"] = [],
): LegistarInSiteRaw["windows"][number] {
  return {
    range,
    rendered: range,
    html,
    pager: parseGridPager(html),
    pages,
    noRecords: /rgNoRecords/.test(html) && /No records were found/.test(html),
  };
}

/**
 * The full Pima reading as the widened adapter takes it: the whole published
 * horizon off "This Year", the RSS for that range, and the Clerk's own table.
 */
function pimaReading(overrides: Partial<LegistarInSiteRaw> = {}): LegistarInSiteRaw {
  return {
    slug: "pima",
    calendarUrl: "https://pima.legistar.com/Calendar.aspx",
    windows: [win("This Month", PIMA_THIS_MONTH), win("This Year", PIMA_THIS_YEAR), win("Next Year", PIMA_NEXT_YEAR)],
    feedXml: PIMA_FEED_THIS_YEAR,
    feedUrl:
      "https://pima.legistar.com/Feed.ashx?M=Calendar&ID=43476907&GUID=59fca2dc-1071-4ca7-be11-b4cf8577d33c",
    icalByInsiteId: {},
    clerkScheduleHtml: PIMA_CLERK,
    clerkScheduleUrl: pima.clerkScheduleUrl,
    collectedAt: OBSERVED,
    ...overrides,
  };
}

/** `M/D/YYYY` + `h:mm AM/PM` → the canonical local pair. */
function local(date: string, time: string): { date: string; time: string } {
  const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date.trim())!;
  const t = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim())!;
  const hour = (Number(t[1]) % 12) + (t[3].toUpperCase() === "PM" ? 12 : 0);
  return {
    date: `${d[3]}-${d[1].padStart(2, "0")}-${d[2].padStart(2, "0")}`,
    time: `${String(hour).padStart(2, "0")}:${t[2]}`,
  };
}

/** A WebAPI `/events` payload as a route observation. That route's rows, its way. */
function webapiObservation(
  rows: Record<string, string>[],
  bodyId: string,
  slug: string,
  today: string,
) {
  const instances: RouteInstance[] = rows
    .filter((e) => String(e.EventDate).slice(0, 10) >= today)
    .map((e) => ({
      route: "LEGISTAR_WEBAPI_EVENTS" as const,
      sourceUrl: `https://webapi.legistar.com/v1/${slug}/events`,
      observedAt: OBSERVED,
      bodyId,
      date: String(e.EventDate).slice(0, 10),
      time: local("1/1/2026", String(e.EventTime)).time,
      kind: null,
      location: String(e.EventLocation ?? "") || null,
      vendorId: String(e.EventId),
      vendorIdSpace: "legistar-webapi",
      publishedText: `${e.EventBodyName} ${e.EventDate} ${e.EventTime}`,
    }));
  return summarizeRoute(
    "LEGISTAR_WEBAPI_EVENTS",
    `https://webapi.legistar.com/v1/${slug}/events?$orderby=EventDate+desc&$top=1000`,
    OBSERVED,
    instances,
    "COMPLETE_AS_OBSERVED",
    null,
  );
}

/** The fourteen Pima sittings, as three first-party routes published them. */
const PIMA_HORIZON = [
  ["9/8/2026", "1:00 PM", "Study Session"],
  ["9/8/2026", "5:00 PM", null],
  ["9/22/2026", "5:00 PM", null],
  ["10/13/2026", "1:00 PM", "Study Session"],
  ["10/13/2026", "5:00 PM", null],
  ["10/20/2026", "1:00 PM", "Special Meeting"],
  ["10/27/2026", "5:00 PM", null],
  ["11/10/2026", "1:00 PM", "Study Session"],
  ["11/10/2026", "5:00 PM", null],
  ["11/19/2026", "1:00 PM", "Special Meeting"],
  ["11/24/2026", "5:00 PM", null],
  ["12/8/2026", "1:00 PM", "Study Session"],
  ["12/8/2026", "5:00 PM", null],
  ["12/15/2026", "5:00 PM", null],
] as const;

// ---------------------------------------------------------------------------
// The measurement that retires "three"
// ---------------------------------------------------------------------------

test("the WebAPI's future horizon is EMPTY, and that is a fact about the route", () => {
  /*
   * Both WebAPI routes, measured live 2026-08-28. Neither is broken and neither
   * is lying: `/events` returns 403 rows all-time and its latest EventDate is
   * 25 August. `EventDates/138?FutureDatesOnly=true` returns `[]`.
   *
   * A route that answers zero has told us about ITSELF. Reading either of these
   * zeros as a statement about Pima County is the whole defect.
   */
  assert.deepEqual(PIMA_EVENTDATES_FUTURE, [], "FutureDatesOnly=true genuinely returns nothing");
  const latest = PIMA_EVENTS_LATEST.map((e) => String(e.EventDate).slice(0, 10)).sort().pop();
  assert.equal(latest, "2026-08-25", "the newest row this route holds is already in the past");
  assert.equal(
    PIMA_EVENTS_LATEST.filter((e) => String(e.EventDate).slice(0, 10) >= "2026-08-28").length,
    0,
  );
});

test("the portal publishes FOURTEEN future sittings, to 2026-12-15", () => {
  const rows = parseCalendarRows(PIMA_THIS_YEAR).filter(
    (r) => local(r.date, r.time || "12:00 AM").date >= "2026-08-28",
  );
  assert.equal(rows.length, 14, "the recorded page is the real one, and it holds fourteen");
  assert.equal(
    parseGridPager(PIMA_THIS_YEAR),
    null,
    "at 46 rows the range is unpaged, so there is no hidden remainder here",
  );

  const published = new Set(rows.map((r) => `${local(r.date, r.time).date} ${local(r.date, r.time).time}`));
  for (const [date, time] of PIMA_HORIZON) {
    const l = local(date, time);
    assert.ok(published.has(`${l.date} ${l.time}`), `the grid must publish ${date} ${time}`);
  }
});

test("the Clerk of the Board publishes the SAME fourteen, on the county's own domain", () => {
  /*
   * A second, independent first-party publisher — Pima telling us about Pima
   * rather than Granicus telling us about Pima. It is the only available check
   * on the vendor: without it there is no way to know whether Calendar.aspx has
   * dropped a sitting or moved an hour.
   */
  const parsed = parseClerkSchedule(PIMA_CLERK);
  assert.ok(parsed.length > 40, "the whole 2026 table parses, not just the tail");
  const future = parsed.filter((r) => r.date >= "2026-08-28");
  assert.equal(future.length, 14);

  const clerk = new Set(future.map((r) => `${r.date} ${r.startTime}`));
  for (const [date, time] of PIMA_HORIZON) {
    const l = local(date, time);
    assert.ok(clerk.has(`${l.date} ${l.time}`), `the Clerk must publish ${date} ${time}`);
  }
  assert.equal(
    future.filter((r) => r.startTime === null).length,
    0,
    "every future row in the table names its hour, so none is timeless",
  );
});

// ---------------------------------------------------------------------------
// The acceptance rule itself
// ---------------------------------------------------------------------------

test("ACCEPTANCE: the union of every route reaches the reader — all fourteen", () => {
  const result = normalizeWithDrops([pimaReading()], NOW);

  assert.equal(result.union.length, 14, "the acceptance set is the union, and it is fourteen");
  assert.deepEqual(
    result.union.map((i) => `${i.date} ${i.time}`),
    PIMA_HORIZON.map(([d, t]) => {
      const l = local(d, t);
      return `${l.date} ${l.time}`;
    }),
    "in the body's own chronological order, every one of them",
  );

  // Every union instance became a Meeting. Not "most", not "the ones inside the
  // serving window" — the adapter no longer clips the future at all.
  const produced = new Set(
    result.meetings.map((m) => sittingKey({ bodyId: m.bodyId, startsAt: m.startsAt, timeZone: m.timeZone })),
  );
  for (const instance of result.union) {
    assert.ok(
      produced.has(instance.key),
      `${instance.date} ${instance.time} is published by ${instance.routes.join(", ")} and must reach the product`,
    );
  }

  assert.deepEqual(
    unaccounted(result.union, produced as ReadonlySet<string>, result.dispositions),
    [],
    "an instance that is neither shipped nor dispositioned is a sitting lost quietly",
  );
});

test("FORBIDDEN: intersection semantics would ship ZERO of Pima's fourteen", () => {
  /*
   * The named wrong answer, failing on purpose. This is the rule the previous
   * reading of MTG-13 applied without naming it, and the reason it is written
   * down in code rather than only in prose is that a rule stated only in prose
   * gets re-derived — this workstream already did it once.
   */
  const result = normalizeWithDrops([pimaReading()], NOW);
  const webapi = webapiObservation(PIMA_EVENTS_LATEST, pima.bodyId, "pima", "2026-08-28");
  const union = unionFutureInstances([...result.routes, webapi]);

  const wired: FirstPartyRoute[] = ["LEGISTAR_WEBAPI_EVENTS", "INSITE_CALENDAR_GRID"];
  assert.equal(
    intersectionOfRoutes(union, wired).length,
    0,
    "the two routes anyone had wired agree on NOTHING in the future",
  );
  assert.equal(union.length, 14, "and the union of the same routes is the whole horizon");

  // Stated as the arithmetic a reader would feel.
  assert.equal(
    union.length - intersectionOfRoutes(union, wired).length,
    14,
    "intersection semantics would have shipped fourteen fewer sittings",
  );
});

test("REGRESSION FLOOR: the three September sittings still ship, unchanged", () => {
  /*
   * The union correction is additive. These three are what MTG-13 delivered and
   * they are verified at the reader API; nothing here may move them.
   */
  const result = normalizeWithDrops([pimaReading()], NOW);
  const september = result.meetings
    .filter((m) => m.startsAt.startsWith("2026-09"))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  assert.equal(september.length, 3);
  assert.deepEqual(
    september.map((m) => [m.startsAt, m.title, m.location?.name ?? m.online?.label ?? null]),
    [
      ["2026-09-08T13:00:00-07:00", "Study Session", "Pima County Administration Building, Board of Supervisors Hearing Room"],
      ["2026-09-08T17:00:00-07:00", "Board of Supervisors", "Pima County Administration Building, Board of Supervisors Hearing Room"],
      ["2026-09-22T17:00:00-07:00", "Board of Supervisors", "Pima County Administration Building, Board of Supervisors Hearing Room"],
    ],
  );
  for (const meeting of september) {
    assert.equal(meeting.status, "SCHEDULED");
    assert.equal(meeting.bodyId, pima.bodyId);
    assert.equal(meeting.provenance.sourceOrg, pima.publishingOrg);
  }
});

// ---------------------------------------------------------------------------
// Dispositions are DATA, and they name whose fact they are
// ---------------------------------------------------------------------------

test("every instance carries a disposition, and each names WHOSE fact it is", () => {
  const result = normalizeWithDrops([pimaReading()], NOW);
  assert.equal(result.dispositions.length, 14, "one per union instance, no instance unexplained");

  for (const disposition of result.dispositions) {
    assert.ok(disposition.evidence.length > 0, `${disposition.date} carries no evidence`);
    for (const evidence of disposition.evidence) {
      assert.ok(evidence.sourceUrl.startsWith("http"), "evidence must cite a retrievable URL");
      assert.ok(evidence.observedAt, "evidence must say when it was observed");
      assert.ok(evidence.quotedText.length > 0, "evidence must quote what the publisher said");
    }
    assert.ok(
      /^(OURS|THEIRS|This sitting)/.test(disposition.claimAboutContent ?? ""),
      `${disposition.verdict} must say whose fact it is: got ${disposition.claimAboutContent}`,
    );
  }
});

test("a sitting past the app's serving horizon is HELD and NAMED, never dropped", () => {
  /*
   * The one honest gap left, and it is OURS. `UPCOMING_HORIZON_DAYS` is 60 and
   * `lib/meetings/query.ts` applies it to every source on every read, so eight
   * of the fourteen are in the snapshot and not yet in front of a reader. That
   * is a fact about this application; the county published them and we hold
   * them. Recorded as data so it is a stated number and not a silence.
   */
  const result = normalizeWithDrops([pimaReading()], NOW);
  const beyond = result.dispositions.filter((d) => d.verdict === "BEYOND_APP_SERVING_HORIZON");
  const represented = result.dispositions.filter((d) => d.verdict === "REPRESENTED_IN_READER");

  assert.equal(represented.length + beyond.length, 14);
  assert.deepEqual(
    beyond.map((d) => `${d.date} ${d.time}`),
    [
      "2026-10-27 17:00",
      "2026-11-10 13:00",
      "2026-11-10 17:00",
      "2026-11-19 13:00",
      "2026-11-24 17:00",
      "2026-12-08 13:00",
      "2026-12-08 17:00",
      "2026-12-15 17:00",
    ],
  );

  const produced = new Set(
    result.meetings.map((m) => sittingKey({ bodyId: m.bodyId, startsAt: m.startsAt, timeZone: m.timeZone })),
  );
  for (const disposition of beyond) {
    assert.ok(
      produced.has(disposition.key),
      "beyond the serving horizon means COLLECTED and not yet served — never discarded",
    );
    assert.match(
      disposition.claimAboutContent ?? "",
      /^OURS, and only ours/,
      "the horizon is OUR limit and must never read as a fact about the county",
    );
    assert.match(disposition.claimAboutContent ?? "", /UPCOMING_HORIZON_DAYS/);
  }
});

test("the per-route table states each route's mechanism, counts, span and completeness", () => {
  const result = normalizeWithDrops([pimaReading()], NOW);
  const byRoute = new Map(result.routes.map((r) => [r.route, r]));

  const grid = byRoute.get("INSITE_CALENDAR_GRID")!;
  assert.equal(grid.enumeration, "COMPLETE_AS_OBSERVED");
  assert.equal(grid.uniqueFutureCount, 14);
  assert.equal(grid.earliest, "2026-09-08");
  assert.equal(grid.latest, "2026-12-15");
  assert.match(grid.mechanism, /Calendar\.aspx — ranges "This Month", "This Year", "Next Year"/);

  const rss = byRoute.get("INSITE_CALENDAR_RSS")!;
  assert.equal(rss.uniqueFutureCount, 14, "the RSS independently confirms the whole horizon");
  assert.match(rss.mechanism, /Feed\.ashx\?M=Calendar&ID=\d+&GUID=/);
  assert.match(rss.note ?? "", /minted per tenant and per range/);

  const clerk = byRoute.get("CLERK_SCHEDULE_PAGE")!;
  assert.equal(clerk.uniqueFutureCount, 14);
  assert.equal(clerk.mechanism, "https://www.pima.gov/2559/Board-of-Supervisors-Meeting-Schedule");

  for (const route of result.routes) {
    assert.ok(route.observedAt, "a count with no observation time is not a measurement");
    assert.ok(
      route.enumeration === "COMPLETE_AS_OBSERVED" || route.note,
      `${route.route} is ${route.enumeration} and must explain itself`,
    );
  }
});

test("a route this tenant has not declared says NOBODY LOOKED, not that nothing exists", () => {
  /*
   * Mesa declares no clerk-schedule route. That is a rung nobody has climbed in
   * this workstream, and it is emitted as exactly that: a later session must
   * read "we have not looked", never "the city publishes no schedule of its
   * own". `CLAUDE.md` — absence is never asserted.
   */
  assert.equal(mesa.clerkScheduleUrl, null);
  const result = normalizeWithDrops(
    [
      {
        slug: "mesa",
        calendarUrl: "https://mesa.legistar.com/Calendar.aspx",
        windows: [win("Next Month", MESA_NEXT_MONTH)],
        feedXml: null,
        feedUrl: null,
        icalByInsiteId: {},
        clerkScheduleHtml: null,
        clerkScheduleUrl: null,
        collectedAt: OBSERVED,
      },
    ],
    NOW,
  );
  const clerk = result.routes.find((r) => r.route === "CLERK_SCHEDULE_PAGE")!;
  assert.equal(clerk.enumeration, "NOT_RETRIEVED");
  assert.equal(clerk.rawFutureCount, 0);
  assert.match(clerk.note ?? "", /nobody has looked/i);
  assert.doesNotMatch(
    clerk.note ?? "",
    /publishes no schedule|has no schedule|does not publish/i,
    "a gap in our registry may never be phrased as a fact about the body",
  );

  // A declared route that simply was not read this run is a DIFFERENT fact, and
  // it is worded differently: unknown on this run, not unlooked-for.
  const unread = normalizeWithDrops([pimaReading({ clerkScheduleHtml: null })], NOW);
  const pimaClerk = unread.routes.find((r) => r.route === "CLERK_SCHEDULE_PAGE")!;
  assert.equal(pimaClerk.enumeration, "NOT_RETRIEVED");
  assert.match(pimaClerk.note ?? "", /UNKNOWN, not absent/);

  // And the union is unchanged: losing a corroborating route loses no sitting.
  assert.equal(unread.union.length, 14);
});

test("the Granicus wall is a wall — a verdict, a date, and a NULL claim about content", () => {
  const wall = granicusWallObservation();
  assert.equal(wall.enumeration, "PERMISSION_DISALLOWED");
  assert.equal(GRANICUS_LIVE_PROCEEDINGS_WALL.rule, "User-agent: * / Disallow: /");
  assert.equal(GRANICUS_LIVE_PROCEEDINGS_WALL.readAt, "2026-08-28");
  assert.equal(
    GRANICUS_LIVE_PROCEEDINGS_WALL.claimAboutContent,
    null,
    "a permission refusal entitles us to NO claim about what is behind it",
  );
  assert.match(wall.note ?? "", /NOT FETCHED AT ANY RUNG/);
  assert.match(wall.note ?? "", /makes NO claim about what the route publishes/);

  // The counts are OUR action, not the route's contents.
  assert.equal(wall.rawFutureCount, 0);
  assert.notEqual(
    wall.enumeration,
    "PUBLISHER_STATED_EMPTY",
    "a disallow is never the publisher stating emptiness",
  );

  // And the whole horizon is reachable without it.
  const result = normalizeWithDrops([pimaReading()], NOW);
  assert.equal(result.union.length, 14, "nothing we owe a reader depends on the disallowed route");
});

// ---------------------------------------------------------------------------
// The unnamed second tenant — the COMPOSITION rule, not the parser
// ---------------------------------------------------------------------------

test("UNNAMED TENANT: Mesa's asymmetry runs BOTH ways, so neither route may win", () => {
  /*
   * The control that says this was never about Pima, and never about preferring
   * the portal. Measured the same day:
   *
   *   union 33 · intersection 2 · only-on-WebAPI 19 · only-on-grid 11
   *
   * Preferring the portal would lose Mesa nineteen sittings; preferring the API
   * would lose Pima fourteen. Only the union survives both tenants.
   */
  const result = normalizeWithDrops(
    [
      {
        slug: "mesa",
        calendarUrl: "https://mesa.legistar.com/Calendar.aspx",
        windows: [
          win("Next Month", MESA_NEXT_MONTH),
          win("This Year", MESA_THIS_YEAR, [
            { page: 2, html: MESA_THIS_YEAR_PAGE2, pager: parseGridPager(MESA_THIS_YEAR_PAGE2) },
          ]),
        ],
        feedXml: null,
        feedUrl: null,
        icalByInsiteId: {},
        clerkScheduleHtml: null,
        clerkScheduleUrl: null,
        collectedAt: OBSERVED,
      },
    ],
    NOW,
  );

  const webapi = webapiObservation(MESA_EVENTS_FUTURE, mesa.bodyId, "mesa", "2026-08-28");
  const union = unionFutureInstances([...result.routes, webapi]);

  const onlyApi = union.filter((i) => i.onlyOn === "LEGISTAR_WEBAPI_EVENTS");
  const onlyGrid = union.filter((i) => i.onlyOn === "INSITE_CALENDAR_GRID");
  const both = intersectionOfRoutes(union, ["LEGISTAR_WEBAPI_EVENTS", "INSITE_CALENDAR_GRID"]);

  assert.ok(
    onlyApi.length > 0,
    "the WebAPI must carry Mesa sittings the grid does not — otherwise the portal always wins " +
      "and the composition rule was never exercised",
  );
  assert.ok(onlyGrid.length > 0, "and the grid must carry sittings the WebAPI does not");
  assert.ok(
    union.length > onlyApi.length + both.length,
    "the union must be strictly larger than either route alone",
  );
  assert.ok(
    both.length < union.length / 2,
    `the intersection (${both.length}) is a small fraction of the union (${union.length}) — ` +
      "which is exactly why agreement is not the acceptance",
  );
});

test("UNNAMED TENANT: the paged range is WALKED, and its 148 rows all reach the accounting", () => {
  const page1 = parseGridPager(MESA_THIS_YEAR)!;
  const page2 = parseGridPager(MESA_THIS_YEAR_PAGE2)!;
  assert.equal(page1.totalItems, 148);
  assert.equal(page2.page, 2);
  assert.equal(
    parseCalendarRows(MESA_THIS_YEAR).length + parseCalendarRows(MESA_THIS_YEAR_PAGE2).length,
    148,
    "the two recorded pages are the whole range, and they do not overlap",
  );

  const result = normalizeWithDrops(
    [
      {
        slug: "mesa",
        calendarUrl: "https://mesa.legistar.com/Calendar.aspx",
        windows: [
          win("This Year", MESA_THIS_YEAR, [
            { page: 2, html: MESA_THIS_YEAR_PAGE2, pager: page2 },
          ]),
        ],
        feedXml: null,
        feedUrl: null,
        icalByInsiteId: {},
        clerkScheduleHtml: null,
        clerkScheduleUrl: null,
        collectedAt: OBSERVED,
      },
    ],
    NOW,
  );
  assert.deepEqual(result.partialScopes, [], "148 of 148 read is a COMPLETE enumeration");
  assert.equal(
    result.accounting.logicalInput,
    148,
    "every row of both pages is considered — a walk that lost rows would show here",
  );
});

// ---------------------------------------------------------------------------
// Identity, across routes that share no id space
// ---------------------------------------------------------------------------

test("identity is (body, local date, local time) — never the vendor's number", () => {
  /*
   * The routes number the same meeting differently: the WebAPI calls Pima's 25
   * August sitting 1825 and the portal calls it 1381574. Keying on either would
   * publish one meeting twice.
   */
  const result = normalizeWithDrops([pimaReading()], NOW);
  const keys = result.union.map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length, "no two union instances share a key");

  for (const instance of result.union) {
    assert.equal(
      instance.key,
      sittingKeyFromLocal({ bodyId: pima.bodyId, date: instance.date, time: instance.time }),
    );
    // Three routes, three different notions of an id — and one identity.
    const spaces = new Set(instance.observations.map((o) => o.vendorIdSpace));
    assert.ok(spaces.size >= 1);
    assert.ok(
      instance.observations.length >= 2,
      `${instance.date} ${instance.time} should be corroborated by more than one route`,
    );
  }

  // Same body, same day, two different hours: two sittings, never merged.
  const eighth = result.union.filter((i) => i.date === "2026-09-08");
  assert.equal(eighth.length, 2);
  assert.notEqual(eighth[0].key, eighth[1].key);
});

test("sittingKeyFromLocal and sittingKey are the same key, reached two ways", () => {
  /*
   * They must not be able to drift: the routes that enumerate a future publish
   * a local date and a wall clock and no zone, while an adapter producing a
   * Meeting has resolved an instant. If these ever disagreed, a union instance
   * and the meeting made from it would stop matching and every sitting would
   * report itself unaccounted.
   */
  assert.equal(
    sittingKey({
      bodyId: pima.bodyId,
      startsAt: "2026-12-15T17:00:00-07:00",
      timeZone: "America/Phoenix",
    }),
    sittingKeyFromLocal({ bodyId: pima.bodyId, date: "2026-12-15", time: "17:00" }),
  );
  // And through an instant written the other way, by another adapter.
  assert.equal(
    sittingKey({
      bodyId: pima.bodyId,
      startsAt: "2026-12-16T00:00:00.000Z",
      timeZone: "America/Phoenix",
    }),
    sittingKeyFromLocal({ bodyId: pima.bodyId, date: "2026-12-15", time: "17:00" }),
  );
  assert.equal(
    sittingKeyFromLocal({ bodyId: pima.bodyId, date: "2026-12-15", time: "" }),
    null,
    "a record with no time has no sitting identity, and is not given a fallback one",
  );
});

// ---------------------------------------------------------------------------
// The Clerk's table, parsed as the publisher writes it
// ---------------------------------------------------------------------------

test("one table row can publish TWO sittings, and both are kept", () => {
  /*
   * `Study Session (at 1:00 p.m.) * Regular (at 5:00 p.m.)` is one row and two
   * meetings. A parser taking one meeting per row would lose exactly the study
   * sessions this workstream exists to recover.
   */
  const both = parseMeetingTypeCell(
    "Study Session (at 1:00 p.m.) * Regular (at 5:00 p.m.)",
    "2026-09-08",
    "2026-08-26",
  );
  assert.equal(both.length, 2);
  assert.deepEqual(
    both.map((i) => [i.kind, i.startTime]),
    [
      ["Study Session", "13:00"],
      ["Regular", "17:00"],
    ],
    "the footnote asterisk is a footnote, not part of the meeting's name",
  );
  assert.equal(both[0].clerkDeadline, "2026-08-26");
});

test("an amendment corrects the sitting it follows, not the one after it", () => {
  const amended = parseMeetingTypeCell(
    "Study Session ( at 2:00 p.m. ) * Amended to 1:30 p.m. Regular (at 5:00 p.m.)",
    "2026-08-11",
    "2026-07-29",
  );
  assert.equal(amended.length, 2);
  assert.deepEqual(
    amended.map((i) => [i.kind, i.startTime, i.amended]),
    [
      ["Study Session", "13:30", true],
      ["Regular", "17:00", false],
    ],
    "the county moved its study session and said so; reading 2:00 would send a reader early",
  );
});

test("an end time and a spelled-out hour are both read as published", () => {
  const special = parseMeetingTypeCell("Special (at 1:00 p.m. - 6:00 p.m.)", "2026-10-20", null);
  assert.equal(special.length, 1);
  assert.equal(special[0].startTime, "13:00");
  assert.equal(special[0].endTime, "18:00", "the Clerk publishes an end time; the grid does not");

  const retreat = parseMeetingTypeCell("Board Retreat (Noon to 5:00 p.m.)", "2026-02-09", null);
  assert.equal(retreat[0].startTime, "12:00", '"Noon" is a time the publisher writes');
  assert.equal(clerkTime("9 a.m."), "09:00");
  assert.equal(clerkTime("12:30 p.m."), "12:30");
  assert.equal(clerkDate("1/6/26"), "2026-01-06");
  assert.equal(clerkDate("- - -"), null);
});

test("a row that names a meeting without an hour keeps the meeting and NOT an invented time", () => {
  const timeless = parseMeetingTypeCell("Regular", "2026-01-06", "2025-12-24");
  assert.equal(timeless.length, 1);
  assert.equal(timeless[0].kind, "Regular");
  assert.equal(
    timeless[0].startTime,
    null,
    "the page's prose rule is not this row's published hour, and filling it would be a fabrication",
  );
});

test("a page with no schedule table is a FAILED EXTRACTION, never an empty schedule", () => {
  assert.deepEqual(parseClerkSchedule("<html><body><p>Under construction</p></body></html>"), []);
  const result = normalizeWithDrops(
    [pimaReading({ clerkScheduleHtml: "<html><body>nothing here</body></html>" })],
    NOW,
  );
  const clerk = result.routes.find((r) => r.route === "CLERK_SCHEDULE_PAGE")!;
  assert.equal(clerk.enumeration, "NOT_RETRIEVED");
  assert.match(clerk.note ?? "", /FAILED EXTRACTION/);
  assert.match(clerk.note ?? "", /never a county with no schedule/);
});
