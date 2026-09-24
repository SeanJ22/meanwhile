import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { PDC_V2_POST_IMPORT_MEETING_PARTITIONS } from "../lib/holdings/reader-execution-authority.ts";
import {
  readMeetingsProjection,
  readSnapshot,
  type MeetingsSnapshot,
} from "../lib/meetings/snapshot.ts";
import {
  candidateForMeetingPartition,
  meetingsWiringCoverage,
  promoteMeetingPartition,
  readPreviousMeetingPartition,
} from "../scripts/ingest.ts";
import { captureSourceAcquisitions } from "../lib/sources/acquisition-trace.ts";
import { readValidatedResponse } from "../lib/sources/http.ts";
import { authorityFor } from "../lib/civic-data/source-authority.ts";

const loadedFixture = readSnapshot();
assert.ok(loadedFixture, "the explicit meetings bootstrap fixture must exist");
const fixture: MeetingsSnapshot = loadedFixture;

const partition = MEETING_PARTITION_CONTRACTS.find((candidate) =>
  fixture.meetings.some((meeting) =>
    meeting.bodyId === candidate.bodyId && meeting.id.startsWith(`${candidate.meetingSource}:`),
  ),
)!;
assert.ok(partition, "the fixture must contain at least one registered source/body partition");

function fixturePartition(snapshot: MeetingsSnapshot): MeetingsSnapshot {
  const meetings = snapshot.meetings.filter((meeting) =>
    meeting.bodyId === partition.bodyId && meeting.id.startsWith(`${partition.meetingSource}:`),
  );
  const ids = new Set(meetings.map((meeting) => meeting.id));
  const source = snapshot.sources.find((row) => row.source === partition.meetingSource);
  assert.ok(source);
  return {
    formatVersion: 1,
    generatedAt: snapshot.generatedAt,
    counts: { fresh: meetings.length, carried: 0, total: meetings.length },
    sources: [{
      ...source,
      ok: true,
      error: null,
      fetched: meetings.length,
      normalized: meetings.length,
      drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
    }],
    meetings,
    agendaDocuments: snapshot.agendaDocuments.filter((document) => ids.has(document.meetingId)),
  };
}

function withAcquisitionEvidence(snapshot: MeetingsSnapshot): MeetingsSnapshot {
  return {
    ...snapshot,
    sources: snapshot.sources.map((source, index) => source.ok ? {
      ...source,
      acquisitions: [{
        source: source.source,
        requestedUrl: index === 0
          ? "https://webapi.legistar.com/v1/pima/events"
          : `https://calendar.google.com/calendar/ical/${source.source}/basic.ics`,
        finalUrl: index === 0
          ? "https://webapi.legistar.com/v1/pima/events"
          : `https://calendar.google.com/calendar/ical/${source.source}/basic.ics`,
        httpStatus: 200,
        rawHash: createHash("sha256").update(`exact ${source.source} response bytes`).digest("hex"),
        byteCount: Buffer.byteLength(`exact ${source.source} response bytes`),
      }],
    } : source),
  };
}

test("meetings bootstrap is selected only after an answered absent pointer", async () => {
  const read = await readMeetingsProjection({
    store: new MemoryRoutineDataStore(),
    now: fixture.generatedAt,
    bypassCache: true,
  });
  assert.equal(read.kind, "BOOTSTRAP");
  assert.equal(read.metadata.versionId?.startsWith("bootstrap:MEETING:source-wiring-partitions:"), true);
  assert.equal(read.value, fixture);
});

test("an unreachable store never masquerades as the bundled fixture", async () => {
  const read = await readMeetingsProjection({
    store: {
      async readPromotion() {
        throw new Error("database unavailable");
      },
      async readCandidate() {
        throw new Error("must not be reached");
      },
    },
    now: fixture.generatedAt,
    bypassCache: true,
  });
  assert.equal(read.kind, "STORE_UNREACHABLE");
  if (read.kind === "STORE_UNREACHABLE") assert.equal(read.code, "STORE_READ_FAILED");
});

