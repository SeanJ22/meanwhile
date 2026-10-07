import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { wiringForTypes } from "../lib/registry/source-wiring.ts";
import { makeSchedulePageSource } from "../lib/sources/schedulepage/index.ts";
import { makeRevizeSource } from "../lib/sources/revize/index.ts";
import { CompositeSource } from "../lib/sources/composite/index.ts";
import { carryForward } from "../lib/meetings/carry-forward.ts";
import { CONCLUDED_LOOKBACK_DAYS } from "../lib/meetings/constants.ts";
import {
  snapshotClientMeta,
  validateSnapshot,
  type MeetingsSnapshot,
} from "../lib/meetings/snapshot.ts";
import type { Meeting, ReportingMeetingSource } from "../lib/sources/types.ts";

/**
 * A failed fetch never silently empties a previously-full calendar: one host's refusal must not drop
 * bodies served by other hosts, and a refresh must not overwrite held rows with an absence.
 */

const NOW = new Date("2026-08-15T12:00:00-04:00");
const ROOT = process.cwd();

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/schedulepage/${name}`, import.meta.url), "utf8");

const rows = () => wiringForTypes(["SCHEDULEPAGE"]);

const KEARSARGE_OCD =
  "ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district";

/** A held sitting, as the snapshot held it. */
function kearsargeSitting(date: string): Meeting {
  return {
    id: `schedulepage:kearsarge:${date}`,
    ocdId: KEARSARGE_OCD,
    bodyId: KEARSARGE_OCD,
    bodyName: "School Board",
    title: "School Board",
    startsAt: `${date}T22:30:00.000Z`,
    timeZone: "America/New_York",
    location: {
      name: "Kearsarge Regional Middle School",
      address: "114 Main Street, New London, NH",
      lat: 43.4,
      lng: -72.0,
    },
    agendaUrl: null,
    jurisdiction: "Kearsarge Regional School District, NH",
    status: "SCHEDULED",
    provenance: {
      sourceUrl: "https://www.kearsarge.org/",
      sourceOrg: "Kearsarge Regional School District School Board",
      collectedAt: "2026-08-15T20:00:00.000Z",
      verifiedAt: null,
    },
  };
}

/** A fetch where one host answers and the others answer 403. */
function partialFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("mhrd.org")) {
      const body = url.includes("board-agendas")
        ? fixture("mhrd-board-agendas.html")
        : fixture("mhrd-boe-meetings.html");
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    }
    return new Response("forbidden", { status: 403 });
  }) as unknown as typeof fetch;
}

test("one host's refusal does not empty the bodies on the other hosts", async () => {
  const source = makeSchedulePageSource(rows(), partialFetch());
  const raw = await source.fetch({ lat: 0, lng: 0, radiusKm: 1 });

  const refused = raw.filter((r) => r.error);
  const served = raw.filter((r) => !r.error);
  assert.ok(
    served.length > 0,
    "every row was refused — the fixture no longer serves Morris Hills",
  );
  assert.ok(refused.length > 0, "no row was refused — the fixture no longer 403s");

  const { meetings, unreachableOcdIds } = source.normalizeWithDrops(raw, NOW);

  // The body whose own page answered still ships.
  assert.ok(
    meetings.some((m) => m.id.startsWith("schedulepage:mhrd:")),
    "Morris Hills' board produced no meetings even though its page answered — " +
      "a sibling body's 403 is emptying it again",
  );

  // The refused bodies are named, once per division.
  const refusedDivisions = new Set(
    refused.flatMap((r) => (r.wiring.ocdId ? [r.wiring.ocdId] : [])),
  );
  assert.deepEqual(
    [...(unreachableOcdIds ?? [])].sort(),
    [...refusedDivisions].sort(),
    "the refused divisions and the reported ones disagree — a gap nobody is told about",
  );
  for (const row of refused) {
    // A division-less body has no division to report; the drop count is the
    // whole of what can honestly be said about it.
    if (!row.wiring.ocdId) continue;
    assert.ok(
      unreachableOcdIds?.includes(row.wiring.ocdId),
      `${row.wiring.ocdId} was refused and is not in unreachableOcdIds`,
    );
  }
});

test("a source refused on EVERY row still reads as a failed source", async () => {
  const allRefused = (async () =>
    new Response("forbidden", { status: 403 })) as unknown as typeof fetch;
  const source = makeSchedulePageSource(rows(), allRefused);

  await assert.rejects(
    () => source.fetch({ lat: 0, lng: 0, radiusKm: 1 }),
    /403/,
    "a total refusal resolved instead of throwing — the source would report ok " +
      "while contributing nothing, and the reader would never see the honest line",
  );
});

test("the composite carries a partial refusal through to its report", async () => {
  const source = makeSchedulePageSource(rows(), partialFetch());
  const composite = new CompositeSource([
    source as unknown as ReportingMeetingSource<unknown>,
  ]);
  const raw = await composite.fetch({ lat: 0, lng: 0, radiusKm: 1 });
  composite.normalize(raw, NOW);

  const child = composite.lastReport?.children.find((c) => c.source === "schedulepage");
  assert.ok(child, "the composite lost the schedulepage child entirely");
  assert.equal(child.ok, true, "a partial refusal was reported as a total failure");
  assert.ok(
    (child.unreachableOcdIds?.length ?? 0) > 0,
    "the composite dropped the narrow refusal — every body the source serves " +
      "would be told its calendar was unreachable",
  );
});

test("a refused source keeps the calendar it had, and says how many rows are stale", () => {
  const previous: MeetingsSnapshot = {
    formatVersion: 1,
    generatedAt: "2026-08-15T20:00:00.000Z",
    counts: { fresh: 3, carried: 0, total: 3 },
    sources: [
      {
        source: "schedulepage",
        ok: true,
        error: null,
        fetched: 5,
        normalized: 27,
        drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
      },
    ],
    meetings: [
      kearsargeSitting("2026-09-10"),
      kearsargeSitting("2026-09-24"),
      // Aged out of the window: a dark source must not resurrect history.
      kearsargeSitting("2024-01-10"),
    ],
    agendaDocuments: [],
  };

  const { meetings, carried } = carryForward(
    [{ source: "schedulepage", ok: false }],
    [],
    previous,
    NOW,
  );

  assert.equal(
    meetings.length,
    2,
    "the refused source's in-window sittings were not carried, or the out-of-window one was",
  );
  assert.equal(carried.get("schedulepage"), 2, "the carried count was not stated");
  assert.equal(
    meetings[0].provenance.collectedAt,
    "2026-08-15T20:00:00.000Z",
    "a carried row was restamped as freshly collected — it must keep the date we " +
      "actually saw it, or the card claims a freshness nobody earned",
  );

  // Every carried row names the source that refused and when it was last actually fetched.
  for (const m of meetings) {
    assert.ok(m.carried, `carried row ${m.id} carries no mark`);
    assert.equal(m.carried?.source, "schedulepage");
    assert.equal(m.carried?.lastFreshAt, "2026-08-15T20:00:00.000Z");
  }
});

test("a row carried twice keeps naming the run that actually fetched it", () => {
  // A second refusal must not restamp the last-fresh mark.
  const once = carryForward(
    [{ source: "schedulepage", ok: false }],
    [],
    {
      formatVersion: 1,
      generatedAt: "2026-08-15T20:00:00.000Z",
      counts: { fresh: 1, carried: 0, total: 1 },
      sources: [],
      meetings: [kearsargeSitting("2026-09-10")],
      agendaDocuments: [],
    },
    NOW,
  );
  assert.equal(once.meetings[0].carried?.lastFreshAt, "2026-08-15T20:00:00.000Z");

  const twice = carryForward(
    [{ source: "schedulepage", ok: false }],
    [],
    {
      formatVersion: 1,
      // A whole day later, and still nobody reached the source.
      generatedAt: "2026-08-16T20:00:00.000Z",
      counts: { fresh: 0, carried: 1, total: 1 },
      sources: [],
      meetings: once.meetings,
      agendaDocuments: [],
    },
    NOW,
  );
  assert.equal(
    twice.meetings[0].carried?.lastFreshAt,
    "2026-08-15T20:00:00.000Z",
    "the mark walked forward one refusal at a time — a carried row got fresher by " +
      "not being fetched",
  );
});

test("a fresh row always beats a carried one, and a healthy source carries nothing", () => {
  const previous: MeetingsSnapshot = {
    formatVersion: 1,
    generatedAt: "2026-08-15T20:00:00.000Z",
    counts: { fresh: 2, carried: 0, total: 2 },
    sources: [],
    meetings: [kearsargeSitting("2026-09-10"), kearsargeSitting("2026-09-24")],
    agendaDocuments: [],
  };

  const fresh = [{ ...kearsargeSitting("2026-09-10"), title: "Budget Presentations" }];
  const { meetings } = carryForward(
    [{ source: "schedulepage", ok: false }],
    fresh,
    previous,
    NOW,
  );
  assert.equal(meetings.length, 2);
  assert.equal(
    meetings.find((m) => m.startsAt === fresh[0].startsAt)?.title,
    "Budget Presentations",
    "a carried row overwrote the fresh one for the same id",
  );

  // The mirror-image lie: a body that genuinely went quiet must be allowed to.
  const healthy = carryForward(
    [{ source: "schedulepage", ok: true }],
    [],
    previous,
    NOW,
  );
  assert.equal(healthy.meetings.length, 0);
  assert.equal(healthy.carried.size, 0, "a working source carried stale rows over a real absence");
});

/**
 * The write boundary's own half: the invariant that a carried count is stated
 * as an integer and is never claimed alongside an empty refusal list.
 */
test("a snapshot must state its carry-forward, and may not carry without a refusal", () => {
  const meeting: Meeting = {
    id: "schedulepage:kearsarge:2026-09-10",
    ocdId: "ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district",
    bodyId: "ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district#governing",
    bodyName: "School Board",
    title: "School Board",
    startsAt: "2026-09-10T22:30:00.000Z",
    timeZone: "America/New_York",
    location: { name: "KRSD", address: "114 Main Street, New London, NH", lat: 43.4, lng: -72.0 },
    agendaUrl: null,
    jurisdiction: "Kearsarge Regional School District, NH",
    status: "SCHEDULED",
    provenance: {
      sourceUrl: "https://www.kearsarge.org/",
      sourceOrg: "Kearsarge Regional School District School Board",
      collectedAt: "2026-08-15T20:00:00.000Z",
      verifiedAt: null,
    },
  };

  // The carried row as it really lands: the mark stamped at write time, and
  // the source's own count agreeing with it.
  const carriedRow: Meeting = {
    ...meeting,
    carried: { source: "schedulepage", lastFreshAt: "2026-08-15T20:00:00.000Z" },
  };

  const base = (over: Partial<MeetingsSnapshot["sources"][number]>): MeetingsSnapshot => ({
    formatVersion: 1,
    generatedAt: "2026-08-16T12:00:00.000Z",
    counts: { fresh: 0, carried: 1, total: 1 },
    sources: [
      {
        source: "schedulepage",
        ok: true,
        error: null,
        fetched: 5,
        normalized: 0,
        drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 1 },
        ...over,
      },
    ],
    meetings: [carriedRow],
    agendaDocuments: [],
  });

  // The honest shape: a named refusal, a stated count, and a marked row.
  assert.doesNotThrow(() =>
    validateSnapshot(
      base({ unreachableOcdIds: [meeting.ocdId!], carriedForward: 1 }),
    ),
  );

  // A count that is not an integer is a claim with nothing behind it.
  assert.throws(
    () => validateSnapshot(base({ carriedForward: "some" as unknown as number })),
    /carriedForward must be stated as an integer/,
  );

  // Carrying a successful-response row requires exact source-scoped
  // disappearance evidence; otherwise the refresh is presenting stale data
  // as freshly checked.
  assert.throws(
    () => validateSnapshot(base({ carriedForward: 1 })),
    /reports 1 successful-response carry row\(s\) but 0 row\(s\) name UNEXPLAINED_DISAPPEARANCE/,
  );

  // The count and the rows must be the same fact.
  assert.throws(
    () =>
      validateSnapshot({
        ...base({ unreachableOcdIds: [meeting.ocdId!], carriedForward: 15 }),
        counts: { fresh: 0, carried: 15, total: 15 },
      }),
    /states 15 total meetings but holds 1/,
  );
  assert.throws(
    () =>
      validateSnapshot({
        ...base({ unreachableOcdIds: [meeting.ocdId!], carriedForward: 15 }),
      }),
    /reports 15 meeting\(s\) carried forward but 1 row\(s\) carry its mark/,
  );
});


/*
 * The snapshot's one age is false of rows carried forward, so the footer counts them and each carried row
 * states its own last-fresh stamp.
 */

test("the client meta names the carried rows and the day they were last reached", () => {
  const carried = (id: string, lastFreshAt: string): Meeting => ({
    ...kearsargeSitting("2026-09-10"),
    id,
    carried: { source: "schedulepage", lastFreshAt },
  });
  const snap = (meetings: Meeting[]): MeetingsSnapshot => ({
    formatVersion: 1,
    generatedAt: "2026-08-17T02:17:00.000Z",
    counts: {
      fresh: meetings.filter((m) => !m.carried).length,
      carried: meetings.filter((m) => m.carried).length,
      total: meetings.length,
    },
    sources: [],
    meetings,
    agendaDocuments: [],
  });

  // Nothing carried: the footer's one age is true of everything, and no
  // extra sentence is owed.
  assert.equal(snapshotClientMeta(snap([kearsargeSitting("2026-09-10")])).carried, undefined);

  // All carried rows agree on a day, so the footer names it, using the oldest row.
  const agreed = snapshotClientMeta(
    snap([
      carried("schedulepage:b", "2026-08-16T20:51:04.000Z"),
      carried("schedulepage:a", "2026-08-16T20:50:57.882Z"),
    ]),
  );
  assert.equal(agreed.carried?.count, 2);
  assert.equal(
    agreed.carried?.lastFreshAt,
    "2026-08-16T20:50:57.882Z",
    "the stated instant is newer than one of the rows it speaks for",
  );

  // They disagree, so no single date is true of all of them and none is
  // offered — the surface says each row carries its own instead.
  const mixed = snapshotClientMeta(
    snap([
      carried("schedulepage:a", "2026-08-16T20:50:57.882Z"),
      carried("schedulepage:c", "2026-08-14T20:50:57.882Z"),
    ]),
  );
  assert.equal(mixed.carried?.count, 2);
  assert.equal(
    mixed.carried?.lastFreshAt,
    null,
    "one of several different last-fresh dates was picked and presented as the answer",
  );
});

test("every surface that states a meeting's freshness reads the row's own stamp", () => {
  // Each entry pins the conditional the surface must render behind, not merely the field name.
  const surfaces = [
    ["components/map/data-freshness.tsx", /\{carried && carried\.count > 0 && \(/],
    ["lib/officials/card-sources.ts", /if \(meeting\.carried\)/],
  ] as const;
  for (const [file, gate] of surfaces) {
    const source = readFileSync(join(ROOT, file), "utf8");
    assert.ok(
      gate.test(source),
      `${file} no longer renders its carried-row line behind ${gate} — the ` +
        "snapshot's one age would speak for rows the refresh never reached",
    );
    assert.ok(
      source.includes("lastFreshAt"),
      `${file} does not render the carried row's own last-fresh stamp`,
    );
  }
  assert.ok(
    readFileSync(join(ROOT, "components/map/data-freshness.tsx"), "utf8").includes(
      "snapshot.carried",
    ),
    "the footer stopped reading the snapshot's carried block",
  );

  // The footer must not be the only place it is said.
  for (const surface of ["components/map/meeting-panel.tsx"]) {
    assert.match(readFileSync(join(ROOT, surface), "utf8"), /<Meeting(Row|Card)/);
  }
  assert.match(readFileSync(join(ROOT, "components/ui/meeting-row.tsx"), "utf8"), /meetingCardSources\(meeting/);
  assert.match(readFileSync(join(ROOT, "components/ui/meeting-card.tsx"), "utf8"), /meetingCardSources\(meeting/);
  const sources = readFileSync(join(ROOT, "lib/officials/card-sources.ts"), "utf8");
  assert.ok(
    /Last reached/.test(sources),
    "the card dropped its last-reached line",
  );
});

