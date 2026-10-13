/**
 * A meeting whose place the publisher stated in words shows those words on every reader surface, never
 * "we haven't recorded a place" and never "online"; a page that names no place contributes a publisher's
 * gap to the card and renders no place row. Meetings come from the real official-page events source over the committed page
 * (tests/fixtures/official-page-events/), rendered beside a saved production response. No live calls.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { icsDataHref, meetingCalendarEvent } from "../lib/calendar/event-links.ts";
import {
  isOnlineOnly,
  isPlaceUnrecorded,
  onlineAccessFor,
  ONLINE_ONLY_LINE,
  PLACE_UNRECORDED_LINE,
  placelessWhereLine,
  venueGapOf,
} from "../lib/meetings/online.ts";
import { wiringForMeetingSource } from "../lib/registry/source-wiring.ts";
import { meetingCardGaps } from "../lib/meetings/card-gaps.ts";
import { makeOfficialPageEventsSource, type OfficialPageRaw } from "../lib/sources/official-page-events/index.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { readerText as text, rowIds, rowMarkup } from "./helpers/reader-markup.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = "tests/fixtures/reader-upcoming-meetings-85701.json";
const PAGE = "tests/fixtures/official-page-events/tusd-reconfiguration.html";
const COLLECTED = "2026-09-23T23:25:27.424Z";
/** The recorded response's own instant; the reader's date window is pinned to it. */
const RECORDED_NOW = Date.parse("2026-09-23T23:00:00.000Z");
const CHOLLA = "Cholla High School South Gym";
const TUCSON_HIGH = "Tucson High Magnet School East Gym";
const OFFICIAL_DIRECTORY = { url: "https://fixture-directory.gov/schools", html: '<a href="https://www.tusd1.org/">Tucson Unified</a>' };
const NOT_STATED = "Tucson Unified School District's page doesn't say where this meeting is held.";

function reconfigurationMeetings(): Meeting[] {
  const rows = wiringForMeetingSource("official-page-events");
  assert.equal(rows.length, 1, "Tucson Unified's reconfiguration page is the one wired official page");
  const raw: OfficialPageRaw[] = [
    { wiring: rows[0]!, html: readFileSync(join(ROOT, PAGE), "utf8"), ics: [], icsRefused: [], collectedAt: COLLECTED, linkingPage: OFFICIAL_DIRECTORY },
  ];
  return makeOfficialPageEventsSource(rows).normalizeWithDrops(raw, new Date(COLLECTED)).meetings;
}

test("a named venue gap is its own state: never online, never 'place not recorded', its words are the Where line", () => {
  const meetings = reconfigurationMeetings();
  const stated = meetings.filter((m) => m.venueGap?.kind === "STATED_NOT_PLACED");
  const notStated = meetings.filter((m) => m.venueGap?.kind === "NOT_STATED_BY_PUBLISHER");
  assert.deepEqual(stated.map((m) => m.venueGap?.publishedText).sort(), [CHOLLA, TUCSON_HIGH]);
  assert.ok(notStated.length > 0, "the page's Joint Committee dates name no place");
  for (const m of meetings) {
    assert.equal(m.location, null);
    assert.ok(venueGapOf(m), `${m.id} carries no named venue gap`);
    assert.equal(isOnlineOnly(m), false, `${m.id}: a venue gap is labeled online`);
    assert.equal(isPlaceUnrecorded(m), false, `${m.id}: a venue gap reads as a place we have not recorded`);
    assert.equal(onlineAccessFor(m), null);
    const where = placelessWhereLine(m);
    assert.notEqual(where, PLACE_UNRECORDED_LINE, `${m.id}: the Where line says we have not recorded a place`);
    assert.notEqual(where, ONLINE_ONLY_LINE, `${m.id}: the Where line says online`);
    assert.equal(where, m.venueGap?.kind === "STATED_NOT_PLACED" ? m.venueGap.publishedText : NOT_STATED);
    const placeGap = meetingCardGaps(m).find(gap => gap.label === "meeting places");
    assert.equal(placeGap?.kind, m.venueGap?.kind === "NOT_STATED_BY_PUBLISHER" ? "not-posted" : undefined);
  }
  // The two earlier states are unchanged by the venue gap.
  const base = { location: null } as const;
  assert.equal(placelessWhereLine({ ...base, online: { label: "Via Zoom", joinUrl: null } }), ONLINE_ONLY_LINE);
  assert.equal(placelessWhereLine(base), PLACE_UNRECORDED_LINE);
  assert.equal(
    isOnlineOnly({ ...base, online: { label: "Via Zoom", joinUrl: null }, venueGap: { kind: "NOT_STATED_BY_PUBLISHER", publishedText: null, publisher: "X" } }),
    false,
    "a named venue gap is never online, even beside an online block the verifier would refuse",
  );
});

