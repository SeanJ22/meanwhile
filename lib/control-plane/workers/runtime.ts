import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { ZERO_COST, type WorkerRef } from "../attempt.ts";
import { defaultGrant, requireCapability, type CapabilityGrant } from "../capability.ts";
import { contentHash, fingerprint } from "../ids.ts";
import { isParserInput, type ParserInput } from "../evidence/parser-boundary.ts";
import { createRouteTask, type RouteTask } from "../route-task.ts";
import { registerRouteTask } from "../repository/coordinator.ts";
import { readCompletedWorkerResult, reconcileWorkerCompletions, type UncommittedWorkerResult } from "../repository/worker-completion.ts";
import { canonicalJson, type ControlPlaneRepositories } from "../repository/types.ts";
import { dispatchOne, type DeclaredExecutor, type DispatchResult } from "../scheduler/dispatch.ts";
import type { ScheduledObligation } from "../scheduler/obligation.ts";
import { ceilingPermits, RESEARCH_BOUNDS, researchSpendInWindow } from "../scheduler/research-policy.ts";
import { workerTaskAdmission } from "./scheduling.ts";
import { bundleProcedure, runIsolatedWorker } from "./isolation.ts";
import { normalizedParserResult } from "./parser.ts";
import { assertFleetResult, type AuditCandidate, type AuditorResult, type CivicExtractionContract, type FleetInput,
  type FleetRole, type IndependentAuditContext, type WorkerEvidence, type WorkerResultRecord, type WorkerTaskSpec, type WorkerUsage } from "./types.ts";

export const FLEET_IMPLEMENTATION_VERSION = "civic-record-workers/2.0.0";
export const FLEET_POLICY_VERSION = "worker-fleet/2; R248 R252 R263 R264 R268";
const NULL_USAGE: WorkerUsage = { inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null, uncachedInputTokens: null };

export function fleetGrant(role: FleetRole, project: string, now: string): CapabilityGrant {
  const base = defaultGrant({ role, project, policyVersion: FLEET_POLICY_VERSION, grantedAt: now });
  return { ...base, capabilities: role === "ADVERSARIAL_AUDITOR" ? ["VAULT_READ_SANITIZED", "NETWORK_PUBLIC_READ"] : ["VAULT_READ_SANITIZED"] };
}

export function evidenceProjection(input: ParserInput): WorkerEvidence {
  if (!isParserInput(input) || contentHash(input.text) !== input.contentHash || input.tier === "RESTRICTED_RAW") throw new Error("WORKER_VAULT_INPUT_REFUSED");
  return { artifactId: input.artifactId, contentHash: input.contentHash, text: input.text, acquiredByAttemptId: input.attemptId,
    canonicalUrl: input.canonicalUrl, retrievedAt: input.retrievedAt, sourceId: input.sourceId, methodRouteId: input.methodRouteId };
}

export interface FleetRuntime {
  readonly roleExecutor?: (task: RouteTask, holder: string) => DeclaredExecutor;
  readonly repos: ControlPlaneRepositories;
  readonly readEvidence: (artifactId: string) => Promise<ParserInput>;
  /** Receives canonical scope only, before the producer or validator result is read. */
  readonly independentContext: (input: Pick<WorkerTaskSpec, "artifactId" | "contract" | "auditScope"> & { methodVersion: number }) => Promise<IndependentAuditContext>;
  readonly methodVersion: number;
  readonly requireModelAudit?: boolean;
  readonly now?: () => string;
  readonly auditReasoner?: {
    readonly workerProvider: string;
    readonly workerVersion: string;
    readonly review: (context: IndependentAuditContext, attemptId: string) => Promise<{
      review: NonNullable<WorkerResultRecord["modelReview"]>; usage: WorkerUsage; usd: number | null;
    }>;
  };
}

