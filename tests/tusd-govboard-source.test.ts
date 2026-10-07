import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { extractPdfText } from "../lib/meetings/agenda-documents.ts";
import {
  makeTusdGovboardSource,
  monthsInWindow,
  parseBoardActions,
  parseCalendarFragment,
} from "../lib/sources/tusd-govboard/index.ts";
import { SOURCE_WIRING, type BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { agendaItems } from "../lib/routing/agenda-search.ts";
import { makeDiligentSource } from "../lib/sources/diligent/index.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "tusd-govboard");
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const RETRIEVAL = JSON.parse(read("retrieval.json")) as Record<string, { url: string }>;
const MONTHS = ["06", "07", "08", "09", "10", "11", "12"].map((m) => `incal-2026-${m}.html`).concat("incal-2027-01.html");

const WIRING: BodySourceWiring = {
  bodyId: "ocd-division/country:us/state:az/school_district:tucson_unified_district#board",
  ocdId: "ocd-division/country:us/state:az/school_district:tucson_unified_district",
  agendaSourceType: "TUSD_GOVBOARD",
  jurisdiction: "Tucson Unified School District, AZ",
  publishingOrg: "Tucson Unified School District Governing Board",
  timeZone: "America/Phoenix",
  config: {
    slug: "tusd1",
    base: "https://govboard.tusd1.org",
    calendarPid: "36871",
    actionsUrl: "https://govboard.tusd1.org/Actions",
    venueSourceId: "diligent",
    // Reviewed venue spellings (promoted venue-resolutions, diligent/TUSD).
    "venueMatch:Duffy Community Center": "Duffy Community Center Multipurpose Room 5145 E. 5th Street Tucson, AZ 85711",
    "venueMatch:Morrow Education Center": "Board Conference Room Morrow Education Center 1010 E. Tenth Street Tucson, Arizona 85719",
  },
  verifiedAt: "2026-09-23",
};
const NOW = new Date("2026-09-23T13:00:00-07:00");
const RAW = [{
  wiring: WIRING,
  collectedAt: "2026-09-23T20:10:00.000Z",
  months: MONTHS.map((name) => ({ url: RETRIEVAL[name].url, html: read(name) })),
  actions: { url: RETRIEVAL["actions.html"].url, html: read("actions.html") },
}];

test("the WIRED Diligent row links a concluded board sitting's own Board Actions record, not the portal page", () => {
  const wiring = SOURCE_WIRING.find((row) => row.bodyId === WIRING.bodyId)!;
  assert.equal(wiring.config.agendaRecordsUrl, "https://govboard.tusd1.org/Actions");
  const rows = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "diligent-tusd-meetings.json"), "utf8"));
  const source = makeDiligentSource([wiring]);
  const { meetings } = source.normalizeWithDrops([{
    wiring,
    meetings: rows,
    collectedAt: "2026-09-23T20:10:00.000Z",
    agendaRecords: { url: RETRIEVAL["actions.html"].url, html: read("actions.html") },
  }], NOW);
  const byId = new Map(meetings.map((m) => [m.id, m]));
  const records: Record<string, RegExp> = {
    "diligent:tusd1:493": /\/actions\/08-25-2026S\.pdf$/,
    "diligent:tusd1:492": /\/actions\/08-11-2026R\.pdf$/,
    "diligent:tusd1:491": /\/actions\/08-04-2026S\(2\)\.pdf$/,
    "diligent:tusd1:485": /\/actions\/07-28-2026\.pdf$/,
    "diligent:tusd1:484": /\/actions\/07-14-2026R\(1\)\.pdf$/,
  };
  for (const [id, pattern] of Object.entries(records)) {
    const m = byId.get(id);
    assert.ok(m, `${id} missing`);
    assert.match(m!.agendaUrl ?? "", pattern, id);
    assert.equal(new URL(m!.agendaUrl!).host, "govboard.tusd1.org");
  }
  // An executive session (type 28) and a committee (type 23) keep the portal link.
  assert.match(byId.get("diligent:tusd1:490")!.agendaUrl!, /MeetingInformation\.aspx\?Org=Cal&Id=490$/);
  assert.match(byId.get("diligent:tusd1:489")!.agendaUrl!, /MeetingInformation\.aspx\?Org=Cal&Id=489$/);
  // Without the index in hand the row behaves exactly as before.
  const bare = source.normalizeWithDrops([{ wiring, meetings: rows, collectedAt: "2026-09-23T20:10:00.000Z" }], NOW);
  assert.match(bare.meetings.find((m) => m.id === "diligent:tusd1:492")!.agendaUrl!, /Id=492$/);
});

