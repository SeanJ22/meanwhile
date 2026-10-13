import assert from "node:assert/strict";
import test from "node:test";
import { defaultGrant } from "../lib/control-plane/capability.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { objectKey } from "../lib/control-plane/evidence/store.ts";
import { runAcquirer, type AcquirerWorkerInput, type VaultedResearchEvidence } from "../lib/control-plane/workers/acquirer.ts";
import { dispatchWorkerTask } from "../lib/control-plane/workers/runtime.ts";
import type { ScoutToolkit } from "../lib/control-plane/scheduler/scout-contract.ts";
import { autonomousHarness, FIXTURE_URL } from "./helpers/autonomous-fleet.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import type { ResearchBlocker } from "../lib/control-plane/workers/research-types.ts";
import { nextAutonomousOperation } from "../lib/control-plane/workers/coordinator.ts";
import { scheduleAutonomousAcquisition } from "../lib/control-plane/workers/autonomous-plan.ts";

const NOW = "2026-09-05T18:00:00.000Z";
const PROJECT = "fleet-recovery-isolated";
const RECORD_URL = "https://fixture-clerk.example.gov/records.json";

function heldEvidence(text: string, url: string, attemptId: string): VaultedResearchEvidence {
  const artifact = recordAcquisition({ canonicalUrl: url, retrievedAt: NOW, httpStatus: 200,
    contentType: "application/json", sourceId: "fixture-clerk.example.gov", methodRouteId: "official-records",
    workItemId: "wi-fixture", attemptId, permission: "ALLOWED", transport: "REACHABLE" }, text).artifact;
  return { artifact, key: objectKey(PROJECT, artifact), bytes: Buffer.from(text) };
}

function cacheRecoveryFixture() {
  const text = `<p>Fixture clerk records.</p><a href="${RECORD_URL}">official records</a>`;
  const observation = heldEvidence(text, "https://fixture-clerk.example.gov/", "at-observation");
  const broken = heldEvidence('[{"id":"old","name":"Prior clerk"}]', RECORD_URL, "at-old");
  const good = heldEvidence('[{"id":"new","name":"Current clerk"}]', RECORD_URL, "at-current");
  const evidence = new Map([observation, broken, good].map(held => [held.artifact.id, held]));
  const span = { artifactId: observation.artifact.id, contentHash: observation.artifact.contentHash,
    start: 0, end: text.length, quote: text, offsetUnit: "UTF16_CODE_UNITS" as const };
  const input: AcquirerWorkerInput = { attemptId: "at-recovery", project: PROJECT, workItemId: "wi-fixture",
    worker: { role: "ACQUIRER", provider: "fixture", version: "1", instance: "recovery" },
    grant: defaultGrant({ role: "ACQUIRER", project: PROJECT, policyVersion: "fixture", grantedAt: NOW }),
    now: () => NOW, route: { id: "official-records", subjectId: "body:fixture", jurisdiction: "AZ", recordClass: "OFFICIAL_ROSTER",
      sourceId: "fixture-clerk.example.gov", publisher: "Fixture clerk", url: RECORD_URL, observedLocator: RECORD_URL,
      observedAt: NOW, firstObservedAt: NOW, methodVersion: 1, permission: "ALLOWED", observation: span,
      publisherSubjectEvidence: [span], applicableBecause: "The captured publisher observation names the route.",
      nextRouteIds: [], retrieval: "fetch_public" },
    held: [broken, good].map(held => ({ artifactId: held.artifact.id, sourceRouteId: "official-records",
      sourceObservationArtifactId: observation.artifact.id, immutable: true, partial: false,
      currentUntil: "2026-09-06T18:00:00.000Z" })) };
  let networkCalls = 0;
  const toolkit: ScoutToolkit = { call: async () => { networkCalls++; throw new Error("FIXTURE_NETWORK_MUST_NOT_RUN"); },
    specs: [], vaultedArtifactIds: new Set(), toolCalls: 0, requestCount: 0, bytesFetched: 0 };
  const readVault = async (id: string) => {
    const held = evidence.get(id);
    if (!held) throw new Error("FIXTURE_ARTIFACT_MISSING");
    return id === broken.artifact.id ? { ...held, bytes: Buffer.from("corrupt") } : held;
  };
  return { input, runtime: { toolkit, readVault }, broken, good, observation, networkCalls: () => networkCalls };
}

