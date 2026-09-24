import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { clearPromotedReadModelCache } from "../lib/civic-data/read-model.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { CandidateVersionRecord, RoutineRecordClass } from "../lib/civic-data/types.ts";
import { readMeetingsProjection, type MeetingsProjectionReadResult } from "../lib/meetings/snapshot.ts";
import { readPreparedMeetingsProjection, MEETINGS_PREPARED_SCOPE } from "../lib/meetings/prepared-snapshot.ts";
import {
  activeReaderProofMeetingPin,
  parseReaderProofMeetingPin,
  READER_PROOF_HARNESS_ENV,
  READER_PROOF_MEETING_PIN_ENV,
  readerProofMeetingPinAdmission,
  readerProofMeetingPinFromReadback,
  readerProofMeetingPinSha256,
  type ReaderProofMeetingPin,
} from "../lib/meetings/proof-pin.ts";
import type { Meeting } from "../lib/sources/types.ts";
import type { ChildRunReport } from "../lib/sources/composite/index.ts";
import { promoteMeetingPartitions } from "../scripts/ingest.ts";

/**
 * The Reader proof's meeting pin (lib/meetings/proof-pin.ts).
 *
 * The defect: `scripts/reader-last-mile-render.mts` read the meetings
 * projection at its start and later compared a Newbury listing group, provenance
 * `collectedAt` included, against the proof server's `/api/agenda`. The standing
 * runner promoted a routine version of that partition in between. The two
 * reads then disagreed, and every 03255 case failed with
 * `collectedAt: '2026-09-23T23:10:55.145Z'` against `'2026-09-23T21:24:14.713Z'`.
 * These tests replay that with an in-memory store whose pointer moves between
 * the two reads.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAPTURED = "2026-09-23T21:24:14.713Z";
const PROMOTED_MID_RUN = "2026-09-23T23:10:55.145Z";
const LATER = "2026-09-23T23:30:00.000Z";

const legistar = MEETING_PARTITION_CONTRACTS.find((partition) => partition.meetingSource === "legistar")!;
const insite = MEETING_PARTITION_CONTRACTS.find((partition) =>
  partition.meetingSource === "legistar-insite" && partition.bodyId.includes("place:mesa"),
)!;

function urlFor(source: string): string {
  return source === "legistar" ? "https://webapi.legistar.com/v1/pima/events" : "https://mesa.legistar.com/Calendar.aspx";
}

function meeting(partition: typeof legistar, collectedAt: string, suffix: string): Meeting {
  return {
    id: `${partition.meetingSource}:${suffix}`,
    ocdId: partition.ocdId,
    bodyId: partition.bodyId,
    bodyName: partition.wiring.config.insiteBodyName ?? partition.wiring.publishingOrg,
    title: `${partition.wiring.jurisdiction} meeting ${suffix}`,
    startsAt: "2026-10-20T17:00:00.000Z",
    timeZone: partition.wiring.timeZone,
    location: null,
    agendaUrl: null,
    jurisdiction: partition.wiring.jurisdiction,
    status: "SCHEDULED",
    provenance: { sourceUrl: urlFor(partition.meetingSource), sourceOrg: partition.wiring.publishingOrg, collectedAt, verifiedAt: null },
  };
}

function report(source: string, version: string, ok = true): ChildRunReport {
  const bytes = `${source}:${version}`;
  return {
    source,
    ok,
    error: ok ? null : `${source} timed out`,
    ...(ok ? {} : { failure: "WALL" as const }),
    fetched: ok ? 1 : 0,
    normalized: ok ? 1 : 0,
    drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
    ...(ok ? {
      acquisitions: [{
        source,
        requestedUrl: urlFor(source),
        finalUrl: urlFor(source),
        httpStatus: 200,
        rawHash: createHash("sha256").update(bytes).digest("hex"),
        byteCount: Buffer.byteLength(bytes),
      }],
    } : {}),
  };
}

async function promoteVersion(store: MemoryRoutineDataStore, collectedAt: string): Promise<string> {
  const [result] = await promoteMeetingPartitions({
    store,
    partitions: [legistar],
    meetings: [meeting(legistar, collectedAt, "newbury-shaped-sitting")],
    agendaDocuments: [],
    reports: [report(legistar.meetingSource, collectedAt)],
    generatedAt: collectedAt,
  });
  assert.equal(result?.outcome.candidate.state, "PROMOTED");
  return result!.candidate.id;
}

/** Counts reads of the event log, which only an exact-version re-read performs. */
class EventCountingStore extends MemoryRoutineDataStore {
  eventReads = 0;

