/**
 * **A VERIFIED UPCOMING MEETING WITH NO AGENDA YET AND NO BUILDING STAYS ON
 * EVERY READER SURFACE THAT LISTS MEETINGS.** (The owner's Tucson Unified
 * report, 2026-09-23.)
 *
 * The report: at 85701, Tucson Unified showed concluded meetings and a working
 * "Read the agenda" link for September 22, and none of the district's three
 * upcoming committee meetings (Sep 28, Sep 30, Oct 5), each "Final version not
 * published" on the district's portal. The store, the promotion and
 * `/api/meetings` all carried the three rows. The loss was in the reader:
 *
 * - the panel behind the Duffy pin is headed "Tucson Unified School District ·
 *   8 public meetings" and listed only the sittings held in that room — all
 *   concluded. The three upcoming sittings are published "Via Zoom Webinar",
 *   so they have no building, no pin, and were on no panel
 *   (`lib/meetings/venues.ts` skips them, correctly, for pins);
 * - the district card's "Upcoming 3" door dispatched a Body scope keyed on the
 *   division's bare OCD-ID, which no meeting's `<ocdId>|<bodyName>` key can
 *   equal, and opened "0 meetings — Nothing matches the current filters"
 *   (`lib/state/derive.ts`, `components/map/map-entry.tsx`).
 *
 * Neither loss was the missing agenda. Both hold for any meeting with no
 * building. This file proves the fix on the reader's rendered surfaces against
 * recorded rows — Tucson Unified's own, and two cases the fix did not come
 * from (RULING 257): Pima Community College (another tenant, a division-less
 * body) and Pima County (a division with two sources and more than one body).
 * It also proves the missing-location path the recorded rows do not contain: a
 * sitting with no building AND no published online access stays listed and
 * says so, and is never called "online".
 *
 * No live calls: `tests/fixtures/reader-upcoming-meetings-85701.json` is the
 * production response, saved.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { INITIAL_STATE } from "../lib/state/defaults.ts";
import { applyFilters } from "../lib/state/derive.ts";
import { uiReducer } from "../lib/state/reducer.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { readerText as text, rowIds, rowMarkup } from "./helpers/reader-markup.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = "tests/fixtures/reader-upcoming-meetings-85701.json";
const fixture = JSON.parse(readFileSync(join(ROOT, FIXTURE), "utf8")) as {
  recordedAt: string;
  meetings: Meeting[];
};

/** The response's own instant; every date window below is pinned to it. */
const RECORDED_NOW = Date.parse("2026-09-23T23:00:00.000Z");
const TUSD = "ocd-division/country:us/state:az/school_district:tucson_unified_district";
const PIMA = "ocd-division/country:us/state:az/county:pima";
const UPCOMING = ["diligent:tusd1:503", "diligent:tusd1:505", "diligent:tusd1:504"];
const SEP22 = "diligent:tusd1:499";
const SEP22_AGENDA =
  "https://tusd1-schooldesk.community.diligentoneplatform.com/Portal/MeetingInformation.aspx?Org=Cal&Id=499";
/** Pima Community College's upcoming sittings with no building and no agenda. */
const PCC_PLACELESS_UPCOMING = ["diligent:pcc:699", "diligent:pcc:700"];
/** The missing-location case, derived from a recorded row (see the render script). */
const UNRECORDED = "diligent:tusd1:505";

const byId = new Map(fixture.meetings.map((m) => [m.id, m]));


test("the recorded rows are the owner's case: scheduled, no agenda, no building", () => {
  for (const id of UPCOMING) {
    const m = byId.get(id);
    assert.ok(m, `${id} is missing from the recorded response`);
    assert.equal(m.status, "SCHEDULED");
    assert.equal(m.agendaUrl, null, `${id} carries an agenda — the fixture no longer records the report`);
    assert.equal(m.location, null, `${id} carries a building — the fixture no longer records the report`);
    assert.equal(m.ocdId, TUSD);
  }
  assert.equal(byId.get(SEP22)?.agendaUrl, SEP22_AGENDA);
  // The reader's default filters keep every Tucson Unified row in the window.
  const tusd = fixture.meetings.filter((m) => m.ocdId === TUSD);
  const kept = applyFilters({ meetings: fixture.meetings, ui: INITIAL_STATE, center: null, now: RECORDED_NOW });
  assert.equal(tusd.length, 18);
  assert.deepEqual(
    kept.filter((m) => m.ocdId === TUSD).map((m) => m.id).sort(),
    tusd.map((m) => m.id).sort(),
    "the default filters drop a Tucson Unified row",
  );
});

