import { controlPlaneUrlFromEnv, createPgRepositories } from "../control-plane/repository/pg-store.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../control-plane/gateway/admin-config.ts";
import { expansionScopesOf } from "../control-plane/expansion/scopes.ts";
import { resolveScopes } from "../control-plane/expansion/runner-load.ts";
import { loadPublishedLookupState } from "../census-geography/reader.ts";
import { readIntents, RESEARCH_INTENT_LOG_KEY } from "../control-plane/scheduler/research-policy.ts";
import { admittedHuntSourceScopes } from "../civic-data/hunt-source-tasks.ts";
import { requiredManualProductionContract } from "../civic-data/manual-contracts.ts";
import type { RoutineSourceTask } from "../civic-data/runner.ts";
import { workerPublicationTasks } from "../civic-data/worker-publication-tasks.ts";
import { readCompletedWorkerResults } from "../control-plane/repository/worker-completion.ts";
import { DEFAULT_CADENCE_HOURS } from "../control-plane/scheduler/obligation.ts";
import { dueNationalPlaceZips } from "./place-source-task.ts";

/** Add national acquisition to the existing registry source, so its source
 * authority, child runner, publication and readback are shared with rosters. */
export async function withNationalPlaceTasks(tasks: readonly RoutineSourceTask[], args: readonly string[]): Promise<RoutineSourceTask[]> {
  const explicit = args.find(arg => arg.startsWith("--national-zips="))?.slice("--national-zips=".length);
  const only = args.find(arg => arg.startsWith("--only="))?.slice("--only=".length).split(",");
  if (only && !only.includes("registry-runtime-bindings")) return [...tasks];
  const now = new Date().toISOString();
  let zips = explicit?.split(",") ?? [];
  let requestedAt = now;
  let instructions: string[] = [];
  const connection = controlPlaneUrlFromEnv();
  if (!connection) return [...tasks];
  const repos = await createPgRepositories(connection, now, { skipBootstrap: true });
  const intents = readIntents([...(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY))]);
  if (intents.runnerPause.paused) return [...tasks];
  if (explicit === undefined) {
    const row = await repos.adminConfig.read(ADMIN_CONFIG_ID);
    if (!row) return [...tasks];
    if (!isAdminConfig(row.value)) throw new Error("The owner's place scope is unreadable");
    const scopes = expansionScopesOf(row.value);
    if (scopes.malformed) throw new Error("The owner's place scopes contain unreadable decisions");
    const sends = scopes.scopes.filter(scope => scope.sourceWorkVersion === 1);
    if (!sends.length) return [...tasks];
    const resolved = await resolveScopes(sends, await loadPublishedLookupState({ bypassCache: true }), null);
    const admitted = admittedHuntSourceScopes(resolved.scopes, now);
    zips = admitted.flatMap(scope => scope.kind === "RESOLVED" ? [...scope.zctas] : []);
    requestedAt = admitted.map(scope => scope.decision.decidedAt).sort().at(-1) ?? now;
    instructions = admitted.map(scope => scope.decision.receiptId);
  }
  if (!zips.length) return [...tasks];
  if (zips.some(zip => !/^\d{5}$/.test(zip))) throw new Error("National place acquisition needs five-digit ZIPs");
  zips = await dueNationalPlaceZips(repos, zips, now);
  if (!zips.length) return [...tasks];
  const contract = requiredManualProductionContract("registry-runtime-bindings");
  const items = (await repos.workItems.list()).map(row => row.value)
    .filter(item => item.autonomousPlan?.publication?.contractId === contract.id);
  const publication = items.length ? workerPublicationTasks(items, await readCompletedWorkerResults(repos), now)
    .find(task => task.id === contract.id) : undefined;
  const prior = tasks.find(task => task.id === contract.id) ?? publication;
  const task: RoutineSourceTask = { ...prior, id: contract.id, sourceId: contract.sourceId, recordClass: contract.recordClass,
    scope: contract.scope, acquisitionFailureDomain: `routine-source:${contract.sourceId}`, requestedUrl: "",
    authorityMode: "REGISTERED_SOURCE_ROUTES", parserVersion: contract.parserNormalizerVersion,
    command: [...(prior?.command ?? contract.command).filter(arg => !arg.startsWith("--national-zips=")), `--national-zips=${zips.join(",")}`],
    cadenceMs: Math.min(prior?.cadenceMs ?? Infinity, DEFAULT_CADENCE_HOURS * 3_600_000), retryMs: prior?.retryMs ?? 15 * 60_000,
    contract: prior?.contract ?? { readerProjection: contract.readerProjection,
      cadence: { description: "Refresh the admitted place's national sources on the ordinary roster cadence", defaultEveryMs: DEFAULT_CADENCE_HOURS * 3_600_000 } },
    ownerInvocation: { ...prior?.ownerInvocation, publicationPending: true, requestedAt,
      instructions: [...new Set([...(prior?.ownerInvocation?.instructions ?? []), ...instructions])] } };
  return [...tasks.filter(existing => existing.id !== task.id), task];
}
