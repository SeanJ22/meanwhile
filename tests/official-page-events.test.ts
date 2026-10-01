import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  meetingAcquisitionFailureDomain,
  meetingPartitionForRow,
  meetingPartitionId,
} from "../lib/civic-data/meeting-partitions.ts";
import { SOURCE_AUTHORITIES, isOfficialSource } from "../lib/civic-data/source-authority.ts";
import { isOnlineOnly } from "../lib/meetings/online.ts";
import { wiringForMeetingSource } from "../lib/registry/source-wiring.ts";
import {
  extractOfficialPageEvents,
  makeOfficialPageEventsSource,
  officialLinkingPageFrom,
  statedTime,
  verifyExtractedEvents,
  verifyOfficialPageEvents,
  type OfficialPageBody,
  type OfficialPageRaw,
} from "../lib/sources/official-page-events/index.ts";

test('saved official chains reach external calendars without trusting an unlinked host',()=>{
 for(const government of ['https://county.gov','https://city.gov']) {
  const pages=[{canonicalUrl:government+'/education',text:'<a href="https://school.example.org">School</a>'},
    {canonicalUrl:'https://school.example.org',text:'<a href="https://calendar.example.edu/events">Meetings</a>'}];
  const chain=officialLinkingPageFrom('https://calendar.example.edu/events',pages);
  assert.ok(chain);assert.equal(isOfficialSource('https://calendar.example.edu/events',chain),true);
  assert.equal(officialLinkingPageFrom('https://unlinked.example.org',pages),null);
  assert.equal(officialLinkingPageFrom('https://calendar.example.edu/events',pages.slice(1)),null);
 }
});

/**
 * Official-page events (2026-09-23) — against pages recorded with one
 * robots-checked GET each through `politeGetText`. No live calls.
 *
 * - tusd-reconfiguration.html: https://www.tusd1.org/Reconfiguration,
 *   200 at 2026-09-23T23:25:27Z; robots allows it (disallows only
 *   /TUSD-school-exit-survey and /PLC-Roskruge for `*`).
 * - sfps-board-of-education.html: https://www.sfps.info/page/board-of-education-2,
 *   200 at 2026-09-23T23:27:41Z; robots allows `/` and disallows `/api/`.
 *
 * `NOW` is the TUSD retrieval instant: 16:25 in Tucson, while the 9/23
 * session (4:00pm–6:30pm) is under way.
 */
const NOW = new Date("2026-09-23T23:25:27.424Z");
const FIXTURES = new URL("./fixtures/official-page-events/", import.meta.url);
const TUSD_HTML = readFileSync(new URL("tusd-reconfiguration.html", FIXTURES), "utf8");
const SFPS_HTML = readFileSync(new URL("sfps-board-of-education.html", FIXTURES), "utf8");
const TUSD_URL = "https://www.tusd1.org/Reconfiguration";
const SFPS_URL = "https://www.sfps.info/page/board-of-education-2";

const TUSD_BODY_ID = "ocd-division/country:us/state:az/school_district:tucson_unified_district#board";

/** Arizona identity: the registry body, its homepageUrl host and its committee's name. */
const TUSD: OfficialPageBody = {
  id: TUSD_BODY_ID,
  name: "Tucson Unified School District",
  officialDomain: "https://www.tusd1.org/",
  linkingPage: {url:"https://directory.example.gov/schools",html:'<a href="https://www.tusd1.org">District</a><a href="https://govboard.tusd1.org">Board</a>'},
  timeZone: "America/Phoenix",
  nameTerms: ["Tucson Unified", "TUSD", "Joint Committee"],
};

/**
 * New Mexico identity, built only from New Mexico evidence: the NCES
 * directory's website for LEAID 3502370 (http://www.sfps.info), the page's
 * own name for the body ("SFPS Board of Education") and its committees'
 * names as the page writes them. Not a registry body — Santa Fe is not a
 * supported jurisdiction — so the id is this test's own label.
 */
const SFPS: OfficialPageBody = {
  id: "test:nm:santa-fe-public-schools",
  name: "Santa Fe Public Schools",
  officialDomain: "http://www.sfps.info",
  linkingPage: {url:"https://directory.example.gov/schools",html:'<a href="https://www.sfps.info">District</a>'},
  timeZone: "America/Denver",
  nameTerms: ["SFPS", "Board of Education", "Audit Committee", "Community Review Committee"],
};

