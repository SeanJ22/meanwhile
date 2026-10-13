import { readRolePlaybook } from "../playbooks.ts";
import { createFileRepositories } from "../repository/file-store.ts";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { scoutExecutor, type ScoutExecutorDeps, type ModelResponse, type ScoutEscalationAdmission } from "../scheduler/scout-executor.ts";
import { dispatchOne } from "../scheduler/dispatch.ts";
import { buildScoutToolkit } from "../scheduler/scout-tools.ts";
import type { ScoutToolContext } from "../scheduler/scout-contract.ts";
import { FleetPreSendRefusal } from "../fleet-safety.ts";
import { SendBudgetRefusal } from "../expansion/spend-holds.ts";
import { workerBroker } from "./worker-broker.ts";
import type { LeaseWorkerConfig } from "./process-pool.ts";
import { join } from "node:path";
import { readFromHeldCopies } from "../repository/incremental-reads.ts";

readFromHeldCopies();

// Scout entry: load the research loop and tools, without the standing worker pipeline.
const broker = workerBroker<LeaseWorkerConfig>(async config => {
  if (!config.scoutDispatch) throw new Error("SCOUT_PROCESS_DISPATCH_MISSING");
  const url = config.postgres ? controlPlaneUrlFromEnv() : null;
  if (config.postgres && !url) throw new Error("CONTROL_PLANE_DATABASE_UNCONFIGURED");
  const repos = url ? await createPgRepositories(url, new Date().toISOString(), { skipBootstrap: true })
  : await createFileRepositories(config.fileStoreRoot ?? join(config.root, ".runtime/control-plane/freshness-shadow"));
  const { input, context, contextError, toolNames, toolTimeoutMs, options } = config.scoutDispatch;
  broker.assignment(input.routeTaskId ?? input.obligation.obligation.id, { subjectId: input.obligation.obligation.subjectId, state: null });
  const tools = { ...Object.fromEntries(toolNames.map(name => [name,
    (...args: readonly unknown[]) => broker.call("scout-tool", { name, args })])),
    timeoutMs: toolTimeoutMs } as unknown as ReturnType<ScoutExecutorDeps["contextFor"]>["tools"] & Pick<ScoutToolContext, "search" | "openBytes">;
  const clock = input.liveClock ? () => new Date().toISOString() : () => input.now;
  const executor = scoutExecutor({ ...options, now: clock, playbookFor: role => readRolePlaybook(repos, role),
    contextFor: () => {
      if (!context || contextError) throw new Error(contextError ?? "SCOUT_CONTEXT_UNAVAILABLE");
      return { ...context, tools };
    },
    toolkitFor: ctx => buildScoutToolkit({ ...ctx, ...tools, sourceApi: { env: process.env } }),
    transport: request => broker.call<ModelResponse>("model", request),
    refusedBeforeSending: error => error instanceof FleetPreSendRefusal || error instanceof SendBudgetRefusal,
    onStart: info => broker.call("scout-start", info),
    onResult: (result, artifacts) => broker.call("scout-result", { result, artifacts }),
    reserveEscalation: async request => {
      const response = await broker.call<(Omit<Extract<ScoutEscalationAdmission, { admit: true }>, "draw" | "release"> & { reservationId: string }) |
        Extract<ScoutEscalationAdmission, { admit: false }>>("escalation", request);
      return response.admit ? { ...response, draw: usd => broker.send("draw", response.reservationId, usd), release: () => broker.send("release", response.reservationId, null) } : response;
    },
  });
  const result = await dispatchOne(repos, { ...input, holder: `${input.holder}:worker:${process.pid}`,
    clock, maturity: () => input.maturity, executor });
  await broker.call("scout-dispatch-result", result);
  process.disconnect();
});
