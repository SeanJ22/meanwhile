import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { extractPdfText } from "../lib/meetings/agenda-documents.ts";
import { placelessWhereLine } from "../lib/meetings/online.ts";
import { unplacedVenueGap } from "../lib/meetings/venue-cache.ts";
import { wiringForTypes, type BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { FIXTURE_DOOR_ROWS } from "./helpers/meeting-doors-fixture.ts";
import { makeApptegySource, type ApptegyEvent } from "../lib/sources/apptegy/index.ts";
import { makeCivicClerkSource, type CivicClerkEvent } from "../lib/sources/civicclerk/index.ts";
import { makeCivicPlusSource } from "../lib/sources/civicplus/index.ts";
import { makeClerksBoardsSource } from "../lib/sources/clerksboards/index.ts";
import { makeDiligentSource, type DiligentMeeting } from "../lib/sources/diligent/index.ts";
import { makeIcalSource, namesNoPlace, type IcalRaw } from "../lib/sources/ical/index.ts";
import { makeIqm2Source } from "../lib/sources/iqm2/index.ts";
import { makeOnBaseSource } from "../lib/sources/onbase/index.ts";
import { makePimaEduSource, type PimaEduRaw } from "../lib/sources/pima-edu/index.ts";
import { makeRevizeSource } from "../lib/sources/revize/index.ts";
import { makeSchedulePageSource } from "../lib/sources/schedulepage/index.ts";
import type { Meeting } from "../lib/sources/types.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

function row(types: Parameters<typeof wiringForTypes>[0], match: (w: BodySourceWiring) => boolean): BodySourceWiring {
  const found = wiringForTypes(types).find(match);
  assert.ok(found, `no ${types.join("/")} wiring row matched`);
  return found;
}

function assertStated(m: Meeting | undefined, words: string, publisher: string): void {
  assert.ok(m, "the sitting is published");
  assert.equal(m.location, null, `${m.id} was pinned`);
  assert.equal(m.online, undefined, `${m.id} was called online`);
  assert.deepEqual(m.venueGap, { kind: "STATED_NOT_PLACED", publishedText: words, publisher }, m.id);
  assert.equal(placelessWhereLine(m), words, `${m.id}: the reader's Where line is the publisher's words`);
}

function assertNotStated(m: Meeting | undefined, publisher: string): void {
  assert.ok(m, "the sitting is published");
  assert.equal(m.location, null, `${m.id} was pinned`);
  assert.equal(m.online, undefined, `${m.id} was called online`);
  assert.deepEqual(m.venueGap, { kind: "NOT_STATED_BY_PUBLISHER", publishedText: null, publisher }, m.id);
}

function assertUnrecorded(m: Meeting | undefined): void {
  assert.ok(m, "the sitting is published");
  assert.equal(m.location, null, `${m.id} was pinned`);
  assert.equal(m.online, undefined, `${m.id} was called online`);
  assert.equal(m.venueGap, undefined, `${m.id}: our own place-not-recorded gap carries no venueGap`);
}

test("unplacedVenueGap: words are the stated place, verbatim; blank is the publisher's silence", () => {
  assert.deepEqual(unplacedVenueGap("  Study Session ", "City of Mesa City Clerk"), {
    kind: "STATED_NOT_PLACED",
    publishedText: "Study Session",
    publisher: "City of Mesa City Clerk",
  });
  for (const blank of [null, undefined, "", "   "]) {
    assert.deepEqual(unplacedVenueGap(blank, "X"), { kind: "NOT_STATED_BY_PUBLISHER", publishedText: null, publisher: "X" });
  }
});

test("civicclerk: an unreviewed room and a blank one are published with the gap, a reviewed room still placed", () => {
  const held = row(["CIVICCLERK"], (w) => w.config.slug === "capaz");
  const wiring = { ...held, config: { ...held.config, categoryId: "1" } };
  const base: CivicClerkEvent = {
    id: 0, eventName: "Board Meeting", eventDate: "2026-10-01T10:00:00", startDateTime: "2026-10-01T10:00:00",
    categoryId: 1, eventCategoryName: "Board Meeting", hasAgenda: false, isDeleted: false, isPublished: true,
  };
  const events: CivicClerkEvent[] = [
    { ...base, id: 1, eventLocation: { locationName: "Musical Instrument Museum", address1: "4725 E Mayo Blvd", city: "Phoenix", state: "AZ", zipCode: "85050" } },
    { ...base, id: 2, eventLocation: { locationName: "Salt River Project Board Room", address1: "1521 N Project Dr", city: "Tempe", state: "AZ", zipCode: "85281" } },
    { ...base, id: 3, eventLocation: null },
  ];
  const { meetings, drops, accounting } = makeCivicClerkSource([wiring]).normalizeWithDrops(
    [{ wiring, events, collectedAt: "2026-09-23T20:00:00.000Z" }],
    new Date("2026-09-23T20:00:00Z"),
  );
  assert.equal(meetings.length, 3);
  const byId = new Map(meetings.map((m) => [m.id, m]));
  assert.equal(byId.get("civicclerk:capaz:1")!.location?.name, "Musical Instrument Museum", "a reviewed room is placed as before");
  assertStated(byId.get("civicclerk:capaz:2"), "Salt River Project Board Room, 1521 N Project Dr, Tempe, AZ, 85281", wiring.publishingOrg);
  assertNotStated(byId.get("civicclerk:capaz:3"), wiring.publishingOrg);
  assert.equal(drops.unknownVenue, 2);
  assert.equal(accounting.dropped, 0);
  assert.equal(accounting.outcome, "CONSERVED");
});

test("civicplus: an event whose LOCATION has no reviewed row is published in the feed's words", () => {
  const wiring = row(["CIVICPLUS"], (w) => w.bodyId.endsWith("#governing"));
  const ical = fixture("civicplus-rockaway.ics")
    .split("BEGIN:VEVENT")
    .map((block) => (block.includes("UID:1830") ? block.replace(/^LOCATION:.*$/m, "LOCATION:Rockaway Township Public Library") : block))
    .join("BEGIN:VEVENT");
  const now = new Date("2026-08-13T12:00:00-07:00");
  const { meetings, drops, accounting } = makeCivicPlusSource([wiring]).normalizeWithDrops(
    [{ wiring, ical, collectedAt: now.toISOString() }],
    now,
  );
  assert.equal(meetings.length, 9, "all nine council sittings, as before");
  assertStated(meetings.find((m) => m.id.endsWith(":1830")), "Rockaway Township Public Library", wiring.publishingOrg);
  for (const m of meetings.filter((x) => !x.id.endsWith(":1830"))) {
    assert.equal(m.location?.name, "Rockaway Township Municipal Building", `${m.id} placed as before`);
  }
  assert.equal(drops.unknownVenue, 1);
  assert.equal(accounting.dropped, 2, "only the yard sale and the open house, which are not this body's");
});

test("civicplus: an archived sitting with no published venue names the publisher's silence", () => {
  const council = row(["CIVICPLUS"], (w) => w.bodyId.endsWith("#governing"));
  // The same body, scoped where no venue row exists, so `soleVenueForBody` finds none.
  const unscoped: BodySourceWiring = { ...council, ocdId: "ocd-division/country:us/state:nj/county:morris/place:dover" };
  const now = new Date("2026-08-13T12:00:00-07:00");
  const { meetings, drops, accounting } = makeCivicPlusSource([unscoped]).normalizeWithDrops(
    [{ wiring: unscoped, ical: fixture("civicplus-rockaway.ics"), agendaPages: [{ url: unscoped.config.agendaCenterUrl, text: fixture("civicplus-rockaway-agendacenter.html"), collectedAt: now.toISOString() }], collectedAt: now.toISOString() }],
    now,
  );
  const archived = meetings.filter((m) => m.startPrecision === "DAY");
  assert.ok(archived.length >= 13, `${archived.length} archived sittings published`);
  for (const m of archived) assertNotStated(m, unscoped.publishingOrg);
  assert.equal(accounting.outcome, "CONSERVED");
  assert.equal(drops.unknownVenue, meetings.filter((m) => m.location === null && !m.online).length);
});

test("clerksboards: a Meeting Location with no reviewed row publishes every instance in the Clerk's words", () => {
  const wiring: BodySourceWiring = {
    bodyId: "ocd-division/country:us/state:az/place:tucson#planning-commission",
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    agendaSourceType: "CLERKSBOARDS",
    jurisdiction: "Tucson, AZ",
    publishingOrg: "City of Tucson Clerk",
    timeZone: "America/Phoenix",
    config: { boardId: "38" },
    verifiedAt: "2026-08-14",
  };
  const now = new Date("2026-08-14T12:00:00-07:00");
  const recorded = makeClerksBoardsSource([wiring]).normalizeWithDrops(
    [{ wiring, html: fixture("clerksboards/b38.html"), collectedAt: now.toISOString() }],
    now,
  );
  const html = fixture("clerksboards/b38.html").replace(
    "Microsoft Teams (Hybrid Format) / Mayor and Council Chambers; 255 W Alameda",
    "Tucson Convention Center, Room 10",
  );
  const { meetings, drops, accounting } = makeClerksBoardsSource([wiring]).normalizeWithDrops(
    [{ wiring, html, collectedAt: now.toISOString() }],
    now,
  );
  assert.deepEqual(meetings.map((m) => m.id), recorded.meetings.map((m) => m.id), "every instance still published");
  for (const m of meetings) assertStated(m, "Tucson Convention Center, Room 10", wiring.publishingOrg);
  assert.equal(drops.unknownVenue, meetings.length);
  assert.equal(accounting.dropped, 0);
  assert.ok(recorded.meetings.every((m) => m.location?.name === "Tucson City Hall, Mayor and Council Chambers"), "placed as before");
});

test("diligent: a portal row naming an unreviewed room, or none, is published with the gap the portal states", () => {
  const wiring = row(["DILIGENT", "CIVICWEB"], (w) => w.config.slug === "tusd1");
  const rows = (JSON.parse(fixture("diligent-tusd-meetings.json")) as DiligentMeeting[]).map((m) =>
    m.Id === 496 ? { ...m, MeetingLocation: "Catalina High School Auditorium" } : m.Id === 485 ? { ...m, MeetingLocation: "" } : m,
  );
  const now = new Date("2026-08-13T12:00:00-07:00");
  const { meetings, drops, accounting } = makeDiligentSource([wiring]).normalizeWithDrops(
    [{ wiring, meetings: rows, collectedAt: now.toISOString() }],
    now,
  );
  assert.equal(meetings.length, 11, "every recorded row is published");
  const byId = new Map(meetings.map((m) => [m.id, m]));
  assertStated(byId.get("diligent:tusd1:496"), "Catalina High School Auditorium", wiring.publishingOrg);
  assertNotStated(byId.get("diligent:tusd1:485"), wiring.publishingOrg);
  assert.equal(byId.get("diligent:tusd1:492")!.location?.name, "Duffy Community Center, Multipurpose Room", "placed as before");
  assert.equal(drops.unknownVenue, 2);
  assert.equal(accounting.dropped, 0);
});

function wilmotIcs(edit: (uid: string, block: string) => string): string {
  return fixture("ical/wilmot-2026-08-19.ics")
    .split("BEGIN:VEVENT")
    .map((block, i) => {
      if (i === 0) return block;
      const uid = /^UID:(.*)$/m.exec(block)?.[1] ?? "";
      return edit(uid, block);
    })
    .join("BEGIN:VEVENT");
}

const ICAL_NOW = new Date("2026-08-19T12:00:00Z");
const icalRaw = (wiring: BodySourceWiring, ics: string): IcalRaw[] => [
  { wiring, ics, collectedAt: "2026-08-19T00:00:00.000Z", sourceUrl: wiring.config.feedUrl ?? "" },
];

test("ical: a LOCATION with no reviewed row, a blank one, and an online one are all published", () => {
  const planning = row(["ICAL"], (w) => w.config.slug === "wilmot-planning-board");
  assert.equal(planning.config.venueMatch, undefined, "the row states no standing venue");
  const ics = wilmotIcs((uid, block) =>
    uid.startsWith("10001081-")
      ? block.replace(/^LOCATION:.*$/m, "LOCATION:Wilmot Public Library")
      : uid.startsWith("10001082-")
        ? block.replace(/^LOCATION:.*\n/m, "")
        : uid.startsWith("10001083-")
          ? block.replace(/^LOCATION:.*$/m, "LOCATION:Zoom")
          : block,
  );
  const { meetings, drops, accounting } = makeIcalSource([planning]).normalizeWithDrops(icalRaw(planning, ics), ICAL_NOW);
  const at = (day: string) => meetings.find((m) => m.startsAt.startsWith(day) || new Date(m.startsAt).toISOString().startsWith(day));
  assertStated(at("2026-08-20"), "Wilmot Public Library", planning.publishingOrg);
  assertNotStated(at("2026-09-17"), planning.publishingOrg);
  const zoom = at("2026-10-15")!;
  assert.equal(zoom.location, null);
  assert.deepEqual(zoom.online, { label: "Zoom", joinUrl: null }, "a LOCATION naming no building is online (D18)");
  assert.equal(zoom.venueGap, undefined);
  assert.ok(at("2026-11-19"), "92 days out: inside the held 120-day window (DB-03), though the map shows only 90");
  assert.equal(drops.unknownVenue, 2);
  assert.equal(drops.placeless, 1);
  assert.equal(accounting.outcome, "CONSERVED");
  assert.equal(accounting.dropped, drops.notConfigured, "nothing of this body is dropped");
});

test("ical: with a standing venue that has no reviewed row, the feed's words still render, and a blank keeps our own gap", () => {
  const select = row(["ICAL"], (w) => w.config.slug === "wilmot-selectboard");
  const unreviewed: BodySourceWiring = { ...select, config: { ...select.config, venueMatch: "A Standing Room No Row Names" } };
  const ics = wilmotIcs((uid, block) => (uid.startsWith("10001057-") ? block.replace(/^LOCATION:.*\n/m, "") : block));
  const { meetings, drops, accounting } = makeIcalSource([unreviewed]).normalizeWithDrops(icalRaw(unreviewed, ics), ICAL_NOW);
  const at = (day: string) => meetings.find((m) => m.startsAt.startsWith(day));
  // "LOCATION:NH" is the town's own word for the place: a state, never a pin.
  assertStated(at("2026-08-19"), "NH", unreviewed.publishingOrg);
  // No LOCATION, and a standing statement we hold no reviewed row for: ours.
  assertUnrecorded(at("2026-09-16"));
  // The Town Clerk's office spelling has its own reviewed row: placed as before.
  assert.equal(at("2026-08-20")!.location?.name, "Wilmot Town Office");
  assert.ok(drops.unknownVenue >= 2);
  assert.equal(accounting.outcome, "CONSERVED");
});

test("ical: a standing venue stands in only for a LOCATION that names no place, never for another building (2026-09-25)", () => {
  const select = row(["ICAL"], (w) => w.config.slug === "wilmot-selectboard");
  assert.ok(select.config.venueMatch, "the row states a standing venue");
  const ics = wilmotIcs((uid, block) => (uid.startsWith("10001057-") ? block.replace(/^LOCATION:.*$/m, "LOCATION:Wilmot Public Library") : block));
  const { meetings, accounting } = makeIcalSource([select]).normalizeWithDrops(icalRaw(select, ics), ICAL_NOW);
  const at = (day: string) => meetings.find((m) => m.startsAt.startsWith(day));
  assertStated(at("2026-09-16"), "Wilmot Public Library", select.publishingOrg);
  assert.ok(at("2026-08-19")?.location, "'LOCATION:NH' names no building, so the Selectboard's own standing statement places it, as before");
  assert.equal(accounting.outcome, "CONSERVED");
  assert.equal(namesNoPlace(""), true);
  assert.equal(namesNoPlace("NH"), true);
  assert.equal(namesNoPlace("New Hampshire."), true);
  assert.equal(namesNoPlace("55 West Joppa Rd. Warner, NH 03278"), false);
  assert.equal(namesNoPlace("pillsbury library"), false);
  assert.equal(namesNoPlace("TH"), false, "two letters that are no state are somebody's words for a room");
});

test("iqm2: an unreviewed room, a blank tooltip venue and a virtual sitting are all published", () => {
  const wiring = wiringForTypes(["IQM2"])[0];
  const venue = (id: string, text: string) => (html: string) =>
    html.replace(
      new RegExp(`(Detail_Meeting\\.aspx\\?ID=${id}" title="[^"]*?Status:&#09;[^&"]*)[^"]*"`),
      (_all, head: string) => `${head}${text}"`,
    );
  const html = [
    venue("2241", "&#13;&#13;&#09;Morris County Library Auditorium"),
    venue("2242", "&#13;&#13;&#09;Virtual"),
    venue("2243", ""),
  ].reduce((acc, plant) => plant(acc), fixture("iqm2/morris-calendar.html"));
  const now = new Date("2026-08-13T16:00:00Z");
  const { meetings, drops, accounting } = makeIqm2Source([wiring]).normalizeWithDrops(
    [{ wiring, html, collectedAt: now.toISOString() }],
    now,
  );
  const byId = new Map(meetings.map((m) => [m.id, m]));
  assertStated(byId.get("iqm2:morriscountynj:2241"), "Morris County Library Auditorium", wiring.publishingOrg);
  assert.deepEqual(byId.get("iqm2:morriscountynj:2242")?.online, { label: "Virtual", joinUrl: null }, "an online sitting is kept (D18)");
  assertNotStated(byId.get("iqm2:morriscountynj:2243"), wiring.publishingOrg);
  assert.ok([...byId.values()].some((m) => m.location?.name === "Administration and Records Building, Knox Room 525"), "placed as before");
  assert.equal(drops.unknownVenue, 2);
  assert.equal(drops.placeless, 1);
  assert.equal(accounting.dropped, drops.notConfigured, "nothing of this body is dropped");
});

test("pima-edu: a room code with no reviewed spelling renders in the college's words; a sitting nothing places keeps our gap", async () => {
  const dir = join(FIXTURES, "pima-edu");
  const read = (name: string) => readFileSync(join(dir, name), "utf8");
  const retrieval = JSON.parse(read("retrieval.json")) as Record<string, { url: string }>;
  const url = (name: string) => retrieval[name].url;
  const wiring = FIXTURE_DOOR_ROWS.find((w) => w.bodyId === "curated:az/pima-community-college#governing")!;
  const schedule = read("finance-audit-committee.html")
    .replace(/(<td>October 16, 2026<\/td>\s*<td>9:00am<\/td>\s*<td>)Zoom Webinar(<\/td>)/, "$1$2")
    .replace(/(<td>December 11, 2026<\/td>\s*<td>9:00am<\/td>\s*<td>)Zoom Webinar(<\/td>)/, "$1West Campus, Room A-120$2");
  const raw: PimaEduRaw = {
    wiring,
    collectedAt: "2026-09-23T20:05:00.000Z",
    documents: { url: url("documents-2026.html"), html: read("documents-2026.html") },
    events: { url: url("events-board-listing.html"), html: read("events-board-listing.html") },
    eventPages: [
      { url: url("event-2026-09-25-executive-session.html"), html: read("event-2026-09-25-executive-session.html").replaceAll("C-228", "C-999") },
      { url: url("event-2026-09-25-regular.html"), html: read("event-2026-09-25-regular.html") },
      { url: url("event-2026-10-29-study-session.html"), html: read("event-2026-10-29-study-session.html") },
    ],
    committeeSchedule: { url: url("finance-audit-committee.html"), html: schedule },
    committeeDocuments: { url: url("finance-audit-agendas-minutes.html"), html: read("finance-audit-agendas-minutes.html") },
    agendaPdfs: [{ url: url("agenda-2026-08-10.pdf"), text: await extractPdfText(new Uint8Array(readFileSync(join(dir, "agenda-2026-08-10.pdf")))) }],
  };
  const { meetings, drops, accounting } = makePimaEduSource([wiring]).normalizeWithDrops([raw], new Date("2026-09-23T13:00:00-07:00"));
  assert.equal(meetings.length, 12, "the same twelve sittings as the recorded pages");
  const byId = new Map(meetings.map((m) => [m.id, m]));
  assertStated(byId.get("pima-edu:pcc:2026-09-25-executive-session"), "District Office C-999", wiring.publishingOrg);
  assertStated(byId.get("pima-edu:pcc:2026-12-11-committee"), "West Campus, Room A-120", wiring.publishingOrg);
  assertUnrecorded(byId.get("pima-edu:pcc:2026-10-16-committee"));
  assert.equal(byId.get("pima-edu:pcc:2026-09-25-regular")!.location?.name, "PCC District Office, Community/Board Room C-105", "placed as before");
  assert.equal(drops.unknownVenue, 3);
  assert.equal(accounting.outcome, "CONSERVED");
});

test("revize: an upcoming sitting in an unreviewed room, or online, is published; nothing is dropped for its place", () => {
  const wiring = wiringForTypes(["REVIZE"])[0];
  const home = fixture("revize/merrimack-home.html");
  const now = new Date("2026-08-13T16:00:00Z");
  const run = (homepageHtml: string, w: BodySourceWiring = wiring) =>
    makeRevizeSource([w]).normalizeWithDrops(
      [{ wiring: w, homepageHtml, agendaPageHtml: fixture("revize/merrimack-agendas.html"), collectedAt: now.toISOString() }],
      now,
    );
  const boc = "Board of Commissioners Mtg.<br />August 24, 2026 @ 10:00AM<br />";
  const timed = (result: ReturnType<typeof run>) => result.meetings.filter((m) => m.startPrecision !== "DAY");

  const moved = run(home.replace(`${boc}OCH - Concord`, `${boc}Boscawen Town Offices`));
  assert.equal(timed(moved).length, 1);
  assertStated(timed(moved)[0], "Boscawen Town Offices", wiring.publishingOrg);
  assert.equal(moved.drops.unknownVenue, 1);
  assert.equal(moved.accounting.dropped, 1, "only the delegation's Executive Committee, a different government");

  const online = run(home.replace(`${boc}OCH - Concord`, `${boc}Zoom`));
  assert.deepEqual(timed(online)[0].online, { label: "Zoom", joinUrl: null }, "an online sitting is kept (D18)");
  assert.equal(online.drops.placeless, 1);

  assert.equal(timed(run(home))[0].location?.name, "OCH, 163 N. Main St., Concord", "placed as before");
});

test("revize: an archived sitting with no one reviewed venue is published with our own gap", () => {
  const wiring = wiringForTypes(["REVIZE"])[0];
  const unscoped: BodySourceWiring = { ...wiring, ocdId: "ocd-division/country:us/state:nh/county:sullivan" };
  const now = new Date("2026-08-13T16:00:00Z");
  const { meetings, drops, accounting } = makeRevizeSource([unscoped]).normalizeWithDrops(
    [{ wiring: unscoped, homepageHtml: fixture("revize/merrimack-home.html"), agendaPageHtml: fixture("revize/merrimack-agendas.html"), collectedAt: now.toISOString() }],
    now,
  );
  const archived = meetings.filter((m) => m.startPrecision === "DAY");
  assert.ok(archived.length >= 14, `${archived.length} archived sittings published`);
  for (const m of archived) assertUnrecorded(m);
  assertStated(meetings.find((m) => m.startPrecision !== "DAY"), "OCH - Concord", unscoped.publishingOrg);
  assert.equal(drops.unknownVenue, archived.length + 1);
  assert.equal(accounting.outcome, "CONSERVED");
});

test("schedulepage: a row naming an unreviewed room renders its words; the page's room with no reviewed row keeps our gap", () => {
  const kearsarge = row(["SCHEDULEPAGE"], (w) => w.config.slug === "kearsarge");
  const now = new Date("2027-01-01T12:00:00-05:00");
  const run = (w: BodySourceWiring, schedule: string) =>
    makeSchedulePageSource([w]).normalizeWithDrops(
      [{ wiring: w, schedule, documents: fixture("schedulepage/kearsarge-school-board-agendas.html"), collectedAt: now.toISOString() }],
      now,
    );
  const recorded = run(kearsarge, fixture("schedulepage/kearsarge-school-board-schedule.html"));
  const deliberative = (result: ReturnType<typeof run>) => result.meetings.find((m) => m.startsAt.startsWith("2027-01-09"));
  assert.equal(deliberative(recorded)?.location?.name, "Kearsarge Regional Middle School", "the reviewed marker is placed as before");

  const planted = run(
    { ...kearsarge, config: { ...kearsarge.config, otherVenueMarkers: "Sunapee Middle High School" } },
    fixture("schedulepage/kearsarge-school-board-schedule.html").replaceAll("KRMS", "Sunapee Middle High School"),
  );
  assert.equal(planted.meetings.length, recorded.meetings.length, "every sitting is still published");
  assertStated(deliberative(planted), "Sunapee Middle High School", kearsarge.publishingOrg);
  assert.equal(planted.drops.unknownVenue, 1);

  const unreviewed = run(
    { ...kearsarge, config: { ...kearsarge.config, venueMatch: "A Room No Reviewed Row Names" } },
    fixture("schedulepage/kearsarge-school-board-schedule.html"),
  );
  assert.equal(unreviewed.meetings.length, recorded.meetings.length);
  for (const m of unreviewed.meetings.filter((x) => !x.startsAt.startsWith("2027-01-09"))) assertUnrecorded(m);
  assert.equal(unreviewed.accounting.dropped, unreviewed.drops.notConfigured, "nothing of this body is dropped");
});

test("apptegy: a board meeting with no venue, or a venue with no coordinates, is published and never pinned at 0,0", () => {
  const vail = row(["APPTEGY"], (w) => w.config.slug === "vail");
  const events = (JSON.parse(fixture("apptegy-vail-events.json")).events as ApptegyEvent[]).map((e) =>
    e.title === "Governing Board Meeting" && e.start_at?.startsWith("2026-09-08")
      ? { ...e, venue: "", latitude: "", longitude: "" }
      : e.title === "Governing Board Meeting" && e.start_at?.startsWith("2026-09-22")
        ? { ...e, latitude: "", longitude: "" }
        : e,
  );
  const now = new Date("2026-08-13T12:00:00-07:00");
  const { meetings, drops, accounting } = makeApptegySource([vail]).normalizeWithDrops(
    [{ wiring: vail, events, collectedAt: now.toISOString() }],
    now,
  );
  const on = (day: string) => meetings.find((m) => m.title === "Governing Board Meeting" && m.startsAt.startsWith(day));
  assertNotStated(on("2026-09-09"), vail.publishingOrg);
  assertStated(on("2026-09-23"), "Calvin Baker Leadership Center 13801 E Benson Hwy, Vail, AZ 85641", vail.publishingOrg);
  assert.equal(on("2026-08-26")!.location?.lat, 32.0149457, "placed as before");
  assert.ok(meetings.every((m) => m.location === null || (m.location.lat !== 0 && m.location.lng !== 0)));
  assert.equal(drops.unknownVenue, 2);
  assert.equal(accounting.outcome, "CONSERVED");
});

test("onbase: an unmatched meeting name still drops, counted — the name key is its only body filter", () => {
  const rows = wiringForTypes(["ONBASE"]);
  const now = new Date("2026-08-13T12:00:00-07:00");
  const { meetings, drops } = makeOnBaseSource(rows).normalizeWithDrops(
    [{ wiring: rows[0], html: fixture("onbase-tucson.html"), collectedAt: now.toISOString() }],
    now,
  );
  // The Joint Meeting row is not verified as the Mayor and Council's sitting by
  // anything but a name the cache would have to know; publishing it would put another body's meeting on the Council's card.
  assert.equal(meetings.length, 9);
  assert.equal(drops.unknownVenue, 1);
});