test("the district card's door opens exactly the rows its count counted, never a Body scope", async () => {
  /*
   * Imported here rather than at the top so a checkout without the module
   * fails THIS test and still runs the rendered ones below.
   */
  const { divisionUpcoming, focusList, showDivisionUpcoming } = await import("../lib/state/list-focus.ts");
  const meetings = applyFilters({ meetings: fixture.meetings, ui: INITIAL_STATE, center: null, now: RECORDED_NOW });

  for (const division of [
    { ocdId: TUSD, label: "Tucson Unified District" },
    // A case the fix did not come from: two sources, more than one body.
    { ocdId: PIMA, label: "Pima" },
  ]) {
    const stated = divisionUpcoming(meetings, division.ocdId);
    assert.ok(stated.length > 0, `${division.label}: the recorded response has no upcoming sitting to count`);
    const ui = showDivisionUpcoming(division).reduce(uiReducer, INITIAL_STATE);
    assert.equal(ui.listOverlayOpen, true, "the door does not open the list");
    assert.equal(ui.body, null, "the door set a Body scope — a persistent filter the reader cannot see");
    // The list re-filters with the state the door left behind, as the page does.
    const shown = focusList(applyFilters({ meetings: fixture.meetings, ui, center: null, now: RECORDED_NOW }), ui);
    assert.equal(shown.applied, true);
    assert.deepEqual(
      shown.list.map((m) => m.id),
      stated.map((m) => m.id),
      `${division.label}: stated ${stated.length}, the list rendered ${shown.list.length}`,
    );
    // The focus belongs to one opening.
    const closed = uiReducer(ui, { type: "list/open", open: false });
    assert.equal(closed.listFocusDivision, null);
  }
  assert.deepEqual(
    divisionUpcoming(meetings, TUSD).map((m) => m.id),
    UPCOMING,
    "Tucson Unified's upcoming count is not the three recorded sittings",
  );

  // The component dispatches the shared action and nothing else, and no
  // component but the Body dropdown dispatches a Body scope at all.
  const entry = readFileSync(join(ROOT, "components/map/map-entry.tsx"), "utf8");
  // Approved reader design (2026-09-28): a selected district opens its full
  // card inside the one large card, and that card lists the division's
  // sittings itself (its Meetings section) rather than behind a list filter.
  assert.ok(entry.includes("subject: districtSubject("), "a selected district opens its district card");
  assert.doesNotMatch(entry, /type: "scope\/body"/, "map-entry dispatches a Body scope");
});

