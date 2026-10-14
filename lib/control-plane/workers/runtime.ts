import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { ZERO_COST, type AttemptCost, type WorkerRef } from "../attempt.ts";
import { defaultGrant, requireCapability, type CapabilityGrant } from "../capability.ts";
import { contentHash, fingerprint } from "../ids.ts";
import type { ParserInput } from "../evidence/parser-boundary.ts";
import { evidenceProjection } from "./evidence-projection.ts";
export { evidenceProjection } from "./evidence-projection.ts";
import { createRouteTask, type RouteTask } from "../route-task.ts";
import { registerRouteTask } from "../repository/coordinator.ts";
import { readCompletedWorkerResult, reconcileWorkerCompletions, type UncommittedWorkerResult } from "../repository/worker-completion.ts";
import { canonicalJson, type ControlPlaneRepositories } from "../repository/types.ts";
import { dispatchOne, hunterWallLimitMs, proofChargeOf, type DeclaredExecutor, type DispatchResult } from "../scheduler/dispatch.ts";
import type { ScheduledObligation } from "../scheduler/obligation.ts";
import { ceilingPermits, RESEARCH_BOUNDS, researchSpendInWindow } from "../scheduler/research-policy.ts";
import { workerTaskAdmission } from "./scheduling.ts";
import { MODEL_FOR_CLASS } from "../scheduler/model-routing.ts";
import { isRetiredRoutineMeetingAcquisition } from "./autonomous-plan.ts";
import { bundleProcedure, runIsolatedWorker } from "./isolation.ts";
import { normalizedParserResult } from "./parser.ts";
import { ModelParseFailure, type ModelParseOutcome, type modelParseReasoner } from "./model-parser.ts";
import { auditLearningEntries } from "./audit-sampling.ts";
import { writeFieldManual } from "../field-manual.ts";
import { assertFleetResult, type AuditCandidate, type AuditorResult, type CivicExtractionContract, type FleetInput,
  type FleetRole, type IndependentAuditContext, type ParserWorkerInput, type WorkerResultRecord, type WorkerTaskSpec, type WorkerUsage } from "./types.ts";
import { readSpendWindow } from "../spend-window.ts";

export const FLEET_IMPLEMENTATION_VERSION = "civic-record-workers/2.0.0";
export const FLEET_POLICY_VERSION = "worker-fleet/2; R248 R252 R263 R264 R268";
const NULL_USAGE: WorkerUsage = { inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null, uncachedInputTokens: null };

/** The whole prompt a worker usage describes: uncached remainder plus cache reads and writes. Null when the base count is unmeasured. */
function wholePrompt(usage: WorkerUsage): number | null {
  if (usage.inputTokens === null) return null;
  return usage.inputTokens + (usage.cacheReadInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0);
}

/** `modelParse`: a PARSER whose contract has no parsing rule reaches the model provider, so it holds the same network capability the model-assisted auditor does. */
export function fleetGrant(role: FleetRole, project: string, now: string, modelParse = false): CapabilityGrant {
  const base = defaultGrant({ role, project, policyVersion: FLEET_POLICY_VERSION, grantedAt: now });
  return { ...base, capabilities: role === "ADVERSARIAL_AUDITOR" || modelParse ? ["VAULT_READ_SANITIZED", "NETWORK_PUBLIC_READ"] : ["VAULT_READ_SANITIZED"] };
}

/** A PARSER task whose contract names no parsing rule (format UNSUPPORTED) and a runtime that can quote-extract it with a model. */
export function usesModelParse(runtime: Pick<FleetRuntime, "parseReasoner">, spec: Pick<WorkerTaskSpec, "role" | "contract">): boolean {
  return spec.role === "PARSER" && runtime.parseReasoner !== undefined && spec.contract.schemaVersion === 2 && spec.contract.extraction.format === "UNSUPPORTED";
}

