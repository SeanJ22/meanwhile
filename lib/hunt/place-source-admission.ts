import { readRuntimeAdminConfig } from "../control-plane/runtime-admin-config.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../control-plane/repository/pg-store.ts";
import { isAdminConfig } from "../control-plane/gateway/admin-config.ts";
import { expansionScopesOf, type ExpansionScopeDecision } from "../control-plane/expansion/scopes.ts";
import { resolveScopes } from "../control-plane/expansion/runner-load.ts";
import { loadPublishedScopeLookupState } from "../census-geography/scope-lookup.ts";
import { readPublishedZipStates } from "../census-geography/area-lookup.ts";
import { readIntents, RESEARCH_INTENT_LOG_KEY } from "../control-plane/scheduler/research-policy.ts";
import { admittedHuntSourceScopes } from "../civic-data/hunt-source-tasks.ts";
import type { NationalPlaceTask } from "./place-source-task.ts";
import type { RoutineSourceTask } from "../civic-data/runner.ts";
import { dueNationalPlaceZips, nationalPlaceJobs, nationalPlaceSendRequests, readNationalPlaceSendRequests, type NationalPlaceSendRequest } from "./place-source-task.ts";
import { orderNationalPlaceWork } from "../control-plane/expansion/dispatch-work.ts";

/** Sends reorder source work; standing source-state contracts need no Send. */
export async function visitNationalPlaceSendScopes(sends: readonly ExpansionScopeDecision[], visit: (scope: import("../control-plane/expansion/membership.ts").ResolvedScope) => void | Promise<void>): Promise<void> {
  for(const send of sends){
    const lookup=await loadPublishedScopeLookupState([send.geography]);
    const [scope]=(await resolveScopes([send],lookup,null)).scopes;
    await visit(scope);
  }
}

/** Start a saved Send alongside standing work, before the standing backlog drains. */
export function placeSourceLaunchOrder<T extends { readonly task: Pick<RoutineSourceTask, "id"> }>(jobs: readonly T[]): T[] {
  const places = jobs.filter(job => job.task.id.startsWith("national-place:"));
  if (!places.length) return [...jobs];
  const standing = jobs.filter(job => !job.task.id.startsWith("national-place:"));
  return [places[0]!, ...standing.slice(0, 1), ...places.slice(1), ...standing.slice(1)];
}

/** Each due place uses the registered registry door through its own leased job. */
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
  const intents = readIntents([...(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY))]);
  if (intents.runnerPause.paused) return [...tasks];
  if (explicit === undefined) {
    const row = await readRuntimeAdminConfig(repos, ["expansionScopes"]);
    if (row && !isAdminConfig(row.value)) throw new Error("The owner's place scope is unreadable");
    const scopes = expansionScopesOf(row?.value ?? null);
    if (scopes.malformed) throw new Error("The owner's place scopes contain unreadable decisions");
    const sends = scopes.scopes.filter(scope => scope.sourceWorkVersion === 1);
    const requested = new Map<string,NationalPlaceSendRequest>();
    await visitNationalPlaceSendScopes(sends,scope=>{
      for(const admitted of admittedHuntSourceScopes([scope],now))if(admitted.kind==="RESOLVED"){
        for(const [zip,next]of nationalPlaceSendRequests([admitted],[...admitted.zctas],now)){
          const old=requested.get(zip);requested.set(zip,{requestedAt:old&&Date.parse(old.requestedAt)>Date.parse(next.requestedAt)?old.requestedAt:next.requestedAt,
            instructions:[...new Set([...(old?.instructions??[]),...next.instructions])]});
        }
      }
    });
    requests=requested;zips=[...requested.keys()];
    // Existing free source jobs stay in the queue; only their scheduling identity is transferred.
    const held=await repos.obligations.listWhereNarrowed(["routeId"],"national-place-sources",{active:true,id:true});
    for(const row of held)if((row.value as {active?:boolean}).active&&/^national-place:\d{5}(?::[A-Z]{2})?$/.test(row.id))zips.push(row.id.split(":")[1]);
    zips=[...new Set(zips)];
  } else requests = await readNationalPlaceSendRequests(repos, zips, now);
  if (!zips.length) return [...tasks];
  if (zips.some(zip => !/^\d{5}$/.test(zip))) throw new Error("National place acquisition needs five-digit ZIPs");
  const groups = new Map<string, NationalPlaceTask[]>();
  for(let start=0;start<zips.length;start+=128){
    const own=zips.slice(start,start+128),statesByZip=await readPublishedZipStates(own);
    for(const zip of own){
      const states=statesByZip.get(zip)??[];
      if(!states.length)throw new Error(`NATIONAL_PLACE_STATE_UNRESOLVED:${zip}`);
      for(const state of states){
        const id=`national-place:${zip}${states.length>1?`:${state}`:""}`;
        if(only&&!only.includes(id)&&!only.includes(`national-place:${zip}`)&&!only.includes(`registry-runtime:${state}`))continue;
        const group=groups.get(state)??[];group.push({id,zip,state});groups.set(state,group);
      }
    }
  }
  const jobs: RoutineSourceTask[] = [];
  for (const places of groups.values()) {
    const due = await dueNationalPlaceZips(repos, places, now, requests);
    for (const zip of await orderNationalPlaceWork(repos, due, now)) jobs.push(...nationalPlaceJobs([places.find(place => place.zip === zip)!], requests.get(zip)));
  }
  return [...tasks, ...jobs];
}