test("corrupt held candidate cannot starve a separately validated current capture; history and original attribution survive", async () => {
  const f = cacheRecoveryFixture();
  const recovered = await runAcquirer(f.input, f.runtime);
  assert.equal(recovered.verdict, "ACQUIRED");
  assert.deepEqual(recovered.artifacts.map(a => a.artifactId), [f.good.artifact.id]);
  assert.equal(recovered.artifacts[0].acquisitionAttemptId, "at-current");
  assert.equal(recovered.artifacts[0].retrievedAt, NOW);
  assert.equal(recovered.artifacts[0].reused, true);
  assert.equal(recovered.requestCount, 0);
  assert.equal(f.networkCalls(), 0);
  assert.equal(recovered.walk[0].outcome, "BLOCKED");
  assert.equal(recovered.walk[1].outcome, "WALKED_AND_FOUND");
  assert.equal(recovered.findings[0].severity, "WARNING");
  assert.match(recovered.findings[0].detail, new RegExp(f.broken.artifact.id));
  assert.deepEqual(recovered.blockers, []);
  assert.ok(!recovered.artifactIds.includes(f.broken.artifact.id));
  assert.equal(f.broken.artifact.attemptId, "at-old", "failed candidate metadata is never rewritten");
});

test("recovery never relaxes provenance, freshness, partial-capture or permission boundaries", async () => {
  for (const variant of ["no-alternative", "expired", "partial", "foreign-work", "foreign-project"] as const) {
    const f = cacheRecoveryFixture();
    const alternate = f.input.held[1];
    const held = variant === "no-alternative" ? [f.input.held[0]] : [f.input.held[0], {
      ...alternate, ...(variant === "expired" ? { currentUntil: NOW } : {}), ...(variant === "partial" ? { partial: true } : {}),
    }];
    const result = await runAcquirer({ ...f.input, held }, { ...f.runtime, readVault: async id => {
      const candidate = await f.runtime.readVault(id);
      if (id !== f.good.artifact.id) return candidate;
      return variant === "foreign-work" ? { ...candidate, artifact: { ...candidate.artifact, workItemId: "wi-other" } }
        : variant === "foreign-project" ? { ...candidate, key: candidate.key.replace(PROJECT, "other-project") } : candidate;
    } });
    assert.equal(result.verdict, "BLOCKED", variant);
    assert.equal(result.artifacts.length, 0, variant);
    assert.equal(result.blockers[0].code, "EVIDENCE_IDENTITY_MISMATCH", variant);
    assert.equal(f.networkCalls(), 0, variant);
  }
  /* The capability boundary holds: without the network grant, recovery sends nothing. */
  const f = cacheRecoveryFixture();
  const noNetwork = await runAcquirer({ ...f.input, held: [], grant: { ...f.input.grant, capabilities: f.input.grant.capabilities.filter(c => c !== "NETWORK_PUBLIC_READ") } }, f.runtime);
  assert.equal(noNetwork.verdict, "BLOCKED");
  assert.equal(noNetwork.blockers[0].code, "CAPABILITY_DENIED");
  assert.equal(f.networkCalls(), 0);
  /* A recorded robots.txt verdict is not a boundary: a CANNOT_TELL route walks the network, robots.txt first, and only the page's own access control (here a 403) walls it. */
  const calls: string[] = [];
  const walled: ScoutToolkit = { ...f.runtime.toolkit, call: async (name) => {
    calls.push(name);
    const robots = name === "read_permission";
    return { ok: robots, forModel: "fixture", artifacts: [], provenance: [], requestCount: 1, bytesFetched: 0,
      rung: { rung: "linked-documents-or-bulk-download", tool: name, target: RECORD_URL, artifactIds: [], ok: robots, permission: "CANNOT_TELL",
        observed: robots ? "robots.txt HTTP 403; permission CANNOT_TELL" : "HTTP 403 (wall)", transport: "CHALLENGED", httpStatus: 403 } };
  } };
  const permissionUnknown = await runAcquirer({ ...f.input, held: [], route: { ...f.input.route, permission: "CANNOT_TELL" } }, { ...f.runtime, toolkit: walled });
  assert.deepEqual(calls, ["read_permission", "fetch_public"], "robots.txt is read and recorded, then the page is requested once");
  assert.equal(permissionUnknown.verdict, "BLOCKED");
  assert.equal(permissionUnknown.blockers[0].code, "PUBLISHER_AUTHENTICATION", "the page's own 403 is the wall, not the robots verdict");
  assert.ok(!permissionUnknown.blockers.some(b => b.code === "PERMISSION_UNKNOWN" || b.code === "PERMISSION_DENIED"));
  assert.equal(permissionUnknown.walk[0].permission, "CANNOT_TELL", "the unread robots.txt is still on record");
  assert.equal(f.networkCalls(), 0);
});

