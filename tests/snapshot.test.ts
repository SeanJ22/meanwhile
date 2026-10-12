import assert from "node:assert/strict";
import { test } from "node:test";

import {
  reconcileCounts,
  snapshotCounts,
  validateSnapshot,
  type MeetingsSnapshot,
  type SnapshotSourceReport,
} from "../lib/meetings/snapshot.ts";
import { makeSnapshotSource } from "../lib/sources/snapshot/index.ts";
import type { Meeting, NormalizeDropCounts } from "../lib/sources/types.ts";

const ZERO: NormalizeDropCounts = {
  placeless: 0,
  unknownVenue: 0,
  unplaceableInTime: 0,
  notConfigured: 0,
};

function meetingOf(id: string, startsAt: string, status: Meeting["status"]): Meeting {
  return {
    id,
    ocdId: "ocd-division/country:us/state:az/county:pima",
    bodyId: "ocd-division/country:us/state:az/county:pima#governing",
    bodyName: "Stub Board",
    title: "Stub Meeting",
    startsAt,
    timeZone: "America/Phoenix",
    location: { name: "Stub Hall", address: null, lat: 32.2, lng: -110.9 },
    agendaUrl: null,
    jurisdiction: "Stub, AZ",
    status,
    provenance: {
      sourceUrl: null,
      sourceOrg: "Stub",
      collectedAt: "2026-08-13T00:00:00Z",
      verifiedAt: null,
    },
  };
}

function sourceReport(
  source: string,
  overrides: Partial<SnapshotSourceReport> = {},
): SnapshotSourceReport {
  return {
    source,
    ok: true,
    error: null,
    fetched: 1,
    normalized: 1,
    drops: { ...ZERO },
    ...overrides,
  };
}

function validSnapshot(): MeetingsSnapshot {
  return {
    formatVersion: 1,
    generatedAt: "2026-08-13T12:00:00.000Z",
    counts: { fresh: 1, carried: 0, total: 1 },
    sources: [sourceReport("stub")],
    meetings: [meetingOf("stub:1", "2026-09-01T19:00:00.000-07:00", "SCHEDULED")],
    agendaDocuments: [],
  };
}

function partiallyRefusedSnapshot(): MeetingsSnapshot {
  const meetings: Meeting[] = [];
  for (let i = 0; i < 120; i += 1) {
    meetings.push(meetingOf(`civicplus:${i}`, "2026-09-01T19:00:00.000-07:00", "SCHEDULED"));
  }
  for (let i = 0; i < 73; i += 1) {
    meetings.push(meetingOf(`legistar:${i}`, "2026-09-02T19:00:00.000-07:00", "SCHEDULED"));
  }
  for (let i = 0; i < 24; i += 1) {
    meetings.push({
      ...meetingOf(`schedulepage:${i}`, "2026-09-03T19:00:00.000-07:00", "SCHEDULED"),
      carried: { source: "schedulepage", lastFreshAt: "2026-08-16T20:50:57.882Z" },
    });
  }
  return {
    formatVersion: 1,
    generatedAt: "2026-08-17T02:17:00.000Z",
    counts: { fresh: 193, carried: 24, total: 217 },
    sources: [
      sourceReport("civicplus", { fetched: 6, normalized: 120 }),
      sourceReport("legistar", { fetched: 15, normalized: 73 }),
      sourceReport("schedulepage", {
        fetched: 5,
        normalized: 0,
        unreachableOcdIds: [
          "ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district",
        ],
        carriedForward: 24,
      }),
    ],
    meetings,
    agendaDocuments: [],
  };
}

test("a valid snapshot validates", () => {
  validateSnapshot(validSnapshot());
});

test("a snapshot accounting for no sources is refused", () => {
  const snap = { ...validSnapshot(), sources: [], meetings: [] };
  assert.throws(() => validateSnapshot(snap), /at least one source/);
});

test("a snapshot where every source failed is refused — keep the previous one", () => {
  const snap = {
    ...validSnapshot(),
    sources: [sourceReport("stub", { ok: false, error: "portal down", normalized: 0 })],
    meetings: [],
  };
  assert.throws(() => validateSnapshot(snap), /every source failed/);
});

test("a source that does not state its counts is refused", () => {
  const snap = validSnapshot();
  (snap.sources[0] as unknown as { fetched: unknown }).fetched = undefined;
  assert.throws(() => validateSnapshot(snap), /counts must be stated/);
});

test("a source that does not state a drop count is refused", () => {
  const snap = validSnapshot();
  (snap.sources[0].drops as unknown as { placeless: unknown }).placeless = undefined;
  assert.throws(() => validateSnapshot(snap), /drop count/);
});

test("a failed source must say why", () => {
  const snap = validSnapshot();
  snap.sources.push(sourceReport("other", { ok: false, error: null, normalized: 0 }));
  assert.throws(() => validateSnapshot(snap), /must state why/);
});

