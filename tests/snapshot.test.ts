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
    sources: [sourceReport("stub")],
    meetings: [meetingOf("stub:1", "2026-09-01T19:00:00.000-07:00", "SCHEDULED")],
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
  const claimed = snap.sources.reduce((n, s) => n + s.normalized, 0);
  assert.equal(
    snap.meetings.length,
    claimed,
    `snapshot holds ${snap.meetings.length} meetings but sources claim ${claimed}`,
  );
});