test("production refuses the meetings fixture even when a caller requests it", async () => {
  const mutableEnv = process.env as unknown as Record<string, string | undefined>;
  const previous = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "production";
  try {
    const read = await readMeetingsProjection({
      store: new MemoryRoutineDataStore(),
      now: fixture.generatedAt,
      bypassCache: true,
      allowUnconfiguredBootstrap: true,
    });
    assert.equal(read.kind, "NOT_RECORDED");
  } finally {
    if (previous === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous;
  }
});

test("promotion carry-forward reads canonical first and does not fallback on DB error", async () => {
  const store = new MemoryRoutineDataStore();
  store.readPromotion = async () => {
    throw new Error("database unavailable");
  };
  await assert.rejects(
    readPreviousMeetingPartition(store, partition),
    /Reading canonical pointer .* failed/,
  );
});

test("one partition carry-forward opens only its own pointer and ignores an unreachable sibling", async () => {
  const store = new MemoryRoutineDataStore();
  const promoted = await promoteMeetingPartition(store, partition, withAcquisitionEvidence(fixturePartition(fixture)));
  assert.equal(promoted.outcome.candidate.state, "PROMOTED");
  const sibling = MEETING_PARTITION_CONTRACTS.find((candidate) => candidate.id !== partition.id)!;
  const originalReadPromotion = store.readPromotion.bind(store);
  const openedScopes: string[] = [];
  store.readPromotion = async (recordClass, scope) => {
    openedScopes.push(`${recordClass}:${scope}`);
    if (scope === sibling.scope) throw new Error("sibling store partition is corrupt");
    return originalReadPromotion(recordClass, scope);
  };

  const previous = await readPreviousMeetingPartition(store, partition);
  assert.ok(previous);
  assert.deepEqual(openedScopes, [`MEETING:${partition.scope}`]);
  assert.deepEqual(previous, promoted.outcome.promoted?.payload);
});

test("meetings candidate proves SOURCE_WIRING obligations independently of row count", async () => {
  const coverage = meetingsWiringCoverage(fixture);
  /*
   * The bootstrap fixture was frozen at the permanent data-plane cutover
   * (generatedAt 2026-09-06). A route wired after it cannot be represented in
   * it, so each such row is NAMED here rather than the check widened: Pima
   * Community College moved from its robots-disallowed Diligent tenant to its
   * own pima.edu pages on 2026-09-23 (RETIRED_MEETING_ROUTES), and the fixture
   * still holds its sittings under the retired `diligent` route.
   */
  const WIRED_AFTER_FIXTURE = ["curated:az/pima-community-college#governing:PIMA_EDU"];
  // The bundled fixture is frozen at the PDC v2 import: the only other
  // obligations it may leave unaccounted are rows whose partitions were
  // registered after it, each named in PDC_V2_POST_IMPORT_MEETING_PARTITIONS.
  // Coverage represents a wiring row by its source name, so a post-import
  // partition on a source the fixture already holds (C9's two Newbury schedule
  // pages, on `schedulepage`) is represented; only a route on a source the
  // fixture never held is missing.
  const fixtureSources = new Set(fixture.sources.map((source) => source.source));
  const postImport = MEETING_PARTITION_CONTRACTS.filter((p) =>
    PDC_V2_POST_IMPORT_MEETING_PARTITIONS.includes(p.id) && !fixtureSources.has(p.meetingSource));
  const expectedMissing = [
    ...WIRED_AFTER_FIXTURE,
    ...postImport.map((p) => `${p.bodyId}:${p.wiring.agendaSourceType}`),
  ];
  assert.deepEqual([...coverage.missing].sort(), [...expectedMissing].sort());
  assert.equal(coverage.accounted, coverage.denominator - expectedMissing.length);
  assert.equal(coverage.denominator > 0, true);
  assert.equal(coverage.denominator === fixture.meetings.length, false);

  const evidenced = withAcquisitionEvidence(fixturePartition(fixture));
  const candidate = candidateForMeetingPartition(partition, evidenced);
  assert.equal(candidate.retrieval.requestedUrl, "https://webapi.legistar.com/v1/pima/events");
  assert.equal(candidate.retrieval.finalUrl, "https://webapi.legistar.com/v1/pima/events");
  assert.equal(partition.acquisitionAdapter.authorityMode, "REGISTERED_SOURCE_ROUTES");
  assert.equal(Object.hasOwn(partition.acquisitionAdapter, "requestedUrl"), false);
  assert.equal(candidate.horizon.kind, "OPEN_FACT_SET");
  assert.equal(candidate.horizon.declaredTotal, null);
  assert.match(candidate.horizon.query, new RegExp(partition.meetingSource));
  assert.equal(
    candidate.dependentChecks.find((check) =>
      check.consumer.includes("SOURCE_WIRING"),
    )?.passed,
    true,
  );

  const before = readFileSync("data/meetings-snapshot.json", "utf8");
  const store = new MemoryRoutineDataStore();
  const promoted = await promoteMeetingPartition(store, partition, evidenced);
  assert.equal(promoted.outcome.candidate.state, "PROMOTED");
  assert.deepEqual(promoted.outcome.promoted?.payload, evidenced);
  assert.equal(readFileSync("data/meetings-snapshot.json", "utf8"), before);

  const previous = await readPreviousMeetingPartition(store, partition);
  assert.ok(previous);

  const read = await readMeetingsProjection({
    store,
    now: fixture.generatedAt,
    bypassCache: true,
  });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.kind === "PROMOTED" && read.partitions.some((row) => row.versionId === promoted.candidate.id), true);
});

