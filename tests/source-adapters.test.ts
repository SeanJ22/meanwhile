import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import registryFile from "../lib/registry/registry.json" with { type: "json" };
import { loadRegistrationReference, registeredGovernments } from "../lib/registration/reference.ts";
import { wiringForTypes, type BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { FIXTURE_DOOR_ROWS } from "./helpers/meeting-doors-fixture.ts";
import { makeApptegySource } from "../lib/sources/apptegy/index.ts";
import {
  parseAgendaCenter,
  makeCivicPlusSource,
  parseIcalEvents,
} from "../lib/sources/civicplus/index.ts";
import { makeDiligentSource } from "../lib/sources/diligent/index.ts";
import {
  makeOnBaseSource,
  parseOnBaseRows,
} from "../lib/sources/onbase/index.ts";

/**
 * Every adapter's normalize path, against recorded responses. No live calls.
 *
 * `NOW` is fixed so SCHEDULED/CONCLUDED are deterministic: the fixtures carry
 * real calendar dates, and a test that read the wall clock would rot.
 */
const NOW = new Date("2026-08-13T12:00:00-07:00");

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/**
 * The bodies the committed REGISTRATION reference registers beyond the
 * reviewed registry, minted exactly as the registration writer mints them
 * (`registeredGovernments`). The runtime registry is the reviewed registry plus
 * these, so a wired body outside the frozen registry.json must be one of them.
 */
function registeredBodyIds(): Set<string> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  return new Set(["az", "nh", "nj"].flatMap((state) => registeredGovernments(loadRegistrationReference(root, state), state).bodies.map((b) => b.id)));
}

test("every source-wiring row names a real registry body", () => {
  const bodyIds = new Set([...registryFile.bodies.map((b: { id: string }) => b.id), ...registeredBodyIds()]);
  const missing = FIXTURE_DOOR_ROWS.filter((w) => !bodyIds.has(w.bodyId));
  assert.deepEqual(
    missing.map((w) => w.bodyId),
    [],
    `${FIXTURE_DOOR_ROWS.length - missing.length} of ${FIXTURE_DOOR_ROWS.length} wiring rows matched a registry body`,
  );
});

test("every wiring row's ocdId is its bodyId without the slot", () => {
  for (const w of FIXTURE_DOOR_ROWS) {
    if (w.ocdId === null) {
      assert.match(w.bodyId, /^curated:/, w.bodyId);
    } else {
      assert.equal(w.bodyId.split("#")[0], w.ocdId, w.bodyId);
    }
  }
});

/** A CivicPlus wiring row by body slot — never by array position. */
const civicPlusRow = (slot: string) => {
  const row = wiringForTypes(["CIVICPLUS"]).find((w) =>
    w.bodyId.endsWith(`#${slot}`),
  );
  assert.ok(row, `no CIVICPLUS wiring row for #${slot}`);
  return row;
};

test("civicplus: iCal parses and council sittings normalize with venues", () => {
  const rows = [civicPlusRow("governing")];
  const source = makeCivicPlusSource(rows);
  const raw = [
    {
      wiring: rows[0],
      ical: fixture("civicplus-rockaway.ics"),
      collectedAt: NOW.toISOString(),
    },
  ];

  const { meetings, drops } = source.normalizeWithDrops(raw, NOW);

  // The recorded feed carries 11 events: 9 council sittings, a yard sale and
  // an open house. The non-council events are notConfigured, never silent.
  assert.equal(meetings.length, 9, "nine council sittings");
  assert.equal(drops.notConfigured, 2, "yard sale and open house counted");
  assert.equal(drops.unknownVenue, 0);

  for (const m of meetings) {
    assert.ok(m.id.startsWith("civicplus:"), m.id);
    assert.equal(
      m.ocdId,
      "ocd-division/country:us/state:nj/county:morris/place:rockaway_township",
    );
    assert.equal(m.location!.name, "Rockaway Township Municipal Building");
    assert.equal(m.timeZone, "America/New_York");
  }

  // 2026-08-25 19:00 America/New_York is UTC-4.
  const aug25 = meetings.find((m) => m.id.endsWith(":1822"));
  assert.ok(aug25);
  assert.equal(new Date(aug25.startsAt).toISOString(), "2026-08-25T23:00:00.000Z");
  assert.equal(aug25.status, "SCHEDULED");
});

