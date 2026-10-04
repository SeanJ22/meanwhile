import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { SOURCE_WIRING } from "../lib/registry/source-wiring.ts";
import { makeDiligentSource, type DiligentMeeting } from "../lib/sources/diligent/index.ts";
import { forwardCalendarMonths, sittingBodyKey } from "../lib/sources/diligent/schedule-union.ts";
import { SourceHttpError } from "../lib/sources/http.ts";

/*
 * Tucson Unified's partition publishes every sitting in the forward window
 * that EITHER of the district's own publications verifies: its Diligent
 * portal's list (agenda links, cancellation notes) and its board site's
 * calendar (govboard.tusd1.org, permitted), which carries Governing Board
 * sittings months before the portal does. Recorded calendar fragments read
 * 2026-09-23 (tests/fixtures/tusd-govboard/retrieval.json); portal rows are
 * the production partition's own upcoming rows of that day.
 */

const FIXTURES = join(import.meta.dirname, "fixtures", "tusd-govboard");
const RETRIEVAL = JSON.parse(readFileSync(join(FIXTURES, "retrieval.json"), "utf8")) as Record<string, { url: string }>;
const WIRING = SOURCE_WIRING.find((row) => row.bodyId.includes("tucson_unified_district"))!;
const NOW = new Date("2026-09-23T13:00:00-07:00");
const FORWARD = ["incal-2026-09.html", "incal-2026-10.html", "incal-2026-11.html", "incal-2026-12.html", "incal-2027-01.html"];

function months(extra: { readonly name: string; readonly html: string }[] = []) {
  return [
    ...FORWARD.map((name) => ({ url: RETRIEVAL[name]!.url, html: readFileSync(join(FIXTURES, name), "utf8") })),
    ...extra.map(({ name, html }) => ({ url: `https://govboard.tusd1.org/inflow/xti/inCal.aspx?fixture=${name}`, html })),
  ];
}

function row(Id: number, when: string, type: string, place: string, title?: string): DiligentMeeting {
  return {
    Id,
    Name: title ?? `${type} - fixture`,
    CleanName: title ?? `${type} - fixture`,
    MeetingDateTime: when,
    MeetingLocation: place,
    MeetingTypeName: type,
    TypeId: null,
    Published: false,
  };
}

const PORTAL: DiligentMeeting[] = [
  row(499, "2026-09-22 16:30", "GOVERNING BOARD AGENDA SPECIAL MEETING", "Duffy Community Center Multipurpose Room 5145 E. 5th Street Tucson, AZ 85711"),
  row(503, "2026-09-28 18:15", "Alternative Education Advisory Committee Meeting Agenda", "Via Zoom Webinar"),
  row(505, "2026-09-30 16:00", "Budget Advisory Committee Meeting Agenda", "Via Zoom"),
  row(504, "2026-10-05 17:30", "Employee Benefit Trust Committee", "Via Zoom Webinar"),
];

function union(portal: DiligentMeeting[], extra: { readonly name: string; readonly html: string }[] = []) {
  return makeDiligentSource([WIRING]).normalizeWithDrops!([{
    wiring: WIRING,
    meetings: portal,
    collectedAt: "2026-09-23T20:10:00.000Z",
    agendaRecords: null,
    scheduleCalendar: { months: months(extra) },
  }], NOW);
}

function modal(id: string, title: string, when: string, details: string): string {
  return `<div class="modal fade" id="${id}" tabindex="-1"><h4 class="modal-title">${title}</h4>` +
    `<div id="modaleventTimes"><div class='ixCalEventTimesLabel'>Date & Time:  </div>${when}</div>` +
    `<div id="modalDescription"><div class='ixCalEventLocationLabel'>Event Details: </div>${details}</div>\n</div>\n<div class="modal-footer">`;
}

test("both publications' names for one body reduce to one key", () => {
  assert.equal(sittingBodyKey("GOVERNING BOARD AGENDA SPECIAL MEETING "), "governing-board");
  assert.equal(sittingBodyKey("Governing Board Meeting - via Zoom"), "governing-board");
  assert.equal(sittingBodyKey("GOVERNING BOARD AGENDA SPECIAL EXECUTIVE SESSION MEETING"), "governing-board");
  assert.equal(sittingBodyKey("Employee Benefit Trust Committee"), sittingBodyKey("Employee Benefits Trust Meeting"));
  assert.equal(sittingBodyKey("AGENDA FOR AUDIT COMMITTEE MEETING"), sittingBodyKey("Audit Committee Meeting"));
  assert.equal(
    sittingBodyKey("Alternative Education Advisory Committee Meeting Agenda"),
    sittingBodyKey("Alternative Education Advisory Committee Meeting"),
  );
});