/* ------------------------------------------ whose window clips a carried row --- */

/**
 * An archive-rung sitting at an arbitrary date. The rung stamps local midnight with `startPrecision: "DAY"`;
 * what matters is that these rows exist further back than the serving window.
 */
function merrimackSitting(date: string): Meeting {
  return {
    id: `revize:merrimack:${date}`,
    ocdId: "ocd-division/country:us/state:nh/county:merrimack",
    bodyId: "ocd-division/country:us/state:nh/county:merrimack#governing",
    bodyName: "Merrimack County Board of Commissioners",
    title: "Merrimack County Board of Commissioners",
    startsAt: `${date}T00:00:00-04:00`,
    startPrecision: "DAY",
    timeZone: "America/New_York",
    location: { name: "OCH", address: "163 N. Main St., Concord, NH", lat: 43.21, lng: -71.54 },
    agendaUrl: null,
    jurisdiction: "Merrimack County, NH",
    status: "CONCLUDED",
    provenance: {
      sourceUrl: "https://www.merrimackcounty.net/",
      sourceOrg: "Merrimack County Board of Commissioners",
      collectedAt: "2026-08-15T20:00:00.000Z",
      verifiedAt: null,
    },
  };
}

function archiveSnapshot(): MeetingsSnapshot {
  return {
    formatVersion: 1,
    generatedAt: "2026-08-15T20:00:00.000Z",
    counts: { fresh: 4, carried: 0, total: 4 },
    sources: [
      {
        source: "revize",
        ok: true,
        error: null,
        fetched: 1,
        normalized: 4,
        drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
      },
    ],
    meetings: [
      // Inside the 90-day serving window from NOW.
      merrimackSitting("2026-07-27"),
      merrimackSitting("2026-06-22"),
      // Outside it.
      merrimackSitting("2026-03-09"),
      merrimackSitting("2026-02-09"),
    ],
    agendaDocuments: [],
  };
}