test("TUSD: the reconfiguration page yields the Oct 1 Joint Committee meeting and the 9/23 and 9/26 sessions with venues and times", () => {
  const result = verifyOfficialPageEvents({ body: TUSD, url: TUSD_URL, html: TUSD_HTML, now: NOW });
  assert.equal(result.verdict, "YIELDED");
  const brief = result.sampleEvents.map((e) => [e.startsAt, e.endsAt, e.precision, e.eventType, e.title, e.venue, e.status]);
  assert.deepEqual(brief, [
    // Imminent first: the session under way, then the one in three days, then next week's committee.
    ["2026-09-23T16:00:00-07:00", "2026-09-23T18:30:00-07:00", "MINUTE", "Community engagement session", "Tucson Unified Facility Plans Community Engagement", "Cholla High School South Gym", "SCHEDULED"],
    ["2026-09-26T09:00:00-07:00", "2026-09-26T11:30:00-07:00", "MINUTE", "Community engagement session", "Tucson Unified Facility Plans Community Engagement", "Tucson High Magnet School East Gym", "SCHEDULED"],
    ["2026-10-01T00:00:00-07:00", null, "DAY", "Joint Committee meeting", "Joint Committee Meeting", null, "SCHEDULED"],
    // Past events publish as concluded.
    ["2026-09-11T00:00:00-07:00", null, "DAY", "Joint Committee meeting", "Joint Committee Meeting", null, "CONCLUDED"],
    ["2026-08-29T09:00:00-07:00", "2026-08-29T16:00:00-07:00", "MINUTE", "Joint Committee meeting", "Joint Committee Meeting", null, "CONCLUDED"],
  ]);
  // Never inflated: nothing on this page is a Governing Board meeting.
  assert.ok(result.sampleEvents.every((e) => !/board/i.test(e.eventType) && !/governing board/i.test(e.title)));
  // Provenance: the page, and the page's own words.
  assert.ok(result.sampleEvents.every((e) => e.sourceUrl === TUSD_URL));
  assert.match(result.sampleEvents[2].evidence, /Next Meeting October 1, 2026/);
  assert.match(result.sampleEvents[4].evidence, /from 9AM to 4PM/);
  assert.equal(result.sampleEvents[0].links[0]?.label, "RSVP for Community Engagement");
  // "September 21st" states no year and no card dates it: held, named, never guessed.
  assert.deepEqual(result.held.map((h) => [h.printedDate, h.reasons]), [["September 21st", ["YEAR_NOT_STATED"]]]);
});

test("TUSD: the wired adapter publishes five partition rows with named gaps and district attribution", () => {
  const rows = wiringForMeetingSource("official-page-events");
  assert.equal(rows.length, 1);
  const [wiring] = rows;
  const source = makeOfficialPageEventsSource(rows,undefined,()=>TUSD.linkingPage);
  const raw: OfficialPageRaw[] = [{ wiring, html: TUSD_HTML, ics: [], icsRefused: [], collectedAt: "2026-09-23T23:25:27.424Z" }];
  const { meetings, drops } = source.normalizeWithDrops(raw, NOW);
  assert.equal(meetings.length, 5);
  assert.deepEqual(drops, { placeless: 0, unknownVenue: 0, unplaceableInTime: 1, notConfigured: 0 });
  for (const m of meetings) {
    assert.ok(m.id.startsWith("official-page-events:tusd1-reconfiguration:"), m.id);
    assert.equal(m.bodyId, TUSD_BODY_ID);
    assert.equal(m.bodyName, "Tucson Unified School District");
    assert.equal(m.agendaUrl, null);
    assert.equal(m.location, null);
    assert.equal(m.online, undefined);
    assert.equal(isOnlineOnly(m), false, "a venue gap is never labeled online");
    assert.equal(m.provenance.sourceUrl, TUSD_URL);
    assert.equal(m.provenance.sourceOrg, "Tucson Unified School District");
    assert.ok(m.provenance.evidenceExcerpt && m.provenance.evidenceExcerpt.length > 0);
    assert.ok(m.startPrecision === "DAY" || m.startPrecision === "MINUTE");
  }
  const byDate = new Map(meetings.map((m) => [m.startsAt.slice(0, 10), m]));
  assert.deepEqual(byDate.get("2026-09-23")?.venueGap, {
    kind: "STATED_NOT_PLACED",
    publishedText: "Cholla High School South Gym",
    publisher: "Tucson Unified School District",
  });
  assert.equal(byDate.get("2026-09-26")?.venueGap?.publishedText, "Tucson High Magnet School East Gym");
  assert.equal(byDate.get("2026-10-01")?.venueGap?.kind, "NOT_STATED_BY_PUBLISHER");
  assert.equal(byDate.get("2026-10-01")?.eventType, "Joint Committee meeting");
  assert.equal(byDate.get("2026-09-23")?.endsAt, "2026-09-23T18:30:00-07:00");
  assert.deepEqual(source.normalizeWithHolds(raw, NOW).held.map((h) => [h.bodyId, h.reasons]), [[TUSD_BODY_ID, ["YEAR_NOT_STATED"]]]);
});

