import { encodeVerifiedReplay } from "../../sources/verified-replay.ts";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { browseWithPlaywright } from "../../../scripts/scout-browse.mts";
import { join } from "node:path";
import type { LeaseWorkerConfig } from "./process-pool.ts";
import { readFromHeldCopies } from "../repository/incremental-reads.ts";

readFromHeldCopies();

const replies = new Map<string, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
let sequence = 0;
function call<T>(kind: string, body: unknown): Promise<T> {
  const id = String(++sequence);
  return new Promise<T>((resolve, reject) => {
    replies.set(id, { resolve: value => resolve(value as T), reject });
    if (!process.send || !process.connected) { replies.delete(id); reject(new Error("NATIONAL_WORKER_BROKER_DISCONNECTED")); return; }
    process.send({ kind, id, body: encodeVerifiedReplay(body) });
  });
}
process.on("disconnect", () => {
  for (const reply of replies.values()) reply.reject(new Error("NATIONAL_WORKER_BROKER_DISCONNECTED"));
  replies.clear();
});
async function work(config: LeaseWorkerConfig): Promise<void> {
  const url = controlPlaneUrlFromEnv();
  if (!url || !config.postgres || !config.nationalPlaces) throw new Error("NATIONAL_WORKER_DATABASE_UNCONFIGURED");
  const repos = await createPgRepositories(url, new Date().toISOString(), { skipBootstrap: true });

  const [{ runNationalPlaceTask }, { PostgresRoutineDataStore },
    { DurableEvidenceStore }, { VAULT_DIR }, { hostSpacer }, { serializeHostSpacing }] = await Promise.all([
    import("../../hunt/place-source-task.ts"), import("../../civic-data/store.ts"),
    import("../evidence/durable-store.ts"),
    import("../scheduler/vault.ts"), import("../scheduler/http-executor.ts"), import("./host-spacing.ts")]);
  const tools = { repos, store: new DurableEvidenceStore(join(config.root, ...VAULT_DIR)),
    spaceOut: serializeHostSpacing(hostSpacer()), browse: browseWithPlaywright, now: () => new Date().toISOString() };
  for (const zip of config.taskIds) {
    const reports = await runNationalPlaceTask({ tools, store: new PostgresRoutineDataStore(), places: [config.nationalPlaces.find(place => place.zip === zip)!],
      publish: ({ store: _store, ...input }) => call("national-publication", input),
      publishElection: (fields, now) => call("election-publication", { fields, now }) });
    for (const report of reports) await call("national-result", report);
  }
  process.send!({ kind: "finished", body: config.taskIds });
  process.disconnect();
}
process.on("message", (raw: unknown) => {
  const message = raw as { id?: string; body?: unknown; error?: { message: string } };
  if (!message.id) {
    void work(raw as LeaseWorkerConfig).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; if (process.connected) process.disconnect(); });
    return;
  }
  const reply = replies.get(message.id);
  if (!reply) return;
  replies.delete(message.id);
  if (message.error) reply.reject(new Error(message.error.message)); else reply.resolve(message.body);
});
