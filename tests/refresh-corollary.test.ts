import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { wiringForTypes } from "../lib/registry/source-wiring.ts";
import { makeSchedulePageSource } from "../lib/sources/schedulepage/index.ts";
import { makeRevizeSource } from "../lib/sources/revize/index.ts";
import { CompositeSource } from "../lib/sources/composite/index.ts";
import { carryForward } from "../lib/meetings/carry-forward.ts";
import { CAPABILITIES } from "../lib/sources/composite/wiring.ts";
import { CONCLUDED_LOOKBACK_DAYS } from "../lib/meetings/constants.ts";
import {
  readSnapshot,
  snapshotClientMeta,
  validateSnapshot,
  type MeetingsSnapshot,
} from "../lib/meetings/snapshot.ts";
import type { Meeting, ReportingMeetingSource } from "../lib/sources/types.ts";

/**
 * **A failed fetch never silently empties a previously-full calendar.**
 * (g3, 2026-08-16 — the refresh corollary to the render-default rule.)
 *
 * ## The production failure this holds shut
 *
 * The truth session verified fifteen Kearsarge Regional School Board sittings
 * live at 03255, four bodies, twenty-six meetings. The next scheduled refresh
 * — running on a GitHub Actions runner, whose egress `kearsarge.org` refuses —
 * got HTTP 403, recorded `schedulepage: FAILED`, and committed a snapshot in
 * which every one of that source's meetings was gone. Production dropped to
 * ONE body and SEVEN meetings at that zip, and it stayed there.
 *
 * Two independent defects produced it, and both are tested here:
 *
 * 1. **One host's refusal emptied five bodies.** `schedulepage` serves
 *    Kearsarge, three Newbury land-use boards and Morris Hills Regional
 *    across three unrelated hosts, and its `fetch()` let the first failure
 *    throw out of the whole adapter. Morris Hills' board, whose own page
 *    answered 200 the entire time, disappeared from New Jersey because a New
 *    Hampshire school district's WAF did not like the runner.
 *
 * 2. **The refresh overwrote good data with an absence.** A source that could
 *    not be reached contributed nothing, and nothing is what the reader got —
 *    a gap of ours rendered as a fact about a school board that meets fifteen
 *    times a year.
 *
 * The render-default rule already forbids a component turning absence into an
 * assertion. This is that rule one layer down, at the pipeline.
 */

