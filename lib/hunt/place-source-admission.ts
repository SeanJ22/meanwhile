import { controlPlaneUrlFromEnv, createPgRepositories } from "../control-plane/repository/pg-store.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../control-plane/gateway/admin-config.ts";
import { expansionScopesOf, type ExpansionScopeDecision } from "../control-plane/expansion/scopes.ts";
import { resolveScopes } from "../control-plane/expansion/runner-load.ts";
import { loadPublishedScopeLookupState } from "../census-geography/scope-lookup.ts";
import { loadPublishedAreaLookupState } from "../census-geography/area-lookup.ts";
import { readIntents, RESEARCH_INTENT_LOG_KEY } from "../control-plane/scheduler/research-policy.ts";
import { admittedHuntSourceScopes } from "../civic-data/hunt-source-tasks.ts";
import { requiredManualProductionContract } from "../civic-data/manual-contracts.ts";
import type { RoutineSourceTask } from "../civic-data/runner.ts";
import { DEFAULT_CADENCE_HOURS } from "../control-plane/scheduler/obligation.ts";
import { dueNationalPlaceZips, nationalPlaceSendRequests, readNationalPlaceSendRequests, type NationalPlaceSendRequest } from "./place-source-task.ts";
import { orderNationalPlaceWork } from "../control-plane/expansion/dispatch-work.ts";

/** Sends reorder source work; standing source-state contracts need no Send. */
export async function resolveNationalPlaceSendScopes(sends: readonly ExpansionScopeDecision[], zips: readonly string[]) {
  return (await resolveScopes(sends, await loadPublishedAreaLookupState(zips), null)).scopes;
}

/** Start a saved Send alongside standing work, before the standing backlog drains. */
export function placeSourceLaunchOrder<T extends { readonly task: Pick<RoutineSourceTask, "id"> }>(jobs: readonly T[]): T[] {
  const places = jobs.filter(job => job.task.id.startsWith("national-place:"));
  if (!places.length) return [...jobs];
  const standing = jobs.filter(job => !job.task.id.startsWith("national-place:"));
  return [places[0]!, ...standing.slice(0, 1), ...places.slice(1), ...standing.slice(1)];
}

/** One ordinary source command per place; the existing occurrence owns its lease and resume clock. */
export function nationalPlaceJobs(zips: readonly string[], owner?: NationalPlaceSendRequest): RoutineSourceTask[] {
  if (zips.some(zip => !/^\d{5}$/.test(zip))) throw new Error("National place acquisition needs five-digit ZIPs");
  const contract = requiredManualProductionContract("registry-runtime-bindings");
  return [...new Set(zips)].map(zip => ({ id: `national-place:${zip}`, registeredContractId: contract.id,
    sourceId: contract.sourceId, recordClass: contract.recordClass, scope: contract.scope,
    acquisitionFailureDomain: `national-place:${zip}`, requestedUrl: "", authorityMode: "REGISTERED_SOURCE_ROUTES",
    parserVersion: contract.parserNormalizerVersion,
    command: [...contract.command, `--national-zips=${zip}`], cadenceMs: DEFAULT_CADENCE_HOURS * 3_600_000, retryMs: 15 * 60_000,
    contract: { readerProjection: contract.readerProjection,
      cadence: { description: "Refresh one admitted place's national sources", defaultEveryMs: DEFAULT_CADENCE_HOURS * 3_600_000 } },
    ...(owner ? { ownerInvocation: { publicationPending: true as const, requestedAt: owner.requestedAt, instructions: [...new Set(owner.instructions)] } } : {}) }));
}

/** Each due place uses the registered registry door through its own leased job. */
export async function withNationalPlaceTasks(tasks: readonly RoutineSourceTask[], args: readonly string[]): Promise<RoutineSourceTask[]> {
  const explicit = args.find(arg => arg.startsWith("--national-zips="))?.slice("--national-zips=".length);
  const only = args.find(arg => arg.startsWith("--only="))?.slice("--only=".length).split(",");
  if (only && !only.includes("registry-runtime-bindings") && !only.some(id => /^national-place:\d{5}$/.test(id))) return [...tasks];
  const now = new Date().toISOString();
  let zips = explicit?.split(",") ?? [];
  let requests: ReadonlyMap<string, NationalPlaceSendRequest>;
  const connection = controlPlaneUrlFromEnv();
  if (!connection) return [...tasks];
  const repos = await createPgRepositories(connection, now, { skipBootstrap: true });
  const intents = readIntents([...(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY))]);
  if (intents.runnerPause.paused) return [...tasks];
  if (explicit === undefined) {
    const row = await repos.adminConfig.read(ADMIN_CONFIG_ID);
    if (row && !isAdminConfig(row.value)) throw new Error("The owner's place scope is unreadable");
    const scopes = expansionScopesOf(row?.value ?? null);
    if (scopes.malformed) throw new Error("The owner's place scopes contain unreadable decisions");
    const sends = scopes.scopes.filter(scope => scope.sourceWorkVersion === 1);
    const resolved = sends.length ? await resolveScopes(sends, await loadPublishedScopeLookupState(sends.map(send => send.geography)), null) : { scopes: [] };
    const admitted = admittedHuntSourceScopes(resolved.scopes, now);
    zips = admitted.flatMap(scope => scope.kind === "RESOLVED" ? [...scope.zctas] : []);
    requests = nationalPlaceSendRequests(admitted, zips, now);
    zips = zips.filter(zip => requests.has(zip));
    // Already established free source work remains scheduled when no new
    // Send exists. This is a bounded route index, never a national ZIP scan.
    const held = await repos.obligations.listWhere(["routeId"], "national-place-sources");
    zips = [...new Set([...zips, ...held.filter(row => row.value.active).flatMap(row =>
      /^national-place:\d{5}$/.test(row.value.id) ? [row.value.id.slice("national-place:".length)] : [])])];
  } else requests = await readNationalPlaceSendRequests(repos, zips, now);
  if (!zips.length) return [...tasks];
  if (zips.some(zip => !/^\d{5}$/.test(zip))) throw new Error("National place acquisition needs five-digit ZIPs");
  zips = await dueNationalPlaceZips(repos, zips, now, requests);
  if (!zips.length) return [...tasks];
  return [...tasks, ...(await orderNationalPlaceWork(repos, zips, now)).flatMap(zip => nationalPlaceJobs([zip], requests.get(zip)))];
}
