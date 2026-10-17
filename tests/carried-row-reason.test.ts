import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { carryForward } from "../lib/meetings/carry-forward.ts";
import { CARRIED_ROW_CLAUSE, carriedRowClause, type CarriedReason } from "../lib/meetings/freshness.ts";
import { meetingBodyIds, searchMeetings } from "../lib/meetings/query.ts";
import { snapshotSourceFor } from "../lib/meetings/registry.ts";
import type { ChildRunReport } from "../lib/sources/composite/index.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { promoteMeetingPartitions } from "../scripts/ingest.ts";
import { freshEdge, publishPass, readPlace } from "./helpers/meeting-body-fixtures.ts";

const ROOT = process.cwd();

const REASONS: readonly CarriedReason[] = [
  "SOURCE_UNAVAILABLE",
  "PARTIAL_SCOPE_UNAVAILABLE",
  "UNEXPLAINED_DISAPPEARANCE",
  "OUTSIDE_FETCH_WINDOW",
];

const ROCKAWAY = MEETING_PARTITION_CONTRACTS.find((partition) =>
  partition.meetingSource === "civicplus" &&
  partition.bodyId === "ocd-division/country:us/state:nj/county:morris/place:rockaway_township#governing",
)!;
const ICAL_URL = "https://www.rockawaytownship.org/common/modules/iCalendar/iCalendar.aspx?catID=25&feed=calendar";
const ARCHIVE_URL = "https://www.rockawaytownship.org/AgendaCenter";
const LAST_HELD = "2026-09-23T03:47:06.886Z";
const NO_LONGER_HELD = "2026-09-23T16:45:32.674Z";

const MUNICIPAL_BUILDING = {
  lat: 40.912595,
  lng: -74.530052,
  name: "Rockaway Township Municipal Building",
  address: "65 Mount Hope Road, Rockaway Township, NJ 07866",
};

function icalListing(collectedAt: string): Meeting {
  return {
    id: "civicplus:rockaway_township:1824",
    ocdId: ROCKAWAY.ocdId,
    bodyId: ROCKAWAY.bodyId,
    bodyName: "Township Council",
    title: "Township Council Regular Meeting",
    startsAt: "2026-09-22T19:00:00-04:00",
    timeZone: "America/New_York",
    location: MUNICIPAL_BUILDING,
    agendaUrl: null,
    jurisdiction: "Rockaway Township, NJ",
    status: "CONCLUDED",
    provenance: { sourceUrl: ICAL_URL, sourceOrg: "Rockaway Township", collectedAt, verifiedAt: null },
  };
}

function archiveListing(collectedAt: string): Meeting {
  return {
    id: "civicplus:rockaway_township:archive:2026-09-22",
    ocdId: ROCKAWAY.ocdId,
    bodyId: ROCKAWAY.bodyId,
    bodyName: "Township Council",
    title: "Township Council",
    startsAt: "2026-09-22T00:00:00-04:00",
    startPrecision: "DAY",
    timeZone: "America/New_York",
    location: MUNICIPAL_BUILDING,
    agendaUrl: "https://www.rockawaytownship.org/AgendaCenter/ViewFile/Agenda/_09222026-1028",
    jurisdiction: "Rockaway Township, NJ",
    status: "CONCLUDED",
    provenance: { sourceUrl: ARCHIVE_URL, sourceOrg: "Rockaway Township", collectedAt, verifiedAt: null },
  };
}

function answered(version: string): ChildRunReport {
  const bytes = `civicplus:${version}`;
  return {
    source: "civicplus",
    ok: true,
    error: null,
    fetched: 1,
    normalized: 1,
    drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
    acquisitions: [{
      source: "civicplus",
      requestedUrl: ICAL_URL,
      finalUrl: ICAL_URL,
      httpStatus: 200,
      rawHash: createHash("sha256").update(bytes).digest("hex"),
      byteCount: Buffer.byteLength(bytes),
    }],
  };
}

const KEARSARGE = "ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district";

function kearsargeSitting(date: string, collectedAt = "2026-08-15T20:00:00.000Z"): Meeting {
  return {
    id: `schedulepage:kearsarge:${date}`,
    ocdId: KEARSARGE,
    bodyId: KEARSARGE,
    bodyName: "School Board",
    title: "School Board",
    startsAt: `${date}T22:30:00.000Z`,
    timeZone: "America/New_York",
    location: { name: "Kearsarge Regional Middle School", address: "114 Main Street, New London, NH", lat: 43.4, lng: -72.0 },
    agendaUrl: null,
    jurisdiction: "Kearsarge Regional School District, NH",
    status: "SCHEDULED",
    provenance: { sourceUrl: "https://www.kearsarge.org/", sourceOrg: "Kearsarge Regional School District", collectedAt, verifiedAt: null },
  };
}

