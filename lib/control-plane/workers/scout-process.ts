import type { DeclaredExecutor } from "../scheduler/dispatch.ts";
import { scoutExecutor, type ScoutExecutorDeps } from "../scheduler/scout-executor.ts";
import type { ScoutToolContext } from "../scheduler/scout-contract.ts";
import { buildScoutToolkit } from "../scheduler/scout-tools.ts";
import { runLeaseWorkerProcesses, type WorkerProcessSlots } from "./process-pool.ts";

type ScoutContext = ReturnType<ScoutExecutorDeps["contextFor"]>;

/** Budget and publication callbacks stay in the parent; the child owns the lease and research loop. */
export function scoutProcessExecutor(input: {
  readonly root: string;
  readonly postgres: boolean;
  readonly fileStoreRoot?: string;
  readonly deps: Omit<ScoutExecutorDeps, "toolkitFor">;
  readonly search?: ScoutToolContext["search"];
  readonly slots?: WorkerProcessSlots;
  readonly onStarted?: (pid: number) => void;
}): DeclaredExecutor {
  const original = scoutExecutor({ ...input.deps, toolkitFor: buildScoutToolkit });
  return { ...original, dispatch: async request => {
    let context: Omit<ScoutContext, "tools"> | undefined;
    let contextError: string | undefined;
    let tools: ScoutContext["tools"] = { vault: async () => { throw new Error("SCOUT_CONTEXT_UNAVAILABLE"); }, spaceOut: async () => {} };
    try {
      const assembled = input.deps.contextFor(request.obligation);
      const { tools: assembledTools, ...metadata } = assembled;
      tools = assembledTools;
      context = metadata;
    } catch (error) { contextError = error instanceof Error ? error.message : String(error); }
    const { clock, maturity, ...data } = request;
    const toolsByName = new Map<string, (...args: readonly unknown[]) => unknown>();
    for (const [name, tool] of Object.entries(tools)) {
      if (typeof tool === "function") toolsByName.set(name, tool as (...args: readonly unknown[]) => unknown);
    }
    if (input.search) toolsByName.set("search", input.search as (...args: readonly unknown[]) => unknown);
    const results = await runLeaseWorkerProcesses({ entry: "lib/control-plane/workers/scout-worker.ts", config: {
      root: input.root, postgres: input.postgres, fileStoreRoot: input.fileStoreRoot,
      taskIds: [request.routeTaskId ?? request.obligation.obligation.id], modelEnabled: true,
      searchEnabled: Boolean(input.search), ceilingUsd: 0, fundedSubjects: [],
      scoutDispatch: { input: { ...data, liveClock: Boolean(clock), maturity: maturity(request.obligation.obligation.routeId) },
        context, contextError, toolNames: [...toolsByName.keys()], toolTimeoutMs: tools.timeoutMs, options: { model: input.deps.model,
          bound: input.deps.bound, minRungs: input.deps.minRungs, role: input.deps.role } },
    }, slots: input.slots, capacity: () => 1, onStarted: input.onStarted,
    transportFor: (_, taskId) => input.deps.transportFor?.(taskId) ?? input.deps.transport,
    reserveEscalation: input.deps.reserveEscalation,
    scout: { onStart: input.deps.onStart, onResult: input.deps.onResult,
      tool: async (name, args) => {
        const tool = toolsByName.get(name);
        if (!tool) throw new Error(`SCOUT_PROCESS_TOOL_UNAVAILABLE:${name}`);
        return tool(...args);
      } },
    });
    if (results.length !== 1) throw new Error("SCOUT_PROCESS_RESULT_MISSING");
    return results[0]!;
  } };
}