  override async events(candidateId: string) {
    this.eventReads += 1;
    return super.events(candidateId);
  }
}

/** Seed V1, capture the pin exactly as the orchestrator's capture does (strict, unpinned). */
async function seededRun(): Promise<{ store: EventCountingStore; v1: string; pin: ReaderProofMeetingPin }> {
  clearPromotedReadModelCache();
  const store = new EventCountingStore();
  const v1 = await promoteVersion(store, CAPTURED);
  const capture = await readMeetingsProjection({ store, bypassCache: true, allowUnconfiguredBootstrap: false, now: CAPTURED });
  assert.equal(capture.kind, "PROMOTED");
  if (capture.kind !== "PROMOTED") throw new Error("unreachable");
  return { store, v1, pin: readerProofMeetingPinFromReadback(capture.partitions, CAPTURED) };
}

function writePin(pin: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), "reader-proof-meeting-pin-")), "pin.json");
  writeFileSync(path, JSON.stringify(pin));
  return path;
}

async function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const harnessEnv = (path: string) => ({ [READER_PROOF_MEETING_PIN_ENV]: path, [READER_PROOF_HARNESS_ENV]: "docs/evidence/reader-last-mile-production-authority.json" });

function sitting(read: MeetingsProjectionReadResult): Meeting {
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") throw new Error("unreachable");
  const row = read.value.meetings.find(({ id }) => id === "legistar:newbury-shaped-sitting");
  assert.ok(row, "the held sitting is served");
  return row;
}

function partitionVersion(read: MeetingsProjectionReadResult): string | null {
  return read.kind === "PROMOTED" ? read.partitions.find(({ contractId }) => contractId === legistar.id)?.versionId ?? null : null;
}

/** The render's comparison: the listing it read at start must equal what the server serves later. */
function harnessComparison(renderStart: MeetingsProjectionReadResult, serverLater: MeetingsProjectionReadResult): void {
  assert.deepEqual(sitting(serverLater), sitting(renderStart));
}

test("a mid-run promotion splits the unpinned harness's two reads, and the pin holds both on the captured version", async () => {
  const { store, v1, pin } = await seededRun();
  const read = (now: string, bypassCache: boolean) =>
    readMeetingsProjection({ store, bypassCache, allowUnconfiguredBootstrap: false, now });

  // OLD harness: no pin. The render reads at its start, the runner promotes, the server reads.
  const renderStart = await read(CAPTURED, true);
  // The long-lived server also served V1 while it was current (this proves V1 in its memo).
  const serverAtStart = await read(CAPTURED, false);
  harnessComparison(renderStart, serverAtStart);
  const v2 = await promoteVersion(store, PROMOTED_MID_RUN);
  assert.notEqual(v2, v1);
  assert.equal((await store.readPromotion("MEETING", legistar.scope))?.versionId, v2, "the pointer moved mid-run");
  const serverLater = await read(LATER, false);
  assert.equal(partitionVersion(serverLater), v2);
  assert.throws(() => harnessComparison(renderStart, serverLater), (error: Error) =>
    error.name === "AssertionError" && error.message.includes(PROMOTED_MID_RUN) && error.message.includes(CAPTURED),
  "the unpinned harness fails on exactly the recorded collectedAt split");

  // NEW harness: the same moved pointer, read under the pin captured before the move.
  const path = writePin(pin);
  await withEnv(harnessEnv(path), async () => {
    assert.equal(activeReaderProofMeetingPin()?.partitionsSha256, pin.partitionsSha256);
    // The server process: V1 was proven against its REAL pointer while current.
    const eventReadsBefore = store.eventReads;
    const pinnedServerMemo = await read(LATER, false);
    assert.equal(store.eventReads, eventReadsBefore, "the server serves V1 as its real pointer was proven, without a re-read");
    // A server or render that never saw V1 current: V1 is re-read by id and re-proven.
    clearPromotedReadModelCache();
    const pinnedServerCold = await read(LATER, false);
    assert.ok(store.eventReads > eventReadsBefore, "a cold process re-reads V1 by id and dates it from the event log");
    const pinnedRender = await read(CAPTURED, true);
    const pinnedServerBypass = await read(LATER, true);
    assert.equal(pinnedServerMemo.kind, "PROMOTED");
    assert.equal(pinnedServerCold.kind, "PROMOTED");
    if (pinnedServerMemo.kind === "PROMOTED" && pinnedServerCold.kind === "PROMOTED") {
      assert.deepEqual(pinnedServerCold.value, pinnedServerMemo.value, "the version re-read by id serves exactly what its real pointer served");
      assert.equal(pinnedServerCold.metadata.promotedAt, pinnedServerMemo.metadata.promotedAt, "the event log dates the promotion exactly as the pointer did");
    }
    for (const pinned of [pinnedRender, pinnedServerMemo, pinnedServerCold, pinnedServerBypass]) {
      assert.equal(partitionVersion(pinned), v1, "every pinned read resolves the partition to the captured version");
      harnessComparison(renderStart, pinned);
      assert.equal(sitting(pinned).provenance.collectedAt, CAPTURED);
      assert.match(pinned.kind === "PROMOTED" ? pinned.detail : "", new RegExp(`Reader proof meeting pin ${pin.partitionsSha256.slice(0, 12)}`));
    }
    harnessComparison(pinnedRender, pinnedServerCold);
  });

  // With the switch absent, the same read is live again: the pin is scoped to the harness run.
  clearPromotedReadModelCache();
  assert.equal(partitionVersion(await read(LATER, true)), v2);
});