test("a meeting not namespaced under an accounted source is refused", () => {
  const snap = validSnapshot();
  snap.meetings.push(meetingOf("rogue:1", "2026-09-01T19:00:00.000-07:00", "SCHEDULED"));
  assert.throws(() => validateSnapshot(snap), /not namespaced/);
});

test("an agenda document citing a meeting outside the snapshot is refused", () => {
  const snap = validSnapshot();
  snap.agendaDocuments.push({
    id: "stub:gone@abc",
    meetingId: "stub:gone",
    ocdId: "ocd-division/country:us/state:az/county:pima",
    documentUrl: "https://example.gov/agenda.pdf",
    contentHash: "abc",
    retrievedAt: "2026-08-13T00:00:00Z",
    contentType: "application/pdf",
    text: null,
    extraction: "failed",
    extractionNote: "stub",
    sourceUrl: "https://example.gov/agenda.pdf",
    sourceOrg: "Stub",
    collectedAt: "2026-08-13T00:00:00Z",
    verifiedAt: null,
  });
  assert.throws(() => validateSnapshot(snap), /not in the snapshot/);
});

test("the snapshot source re-derives status from now; CANCELED survives", async () => {
  const now = new Date("2026-08-13T12:00:00Z");
  const snap = validSnapshot();
  snap.sources[0].normalized = 3;
  snap.meetings = [
    // Frozen as SCHEDULED, but its date has passed — must render CONCLUDED.
    meetingOf("stub:past", "2026-08-10T19:00:00.000-07:00", "SCHEDULED"),
    // Still ahead — stays SCHEDULED.
    meetingOf("stub:future", "2026-09-01T19:00:00.000-07:00", "SCHEDULED"),
    // The body called it off; the clock has no say.
    meetingOf("stub:called-off", "2026-09-02T19:00:00.000-07:00", "CANCELED"),
  ];

  const source = makeSnapshotSource({ load: () => snap });
  const raw = await source.fetch({ lat: 32.2, lng: -110.9, radiusKm: 150 });
  const meetings = source.normalize(raw, now);

  const byId = new Map(meetings.map((m) => [m.id, m.status]));
  assert.equal(byId.get("stub:past"), "CONCLUDED");
  assert.equal(byId.get("stub:future"), "SCHEDULED");
  assert.equal(byId.get("stub:called-off"), "CANCELED");
});

test("the snapshot source refuses to serve when no snapshot exists", async () => {
  const source = makeSnapshotSource({ load: () => null });
  await assert.rejects(
    source.fetch({ lat: 32.2, lng: -110.9, radiusKm: 150 }),
    /no meetings snapshot found/,
  );
});

test("193 fresh + 24 carried = 217 validates — the run the old invariant refused", () => {
  const snap = partiallyRefusedSnapshot();
  assert.equal(snap.meetings.length, 217);
  assert.equal(
    snap.sources.reduce((n, s) => n + s.normalized, 0),
    193,
    "the fixture stopped being the case that broke",
  );
  assert.doesNotThrow(() => validateSnapshot(snap));
});

test("the fresh count still has to equal the per-source claims — unchanged, aimed right", () => {
  const snap = partiallyRefusedSnapshot();
  snap.sources[0].normalized = 121;
  assert.throws(
    () => validateSnapshot(snap),
    /states 193 fresh meetings plus 0 collapsed but sources claim 194/,
  );
});

test("the collapse count is what makes fresh and the per-source claims close", () => {
  const snap = partiallyRefusedSnapshot();
  snap.sources[0].normalized += 1;
  snap.counts.duplicatesCollapsed = 1;
  assert.doesNotThrow(() => validateSnapshot(snap));

  snap.counts.duplicatesCollapsed = 4;
  assert.throws(
    () => validateSnapshot(snap),
    /plus 4 collapsed but sources claim/,
  );

  snap.counts.duplicatesCollapsed = -1;
  assert.throws(() => validateSnapshot(snap), /non-integer duplicatesCollapsed/);
});

test("fresh + carried must close against the total", () => {
  const snap = partiallyRefusedSnapshot();
  snap.counts = { fresh: 193, carried: 23, total: 217 };
  assert.throws(() => validateSnapshot(snap), /counts do not close/);
});

test("the stated total must be the number of rows actually present", () => {
  const snap = partiallyRefusedSnapshot();
  snap.meetings.pop();
  assert.throws(() => validateSnapshot(snap), /states 217 total meetings but holds 216/);
});

test("the carried count must equal the rows carrying the mark", () => {
  const snap = partiallyRefusedSnapshot();
  delete snap.meetings[snap.meetings.length - 1].carried;
  assert.throws(
    () => validateSnapshot(snap),
    /states 24 carried meetings but 23 row\(s\) carry the mark/,
  );
});