export interface FleetRuntime {
  /** Set by the production standing runner; no production runtime may use a legacy meeting ACQUIRER as a fallback. */
  readonly routineMeetingsAuthority?: "PERMANENT_CIVIC_DATA_PLANE";
  readonly roleExecutor?: (task: RouteTask, holder: string) => DeclaredExecutor;
  readonly repos: ControlPlaneRepositories;
  readonly readEvidence: (artifactId: string) => Promise<ParserInput>;
  /** Receives canonical scope only, before the producer or validator result is read. */
  readonly independentContext: (input: Pick<WorkerTaskSpec, "artifactId" | "contract" | "auditScope"> & { methodVersion: number; workItemId?: string }) => Promise<IndependentAuditContext>;
  readonly methodVersion: number;
  readonly requireModelAudit?: boolean;
  /** Whether the model's adversarial review runs on an audit. Absent: every audit is reviewed. The deterministic audit always runs. */
  readonly modelAuditSample?: (spec: WorkerTaskSpec) => Promise<boolean>;
  /** Exact subjects whose model calls reserve the selected lifetime hunt budget durably. */
  readonly lifetimeHuntSubject?: (subjectId: string) => boolean;
  readonly rollingCeilingUsd?: number;
  /** History reads scoped to the task's own work item, subject and lineage (`scoped-history.ts`). Absent: whole-table reads. */
  readonly scopedReads?: boolean;
  readonly now?: () => string;
  /** The parser's fallback when no parsing rule exists: a model pulls the fields with exact quotes and code confirms each quote is in the saved document (model-parser.ts). */
  readonly parseReasoner?: ReturnType<typeof modelParseReasoner>;
  readonly auditReasoner?: {
    readonly workerProvider: string;
    readonly workerVersion: string;
    readonly review: (context: IndependentAuditContext, attemptId: string, escalation?: WorkerTaskSpec["auditEscalation"]) => Promise<{
      review: NonNullable<WorkerResultRecord["modelReview"]>; usage: WorkerUsage; usd: number | null;
      /** The provider's usage-block metering fields. Absent from an older reasoner: the row reads UNREPORTED. */
      metering?: Pick<AttemptCost, "cacheReadInputTokens" | "cacheCreationInputTokens" | "cacheCreation5mInputTokens" | "cacheCreation1hInputTokens" | "uncachedInputTokens" | "batch" | "modelRequestCount" | "batchRequestCount" | "batchEligibleRequestCount" | "listPriceUsd">;
    }>;
  };
}

export async function enqueueWorkerTask(repos: ControlPlaneRepositories, input: {
  workItemId: string; role: FleetRole; artifactId: string; contract: CivicExtractionContract; now: string;
  producerResultId?: string; validatorResultId?: string; auditScope?: WorkerTaskSpec["auditScope"]; replayLabel?: string;
  purpose?: WorkerTaskSpec["purpose"];
  acquisition?: WorkerTaskSpec["acquisition"];
  auditEscalation?: WorkerTaskSpec["auditEscalation"];
}): Promise<RouteTask> {
  const spec: WorkerTaskSpec = { schemaVersion: 1, role: input.role, artifactId: input.artifactId, contract: input.contract,
    producerResultId: input.producerResultId ?? null, validatorResultId: input.validatorResultId ?? null,
    auditScope: input.auditScope ?? "CAPTURED_ARTIFACT", implementationVersion: FLEET_IMPLEMENTATION_VERSION,
    ...(input.auditEscalation ? { auditEscalation: input.auditEscalation } : {}),
    ...(input.purpose ? { purpose: input.purpose } : {}),
    ...(input.acquisition ? { acquisition: input.acquisition } : {}) };
  const signature = fingerprint([canonicalJson(spec), input.replayLabel ?? "canonical"]);
  const task: RouteTask = { ...createRouteTask({ workItemId: input.workItemId, routeId: `worker:${input.role}:${signature}`,
    routeLabel: `${input.role} ${input.contract.recordClass} ${FLEET_IMPLEMENTATION_VERSION}`, target: input.artifactId,
    inherited: false, now: input.now }), workerTask: spec };
  const held = await repos.routeTasks.read(task.id);
  if (held) return held.value;
  return (await registerRouteTask(repos, task, input.now)).value;
}