test("a pinned version proven once serves the proof run's later requests without being re-read", async () => {
  // A proof run asks for the meetings on every Ask request; each one re-read
  // every moved partition's candidate and event log (about 2,000 whole
  // candidate reads in four minutes on 2026-09-24). A pinned version is
  // immutable, so it is proven once per process.
  const { store, v1, pin } = await seededRun();
  await promoteVersion(store, PROMOTED_MID_RUN);
  const read = (bypassCache: boolean) => readMeetingsProjection({ store, bypassCache, allowUnconfiguredBootstrap: false, now: LATER });
  await withEnv(harnessEnv(writePin(pin)), async () => {
    clearPromotedReadModelCache();
    const first = await read(false);
    const afterFirst = store.eventReads;
    assert.ok(afterFirst > 0, "the first pinned read re-reads the captured version by id");
    const second = await read(false);
    const third = await read(false);
    assert.equal(store.eventReads, afterFirst, "later pinned reads serve the proven version without re-reading it");
    for (const pinned of [first, second, third]) assert.equal(partitionVersion(pinned), v1);
    assert.deepEqual(sitting(third), sitting(first));
    await read(true);
    assert.ok(store.eventReads > afterFirst, "a verification read still re-reads and re-proves");
  });
});

test("the pinned read still refuses an unverified version: never promoted, or tampered after promotion", async () => {
  const { store, v1, pin } = await seededRun();
  // A candidate that the runner refused and that the pointer never named.
  const [blocked] = await promoteMeetingPartitions({
    store,
    partitions: [legistar],
    meetings: [],
    agendaDocuments: [],
    reports: [report(legistar.meetingSource, PROMOTED_MID_RUN, false)],
    generatedAt: PROMOTED_MID_RUN,
  });
  assert.notEqual(blocked?.outcome.candidate.state, "PROMOTED");
  const rows = pin.partitions.map((row) => row.contractId === legistar.id ? { ...row, versionId: blocked!.candidate.id } : row);
  const unpromotedPin = { ...pin, partitions: rows, partitionsSha256: readerProofMeetingPinSha256(rows) };
  await withEnv(harnessEnv(writePin(unpromotedPin)), async () => {
    clearPromotedReadModelCache();
    const read = await readMeetingsProjection({ store, bypassCache: true, allowUnconfiguredBootstrap: false, now: LATER });
    const partition = read.kind === "PROMOTED" ? read.partitions.find(({ contractId }) => contractId === legistar.id) : null;
    const refused = read.kind === "PROMOTED" ? partition : read;
    assert.equal(refused?.kind, "STORE_UNREACHABLE", "a never-promoted version is not served under a pin");
    assert.match(refused?.detail ?? "", /promotion proof|atomic promotions|PROMOTED row/);
  });

  // The captured version itself, with its immutable read model altered after promotion.
  await promoteVersion(store, PROMOTED_MID_RUN);
  const tampering = {
    readPromotion: store.readPromotion.bind(store),
    readPromotions: store.readPromotions.bind(store),
    events: store.events.bind(store),
    async readCandidate(id: string) {
      const row = await store.readCandidate(id);
      return id === v1 && row ? tamper(row) : row;
    },
    async readCandidates(ids: readonly string[]) {
      return (await store.readCandidates(ids)).map((row) => row.candidateId === v1 ? { ...row, record: tamper(row.record) } : row);
    },
  };
  await withEnv(harnessEnv(writePin(pin)), async () => {
    clearPromotedReadModelCache();
    const read = await readMeetingsProjection({ store: tampering, bypassCache: true, allowUnconfiguredBootstrap: false, now: LATER });
    const partition = read.kind === "PROMOTED" ? read.partitions.find(({ contractId }) => contractId === legistar.id) : null;
    const refused = read.kind === "PROMOTED" ? partition : read;
    assert.equal(refused?.kind, "STORE_UNREACHABLE", "a tampered pinned version is refused, not served");
    assert.match(refused?.detail ?? "", /does not match its durable normalized hash/);
  });
});

