/**
 * **THE PAID-WORK GUARDS, IN ONE PLACE (CH-24).**
 *
 * Every paid model request a worker makes passes the same checks: the Send and
 * area budgets it is held against (MW-021), the Fleet ceiling and provider
 * circuits (FleetSafety), the provider's own rate limits, and the paid worker
 * capacity those leave. The research round built these inline; they live here
 * so the round and the standing lease-worker lane build the same guards from
 * the same objects, and one guard cannot drift from the other. Nothing here
 * changes a limit or reads a setting: the caller hands in the controllers it
 * armed from the owner's settings and the durable ledgers.
 */
import { randomUUID } from "node:crypto";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { attemptBatchJournal, batchEnabledFor, batchRequestHash, type backgroundBatchTransport } from "../model-batch.ts";
import { FleetPreSendRefusal, modelRequestWorstCaseUsd, modelResponseUsd, type FleetSafetyController } from "../fleet-safety.ts";
import type { armExpansionBudget } from "../expansion/membership.ts";
import type { AssignmentBudgetGate } from "../expansion/assignment-budget.ts";
import {
  DurableSpendHolds,
  JobSpend,
  SendBudgetRefusal,
  areaGuardedTransport,
  budgetGuardedTransport,
  type AutonomousJurisdiction,
  type BudgetLine,
  type BudgetLines,
} from "../expansion/spend-holds.ts";
import type { ModelProviderQueue } from "../scheduler/model-lane.ts";
import { RESEARCH_BOUNDS, researchPaidWorkerCapacity } from "../scheduler/research-policy.ts";
import type { ModelTransport } from "../scheduler/scout-executor.ts";
import { MODELS } from "../../models.ts";

export interface PaidWorkGuardDeps {
  readonly repos: ControlPlaneRepositories;
  /** The clock, as an ISO string. */
  readonly now: () => string;
  /** When the guards were armed (the round's start); names the autonomous holds. */
  readonly armedAt: string;
  readonly fleetSafety: FleetSafetyController;
  readonly providerQueue: ModelProviderQueue;
  readonly spendHolds: DurableSpendHolds;
  readonly assignmentBudget: Pick<AssignmentBudgetGate, "linesFor">;
  readonly expansionBudget: { readonly gate: Pick<ReturnType<typeof armExpansionBudget>["gate"], "linesFor"> } | null;
  /** Read what a lease worker's obligation needs before its lines are built (the standing lane reads each task's own Send marks). */
  readonly beforeObligation?: (obligationId: string) => Promise<void>;
  /** The provider transport for one request at a time, and the background batch transport. */
  readonly messages: ModelTransport;
  readonly batch: ReturnType<typeof backgroundBatchTransport>;
  /** Whether the paid model lane is open at all (`modelLaneClosure` found nothing closing it). */
  readonly modelLaneEnabled: boolean;
  /** The owner's rolling ceiling in force, re-read mid-round (CH-03). */
  readonly ceilingUsd: () => number;
  /** WTP_ANTHROPIC_REQUESTS_PER_MINUTE, when the runner's environment sets it. */
  readonly requestsPerMinute?: number;
  /** A sentence for the round's runtime conditions. */
  readonly onCondition: (sentence: string) => void;
}