export async function enqueueWorkerTask(repos: ControlPlaneRepositories, input: {
  workItemId: string; role: FleetRole; artifactId: string; contract: CivicExtractionContract; now: string;
  producerResultId?: string; validatorResultId?: string; auditScope?: WorkerTaskSpec["auditScope"]; replayLabel?: string;
  purpose?: WorkerTaskSpec["purpose"];
  acquisition?: WorkerTaskSpec["acquisition"]; detective?: WorkerTaskSpec["detective"]; engineering?: WorkerTaskSpec["engineering"];
}): Promise<RouteTask> {
  const spec: WorkerTaskSpec = { schemaVersion: 1, role: input.role, artifactId: input.artifactId, contract: input.contract,
    producerResultId: input.producerResultId ?? null, validatorResultId: input.validatorResultId ?? null,
    auditScope: input.auditScope ?? "CAPTURED_ARTIFACT", implementationVersion: FLEET_IMPLEMENTATION_VERSION,
    ...(input.purpose ? { purpose: input.purpose } : {}),
    ...(input.acquisition ? { acquisition: input.acquisition } : {}), ...(input.detective ? { detective: input.detective } : {}),
    ...(input.engineering ? { engineering: input.engineering } : {}) };
  const signature = fingerprint([canonicalJson(spec), input.replayLabel ?? "canonical"]);
  const task: RouteTask = { ...createRouteTask({ workItemId: input.workItemId, routeId: `worker:${input.role}:${signature}`,
    routeLabel: `${input.role} ${input.contract.recordClass} ${FLEET_IMPLEMENTATION_VERSION}`, target: input.artifactId,
    inherited: false, now: input.now }), workerTask: spec };
  const held = await repos.routeTasks.read(task.id);
  if (held) return held.value;
  return (await registerRouteTask(repos, task, input.now)).value;
}

