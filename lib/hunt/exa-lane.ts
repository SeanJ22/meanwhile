import {huntFindingSubject} from './finding-subject.ts';
import {prepareLiveExaBody} from './body-target-runtime.ts';
import {liveHuntDirections} from './directions.ts';
/** Exa's facts go into the Box through the hunter's own report path,
 * so each cited page is saved and each fact is checked the same way. */
import type { DeclaredExecutor, WorkOutcome } from "../control-plane/scheduler/dispatch.ts";
import type { ScoutResult } from "../control-plane/scheduler/scout-result.ts";
import type { ScoutToolContext, ScoutToolkit } from "../control-plane/scheduler/scout-contract.ts";
import { RESEARCH_BOUNDS } from "../control-plane/scheduler/research-policy.ts";
import type { AttemptCost } from "../control-plane/attempt.ts";
import { EXA_AGENT_EFFORT, EXA_AGENT_HOST, runExaAgent } from "./exa-agent.ts";
import type { HuntPacket } from "./packet.ts";
import {EXA_AGENT_WALL_MS,type FetchLike,type SearchBudget} from "./search.ts";
import { dispositionForHunt } from "../control-plane/scheduler/scout-executor.ts";

export const EXA_AGENT_ROUTE_ID = "hunter:exa-agent";
const EXA_AGENT_MODEL = `exa-agent-${EXA_AGENT_EFFORT}`;

const cost = (usd: number | null, durationMs: number, requests: number, bytes: number): AttemptCost => ({
  inputTokens: null, outputTokens: null, usd, durationMs, bytesFetched: bytes, requestCount: requests,
  cacheReadInputTokens: null, cacheCreationInputTokens: null, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null,
  uncachedInputTokens: null, batch: false });