/**
 * `modelAudit`: whether the model's adversarial review runs on this audit. The deterministic audit runs on every
 * validated record; the model review is sampled across strata (audit-sampling.ts), on the cheapest tier.
 */
export function fleetExecutor(runtime: FleetRuntime, task: RouteTask, holder: string, modelAudit = true): DeclaredExecutor {
  const spec = task.workerTask;
  if (!spec) throw new Error("WORKER_TASK_SPEC_MISSING");
  const role = spec.role;
  if (role === "ACQUIRER" || role === "DETECTIVE") {
    if (!runtime.roleExecutor) throw new Error("AUTONOMOUS_ROLE_RUNTIME_UNAVAILABLE");
    return runtime.roleExecutor(task, holder);
  }
  const parseAssisted = usesModelParse(runtime, spec);
  const auditAssisted = role === "ADVERSARIAL_AUDITOR" && runtime.auditReasoner !== undefined && modelAudit;
  const assisted = auditAssisted || parseAssisted;
  const lane = assisted ? "BOUNDED_MODEL_WORKER" : "DETERMINISTIC";
  const worker: WorkerRef = { role, provider: parseAssisted ? runtime.parseReasoner!.workerProvider : auditAssisted ? runtime.auditReasoner!.workerProvider : "we-the-people",
    version: parseAssisted ? runtime.parseReasoner!.workerVersion : auditAssisted ? spec.auditEscalation ? MODEL_FOR_CLASS[spec.auditEscalation.to] : runtime.auditReasoner!.workerVersion : FLEET_IMPLEMENTATION_VERSION, instance: holder };
  return { lane, workerFor: () => worker, run: async ({ attemptId, workItemId, routeTaskId, bound }) => {
    const started = performance.now();
    const now = runtime.now ?? (() => new Date().toISOString());
    const attemptRow = await runtime.repos.attempts.mustRead(attemptId);
    const attempt = attemptRow.value;
    const project = (await runtime.repos.workItems.mustRead(workItemId)).value.project;
    const grant = fleetGrant(role, project, attempt.startedAt, parseAssisted);
    await runtime.repos.attempts.compareAndSet(attemptId, attemptRow.revision, { ...attempt, capabilityGrant: grant }, now());
    requireCapability(grant, "VAULT_READ_SANITIZED");
    // Establish the evidence universe before even loading candidate records.
    let independent: IndependentAuditContext | undefined;
    let model: Awaited<ReturnType<NonNullable<FleetRuntime["auditReasoner"]>["review"]>> | undefined;
    let parsed: ModelParseOutcome | undefined;
    let producerRecord: WorkerResultRecord | undefined;
    let modelRequested = false;
    try {
    if (role === "ADVERSARIAL_AUDITOR") {
      if (runtime.requireModelAudit && !runtime.auditReasoner) throw new Error("DENIED_BY_POLICY:AUDIT_MODEL_TRANSPORT_UNAVAILABLE");
      independent = await runtime.independentContext({ artifactId: spec.artifactId, contract: spec.contract, auditScope: spec.auditScope, methodVersion: runtime.methodVersion, workItemId });
      const allowed = new Set(["subjectId", "contract", "publisherSurfaces", "methodVersion", "routes", "evidence", "surfaceEvidence", "authorityEvidence", "startedFrom", "scope"]);
      if (Object.keys(independent).some(k => !allowed.has(k)) || independent.subjectId !== spec.contract.subjectId ||
          independent.methodVersion !== runtime.methodVersion || independent.startedFrom.includes("OUR_SUMMARY")) throw new Error("AUDIT_STARTING_CONTEXT_NOT_INDEPENDENT");
      if (runtime.auditReasoner && modelAudit) {
        requireCapability(grant, "NETWORK_PUBLIC_READ");
        modelRequested = true;
        model = await runtime.auditReasoner.review(independent, attemptId, spec.auditEscalation);
      }
    }
    const evidence = evidenceProjection(await runtime.readEvidence(spec.artifactId));
    if (evidence.artifactId !== spec.artifactId) throw new Error("WORKER_EXACT_ARTIFACT_BINDING_REFUSED");
    const inputs: string[] = [];
    let input: FleetInput = { attemptId, worker, evidence, contract: spec.contract };
    if (role !== "PARSER") {
      if (!spec.producerResultId) throw new Error("WORKER_PRODUCER_REFERENCE_MISSING");
      const heldResults = await runtime.repos.workerResults.read(workItemId);
      const heldRepos = { ...runtime.repos, workerResults: { ...runtime.repos.workerResults, readAll: async () => heldResults } };
      // Keep the exact producer validation and its current Attempt read. Only a
      // successfully read batch can fall back to classify an absent/foreign id.
      const readResult = (id: string) => readCompletedWorkerResult(
        heldResults.some(record => record.id === id) ? heldRepos : runtime.repos, id);
      const producer = await readResult(spec.producerResultId);
      if (producer.record.result.role !== "PARSER" || producer.record.result.verdict !== "EXTRACTED" ||
          producer.record.workItemId !== workItemId || producer.record.result.artifactId !== spec.artifactId ||
          canonicalJson(producer.record.completion.completedTask.workerTask!.contract) !== canonicalJson(spec.contract)) throw new Error("WORKER_EXACT_CANDIDATE_BINDING_REFUSED");
      inputs.push(producer.record.id);
      producerRecord = producer.record;
      if (role === "VALIDATOR") input = { attemptId, worker, producer: producer.attempt.worker, producerAttemptId: producer.attempt.id, evidence, contract: spec.contract, candidate: producer.record.result,
        verifiedAt: now(), authorityEvidence: spec.contract.schemaVersion === 2 ? await Promise.all([...new Set(spec.contract.verification.authorities.flatMap(a => [...a.artifactIds, ...a.authorityEvidenceArtifactIds]))].map(async id => evidenceProjection(await runtime.readEvidence(id)))) : [] };
      else {
        if (!spec.validatorResultId || !independent) throw new Error("AUDIT_VALIDATOR_REFERENCE_MISSING");
        const validator = await readResult(spec.validatorResultId);
        if (validator.record.result.role !== "VALIDATOR" ||
            (validator.record.result.verdict !== "PASS" && !(spec.contract.schemaVersion === 2 && validator.record.result.verdict === "INCONCLUSIVE" && validator.record.result.extractionVerdict === "PASS")) ||
            validator.record.result.producerAttemptId !== producer.attempt.id || validator.record.workItemId !== workItemId ||
            !validator.record.inputResultIds.includes(producer.record.id)) throw new Error("AUDIT_EXACT_VALIDATION_BINDING_REFUSED");
        inputs.push(validator.record.id);
        const candidate: AuditCandidate = { producer: producer.attempt.worker, validator: validator.attempt.worker,
          producerAttemptId: producer.attempt.id, validatorAttemptId: validator.attempt.id, extraction: producer.record.result,
          coveredRouteIds: independent.routes.filter(r => r.artifactIds.includes(spec.artifactId)).map(r => r.routeId),
          claimsAbsence: false, claimsUniverseComplete: spec.auditScope === "SOURCE_UNIVERSE", renderedRecordCount: null };
        input = { attemptId, worker, context: independent, candidate };
      }
    }
    if (parseAssisted) {
      requireCapability(grant, "NETWORK_PUBLIC_READ");
      modelRequested = true;
      parsed = await runtime.parseReasoner!.parse(input as ParserWorkerInput, worker);
    }
    let result = parsed ? parsed.result : await runIsolatedWorker(role, input, grant, 0);
    if (result.role === "ADVERSARIAL_AUDITOR" && model && model.review.verdict !== "SURVIVED" && result.verdict !== "BROKE") {
      result = { ...result, verdict: "INCONCLUSIVE", survivingRecordIds: [], survivingRecordCount: 0, findings: [...result.findings,
        { code: "AUDIT_MODEL_HYPOTHESIS_REQUIRES_MACHINE_EVIDENCE", detail: "The independent model review left an unresolved challenge; its assertions do not certify civic facts.", severity: "BLOCKING" }] } satisfies AuditorResult;
    }
    assertFleetResult(result, role, attemptId);
    if (result.role === "ADVERSARIAL_AUDITOR") {
      // Best effort: a store hiccup must not lose the result.
      await writeFieldManual(runtime.repos, auditLearningEntries({ result, auditResultId: `wr-${fingerprint([attemptId])}`, modelReviewed: model !== undefined,
        contract: spec.contract, ...(producerRecord ? { parser: producerRecord } : {}), observedAt: now() }), now()).catch(() => undefined);
    }
    const durationMs = Math.round(performance.now() - started);
    const usage = model?.usage ?? parsed?.usage ?? NULL_USAGE;
    // `inputTokens` on the cost row is the whole prompt (uncached remainder plus cache
    // reads and writes); the worker usage's `inputTokens` is the uncached remainder only.
    const shares = parsed?.review.byModel;
    const batchAccounting = shares ? {
      listPriceUsd: shares.some(s => s.listPriceUsd == null) ? null : shares.reduce((n, s) => n + s.listPriceUsd!, 0),
      modelRequestCount: shares.reduce((n, s) => n + s.requestCount, 0),
      batchRequestCount: shares.some(s => s.batchRequestCount == null) ? null : shares.reduce((n, s) => n + s.batchRequestCount!, 0),
      batchEligibleRequestCount: shares.some(s => s.batchEligibleRequestCount == null) ? null : shares.reduce((n, s) => n + s.batchEligibleRequestCount!, 0),
    } : {};
    const cost = { ...ZERO_COST, durationMs, inputTokens: wholePrompt(usage), outputTokens: usage.outputTokens, usd: model?.usd ?? parsed?.usd ?? null, requestCount: shares?.reduce((n,s)=>n+s.requestCount,0) ?? (model || parsed ? 1 : 0), ...(model?.metering ?? parsed?.metering ?? {}), ...batchAccounting };
    const workerResult: UncommittedWorkerResult = { id: `wr-${fingerprint([attemptId])}`, schemaVersion: 1,
      workItemId, routeTaskId, attemptId, worker, grant, methodVersion: attempt.methodVersion, policyVersion: attempt.policyVersion,
      startedAt: attempt.startedAt, endedAt: now(), executionMode: assisted ? "MODEL_ASSISTED" : "DETERMINISTIC", cost, usage,
      inputArtifactIds: [...new Set([spec.artifactId, ...(independent?.evidence.map(e => e.artifactId) ?? []), ...(independent?.surfaceEvidence?.map(e => e.artifactId) ?? []),
        ...(independent?.authorityEvidence?.map(e => e.artifactId) ?? []),
        ...(role === "VALIDATOR" && spec.contract.schemaVersion === 2 ? spec.contract.verification.authorities.flatMap(a => [...a.artifactIds,...a.authorityEvidenceArtifactIds]) : [])])], inputResultIds: inputs,
      semanticHash: contentHash(canonicalJson(result.role === "PARSER" ? normalizedParserResult(result) : result)), result,
      implementationHash: contentHash(await bundleProcedure(role)),
      ...(independent ? { auditContext: { ...independent,
        evidence: independent.evidence.map(({ text: _text, ...metadata }) => metadata),
        surfaceEvidence: (independent.surfaceEvidence ?? []).map(({ text: _text, ...metadata }) => metadata),
        authorityEvidence: (independent.authorityEvidence ?? []).map(({ text: _text, ...metadata }) => metadata) } } : {}),
      ...(model ? { modelReview: model.review } : {}),
      ...(parsed ? { modelParse: parsed.review } : {}),
    };
    return { kind: "RESULT_RECORDED", ranAs: lane, workerResult, cost, ...(parsed?.review.byModel ? { costByModel: parsed.review.byModel } : {}), detail: `${role} ${result.verdict}; ${workerResult.id}; promotion authority absent` };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "WORKER_EXECUTION_FAILED";
      const denied = detail.startsWith("DENIED_BY_POLICY") || (error instanceof Error && error.name === "NetworkAccessDenied");
      const partial = error instanceof ModelParseFailure ? error.accounting : null;
      const usage = partial?.usage ?? model?.usage ?? parsed?.usage ?? NULL_USAGE;
      return { kind: "ABORTED", ranAs: lane, endedAt: now(), detail,
        ...(partial ? { costByModel: partial.byModel } : {}),
        failureOutcome: denied ? "DENIED_BY_POLICY" : detail.includes("BOUND_EXCEEDED") ? "TIMED_OUT" : detail.includes("PROCESS_CRASHED") ? "CRASHED" : "ABORTED",
        cost: { ...ZERO_COST, durationMs: Math.round(performance.now() - started), inputTokens: wholePrompt(usage), outputTokens: usage.outputTokens,
          usd: partial ? partial.usd : model?.usd ?? parsed?.usd ?? null,
          requestCount: partial ? partial.byModel.reduce((sum, share) => sum + share.requestCount, 0) : modelRequested && !denied ? 1 : 0,
          ...(partial?.metering ?? model?.metering ?? parsed?.metering ?? {}) } };
    }
  } };
}

