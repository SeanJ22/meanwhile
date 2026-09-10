import { join } from "node:path";
import { DurableEvidenceStore } from "../evidence/durable-store.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { scoutExecutor, type ModelTransport } from "../scheduler/scout-executor.ts";
import { buildScoutToolkit } from "../scheduler/scout-tools.ts";
import type { ScoutToolContext } from "../scheduler/scout-contract.ts";
import { hostSpacer } from "../scheduler/http-executor.ts";
import { VAULT_DIR } from "../scheduler/vault.ts";
import { methodFields, standingFleetRuntime } from "./standing.ts";
import { computeRouteFloor } from "../preflight.ts";
import { readMethodStore } from "../../method/candidate.ts";
import { readCompletedWorkerResult } from "../repository/worker-completion.ts";
import { proposeScoutCandidates } from "../scheduler/scout-candidates.ts";
import { durableResearchTools, researchRoleExecutor, type ResearchRuntimeTools } from "./research-runtime.ts";
import type { AutonomousCoordinatorRuntime } from "./coordinator.ts";
import { refreshRegistryRuntimeFromPromoted } from "../../registry/runtime-read-model.ts";

/** One runtime over the same stores and bounded Scout infrastructure used by the standing runner. */
export async function autonomousStandingRuntime(input:{root:string;vaultRoot?:string;repos:ControlPlaneRepositories;transport?:ModelTransport;
  now?:()=>string;spaceOut?:ScoutToolContext["spaceOut"];browse?:ScoutToolContext["browse"];openBytes?:ScoutToolContext["openBytes"]}):Promise<AutonomousCoordinatorRuntime> {
  await refreshRegistryRuntimeFromPromoted();
  const now=input.now??(()=>new Date().toISOString());
  const tools:ResearchRuntimeTools={repos:input.repos,store:new DurableEvidenceStore(input.vaultRoot??join(input.root,...VAULT_DIR)),now,
    spaceOut:input.spaceOut??hostSpacer(),...(input.browse?{browse:input.browse}:{}),...(input.openBytes?{openBytes:input.openBytes}:{})};
  const prior=await input.repos.scoutResults.readAll();
  const priorWorkers=[] as Awaited<ReturnType<typeof input.repos.workerResults.readAll>>[number][];
  for(const record of await input.repos.workerResults.readAll()) {
    try { priorWorkers.push((await readCompletedWorkerResult(input.repos,record.id)).record); }
    catch { /* Uncommitted results do not become inherited investigation evidence. */ }
  }
  const knowledge=readMethodStore(join(input.root,"data","method","knowledge.json"));
  const runtime:AutonomousCoordinatorRuntime={...standingFleetRuntime(input),routineMeetingsAuthority:"PERMANENT_CIVIC_DATA_PLANE",roleExecutor:(task,holder)=>researchRoleExecutor(runtime,tools,task,holder),
    ...(input.transport?{scoutFor:(item,task,currentHistory)=>scoutExecutor({transport:input.transport!,now,
      toolkitFor:ctx=>buildScoutToolkit({...ctx,...durableResearchTools(tools,{project:item.project,attemptId:ctx.attemptId,workItemId:item.id,routeTaskId:task.id})}),
      contextFor:()=>{
        const history=(currentHistory??prior).filter(p=>p.workItemId===item.id);
        const plan=item.autonomousPlan!;
        const workers=priorWorkers.filter(w=>w.workItemId===item.id);
        const walks=workers.flatMap(w=>{
          const result=w.result;
          return result.role==="ACQUIRER" ? result.walk.map(r=>({...r,tool:result.source.retrieval}))
            : result.role==="DETECTIVE" ? result.walk.map(r=>({...r,tool:"read_inherited"})) : [];
        });
        const floor=computeRouteFloor({knowledge,jurisdiction:{state:plan.jurisdiction.toLowerCase(),...(plan.contract.schemaVersion===2?{publisher:plan.contract.sourceScope.sourceId}:{})},
          fields:plan.contract.schemaVersion===2?methodFields(plan.capability,plan.contract):["meeting","agenda"],
          adapterRoutes:plan.sources.map(source=>({routeId:source.id,label:source.applicableBecause,target:source.url}))});
        return {route:null,providerId:null,reason:`${task.routeLabel}. Resolve ${item.obligation}. Canonical registry references: ${plan.sourceRegistryReferences.join(", ")}. Seed URLs are leads until observed: ${plan.seedUrls.join(", ")}.`,
          inherited:{artifactIds:[...new Set([...history.flatMap(p=>p.artifactIds),...walks.flatMap(w=>w.artifactIds)])],summary:[
            `Inherited method version ${knowledge.version}. Walk applicable known methods before novelty; the fourteen retrieval rungs are a floor, never a completion ceiling.`,
            ...floor.routes.map(r=>`${r.routeId}: ${r.obligation}; ${r.proof}; ${r.label}; target ${r.target}; applicability ${r.grade}`),
            ...workers.map(w=>{
              const result=w.result;
              const issues="warnings" in result?result.warnings:result.findings;
              return `${w.id}: ${result.role} ${result.verdict}; recorded at ${w.endedAt}; issues ${issues.map(i=>i.code).join(", ") || "none recorded"}; unresolved results do not establish absence.`;
            }),
            ...history.map(p=>`${p.attemptId}: ${p.outcome}; next ${p.nextRungs.join(", ")}`)].join("\n"),
            priorRungs:[...history.flatMap(p=>p.rungs.map(r=>({rung:r.rung,tool:r.tool,target:r.target,observed:r.observed,ok:r.ok??null,at:r.at,attemptId:p.attemptId}))),
              ...walks.map(w=>({rung:w.rung,tool:w.tool,target:w.target,observed:w.observed,ok:w.outcome==="BLOCKED"?false:w.transport==="REACHABLE"?true:null,at:w.at,attemptId:w.attemptId}))],
            nextRungs:[...new Set([...(history.at(-1)?.nextRungs??[]),...walks.flatMap(w=>w.nextRouteIds)])]},
          tools:{spaceOut:tools.spaceOut,vault:async()=>{throw new Error("UNBOUND_SCOUT_VAULT_REFUSED");}},decision:"BOUNDED_MODEL_WORKER" as const};
      },onResult:async (result,artifacts)=>{
        let recorded=result;
        try {
          const proposal=await proposeScoutCandidates({repos:input.repos,root:input.root,result,artifacts,stamp:result.recordedAt.slice(0,10)});
          recorded={...result,methodCandidateIds:proposal.proposed.map(p=>p.candidateId),
            unverified:[...result.unverified,...proposal.notProposed.map(p=>`Method candidate ${p.routeId} not admitted: ${p.why}`)]};
        } catch(error) {
          /*
           * Candidate promotion and the Scout observation are different
           * facts. A missing or unavailable canonical candidate aggregate
           * still refuses the proposal, but must not erase the typed Scout
           * result (especially a transport failure) that was already learned.
           */
          recorded={...result,unverified:[...result.unverified,
            `Method candidates were not proposed: ${error instanceof Error?error.message:String(error)}`]};
        }
        await input.repos.scoutResults.append(recorded.obligationId,recorded.attemptId,recorded,recorded.recordedAt);
        return recorded;
      }
    })}:{})};
  return runtime;
}