test("the partition publishes every forward sitting either source verifies, and portal ids stay put", () => {
  const result = union(PORTAL);
  const ids = result.meetings.map((m) => m.id).sort();
  assert.deepEqual(ids, [
    "diligent:tusd1:2026-10-06T1630-governing-board",
    "diligent:tusd1:2026-10-27T1630-governing-board",
    "diligent:tusd1:2026-11-17T1630-governing-board",
    "diligent:tusd1:2026-12-08T1630-governing-board",
    "diligent:tusd1:499",
    "diligent:tusd1:503",
    "diligent:tusd1:504",
    "diligent:tusd1:505",
  ]);
  // Sep 28 is on both: ONE row, the portal's.
  assert.equal(result.meetings.filter((m) => m.startsAt.startsWith("2026-09-28")).length, 1);
  const oct6 = result.meetings.find((m) => m.id.endsWith("2026-10-06T1630-governing-board"))!;
  assert.equal(oct6.startsAt, "2026-10-06T16:30:00-07:00");
  assert.equal(oct6.status, "SCHEDULED");
  assert.equal(oct6.agendaUrl, null, "posted before its agenda exists");
  assert.equal(oct6.location?.name, "Duffy Community Center, Multipurpose Room");
  assert.equal(oct6.bodyId, WIRING.bodyId);
  assert.match(oct6.provenance.sourceUrl ?? "", /^https:\/\/govboard\.tusd1\.org\/inflow\/xti\/inCal\.aspx/);
  // Conservation: every calendar entry is produced, a duplicate, or out of window.
  assert.equal(result.accounting.outcome, "CONSERVED");
  assert.equal(result.accounting.duplicates, 1);
  assert.equal(result.accounting.produced, 8);
});

test("a calendar sitting that names no place is published with no place, never withheld", () => {
  const tbd = modal("TBD1", "Audit Committee Meeting", "10/21/2026 2:30pm - 4:30pm", "Committee meeting location TBD.");
  const result = union(PORTAL, [{ name: "tbd", html: tbd }]);
  const audit = result.meetings.find((m) => m.startsAt === "2026-10-21T14:30:00-07:00")!;
  assert.ok(audit, "published");
  assert.equal(audit.location, null);
  assert.equal(audit.online, undefined, "and never called online");
  assert.equal(audit.agendaUrl, null);
  assert.equal(audit.id, "diligent:tusd1:2026-10-21T1430-audit");
  assert.equal(result.drops.unknownVenue, 1, "the gap is named in the count, and the row is kept");
  assert.equal(result.accounting.outcome, "CONSERVED");
});

test("a sitting keeps its identity when the portal starts listing it", () => {
  const before = union(PORTAL).meetings.find((m) => m.startsAt === "2026-10-06T16:30:00-07:00")!;
  const listed = union([
    ...PORTAL,
    row(521, "2026-10-06 16:30", "GOVERNING BOARD AGENDA REGULAR MEETING", "Duffy Community Center Multipurpose Room 5145 E. 5th Street Tucson, AZ 85711"),
  ]);
  const oct6 = listed.meetings.filter((m) => m.startsAt === "2026-10-06T16:30:00-07:00");
  assert.equal(oct6.length, 1, "one sitting, one row");
  assert.equal(oct6[0]!.id, before.id, "the id readers already have");
  assert.equal((oct6[0]!.provenance.sourceUrl ?? "").includes("MeetingInformation.aspx"), true, "now the portal's row");
});

test("an upcoming sitting already published under a portal id keeps it if the portal stops returning it", () => {
  const withoutAeac = PORTAL.filter((m) => m.Id !== 503);
  const aeac = union(withoutAeac).meetings.filter((m) => m.startsAt === "2026-09-28T18:15:00-07:00");
  assert.equal(aeac.length, 1);
  assert.equal(aeac[0]!.id, "diligent:tusd1:503");
  assert.equal(aeac[0]!.status, "SCHEDULED", "absence from the portal is never read as cancellation");
});

