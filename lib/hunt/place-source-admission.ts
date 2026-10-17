import { HUNT_STATES } from "../control-plane/hunt-orders.ts";
import { controlPlaneUrlFromEnv, createPgRepositories, readPlanningIntents } from "../control-plane/repository/pg-store.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../control-plane/gateway/admin-config.ts";
import { expansionScopesOf, type ExpansionScopeDecision } from "../control-plane/expansion/scopes.ts";
import { resolveScopes } from "../control-plane/expansion/runner-load.ts";
import { loadPublishedScopeLookupState } from "../census-geography/scope-lookup.ts";
import { loadPublishedAreaLookupState } from "../census-geography/area-lookup.ts";
import { readIntents } from "../control-plane/scheduler/research-policy.ts";
import { admittedHuntSourceScopes } from "../civic-data/hunt-source-tasks.ts";
import { statesForRegistryDivisions } from "../civic-data/state-scopes.ts";
import type { NationalPlaceTask } from "./place-source-task.ts";
import type { RoutineSourceTask } from "../civic-data/runner.ts";
import { dueNationalPlaceZips, nationalPlaceJobs, nationalPlaceSendRequests, readNationalPlaceSendRequests, type NationalPlaceSendRequest } from "./place-source-task.ts";
import { orderNationalPlaceWork } from "../control-plane/expansion/dispatch-work.ts";

export async function resolveNationalPlaceSendScopes(sends: readonly ExpansionScopeDecision[], zips: readonly string[]) {
  return (await resolveScopes(sends, await loadPublishedAreaLookupState(zips), null)).scopes;
}

export function placeSourceLaunchOrder<T extends { readonly task: Pick<RoutineSourceTask, "id"> }>(jobs: readonly T[]): T[] {
  const places = jobs.filter(job => job.task.id.startsWith("national-place:"));
  if (!places.length) return [...jobs];
  const standing = jobs.filter(job => !job.task.id.startsWith("national-place:"));
  return [places[0]!, ...standing.slice(0, 1), ...places.slice(1), ...standing.slice(1)];
}

export async function withNationalPlaceTasks(tasks: readonly RoutineSourceTask[], args: readonly string[]): Promise<RoutineSourceTask[]> {
  const explicit = args.find(arg => arg.startsWith("--national-zips="))?.slice("--national-zips=".length);
  const only = args.find(arg => arg.startsWith("--only="))?.slice("--only=".length).split(",");
  if (only && !only.some(id => /^registry-runtime:[A-Z]{2}$/.test(id) || /^national-place:\d{5}(?::[A-Z]{2})?$/.test(id))) return [...tasks];
  const now = new Date().toISOString();
  let zips = explicit?.split(",") ?? [];
  let requests: ReadonlyMap<string, NationalPlaceSendRequest>;
  const connection = controlPlaneUrlFromEnv();
  if (!connection) return [...tasks];
  const repos = await createPgRepositories(connection, now, { skipBootstrap: true });
  const intents = readIntents([...(await readPlanningIntents(repos))]);
  if (intents.runnerPause.paused) return [...tasks];
  if (explicit === undefined) {
    const requested = new Map<string,NationalPlaceSendRequest>();
    for (const state of HUNT_STATES) {
      const row=await repos.adminConfig.read(ADMIN_CONFIG_ID,{expansionScopes:{where:{path:["geography","stateAbbr"],value:state.toUpperCase()}}});
      if(row && !isAdminConfig(row.value)) throw new Error("The owner's place scope is unreadable");
      const scopes=expansionScopesOf(row?.value??null);
      if(scopes.malformed)throw new Error("The owner's place scopes contain unreadable decisions");
      const sends=scopes.scopes.filter(scope=>scope.sourceWorkVersion===1);
      if(!sends.length)continue;
      const resolved=await resolveScopes(sends,await loadPublishedScopeLookupState(sends.map(send=>send.geography)),null);
      const admitted=admittedHuntSourceScopes(resolved.scopes,now);
      const selected=admitted.flatMap(scope=>scope.kind==="RESOLVED"?[...scope.zctas]:[]);
      for(const [zip,request] of nationalPlaceSendRequests(admitted,selected,now)) {
        const prior=requested.get(zip);
        requested.set(zip,{requestedAt:prior && prior.requestedAt>request.requestedAt?prior.requestedAt:request.requestedAt,
          instructions:[...new Set([...(prior?.instructions??[]),...request.instructions])]});
      }
    }
    requests=requested;
    zips=[...requested.keys()];

    const held = await repos.obligations.listWhere(["routeId"], "national-place-sources");
    zips = [...new Set([...zips, ...held.filter(row => row.value.active).flatMap(row =>
      /^national-place:\d{5}(?::[A-Z]{2})?$/.test(row.value.id) ? [row.value.id.split(":")[1]] : [])])];
  } else requests = await readNationalPlaceSendRequests(repos, zips, now);
  if (!zips.length) return [...tasks];
  if (zips.some(zip => !/^\d{5}$/.test(zip))) throw new Error("National place acquisition needs five-digit ZIPs");
  const groups = new Map<string, NationalPlaceTask[]>();
  const lookup = await loadPublishedAreaLookupState(zips);
  for (const zip of zips) {
    const grouping = await lookup.lookup.groupingsForZcta(zip);
    const states = grouping.status.kind === "OK" ? statesForRegistryDivisions(grouping.memberships.map(member => `US-${member.geography.stateAbbr}`)) : [];
    if (!states.length) throw new Error(`NATIONAL_PLACE_STATE_UNRESOLVED:${zip}`);
    for (const state of states) {
      const id = `national-place:${zip}${states.length > 1 ? `:${state}` : ""}`;
      if (only && !only.includes(id) && !only.includes(`national-place:${zip}`) && !only.includes(`registry-runtime:${state}`)) continue;
      groups.set(state, [...(groups.get(state) ?? []), { id, zip, state }]);
    }
  }
  const jobs: RoutineSourceTask[] = [];
  for (const places of groups.values()) {
    const due = await dueNationalPlaceZips(repos, places, now, requests);
    for (const zip of await orderNationalPlaceWork(repos, due, now)) jobs.push(...nationalPlaceJobs([places.find(place => place.zip === zip)!], requests.get(zip)));
  }
  return [...tasks, ...jobs];
}