function tamper(row: CandidateVersionRecord): CandidateVersionRecord {
  const readModel = structuredClone(row.candidate.readModel) as { meetings: Meeting[] };
  readModel.meetings[0]!.provenance.collectedAt = PROMOTED_MID_RUN;
  return { ...row, candidate: { ...row.candidate, readModel } };
}

test("a pinned store failure stays a failure and a pinned absence stays absent", async () => {
  const { store, pin } = await seededRun();
  await promoteVersion(store, PROMOTED_MID_RUN);
  const failing = {
    readPromotion: store.readPromotion.bind(store),
    readCandidate: store.readCandidate.bind(store),
    readCandidates: store.readCandidates.bind(store),
    events: store.events.bind(store),
    async readPromotions(): Promise<never> { throw new Error("connection reset"); },
  };
  await withEnv(harnessEnv(writePin(pin)), async () => {
    clearPromotedReadModelCache();
    const read = await readMeetingsProjection({ store: failing, bypassCache: true, allowUnconfiguredBootstrap: false, now: LATER });
    assert.equal(read.kind, "STORE_UNREACHABLE", "an unreadable store is never answered from the pin");
  });

  // A partition the capture recorded as NOT_RECORDED stays NOT_RECORDED even after the runner promotes it.
  await promoteMeetingPartitions({
    store,
    partitions: [insite],
    meetings: [meeting(insite, PROMOTED_MID_RUN, "gained-mid-run")],
    agendaDocuments: [],
    reports: [report(insite.meetingSource, PROMOTED_MID_RUN)],
    generatedAt: PROMOTED_MID_RUN,
  });
  assert.equal(pin.partitions.find(({ contractId }) => contractId === insite.id)?.kind, "NOT_RECORDED");
  await withEnv(harnessEnv(writePin(pin)), async () => {
    clearPromotedReadModelCache();
    const read = await readMeetingsProjection({ store, bypassCache: true, allowUnconfiguredBootstrap: false, now: LATER });
    assert.equal(read.kind, "PROMOTED");
    if (read.kind !== "PROMOTED") return;
    assert.equal(read.partitions.find(({ contractId }) => contractId === insite.id)?.kind, "NOT_RECORDED");
    assert.equal(read.value.meetings.some(({ id }) => id === "legistar-insite:gained-mid-run"), false);
  });
});

test("the proof server's prepared row serves only when it was composed from exactly the pinned versions", async () => {
  const { store, v1, pin } = await seededRun();
  const v2 = await promoteVersion(store, PROMOTED_MID_RUN);
  const prepared = (versionId: string) => ({
    recordClass: "MEETING" as RoutineRecordClass,
    scope: MEETINGS_PREPARED_SCOPE,
    payload: { formatVersion: 1, generatedAt: PROMOTED_MID_RUN, counts: { fresh: 0, carried: 0, total: 0 }, sources: [], meetings: [], agendaDocuments: [] },
    composedFrom: [{ contractId: legistar.id, versionId }],
    factSha256: "f".repeat(64),
    generatedAt: PROMOTED_MID_RUN,
    composedAt: PROMOTED_MID_RUN,
    sourceThrough: null,
    retrievedAt: null,
    promotedThrough: null,
  });
  await store.writePreparedReaderProjection(prepared(v2), null);
  await withEnv(harnessEnv(writePin(pin)), async () => {
    clearPromotedReadModelCache();
    const moved = await readPreparedMeetingsProjection({ store, now: LATER });
    assert.doesNotMatch(moved.kind === "PROMOTED" ? moved.detail : moved.kind, /prepared reader snapshot/, "a serving copy of other versions is not served under the pin");
    assert.equal(partitionVersion(moved), v1);
    await store.writePreparedReaderProjection(prepared(v1), 1);
    const matching = await readPreparedMeetingsProjection({ store, now: LATER });
    assert.match(matching.kind === "PROMOTED" ? matching.detail : matching.kind, /prepared reader snapshot/, "the serving copy of exactly the pinned versions still serves");
  });
});