export async function dispatchWorkerTask(runtime: FleetRuntime, task: RouteTask): Promise<DispatchResult> {
  if (
    runtime.routineMeetingsAuthority === "PERMANENT_CIVIC_DATA_PLANE" &&
    task.workerTask?.role === "ACQUIRER" &&
    isRetiredRoutineMeetingAcquisition(task.workerTask.contract)
  ) {
    throw new Error(
      "PDC_ROUTINE_MEETINGS_ACQUISITION_RETIRED: meeting-partition contracts built from the meeting doors are the only standing acquisition authorities",
    );
  }
  const modelAudit = task.workerTask?.role === "ADVERSARIAL_AUDITOR" && runtime.auditReasoner !== undefined
    ? (runtime.modelAuditSample ? await runtime.modelAuditSample(task.workerTask) : true) : false;
  return dispatchAdmittedWorkerTask(runtime, task, modelAudit);
}

async function dispatchAdmittedWorkerTask(runtime: FleetRuntime, task: RouteTask, modelAudit: boolean): Promise<DispatchResult> {
  task = (await runtime.repos.routeTasks.mustRead(task.id)).value;
  if (!task.workerTask) throw new Error("WORKER_TASK_SPEC_MISSING");
  if (!["PENDING", "RECLAIMABLE"].includes(task.state)) throw new Error("WORKER_TASK_NOT_DISPATCHABLE");
  const now = (runtime.now ?? (() => new Date().toISOString()))();
  const holder = `fleet:${task.workerTask.role}:${randomUUID()}`;
  const executor = fleetExecutor(runtime, task, holder, modelAudit);
  const obligation: ScheduledObligation = { obligation: { id: task.id, recordClass: task.workerTask.contract.recordClass,
    subjectId: task.workerTask.contract.subjectId, routeId: task.routeId, active: true, readerImpactAt: null,
    observedChangeRateHours: null, lastWorkedAt: null }, nextDueAt: task.createdAt, cadenceHours: 24,
    cadenceSource: "DEFAULT_NO_SIGNAL", basis: "A persisted bounded worker task is due until its computation commits." };
  // A proof run's worker tasks charge under its own project, marked non-production.
  const proof = proofChargeOf((await runtime.repos.workItems.read(task.workItemId).catch(() => null))?.value.project);
  return dispatchOne(runtime.repos, { obligation, routeTaskId: task.id, holder, now, leaseTtlMs: 300_000,
    clock: runtime.now ?? (()=>new Date().toISOString()),
    bound: { maxAttempts: 3, maxWallMs: hunterWallLimitMs(), maxCostUnits: 20_000 }, maturity: () => executor.lane === "DETERMINISTIC" ? "GRADUATED" : "UNGRADUATED",
    executor, methodVersion: runtime.methodVersion, policyVersion: FLEET_POLICY_VERSION, ...proof });
}