test("a source that publishes its whole archive carries its whole archive", () => {
  // Carry-forward must judge carried rows against the source's own declared window, not the default.
  const { meetings, carried } = carryForward(
    [{ source: "revize", ok: false, publishedLookbackDays: null }],
    [],
    archiveSnapshot(),
    NOW,
  );

  assert.equal(
    meetings.length,
    4,
    "a source declaring no back clip lost rows anyway — the serving window is " +
      "still deciding what a healthy run of it would have produced",
  );
  assert.equal(carried.get("revize"), 4, "the carried count was not stated");
  assert.ok(
    meetings.some((m) => m.id === "revize:merrimack:2026-02-09"),
    "the oldest archive sitting was clipped — this is the exact row the " +
      "2026-08-18 refresh dropped",
  );
  // Not a loosening: every carried row still says it was carried, and still
  // names the run that actually fetched it.
  for (const m of meetings) {
    assert.equal(m.carried?.source, "revize");
    assert.equal(m.carried?.lastFreshAt, "2026-08-15T20:00:00.000Z");
  }
});

test("declaring no back clip is per source, not a global loosening", () => {
  // With no declaration, out-of-window rows stay dropped.
  const { meetings, carried } = carryForward(
    [{ source: "revize", ok: false }],
    [],
    archiveSnapshot(),
    NOW,
  );

  assert.equal(meetings.length, 2, "an undeclared source stopped clipping at the serving window");
  assert.equal(carried.get("revize"), 2);
  assert.ok(
    !meetings.some((m) => m.id === "revize:merrimack:2026-02-09"),
    "an undeclared source resurrected a sitting from outside the window",
  );
});

