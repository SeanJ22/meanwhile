import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { MEETING_PARTITION_CONTRACTS, meetingPartitionId, type MeetingPartitionContract } from "../../civic-data/meeting-partitions.ts";
import { ROUTINE_SOURCE_CONTRACTS, currentMeetingClock, type RoutineSourceContract } from "../../civic-data/contracts.ts";
import { outcomePartitionForDoor } from "../../civic-data/outcome-partitions.ts";
import { admittedRuntimeChildEnvironment } from "../../civic-data/runtime-authority.ts";
import { runBoundedChildPass, type BoundedChildLauncher } from "../../civic-data/bounded-child-pass.ts";
import { durableRoutineRunnerReceiptIssue, parseMeetingPartitionRunnerReceipts, parseRoutineRunnerReceipt, type DurableReceiptStore } from "../../civic-data/runner-receipt.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../../civic-data/store.ts";
import { syncNativeSourceClock } from "../../civic-data/source-clock-outcome.ts";
import { sanitizedErrorDiagnostic } from "../../ops/error-diagnostic.ts";
import type { RetainedSourceResponse } from "../../civic-data/retained-meeting-bytes.ts";
import { isDoorRecord, type DoorRecord } from "../../doors/registry.ts";
import { installDoorRecords } from "../../doors/meeting-doors.ts";
import type { Query } from "../../facts/publish.ts";
import { factReader } from "../../facts/db.ts";
import { installMeetingClockFrom } from "../../meetings/settings.ts";
import { validateRetainedSourceResponse } from "../../../scripts/lib/retained-source-replay.ts";
import type { DiggerMeasurement } from "../../../scripts/lib/digger-measurement.ts";
import { ZERO_COST, type WorkerRef } from "../attempt.ts";
import { defaultGrant, requireCapability } from "../capability.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../gateway/admin-config.ts";
import type { Artifact } from "../evidence/artifact.ts";
import { datePath, readArtifact, type EvidenceStore } from "../evidence/store.ts";
import { contentHash, fingerprint } from "../ids.ts";
import { canonicalJson, type ArtifactRecord, type ControlPlaneRepositories } from "../repository/types.ts";
import type { RouteTask } from "../route-task.ts";
import type { DeclaredExecutor } from "../scheduler/dispatch.ts";
import { askGapSourceUrl } from "../scheduler/providers/ask-gaps.ts";
import { readHeldMeetingInput, type HeldMeetingInput } from "../scheduler/providers/held-meeting-input.ts";
import type { WorkItem } from "../work-item.ts";
import type { AcquirerResult } from "./research-types.ts";
import { enqueueWorkerTask, FLEET_POLICY_VERSION } from "./runtime.ts";
import { routineProcessSlots, type WorkerProcessSlots } from "./worker-slots.ts";

export const HELD_MEETING_DETAILS_CLASS = "HELD_MEETING_DETAILS";
const VERSION = "held-meeting-details/1";
const GAP_CODES = new Set(["AGENDA_NOT_HELD", "CALENDAR_STALE", "OUTCOME_NOT_READ", "OUTCOMES_UNREADABLE", "MEETINGS_NOT_HELD"]);
const publicUrl = (value: string): boolean => {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
};

export function isHeldMeetingTask(task: RouteTask): boolean {
  return task.workerTask?.role === "ACQUIRER" && task.workerTask.contract.schemaVersion === 2 &&
    task.workerTask.contract.recordClass === HELD_MEETING_DETAILS_CLASS;
}