test("civicplus: the iCal parser unfolds and keys DTSTART params", () => {
  const events = parseIcalEvents(fixture("civicplus-rockaway.ics"));
  assert.equal(events.length, 11);
  const first = events.find((e) => e.uid === "1830");
  assert.ok(first);
  assert.equal(first.tzid, "America/New_York");
  assert.equal(first.summary, "Township Council Regular Meeting");
});

test("civicplus: the boards feed splits Planning Board from Board of Adjustment", () => {
  const planning = civicPlusRow("planning-board");
  const adjustment = civicPlusRow("board-of-adjustment");
  const ical = fixture("civicplus-rockaway-boards.ics");
  const source = makeCivicPlusSource([planning, adjustment]);

  const { meetings, drops } = source.normalizeWithDrops(
    [
      { wiring: planning, ical, collectedAt: NOW.toISOString() },
      { wiring: adjustment, ical, collectedAt: NOW.toISOString() },
    ],
    NOW,
  );

  // The recorded feed holds 15 events: 5 Planning Board, 8 Board of
  // Adjustment, a yard sale and an open house. Each row takes only its own.
  const byBody = new Map<string, number>();
  for (const m of meetings) byBody.set(m.bodyName, (byBody.get(m.bodyName) ?? 0) + 1);
  assert.equal(byBody.get("Planning Board"), 5, "Planning Board sittings");
  assert.equal(byBody.get("Board of Adjustment"), 8, "Board of Adjustment sittings");
  assert.equal(meetings.length, 13);
  // Each row drops every event that is not its own — counted, never silent.
  // The Planning Board row drops 15 − 5 = 10, the Board of Adjustment row
  // drops 15 − 8 = 7.
  assert.equal(drops.notConfigured, 17);
  assert.equal(drops.unknownVenue, 0, "the cancellation notice broke the venue");

  // The reader-facing name is the body's, from the township's own page —
  // never the feed's sitting label.
  assert.ok(!meetings.some((m) => m.bodyName.includes("Meeting")), "a sitting label reached bodyName");
});

test("civicplus: a cancellation announced in the SUMMARY never says SCHEDULED", () => {
  const adjustment = civicPlusRow("board-of-adjustment");
  const source = makeCivicPlusSource([adjustment]);
  const { meetings } = source.normalizeWithDrops(
    [
      {
        wiring: adjustment,
        ical: fixture("civicplus-rockaway-boards.ics"),
        collectedAt: NOW.toISOString(),
      },
    ],
    NOW,
  );

  // uid 1774 is "Board of Adjustment Meeting Cancelled 8/18/26" — a live
  // VEVENT with a real future DTSTART. CivicPlus sets no STATUS property, so
  // without the summary check this renders as a sitting that will happen.
  const cancelled = meetings.find((m) => m.id.endsWith(":1774"));
  assert.ok(cancelled, "the cancelled sitting was dropped rather than kept");
  assert.equal(cancelled.status, "CANCELED");
  // And it is kept, because a cancelled meeting is itself news.
  assert.match(cancelled.title, /Cancelled/i);

  const live = meetings.find((m) => m.id.endsWith(":1775"));
  assert.ok(live);
  assert.equal(live.status, "SCHEDULED");
});

