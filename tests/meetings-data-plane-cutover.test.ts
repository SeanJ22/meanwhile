import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "./helpers/playbooks.ts";

import { installFactReader } from "../lib/facts/db.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import {
  readMeetingsProjection,
  type MeetingsSnapshot,
} from "../lib/meetings/snapshot.ts";
import {
  candidateForMeetingPartition,
  promoteMeetingPartition,
  readPreviousMeetingPartition,
} from "../scripts/ingest.ts";
import { captureSourceAcquisitions, recordAcquiredResponse } from "../lib/sources/acquisition-trace.ts";
import { authorityFor } from "../lib/civic-data/source-authority.ts";
import type { Meeting } from "../lib/sources/types.ts";

installFactReader(null);

const GENERATED_AT = "2026-09-20T12:00:00.000Z";

const partition = MEETING_PARTITION_CONTRACTS.find((p) => p.id === "meetings:legistar:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fcounty%3Apima%23governing")!;
assert.ok(partition, "the registered Legistar county partition");

function sitting(suffix: string, startsAt: string): Meeting {
  return {
    id: `${partition.meetingSource}:pima:${suffix}`,
    ocdId: partition.ocdId,
    bodyId: partition.bodyId,
    bodyName: partition.wiring!.publishingOrg,
    title: `Regular Meeting ${suffix}`,
    startsAt,
    timeZone: partition.wiring!.timeZone,
    location: null,
    online: { label: "Zoom Webinar", joinUrl: null },
    agendaUrl: null,
    jurisdiction: partition.wiring!.jurisdiction,
    status: "SCHEDULED",
    provenance: { sourceUrl: "https://webapi.legistar.com/v1/pima/events", sourceOrg: partition.wiring!.publishingOrg, collectedAt: GENERATED_AT, verifiedAt: null },
  };
}

function fixturePartition(): MeetingsSnapshot {
  const meetings = [sitting("1", "2026-10-06T17:00:00.000Z"), sitting("2", "2026-10-20T17:00:00.000Z")];
  return {
    formatVersion: 1,
    generatedAt: GENERATED_AT,
    counts: { fresh: meetings.length, carried: 0, total: meetings.length },
    sources: [{
      source: partition.meetingSource,
      ok: true,
      error: null,
      fetched: meetings.length,
      normalized: meetings.length,
      drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
    }],
    meetings,
    agendaDocuments: [],
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

test("an unreachable store is reported as unreachable", async () => {
  const read = await readMeetingsProjection({
    store: {
      async readPromotion() {
        throw new Error("database unavailable");
      },
      async readCandidate() {
        throw new Error("must not be reached");
      },
    },
    now: GENERATED_AT,
    bypassCache: true,
  });
  assert.equal(read.kind, "STORE_UNREACHABLE");
  if (read.kind === "STORE_UNREACHABLE") assert.equal(read.code, "STORE_READ_FAILED");
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
  const promoted = await promoteMeetingPartition(store, partition, withAcquisitionEvidence(fixturePartition()));
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

test("meetings candidate proves its meeting door's obligations independently of row count", async () => {
  const evidenced = withAcquisitionEvidence(fixturePartition());
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
      check.consumer.startsWith("meeting door "),
    )?.passed,
    true,
  );

  const store = new MemoryRoutineDataStore();
  const promoted = await promoteMeetingPartition(store, partition, evidenced);
  assert.equal(promoted.outcome.candidate.state, "PROMOTED");
  assert.deepEqual(promoted.outcome.promoted?.payload, evidenced);

  const previous = await readPreviousMeetingPartition(store, partition);
  assert.ok(previous);

  const read = await readMeetingsProjection({
    store,
    now: GENERATED_AT,
    bypassCache: true,
  });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.kind === "PROMOTED" && read.partitions.some((row) => row.versionId === promoted.candidate.id), true);
});

test("meetings promotion fails closed without per-child bytes or on an untrusted child redirect", async () => {
  const partitionFixture = fixturePartition();
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
  assert.equal(refused.outcome.candidate.failureCode, "FINAL_ROUTE_NOT_REGISTERED");
  assert.match(refused.outcome.candidate.failureDetail ?? "", /outside .* registered publication routes/);

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

test("concurrent acquisition traces keep exact bytes, streamed hashes, and redirects attached to their source", async () => {
  const requestedUrl = "https://calendar.google.com/calendar/ical/test/basic.ics";
  const finalUrl = "https://calendar.google.com/calendar/ical/test/final.ics";
  const bytes = new Uint8Array([0x42, 0x45, 0x47, 0x49, 0x4e, 0x3a, 0x00, 0xff]);
  const rawHash = createHash("sha256").update(bytes).digest("hex");
  const captured = await captureSourceAcquisitions(async run => Promise.all([
    run("ical", async () => {
      await Promise.resolve();
      recordAcquiredResponse({ requestedUrl, finalUrl, httpStatus: 200, bytes });
      recordAcquiredResponse({ requestedUrl, finalUrl, httpStatus: 200, rawHash, byteCount: bytes.byteLength });
    }),
    run("civicplus", async () => {
      recordAcquiredResponse({ requestedUrl, finalUrl, httpStatus: 200, rawHash, byteCount: bytes.byteLength });
      await Promise.resolve();
    }),
  ]));
  assert.deepEqual(captured.evidence.toSorted((a, b) => a.source.localeCompare(b.source)), ["civicplus", "ical"].map(source => ({
    source, requestedUrl, finalUrl, httpStatus: 200, rawHash, byteCount: bytes.byteLength,
  })));
});

test("the live Pima Legistar/InSite schedule bridge is an exact registered authority route", () => {
  // The county's current page and the address it moved from.
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
  assert.match(ingest, /promoteSelectedMeetingPartitions/);
  assert.doesNotMatch(ingest, /promoteCompositeMeetingsSnapshot/);
  assert.doesNotMatch(ingest, /meetings-snapshot-write|writeMeetingsSnapshotStampStable/);
});

test("meeting ingest refuses runs without promotion or an exact source/body partition", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const args of [["composite"], ["composite", `--only-partition=${partition.id}`], ["composite", "--promote"]]) {
    const run = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/ingest.ts", ...args],
      { cwd: process.cwd(), env, encoding: "utf8", timeout: 30_000 });
    assert.ifError(run.error);
    assert.equal(run.status, 1);
    assert.match(run.stderr, args.includes("--promote") ? /MEETING_DEPENDENCY_BODY_REQUIRED/ : /Usage: pnpm ingest composite --promote --only-partition=/);
  }
});