test("the window's months are the ones fetched", () => {
  assert.deepEqual(monthsInWindow(NOW), [
    "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01",
  ]);
});

test("September's fragment carries the board AND its committees, with the district's own clock", () => {
  const sept = parseCalendarFragment(read("incal-2026-09.html"));
  assert.deepEqual(
    sept.map((s) => `${s.date.m}/${s.date.d} ${s.h}:${String(s.mi).padStart(2, "0")} ${s.title}`),
    [
      "9/8 16:30 Governing Board Meeting",
      "9/11 16:00 Budget Advisory Committee Meeting",
      "9/14 17:30 Employee Benefits Trust Meeting",
      "9/16 14:30 Audit Committee Meeting",
      "9/17 13:00 Bond Oversight Committee Meeting",
      "9/22 16:30 Governing Board Meeting",
      "9/28 18:15 Alternative Education Advisory Committee Meeting",
    ],
  );
});

test("Board Actions map each Governing Board sitting to its own record", () => {
  const actions = parseBoardActions(read("actions.html"), RETRIEVAL["actions.html"].url);
  assert.equal(actions.get("2026-09-22"), "https://govboard.tusd1.org/_theme/files/GovBoard/Docs/actions/09-22-2026S.pdf");
  assert.equal(actions.get("2026-09-08"), "https://govboard.tusd1.org/_theme/files/GovBoard/Docs/actions/09-08-2026R.pdf");
  assert.ok(actions.size >= 19 + 22, `${actions.size} sittings listed`);
});

test("a Board Actions record is the agenda's numbered items with their actions", async () => {
  const text = await extractPdfText(new Uint8Array(readFileSync(join(FIXTURES, "board-actions-2026-09-22.pdf"))));
  assert.match(text, /^GOVERNING BOARD AGENDA SPECIAL MEETING – Board Actions/);
  assert.ok(agendaItems(text).length >= 5, `${agendaItems(text).length} items extracted`);
});

test("normalize: places only what the district's sentence places, carries Board Actions on concluded board sittings", () => {
  const source = makeTusdGovboardSource([WIRING]);
  const { meetings, drops, accounting } = source.normalizeWithDrops(RAW, NOW);
  assert.equal(accounting.outcome, "CONSERVED");
  const byDay = (d: string, title: RegExp) => meetings.find((m) => m.startsAt.startsWith(d) && title.test(m.title));

  const sep22 = byDay("2026-09-22", /Governing Board/)!;
  assert.equal(sep22.location!.name, "Duffy Community Center, Multipurpose Room");
  assert.match(sep22.agendaUrl!, /09-22-2026S\.pdf$/);
  const oct6 = byDay("2026-10-06", /Governing Board/)!;
  assert.equal(oct6.agendaUrl, null, "an upcoming sitting has no Board Actions yet");

  assert.deepEqual(byDay("2026-09-14", /Employee Benefits/)!.online, { label: "Via Zoom", joinUrl: null });
  assert.equal(byDay("2026-09-17", /Bond Oversight/)!.location!.name, "Duffy Community Center, Multipurpose Room");
  assert.equal(byDay("2026-08-04", /Governing Board/)!.online!.label, "Via Zoom");

  // Jul 15: the district's own sentence moves the Audit Committee to a Zoom
  // webinar while its agenda platform kept the old room. The sitting's own statement governs.
  const jul15 = byDay("2026-07-15", /Audit/)!;
  assert.equal(jul15.location, null);
  assert.match(jul15.online!.joinUrl!, /^https:\/\/tusd1\.zoom\.us\/j\/\d+/);

  // "Committee meeting location TBD" (Sep 16) is counted and never placed.
  // It is published with no pin and our own place-not-recorded gap.
  const sep16 = byDay("2026-09-16", /Audit/)!;
  assert.ok(sep16, "the TBD sitting is published");
  assert.equal(sep16.location, null);
  assert.equal(sep16.online, undefined, "never called online");
  assert.equal(sep16.venueGap, undefined, "our own gap: place not recorded");
  assert.equal(drops.unknownVenue, 1, "still counted");
  assert.equal(accounting.dropped, 0);
});