test("meetings promotion fails closed without per-child bytes or on an untrusted child redirect", async () => {
  const partitionFixture = fixturePartition(fixture);
  const missing = await promoteMeetingPartition(new MemoryRoutineDataStore(), partition, partitionFixture);
  assert.equal(missing.outcome.promoted, null);
  assert.equal(missing.outcome.candidate.failureCode, "SOURCE_RETRIEVAL_FAILED");
  assert.match(missing.outcome.candidate.failureDetail ?? "", /authenticated exact-byte evidence/);

  const evidenced = withAcquisitionEvidence(partitionFixture);
  const secondSuccessfulIndex = 0;
  const redirected = {
    ...evidenced,
    sources: evidenced.sources.map((source, index) => index === secondSuccessfulIndex ? {
      ...source,
      acquisitions: source.acquisitions?.map((row) => ({ ...row, finalUrl: "https://example.invalid/stolen-response" })),
    } : source),
  };
  const refused = await promoteMeetingPartition(new MemoryRoutineDataStore(), partition, redirected);
  assert.equal(refused.outcome.promoted, null);
  assert.equal(refused.outcome.candidate.failureCode, "FINAL_HOST_NOT_AUTHORIZED");
  assert.match(refused.outcome.candidate.failureDetail ?? "", /does not inherit authority/);

  const first = candidateForMeetingPartition(partition, evidenced);
  const changedBytes = {
    ...evidenced,
    sources: evidenced.sources.map((source, index) => index === 0 ? {
      ...source,
      acquisitions: source.acquisitions?.map((row) => ({ ...row, rawHash: "f".repeat(64) })),
    } : source),
  };
  const second = candidateForMeetingPartition(partition, changedBytes);
  assert.notEqual(first.retrieval.rawHash, second.retrieval.rawHash);
  assert.notEqual(first.id, second.id);
});