test("TUSD wiring: official host is the registry body's homepageUrl, its own partition and failure domain, authorized route", () => {
  const [wiring] = wiringForMeetingSource("official-page-events");
  const registry = JSON.parse(readFileSync(new URL("../lib/registry/registry.json", import.meta.url), "utf8")) as
    | { bodies?: Array<{ id: string; homepageUrl?: string | null }> }
    | Array<{ id: string; homepageUrl?: string | null }>;
  const bodies = Array.isArray(registry) ? registry : registry.bodies ?? [];
  const body = bodies.find((b) => b.id === wiring.bodyId);
  assert.ok(body, "the wiring row keys on a registry body");
  assert.equal(new URL(body.homepageUrl ?? "").hostname, wiring.config.officialHost);
  assert.ok(isOfficialSource(wiring.config.pageUrl,TUSD.linkingPage));

  const partition = meetingPartitionForRow("official-page-events", wiring.bodyId);
  assert.equal(partition.id, meetingPartitionId("official-page-events", TUSD_BODY_ID));
  const diligent = meetingPartitionForRow("diligent", wiring.bodyId);
  assert.notEqual(partition.id, diligent.id);
  assert.notEqual(partition.scope, diligent.scope);
  assert.equal(meetingAcquisitionFailureDomain("official-page-events", wiring), "meeting-upstream:www.tusd1.org");
  assert.notEqual(partition.acquisitionFailureDomain, diligent.acquisitionFailureDomain);

  const authority = SOURCE_AUTHORITIES["meetings-public-bodies"];
  assert.ok(authority.routePrefixes.some((p) => wiring.config.pageUrl.startsWith(p)));
  assert.ok(authority.routePrefixes.some((p) => new URL(p).hostname === "www.tusd1.org"));
});

test("cross-state transfer: the same extractor reads Santa Fe Public Schools (NM) with NM identity only", () => {
  const result = verifyOfficialPageEvents({ body: SFPS, url: SFPS_URL, html: SFPS_HTML, now: NOW });
  assert.equal(result.verdict, "YIELDED");
  // The page carries its events as embedded state, not markup.
  assert.ok(result.sampleEvents.every((e) => e.shape === "embedded-json"));
  const board = result.sampleEvents.find((e) => e.startsAt === "2026-10-08T17:30:00-06:00");
  assert.deepEqual(
    board && [board.title, board.eventType, board.endsAt, board.precision, board.venue, board.status],
    ["Board of Education Regular Meeting", "Board meeting", "2026-10-08T20:00:00-06:00", "MINUTE", null, "SCHEDULED"],
  );
  // Past NM events publish as concluded; the Mountain offset changes at DST.
  const review = result.sampleEvents.find((e) => e.startsAt === "2026-09-16T18:00:00-06:00");
  assert.equal(review?.status, "CONCLUDED");
  assert.ok(result.sampleEvents.some((e) => e.startsAt === "2026-11-12T17:30:00-07:00"));
  // An end equal to the start is no end, not an inversion.
  const audit = result.sampleEvents.find((e) => e.startsAt === "2026-10-08T12:00:00-06:00");
  assert.equal(audit?.title, "Audit Committee Meeting");
  assert.equal(audit?.endsAt, null);
  assert.equal(result.sampleEvents.length, 13);
  // The page's venue fields are empty: a named gap, never the district office.
  assert.ok(result.sampleEvents.every((e) => e.venue === null));

  // Held, by name: a misspelled title does not name the body, and school
  // closures are not sittings of it.
  const held = new Map(result.held.map((h) => [h.title, h.reasons]));
  assert.deepEqual(held.get("Board of Educaiton Regular Meeting"), ["TITLE_DOES_NOT_NAME_BODY"]);
  assert.deepEqual(held.get("No school - Elections/School Sites Closed"), ["TITLE_DOES_NOT_NAME_BODY"]);
  assert.equal(result.held.length, 7);

  // Facts are the NM page's own: nothing from the Arizona fixture leaks.
  const az = verifyOfficialPageEvents({ body: TUSD, url: TUSD_URL, html: TUSD_HTML, now: NOW });
  const azStarts = new Set(az.sampleEvents.map((e) => e.startsAt));
  const azVenues = new Set(az.sampleEvents.map((e) => e.venue).filter(Boolean));
  const azTitles = new Set(az.sampleEvents.map((e) => e.title));
  for (const e of result.sampleEvents) {
    assert.ok(!azStarts.has(e.startsAt), `${e.startsAt} is an Arizona instant`);
    assert.ok(!azVenues.has(e.venue), `${e.venue} is an Arizona venue`);
    assert.ok(!azTitles.has(e.title), `${e.title} is an Arizona title`);
    assert.ok(/-0[67]:00$/.test(e.startsAt), "Mountain time, from the NM body's zone");
    assert.equal(e.sourceUrl, SFPS_URL);
  }
});