async function sourceReceipt(repos: ControlPlaneRepositories, workItemId: string, routeId: string, artifactId: string) {
  const [item, route, records] = await Promise.all([repos.workItems.read(workItemId), repos.routeTasks.read(routeId), repos.artifacts.readWhere(workItemId, ["artifactId"], artifactId)]);
  const record = records.find(row => row.artifactId === artifactId && row.workItemId === workItemId && row.routeTaskId === routeId);
  if (!item || !route || route.value.workItemId !== workItemId || route.value.workerTask || !GAP_CODES.has(route.value.routeId) ||
    !record || !["RAW", "SANITIZED_DERIVED", "RESTRICTED_RAW"].includes(record.tier) || record.partial || !publicUrl(record.canonicalUrl) ||
    route.value.disposition?.disposition !== "INGESTED" || !route.value.disposition.artifactIds.includes(artifactId)) return null;
  // Standing targets the body; HTTP acquisition records its requested URL as the canonical URL.
  // The leased worker loads only this body's current doors before binding that URL to its native reader.
  const sourceUrl = publicUrl(route.value.target) ? route.value.target
    : route.value.target === item.value.subject ? record.canonicalUrl : null;
  if (!sourceUrl) return null;
  const attempt = (await repos.attempts.read(record.attemptId))?.value;
  if (!attempt || attempt.workItemId !== workItemId || attempt.routeTaskId !== routeId || attempt.outcome !== "COMPLETED" ||
    !attempt.artifactIds.includes(artifactId)) return null;
  return { item: item.value, route: route.value, sourceUrl, record, attempt };
}