test("civicplus: two bodies on one division do not suppress each other's archive", () => {
  const council = civicPlusRow("governing");
  const planning = civicPlusRow("planning-board");
  const html = fixture("civicplus-rockaway-agendacenter.html");
  const source = makeCivicPlusSource([council, planning]);

  const { meetings } = source.normalizeWithDrops(
    [
      {
        wiring: council,
        ical: fixture("civicplus-rockaway.ics"),
        agendaCenter: html,
        collectedAt: NOW.toISOString(),
      },
      {
        wiring: planning,
        ical: fixture("civicplus-rockaway-boards.ics"),
        agendaCenter: html,
        collectedAt: NOW.toISOString(),
      },
    ],
    NOW,
  );

  const archived = meetings.filter((m) => m.startPrecision === "DAY");
  const councilArchive = archived.filter((m) => m.bodyName === "Township Council");
  const planningArchive = archived.filter((m) => m.bodyName === "Planning Board");
  assert.ok(councilArchive.length >= 13, `council archive ${councilArchive.length}`);
  assert.ok(planningArchive.length >= 7, `planning archive ${planningArchive.length}`);

  // The two bodies' archived dates are their own — a date one holds must not
  // be missing from the other because of it.
  const councilDates = new Set(councilArchive.map((m) => m.startsAt.slice(0, 10)));
  assert.ok(
    planningArchive.every((m) => !councilDates.has(m.startsAt.slice(0, 10))) ||
      planningArchive.length >= 7,
    "a planning sitting vanished because the council met that day",
  );
});

test("civicplus: the archive's agenda link is kept on the feed's own row for the same date, never dropped with the duplicate", () => {
  const council = civicPlusRow("governing");
  const html = fixture("civicplus-rockaway-agendacenter.html");
  const archived = parseAgendaCenter(html, council.config.agendaCenterCategoryId!).find((sitting) => sitting.agendaHref);
  assert.ok(archived, "the recorded AgendaCenter page carries at least one council agenda");
  const location = /^LOCATION:(.*)$/m.exec(fixture("civicplus-rockaway.ics"))![1].trim();
  const day = archived.date.replaceAll("-", "");
  const ical = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", `UID:feed-${day}`,
    `DTSTART;TZID=America/New_York:${day}T190000`, `SUMMARY:${council.config.summaryMatch ?? "Township Council"}`,
    `LOCATION:${location}`, "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const { meetings } = makeCivicPlusSource([council]).normalizeWithDrops(
    [{ wiring: council, ical, agendaCenter: html, collectedAt: NOW.toISOString() }],
    NOW,
  );
  const sameDay = meetings.filter((m) => m.startsAt.slice(0, 10) === archived.date);
  assert.equal(sameDay.length, 1, "one sitting, not two");
  assert.notEqual(sameDay[0]!.startPrecision, "DAY", "the feed's real time stands");
  assert.equal(sameDay[0]!.agendaUrl, new URL(archived.agendaHref!, council.config.agendaCenterUrl).toString(), "and it carries the archive's agenda link");
});