test("a deployed build, a function runtime, or a process outside the harness never admits the pin", async () => {
  const { store, v1, pin } = await seededRun();
  const path = writePin(pin);
  const env = harnessEnv(path);
  assert.deepEqual(readerProofMeetingPinAdmission({}, ["", ""]), { state: "ABSENT" });
  assert.deepEqual(readerProofMeetingPinAdmission(env, ["", ""]), { state: "ADMITTED", path });
  // next.config.ts bakes WTP_BUILD_ON_NETLIFY ("true") and WTP_BUILD_DEPLOY_ID into every Netlify build.
  assert.equal(readerProofMeetingPinAdmission(env, ["true", ""]).state, "REFUSED");
  assert.equal(readerProofMeetingPinAdmission(env, ["", "65f0c0ffee"]).state, "REFUSED");
  for (const runtime of ["NETLIFY", "NETLIFY_BLOBS_CONTEXT", "AWS_LAMBDA_FUNCTION_NAME", "LAMBDA_TASK_ROOT"]) {
    assert.equal(readerProofMeetingPinAdmission({ ...env, [runtime]: "1" }, ["", ""]).state, "REFUSED", runtime);
  }
  assert.equal(readerProofMeetingPinAdmission({ [READER_PROOF_MEETING_PIN_ENV]: path }, ["", ""]).state, "REFUSED", "outside the harness");
  assert.equal(activeReaderProofMeetingPin(env, ["true", ""]), null);

  // End to end: the substituted build constant makes the pin inert and the read live.
  const v2 = await promoteVersion(store, PROMOTED_MID_RUN);
  for (const deployed of [{ WTP_BUILD_ON_NETLIFY: "true" }, { WTP_BUILD_DEPLOY_ID: "65f0c0ffee" }]) {
    await withEnv({ ...env, ...deployed }, async () => {
      clearPromotedReadModelCache();
      const read = await readMeetingsProjection({ store, bypassCache: true, allowUnconfiguredBootstrap: false, now: LATER });
      assert.equal(partitionVersion(read), v2, "a deployed build reads the live pointer, never the pin");
      assert.notEqual(partitionVersion(read), v1);
    });
  }

  // The wiring that makes the refusal hold in a real deployed bundle.
  const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");
  assert.match(config, /WTP_BUILD_ON_NETLIFY:\s*process\.env\.NETLIFY\b/);
  assert.match(config, /WTP_BUILD_DEPLOY_ID:\s*process\.env\.DEPLOY_ID\b/);
  const pinModule = readFileSync(join(ROOT, "lib", "meetings", "proof-pin.ts"), "utf8");
  assert.match(pinModule, /process\.env\.WTP_BUILD_ON_NETLIFY\b/, "read literally so Next substitutes the baked value");
  assert.match(pinModule, /process\.env\.WTP_BUILD_DEPLOY_ID\b/, "read literally so Next substitutes the baked value");
  assert.doesNotMatch(readFileSync(join(ROOT, "netlify.toml"), "utf8"), /READER_PROOF_MEETING_PIN|READER_EXECUTION_AUTHORITY_EVIDENCE/);
  // The exact-version door has one caller, and only the pin reaches it.
  const callers = sourceFiles(join(ROOT, "lib")).concat(sourceFiles(join(ROOT, "app")))
    .filter((file) => /(?<!function )readPinnedPromotedCivicDataBatch\s*</.test(readFileSync(file, "utf8")));
  assert.deepEqual(callers.map((file) => file.slice(ROOT.length + 1).replaceAll("\\", "/")), ["lib/meetings/snapshot.ts"]);
});

test("an admitted pin that is malformed or edited is refused loudly, never read as no pin", async () => {
  const { pin } = await seededRun();
  assert.equal(parseReaderProofMeetingPin(JSON.parse(JSON.stringify(pin))).partitionsSha256, pin.partitionsSha256);
  const edited = { ...pin, partitions: pin.partitions.map((row) => row.contractId === legistar.id ? { ...row, versionId: "cv-edited" } : row) };
  assert.throws(() => parseReaderProofMeetingPin(edited), /partitionsSha256 does not match/);
  assert.throws(() => parseReaderProofMeetingPin({ ...pin, partitions: pin.partitions.slice(1) }), /registered partition denominator/);
  assert.throws(() => activeReaderProofMeetingPin(harnessEnv(writePin(edited)), ["", ""]), /READER_PROOF_MEETING_PIN_INVALID/);
  assert.throws(() => readerProofMeetingPinFromReadback([], CAPTURED), /READER_PROOF_MEETING_PIN_CAPTURE_INVALID/);
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mts)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}
