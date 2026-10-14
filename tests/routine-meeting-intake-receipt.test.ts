import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { MemoryEvidenceStore, type EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { beginAttemptFor, claimRouteTask, reclaimRouteTask, registerRouteTask } from "../lib/control-plane/repository/coordinator.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { FLEET_POLICY_VERSION } from "../lib/control-plane/workers/runtime.ts";
import { PIMA_LEGISTAR_CONTRACT } from "../lib/control-plane/workers/held-meeting-contract.ts";
import { retainRecentRoutineMeetingEvidence, retainRoutineMeetingForWorkers } from "../lib/control-plane/workers/routine-meeting-intake.ts";
import { holdMeetingSourceResponses, retainMeetingCandidateEvidence, type RetainedMeetingCandidate, type RetainedSourceResponse } from "../lib/civic-data/meeting-research-evidence.ts";
import { readRawCapture } from "../lib/civic-data/raw-capture-vault.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import { meetingPartitionForRow, refreshMeetingPartitions } from "../lib/civic-data/meeting-partitions.ts";
import { readDoorImport } from "../lib/doors/seed-all.ts";
import { methodFixture } from "./method-store-fixture.ts";

const bytes = new Uint8Array(readFileSync(new URL("./fixtures/legistar-pima-events.json", import.meta.url)));
const rawHash = createHash("sha256").update(bytes).digest("hex");
const windowUrl = (from: string, to: string) =>
  `https://webapi.legistar.com/v1/pima/events?$filter=EventId%20gt%200%20and%20EventDate%20ge%20datetime%27${from}%27` +
  `%20and%20EventDate%20le%20datetime%27${to}%27&$orderby=EventId&$top=1000`;
const DAY_ONE = windowUrl("2026-06-26", "2027-01-22");
const DAY_TWO = windowUrl("2026-06-27", "2027-01-23");
const response = (url: string, retrievedAt: string): RetainedSourceResponse => ({
  source: "legistar", requestedUrl: url, finalUrl: url, httpStatus: 200, rawHash, byteCount: bytes.byteLength, bytes, retrievedAt,
});
const methodVersion = methodFixture().version;
refreshMeetingPartitions(readDoorImport().rows);
const subjectId = meetingPartitionForRow("legistar", PIMA_LEGISTAR_CONTRACT.subjectId).bodyId;

function harness(t: { after: (fn: () => void) => void }) {
  const vaultRoot = mkdtempSync(join(tmpdir(), "routine-intake-receipt-"));
  t.after(() => rmSync(vaultRoot, { recursive: true, force: true }));
  let clock = Date.parse("2026-09-25T22:11:20.000Z");
  const now = () => new Date(clock += 1000).toISOString();
  const advance = (ms: number) => { clock += ms; };
  return { repos: createMemoryRepositories(), store: new DurableEvidenceStore(vaultRoot), now, advance };
}

test("an unchanged feed under a rolled request window settles as a re-observation of the held artifact", async (t) => {
  const { repos, store, now } = harness(t);
  const first = await retainRoutineMeetingForWorkers({ repos, store, subjectId, methodVersion, now,
    candidateVersionId: "cv-day-one", response: response(DAY_ONE, now()) });
  assert.ok(first);
  const second = await retainRoutineMeetingForWorkers({ repos, store, subjectId, methodVersion, now,
    candidateVersionId: "cv-day-two", response: response(DAY_TWO, now()) });
  assert.ok(second, "byte-identical bytes at the next day's URL are captured, not refused");
  assert.equal(second.artifactId, first.artifactId, "the artifact is its content");
  assert.notEqual(second.attemptId, first.attemptId, "the day-two retrieval keeps its own Attempt");

  const tasks = (await repos.routeTasks.list()).filter((row) => row.value.routeId.startsWith("routine-meeting-capture:"));
  assert.deepEqual(tasks.map((row) => row.value.state), ["DISPOSED", "DISPOSED"]);
  const dayTwo = tasks.find((row) => row.value.routeId.startsWith("routine-meeting-capture:cv-day-two:"))!.value;
  assert.equal(dayTwo.disposition?.disposition, "INGESTED");
  assert.deepEqual(dayTwo.disposition?.artifactIds, [first.artifactId]);
  assert.match(dayTwo.disposition?.note ?? "", /byte-identical/i);
  assert.ok(dayTwo.disposition?.note.includes(DAY_TWO), "the re-observation names its own URL");

  const records = await repos.artifacts.read(first.workItemId);
  assert.equal(records.length, 1, "history is not rewritten: the first observation keeps its attribution");
  assert.equal(records[0]!.canonicalUrl, DAY_ONE);
  assert.equal(second.parserTaskId, first.parserTaskId, "the same bytes enter independent work once");

  const attempts = (await repos.attempts.list()).length;
  assert.equal(await retainRoutineMeetingForWorkers({ repos, store, subjectId, methodVersion, now,
    candidateVersionId: "cv-day-two", response: response(DAY_TWO, now()) }), null,
  "a receipt that re-confirms the same candidate re-derives a settled task and adds nothing");
  assert.equal((await repos.attempts.list()).length, attempts);
});

test("a capture left unsettled by an expired lease is resumed under its persisted value", async (t) => {
  const { repos, store, now, advance } = harness(t);
  const seeded = await retainRoutineMeetingForWorkers({ repos, store, subjectId, methodVersion, now,
    candidateVersionId: "cv-day-one", response: response(DAY_ONE, now()) });
  assert.ok(seeded);
  // The production leftover, exactly: registered, claimed, an Attempt opened, the
  // holder gone, and the sweep's reclaim after the two-minute lease expired.
  const leftover = createRouteTask({ workItemId: seeded.workItemId, routeId: `routine-meeting-capture:cv-2224:${rawHash}`,
    routeLabel: "Actual permanent source acquisition receipt", target: DAY_TWO, inherited: false, now: now() });
  await registerRouteTask(repos, leftover, now());
  const holder = "routine-meeting-receipt:crashed";
  const claim = await claimRouteTask(repos, { routeTaskId: leftover.id, holder, now: now(), ttlMs: 120_000 });
  const dead = await beginAttemptFor(repos, { routeTaskId: leftover.id, workItemId: seeded.workItemId, lease: claim.lease.value,
    worker: { role: "ACQUIRER", provider: "permanent-meeting-source", version: "routine-held-evidence/1", instance: holder },
    methodVersion, policyVersion: FLEET_POLICY_VERSION, now: now() });
  advance(8 * 60_000);
  await reclaimRouteTask(repos, { routeTaskId: leftover.id, now: now(), observedBy: "autonomous-coordinator" });
  assert.equal((await repos.routeTasks.mustRead(leftover.id)).value.state, "RECLAIMABLE");

  const resumed = await retainRoutineMeetingForWorkers({ repos, store, subjectId, methodVersion, now,
    candidateVersionId: "cv-2224", response: response(DAY_TWO, now()) });
  assert.ok(resumed, "the next pass resumes the task instead of re-offering a fresh PENDING value");
  const settled = (await repos.routeTasks.mustRead(leftover.id)).value;
  assert.equal(settled.state, "DISPOSED");
  assert.equal(settled.createdAt, leftover.createdAt, "the persisted task is reused, not replaced");
  assert.deepEqual(settled.attemptIds, [dead.value.id, resumed.attemptId], "the abandoned Attempt stays in the record");
  assert.equal((await repos.attempts.mustRead(dead.value.id)).value.outcome, "LEASE_EXPIRED");
});

test("a capture that fails after its Attempt opens closes the Attempt with the cause, and the next pass settles it", async (t) => {
  const { repos, store, now } = harness(t);
  const failing: EvidenceStore = {
    put: async () => { throw new Error("VAULT_WRITE_REFUSED_FOR_TEST"); },
    get: (key) => store.get(key), head: (key) => store.head(key), list: (prefix) => store.list(prefix),
  };
  await assert.rejects(retainRoutineMeetingForWorkers({ repos, store: failing, subjectId, methodVersion, now,
    candidateVersionId: "cv-day-one", response: response(DAY_ONE, now()) }), /VAULT_WRITE_REFUSED_FOR_TEST/);
  const [task] = (await repos.routeTasks.list()).filter((row) => row.value.routeId.startsWith("routine-meeting-capture:"));
  assert.equal(task!.value.state, "RECLAIMABLE", "the route is owed again at once, not after a lease expiry");
  const [attemptId] = task!.value.attemptIds;
  const abandoned = (await repos.attempts.mustRead(attemptId!)).value;
  assert.equal(abandoned.outcome, "ABORTED");
  assert.match(abandoned.abortReason ?? "", /VAULT_WRITE_REFUSED_FOR_TEST/, "the Attempt names the actual failure");
  assert.equal((await repos.leases.mustRead(task!.id)).value.released, true);

  const retried = await retainRoutineMeetingForWorkers({ repos, store, subjectId, methodVersion, now,
    candidateVersionId: "cv-day-one", response: response(DAY_ONE, now()) });
  assert.ok(retried);
  assert.equal((await repos.routeTasks.mustRead(task!.id)).value.state, "DISPOSED");
});

test("a meeting candidate holds a vault reference, not the bytes, and the intake reads the exact bytes back", async (t) => {
  const { repos, store, now } = harness(t);
  const vault = new MemoryEvidenceStore();
  const fetched = response(DAY_ONE, now());
  const [held] = await holdMeetingSourceResponses(vault, [fetched]);
  const { bytes: _, ...traced } = fetched;
  const snapshot = { sources: [{ source: "legistar", ok: true, acquisitions: [traced] }] } as unknown as MeetingsSnapshot;
  const base = { id: "cv-ref", scope: meetingPartitionForRow("legistar", PIMA_LEGISTAR_CONTRACT.subjectId).scope, recordClass: "MEETING" } as unknown as RoutineCandidate;
  const candidate = retainMeetingCandidateEvidence(base, snapshot, [held!]);
  assert.deepEqual(candidate.retainedSourceResponses, [{ ...traced, raw: held!.raw }]);
  assert.equal(held!.raw.rawHash, rawHash);
  const stored = JSON.stringify(candidate);
  assert.ok(stored.length < 2_048 && !stored.includes(Buffer.from(bytes).toString("base64").slice(0, 64)), "the candidate carries no raw bytes");
  assert.deepEqual(await readRawCapture(vault, held!.raw), bytes);
  const [result] = await retainRecentRoutineMeetingEvidence({ repos, store, vault, methodVersion, now, candidates: [candidate] });
  assert.ok(result, "the vault bytes reached independent work");
  const [key] = (await store.list("project/freshness/")).filter((path) => path.endsWith(`${rawHash}.json`));
  assert.deepEqual((await store.get(key!))?.bytes, bytes, "the worker artifact is the exact fetched bytes");
});

test("one candidate's capture failure does not keep the other candidate's bytes from independent work", async (t) => {
  const { repos, store, now } = harness(t);
  const vault = new MemoryEvidenceStore();
  const candidate = async (id: string, url: string): Promise<RetainedMeetingCandidate> => ({
    id, scope: meetingPartitionForRow("legistar", PIMA_LEGISTAR_CONTRACT.subjectId).scope, recordClass: "MEETING",
    retainedSourceResponses: await holdMeetingSourceResponses(vault, [response(url, now())]) }) as unknown as RetainedMeetingCandidate;
  // Newest first, as the durable read returns them. The older one lies about its bytes.
  const newest = await candidate("cv-newest", DAY_TWO);
  const older = await candidate("cv-older", DAY_ONE);
  const lying = { ...older, retainedSourceResponses: [{ ...older.retainedSourceResponses![0]!, rawHash: "0".repeat(64) }] };
  await assert.rejects(retainRecentRoutineMeetingEvidence({ repos, store, vault, methodVersion, now, candidates: [newest, lying] }),
    /ROUTINE_RESEARCH_CAPTURE_BYTE_MISMATCH/);
  const settled = (await repos.routeTasks.list()).filter((row) => row.value.routeId.startsWith("routine-meeting-capture:cv-newest:"));
  assert.equal(settled[0]?.value.state, "DISPOSED", "the newest capture still reached independent work");
});
