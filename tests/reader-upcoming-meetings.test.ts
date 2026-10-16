/**
 * A verified upcoming meeting with no agenda yet and no building stays on every reader surface that
 * lists meetings, and a sitting with no building and no published online access stays listed and is
 * never called "online". The fixture is a saved production response; no live calls.
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
/** A division-less body's upcoming sittings with no building and no agenda. */
const PCC_PLACELESS_UPCOMING = ["diligent:pcc:699", "diligent:pcc:700"];
/** The missing-location case, derived from a recorded row (see the render script). */
const UNRECORDED = "diligent:tusd1:505";

const byId = new Map(fixture.meetings.map((m) => [m.id, m]));


test("the recorded rows are scheduled, with no agenda and no building", () => {
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
  const { divisionUpcoming, focusList, showDivisionUpcoming } = await import("../lib/state/list-focus.ts");
  const meetings = applyFilters({ meetings: fixture.meetings, ui: INITIAL_STATE, center: null, now: RECORDED_NOW });

  for (const division of [
    { ocdId: TUSD, label: "Tucson Unified District" },
    // Two sources, more than one body.
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
  // A selected district opens its full card, which lists the division's sittings itself.
  assert.ok(entry.includes("subject: districtSubject("), "a selected district opens its district card");
  assert.doesNotMatch(entry, /type: "scope\/body"/, "map-entry dispatches a Body scope");
});

test("every reader surface renders the upcoming sittings with held fields and matching counts", () => {
  const script = `
    import { createElement as h, Fragment } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { readFileSync } from 'node:fs';
    import { DataProvider } from './lib/state/data.tsx';
    import { UiProvider } from './lib/state/provider.tsx';
    import { INITIAL_STATE } from './lib/state/defaults.ts';
    import { applyFilters } from './lib/state/derive.ts';
    import { ListOverlay } from './components/map/list-overlay.tsx';
    import { MeetingPanel } from './components/map/meeting-panel.tsx';
    import { EntityModal, Meetings } from './components/map/popup/entity-modal.tsx';
    import { districtSubject } from './components/map/district-subject.tsx';
    import { DoorOverlay } from './components/map/door-overlay.tsx';
    import * as venuesModule from './lib/meetings/venues.ts';
    import { installRegistryAuthority } from './tests/helpers/promoted-fixtures.ts';
    await installRegistryAuthority();

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
          result: { meetings: all, listingIdentity: fixture.listingIdentity, coverage: fixture.coverage, tier: 'exact', radiusKm: 25, center: { lat: 32.2217, lng: -110.9695 } },
          location: null, drawnDistricts: [], dropped: 0, searchFailed: false, atAddress: false, governing: null, zipPartial: null, basis: 'ZIP' },
        meetings, venues,
      };
    }
    const render = (data, ui, child) => renderToStaticMarkup(h(DataProvider, { value: data }, h(UiProvider, { initial: ui }, child)));
    // What the page hands the panel behind a pin.
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
      const district = districtSubject({ type: 'school-unified', tier: 'local', typeLabel: 'School (unified)', ocdId: ${JSON.stringify(TUSD)}, label: 'Tucson Unified District', state: 'AZ' }, meetings);
      // Static rendering cannot open a disclosure. Render the actual card's meeting pane alongside its heading.
      out.district = render(data, {}, h(Fragment, null, h(EntityModal, {
        embedded: true, subject: district, onClose: () => {},
      }), h(Meetings, { meetings: district.meetings })));
      out.bodies = render(data, {}, h(DoorOverlay, { door: 'bodies', coverage: fixture.coverage, meetings, drawnDistricts: [], districtOverlayOn: false, atAddress: false,
        onShowDistricts: () => {}, onOpenOfficial: () => {}, onOpenMeeting: () => {}, onOpenBody: () => {}, onClose: () => {} }));
    }
    {
      const all = fixture.meetings.map((m) => (m.id === unrecorded.id ? unrecorded : m));
      const { data, meetings, venues } = shell(all);
      out.unrecordedList = render(data, { listOverlayOpen: true, listGroupBy: 'none' }, h(ListOverlay, { onPickMeeting: () => {} }));
      const duffy = venues.find((v) => /Duffy Community Center/.test(v.name));
      out.unrecordedDuffy = duffy ? render(data, {}, h(MeetingPanel, { venue: duffy, placeless: placelessFor(duffy, meetings), onClose: () => {}, onOpenMeeting: () => {} })) : '';
      out.unrecordedPinned = venues.some((v) => v.meetings.some((m) => m.id === unrecorded.id));
    }
    console.log(JSON.stringify(out));
  `;
  // tsx resolves extensionless imports; the test loader, consulted first, supplies CSS-module class keys.
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
    check(!/data-working-on-it=|working on getting this info|Want us/.test(row), `Duffy panel: ${id} renders a missing-field placeholder`);
    check(/data-meeting-where="online"/.test(rowMarkup(html("duffy"), id)), `Duffy panel: ${id} carries no online label`);
    check(Boolean(label) && row.includes(`Online · ${label}`), `Duffy panel: ${id} does not quote "${label}"`);
    check(/>Meeting page<\//.test(row), `Duffy panel: ${id} omits its held meeting page`);
  }
  check(/Read the agenda/.test(duffy), "Duffy panel: no agenda link renders at all");

  // ── A division-less body's pin. ──
  const pccIds = rowIds(html("pcc"));
  for (const id of PCC_PLACELESS_UPCOMING) check(pccIds.includes(id), `PCC panel: ${id} is not rendered`);

  // The actual district card lists the upcoming sittings behind its meeting section.
  for (const id of UPCOMING) check(rowIds(html("district")).includes(id), `district card: ${id} is missing from its meetings`);

  // ── The Bodies door: the next sitting is the first upcoming one. ──
  check(/Next meeting[\s\S]*Mon, September 28th, 2026/.test(text(html("bodies"))), "Bodies door: Tucson Unified's next meeting is not Sep 28");

  // ── The missing-location path: listed, with its absent place omitted. ──
  const unrecordedRow = rowMarkup(html("unrecordedList"), UNRECORDED);
  check(unrecordedRow.length > 0, "no-place sitting: dropped from the meeting list");
  check(!/data-meeting-where/.test(unrecordedRow), "no-place sitting: the list row renders an absent place");
  check(rowIds(html("unrecordedDuffy")).includes(UNRECORDED), "no-place sitting: dropped from the body's pin panel");
  check(!/data-meeting-where/.test(rowMarkup(html("unrecordedDuffy"), UNRECORDED)), "no-place sitting: the pin panel renders an absent place");
  check(r.unrecordedPinned === false, "no-place sitting: given a pin");

  assert.deepEqual(fails, [], `\n  ${fails.join("\n  ")}`);
});