test("the portal's cancellation note is the sitting's status", () => {
  const result = union([
    row(500, "2026-09-11 16:00", "Budget Advisory Committee Meeting Agenda", "Via Zoom",
      "CANCELLED DUE TO LACK OF QUORUM Budget Advisory Committee Meeting Agenda - Sep 11 2026"),
  ]);
  const bac = result.meetings.find((m) => m.id === "diligent:tusd1:500")!;
  assert.equal(bac.status, "CANCELED");
  assert.match(bac.title, /^CANCELLED DUE TO LACK OF QUORUM/);
});

test("a portal row with no published place is published, not dropped", () => {
  const result = union([row(530, "2026-11-02 17:00", "Budget Advisory Committee Meeting Agenda", "")]);
  const row530 = result.meetings.find((m) => m.startsAt === "2026-11-02T17:00:00-07:00")!;
  assert.ok(row530);
  assert.equal(row530.location, null);
  assert.equal(row530.online, undefined);
  assert.equal(result.drops.unknownVenue, 1, "counted as a named gap");
  assert.equal(result.accounting.dropped, 0, "and not as a drop");
  assert.equal(result.accounting.outcome, "CONSERVED");
});

test("the calendar is read under a recorded robots verdict that never refuses it; a failed calendar read fails the run, never half a union", async () => {
  const asked: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    asked.push(url);
    if (url.includes("MeetingsService.svc")) {
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === "https://govboard.tusd1.org/robots.txt") {
      return new Response("User-agent: *\nDisallow: /inflow/\n", { status: 200, headers: { "content-type": "text/plain" } });
    }
    if (url === "https://govboard.tusd1.org/Actions") {
      return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
    }
    /* The disallowed calendar pages ARE requested now (owner decision 2026-09-25); this one fails, as a page can. */
    if (url.startsWith("https://govboard.tusd1.org/")) {
      return new Response("<html>Not found</html>", { status: 404, headers: { "content-type": "text/html" } });
    }
    throw new Error(`unexpected request ${url}`);
  }) as typeof fetch;
  const source = makeDiligentSource([WIRING], fetchImpl);
  await assert.rejects(
    () => source.fetch({ lat: 32.22, lng: -110.97, radiusKm: 50 }),
    (error: unknown) => error instanceof SourceHttpError && /HTTP 404/.test(error.message),
  );
  const govboard = asked.filter((u) => u.startsWith("https://govboard.tusd1.org/"));
  assert.equal(govboard[0], "https://govboard.tusd1.org/robots.txt", "the rules are read first");
  assert.ok(govboard.some((u) => u.includes("/inflow/")), `the disallowed calendar path is requested: ${govboard.join(", ")}`);
});

test("Sunnyside: the district's own SmartSites calendar is unioned the same way, and a sitting with no stated place still publishes", () => {
  const susd = SOURCE_WIRING.find((row) => row.bodyId.includes("sunnyside_unified_district"))!;
  const events = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "smartsites", "susd12-calendar-150042-events.json"), "utf8"));
  // The recorded response ends Dec 31; add the Jan 12, 2027 sitting the live
  // forward-window read of 2026-09-23 returned, exactly as the API shapes it.
  events.data.events.push({ id: "fixture-2026-12-15", title: "Governing Board Meeting", start_date: "2026-12-15", start_time: "18:30:00", address: "", all_day: false });
  const portalRows: DiligentMeeting[] = [168, 169, 170, 171, 172, 173].map((Id, i) => ({
    Id,
    Name: "Regular Governing Board Meeting",
    CleanName: "Regular Governing Board Meeting",
    MeetingDateTime: ["2026-09-29", "2026-10-13", "2026-10-27", "2026-11-10", "2026-11-24", "2026-12-08"][i] + " 18:30",
    MeetingLocation: "Fred T. Bull Administration Building - Governing Board Room",
    MeetingTypeName: "Regular Governing Board Meeting",
    TypeId: 27,
    Published: false,
  }));
  const result = makeDiligentSource([susd]).normalizeWithDrops!([{
    wiring: susd,
    meetings: portalRows,
    collectedAt: "2026-09-23T23:30:00.000Z",
    agendaRecords: null,
    scheduleCalendar: { events: { url: "https://www.susd12.org/api/calendars/150042/events?fixture", text: JSON.stringify(events) } },
  }], NOW);
  const ids = result.meetings.map((m) => m.id);
  assert.deepEqual(ids.filter((id) => !/:\d+$/.test(id)), ["diligent:susd12:2026-12-15T1830-governing-board"]);
  assert.equal(ids.filter((id) => /:\d+$/.test(id)).length, 6, "every portal row stands, ids unchanged");
  const dec15 = result.meetings.find((m) => m.id.endsWith("2026-12-15T1830-governing-board"))!;
  assert.equal(dec15.startsAt, "2026-12-15T18:30:00-07:00", "the district's wall clock, in the body's zone");
  assert.equal(dec15.location, null, "its entry states no place, and it is published anyway");
  assert.equal(dec15.online, undefined);
  assert.equal(result.accounting.outcome, "CONSERVED");
});