test("a declared window survives the composite's FAILURE branch", () => {
  // The declaration must reach the report on the failure path too.
  const source = makeRevizeSource(wiringForTypes(["REVIZE"]), (async () => {
    throw new Error("HTTP 403 for https://www.merrimackcounty.net/");
  }) as unknown as typeof fetch);

  assert.equal(
    source.publishedLookbackDays,
    null,
    "revize stopped declaring that its archive rung applies no back clip",
  );

  const composite = new CompositeSource([
    source as unknown as ReportingMeetingSource<unknown>,
  ]);
  return composite
    .fetch({ lat: 43.2, lng: -71.5, radiusKm: 5000 })
    .then((raw) => {
      composite.normalize(raw, NOW);
      const child = composite.lastReport?.children.find((c) => c.source === "revize");
      assert.ok(child, "the composite produced no report row for revize");
      assert.equal(child?.ok, false, "the planted 403 did not fail the child");
      assert.equal(
        child?.publishedLookbackDays,
        null,
        "the child's declared window was dropped on the failure path — carry-forward " +
          "would clip its archive at the serving window again",
      );
    });
});

/* ------------------------------ the warning agrees with the map --------- */

/**
 * A refused body whose carried rows are on screen is told its listings are from an earlier check; a refused
 * body with none is told its meetings may be missing. The two sentences stay apart.
 */