test("negative: an Arizona fact cannot satisfy a New Mexico verification, nor the reverse", () => {
  // The AZ page offered for the NM body: wrong host, and nothing names SFPS.
  const azForNm = verifyOfficialPageEvents({ body: SFPS, url: TUSD_URL, html: TUSD_HTML, now: NOW });
  assert.equal(azForNm.verdict, "NOT_CONFIRMED");
  assert.deepEqual(azForNm.sampleEvents, []);
  assert.ok(azForNm.held.every((h) => h.reasons.includes("HOST_NOT_OFFICIAL")));
  assert.ok(azForNm.held.filter((h) => h.shape !== "prose-date").every((h) => h.reasons.includes("TITLE_DOES_NOT_NAME_BODY")));

  // Even an AZ fact carried onto the NM page's own host fails the NM title rule.
  const azExtraction = extractOfficialPageEvents(TUSD_HTML, { pageUrl: TUSD_URL, timeZone: "America/Phoenix" });
  const nextJoint = azExtraction.events.find((e) => e.shape === "next-meeting");
  assert.ok(nextJoint);
  const smuggled = verifyExtractedEvents(
    { events: [nextJoint], yearless: [], icsLinks: [], pageLinks: [] },
    { pageUrl: SFPS_URL, linkingPage: SFPS.linkingPage, nameTerms: [SFPS.name, ...(SFPS.nameTerms ?? [])], timeZone: SFPS.timeZone, now: NOW },
  );
  assert.deepEqual(smuggled.published, []);
  assert.deepEqual(smuggled.held.map((h) => h.reasons), [["TITLE_DOES_NOT_NAME_BODY"]]);

  // And the NM page offered for the AZ body.
  const nmForAz = verifyOfficialPageEvents({ body: TUSD, url: SFPS_URL, html: SFPS_HTML, now: NOW });
  assert.equal(nmForAz.verdict, "NOT_CONFIRMED");
  assert.ok(nmForAz.held.every((h) => h.reasons.includes("HOST_NOT_OFFICIAL")));
  assert.match(nmForAz.reason ?? "", /HOST_NOT_OFFICIAL/);
});

test("a scheduled event with no agenda and no venue is still published, as a named gap", () => {
  const [wiring] = wiringForMeetingSource("official-page-events");
  const html = `<html><body><div class="ContentBlock"><div class="SectionTitle">Joint Committee Meeting Oct. 15, 2026</div>
    <div class="SectionContent">The committee will review community feedback.</div></div></body></html>`;
  const source = makeOfficialPageEventsSource([wiring],undefined,()=>TUSD.linkingPage);
  const [meeting] = source.normalize([{ wiring, html, ics: [], icsRefused: [], collectedAt: NOW.toISOString() }], NOW);
  assert.ok(meeting, "published without an agenda or a venue");
  assert.equal(meeting.status, "SCHEDULED");
  assert.equal(meeting.startsAt, "2026-10-15T00:00:00-07:00");
  assert.equal(meeting.startPrecision, "DAY", "no time stated, none invented");
  assert.equal(meeting.agendaUrl, null);
  assert.equal(meeting.location, null);
  assert.deepEqual(meeting.venueGap, { kind: "NOT_STATED_BY_PUBLISHER", publishedText: null, publisher: "Tucson Unified School District" });
  assert.equal(isOnlineOnly(meeting), false);
});