interface RenderedSurfaces {
  readonly panels: readonly string[];
}

// Components import CSS modules, so the test loader rides along to stub them.
function renderSurfaces(meetings: readonly Meeting[]): RenderedSurfaces {
  const output = execFileSync(process.execPath, [
    "--import", "data:text/javascript,process.geteuid=()=>0",
    "--import", "tsx",
    "--import", "./scripts/register-test-loader.mjs",
    "--input-type=module",
    "-e", `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { DataProvider } from './lib/state/data.tsx';
    import { UiProvider } from './lib/state/provider.tsx';
    import { MeetingPanel } from './components/map/meeting-panel.tsx';
    import { ReaderCard } from './components/shell/reader-card.tsx';
    import { meetingCardSources } from './lib/officials/card-sources.ts';
    import { groupByVenue } from './lib/meetings/venues.ts';
    const meetings = JSON.parse(process.env.CARRIED_ROW_REASON_CASES);
    const data = { allMeetings: meetings, meetings, venues: [], result: null, location: null, drawnDistricts: [],
      dropped: 0, searchFailed: false, atAddress: false, governing: null, zipPartial: null, basis: 'ZIP' };
    const render = (child) => renderToStaticMarkup(h(DataProvider, { value: data }, h(UiProvider, { initial: {} }, child)));
    const panels = groupByVenue(meetings).map((venue) => render(h(ReaderCard, {
      viewKey: venue.key, kicker: venue.name, backLabel: null, onBack() {}, onClose() {},
      sources: venue.meetings.flatMap(meeting => meetingCardSources(meeting, [])),
    }, h(MeetingPanel, { venue, onClose() {}, onOpenMeeting() {}, embedded: true }))));
    console.log(JSON.stringify({ panels }));
  `], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, CARRIED_ROW_REASON_CASES: JSON.stringify(meetings) },
  });
  return JSON.parse(output.trim().split("\n").at(-1)!) as RenderedSurfaces;
}

function innerText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceLine(markup: string, meetingId: string): string | null {
  const tail = markup.split(`data-meeting-carried-source="${meetingId}"`)[1];
  return tail ? innerText(/<p[^>]*>([\s\S]*?)<\/p>/.exec(tail)?.[1] ?? "") : null;
}
function panelLine(markup: string, meetingId: string): string | null { return sourceLine(markup, meetingId); }

const AGE = String.raw`(?:just now|\d+ (?:minute|hour|day)s? ago)`;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("each recorded carry reason earns its own plain clause, and a mark without one earns none", () => {
  assert.equal(carriedRowClause({ reason: "SOURCE_UNAVAILABLE" }), "our latest check couldn't reach this calendar");
  assert.equal(carriedRowClause({ reason: "PARTIAL_SCOPE_UNAVAILABLE" }), "our latest check couldn't read all of this calendar");
  assert.equal(carriedRowClause({ reason: "UNEXPLAINED_DISAPPEARANCE" }), "our latest check of this calendar didn't find this listing");
  assert.equal(carriedRowClause({ reason: "OUTSIDE_FETCH_WINDOW" }), "our latest check covered nearer dates than this one");

  assert.deepEqual(Object.keys(CARRIED_ROW_CLAUSE).sort(), [...REASONS].sort());

  for (const carried of [
    undefined,
    null,
    {},
    { reason: undefined },
    { reason: null },
    { reason: "" },
    { reason: 7 },
    { reason: "unexplained_disappearance" },
    { reason: "SOURCE_REFUSED" },
    { reason: "toString" },
    { reason: "constructor" },
    { reason: "__proto__" },
    { reason: "hasOwnProperty" },
  ]) {
    assert.equal(carriedRowClause(carried), null, `${JSON.stringify(carried)} was given a clause`);
  }

  for (const clause of Object.values(CARRIED_ROW_CLAUSE)) {
    assert.doesNotMatch(clause, /_|[A-Z]{2,}/, `${clause} carries internal vocabulary`);
    assert.doesNotMatch(clause, /carried|disappear|partition|source/i, `${clause} speaks the pipeline's words`);
  }
});