type WorkerResultRow = Awaited<ReturnType<ControlPlaneRepositories["workerResults"]["readAll"]>>[number];

/** A read-only view of `repos` in which every BLOCKED acquisition carries `code` / `retryable`, as an older result does when robots.txt alone stopped it. */
function historicalBlockView(repos: ControlPlaneRepositories, code: ResearchBlocker["code"], retryable: boolean): ControlPlaneRepositories {
  const rewrite = (r: WorkerResultRow): WorkerResultRow => r.result.role === "ACQUIRER" && r.result.verdict === "BLOCKED"
    ? { ...r, result: { ...r.result, blockers: r.result.blockers.map(b => ({ ...b, code, retryable })) } } : r;
  const results = new Proxy(repos.workerResults, { get(t, p, rcv) {
    const value = Reflect.get(t, p, rcv) as unknown;
    if (p === "read" || p === "readAll") {
      return async (...args: unknown[]) => (await (value as (...a: unknown[]) => Promise<WorkerResultRow[]>).apply(t, args)).map(rewrite);
    }
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(t) : value;
  } });
  return new Proxy(repos, { get: (target, prop, receiver) => prop === "workerResults" ? results : Reflect.get(target, prop, receiver) });
}

test("a route an older acquisition blocked for robots.txt alone (PERMISSION_DENIED, never retryable) is acquired again at once, robots first; any other non-retryable block still holds", async () => {
  const response: { transportError: string | null } = { transportError: "socket timeout" };
  // The executor and planner see the same historical store, including its captured closure.
  const original = await autonomousHarness({ response });
  const repos = historicalBlockView(original.repos, "PERMISSION_DENIED", false);
  const h = await autonomousHarness({ response, repos, store: original.store });
  const first = await nextAutonomousOperation(h.runtime, h.item.id);
  assert.equal(first.task?.workerTask?.role, "ACQUIRER");
  assert.equal((await dispatchWorkerTask(h.runtime, first.task!)).outcome, "WORKED");
  const failed = (await h.repos.workerResults.readAll())[0];
  assert.equal(failed.result.role === "ACQUIRER" && failed.result.verdict, "BLOCKED");
  response.transportError = null;
  const historicalRuntime = { ...h.runtime, repos: historicalBlockView(h.repos, "PERMISSION_DENIED", false) };
  const robotsOnly = await nextAutonomousOperation(historicalRuntime, h.item.id);
  assert.equal(robotsOnly.action, "WORKER", robotsOnly.reason);
  assert.equal(robotsOnly.task?.workerTask?.role, "ACQUIRER", "robots.txt alone never leaves a public route refused");
  assert.notEqual(robotsOnly.task?.id, first.task!.id, "a fresh acquisition, not the recorded one");
  const before = h.calls.length;
  // The executor's injected tools close over the harness repositories. Give
  // selection and execution the same historical read view for this Attempt.
  const originalResults = h.repos.workerResults;
  Object.defineProperty(h.repos, "workerResults", { value: historicalRuntime.repos.workerResults, configurable: true });
  try {
    assert.equal((await dispatchWorkerTask(historicalRuntime, robotsOnly.task!)).outcome, "WORKED");
  } finally {
    Object.defineProperty(h.repos, "workerResults", { value: originalResults, configurable: true });
  }
  assert.deepEqual(h.calls.slice(before), ["https://fixture-clerk.example.gov/robots.txt", FIXTURE_URL], "robots.txt is read first, then the page");
  const reacquired = (await h.repos.workerResults.readAll()).find(record => record.routeTaskId === robotsOnly.task!.id)!;
  assert.equal(reacquired.result.verdict, "ACQUIRED");
  /* POSITIVE CONTROL: a non-retryable block that is not robots-only keeps its own rule. */
  const h2 = await autonomousHarness({ response: { transportError: "socket timeout" } });
  const t2 = await nextAutonomousOperation(h2.runtime, h2.item.id);
  assert.equal((await dispatchWorkerTask(h2.runtime, t2.task!)).outcome, "WORKED");
  const held = await nextAutonomousOperation({ ...h2.runtime, repos: historicalBlockView(h2.repos, "EVIDENCE_IDENTITY_MISMATCH", false) }, h2.item.id);
  assert.notEqual(held.task?.workerTask?.role, "ACQUIRER", "an integrity block is not re-acquired on this path");
});