export function fleetExecutor(runtime: FleetRuntime, task: RouteTask, holder: string): DeclaredExecutor {
  const spec = task.workerTask;
  if (!spec) throw new Error("WORKER_TASK_SPEC_MISSING");
  const role = spec.role;
  if (role === "ACQUIRER" || role === "DETECTIVE" || role === "ENGINEERING") {
    if (!runtime.roleExecutor) throw new Error("AUTONOMOUS_ROLE_RUNTIME_UNAVAILABLE");
    return runtime.roleExecutor(task, holder);
  }
  const assisted = role === "ADVERSARIAL_AUDITOR" && runtime.auditReasoner !== undefined;
  const lane = assisted ? "BOUNDED_MODEL_WORKER" : "DETERMINISTIC";
  const worker: WorkerRef = { role, provider: assisted ? runtime.auditReasoner!.workerProvider : "we-the-people",
    version: assisted ? runtime.auditReasoner!.workerVersion : FLEET_IMPLEMENTATION_VERSION, instance: holder };
  return { lane, workerFor: () => worker, run: async ({ attemptId, workItemId, routeTaskId, bound }) => {
    const started = performance.now();
    const now = runtime.now ?? (() => new Date().toISOString());
    const attemptRow = await runtime.repos.attempts.mustRead(attemptId);
    const attempt = attemptRow.value;
    const project = (await runtime.repos.workItems.mustRead(workItemId)).value.project;
    const grant = fleetGrant(role, project, attempt.startedAt);
    await runtime.repos.attempts.compareAndSet(attemptId, attemptRow.revision, { ...attempt, capabilityGrant: grant }, now());
    requireCapability(grant, "VAULT_READ_SANITIZED");
    // Establish the evidence universe before even loading candidate records.
    let independent: IndependentAuditContext | undefined;
    let model: Awaited<ReturnType<NonNullable<FleetRuntime["auditReasoner"]>["review"]>> | undefined;
    let modelRequested = false;
    try {
    if (role === "ADVERSARIAL_AUDITOR") {
      if (runtime.requireModelAudit && !runtime.auditReasoner) throw new Error("DENIED_BY_POLICY:AUDIT_MODEL_TRANSPORT_UNAVAILABLE");
      independent = await runtime.independentContext({ artifactId: spec.artifactId, contract: spec.contract, auditScope: spec.auditScope, methodVersion: runtime.methodVersion });
      const allowed = new Set(["subjectId", "contract", "publisherSurfaces", "methodVersion", "routes", "evidence", "surfaceEvidence", "authorityEvidence", "startedFrom", "scope"]);
      if (Object.keys(independent).some(k => !allowed.has(k)) || independent.subjectId !== spec.contract.subjectId ||
          independent.methodVersion !== runtime.methodVersion || independent.startedFrom.includes("OUR_SUMMARY")) throw new Error("AUDIT_STARTING_CONTEXT_NOT_INDEPENDENT");
      if (runtime.auditReasoner) {
        requireCapability(grant, "NETWORK_PUBLIC_READ");
        modelRequested = true;
        model = await runtime.auditReasoner.review(independent, attemptId);
      }
    }
    const evidence = evidenceProjection(await runtime.readEvidence(spec.artifactId));
    if (evidence.artifactId !== spec.artifactId) throw new Error("WORKER_EXACT_ARTIFACT_BINDING_REFUSED");
    const inputs: string[] = [];
    let input: FleetInput = { attemptId, worker, evidence, contract: spec.contract };
    if (role !== "PARSER") {
      if (!spec.producerResultId) throw new Error("WORKER_PRODUCER_REFERENCE_MISSING");
      const producer = await readCompletedWorkerResult(runtime.repos, spec.producerResultId);
      if (producer.record.result.role !== "PARSER" || producer.record.result.verdict !== "EXTRACTED" ||
          producer.record.workItemId !== workItemId || producer.record.result.artifactId !== spec.artifactId ||
          canonicalJson(producer.record.completion.completedTask.workerTask!.contract) !== canonicalJson(spec.contract)) throw new Error("WORKER_EXACT_CANDIDATE_BINDING_REFUSED");
      inputs.push(producer.record.id);
      if (role === "VALIDATOR") input = { attemptId, worker, producer: producer.attempt.worker, producerAttemptId: producer.attempt.id, evidence, contract: spec.contract, candidate: producer.record.result,
        verifiedAt: now(), authorityEvidence: spec.contract.schemaVersion === 2 ? await Promise.all([...new Set(spec.contract.verification.authorities.flatMap(a => [...a.artifactIds, ...a.authorityEvidenceArtifactIds]))].map(async id => evidenceProjection(await runtime.readEvidence(id)))) : [] };
      else {
        if (!spec.validatorResultId || !independent) throw new Error("AUDIT_VALIDATOR_REFERENCE_MISSING");
        const validator = await readCompletedWorkerResult(runtime.repos, spec.validatorResultId);
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
    let result = await runIsolatedWorker(role, input, grant, Math.min(bound.maxWallMs, 30_000));
    if (result.role === "ADVERSARIAL_AUDITOR" && model && model.review.verdict !== "SURVIVED" && result.verdict !== "BROKE") {
      result = { ...result, verdict: "INCONCLUSIVE", survivingRecordCount: 0, findings: [...result.findings,
        { code: "AUDIT_MODEL_HYPOTHESIS_REQUIRES_MACHINE_EVIDENCE", detail: "The independent model review left an unresolved challenge; its assertions do not certify civic facts.", severity: "BLOCKING" }] } satisfies AuditorResult;
    }
    assertFleetResult(result, role, attemptId);
    const durationMs = Math.round(performance.now() - started);
    const usage = model?.usage ?? NULL_USAGE;
    const cost = { ...ZERO_COST, durationMs, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, usd: model?.usd ?? null, requestCount: model ? 1 : 0 };
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
    };
    return { kind: "RESULT_RECORDED", ranAs: lane, workerResult, cost, detail: `${role} ${result.verdict}; ${workerResult.id}; promotion authority absent` };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "WORKER_EXECUTION_FAILED";
      const denied = detail.startsWith("DENIED_BY_POLICY") || (error instanceof Error && error.name === "NetworkAccessDenied");
      const usage = model?.usage ?? NULL_USAGE;
      return { kind: "ABORTED", ranAs: lane, endedAt: now(), detail,
        failureOutcome: denied ? "DENIED_BY_POLICY" : detail.includes("BOUND_EXCEEDED") ? "TIMED_OUT" : detail.includes("PROCESS_CRASHED") ? "CRASHED" : "ABORTED",
        cost: { ...ZERO_COST, durationMs: Math.round(performance.now() - started), inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
          usd: model?.usd ?? null, requestCount: modelRequested && !denied ? 1 : 0 } };
    }
  } };
}

export async function dispatchWorkerTask(runtime: FleetRuntime, task: RouteTask): Promise<DispatchResult> {
  // Scout and model-assisted audit share the same durable spend ledger. Hold
  // admission through completion so concurrent calls cannot spend one allowance.
  if (task.workerTask?.role === "ADVERSARIAL_AUDITOR" && runtime.auditReasoner) {
    return runtime.repos.locks.withLock("autonomous-model-admission", () => dispatchAdmittedWorkerTask(runtime, task));
  }
  return dispatchAdmittedWorkerTask(runtime, task);
}

async function dispatchAdmittedWorkerTask(runtime: FleetRuntime, task: RouteTask): Promise<DispatchResult> {
  task = (await runtime.repos.routeTasks.mustRead(task.id)).value;
  if (!task.workerTask) throw new Error("WORKER_TASK_SPEC_MISSING");
  if (!["PENDING", "RECLAIMABLE"].includes(task.state)) throw new Error("WORKER_TASK_NOT_DISPATCHABLE");
  const now = (runtime.now ?? (() => new Date().toISOString()))();
  const holder = `fleet:${task.workerTask.role}:${randomUUID()}`;
  const executor = fleetExecutor(runtime, task, holder);
  const obligation: ScheduledObligation = { obligation: { id: task.id, recordClass: task.workerTask.contract.recordClass,
    subjectId: task.workerTask.contract.subjectId, routeId: task.routeId, active: true, readerImpactAt: null,
    observedChangeRateHours: null, lastWorkedAt: null }, nextDueAt: task.createdAt, cadenceHours: 24,
    cadenceSource: "DEFAULT_NO_SIGNAL", basis: "A persisted bounded worker task is due until its computation commits." };
  return dispatchOne(runtime.repos, { obligation, routeTaskId: task.id, holder, now, leaseTtlMs: 300_000,
    bound: { maxAttempts: 3, maxWallMs: 120_000, maxCostUnits: 20_000 }, maturity: () => executor.lane === "DETERMINISTIC" ? "GRADUATED" : "UNGRADUATED",
    executor, methodVersion: runtime.methodVersion, policyVersion: FLEET_POLICY_VERSION });
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
    const spend = researchSpendInWindow(await runtime.repos.costs.readAll(), now);
    if (ceilingPermits(spend.windowUsd, RESEARCH_BOUNDS.dailyCeilingUsd).permits) reason = "The existing rolling-cost window now permits admission; no ceiling or grant was changed.";
  }
  if (!reason) return null;
  const { policyDenial: _denial, ...rest } = task;
  return (await runtime.repos.routeTasks.compareAndSet(task.id, row.revision, { ...rest, state: "RECLAIMABLE",
    policyReauthorizations: [...(task.policyReauthorizations ?? []), { at: now, denial, reason }] }, now)).value;
}

export async function drainWorkerQueue(runtime: FleetRuntime, maximum = 3, accepts: (task: RouteTask) => boolean = () => true): Promise<readonly DispatchResult[]> {
  await reconcileWorkerCompletions(runtime.repos);
  const out: DispatchResult[] = [];
  const attempts = (await runtime.repos.attempts.list()).map(a => a.value);
  for (const row of await runtime.repos.routeTasks.list()) {
    let task = row.value;
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
    out.push(await dispatchWorkerTask(runtime, task));
  }
  return out;
}
