import type { DeclaredExecutor } from "../scheduler/dispatch.ts";
import type { DispatchResult } from "../scheduler/dispatch.ts";
import type { RouteDescriptor } from "../scheduler/registry.ts";
import { routeExecutor, type OpenOne, type VaultPut } from "../scheduler/route-executor.ts";
import { runLeaseWorkerProcesses, type WorkerProcessSlots } from "./process-pool.ts";

/** The child owns the canonical lease and route computation; shared tools keep website and spend accounting. */
export function routeProcessExecutor(input: {
  readonly root: string;
  readonly postgres: boolean;
  readonly fileStoreRoot?: string;
  readonly route: RouteDescriptor | null;
  readonly openOne: OpenOne;
  readonly spaceOut: (host: string) => Promise<void>;
  readonly vault: VaultPut;
  readonly slots?: WorkerProcessSlots;
  readonly onStarted?: (pid: number) => void;
}): DeclaredExecutor {
  const original: DeclaredExecutor = { lane: "DETERMINISTIC",
    workerFor: ({ holder }) => ({ role: "ACQUIRER", provider: "we-the-people",
      version: `route-executor/1.0 (${input.route?.routeId ?? "unrouted"})`, instance: holder }),
    run: routeExecutor({ routeFor: () => input.route, openOne: input.openOne, spaceOut: input.spaceOut, vault: input.vault }),
  };
  return { ...original, dispatch: async request => {
    const { clock, maturity, ...data } = request;
    let result: DispatchResult | null = null;
    const summary = await runLeaseWorkerProcesses({ entry: "lib/control-plane/workers/route-worker.ts", config: {
      root: input.root, postgres: input.postgres, fileStoreRoot: input.fileStoreRoot,
      taskIds: [request.routeTaskId ?? request.obligation.obligation.id], modelEnabled: false,
      searchEnabled: false, ceilingUsd: 0, fundedSubjects: [],
      routeDispatch: { input: { ...data, liveClock: Boolean(clock), maturity: maturity(request.obligation.obligation.routeId) }, route: input.route },
    }, slots: input.slots, capacity: () => 1, onStarted: input.onStarted, onDispatched: value => { result = value; },
      transportFor: () => async () => { throw new Error("PLAIN_CODE_MODEL_CALL_REFUSED"); },
      route: { tool: async (name, args) => {
        if (name === "openOne") return input.openOne(...args as Parameters<OpenOne>);
        if (name === "spaceOut") return input.spaceOut(...args as Parameters<typeof input.spaceOut>);
        if (name === "vault") return input.vault(...args as Parameters<VaultPut>);
        throw new Error(`ROUTE_PROCESS_TOOL_UNAVAILABLE:${name}`);
      } },
    });
    if (summary.dispatched !== 1 || result === null) throw new Error("ROUTE_PROCESS_RESULT_MISSING");
    return result;
  } };
}