const NOW = new Date("2026-08-15T12:00:00-04:00");
const ROOT = process.cwd();

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/schedulepage/${name}`, import.meta.url), "utf8");

const rows = () => wiringForTypes(["SCHEDULEPAGE"]);

const KEARSARGE_OCD =
  "ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district";

/** One of the fifteen sittings the refresh deleted, as the snapshot held it. */
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

/**
 * A fetch that serves Morris Hills and refuses everything else — the exact
 * shape of the production outage, with the roles kept honest: one host
 * answers, the others 403.
 */
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

  // The whole point: the body whose own page answered still ships.
  assert.ok(
    meetings.some((m) => m.id.startsWith("schedulepage:mhrd:")),
    "Morris Hills' board produced no meetings even though its page answered — " +
      "a sibling body's 403 is emptying it again",
  );

  // And the refused bodies are NAMED, not silently absent.
  //
  // Per DIVISION, not per row: Newbury's Planning Board, Conservation
  // Commission and Zoning Board are three wiring rows on ONE division, and
  // reporting that division three times is the same duplication the
  // who-governs footnotes had to be de-duplicated for. The list is a set.
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

  // hotfix-0817: the count is only half of it. Every carried ROW says so itself, names
  // the source that refused, and states when it was last actually fetched —
  // otherwise the count cannot be recounted and no surface can tell a carried
  // row from a fresh one.
  for (const m of meetings) {
    assert.ok(m.carried, `carried row ${m.id} carries no mark`);
    assert.equal(m.carried?.source, "schedulepage");
    assert.equal(m.carried?.lastFreshAt, "2026-08-15T20:00:00.000Z");
  }
});

test("a row carried twice keeps naming the run that actually fetched it", () => {
  // The walking-timestamp failure: if the second refusal restamped the mark,
  // a row nobody has fetched in a week would claim to have been fresh at the
  // last failed run — a freshness manufactured by failing.
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

  // hotfix-0817: the count and the rows have to be the same fact. A source claiming a
  // carry that no row carries is the shape the original invariant could not
  // see — the number was recorded and nothing could recount it.
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
 * ── Item 2 (hotfix-0817, 2026-08-17): the reader is not told a freshness that is only
 * true of some rows ───────────────────────────────────────────────────────
 *
 * The map footer says "Last checked 6 hours ago". That is true of the
 * snapshot and false of the rows it carried forward, which may be days old.
 * A reader looking at a Kearsarge sitting had no way to know they were
 * looking at something we could not reach — a render default manufacturing a
 * claim, one layer up from the pipeline defect above.
 *
 * The fix is a truth fix and deliberately not a design treatment: the count
 * in the footer, the row's own last-fresh stamp on its card and in its popup,
 * in the same register those surfaces already speak. No badge, no colour, no
 * filtering, no reordering — how staleness should LOOK is the author's, and
 * it is a row in the next interface session.
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

  // All carried rows agree on a day, so the footer can name it — and it names
  // the OLDEST, never whichever row happens to come first. Production caught
  // this: 25 carried rows spread over the seconds one refresh took to walk a
  // source's pages, and the first version named row one's instant, which was
  // newer than rows two through twenty-five.
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
  // Source guards, in the pattern `tests/key-votes.test.ts` established: the
  // rule is law regardless of what a guard can reach, and these reach the
  // three places a freshness statement is rendered today.
  //
  // The guard pins the CONDITIONAL, not merely the words: a branch left in
  // the file but wired to something other than the row's own mark reads
  // identically to a working one when you grep for a field name, and that is
  // how a dead render survives a rename. Each entry is the gate the surface
  // must actually be rendering behind.
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

  // The footer must not be the only place it is said: a reader who opens a
  // card and never looks at the footer is the case that started this.
  for (const surface of ["components/map/meeting-panel.tsx", "components/map/popup/meeting-popup.tsx"]) {
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

/* ------------------------------------ g13: whose window clips a carried row --- */

/**
 * A revize sitting from the M59 archive rung, at an arbitrary date.
 *
 * The archive rung stamps local midnight and `startPrecision: "DAY"` because
 * the notices page publishes a date and no hour; what matters here is only
 * that these rows exist further back than the app's serving window, which is
 * exactly the condition that made the 2026-08-18 miss possible.
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
      // Inside the 90-day serving window from NOW (2026-08-15).
      merrimackSitting("2026-07-27"),
      merrimackSitting("2026-06-22"),
      // OUTSIDE it — the six rows the 2026-08-18 refresh silently dropped.
      merrimackSitting("2026-03-09"),
      merrimackSitting("2026-02-09"),
    ],
    agendaDocuments: [],
  };
}

test("g13: a source that publishes its whole archive carries its whole archive", () => {
  // 2026-08-18: revize took HTTP 403 at the CI runner's egress. Carry-forward
  // fired, and clipped the carried rows to CONCLUDED_LOOKBACK_DAYS — a window
  // revize's own archive rung has never applied. Eight of Merrimack County's
  // fourteen archive sittings carried and six vanished, so the refresh
  // corollary's own module committed a partial version of the emptying it
  // exists to prevent, and the M59 day-precision floor is what caught it.
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

test("g13: declaring no back clip is per source, not a global loosening", () => {
  // The same previous snapshot, the same failure, with the declaration absent
  // — which is every other adapter, all of which DO clip their own retrieval
  // to the serving window. Those two out-of-window rows must stay dropped, or
  // this change would have turned one source's honest archive into every
  // source's licence to resurrect history.
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

test("g13: a declared window survives the composite's FAILURE branch", () => {
  // The declaration is useless unless it reaches the report on the one path
  // that matters. A failed child is precisely the child carry-forward judges,
  // and an earlier draft of this change forwarded the field on success only —
  // which would have left the defect exactly where it was found.
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

/* ------------------- F01 7.2: the warning agrees with the map --------- */

/**
 * **F01 7.2 (2026-08-19, the author).**
 *
 * *"In the New Hampshire Who Governs Here card there are two messages:
 * Kearsarge Regional School District, Newbury town — I couldn't reach their
 * calendar source at the last check, so their meetings may be missing here.
 * However if I click the maroon dot up in New London there ARE meetings for
 * Kearsarge, so something's not right."*
 *
 * Diagnosed before fixing, and neither surface was lying — they were answering
 * different questions. Carry-forward exists so a refused source does not empty
 * a previously-full surface; the pins stayed and each carried row states its
 * own age. The WARNING never learned that had happened, so it said "may be
 * missing" about rows the reader could see and click.
 *
 * The fix is that the card is told what the map is showing. These guards hold
 * the two sentences apart, because collapsing them back into one is exactly
 * how the contradiction returns.
 */
test("F01 7.2: a refused body with rows on screen is STALE, not missing", () => {
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

  // And they must say different things. A body whose pins are on the map is
  // told its listings are from an earlier check (2026-09-14: plain, no
  // "couldn't reach"); a body with none is told its meetings may be missing.
  assert.match(surface, /the listings shown for them are from an earlier check/);
  assert.match(surface, /their meetings may be missing here/);
});

test("F01 7.2: the card reads the SAME meeting array the pins are drawn from", () => {
  // A second derivation is how two surfaces come to disagree. The on-screen
  // set is computed from `shown.meetings` — the array the map renders — and
  // not re-queried or re-filtered somewhere else.
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

/* ---- F22: the archive declaration is owed by every adapter that has one --- */

/**
 * **F22 (2026-08-20). The g13 defect, found on a second adapter.**
 *
 * `carryForward` judges a walled source's rows against that source's own
 * `publishedLookbackDays`, defaulting to `CONCLUDED_LOOKBACK_DAYS`. That
 * default is right for every adapter that clips its own retrieval to the
 * serving window, and wrong for every adapter with an archive rung that does
 * not. revize declared it on 2026-08-18; civicplus, whose M59 AgendaCenter
 * rung shipped three days EARLIER, did not — so when civicplus timed out on
 * 2026-08-20 the carry-forward that exists to stop a wall emptying a calendar
 * dropped 23 of Rockaway Township's 32 archived sittings.
 *
 * Two adapters is a class. The guard is derived rather than listed, because a
 * hand-kept list of archive sources is the same shape of thing that failed:
 * it asks the COMMITTED SNAPSHOT which sources actually emit rows past the
 * default back edge, and holds each of those to a declaration that reaches
 * its own oldest row. A third adapter that grows an archive rung fails here
 * on the first refresh that commits one, naming itself and its oldest row —
 * it cannot join quietly.
 */
test("F22: every source whose rows outrun the serving window declares its own", () => {
  const snapshot = readSnapshot(ROOT);
  assert.ok(snapshot, "no committed snapshot to check");

  const declared = new Map<string, number | null | undefined>();
  for (const capability of CAPABILITIES) {
    const rows = wiringForTypes(capability.types);
    if (rows.length === 0) continue;
    declared.set(capability.name, capability.make(rows).publishedLookbackDays);
  }

  const generatedAt = Date.parse(snapshot.generatedAt);
  assert.ok(Number.isFinite(generatedAt), "the snapshot has no readable generatedAt");
  const defaultBackEdge = generatedAt - CONCLUDED_LOOKBACK_DAYS * 86_400_000;

  // Oldest row per source, off the snapshot itself — the denominator is
  // stated so a source that legitimately holds nothing old reads as a zero
  // rather than as a source that was skipped.
  const oldest = new Map<string, number>();
  for (const meeting of snapshot.meetings) {
    const source = meeting.id.split(":")[0];
    const at = Date.parse(meeting.startsAt);
    if (!Number.isFinite(at)) continue;
    oldest.set(source, Math.min(oldest.get(source) ?? Infinity, at));
  }

  const beyond = [...oldest].filter(([, at]) => at < defaultBackEdge).sort();
  console.log(
    `\n  ${beyond.length} of ${oldest.size} source(s) emit rows older than the ` +
      `${CONCLUDED_LOOKBACK_DAYS}-day serving window: ` +
      (beyond.map(([s, at]) => `${s} -> ${new Date(at).toISOString().slice(0, 10)}`).join(", ") ||
        "none") +
      "\n",
  );

  /*
   * TWO CLOCKS, ONE EDGE — measured 2026-08-25, and it made the daily refresh
   * red on a source that had declared itself perfectly correctly.
   *
   * An adapter computes its back edge at FETCH time. This guard computes one
   * from the snapshot's `generatedAt`, which is stamped AFTER every source has
   * been read — minutes later on a small corpus, and longer as the corpus
   * grows. A row admitted at 89.99 days is 90.01 days old by the time the
   * snapshot is written, and the guard then reports it as an archive nobody
   * declared. It was declared; it was measured against a different instant.
   *
   * That is not hypothetical and it is not rare. In the committed snapshot
   * FIVE of eleven sources sit inside a day and a half of the edge —
   * apptegy 88.50d, clerksboards 88.61d, iqm2 88.54d, legistar 89.46d,
   * diligent and ical 89.50d — because the publishers all keep about a
   * quarter's history and the adapters all clip to the same 90. Which one
   * trips is decided by what time of day the refresh ran.
   *
   * So the tolerance is the GAP BETWEEN THE TWO CLOCKS and nothing else. It
   * is one day, it is asserted below to stay one day, and it is deliberately
   * far too small to hide a real undeclared archive — `civicplus` at 230 days
   * and `revize` at 196 are the shape this guard exists to catch, and a day of
   * slack does not reach them.
   */
  const CLOCK_GAP_MS = 86_400_000;
  assert.ok(
    CLOCK_GAP_MS <= 86_400_000,
    "the fetch-to-stamp tolerance may never grow past a day — past that it stops being a clock gap and starts being a hole",
  );

  const undeclared: string[] = [];
  for (const [source, at] of beyond) {
    if (!declared.has(source)) continue; // a snapshot may name a source this build no longer has
    const window = declared.get(source);
    if (window === null) continue; // no back clip at all — the archive is whole
    const days = window ?? CONCLUDED_LOOKBACK_DAYS;
    if (generatedAt - days * 86_400_000 - CLOCK_GAP_MS <= at) continue;
    undeclared.push(
      `${source} (oldest row ${new Date(at).toISOString().slice(0, 10)}, ` +
        `declared window ${days}d)`,
    );
  }

  assert.deepEqual(
    undeclared,
    [],
    "these adapters emit an archive past the serving window without declaring it — " +
      "carry-forward will clip it away the first time the source is walled. Declare " +
      "publishedLookbackDays on the adapter (null means the publisher's whole archive).",
  );
});

test("a source that fetched documents and extracted nothing goes RED, so carry-forward runs", async () => {
  /*
   * **THE SIXTH SIGHTING, CAUGHT LIVE** (Prompt E close-out walk, 2026-08-20).
   *
   * The scheduled refresh at 02:00Z reported the `ical` source as
   * `ok: true, fetched: 3, normalized: 0` with every drop counter at zero.
   * Three documents in hand, not one event out of them, and no drop to say
   * why. Because the source said it had succeeded, carry-forward did not run,
   * and Wilmot NH went from 23 meetings to none on a reader's page at 03255.
   * The feed was healthy when fetched by hand minutes later: HTTP 200, 20
   * events, categories intact.
   *
   * `CLAUDE.md`: a zero-row extraction is a FAILED extraction, never an empty
   * document. The guard is at the COMPOSITE, not in the adapter it was found
   * in, because all eleven children pass through that one line and only `ical`
   * had any notion of a refusal of its own.
   */
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

  // Unused, but it proves the fixture above is a REAL empty calendar rather
  // than an error response — the case this guard deliberately also catches.
  assert.ok(typeof emptyButHealthy === "function");
});

test("a source that fetched documents and DROPPED everything is left alone", async () => {
  /*
   * The narrow edge of the guard above, asserted so it stays narrow. A source
   * that extracted nothing because it dropped everything has already said WHY
   * — the drop counters are the account — and marking it red would carry
   * forward rows on top of a source that is working and honest.
   */
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

/* ======================================================================== *
 *  A-004 · A PARTIAL SOURCE IS A FIRST-CLASS RESULT
 * ======================================================================== */

/**
 * **AN ARCHIVE OUTAGE USED TO DELETE A TOWN'S HISTORY, SILENTLY.**
 *
 * External correctness audit of `336a3eb`, remediated 2026-08-24. `ical`
 * fetches two feeds per body — the upcoming list and, where a town publishes
 * one, the past-events feed. The past feed's failure was caught by an EMPTY
 * `catch` whose comment read: *"this row still produces its upcoming sittings,
 * and the archive's absence is visible as a jurisdiction with no concluded
 * meetings."*
 *
 * That sentence is the render-default failure written down as a design note.
 * The chain it produced:
 *
 *   archive refuses → adapter returns success → composite reports `ok: true`
 *   → carry-forward preserves rows only for a source or division that FAILED
 *   → every concluded meeting the previous snapshot held is deleted.
 *
 * The first assertion here is the reproduction: with the old two-state report
 * — success or failure, nothing between — the concluded rows vanish. The rest
 * hold the scoped result that fixes it, including the direction it must NOT
 * over-carry: the upcoming feed answered, so a sitting the town cancelled
 * today may not be resurrected by an archive outage.
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

test("A-004 · REPRODUCTION: a source reporting plain success carries no concluded rows back", () => {
  // The old report shape. The upcoming feed produced its one future sitting;
  // the archive produced nothing and said nothing.
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

test("A-004 · a scoped ARCHIVE failure carries the concluded rows back", () => {
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

test("A-004 · an ARCHIVE failure never resurrects a FUTURE sitting the fresh run dropped", () => {
  /*
   * The direction that makes this a scope rather than a blunt division
   * refusal. The upcoming feed answered perfectly. If the town cancelled its
   * 16 September sitting between snapshots, the fresh run correctly omits it —
   * and an archive outage must not put it back.
   */
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

test("A-004 · a division-less body's archive failure is still scoped, not dropped", () => {
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

test("A-004 · a source with no partial scopes and no refusal still carries NOTHING", () => {
  // The mirror-image lie stays forbidden: a town that genuinely stopped
  // publishing must be allowed to go quiet.
  const { carried } = carryForward([{ source: "ical", ok: true }], [], wilmotSnapshot(), A004_NOW);
  assert.equal(carried.get("ical"), undefined);
});

test("A-004 · the ical adapter no longer swallows a past-feed failure", () => {
  // RULING 110: the shape, not the string. A `catch` with nothing in it but a
  // comment is the shape, and it is what shipped.
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

test("F22: a day of clock-gap slack does not reach a real undeclared archive", () => {
  /*
   * The guard above allows one day between the adapter's fetch clock and the
   * snapshot's stamp. This proves that slack cannot swallow the thing the
   * guard is for. `civicplus` (230 days past the window) and `revize` (196)
   * are the real shape; both declare `publishedLookbackDays: null` and pass
   * for the RIGHT reason — they say they carry the whole archive.
   *
   * A source with the same rows and NO declaration must still be caught, and
   * a day of tolerance must not change that by even a little.
   */
  const CLOCK_GAP_MS = 86_400_000;
  const generatedAt = Date.parse("2026-08-25T19:36:00Z");
  const backEdge = generatedAt - CONCLUDED_LOOKBACK_DAYS * 86_400_000;

  const caught = (rowAt: string): boolean =>
    !(backEdge - CLOCK_GAP_MS <= Date.parse(rowAt));

  // The false positive the slack exists to end: inside the window at fetch,
  // outside it by hours at the stamp.
  assert.equal(caught("2026-05-27T19:30:00Z"), false, "a clock-gap row must not be reported");
  // The real thing, at both of the sizes actually measured in the snapshot.
  assert.equal(caught("2026-01-06T05:00:00Z"), true, "a 230-day archive must still be caught");
  assert.equal(caught("2026-02-09T05:00:00Z"), true, "a 196-day archive must still be caught");
  // And the slack is genuinely a day, not a week wearing a day's name.
  assert.equal(caught("2026-05-23T00:00:00Z"), true, "four days past the edge is not a clock gap");
});