test("meetings acquisition tracing hashes exact response bytes and retains the observed redirect", async () => {
  const priorFetch = globalThis.fetch;
  const requestedUrl = "https://calendar.google.com/calendar/ical/test/basic.ics";
  const finalUrl = "https://calendar.google.com/calendar/ical/test/final.ics";
  const body = new Uint8Array([0x42, 0x45, 0x47, 0x49, 0x4e, 0x3a, 0x00, 0xff]);
  globalThis.fetch = (async () => {
    const response = new Response(body, { status: 200, headers: { "content-type": "text/calendar" } });
    Object.defineProperty(response, "url", { value: finalUrl });
    return response;
  }) as typeof fetch;
  try {
    const captured = await captureSourceAcquisitions(async (runForSource) =>
      runForSource("ical", async () => {
        const response = await fetch(requestedUrl);
        return response.arrayBuffer();
      }),
    );
    assert.equal(captured.evidence.length, 1);
    assert.deepEqual(captured.evidence[0], {
      source: "ical",
      requestedUrl,
      finalUrl,
      httpStatus: 200,
      rawHash: createHash("sha256").update(body).digest("hex"),
      byteCount: body.byteLength,
    });
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test("validated curl-rung bytes retain curl's effective redirect URL", async () => {
  const requestedUrl = "https://www.newbury.nh.gov/calendar/export.ics";
  const finalUrl = "https://www.newbury.nh.gov/calendar/current/export.ics";
  const bytes = new TextEncoder().encode("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
  const captured = await captureSourceAcquisitions(async (runForSource) =>
    runForSource("ical", async () => readValidatedResponse(
      requestedUrl,
      4,
      {
        status: 200,
        contentType: "text/calendar",
        text: new TextDecoder().decode(bytes),
        bytes,
        finalUrl,
      },
      { label: "iCalendar", marker: "BEGIN:VCALENDAR" },
    )),
  );
  assert.deepEqual(captured.evidence[0], {
    source: "ical",
    requestedUrl,
    finalUrl,
    httpStatus: 200,
    rawHash: createHash("sha256").update(bytes).digest("hex"),
    byteCount: bytes.byteLength,
  });
});

test("the live Pima Legistar/InSite schedule bridge is an exact registered authority route", () => {
  // The county's current page (C18, 2026-09-24) and the /2559/ address it moved from.
  const route = "https://www.pima.gov/board-of-supervisors-meeting-schedule";
  assert.equal(authorityFor("meetings-public-bodies", "MEETING", route).ok, true);
  assert.equal(authorityFor("meetings-public-bodies", "MEETING", "https://www.pima.gov/2559/Board-of-Supervisors-Meeting-Schedule").ok, true);
  assert.equal(
    authorityFor("meetings-public-bodies", "MEETING", "https://www.pima.gov/unregistered-page").ok,
    false,
  );
});

test("all assigned runtime consumers use the promoted meetings projection", () => {
  for (const path of [
    "lib/sources/snapshot/index.ts",
    "app/api/meetings/route.ts",
    "app/api/agenda/route.ts",
    "app/api/ask/agenda/route.ts",
    "app/api/ask/grounded/route.ts",
    "lib/ask/meeting-knowledge.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /\bimport\s*\{[^}]*\breadSnapshot\b/);
  }
  const ingest = readFileSync("scripts/ingest.ts", "utf8");
  assert.match(ingest, /RCD_MEETING_PARTITION_RECEIPT=/);
  assert.doesNotMatch(ingest, /scope:\s*["']supported-bodies["']/);
  assert.match(ingest, /name === "composite" && !promote/);
  assert.match(ingest, /promoteSelectedMeetingPartitions/);
  assert.doesNotMatch(ingest, /promoteCompositeMeetingsSnapshot/);
  assert.doesNotMatch(ingest, /meetings-snapshot-write|writeMeetingsSnapshotStampStable/);
});

test("production-capable composite ingest has no non-promotion file door", () => {
  const before = readFileSync("data/meetings-snapshot.json", "utf8");
  const run = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/ingest.ts", "composite"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(run.status, 1);
  assert.match(run.stderr, /requires --promote/);
  assert.equal(readFileSync("data/meetings-snapshot.json", "utf8"), before);
});