test("a carried row with no last-fresh timestamp is refused", () => {
  const snap = partiallyRefusedSnapshot();
  const row = snap.meetings[snap.meetings.length - 1];
  row.carried = { source: "schedulepage" } as unknown as typeof row.carried;
  assert.throws(
    () => validateSnapshot(snap),
    /does not state a parseable instant at which it was last fresh/,
  );

  row.carried = { source: "schedulepage", lastFreshAt: "recently" };
  assert.throws(
    () => validateSnapshot(snap),
    /does not state a parseable instant at which it was last fresh/,
  );
});

test("a carried row that does not name its source is refused", () => {
  const snap = partiallyRefusedSnapshot();
  const row = snap.meetings[snap.meetings.length - 1];
  row.carried = { source: "", lastFreshAt: "2026-08-16T20:50:57.882Z" };
  assert.throws(() => validateSnapshot(snap), /does not name the source it came from/);

  row.carried = { source: "granicus", lastFreshAt: "2026-08-16T20:50:57.882Z" };
  assert.throws(() => validateSnapshot(snap), /which this snapshot does not account for/);
});

test("a snapshot that states no counts at all is refused", () => {
  const snap = validSnapshot();
  delete (snap as { counts?: unknown }).counts;
  assert.throws(() => validateSnapshot(snap), /must state its counts/);
});

test("the invariant cannot be satisfied by inflating the per-source claims", () => {
  const snap = partiallyRefusedSnapshot();
  snap.sources[2].normalized = 24;
  assert.throws(
    () => validateSnapshot(snap),
    /states 193 fresh meetings plus 0 collapsed but sources claim 217/,
  );
});

test("1b: snapshotCounts reads total off the rows it is given, never a longer array", () => {
  const rows = [
    meetingOf("a", "2026-09-01T18:00:00.000Z", "SCHEDULED"),
    meetingOf("b", "2026-09-02T18:00:00.000Z", "SCHEDULED"),
    meetingOf("c", "2026-09-03T18:00:00.000Z", "SCHEDULED"),
  ];
  const counts = snapshotCounts(rows, 6);
  assert.equal(counts.total, rows.length, "total is the row count, always");
  assert.equal(counts.fresh + counts.carried, counts.total, "the counts close");
  assert.equal(counts.duplicatesCollapsed, 6, "the merge's own number is stated, not absorbed");
});

test("1b: carried rows are counted off their marks, not off a subtraction", () => {
  const fresh = meetingOf("fresh-1", "2026-09-01T18:00:00.000Z", "SCHEDULED");
  const carriedRow: Meeting = {
    ...meetingOf("carried-1", "2026-09-02T18:00:00.000Z", "SCHEDULED"),
    carried: { source: "schedulepage", lastFreshAt: "2026-08-21T07:11:25.917Z" },
  };
  const counts = snapshotCounts([fresh, carriedRow], 0);
  assert.equal(counts.carried, 1);
  assert.equal(counts.fresh, 1);
  assert.equal(counts.total, 2);
});

test("1b: #43's exact shape — a post-carry collapse can no longer strand the total", () => {
  const survivors = Array.from({ length: 455 }, (_, i) =>
    meetingOf(`m${i}`, "2026-09-01T18:00:00.000Z", "SCHEDULED"),
  );
  const preCollapse = [
    ...survivors,
    ...Array.from({ length: 6 }, (_, i) =>
      meetingOf(`dupe${i}`, "2026-09-01T18:00:00.000Z", "SCHEDULED"),
    ),
  ];
  assert.equal(preCollapse.length, 461, "the fixture reproduces #43's two numbers");

  const counts = snapshotCounts(survivors, 6);
  assert.equal(counts.total, 455);
  assert.notEqual(counts.total, preCollapse.length);

  const snap: MeetingsSnapshot = {
    formatVersion: 1,
    generatedAt: "2026-08-22T18:51:01.000Z",
    counts,
    sources: [
      {
        source: "composite",
        ok: true,
        fetched: 139,
        normalized: counts.fresh + (counts.duplicatesCollapsed ?? 0),
        drops: ZERO,
      } as SnapshotSourceReport,
    ],
    meetings: survivors,
    agendaDocuments: [],
  };
  assert.doesNotThrow(() => reconcileCounts(snap));
});

test("1b: the refusal that caught #43 is untouched — a stranded total still refuses", () => {
  const survivors = [
    meetingOf("a", "2026-09-01T18:00:00.000Z", "SCHEDULED"),
    meetingOf("b", "2026-09-02T18:00:00.000Z", "SCHEDULED"),
  ];
  const snap: MeetingsSnapshot = {
    formatVersion: 1,
    generatedAt: "2026-08-22T18:51:01.000Z",
    counts: { fresh: 2, carried: 0, duplicatesCollapsed: 1, total: 3 },
    sources: [
      { source: "composite", ok: true, fetched: 3, normalized: 3, drops: ZERO } as SnapshotSourceReport,
    ],
    meetings: survivors,
    agendaDocuments: [],
  };
  assert.throws(() => reconcileCounts(snap), /states 3 total meetings but holds 2/);
});