/*
 * RECORDED: the 17 portal rows production's TUSD partition held when the union
 * was built (cv-a088b86e…, promoted 2026-09-23T22:50:41Z, read read-only), in
 * the service's field names, beside the recorded calendar fragments. This is
 * the first promotion's effect, pinned.
 */
const RECORDED = JSON.parse(readFileSync(join(FIXTURES, "diligent-tusd-portal-rows.json"), "utf8")) as { rows: DiligentMeeting[] };
const AT_PROMOTION = new Date("2026-09-23T16:25:00-07:00");

function recordedUnion(rows: DiligentMeeting[]) {
  return makeDiligentSource([WIRING]).normalizeWithDrops!([{
    wiring: WIRING,
    meetings: rows,
    collectedAt: "2026-09-23T23:25:00.000Z",
    agendaRecords: null,
    scheduleCalendar: { months: months() },
  }], AT_PROMOTION);
}

test("recorded: the first promotion keeps all 17 portal ids and adds exactly the four calendar-only Governing Board sittings", () => {
  const result = recordedUnion(RECORDED.rows);
  const portalIds = RECORDED.rows.map((r) => `diligent:tusd1:${r.Id}`).sort();
  assert.deepEqual(result.meetings.filter((m) => /:\d+$/.test(m.id)).map((m) => m.id).sort(), portalIds);
  const added = result.meetings.filter((m) => !/:\d+$/.test(m.id));
  assert.deepEqual(added.map((m) => m.id).sort(), [
    "diligent:tusd1:2026-10-06T1630-governing-board",
    "diligent:tusd1:2026-10-27T1630-governing-board",
    "diligent:tusd1:2026-11-17T1630-governing-board",
    "diligent:tusd1:2026-12-08T1630-governing-board",
  ]);
  for (const m of added) {
    assert.equal(m.location?.name, "Duffy Community Center, Multipurpose Room");
    assert.equal(m.agendaUrl, null);
    assert.equal(m.status, "SCHEDULED");
  }
  assert.equal(result.drops.unknownVenue, 0, "every recorded row has a reviewed place");
  assert.equal(result.accounting.outcome, "CONSERVED");
});

test("recorded: row 500's own title says CANCELLED, so it is CANCELED, not CONCLUDED", () => {
  const result = recordedUnion(RECORDED.rows);
  const row500 = result.meetings.find((m) => m.id === "diligent:tusd1:500")!;
  assert.match(row500.title, /^CANCELLED DUE TO LACK OF QUORUM/);
  assert.equal(row500.status, "CANCELED");
  // Only the publisher's own words cancel: no other recorded row is CANCELED.
  assert.deepEqual(result.meetings.filter((m) => m.status === "CANCELED").map((m) => m.id), ["diligent:tusd1:500"]);
});

test("recorded, planted: a portal row whose place is blanked is published with the gap named, never dropped", () => {
  const rows = RECORDED.rows.map((r) => (r.Id === 505 ? { ...r, MeetingLocation: "" } : r));
  const result = recordedUnion(rows);
  const row505 = result.meetings.find((m) => m.id === "diligent:tusd1:505")!;
  assert.ok(row505, "published");
  assert.equal(row505.location, null);
  assert.equal(row505.online, undefined, "not online: the portal said nothing about how");
  assert.equal(result.drops.unknownVenue, 1);
  assert.equal(result.accounting.dropped, 0);
  assert.equal(result.meetings.length, 21);
});

test("the calendar route reads exactly the forward window's months", () => {
  // DB-04: the forward window is the held 120 days, which from this NOW reaches into January.
  assert.deepEqual(forwardCalendarMonths(NOW), ["2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01"]);
});
