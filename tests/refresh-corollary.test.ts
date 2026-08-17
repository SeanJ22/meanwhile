import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { wiringForTypes } from "../lib/registry/source-wiring.ts";
import { makeSchedulePageSource } from "../lib/sources/schedulepage/index.ts";
import { CompositeSource } from "../lib/sources/composite/index.ts";
import { carryForward } from "../lib/meetings/carry-forward.ts";
import {
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

  // Carrying rows forward while reporting nothing unreachable is a refresh
  // presenting stale data as freshly checked.
  assert.throws(
    () => validateSnapshot(base({ carriedForward: 1 })),
    /while reporting nothing unreachable/,
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

  // All carried rows agree on a day, so the footer can name it.
  const agreed = snapshotClientMeta(
    snap([
      carried("schedulepage:a", "2026-08-16T20:50:57.882Z"),
      carried("schedulepage:b", "2026-08-16T20:51:04.000Z"),
    ]),
  );
  assert.equal(agreed.carried?.count, 2);
  assert.equal(agreed.carried?.lastFreshAt, "2026-08-16T20:50:57.882Z");

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
    ["components/map/meeting-panel.tsx", /\{meeting\.carried && \(/],
    ["components/map/popup/meeting-popup.tsx", /\{meeting\.carried && \(/],
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
  const panel = readFileSync(join(ROOT, "components/map/meeting-panel.tsx"), "utf8");
  assert.ok(
    /Last reached/.test(panel),
    "the card dropped its last-reached line",
  );
});