test("structured shapes: JSON-LD with an offset, cancellation only in the publisher's words, microdata, and a linked .ics", () => {
  const body = { ...TUSD, nameTerms: ["TUSD"] };
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Event", name: "TUSD Boundary Forum", startDate: "2026-10-06T01:00:00Z", endDate: "2026-10-06T02:30:00Z", location: { "@type": "Place", name: "Catalina High School Auditorium" } },
      { "@type": "EducationEvent", name: "TUSD Facilities Hearing", startDate: "2026-10-09", eventStatus: "https://schema.org/EventCancelled" },
    ],
  })}</script></head><body>
  <div itemscope itemtype="https://schema.org/Event"><span itemprop="name">TUSD Budget Listening Session</span>
    <time itemprop="startDate" datetime="2026-10-20T18:00">Oct 20</time>
    <div itemprop="location" itemscope itemtype="https://schema.org/Place"><span itemprop="name">Pueblo High School Library</span></div></div>
  <a href="/files/tusd-sessions.ics">Add sessions to calendar</a></body></html>`;
  const ics = [
    "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:x1", "SUMMARY:TUSD Community Session", "DTSTART;TZID=America/Phoenix:20261103T173000",
    "DTEND;TZID=America/Phoenix:20261103T190000", "LOCATION:Palo Verde High School Cafeteria", "STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const extraction = extractOfficialPageEvents(html, { pageUrl: TUSD_URL, timeZone: "America/Phoenix", ics: [{ url: "https://www.tusd1.org/files/tusd-sessions.ics", text: ics }] });
  assert.deepEqual(extraction.icsLinks, ["https://www.tusd1.org/files/tusd-sessions.ics"]);
  const { published } = verifyExtractedEvents(extraction, { pageUrl: TUSD_URL, linkingPage: TUSD.linkingPage, nameTerms: body.nameTerms, timeZone: body.timeZone, now: NOW });
  const brief = published.map((v) => [v.event.shape, v.startsAt, v.endsAt, v.precision, v.event.venue, v.event.canceled]);
  assert.deepEqual(brief, [
    // 01:00Z on Oct 6 is 6:00pm on Oct 5 in Tucson: the publisher's instant, read back into local time.
    ["json-ld", "2026-10-05T18:00:00-07:00", "2026-10-05T19:30:00-07:00", "MINUTE", "Catalina High School Auditorium", false],
    ["json-ld", "2026-10-09T00:00:00-07:00", null, "DAY", null, true],
    ["microdata", "2026-10-20T18:00:00-07:00", null, "MINUTE", "Pueblo High School Library", false],
    ["ics", "2026-11-03T17:30:00-07:00", "2026-11-03T19:00:00-07:00", "MINUTE", "Palo Verde High School Cafeteria", false],
  ]);
});

test("verification holds, by name, what cannot be verified — and an empty page is EMPTY", () => {
  const html = `<div><h3>Joint Committee Meeting Jan. 5, 2027 at 5:00 pm</h3></div>
    <div><h3>Joint Committee Meeting 2/30/2026</h3></div>
    <div><h3>Joint Committee Meeting March 3, 2027</h3></div>
    <div><h3>Spring Concert April 10, 2027</h3></div>`;
  const result = verifyOfficialPageEvents({ body: TUSD, url: TUSD_URL, html, now: NOW });
  // January and March are beyond the 90-day horizon; 2/30 is no date at all.
  assert.deepEqual(result.sampleEvents.map((e) => e.startsAt), []);
  assert.equal(result.verdict, "NOT_CONFIRMED");
  assert.match(result.reason ?? "", /DATE_OUT_OF_WINDOW/);

  const dated = `<div><div class="SectionTitle">Joint Committee Meeting Dec. 5, 2026</div><div>Starts 4 - 6:30pm.</div></div>`;
  const timed = verifyOfficialPageEvents({ body: TUSD, url: TUSD_URL, html: dated, now: NOW });
  assert.equal(timed.verdict, "YIELDED");
  assert.equal(timed.sampleEvents[0].precision, "DAY", "a range whose start has no am/pm is not guessed");
  assert.deepEqual(statedTime("4 - 6:30pm"), { start: null, end: null, printed: null });

  const offHost = verifyOfficialPageEvents({ body: TUSD, url: "https://tusd1.thrillshare.com/Reconfiguration", html: dated, now: NOW });
  assert.equal(offHost.verdict, "NOT_CONFIRMED");
  assert.equal(offHost.reason, "HOST_NOT_OFFICIAL");
  assert.ok(isOfficialSource("https://govboard.tusd1.org",TUSD.linkingPage));
  assert.ok(!isOfficialSource("https://tusd1.org.example.com",TUSD.linkingPage));

  const empty = verifyOfficialPageEvents({ body: TUSD, url: TUSD_URL, html: "<p>Welcome to TUSD.</p>", now: NOW });
  assert.deepEqual([empty.verdict, empty.reason], ["EMPTY", "NO_DATED_EVENTS_ON_PAGE"]);
});