/** Native publication work is keyed by the exact source receipt and stays on its owner's existing Admin work item. */
export async function enqueueHeldMeetingTask(repos: ControlPlaneRepositories, input: {
  readonly item: WorkItem; readonly artifact: ArtifactRecord; readonly route: RouteTask; readonly now: string;
}): Promise<RouteTask | null> {
  const state = /^(?:ocd-division\/country:us\/(?:state|territory|district):|curated:)([a-z]{2})(?:[/#]|$)/i.exec(input.item.subject)?.[1]?.toUpperCase();
  if (!state) return null;
  const held = await sourceReceipt(repos, input.item.id, input.route.id, input.artifact.artifactId);
  if (!held || held.item.subject !== input.item.subject || held.record.contentHash !== input.artifact.contentHash) return null;
  return enqueueWorkerTask(repos, { workItemId: held.item.id, artifactId: held.record.artifactId, role: "ACQUIRER", now: input.now,
    contract: { schemaVersion: 2, recordClass: HELD_MEETING_DETAILS_CLASS, subjectId: held.item.subject,
      jurisdiction: { country: "US", state, canonicalId: held.item.subject }, identity: { namespace: VERSION, keyFields: ["subjectId"] },
      sourceScope: { sourceId: VERSION, publisher: new URL(held.record.canonicalUrl).hostname,
        routeIds: [held.route.id], canonicalUrls: [...new Set([held.sourceUrl, held.record.canonicalUrl])], observationArtifactIds: [held.record.artifactId] },
      methodVersion: held.attempt.methodVersion, requiredFields: [], expectedSourceDate: held.record.recordedAt,
      completenessScope: "This exact held body's verified calendar and meeting details; every unread or unpublished detail remains owed.",
      extraction: { format: "UNSUPPORTED", fields: {}, mediaType: held.record.contentType, reason: "The registered native meeting reader publishes each independently verified fact." },
      verification: { required: false, authorities: [] } } });
}

/** Only this receipt's day, publisher and work item are listed; raw bytes never pass through text reconstruction. */
export async function readHeldMeetingCapture(vault: EvidenceStore, project: string, record: ArtifactRecord): Promise<{ artifact: Artifact; bytes: Uint8Array; key: string }> {
  if (!["RAW", "SANITIZED_DERIVED", "RESTRICTED_RAW"].includes(record.tier) || record.partial || !publicUrl(record.canonicalUrl)) throw new Error("HELD_MEETING_SOURCE_CAPTURE_REQUIRED");
  const host = new URL(record.canonicalUrl).host;
  for (const offset of [0, -1, 1]) {
    const day = datePath(new Date(Date.parse(record.recordedAt) + offset * 86_400_000).toISOString());
    const prefix = `project/${project}/source/${host}/${day}/${record.workItemId}/`;
    const keys = (await vault.list(prefix)).filter(key => key.startsWith(`${prefix}${record.contentHash}.`) && !key.endsWith(".meta.json"));
    for (const key of keys) {
      const meta = await vault.head(key), m = meta?.custom;
      if (!m || meta?.contentHash !== record.contentHash || m.tier !== record.tier || m.workItemId !== record.workItemId ||
        m.attemptId !== record.attemptId || m.canonicalUrl !== record.canonicalUrl || m.sourceId !== host || !Number.isFinite(Date.parse(m.retrievedAt))) continue;
      const artifact: Artifact = { id: record.artifactId, tier: record.tier, contentHash: record.contentHash, byteLength: record.byteLength,
        contentType: record.contentType, canonicalUrl: record.canonicalUrl, retrievalUrl: m.retrievalUrl ?? record.canonicalUrl,
        retrievedAt: m.retrievedAt, httpStatus: Number(m.httpStatus), headers: {}, sourceId: m.sourceId, methodRouteId: m.methodRouteId,
        workItemId: m.workItemId, attemptId: m.attemptId, permission: m.permission as Artifact["permission"], transport: m.transport as Artifact["transport"],
        retentionPolicy: m.retentionPolicy as Artifact["retentionPolicy"] };
      const read = await readArtifact(vault, project, artifact, "ACQUIRER");
      if (artifact.permission !== "ALLOWED" || artifact.transport !== "REACHABLE" || artifact.httpStatus === 206 || artifact.retentionPolicy === "DIAGNOSTIC") continue;
      return { artifact, bytes: read.bytes, key };
    }
  }
  throw new Error("HELD_MEETING_CAPTURE_NOT_HELD");
}

function sourcePartition(bodyId: string, route: RouteTask, sourceUrl: string): MeetingPartitionContract {
  const target = new URL(sourceUrl);
  const matches = MEETING_PARTITION_CONTRACTS.filter(partition => {
    if (partition.bodyId !== bodyId || partition.derivedFamily !== null) return false;
    const source = askGapSourceUrl(bodyId, [partition.id], Date.parse(route.createdAt));
    if (!source) return false;
    const url = new URL(source);
    return route.target === bodyId ? url.href === target.href
      : url.origin === target.origin && url.pathname === target.pathname;
  });
  if (matches.length !== 1) throw new Error("HELD_MEETING_REGISTERED_SOURCE_AMBIGUOUS");
  return matches[0]!;
}

function nativeContract(partition: MeetingPartitionContract, route: RouteTask): RoutineSourceContract {
  if (!["OUTCOME_NOT_READ", "OUTCOMES_UNREADABLE"].includes(route.routeId)) return partition;
  const dynamic = outcomePartitionForDoor(partition.id);
  if (dynamic) return dynamic;
  const registered = ROUTINE_SOURCE_CONTRACTS.filter(contract => contract.recordClass === "MEETING_OUTCOME" &&
    contract.schedule?.follows?.some(row => row.bodyId === partition.bodyId && row.meetingSource === partition.meetingSource));
  if (registered.length !== 1) throw new Error("HELD_MEETING_NATIVE_OUTCOME_READER_UNAVAILABLE");
  return registered[0]!;
}

/** A place contract can follow several representations while its actual reader opens only one of them. */
function nativePartition(partition: MeetingPartitionContract, contract: RoutineSourceContract): MeetingPartitionContract {
  const entry = contract.acquisitionAdapter.command?.[0];
  const source = entry === "scripts/legistar-outcomes-ingest.mts" ? "legistar"
    : entry === "scripts/legistar-insite-minutes-ingest.mts" ? "legistar-insite" : partition.meetingSource;
  if (source === partition.meetingSource) return partition;
  const matches = MEETING_PARTITION_CONTRACTS.filter(row => row.bodyId === partition.bodyId && row.meetingSource === source);
  if (matches.length !== 1) throw new Error(`HELD_MEETING_NATIVE_BODY_SOURCE_UNAVAILABLE:${partition.bodyId}:${source}`);
  return matches[0]!;
}

export interface HeldMeetingWorkerRuntime {
  readonly root: string; readonly repos: ControlPlaneRepositories; readonly vault: EvidenceStore;
  readonly query: Query; readonly store: DurableReceiptStore & Pick<RoutineDataStore, "clock">; readonly now: () => string;
  readonly environment?: NodeJS.ProcessEnv; readonly slots?: WorkerProcessSlots; readonly launcher?: BoundedChildLauncher;
  readonly readInput?: (query: Query, partition: MeetingPartitionContract) => Promise<HeldMeetingInput>;
}

/** Production opens its own narrow reader only when the leased task actually runs. */
export function productionHeldMeetingExecutor(input: Pick<HeldMeetingWorkerRuntime, "root" | "repos" | "vault" | "now" | "environment">,
  task: RouteTask, holder: string): DeclaredExecutor {
  if (!isHeldMeetingTask(task)) throw new Error("HELD_MEETING_TASK_REQUIRED");
  const worker: WorkerRef = { role: "ACQUIRER", provider: "we-the-people", version: VERSION, instance: holder };
  return { lane: "DETERMINISTIC", workerFor: () => worker, run: async request => {
    const owner = await input.repos.adminConfig.readNarrowed(ADMIN_CONFIG_ID, { formatVersion: true, apiFallback: ["enabled", "decidedAt", "decidedBy", "receiptId"],
      updatedAt: true, settings: ["meetings.hotEveryMinutes", "meetings.baseEveryMinutes", "meetings.hourlyWindowDays"] });
    if (owner && !isAdminConfig(owner.value)) return { kind: "ABORTED", ranAs: "DETERMINISTIC", endedAt: input.now(),
      cost: { ...ZERO_COST, usd: 0, requestCount: 0, bytesFetched: 0, inputTokens: 0, outputTokens: 0 }, detail: "HELD_MEETING_ADMIN_CLOCK_UNREADABLE" };
    installMeetingClockFrom(owner && isAdminConfig(owner.value) ? owner.value : null);
    const query = factReader();
    if (!query) return { kind: "ABORTED", ranAs: "DETERMINISTIC", endedAt: input.now(),
      cost: { ...ZERO_COST, usd: 0, requestCount: 0, bytesFetched: 0, inputTokens: 0, outputTokens: 0 }, detail: "HELD_MEETING_READER_STORE_UNAVAILABLE" };
    return heldMeetingExecutor({ ...input, query, store: new PostgresRoutineDataStore() }, task, holder).run(request);
  } };
}

interface NativeResult {
  readonly exitCode: number; readonly sourceSucceeded: boolean; readonly measurement: DiggerMeasurement;
}

/** The child is the existing registered reader, admitted for exactly its own contract. It writes no source payload to stdout. */
export async function runHeldMeetingNative(runtime: HeldMeetingWorkerRuntime, input: {
  readonly partition: MeetingPartitionContract; readonly contract: RoutineSourceContract; readonly door: DoorRecord;
  readonly capture?: RetainedSourceResponse; readonly deadlineMs: number; readonly assertLeaseHealthy?: () => void;
  readonly onSourceStarting?: () => void;
}): Promise<{ readonly succeeded: boolean; readonly detail: string; readonly measurement: DiggerMeasurement | null; readonly combinedPeakUpperBoundBytes: number }> {
  if (input.capture) validateRetainedSourceResponse(input.capture);
  const args = input.contract.acquisitionAdapter.command;
  if (!args || !["scripts/ingest.ts", "scripts/legistar-outcomes-ingest.mts", "scripts/legistar-insite-minutes-ingest.mts"].includes(args[0]!)) {
    throw new Error("HELD_MEETING_REGISTERED_NATIVE_READER_REQUIRED");
  }
  if (input.door.doorId !== input.partition.id || input.door.bodyIds.length !== 1 || input.door.bodyIds[0] !== input.partition.bodyId ||
    nativePartition(input.partition, input.contract).id !== input.partition.id ||
    (args.includes("--door") && args[args.indexOf("--door") + 1] !== input.partition.id)) throw new Error("HELD_MEETING_NATIVE_DOOR_BINDING_REFUSED");
  const env = admittedRuntimeChildEnvironment({ parentEnv: runtime.environment ?? process.env, capability: "ROUTINE_CONTRACT", contract: input.contract.id, parentPid: process.pid });
  const slots = runtime.slots ?? routineProcessSlots({ parentPeakBytes: process.resourceUsage().maxRSS * 1024 });
  const release = await slots.acquire(`${input.contract.id}/${args[0]}`, input.deadlineMs);
  let directory: string | undefined;
  try {
    input.assertLeaseHealthy?.();
    const held = input.contract.recordClass === "MEETING" ? await (runtime.readInput ?? readHeldMeetingInput)(runtime.query, input.partition) : {};
    directory = await mkdtemp(join(tmpdir(), "held-meeting-"));
    const file = join(directory, "input.json");
    const replay = input.capture && { ...input.capture, bytes: undefined, base64: Buffer.from(input.capture.bytes).toString("base64") };
    await writeFile(file, JSON.stringify({ ...held, doorRecord: input.door, meetingClock: currentMeetingClock(),
      ...(replay ? { initialResponse: replay } : {}) }), { mode: 0o600 });
    input.assertLeaseHealthy?.();
    const [child] = await runBoundedChildPass([{ id: input.contract.id, executable: process.execPath,
      args: ["--experimental-strip-types", ...args, `--prepared-file=${file}`], env, onStarted: pid => release.observe?.(pid) }],
    { cwd: runtime.root, env, deadlineMs: input.deadlineMs, concurrency: 1, onStarting: input.onSourceStarting }, runtime.launcher);
    input.assertLeaseHealthy?.();
    const lines = child?.stdout.split(/\r?\n/).filter(line => line.startsWith("DIGGER_RESULT=")) ?? [];
    let result: NativeResult | null = null;
    if (lines.length === 1) { try { result = JSON.parse(lines[0]!.slice("DIGGER_RESULT=".length)) as NativeResult; } catch { /* Existing child failure remains named below. */ } }
    const measurement = result?.measurement && Number.isSafeInteger(result.measurement.requests) && result.measurement.requests >= 0 &&
      Array.isArray(result.measurement.failures) && Number.isFinite(result.measurement.peakMemoryBytes) ? result.measurement : null;
    const combinedPeakUpperBoundBytes = process.resourceUsage().maxRSS * 1024 + (measurement?.peakMemoryBytes ?? 0);
    if (!child || child.termination !== "EXITED" || child.status !== 0 || result?.exitCode !== 0 || result.sourceSucceeded !== true || !measurement) {
      return { succeeded: false, detail: `Native ${input.contract.id} did not complete: ${child?.termination ?? "MISSING_CHILD"}/${child?.status ?? "unknown"}; ${measurement?.failures.join("; ") ?? child?.errorMessage ?? "native result missing"}`,
        measurement, combinedPeakUpperBoundBytes };
    }
    const parsed = input.contract.recordClass === "MEETING" ? parseMeetingPartitionRunnerReceipts(child.stdout) : parseRoutineRunnerReceipt(child.stdout);
    const receipt = parsed.ok ? "receipt" in parsed ? parsed.receipt : parsed.receipts.length === 1 ? parsed.receipts[0] : undefined : undefined;
    const issue = receipt ? await durableRoutineRunnerReceiptIssue(receipt, { ...input.contract, contract: input.contract }, runtime.store, "SUCCESS") : "native reader receipt missing or malformed";
    let sourceClock = "NOT_VERIFIED";
    if (issue === null) {
      try {
        const clock = await runtime.store.clock(input.contract.sourceId, input.contract.recordClass, input.contract.scope, input.contract.parserNormalizerVersion);
        sourceClock = await syncNativeSourceClock(runtime.repos.doors, input.contract.id, clock, runtime.now());
      } catch (error) { sourceClock = `UNAVAILABLE:${sanitizedErrorDiagnostic(error)}`; }
    }
    return { succeeded: issue === null, detail: issue ?? `${input.contract.id} published or confirmed its verified reader projection; source clock ${sourceClock}`,
      measurement, combinedPeakUpperBoundBytes };
  } finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { release(); }
  }
}

export function heldMeetingExecutor(runtime: HeldMeetingWorkerRuntime, task: RouteTask, holder: string): DeclaredExecutor {
  if (!isHeldMeetingTask(task)) throw new Error("HELD_MEETING_TASK_REQUIRED");
  const spec = task.workerTask!, contract = spec.contract;
  if (contract.schemaVersion !== 2) throw new Error("HELD_MEETING_CONTRACT_REQUIRED");
  const worker: WorkerRef = { role: "ACQUIRER", provider: "we-the-people", version: VERSION, instance: holder };
  return { lane: "DETERMINISTIC", workerFor: () => worker, run: async ({ attemptId, workItemId, routeTaskId, bound, assertLeaseHealthy }) => {
    const start = performance.now();
    let measurement: DiggerMeasurement | null = null;
    let nativeMayHaveRun = false;
    const cost = () => ({ ...ZERO_COST, usd: 0, inputTokens: 0, outputTokens: 0, durationMs: Math.round(performance.now() - start),
      requestCount: measurement?.requests ?? (nativeMayHaveRun ? null : 0),
      bytesFetched: measurement?.bytesRead ?? (measurement?.requests === 0 || !nativeMayHaveRun ? 0 : null) });
    try {
      if (workItemId !== task.workItemId || routeTaskId !== task.id || contract.sourceScope.routeIds.length !== 1 ||
        contract.sourceScope.observationArtifactIds.length !== 1 || contract.sourceScope.observationArtifactIds[0] !== spec.artifactId) throw new Error("HELD_MEETING_TASK_BINDING_REFUSED");
      const held = await sourceReceipt(runtime.repos, workItemId, contract.sourceScope.routeIds[0]!, spec.artifactId);
      if (!held || held.item.subject !== contract.subjectId || held.record.recordedAt !== contract.expectedSourceDate ||
        contract.sourceScope.canonicalUrls[0] !== held.sourceUrl || !contract.sourceScope.canonicalUrls.includes(held.record.canonicalUrl)) throw new Error("HELD_MEETING_SOURCE_RECEIPT_REFUSED");
      const acquiring = await readHeldMeetingCapture(runtime.vault, held.item.project, held.record);
      if (acquiring.artifact.methodRouteId !== held.route.routeId || Date.parse(acquiring.artifact.retrievedAt) < Date.parse(held.attempt.startedAt) ||
        Date.parse(acquiring.artifact.retrievedAt) > Date.parse(held.attempt.endedAt!)) throw new Error("HELD_MEETING_CAPTURE_BINDING_REFUSED");
      const doorRows = await runtime.repos.doors.listWhere(["bodyIds", "0"], held.item.subject);
      const doors = doorRows
        .map(row => row.value).filter(row => isDoorRecord(row) && row.bodyIds.length === 1 && row.bodyIds[0] === held.item.subject);
      installDoorRecords(doors, "this held subject's own current source doors");
      const source = sourcePartition(held.item.subject, held.route, held.sourceUrl), native = nativeContract(source, held.route);
      const partition = nativePartition(source, native);
      const door = doors.find(row => row.doorId === partition.id);
      if (!door || !isDoorRecord(door) || door.bodyIds.length !== 1 || door.bodyIds[0] !== held.item.subject) throw new Error("HELD_MEETING_DOOR_NOT_ONE_BODY");
      const current = await runtime.repos.attempts.mustRead(attemptId);
      if (current.value.workItemId !== workItemId || current.value.routeTaskId !== routeTaskId || current.value.outcome !== null) throw new Error("HELD_MEETING_ATTEMPT_BINDING_REFUSED");
      const grant = defaultGrant({ role: worker.role, project: held.item.project, policyVersion: FLEET_POLICY_VERSION, grantedAt: current.value.startedAt });
      await runtime.repos.attempts.compareAndSet(attemptId, current.revision, { ...current.value, capabilityGrant: grant }, runtime.now());
      requireCapability(grant, "VAULT_READ_SANITIZED");
      const original = acquiring.artifact;
      const capture: RetainedSourceResponse | undefined = original.tier === "RAW" && [held.sourceUrl, original.retrievalUrl].every(url => new URL(url).protocol === "https:") ? { source: source.meetingSource, requestedUrl: held.sourceUrl, finalUrl: original.retrievalUrl,
        httpStatus: original.httpStatus, rawHash: original.contentHash.slice("sha256-".length), byteCount: original.byteLength,
        bytes: acquiring.bytes, retrievedAt: original.retrievedAt, contentType: original.contentType } : undefined;
      const result = await runHeldMeetingNative(runtime, { partition, contract: native, door, capture,
        deadlineMs: Date.now() + Math.max(1, bound.maxWallMs - (performance.now() - start)), assertLeaseHealthy,
        onSourceStarting: () => { nativeMayHaveRun = true; } });
      measurement = result.measurement;
      if (!result.succeeded) throw new Error(result.detail);
      const endedAt = runtime.now(), measured = cost(), quote = original.tier === "RESTRICTED_RAW" ? "" : new TextDecoder().decode(acquiring.bytes).slice(0, 300);
      const detail = `${result.detail}; original acquisition ${original.retrievedAt}; ${measurement?.factsWouldAttach ?? 0} new facts; ` +
        `combined parent/child peak upper bound ${result.combinedPeakUpperBoundBytes} bytes. ` +
        (capture ? "Raw capture offered for exact-URL replay. " : `Original ${original.tier} capture was not replayed; the native reader acquired its own source evidence. `) +
        "Independent remaining details stay owed.";
      const research: AcquirerResult = { role: "ACQUIRER", attemptId, verdict: "ACQUIRED", source: {
        id: held.route.routeId, subjectId: held.item.subject, jurisdiction: contract.jurisdiction.state, recordClass: HELD_MEETING_DETAILS_CLASS,
        sourceId: original.sourceId, publisher: contract.sourceScope.publisher, url: original.canonicalUrl, observedLocator: held.sourceUrl,
        observedAt: original.retrievedAt, firstObservedAt: original.retrievedAt, methodVersion: contract.methodVersion, permission: "ALLOWED", retrieval: "fetch_public",
        nextRouteIds: [], applicableBecause: "The held body's own registered native source reader consumes its exact saved HTTP receipt.",
        observation: { artifactId: original.id, contentHash: original.contentHash, start: 0, end: quote.length, quote, offsetUnit: "UTF16_CODE_UNITS" }, publisherSubjectEvidence: [] },
        artifacts: [{ artifactId: original.id, sourceRouteId: held.route.routeId, sourceObservationArtifactId: original.id, canonicalUrl: original.canonicalUrl,
          sourceId: original.sourceId, acquisitionAttemptId: original.attemptId, retrievedAt: original.retrievedAt, contentHash: original.contentHash,
          byteCount: original.byteLength, contentType: original.contentType, tier: original.tier, completeness: "COMPLETE", vaultKey: acquiring.key,
          transport: "REACHABLE", httpStatus: original.httpStatus, reused: true }], artifactIds: [original.id], blockers: [],
        findings: [{ code: "HELD_MEETING_DETAILS_PUBLISHED", severity: "INFO", detail }], walk: [{ sequence: 0, at: endedAt, worker, attemptId,
          routeId: held.route.routeId, rung: "native_reader", target: original.canonicalUrl, applicableBecause: "Existing native reader and exact routine authority.",
          permission: "ALLOWED", transport: "REACHABLE", observed: detail, returnedCount: measurement?.factsFound ?? 0, artifactIds: [original.id], nextRouteIds: [],
          outcome: "WALKED_AND_FOUND", pass: "INITIAL" }], walkState: { state: "OPEN", nextRouteIds: [] }, requestCount: measurement?.requests ?? 0, bytesFetched: measurement?.bytesRead ?? 0 };
      return { kind: "RESULT_RECORDED", ranAs: "DETERMINISTIC", cost: measured, detail, workerResult: { id: `wr-${fingerprint([attemptId])}`,
        schemaVersion: 1, workItemId, routeTaskId, attemptId, worker, grant, methodVersion: current.value.methodVersion, policyVersion: current.value.policyVersion,
        startedAt: current.value.startedAt, endedAt, executionMode: "DETERMINISTIC", cost: measured,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, uncachedInputTokens: 0 },
        inputArtifactIds: [original.id], inputResultIds: [], semanticHash: contentHash(canonicalJson(research)), result: research } };
    } catch (error) {
      return { kind: "ABORTED", ranAs: "DETERMINISTIC", endedAt: runtime.now(), cost: cost(), detail: error instanceof Error ? error.message : String(error) };
    }
  } };
}
