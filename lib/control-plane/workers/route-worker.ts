import { createFileRepositories } from "../repository/file-store.ts";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { dispatchOne } from "../scheduler/dispatch.ts";
import { routeExecutor, type OpenOne, type VaultPut } from "../scheduler/route-executor.ts";
import { workerBroker } from "./worker-broker.ts";
import type { LeaseWorkerConfig } from "./process-pool.ts";
import { join } from "node:path";
import { readFromHeldCopies } from "../repository/incremental-reads.ts";

readFromHeldCopies();

const broker = workerBroker<LeaseWorkerConfig>(async config => {
  if (!config.routeDispatch) throw new Error("ROUTE_PROCESS_DISPATCH_MISSING");
  const { input, route } = config.routeDispatch;
  const url = config.postgres ? controlPlaneUrlFromEnv() : null;
  if (config.postgres && !url) throw new Error("CONTROL_PLANE_DATABASE_UNCONFIGURED");
  const repos = url ? await createPgRepositories(url, new Date().toISOString(), { skipBootstrap: true })
    : await createFileRepositories(config.fileStoreRoot ?? join(config.root, ".runtime/control-plane/freshness-shadow"));
  broker.assignment(input.routeTaskId ?? input.obligation.obligation.id,
    { subjectId: input.obligation.obligation.subjectId, state: null });
  const clock = input.liveClock ? () => new Date().toISOString() : () => input.now;
  const executor = { lane: "DETERMINISTIC" as const,
    workerFor: ({ holder }: { holder: string }) => ({ role: "ACQUIRER" as const, provider: "we-the-people",
      version: `route-executor/1.0 (${route?.routeId ?? "unrouted"})`, instance: holder }),
    run: routeExecutor({ routeFor: () => route, now: clock,
      openOne: request => broker.call<Awaited<ReturnType<OpenOne>>>("route-tool", { name: "openOne", args: [request] }),
      spaceOut: host => broker.call<void>("route-tool", { name: "spaceOut", args: [host] }),
      vault: (...args: Parameters<VaultPut>) => broker.call<Awaited<ReturnType<VaultPut>>>("route-tool", { name: "vault", args }),
    }) };
  const result = await dispatchOne(repos, { ...input, holder: `${input.holder}:worker:${process.pid}`,
    clock, maturity: () => input.maturity, executor });
  await broker.call("route-dispatch-result", result);
  process.disconnect();
});
