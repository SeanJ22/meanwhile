import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import registryFile from "../lib/registry/registry.json" with { type: "json" };
import {
  SOURCE_WIRING,
  wiringForTypes,
} from "../lib/registry/source-wiring.ts";
import { makeApptegySource } from "../lib/sources/apptegy/index.ts";
import {
  makeCivicPlusSource,
  parseIcalEvents,
} from "../lib/sources/civicplus/index.ts";
import { makeDiligentSource } from "../lib/sources/diligent/index.ts";
import {
  makeOnBaseSource,
  parseOnBaseRows,
} from "../lib/sources/onbase/index.ts";

/**
 * Every adapter's normalize path, against responses recorded from the live
 * sources on 2026-08-13. No live calls — the fixtures are the record.
 *
 * `NOW` is fixed so SCHEDULED/CONCLUDED are deterministic: the fixtures carry
 * real calendar dates, and a test that read the wall clock would rot.
 */
const NOW = new Date("2026-08-13T12:00:00-07:00");

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

// ── The identifier rule, enforced structurally ─────────────────────────────
// Compare identifier sets before writing any adapter: every wiring row must
// name a body the registry actually has. This has failed silently four times
// in this project; here the denominator prints in the assertion message.

test("every source-wiring row names a real registry body", () => {
  const bodyIds = new Set(registryFile.bodies.map((b: { id: string }) => b.id));
  const missing = SOURCE_WIRING.filter((w) => !bodyIds.has(w.bodyId));
  assert.deepEqual(
    missing.map((w) => w.bodyId),
    [],
    `${SOURCE_WIRING.length - missing.length} of ${SOURCE_WIRING.length} wiring rows matched a registry body`,
  );
});

test("every wiring row's ocdId is its bodyId without the slot", () => {
  for (const w of SOURCE_WIRING) {
    assert.equal(w.bodyId.split("#")[0], w.ocdId, w.bodyId);
  }
});

// ── CivicPlus (Rockaway Township) ──────────────────────────────────────────

test("civicplus: iCal parses and council sittings normalize with venues", () => {
  const rows = wiringForTypes(["CIVICPLUS"]);
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
    assert.equal(m.location.name, "Rockaway Township Municipal Building");
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

// ── OnBase (Tucson) ────────────────────────────────────────────────────────

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

  // 8 Mayor & Council sittings map to the cited chambers; the Joint Meeting
  // and the Public Housing Authority Board have no cited venue and drop.
  assert.equal(meetings.length, 8);
  assert.equal(drops.unknownVenue, 2);

  const regular = meetings.find((m) => m.id === "onbase:tucson:1957");
  assert.ok(regular);
  assert.equal(regular.bodyName, "Mayor & Council");
  assert.equal(regular.title, "Mayor & Council - Regular");
  assert.equal(regular.location.address, "255 W. Alameda St, Tucson, AZ 85701");
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

// ── Apptegy (Vail USD + Rockaway Township SD) ──────────────────────────────

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
  assert.equal(vailAug25.location.lat, 32.0149457);
  assert.equal(vailAug25.location.lng, -110.6984644);
  // The agenda link is the district's own published pointer to its portal.
  assert.ok(
    vailAug25.agendaUrl?.includes("highbond.com"),
    `agenda link observed in the event description: ${vailAug25.agendaUrl}`,
  );

  const rtsdSep9 = rtsdMeetings.find((m) => m.startsAt.startsWith("2026-09-09"));
  assert.ok(rtsdSep9, "RTSD board meets 2026-09-09");
  assert.equal(rtsdSep9.location.lat, 40.917793);
  assert.equal(
    rtsdSep9.ocdId,
    "ocd-division/country:us/state:nj/school_district:rockaway_township_school_district",
  );
});

// ── Diligent / CivicWeb (TUSD + Newbury) ───────────────────────────────────

test("diligent: TUSD meetings normalize, Zoom sittings count as placeless", () => {
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

  // The recorded window holds 11 rows: Duffy Center sittings place, the Zoom
  // webinars are placeless (a real meeting with nothing to pin), and any
  // location the cache does not know drops as unknownVenue.
  assert.ok(meetings.length >= 3, `placed meetings: ${meetings.length}`);
  assert.ok(drops.placeless >= 3, `zoom sittings counted: ${drops.placeless}`);
  assert.equal(
    meetings.length + drops.placeless + drops.unknownVenue + drops.unplaceableInTime,
    11,
    "every row accounted for",
  );

  const regular = meetings.find((m) => m.id === "diligent:tusd1:492");
  assert.ok(regular, "Governing Board regular meeting of 2026-08-11");
  assert.equal(regular.bodyName, "GOVERNING BOARD AGENDA REGULAR MEETING");
  assert.equal(regular.location.name, "Duffy Community Center, Multipurpose Room");
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
  const source = makeDiligentSource(rows);
  const newbury = rows.find((r) => r.config.slug === "newburynh");
  assert.ok(newbury);

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
  assert.equal(upcoming.location.address, "937 Route 103, Newbury, NH 03255");
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
