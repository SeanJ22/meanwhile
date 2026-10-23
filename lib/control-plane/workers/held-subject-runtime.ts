import { performance } from "node:perf_hooks";
import { readerFactDb } from "../../facts/db.ts";
import { resolveProductionWriteHandle } from "../../db/write-handle.ts";
import { factClocks } from "../../facts/clocks.ts";
import type { AdminConfig } from "../gateway/admin-config.ts";
import type { Clocks } from "../../facts/publish.ts";
import { createPortraitRuntime, storeVerifiedPortrait } from "../../photos/store.ts";
import { pacedPortraitAcquire } from "../../photos/portrait-work.ts";
import type { EvidenceStore } from "../evidence/store.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { RouteTask } from "../route-task.ts";
import type { DeclaredExecutor } from "../scheduler/dispatch.ts";
import type { WebsiteSizeForUrl } from "../scheduler/host-supervision.ts";
import { ZERO_COST } from "../attempt.ts";
import { heldSubjectDetailsExecutor, type HeldSubjectWorkerRuntime } from "./held-subject-worker.ts";

/** Production composition uses the same fact transactions, image verifier, cache and publisher pacing as other standing reads. */
export function productionHeldSubjectDetailsExecutor(input: {
  readonly repos: ControlPlaneRepositories; readonly vault: EvidenceStore; readonly now: () => string;
  readonly db?: HeldSubjectWorkerRuntime["db"];
  readonly dbFactory?: (connection: string) => HeldSubjectWorkerRuntime["db"];
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: typeof fetch;
  readonly sizeFor?: WebsiteSizeForUrl;
  readonly purge?: HeldSubjectWorkerRuntime["purge"];
  readonly sleep?: HeldSubjectWorkerRuntime["sleep"];
}, task: RouteTask, holder: string): DeclaredExecutor {
  let db = input.db, clocks: Clocks | undefined;
  const facts = () => db ??= (input.dbFactory ?? readerFactDb)(resolveProductionWriteHandle(input.environment ?? process.env).connection);
  const usage = { requestCount: 0, bytesFetched: 0 };
  const fetchImpl: typeof fetch = async (resource, init) => {
    usage.requestCount++;
    const response = await (input.fetchImpl ?? fetch)(resource, init);
    const body = response.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
      usage.bytesFetched += chunk.byteLength;
      controller.enqueue(chunk);
    } })) ?? null;
    const measured = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    Object.defineProperty(measured, "url", { value: response.url || String(resource) });
    return measured;
  };
  const portraits = createPortraitRuntime(request => pacedPortraitAcquire({ ...request, fetchImpl,
    store: input.vault, locks: input.repos.locks, now: input.now }, { repositories: async () => input.repos,
    clock: () => Date.parse(input.now()), ...(input.sizeFor ? { sizeFor: input.sizeFor } : {}) }));
  const delegate = heldSubjectDetailsExecutor({ repos: input.repos, vault: input.vault, now: input.now, purge: input.purge,
    db: { query: (...args) => facts().query(...args), transaction: work => facts().transaction(work) },
    clocks: { windowHours: kind => clocks!.windowHours(kind), retryMinutes: kind => clocks!.retryMinutes(kind) },
    portraitUsage: () => ({ ...usage }), fetchImpl: input.fetchImpl, websiteSize: input.sizeFor, sleep: input.sleep,
    storePortrait: (personId, sources, at, signal) => storeVerifiedPortrait(personId, sources, at, portraits, "officials", signal),
  }, task, holder);
  return { ...delegate, run: async args => {
    const started = performance.now();
    try {
      const config = await input.repos.adminConfig.readNarrowed("current",
        { settings: ["facts.freshnessHours", "facts.retryMinutes"] });
      clocks = factClocks(config?.value as AdminConfig | null ?? null);
      return await delegate.run(args);
    } catch (error) {
      return { kind: "ABORTED", ranAs: "DETERMINISTIC", endedAt: input.now(),
        cost: { ...ZERO_COST, usd: 0, inputTokens: 0, outputTokens: 0, durationMs: Math.round(performance.now() - started), ...usage },
        detail: error instanceof Error ? error.message : String(error) };
    }
  } };
}