/** Uses the existing RouteTask queue and dispatcher, including their lease ownership. */
export async function reauthorizeWorkerTask(runtime: FleetRuntime, task: RouteTask, now: string): Promise<RouteTask | null> {
  const row = await runtime.repos.routeTasks.mustRead(task.id);
  task = row.value;
  const denial = task.policyDenial;
  if (task.state !== "POLICY_DENIED" || !denial || task.workerTask?.role !== "ADVERSARIAL_AUDITOR") return null;
  let reason: string | null = null;
  if (denial.reason.includes("AUDIT_MODEL_TRANSPORT_UNAVAILABLE") && runtime.auditReasoner) reason = "The configured model transport is now available; the current capability and rolling-cost policy will be evaluated again.";
  if (denial.reason.includes("AUDIT_ROLLING_COST_CEILING")) {
    const spend = researchSpendInWindow(await readSpendWindow(runtime.repos, now), now);
    if (runtime.lifetimeHuntSubject?.(task.workerTask.contract.subjectId)) reason = "The selected lifetime hunt uses its durable reservation ledger; current policy will be checked again.";
    else if (ceilingPermits(spend.windowUsd, (runtime.rollingCeilingUsd ?? 0)).permits) reason = "The existing rolling-cost window now permits admission; no ceiling or grant was changed.";
  }
  if (!reason) return null;
  const { policyDenial: _denial, ...rest } = task;
  return (await runtime.repos.routeTasks.compareAndSet(task.id, row.revision, { ...rest, state: "RECLAIMABLE",
    policyReauthorizations: [...(task.policyReauthorizations ?? []), { at: now, denial, reason }] }, now)).value;
}