test("the card's calendar entry carries the stated place as its LOCATION, and invents none where the page states none", () => {
  const meetings = reconfigurationMeetings();
  const cholla = meetings.find((m) => m.venueGap?.publishedText === CHOLLA);
  const joint = meetings.find((m) => m.venueGap?.kind === "NOT_STATED_BY_PUBLISHER");
  assert.ok(cholla && joint);
  const stated = meetingCalendarEvent(cholla);
  assert.equal(stated.location, CHOLLA);
  assert.match(decodeURIComponent(icsDataHref(stated)), new RegExp(`\r\nLOCATION:${CHOLLA}\r\n`));
  const none = meetingCalendarEvent(joint);
  assert.equal(none.location, "");
  assert.doesNotMatch(decodeURIComponent(icsDataHref(none)), /LOCATION:/);
  // An online sitting's entry is unchanged: the body's own label and link.
  const online = meetingCalendarEvent({ ...joint, venueGap: undefined, online: { label: "Via Zoom", joinUrl: "https://example.org/j/1" } });
  assert.equal(online.location, "Via Zoom — https://example.org/j/1");
});

test("the list and pin panel show stated places and omit absent place rows", () => {
  const script = `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { readFileSync } from 'node:fs';
    import { DataProvider } from './lib/state/data.tsx';
    import { UiProvider } from './lib/state/provider.tsx';
    import { INITIAL_STATE } from './lib/state/defaults.ts';
    import { applyFilters } from './lib/state/derive.ts';
    import { ListOverlay } from './components/map/list-overlay.tsx';
    import { MeetingPanel } from './components/map/meeting-panel.tsx';
    import { groupByVenue, placelessSittingsOfVenueBodies } from './lib/meetings/venues.ts';
    import { wiringForMeetingSource } from './lib/registry/source-wiring.ts';
    import { makeOfficialPageEventsSource } from './lib/sources/official-page-events/index.ts';
    import { installRegistryAuthority } from './tests/helpers/promoted-fixtures.ts';
    await installRegistryAuthority();

    const fixture = JSON.parse(readFileSync(${JSON.stringify(FIXTURE)}, 'utf8'));
    const rows = wiringForMeetingSource('official-page-events');
    const page = readFileSync(${JSON.stringify(PAGE)}, 'utf8');
    const events = makeOfficialPageEventsSource(rows).normalizeWithDrops(
      [{ wiring: rows[0], html: page, ics: [], icsRefused: [], collectedAt: ${JSON.stringify(COLLECTED)}, linkingPage: ${JSON.stringify(OFFICIAL_DIRECTORY)} }],
      new Date(${JSON.stringify(COLLECTED)}),
    ).meetings;
    const all = [...fixture.meetings, ...events];
    const meetings = applyFilters({ meetings: all, ui: INITIAL_STATE, center: null, now: ${RECORDED_NOW} });
    const venues = groupByVenue(meetings, fixture.listingIdentity);
    const data = { allMeetings: all, meetings, venues, listingIdentity: fixture.listingIdentity,
      result: { meetings: all, listingIdentity: fixture.listingIdentity, coverage: fixture.coverage, tier: 'exact', radiusKm: 25, requestedRadiusKm: 25, center: { lat: 32.2217, lng: -110.9695 } },
      location: null, drawnDistricts: [], dropped: 0, searchFailed: false, atAddress: false, governing: null, zipPartial: null, basis: 'ZIP' };
    const render = (ui, child) => renderToStaticMarkup(h(DataProvider, { value: data }, h(UiProvider, { initial: ui }, child)));

    const out = { events: events.map((m) => ({ id: m.id, gap: m.venueGap })), kept: meetings.filter((m) => m.venueGap).map((m) => m.id) };
    out.list = render({ listOverlayOpen: true, listGroupBy: 'none' }, h(ListOverlay, { onPickMeeting: () => {} }));
    const duffy = venues.find((v) => /Duffy Community Center/.test(v.name));
    out.duffyPins = duffy ? duffy.meetings.map((m) => m.id) : null;
    out.duffyPlaceless = duffy ? placelessSittingsOfVenueBodies(duffy, meetings).map((m) => m.id) : [];
    out.duffy = duffy ? render({}, h(MeetingPanel, { venue: duffy, placeless: placelessSittingsOfVenueBodies(duffy, meetings), onClose: () => {}, onOpenMeeting: () => {} })) : '';
    console.log(JSON.stringify(out));
  `;
  const output = execFileSync(
    process.execPath,
    [
      "--import", "data:text/javascript,process.geteuid=()=>0",
      "--import", "tsx",
      "--import", "./scripts/register-test-loader.mjs",
      // The meeting doors this render reads, as every test process installs them.
      "--import", "./tests/helpers/install-fixture-doors.ts",
      "--input-type=module", "-e", script,
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 240_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const r = JSON.parse(output.trim().split("\n").pop()!) as {
    events: { id: string; gap: Meeting["venueGap"] }[];
    kept: string[];
    list: string;
    duffyPins: string[] | null;
    duffyPlaceless: string[];
    duffy: string;
  };
  const fails: string[] = [];
  const check = (ok: boolean, what: string) => {
    if (!ok) fails.push(what);
  };

  const cholla = r.events.find((e) => e.gap?.publishedText === CHOLLA);
  const joint = r.events.find((e) => e.gap?.kind === "NOT_STATED_BY_PUBLISHER");
  assert.ok(cholla && joint, "the page's Cholla session and a Joint Committee date are produced");
  check(r.kept.includes(cholla.id) && r.kept.includes(joint.id), "the reader's default filters drop a venue-gap sitting");

  // ── The meeting list: listed, the stated place as text, never online. ──
  for (const e of [cholla, joint]) {
    const row = rowMarkup(r.list, e.id);
    check(row.length > 0, `list: ${e.id} is not rendered`);
    check(!/data-meeting-where="online"/.test(row), `list: ${e.id} is marked online`);
    check(!/data-meeting-where="unrecorded"/.test(row), `list: ${e.id} says the place is not recorded`);
  }
  const chollaRow = text(rowMarkup(r.list, cholla.id));
  check(/data-meeting-where="stated"/.test(chollaRow) && chollaRow.includes(CHOLLA), `list: the Cholla row does not show "${CHOLLA}"`);
  const jointRow = text(rowMarkup(r.list, joint.id));
  check(!/data-meeting-where|data-working-on-it/.test(jointRow), "list: the Joint Committee row renders an absent place");

  // ── The body's pin panel: listed, the place as text, stated N = rows. ──
  check(!r.duffyPins?.includes(cholla.id), "Duffy pin: a venue-gap sitting was given the building's pin");
  check(r.duffyPlaceless.includes(cholla.id) && r.duffyPlaceless.includes(joint.id), "Duffy panel: the district's venue-gap sittings are not handed to the panel");
  const duffyIds = rowIds(r.duffy);
  check(duffyIds.includes(cholla.id) && duffyIds.includes(joint.id), "Duffy panel: a venue-gap sitting is not rendered");
  const chollaPanel = text(rowMarkup(r.duffy, cholla.id));
  check(/data-meeting-where="stated"/.test(chollaPanel) && chollaPanel.includes(CHOLLA), `Duffy panel: the Cholla row does not show "${CHOLLA}"`);
  check(!/data-meeting-where="unrecorded"/.test(chollaPanel), "Duffy panel: the Cholla row says we have not recorded a place");
  check(!/data-meeting-where="online"/.test(chollaPanel), "Duffy panel: the Cholla row is marked online");
  const jointPanel = text(rowMarkup(r.duffy, joint.id));
  check(!/data-meeting-where|data-working-on-it/.test(jointPanel), "Duffy panel: the Joint Committee row renders an absent place");
  const eyebrow = /class="notice-eyebrow[^"]*"[^>]*>([^<]*)</.exec(r.duffy)?.[1] ?? "";
  const eyebrowText = text(eyebrow);
  const stated = Number(/^(\d+) public meetings/.exec(eyebrowText)?.[1]);
  check(stated === duffyIds.length, `Duffy panel: states ${stated}, renders ${duffyIds.length} rows`);
  check(/places? named below/.test(eyebrowText), `Duffy panel: the split "${eyebrowText}" omits the held place names`);
  check(!/with no place|not recorded|not stated/.test(eyebrowText), `Duffy panel: the heading repeats missing-place copy outside the card foot`);

  assert.deepEqual(fails, [], `\n  ${fails.join("\n  ")}`);
});