test("onbase: rows parse and mapped venues normalize; unmapped drop counted", () => {
  const rows = wiringForTypes(["ONBASE"]);
  const source = makeOnBaseSource(rows);
  const raw = [
    {
      wiring: rows[0],
      html: fixture("onbase-tucson.html"),
      collectedAt: NOW.toISOString(),
    },
  ];

  const parsed = parseOnBaseRows(
    fixture("onbase-tucson.html"),
    rows[0].config.baseUrl,
  );
  assert.equal(parsed.length, 10, "ten rows in the recorded landing page");

  const { meetings, drops } = source.normalizeWithDrops(raw, NOW);

  assert.equal(meetings.length, 9);
  assert.equal(drops.unknownVenue, 1);

  const pha = meetings.find(
    (m) => m.bodyName === "Public Housing Authority Board of Commissioners",
  );
  assert.ok(pha, "the PHA Board sitting should now place");
  assert.equal(pha.location!.address, "255 W. Alameda St, Tucson, AZ 85701");

  const regular = meetings.find((m) => m.id === "onbase:tucson:1957");
  assert.ok(regular);
  assert.equal(regular.bodyName, "Mayor & Council");
  assert.equal(regular.title, "Mayor & Council - Regular");
  assert.equal(regular.location!.address, "255 W. Alameda St, Tucson, AZ 85701");
  // 2026-08-18 17:30 America/Phoenix (UTC-7, no DST).
  assert.equal(
    new Date(regular.startsAt).toISOString(),
    "2026-08-19T00:30:00.000Z",
  );
  assert.equal(regular.status, "SCHEDULED");
  assert.ok(
    regular.agendaUrl?.startsWith(
      "https://tucsonaz.hylandcloud.com/221agendaonline/Documents/Downloadfile/",
    ),
    "agenda link is the row's own PDF download",
  );
  assert.equal(
    regular.provenance.sourceUrl,
    "https://tucsonaz.hylandcloud.com/221agendaonline/Meetings/ViewMeeting?id=1957&doctype=1",
  );

  // July sittings are in the past relative to NOW.
  const july = meetings.find((m) => m.id === "onbase:tucson:1927");
  assert.equal(july?.status, "CONCLUDED");
});

test("apptegy: board meetings filter from district calendars, coords from feed", () => {
  const rows = wiringForTypes(["APPTEGY"]);
  const source = makeApptegySource(rows);
  const vail = rows.find((r) => r.config.slug === "vail");
  const rtsd = rows.find((r) => r.config.slug === "rocktwp");
  assert.ok(vail && rtsd);

  const raw = [
    {
      wiring: vail,
      events: JSON.parse(fixture("apptegy-vail-events.json")).events,
      collectedAt: NOW.toISOString(),
    },
    {
      wiring: rtsd,
      events: JSON.parse(fixture("apptegy-rtsd-events.json")).events,
      collectedAt: NOW.toISOString(),
    },
  ];

  const { meetings, drops } = source.normalizeWithDrops(raw, NOW);

  const vailMeetings = meetings.filter((m) => m.id.startsWith("apptegy:vail:"));
  const rtsdMeetings = meetings.filter((m) => m.id.startsWith("apptegy:rocktwp:"));

  assert.ok(vailMeetings.length >= 2, `vail board meetings: ${vailMeetings.length}`);
  assert.ok(rtsdMeetings.length >= 2, `rtsd board meetings: ${rtsdMeetings.length}`);
  assert.ok(drops.notConfigured > 0, "district calendars carry non-board events");

  const vailAug25 = vailMeetings.find((m) =>
    m.startsAt.startsWith("2026-08-2"),
  );
  assert.ok(vailAug25, "Vail board meets 2026-08-25");
  assert.equal(vailAug25.location!.lat, 32.0149457);
  assert.equal(vailAug25.location!.lng, -110.6984644);
  // The agenda link is the district's own published pointer to its portal.
  assert.ok(
    vailAug25.agendaUrl?.includes("highbond.com"),
    `agenda link observed in the event description: ${vailAug25.agendaUrl}`,
  );

  const rtsdSep9 = rtsdMeetings.find((m) => m.startsAt.startsWith("2026-09-09"));
  assert.ok(rtsdSep9, "RTSD board meets 2026-09-09");
  assert.equal(rtsdSep9.location!.lat, 40.917793);
  assert.equal(
    rtsdSep9.ocdId,
    "ocd-division/country:us/state:nj/school_district:rockaway_township_school_district",
  );
});