test("every reader surface that lists meetings renders the upcoming sittings, with honest gaps and matching counts", () => {
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
    import { MeetingPopup } from './components/map/popup/meeting-popup.tsx';
    import { DistrictPopup } from './components/map/popup/district-popup.tsx';
    import { DoorOverlay } from './components/map/door-overlay.tsx';
    import * as venuesModule from './lib/meetings/venues.ts';
    import { installRegistryRuntimeFirstSeeds } from './tests/helpers/registry-runtime-first-seed.ts';
    await installRegistryRuntimeFirstSeeds();

    const fixture = JSON.parse(readFileSync(${JSON.stringify(FIXTURE)}, 'utf8'));
    const NOW = ${RECORDED_NOW};
    // The missing-location case: a recorded sitting with its online access
    // withheld — no building and nothing published about where it is held.
    const unrecorded = { ...fixture.meetings.find((m) => m.id === ${JSON.stringify(UNRECORDED)}) };
    delete unrecorded.online;

    function shell(all) {
      const meetings = applyFilters({ meetings: all, ui: INITIAL_STATE, center: null, now: NOW });
      const venues = venuesModule.groupByVenue(meetings, fixture.listingIdentity);
      return {
        data: { allMeetings: all, meetings, venues, listingIdentity: fixture.listingIdentity,
          result: { meetings: all, listingIdentity: fixture.listingIdentity, coverage: fixture.coverage, tier: 'exact', radiusKm: 25, requestedRadiusKm: 25, center: { lat: 32.2217, lng: -110.9695 } },
          location: null, drawnDistricts: [], dropped: 0, searchFailed: false, atAddress: false, governing: null, zipPartial: null, basis: 'ZIP' },
        meetings, venues,
      };
    }
    const render = (data, ui, child) => renderToStaticMarkup(h(DataProvider, { value: data }, h(UiProvider, { initial: ui }, child)));
    // What the page hands the panel behind a pin. A checkout without the
    // helper hands it nothing, which is exactly what the reader got.
    const placelessFor = (venue, meetings) => venuesModule.placelessSittingsOfVenueBodies
      ? venuesModule.placelessSittingsOfVenueBodies(venue, meetings) : [];

    const out = {};
    {
      const { data, meetings, venues } = shell(fixture.meetings);
      out.list = render(data, { listOverlayOpen: true, listGroupBy: 'none' }, h(ListOverlay, { onPickMeeting: () => {} }));
      const duffy = venues.find((v) => /Duffy Community Center/.test(v.name));
      out.duffyPins = duffy ? duffy.meetings.map((m) => m.id) : null;
      out.duffy = duffy ? render(data, {}, h(MeetingPanel, { venue: duffy, placeless: placelessFor(duffy, meetings), onClose: () => {}, onOpenMeeting: () => {} })) : '';
      const pcc = venues.find((v) => v.meetings.some((m) => m.id.startsWith('diligent:pcc:')));
      out.pcc = pcc ? render(data, {}, h(MeetingPanel, { venue: pcc, placeless: placelessFor(pcc, meetings), onClose: () => {}, onOpenMeeting: () => {} })) : '';
      out.district = render(data, {}, h(DistrictPopup, {
        district: { type: 'school-unified', tier: 'local', typeLabel: 'School (unified)', ocdId: ${JSON.stringify(TUSD)}, label: 'Tucson Unified District', state: 'AZ' },
        upcomingMeetings: meetings.filter((m) => m.ocdId === ${JSON.stringify(TUSD)} && m.status === 'SCHEDULED').length,
        onShowMeetings: () => {},
      }));
      out.bodies = render(data, {}, h(DoorOverlay, { door: 'bodies', coverage: fixture.coverage, meetings, drawnDistricts: [], districtOverlayOn: false, atAddress: false,
        onShowDistricts: () => {}, onOpenOfficial: () => {}, onOpenMeeting: () => {}, onOpenBody: () => {}, onClose: () => {} }));
      out.popup503 = render(data, {}, h(MeetingPopup, { meeting: meetings.find((m) => m.id === 'diligent:tusd1:503'), onClose: () => {} }));
    }
    {
      const all = fixture.meetings.map((m) => (m.id === unrecorded.id ? unrecorded : m));
      const { data, meetings, venues } = shell(all);
      out.unrecordedList = render(data, { listOverlayOpen: true, listGroupBy: 'none' }, h(ListOverlay, { onPickMeeting: () => {} }));
      out.unrecordedPopup = render(data, {}, h(MeetingPopup, { meeting: unrecorded, onClose: () => {} }));
      const duffy = venues.find((v) => /Duffy Community Center/.test(v.name));
      out.unrecordedDuffy = duffy ? render(data, {}, h(MeetingPanel, { venue: duffy, placeless: placelessFor(duffy, meetings), onClose: () => {}, onOpenMeeting: () => {} })) : '';
      out.unrecordedPinned = venues.some((v) => v.meetings.some((m) => m.id === unrecorded.id));
    }
    console.log(JSON.stringify(out));
  `;
  // tsx resolves the components' extensionless imports; the repo's test loader,
  // registered after it and so consulted first, supplies CSS-module class keys
  // (the popups import one) — the real components, rendered as the server
  // renders them.
  const output = execFileSync(
    process.execPath,
    [
      "--import", "data:text/javascript,process.geteuid=()=>0",
      "--import", "tsx",
      "--import", "./scripts/register-test-loader.mjs",
      "--input-type=module", "-e", script,
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 240_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const r = JSON.parse(output.trim().split("\n").pop()!) as Record<string, string | string[] | boolean | null>;
  const html = (key: string) => String(r[key] ?? "");
  const fails: string[] = [];
  const check = (ok: boolean, what: string) => {
    if (!ok) fails.push(what);
  };

  // ── The meeting list (the Meetings tile): every row, stated N = rows. ──
  const listIds = rowIds(html("list"));
  for (const id of [...UPCOMING, SEP22]) check(listIds.includes(id), `meeting list: ${id} is not rendered`);
  const listHeader = /class="al-overlay-count">(\d+) (?:meetings|calendar listings)/.exec(html("list"));
  check(Number(listHeader?.[1]) === listIds.length, `meeting list: states ${listHeader?.[1]}, renders ${listIds.length} rows`);
  for (const id of UPCOMING) {
    check(!/data-status="canceled"/.test(rowMarkup(html("list"), id)), `meeting list: ${id} is marked canceled — cancellation was inferred`);
  }

  // ── The panel behind the Duffy pin: the body's upcoming sittings, marked. ──
  const duffy = text(html("duffy"));
  const duffyIds = rowIds(html("duffy"));
  for (const id of UPCOMING) check(duffyIds.includes(id), `Duffy panel: ${id} is not rendered`);
  check(!UPCOMING.some((id) => (r.duffyPins as string[] | null)?.includes(id)), "Duffy pin: an online sitting was given the building's pin");
  const eyebrow = /class="notice-eyebrow[^"]*"[^>]*>(\d+) public meetings/.exec(html("duffy"));
  check(Number(eyebrow?.[1]) === duffyIds.length, `Duffy panel: states ${eyebrow?.[1]}, renders ${duffyIds.length} rows`);
  const agenda = new RegExp(`data-meeting-id="${SEP22}"[\\s\\S]*?href="([^"]+)"[^>]*>Read the agenda`).exec(html("duffy"));
  check(text(agenda?.[1] ?? "") === SEP22_AGENDA, `Duffy panel: the Sep 22 "Read the agenda" link is ${agenda?.[1] ?? "gone"}`);
  for (const id of UPCOMING) {
    const row = text(rowMarkup(html("duffy"), id));
    // The body's own published words, per row ("Via Zoom Webinar", "Via Zoom").
    const label = byId.get(id)?.online?.label;
    check(/data-working-on-it=/.test(row), `Duffy panel: ${id} does not name its agenda gap`);
    check(/data-status="online"/.test(rowMarkup(html("duffy"), id)), `Duffy panel: ${id} carries no online mark`);
    check(Boolean(label) && row.includes(label!) && /data-working-on-it=/.test(row), `Duffy panel: ${id} does not quote "${label}" or say whose gap the join link is`);
  }
  check(/Read the agenda/.test(duffy), "Duffy panel: no agenda link renders at all");

  // ── A case the fix did not come from: Pima Community College's pin. ──
  const pccIds = rowIds(html("pcc"));
  for (const id of PCC_PLACELESS_UPCOMING) check(pccIds.includes(id), `PCC panel: ${id} is not rendered`);

  // ── The district card states the count its door opens (proved above). ──
  const door = /aria-label="Show the (\d+) upcoming meetings for Tucson Unified District"/.exec(html("district"));
  check(Number(door?.[1]) === UPCOMING.length, `district card: states ${door?.[1] ?? "no door"}, three are recorded`);

  // ── The Bodies door: the next sitting is the first upcoming one. ──
  check(/Next meeting: Mon, September 28th, 2026/.test(text(html("bodies"))), "Bodies door: Tucson Unified's next meeting is not Sep 28");

  // ── The meeting's own card. ──
  const popup = text(html("popup503"));
  check(popup.includes("Online only — there is no room to attend in person."), "503 card: the online sentence is missing");
  check(popup.includes("Via Zoom Webinar") && /data-working-on-it=/.test(popup), "503 card: the join-link gap is missing");

  // ── The missing-location path: listed, never "online", gap named. ──
  const unrecordedRow = rowMarkup(html("unrecordedList"), UNRECORDED);
  check(unrecordedRow.length > 0, "no-place sitting: dropped from the meeting list");
  check(!/data-status="online"/.test(unrecordedRow), "no-place sitting: marked online in the meeting list");
  check(/data-meeting-where="unrecorded"/.test(unrecordedRow), "no-place sitting: the list row names no gap");
  const unrecordedPopup = text(html("unrecordedPopup"));
  check(/data-working-on-it=/.test(unrecordedPopup), "no-place sitting: the card names no gap");
  check(!unrecordedPopup.includes("Online only"), "no-place sitting: the card calls it online");
  check(rowIds(html("unrecordedDuffy")).includes(UNRECORDED), "no-place sitting: dropped from the body's pin panel");
  check(/data-meeting-where="unrecorded"/.test(rowMarkup(html("unrecordedDuffy"), UNRECORDED)), "no-place sitting: the pin panel names no gap");
  check(r.unrecordedPinned === false, "no-place sitting: given a pin");

  assert.deepEqual(fails, [], `\n  ${fails.join("\n  ")}`);
});
