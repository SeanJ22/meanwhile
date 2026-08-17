import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  readSnapshot,
  validateSnapshot,
  writeSnapshot,
  type MeetingsSnapshot,
  type SnapshotSourceReport,
} from "../lib/meetings/snapshot.ts";
import { makeSnapshotSource } from "../lib/sources/snapshot/index.ts";
import type { Meeting, NormalizeDropCounts } from "../lib/sources/types.ts";

/**
 * The snapshot layer's guarantees: the count invariant at the write boundary,
 * write-then-read fidelity, status re-derivation on the read path, and the
 * committed file the production app actually serves.
 *
 * The count invariant is the standing rule made mechanism: an operation that
 * can return nothing must be asked what it returned. Four sightings of the
 * silent-success shape (empty RSS as HIT, zero-match join, scripted no-op
 * edit, NovusAgenda 200-with-zero recorded as HIT) are why a snapshot whose
 * sources do not state their counts is refused rather than written.
 */

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

/**
 * The shape the scheduled refresh actually produced, at the scale it produced
 * it: 193 rows fetched fresh across two sources and 24 carried forward for a
 * third whose host refused CI's egress. 193 + 24 = 217.
 *
 * This is the snapshot the old invariant refused with `217 !== 193`. It is
 * built here rather than described, so the repair is proven against the case
 * that broke rather than against a two-row miniature of it.
 */
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

test("write then read round-trips, and the reader validates what it reads", () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-snapshot-"));
  const snap = validSnapshot();
  const path = writeSnapshot(snap, root);
  assert.ok(existsSync(path), "write reported a path that does not exist");

  const read = readSnapshot(root);
  assert.ok(read, "read returned null for a file just written");
  assert.equal(read.generatedAt, snap.generatedAt);
  assert.equal(read.meetings.length, 1);
  assert.equal(read.sources.length, 1);
});

test("readSnapshot returns null when no file exists — a fresh clone, not an error", () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-empty-"));
  assert.equal(readSnapshot(root), null);
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

/*
 * ── The invariant, taught that carry-forward exists (hotfix-0817, 2026-08-17) ───────
 *
 * The scheduled refresh failed twice with `snapshot holds 217 meetings but
 * sources claim 193`. The refresh was right: 193 fresh, 24 carried forward for
 * `schedulepage` whose host refuses CI's egress. The ASSERTION was incomplete
 * — it predated carry-forward and compared the total against the fresh count.
 *
 * The repair states both numbers rather than loosening the comparison. Every
 * test below that asserts a pass is paired with one that plants the
 * corresponding breakage and asserts the refusal: a test written after a fix
 * and never seen fail proves nothing.
 */

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
  // The original assertion, preserved exactly. One source over-claims by one.
  snap.sources[0].normalized = 121;
  assert.throws(
    () => validateSnapshot(snap),
    /states 193 fresh meetings but sources claim 194/,
  );
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
  // A row quietly loses its mark: the count says 24, the rows say 23.
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

  // Present but not an instant is the same failure wearing a date's clothes.
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
  // The forbidden repair, mechanised: make `normalized` include the carried
  // rows so the sums match. It must still fail — the carried rows were not
  // fetched, and a source claiming it normalized them is the false claim the
  // whole gate exists to catch.
  const snap = partiallyRefusedSnapshot();
  snap.sources[2].normalized = 24;
  assert.throws(
    () => validateSnapshot(snap),
    /states 193 fresh meetings but sources claim 217/,
  );
});

test("a partially-refused snapshot survives write-then-read with its marks intact", () => {
  // The write boundary is where the job would have refused; this is the whole
  // path it takes — validate, write, read back, validate again — on the shape
  // that was failing.
  const root = mkdtempSync(join(tmpdir(), "wtp-carried-"));
  const path = writeSnapshot(partiallyRefusedSnapshot(), root);
  assert.ok(existsSync(path));

  const read = readSnapshot(root);
  assert.ok(read);
  assert.deepEqual(read.counts, { fresh: 193, carried: 24, total: 217 });
  const marks = read.meetings.filter((m) => m.carried);
  assert.equal(marks.length, 24, "the marks did not survive the round trip");
  assert.ok(
    marks.every((m) => m.carried?.source === "schedulepage" && m.carried.lastFreshAt),
    "a carried row came back without its origin or its last-fresh instant",
  );
});

test("the committed snapshot exists, validates, and states its counts", () => {
  // Production reads this exact file; a missing or invalid one is a broken
  // deploy. This is the guard that keeps a bad refresh from reaching main.
  const committed = join(process.cwd(), "data", "meetings-snapshot.json");
  assert.ok(
    existsSync(committed),
    "data/meetings-snapshot.json is missing — run `pnpm ingest composite`",
  );
  const parsed: unknown = JSON.parse(readFileSync(committed, "utf8"));
  validateSnapshot(parsed);

  const snap = parsed as MeetingsSnapshot;
  const okSources = snap.sources.filter((s) => s.ok);
  // The mechanism, not the data: at least one source succeeded (the validator
  // already requires this) and the accounting adds up against the meetings
  // actually present.
  assert.ok(okSources.length >= 1);

  // hotfix-0817: both numbers, and they reconcile — against each other, against the
  // per-source reports, and against the rows themselves. `validateSnapshot`
  // above already ran this; it is repeated here with the file's own numbers in
  // the message because THIS is the assertion the scheduled job fails on, and
  // a job that fails must print what it counted.
  const counts = snap.counts;
  const claimed = snap.sources.reduce((n, s) => n + s.normalized, 0);
  const marked = snap.meetings.filter((m) => m.carried).length;
  assert.equal(
    counts.fresh + counts.carried,
    snap.meetings.length,
    `snapshot holds ${snap.meetings.length} meetings but states ${counts.fresh} fresh + ${counts.carried} carried`,
  );
  assert.equal(
    counts.fresh,
    claimed,
    `snapshot states ${counts.fresh} fresh meetings but sources claim ${claimed}`,
  );
  assert.equal(
    counts.carried,
    marked,
    `snapshot states ${counts.carried} carried meetings but ${marked} rows carry the mark`,
  );
  for (const m of snap.meetings) {
    if (!m.carried) continue;
    assert.ok(
      Number.isFinite(Date.parse(m.carried.lastFreshAt)),
      `carried meeting ${m.id} states no instant at which it was last fresh`,
    );
  }
});