export function paidWorkGuards(deps: PaidWorkGuardDeps) {
  const { repos, fleetSafety, providerQueue, spendHolds, assignmentBudget, expansionBudget } = deps;
  /** The Send and area lines one obligation's paid work is held against, or why it cannot be checked. */
  const budgetLinesFor = (obligationId: string, subjectId: string): { readonly lines: BudgetLines } | { readonly code: string; readonly why: string } => {
    const sends = assignmentBudget.linesFor(obligationId);
    if ("refusal" in sends) return { code: sends.refusal.code, why: sends.refusal.why };
    const areas = expansionBudget === null ? { lines: [] as readonly BudgetLine[] } : expansionBudget.gate.linesFor(subjectId);
    if ("refusal" in areas) return { code: areas.refusal.code, why: areas.refusal.why };
    return { lines: { sends: sends.lines, areas: areas.lines } };
  };
  /*
   * The autonomous Fleet's Scouts and auditor belong to no Send: each request
   * must fit the Fleet ceiling (the wrapped guard) and the area budget(s)
   * covering the jurisdiction the job researches, by the Scouts' own matching
   * rule — never another Send's budget (`areaGuardedTransport`). An area that
   * cannot be read, or the ledger, refuses.
   */
  /** Request holds taken and not yet settled: a sent request whose bill did not come back keeps its hold, and shutdown releases it (releaseOpenJobs). */
  const openJobs = new Set<JobSpend>();
  let autonomousHoldSeq = 0;
  const guardedMessagesFor = (work: string, transport: ModelTransport = deps.messages): ModelTransport =>
    providerQueue.transport(fleetSafety.guardedModelTransport("anthropic", work, transport));
  const autonomousTransportFor = (transport: ModelTransport) => (jurisdiction: AutonomousJurisdiction): ModelTransport =>
    areaGuardedTransport({
      transport: guardedMessagesFor(jurisdiction.subjectId, transport),
      holds: spendHolds,
      jurisdiction,
      areasFor: (j) => {
        if (expansionBudget === null) return { areas: [] };
        const found = expansionBudget.gate.linesFor(j.subjectId, j.state);
        return "refusal" in found ? { code: found.refusal.code, why: found.refusal.why } : { areas: found.lines };
      },
      worstCaseOf: modelRequestWorstCaseUsd,
      priceOf: modelResponseUsd,
      nextHoldId: () => `autonomous:${deps.armedAt}:${(autonomousHoldSeq += 1)}`,
      now: deps.now,
      refusedBeforeSending: (error) => error instanceof FleetPreSendRefusal,
    });
  let paidCapacityHoldSaid = false;
  const paidWorkerCapacity = (readyWork?: number) => {
    const limits = providerQueue.limits(MODELS.haiku.model);
    const spent = fleetSafety.admissionSpendUsd();
    const providerHeld = fleetSafety.snapshot(deps.now()).providerCircuits.some(circuit =>
      circuit.provider === "anthropic" && Date.parse(circuit.eligibleAt) > Date.parse(deps.now()));
    const capacity = researchPaidWorkerCapacity({
      modelEnabled: deps.modelLaneEnabled && !providerHeld,
      spentUsd: spent, ceilingUsd: deps.ceilingUsd(),
      ...(readyWork === undefined ? {} : { readyWork }),
      requestUsd: MODELS.haiku.outputUsdPerMillion * RESEARCH_BOUNDS.perDispatch.maxOutputTokensPerTurn / 1_000_000,
      requestsPerMinute: limits?.requestsPerMinute ?? deps.requestsPerMinute,
      inputTokensPerMinute: limits?.inputTokensPerMinute ?? undefined,
      outputTokensPerMinute: limits?.outputTokensPerMinute ?? undefined,
      inputTokensPerRequest: 8192, outputTokensPerRequest: RESEARCH_BOUNDS.perDispatch.maxOutputTokensPerTurn });
    if (deps.modelLaneEnabled && capacity === 0 && !paidCapacityHoldSaid) {
      paidCapacityHoldSaid = true;
      const reason = `paid model capacity is closed by ${providerHeld ? "the Anthropic provider circuit" : "the remaining budget or provider rate limits"}; held and plain-code work continue`;
      deps.onCondition(reason);
      console.log(`  Workers: ${reason}`);
    }
    return capacity;
  };
  /**
   * A lease worker's paid request, served by the process that owns the guards: held on the Send and area
   * lines of the obligation that opened its task, reserved against the Fleet ceiling, and settled at what it
   * measured. A refusal before sending releases its hold.
   */
  const workerTransportFor = (jurisdiction: AutonomousJurisdiction, taskId: string): ModelTransport => async request => {
    const task = (await repos.routeTasks.mustRead(taskId)).value;
    const batching = task.workerTask?.role === "ADVERSARIAL_AUDITOR" ? batchEnabledFor("background-worker-audit")
      : task.workerTask?.role === "PARSER" && batchEnabledFor("background-worker-parse");
    const journal = attemptBatchJournal(repos, taskId, deps.now);
    const requestJobId = `worker-request:${taskId}:${batching ? batchRequestHash(request) : randomUUID()}`;
    if (batching && await journal.read(batchRequestHash(request))) {
      // Recovery reads an already submitted request, so it neither reserves
      // nor spends a second request allowance. Settle its original hold.
      const response = await deps.batch.withJournal(journal)(request);
      const measured = modelResponseUsd(response);
      if (measured !== null) await spendHolds.settle(requestJobId, measured, deps.now());
      return response;
    }
    const occurrences = await repos.occurrences.listWhere(["workItemId"], task.workItemId);
    const owner = occurrences.find(row => row.value.routeTaskId === task.id) ?? (occurrences.length === 1 ? occurrences[0] : null);
    await deps.beforeObligation?.(owner?.value.obligationId ?? task.id);
    const found = budgetLinesFor(owner?.value.obligationId ?? task.id, jurisdiction.subjectId);
    if ("code" in found) throw new SendBudgetRefusal(found.code, found.why);
    const job = new JobSpend(spendHolds, requestJobId, owner?.value.obligationId ?? task.id, found.lines);
    openJobs.add(job);
    const transport = budgetGuardedTransport({ job: () => job,
      transport: batching ? fleetSafety.guardedModelTransport("anthropic", jurisdiction.subjectId,
        deps.batch.withJournal(journal)) : guardedMessagesFor(jurisdiction.subjectId),
      worstCaseOf: modelRequestWorstCaseUsd, priceOf: modelResponseUsd });
    let response;
    try { response = await transport(request); }
    catch (error) {
      if (error instanceof FleetPreSendRefusal || error instanceof SendBudgetRefusal) {
        openJobs.delete(job);
        const failed = await spendHolds.settle(job.jobId, 0, deps.now());
        if (failed !== null) deps.onCondition(`unsent request hold ${job.jobId} release failed: ${failed}`);
      }
      throw error;
    }
    const measured = modelResponseUsd(response);
    if (measured !== null) {
      openJobs.delete(job);
      await spendHolds.settle(job.jobId, measured, deps.now());
    }
    return response;
  };
  /** A changed ceiling may close capacity for a new reason; say it again. */
  const capacityNoticeReset = (): void => { paidCapacityHoldSaid = false; };
  return { budgetLinesFor, guardedMessagesFor, autonomousTransportFor, paidWorkerCapacity, workerTransportFor, capacityNoticeReset,
    openJobs: (): readonly JobSpend[] => [...openJobs] };
}