test("a calendar that answered is never called unreachable, and its answer is never read as the body's act", () => {
  const clause = CARRIED_ROW_CLAUSE.UNEXPLAINED_DISAPPEARANCE;
  assert.doesNotMatch(
    clause,
    /reach|refus|fail|unavailable|answer|could(?:n't| not)/i,
    "this is the defect: the calendar ANSWERED, with authenticated bytes, and the clause said we could not reach it",
  );
  assert.doesNotMatch(
    clause,
    /no longer|remov|withdr|cancel|delet|stopped|dropped/i,
    "the writer does not know why the listing left the answer; a clause that says the body removed it is a claim about a government",
  );
  assert.doesNotMatch(
    clause,
    /\bmeeting\b|\bsitting\b/i,
    "the unit that left the answer is the LISTING: at Rockaway the same sitting was in the same answer as a second listing",
  );
  assert.match(clause, /^our latest check\b/, "the clause is about our check, whose it is");
});

test("the reason survives its writer, the body's record, the edge, the wire and the route's search", async () => {
  assert.ok(ROCKAWAY, "the Rockaway Township council partition is registered");
  const store = new MemoryRoutineDataStore();

  const [seeded] = await promoteMeetingPartitions({
    store,
    partitions: [ROCKAWAY],
    meetings: [icalListing(LAST_HELD), archiveListing(LAST_HELD)],
    agendaDocuments: [],
    reports: [answered(LAST_HELD)],
    generatedAt: LAST_HELD,
  });
  assert.equal(seeded?.outcome.candidate.state, "PROMOTED");

  const [next] = await promoteMeetingPartitions({
    store,
    partitions: [ROCKAWAY],
    meetings: [archiveListing("2026-09-23T16:45:28.015Z")],
    agendaDocuments: [],
    reports: [answered(NO_LONGER_HELD)],
    generatedAt: NO_LONGER_HELD,
  });
  assert.equal(next?.outcome.candidate.state, "PROMOTED");

  const expected = { source: "civicplus", lastFreshAt: LAST_HELD, reason: "UNEXPLAINED_DISAPPEARANCE" };

  const edge = freshEdge();
  await publishPass(store, edge, NO_LONGER_HELD);
  const read = await readPlace(edge, store, [ROCKAWAY.ocdId!], NO_LONGER_HELD);
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  const served = JSON.parse(JSON.stringify(read.value)) as typeof read.value;
  assert.deepEqual(served.meetings.find((row) => row.id === "civicplus:rockaway_township:1824")?.carried, expected);
  assert.equal(
    served.meetings.find((row) => row.id === "civicplus:rockaway_township:archive:2026-09-22")?.carried,
    undefined,
    "the archive listing was read fresh by the same check",
  );

  const divisions = new Set([ROCKAWAY.ocdId!]);
  const result = await searchMeetings(
    MUNICIPAL_BUILDING.lat,
    MUNICIPAL_BUILDING.lng,
    25,
    new Date(NO_LONGER_HELD),
    divisions,
    snapshotSourceFor(served),
    undefined,
    meetingBodyIds([{ id: ROCKAWAY.bodyId, ocdId: ROCKAWAY.ocdId, alsoServesOcdIds: [] }], divisions),
  );
  const wire = JSON.parse(JSON.stringify(result)) as { meetings: Meeting[] };
  const listed = wire.meetings.find((row) => row.id === "civicplus:rockaway_township:1824");
  assert.deepEqual(listed?.carried, expected);
  assert.ok(
    wire.meetings.some((row) => row.id === "civicplus:rockaway_township:archive:2026-09-22" && !row.carried),
    "the fresh archive listing of the same sitting is served beside it",
  );
  assert.equal(carriedRowClause(listed?.carried), "our latest check of this calendar didn't find this listing");
});

test("the venue card renders the decided clause for every reason, and never calls an answering calendar unreachable", () => {
  const unexplained: Meeting = {
    ...icalListing(LAST_HELD),
    carried: { source: "civicplus", lastFreshAt: LAST_HELD, reason: "UNEXPLAINED_DISAPPEARANCE" },
  };
  const fresh = archiveListing("2026-09-23T16:45:28.015Z");
  const refused: Meeting = {
    ...kearsargeSitting("2026-10-20"),
    carried: { source: "schedulepage", lastFreshAt: "2026-08-15T20:00:00.000Z", reason: "SOURCE_UNAVAILABLE" },
  };
  const partial: Meeting = {
    ...kearsargeSitting("2026-10-27"),
    id: "schedulepage:kearsarge:2026-10-27-partial",
    carried: { source: "schedulepage", lastFreshAt: "2026-08-15T20:00:00.000Z", reason: "PARTIAL_SCOPE_UNAVAILABLE" },
  };

  const legacy = carryForward(
    [{ source: "schedulepage", ok: false }],
    [],
    {
      formatVersion: 1,
      generatedAt: "2026-08-16T02:00:00.000Z",
      counts: { fresh: 1, carried: 0, total: 1 },
      sources: [],
      meetings: [kearsargeSitting("2026-11-03")],
      agendaDocuments: [],
    },
    new Date("2026-09-23T12:00:00.000Z"),
  ).meetings[0]!;
  assert.deepEqual(Object.keys(legacy.carried ?? {}).sort(), ["lastFreshAt", "source"], "the legacy writer records no reason");

  const cases: readonly { meeting: Meeting; clause: string | null }[] = [
    { meeting: unexplained, clause: "our latest check of this calendar didn't find this listing" },
    { meeting: refused, clause: "our latest check couldn't reach this calendar" },
    { meeting: partial, clause: "our latest check couldn't read all of this calendar" },
    { meeting: legacy, clause: null },
  ];

  const { panels } = renderSurfaces([unexplained, fresh, refused, partial, legacy]);
  const panelFor = (id: string) => {
    const markup = panels.find((candidate) => candidate.includes(`data-meeting-id="${id}"`));
    assert.ok(markup, `no venue card rendered ${id}`);
    assert.equal((markup.match(/data-card-sources=/g) ?? []).length, 1);
    return markup;
  };

  for (const { meeting, clause } of cases) {
    const reason = meeting.carried?.reason ?? "no reason";
    assert.match(
      panelLine(panelFor(meeting.id), meeting.id) ?? "(no line)",
      clause === null ? new RegExp(`^Last reached ${AGE}$`) : new RegExp(`^Last reached ${AGE} — ${escape(clause)}$`),
      `venue card, ${reason}`,
    );
  }

  const rockawayCard = panelFor(unexplained.id);
  assert.ok(rockawayCard.includes(`data-meeting-id="${fresh.id}"`), "both listings of the sitting are on one card");
  assert.equal(panelLine(rockawayCard, fresh.id), null, "a fresh listing states no carried line");
  assert.doesNotMatch(innerText(rockawayCard), /couldn't reach|could not reach|reach this calendar/i);

  const legacyRow = panelFor(legacy.id).split(`data-meeting-id="${legacy.id}"`)[1]!.split("</article>")[0]!;
  assert.doesNotMatch(innerText(legacyRow), /our latest check/);
});

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// Comments removed, so an explanation is not read as a defect.
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

test("no reader surface writes a carried-row sentence of its own; each goes through the one decider", () => {
  for (const rel of ["lib/officials/card-sources.ts"]) {
    const code = withoutComments(readFileSync(join(ROOT, rel), "utf8"));
    assert.ok(
      /import \{[^}]*\bcarriedRowClause\b[^}]*\} from "\.\.\/meetings\/freshness\.ts"/.test(code),
      `${rel} does not import the decider`,
    );
    assert.ok(/carriedRowClause\(meeting\.carried\)/.test(code), `${rel} does not ask the decider about its own row`);
  }

  const offenders: string[] = [];
  let scanned = 0;
  for (const tree of ["components", "app"]) {
    for (const file of sourceFiles(join(ROOT, tree))) {
      scanned += 1;
      const code = withoutComments(readFileSync(file, "utf8")).replace(/&apos;/g, "'");
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
      for (const clause of Object.values(CARRIED_ROW_CLAUSE)) {
        if (code.includes(clause)) offenders.push(`${rel} writes "${clause}" itself`);
      }
      if (/reach this calendar/i.test(code)) offenders.push(`${rel} writes a reachability sentence about a calendar`);
    }
  }
  assert.ok(scanned >= 50, `the sweep read only ${scanned} file(s); a guard that read nothing reports clean`);
  assert.deepEqual(
    offenders,
    [],
    "a surface decides a carried row's reason for itself — the defect was two components doing exactly that:\n  " +
      offenders.join("\n  "),
  );
});