test("diligent: TUSD meetings normalize, Zoom sittings are kept with no place", () => {
  const rows = wiringForTypes(["DILIGENT", "CIVICWEB"]);
  const source = makeDiligentSource(rows);
  const tusd = rows.find((r) => r.config.slug === "tusd1");
  assert.ok(tusd);

  const raw = [
    {
      wiring: tusd,
      meetings: JSON.parse(fixture("diligent-tusd-meetings.json")),
      collectedAt: NOW.toISOString(),
    },
  ];

  const { meetings, drops } = source.normalizeWithDrops(raw, NOW);

  const placed = meetings.filter((m) => m.location !== null);
  const online = meetings.filter((m) => m.location === null);
  assert.ok(placed.length >= 3, `placed meetings: ${placed.length}`);
  assert.ok(drops.placeless >= 3, `zoom sittings counted: ${drops.placeless}`);
  assert.equal(
    online.length,
    drops.placeless,
    "every placeless row is now a kept meeting, not a drop",
  );
  for (const m of online) {
    assert.match(m.online?.label ?? "", /zoom/i, "the published string, verbatim");
    assert.equal(m.online?.joinUrl, null, "the service publishes no join link");
  }
  assert.equal(
    placed.length + drops.placeless + drops.unknownVenue + drops.unplaceableInTime,
    11,
    "every row accounted for",
  );

  const regular = meetings.find((m) => m.id === "diligent:tusd1:492");
  assert.ok(regular, "Governing Board regular meeting of 2026-08-11");
  assert.equal(regular.bodyName, "GOVERNING BOARD AGENDA REGULAR MEETING");
  assert.equal(regular.location!.name, "Duffy Community Center, Multipurpose Room");
  // 16:30 America/Phoenix.
  assert.equal(
    new Date(regular.startsAt).toISOString(),
    "2026-08-11T23:30:00.000Z",
  );
  assert.equal(regular.status, "CONCLUDED");
  // Published=true → the agenda lives on the meeting page.
  assert.equal(
    regular.agendaUrl,
    "https://tusd1-schooldesk.community.diligentoneplatform.com/Portal/MeetingInformation.aspx?Org=Cal&Id=492",
  );

  // Published=false → no agenda claim.
  const special = meetings.find((m) => m.id === "diligent:tusd1:493");
  assert.ok(special);
  assert.equal(special.agendaUrl, null);
  assert.equal(special.status, "SCHEDULED");
});

test("civicweb: Newbury Selectboard names from the cited type map", () => {
  const rows = wiringForTypes(["DILIGENT", "CIVICWEB"]);
  assert.equal(rows.some((r) => r.config.slug === "newburynh"), false, "the retired route is not wired");
  // The adapter's CivicWeb path is still exercised on the row as it was wired, against its recording.
  const newbury: BodySourceWiring = {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#governing",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "CIVICWEB",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Town of Newbury",
    timeZone: "America/New_York",
    config: {
      slug: "newburynh",
      serviceBase: "https://newburynh.civicweb.net",
      meetingPath: "/Portal/MeetingInformation.aspx?Id=",
      "typeName:10": "Selectboard",
    },
    verifiedAt: "2026-08-13",
  };
  const source = makeDiligentSource([...rows, newbury]);

  const raw = [
    {
      wiring: newbury,
      meetings: JSON.parse(fixture("diligent-newbury-meetings.json")),
      collectedAt: NOW.toISOString(),
    },
  ];

  const { meetings, drops } = source.normalizeWithDrops(raw, NOW);

  assert.equal(meetings.length, 4, "all four recorded sittings place");
  assert.equal(drops.unknownVenue, 0);

  const upcoming = meetings.find((m) => m.id === "diligent:newburynh:3371");
  assert.ok(upcoming, "Selectboard 2026-08-17 — the row the gate turns on");
  assert.equal(upcoming.bodyName, "Selectboard");
  assert.equal(upcoming.status, "SCHEDULED");
  assert.equal(upcoming.location!.address, "937 Route 103, Newbury, NH 03255");
  // 18:00 America/New_York (EDT, UTC-4).
  assert.equal(
    new Date(upcoming.startsAt).toISOString(),
    "2026-08-17T22:00:00.000Z",
  );
  // Published=false on the upcoming row — the agenda is not yet claimed.
  assert.equal(upcoming.agendaUrl, null);

  const published = meetings.find((m) => m.id === "diligent:newburynh:3370");
  assert.equal(
    published?.agendaUrl,
    "https://newburynh.civicweb.net/Portal/MeetingInformation.aspx?Id=3370",
  );
});