export function exaAgentExecutor(deps: {
  readonly key: string | undefined;
  readonly now: () => string;
  readonly instructions: () => Promise<string>;
  readonly directions?: (input:{workItemId:string;governmentId:string})=>Promise<readonly string[]>;
  readonly packetNow: () => Promise<HuntPacket | null>;
  /** The paid-search budget admits each run; a refused, unread or absent budget sends nothing. */
  readonly budget: SearchBudget | undefined;
  readonly toolkitFor: (ctx: ScoutToolContext) => ScoutToolkit;
  readonly toolsFor: (job: { readonly attemptId: string; readonly workItemId: string; readonly routeTaskId: string }, packet: HuntPacket) =>
    Pick<ScoutToolContext, "vault" | "vaultBytes" | "spaceOut" | "openBytes" | "reportFinding">;
  readonly onResult: (result: ScoutResult, packet: HuntPacket) => Promise<void>;
  readonly fetchImpl?: FetchLike;
  readonly prepareBody?:import('./body-target-runtime.ts').PrepareHuntBody;
  /** When the worker process will be ended; the run is cancelled before then if that comes first. */
  readonly endsAt?: number;
  readonly progress?: () => void;
}): DeclaredExecutor {
  return {
    lane: "BOUNDED_MODEL_WORKER",
    workerFor: ({ holder }) => ({ role: "SCOUT", provider: "exa", version: EXA_AGENT_MODEL, instance: holder }),
    run: async ({ obligation: row, attemptId, workItemId, routeTaskId, holder }): Promise<WorkOutcome> => {
      const started = Date.now();
      const startedAt = deps.now();
      const packet = await deps.packetNow();
      if (packet === null || packet.blanks.length === 0) {
        return { kind: "DISPOSED", ranAs: "BOUNDED_MODEL_WORKER", endedAt: deps.now(), artifacts: [], cost: cost(0, Date.now() - started, 0, 0),
          disposition: { disposition: "WALKED_NO_YIELD", observation: null, permission: "NOT_APPLICABLE", transport: "REACHABLE",
            note: "EXA AGENT: no blank is open for this government, so nothing was sent." }, detail: "HUNT_NOTHING_OPEN" };
      }
      const { key, budget } = deps;
      let refused: string | null;
      try { refused = !key ? "EXA_API_KEY is not set" : !budget ? "no paid-search budget reaches this worker" : await budget.take(EXA_AGENT_HOST); }
      catch (error) { refused = `the paid-search budget could not be read (${error instanceof Error ? error.message : String(error)})`; }
      if (refused !== null || !key || !budget) {
        return { kind: "ABORTED", ranAs: "BOUNDED_MODEL_WORKER", failureOutcome: "DENIED_BY_POLICY", endedAt: deps.now(), artifacts: [],
          cost: cost(0, Date.now() - started, 0, 0), detail: `DENIED_BY_POLICY: Exa agent not sent, ${refused}` };
      }
      let run: Awaited<ReturnType<typeof runExaAgent>>;
      try {
        const directedPacket={...packet,directions:packet.directions??await(deps.directions??liveHuntDirections)({workItemId,governmentId:packet.governmentId})};
        run = await runExaAgent({ packet:directedPacket, key, instructions: await deps.instructions(),
          deadlineMs: Math.min(Date.now() + EXA_AGENT_WALL_MS, deps.endsAt ?? Number.POSITIVE_INFINITY),
          ...(deps.progress ? { onPoll: deps.progress } : {}), ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) });
      } finally {
        await budget.done(EXA_AGENT_HOST).catch(() => undefined);
      }
      const bound=deps.toolsFor({attemptId,workItemId,routeTaskId},packet);
      const reporter=bound.reportFinding;
      const subjects=reporter?new Set(reporter.subjects):null;
      const toolkit = deps.toolkitFor({ obligation: row, route: null, providerId: null, attemptId, workItemId, routeTaskId, holder,
        bound: RESEARCH_BOUNDS.perDispatch, now: deps.now, handed: { artifactIds: [] },
        ...bound,...(reporter?{reportFinding:{...reporter,subjects:subjects!,write:async finding=>{const normalized=huntFindingSubject(finding,packet.label);const written=await reporter.write(normalized);subjects!.add(normalized.subjectId);return written;}}}:{}) });
      const artifacts = [];
      for (const finding of [...run.findings].sort((a,b)=>Number(['GOV-01','GOV-02','body.name'].includes(b.field))-Number(['GOV-01','GOV-02','body.name'].includes(a.field)))) {
        const before=toolkit.reported.length;
        const call = await toolkit.call("report_finding", finding);
        artifacts.push(...call.artifacts);
        const reported=toolkit.reported.at(-1);
        if(reported && toolkit.reported.length>before)await (deps.prepareBody??prepareLiveExaBody)({...huntFindingSubject(reported,packet.label),value:String(reported.value)},{workItemId,attemptId});
      }
      const findings = toolkit.reported.map(f=>huntFindingSubject(f,packet.label)).map(f => ({ subjectId: f.subjectId, field: f.field, value: f.value, exactQuote: f.exactQuote,
        sourceUrl: f.sourceUrl, summary: `${f.field} = ${String(f.value)}`, artifactIds: f.artifactIds, kind: "RECORD" as const }));
      const elapsedMs = Date.now() - started;
      const result: ScoutResult = {
        researchRole: "SCOUT", formatVersion: 1, attemptId, obligationId: row.obligation.id, routeTaskId, workItemId,
        subjectId: row.obligation.subjectId, routeId: row.obligation.routeId, recordClass: row.obligation.recordClass, providerId: null,
        reason: `Exa agent for ${packet.label}: ${packet.blanks.length} open blank(s)`,
        outcome: findings.length > 0 ? "EVIDENCE_FOUND" : "NO_PROGRESS", stoppedBy: "MODEL", rungs: [], distinctEvidenceRungs: 0,
        candidates: [], findings, nextRungs: [], unverified: run.error ? [run.error] : [],
        narrative: run.summary || (run.error ?? `Exa agent run ${run.status}`),
        worker: { provider: "exa", model: EXA_AGENT_MODEL, modelReported: run.runId },
        usage: { inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null, turns: 0, toolCalls: run.findings.length },
        usd: run.costUsd, elapsedMs, artifactIds: artifacts.map(a => a.artifactId), methodCandidateIds: [],
        refusal: run.status === "completed" || findings.length > 0 ? null : [{ code: "SCOUT_TRANSPORT_FAILED", detail: run.error ?? run.status }],
        startedAt, recordedAt: deps.now(), blanks: packet.blanks.length,
      };
      await deps.onResult(result, packet);
      const outcomeCost = cost(run.costUsd, elapsedMs, run.requestCount + toolkit.requestCount, run.bytesFetched + toolkit.bytesFetched);
      if (result.refusal !== null) return { kind: "ABORTED", ranAs: "BOUNDED_MODEL_WORKER", endedAt: deps.now(), artifacts, cost: outcomeCost,
        detail: `EXA AGENT ended with nothing reported: ${result.refusal[0]!.detail}` };
      return { kind: "DISPOSED", ranAs: "BOUNDED_MODEL_WORKER", endedAt: deps.now(), artifacts, cost: outcomeCost, disposition: dispositionForHunt(result),
        detail: `EXA AGENT ${run.status}: ${findings.length} fact(s) into the Box, usd ${run.costUsd === null ? "UNREPORTED" : run.costUsd.toFixed(4)}` };
    },
  };
}