test("failed publisher refresh retains the last acquired capture for unfinished validation while automatic recovery remains owed", async () => {
  const response: { transportError: string | null } = { transportError: null };
  const h = await autonomousHarness({ response });
  const first = await nextAutonomousOperation(h.runtime, h.item.id);
  assert.equal(first.task?.workerTask?.role, "ACQUIRER");
  assert.equal((await dispatchWorkerTask(h.runtime, first.task!)).outcome, "WORKED");
  const acquired = (await h.repos.workerResults.readAll())[0];
  assert.equal(acquired.result.role, "ACQUIRER");
  if (acquired.result.role !== "ACQUIRER") throw new Error("FIXTURE_ACQUISITION_REQUIRED");
  assert.equal(acquired.result.verdict, "ACQUIRED");
  const originalArtifact = acquired.result.artifacts[0];
  const originalText = (await h.runtime.readEvidence(originalArtifact.artifactId)).text;
  const schedule = scheduleAutonomousAcquisition(h.item.autonomousPlan!, acquired.result, h.now());
  assert.ok("nextDueAt" in schedule);
  if (!("nextDueAt" in schedule)) throw new Error("FIXTURE_SCHEDULE_REQUIRED");
  h.advanceTo(new Date(Date.parse(schedule.nextDueAt) + 1000).toISOString());
  response.transportError = "socket timeout";
  const parsing = await nextAutonomousOperation(h.runtime, h.item.id);
  assert.equal(parsing.task?.workerTask?.role, "PARSER", "a due refresh must not starve the captured bytes' unfinished downstream stages");
  assert.equal(parsing.task?.workerTask?.artifactId, originalArtifact.artifactId);
  const parsed = await dispatchWorkerTask(h.runtime, parsing.task!);
  assert.equal(parsed.outcome, "WORKED", parsed.detail);
  for (const expectedRole of ["VALIDATOR"]) {
    const next = await nextAutonomousOperation(h.runtime, h.item.id);
    assert.equal(next.task?.workerTask?.role, expectedRole);
    assert.equal((await dispatchWorkerTask(h.runtime, next.task!)).outcome, "WORKED");
  }
  const refresh = await nextAutonomousOperation(h.runtime, h.item.id);
  assert.equal(refresh.task?.workerTask?.role, "ACQUIRER", "finishing held work leaves the real due acquisition owed");
  assert.equal((await dispatchWorkerTask(h.runtime, refresh.task!)).outcome, "WORKED");
  const failure = (await h.repos.workerResults.readAll()).find(record => record.routeTaskId === refresh.task!.id)!;
  assert.equal(failure.result.verdict, "BLOCKED");
  const waiting = await nextAutonomousOperation(h.runtime, h.item.id);
  assert.equal(waiting.action, "BLOCKED", "a successful retained extraction never clears the latest source failure");
  const retryAt = /plain code at (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/.exec(waiting.reason)?.[1];
  assert.ok(retryAt, "a passing outage keeps its scheduled retry without paying for source discovery");
  h.advanceTo(new Date(Date.parse(retryAt) + 1).toISOString());
  const retry = await nextAutonomousOperation(h.runtime, h.item.id);
  assert.equal(retry.action, "WORKER");
  assert.equal(retry.task?.workerTask?.role, "ACQUIRER", "the known publisher is retried after its backoff");
  assert.equal((await h.runtime.readEvidence(originalArtifact.artifactId)).text, originalText);
  assert.equal((await h.repos.workerResults.readAll()).find(record => record.id === acquired.id)?.endedAt, acquired.endedAt);
  assert.equal((await h.repos.workerResults.readAll()).find(record => record.id === failure.id)?.result.verdict, "BLOCKED");
  assert.ok((await h.repos.artifacts.readAll()).some(record => record.artifactId === originalArtifact.artifactId && record.attemptId === originalArtifact.acquisitionAttemptId));
});