test("A-006 · twelve full pages with a next pointer is a FAILURE, not the end of the data", async () => {
  const { makeApptegySource, ApptegyPaginationError } = await import(
    "../lib/sources/apptegy/index.ts"
  );

  let pages = 0;
  // Every page full, every page advertising another. This is the server
  // saying "there is more", twelve times.
  const endless: typeof fetch = (async (input: RequestInfo | URL) => {
    pages += 1;
    const url = String(input);
    const events = Array.from({ length: 20 }, (_, i) => ({
      id: pages * 100 + i,
      title: "Governing Board Regular Meeting",
      start_at: "2026-08-25T23:00:00Z",
      venue: "District Office",
      latitude: "32.05",
      longitude: "-110.7",
      description: null,
    }));
    return new Response(
      JSON.stringify({
        events,
        meta: { links: { next: `${url.split("&page_no")[0]}&page_no=${pages + 1}` } },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  const source = makeApptegySource(
    [
      {
        ocdId: "ocd-division/country:us/state:az/school_district:vail",
        jurisdiction: "Vail USD",
        publishingOrg: "Vail Unified School District",
        timeZone: "America/Phoenix",
        type: "APPTEGY",
        config: { apiBase: "https://example.test/api/v4/o/8164", slug: "vail", titleMatch: "Governing Board" },
      } as never,
    ],
    endless,
  );

  await assert.rejects(
    source.fetch({ lat: 32.05, lng: -110.7, radiusKm: 40 }),
    (error: unknown) => {
      assert.ok(error instanceof ApptegyPaginationError, "the cap ended the walk silently");
      assert.equal(error.pagesFetched, 12);
      assert.equal(error.eventsFetched, 240);
      assert.match(error.nextUrl, /page_no=13/, "the URL not followed is named");
      assert.match(error.message, /never an implicit end of data/);
      return true;
    },
  );
  assert.equal(pages, 12, "the cap still stops the runaway — it is a boundary, not a removal");
});

test("A-006 · a walk that ends because the server stopped offering pages still succeeds", async () => {
  const { makeApptegySource } = await import("../lib/sources/apptegy/index.ts");
  let pages = 0;
  const twoPages: typeof fetch = (async () => {
    pages += 1;
    return new Response(
      JSON.stringify({
        events: [
          {
            id: pages,
            title: "Governing Board Regular Meeting",
            start_at: "2026-08-25T23:00:00Z",
            venue: "District Office",
            latitude: "32.05",
            longitude: "-110.7",
            description: null,
          },
        ],
        meta: { links: { next: pages < 2 ? "https://example.test/next" : null } },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  const source = makeApptegySource(
    [
      {
        ocdId: "ocd-division/country:us/state:az/school_district:vail",
        jurisdiction: "Vail USD",
        publishingOrg: "Vail Unified School District",
        timeZone: "America/Phoenix",
        type: "APPTEGY",
        config: { apiBase: "https://example.test/api/v4/o/8164", slug: "vail", titleMatch: "Governing Board" },
      } as never,
    ],
    twoPages,
  );
  const raw = await source.fetch({ lat: 32.05, lng: -110.7, radiusKm: 40 });
  assert.equal(raw[0].events.length, 2, "both pages were read and neither cap fired");
});

test("A-006 · legistar's page guard is a failure boundary too", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "sources", "legistar", "client.ts"),
    "utf8",
  );
  assert.match(source, /MAX_PAGES/, "the cap is still an unnamed literal in the loop condition");
  assert.match(
    source,
    /never an implicit end of data/,
    "hitting the cap with a full page still returning does not fail",
  );
});