export async function drainWorkerQueue(
  runtime: FleetRuntime,
  maximum = Infinity,
  accepts: (task: RouteTask) => boolean = () => true,
  admitDispatch: (task: RouteTask) => { readonly admit: true } | { readonly admit: false; readonly code: string; readonly why: string } = () => ({ admit: true }),
): Promise<readonly DispatchResult[]> {
  await reconcileWorkerCompletions(runtime.repos);
  const out: DispatchResult[] = [];
  const attempts = (await runtime.repos.attempts.list()).map(a => a.value);
  for (const row of await runtime.repos.routeTasks.list()) {
    let task = row.value;
    if (
      runtime.routineMeetingsAuthority === "PERMANENT_CIVIC_DATA_PLANE" &&
      task.workerTask?.role === "ACQUIRER" &&
      isRetiredRoutineMeetingAcquisition(task.workerTask.contract)
    ) continue;
    if (!accepts(task)) continue;
    if (out.length >= maximum) break;
    const now = (runtime.now ?? (() => new Date().toISOString()))();
    const admission = workerTaskAdmission(task, attempts, now);
    if (!admission.due) continue;
    if (admission.requiresPolicyRecheck) {
      const reauthorized = await reauthorizeWorkerTask(runtime, task, now);
      if (!reauthorized) continue;
      task = reauthorized;
    }
    if (!admitDispatch(task).admit) continue;
    out.push(await dispatchWorkerTask(runtime, task));
  }
  return out;
}