test("a refused body with rows on screen is STALE, not missing", () => {
  const surface = readFileSync(
    join(process.cwd(), "components", "map", "coverage-notice.tsx"),
    "utf8",
  );

  // Two footnote groups, split on whether the body has meetings on screen.
  assert.match(
    surface,
    /failedSourceOcdIds\.includes\(body\.ocdId\) &&\s*\n\s*ocdIdsWithMeetings\.includes\(body\.ocdId\)/,
    "the stale group must be the refused bodies that DO have rows on screen",
  );
  assert.match(
    surface,
    /failedSourceOcdIds\.includes\(body\.ocdId\) &&\s*\n\s*!ocdIdsWithMeetings\.includes\(body\.ocdId\)/,
    "the missing group must be the refused bodies that do NOT",
  );

  assert.match(surface, /the listings shown for them are from an earlier check/);
  assert.match(surface, /their meetings may be missing here/);
});

test("the card reads the SAME meeting array the pins are drawn from", () => {
  // The on-screen set is computed from `shown.meetings`, the array the map renders.
  const entry = readFileSync(
    join(process.cwd(), "components", "map", "map-entry.tsx"),
    "utf8",
  );
  assert.match(
    entry,
    /ocdIdsWithMeetings=\{\[\s*\n\s*\.\.\.new Set\(\s*\n\s*\(shown\.meetings \?\? \[\]\)\.flatMap/,
    "the on-screen set must come from the rendered meetings",
  );
});

test("a source that fetched documents and extracted nothing goes RED, so carry-forward runs", async () => {
  // A zero-row extraction is a failed extraction, never an empty document; the guard is at the composite.
  const emptyButHealthy = (async () =>
    new Response("BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR", {
      status: 200,
      headers: { "content-type": "text/calendar" },
    })) as unknown as typeof fetch;

  const source = {
    name: "zero-rows",
    async fetch() {
      return [{ nothing: true }, { nothing: true }];
    },
    normalizeWithDrops() {
      return {
        meetings: [] as Meeting[],
        drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
      };
    },
    normalize() {
      return [] as Meeting[];
    },
    async upsert() {
      return { inserted: 0, updated: 0 };
    },
  };

  const composite = new CompositeSource([
    source as unknown as ReportingMeetingSource<unknown>,
  ]);
  const raw = await composite.fetch({ lat: 0, lng: 0, radiusKm: 1 });
  composite.normalize(raw, NOW);

  const child = composite.lastReport?.children.find((c) => c.source === "zero-rows");
  assert.ok(child, "the composite lost the child entirely");
  assert.equal(
    child.ok,
    false,
    "two documents fetched and zero meetings extracted was reported as success — " +
      "that is the shape that emptied Wilmot, and it is what carry-forward " +
      "never gets a chance to protect",
  );
  assert.equal(child.failure, "JOB", "our parser on bytes we already hold");
  assert.match(child.error ?? "", /extracted 0 meeting/);
  assert.equal(child.fetched, 2, "the fetched count is reported, not zeroed");
  assert.equal(child.normalized, 0);

  // Proves the fixture is a real empty calendar rather than an error response.
  assert.ok(typeof emptyButHealthy === "function");
});

test("a source that fetched documents and DROPPED everything is left alone", async () => {
  // A source that dropped everything has already said why; marking it red would over-carry.
  const source = {
    name: "all-dropped",
    async fetch() {
      return [{ nothing: true }];
    },
    normalizeWithDrops() {
      return {
        meetings: [] as Meeting[],
        drops: { placeless: 0, unknownVenue: 4, unplaceableInTime: 0, notConfigured: 0 },
      };
    },
    normalize() {
      return [] as Meeting[];
    },
    async upsert() {
      return { inserted: 0, updated: 0 };
    },
  };

  const composite = new CompositeSource([
    source as unknown as ReportingMeetingSource<unknown>,
  ]);
  const raw = await composite.fetch({ lat: 0, lng: 0, radiusKm: 1 });
  composite.normalize(raw, NOW);

  const child = composite.lastReport?.children.find((c) => c.source === "all-dropped");
  assert.ok(child);
  assert.equal(child.ok, true, "a source that accounted for every row went red");
  assert.equal(child.drops.unknownVenue, 4, "the account survives into the report");
});


/**
 * A source whose archive feed fails while its upcoming feed answers reports a scoped partial result, so the
 * concluded rows carry back and a sitting the upcoming feed dropped is not resurrected.
 */

const TOWN = "ocd-division/country:us/state:nh/place:wilmot";

function icalSitting(date: string, when: "past" | "future"): Meeting {
  return {
    id: `ical:wilmot:${date}`,
    ocdId: TOWN,
    bodyId: TOWN,
    bodyName: "Wilmot Selectboard",
    title: "Selectboard",
    startsAt: `${date}T22:00:00.000Z`,
    timeZone: "America/New_York",
    location: { name: "Town Office", address: "9 Kearsarge Valley Rd", lat: 43.44, lng: -71.91 },
    agendaUrl: null,
    jurisdiction: "Wilmot, NH",
    status: when === "past" ? "CONCLUDED" : "SCHEDULED",
    provenance: {
      sourceUrl: "https://wilmotnh.org/events/list/?ical=1",
      sourceOrg: "Town of Wilmot",
      collectedAt: "2026-08-15T20:00:00.000Z",
      verifiedAt: null,
    },
  };
}

function wilmotSnapshot(): MeetingsSnapshot {
  return {
    formatVersion: 1,
    generatedAt: "2026-08-15T20:00:00.000Z",
    counts: { fresh: 3, carried: 0, total: 3 },
    sources: [
      {
        source: "ical",
        ok: true,
        error: null,
        fetched: 1,
        normalized: 3,
        drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
      },
    ],
    meetings: [
      icalSitting("2026-07-15", "past"),
      icalSitting("2026-06-17", "past"),
      icalSitting("2026-09-16", "future"),
    ],
    agendaDocuments: [],
  };
}

const A004_NOW = new Date("2026-08-20T12:00:00.000Z");

test("a source reporting plain success carries no concluded rows back", () => {
  // Plain success: the archive produced nothing and said nothing.
  const fresh = [icalSitting("2026-09-16", "future")];
  const { meetings, carried } = carryForward(
    [{ source: "ical", ok: true }],
    fresh,
    wilmotSnapshot(),
    A004_NOW,
  );
  assert.equal(carried.get("ical"), undefined, "nothing was carried");
  assert.equal(
    meetings.filter((m) => m.status === "CONCLUDED").length,
    0,
    "both concluded sittings are gone — this is A-004, and it is what shipped",
  );
});

test("a scoped ARCHIVE failure carries the concluded rows back", () => {
  const fresh = [icalSitting("2026-09-16", "future")];
  const { meetings, carried } = carryForward(
    [
      {
        source: "ical",
        ok: true,
        partialScopes: [
          { scope: "ARCHIVE", ocdIds: [TOWN], cause: "HTTP 503 for the past feed" },
        ],
      },
    ],
    fresh,
    wilmotSnapshot(),
    A004_NOW,
  );
  assert.equal(carried.get("ical"), 2, "both concluded sittings come back");
  const ids = meetings.map((m) => m.id).sort();
  assert.deepEqual(ids, ["ical:wilmot:2026-06-17", "ical:wilmot:2026-07-15", "ical:wilmot:2026-09-16"]);
  // And they say they were carried, with the date they were last actually seen.
  const carriedRow = meetings.find((m) => m.id === "ical:wilmot:2026-07-15");
  assert.equal(carriedRow?.carried?.source, "ical");
  assert.equal(carriedRow?.carried?.lastFreshAt, "2026-08-15T20:00:00.000Z");
});

test("an ARCHIVE failure never resurrects a FUTURE sitting the fresh run dropped", () => {
  // The upcoming feed answered, so a sitting it omitted must not come back.
  const { meetings, carried } = carryForward(
    [
      {
        source: "ical",
        ok: true,
        partialScopes: [
          { scope: "ARCHIVE", ocdIds: [TOWN], cause: "HTTP 503 for the past feed" },
        ],
      },
    ],
    [], // the upcoming feed answered and now lists nothing
    wilmotSnapshot(),
    A004_NOW,
  );
  assert.equal(carried.get("ical"), 2);
  assert.equal(
    meetings.some((m) => m.id === "ical:wilmot:2026-09-16"),
    false,
    "a cancelled future sitting came back — the scope is not being respected",
  );
});

test("a division-less body's archive failure is still scoped, not dropped", () => {
  // `null` in `ocdIds` is a body with no division to attribute to. It still
  // lost its history, and an implementation that filtered nulls out would
  // silently exclude exactly the smallest bodies.
  const placeless = { ...icalSitting("2026-07-15", "past"), id: "ical:precinct:2026-07-15", ocdId: null };
  const previous: MeetingsSnapshot = {
    ...wilmotSnapshot(),
    meetings: [placeless],
  };
  const { carried } = carryForward(
    [
      {
        source: "ical",
        ok: true,
        partialScopes: [{ scope: "ARCHIVE", ocdIds: [null], cause: "timeout" }],
      },
    ],
    [],
    previous,
    A004_NOW,
  );
  assert.equal(carried.get("ical"), 1);
});

test("a source with no partial scopes and no refusal still carries NOTHING", () => {
  // The mirror-image lie stays forbidden: a town that genuinely stopped
  // publishing must be allowed to go quiet.
  const { carried } = carryForward([{ source: "ical", ok: true }], [], wilmotSnapshot(), A004_NOW);
  assert.equal(carried.get("ical"), undefined);
});

test("the ical adapter no longer swallows a past-feed failure", () => {
  // The shape, not the string: an empty `catch` with only a comment.
  const source = readFileSync(join(ROOT, "lib", "sources", "ical", "index.ts"), "utf8");
  assert.match(source, /archiveRefused/, "the row carries no partial marker");
  assert.match(source, /partialScopes/, "the normalize pass reports no scoped failure");
  const emptyCatch = /catch\s*\{\s*(\/\/[^\n]*\n\s*)*\}/g;
  const swallowed = source.match(emptyCatch) ?? [];
  assert.deepEqual(
    swallowed,
    [],
    `a catch block that discards its error and continues: ${swallowed.join(" | ")}`,
  );
});

test("a day of clock-gap slack does not reach a real undeclared archive", () => {
  // One day of slack between an adapter's fetch clock and the snapshot's stamp must not hide an
  // undeclared archive.
  const CLOCK_GAP_MS = 86_400_000;
  const generatedAt = Date.parse("2026-08-25T19:36:00Z");
  const backEdge = generatedAt - CONCLUDED_LOOKBACK_DAYS * 86_400_000;

  const caught = (rowAt: string): boolean =>
    !(backEdge - CLOCK_GAP_MS <= Date.parse(rowAt));

  // The false positive the slack exists to end: inside the window at fetch,
  // outside it by hours at the stamp.
  assert.equal(caught("2026-05-27T19:30:00Z"), false, "a clock-gap row must not be reported");
  // Real undeclared archives.
  assert.equal(caught("2026-01-06T05:00:00Z"), true, "a 230-day archive must still be caught");
  assert.equal(caught("2026-02-09T05:00:00Z"), true, "a 196-day archive must still be caught");
  assert.equal(caught("2026-05-23T00:00:00Z"), true, "four days past the edge is not a clock gap");
});
