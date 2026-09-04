import { join } from "node:path";
import { DurableEvidenceStore } from "../evidence/durable-store.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { scoutExecutor, type ModelTransport } from "../scheduler/scout-executor.ts";
import { buildScoutToolkit } from "../scheduler/scout-tools.ts";
import type { ScoutToolContext } from "../scheduler/scout-contract.ts";
import { hostSpacer } from "../scheduler/http-executor.ts";
import { VAULT_DIR } from "../scheduler/vault.ts";
import { standingFleetRuntime } from "./standing.ts";
import { durableResearchTools, researchRoleExecutor, type ResearchRuntimeTools } from "./research-runtime.ts";
import type { AutonomousCoordinatorRuntime } from "./coordinator.ts";

/** One runtime over the same stores and bounded Scout infrastructure used by the standing runner. */
export async function autonomousStandingRuntime(input:{root:string;vaultRoot?:string;repos:ControlPlaneRepositories;transport?:ModelTransport;
  now?:()=>string;spaceOut?:ScoutToolContext["spaceOut"];browse?:ScoutToolContext["browse"]}):Promise<AutonomousCoordinatorRuntime> {
  const now=input.now??(()=>new Date().toISOString());
  const tools:ResearchRuntimeTools={repos:input.repos,store:new DurableEvidenceStore(input.vaultRoot??join(input.root,...VAULT_DIR)),now,
    spaceOut:input.spaceOut??hostSpacer(),...(input.browse?{browse:input.browse}:{})};
  const prior=await input.repos.scoutResults.readAll();
  const runtime:AutonomousCoordinatorRuntime={...standingFleetRuntime(input),roleExecutor:(task,holder)=>researchRoleExecutor(runtime,tools,task,holder),
    ...(input.transport?{scoutFor:(item,task,currentHistory)=>scoutExecutor({transport:input.transport!,now,
      toolkitFor:ctx=>buildScoutToolkit({...ctx,...durableResearchTools(tools,{project:item.project,attemptId:ctx.attemptId,workItemId:item.id,routeTaskId:task.id})}),
      contextFor:()=>{
        const history=(currentHistory??prior).filter(p=>p.workItemId===item.id);
        return {route:null,providerId:null,reason:`Discover an observed authoritative route for ${item.obligation}. Canonical registry references: ${item.autonomousPlan!.sourceRegistryReferences.join(", ")}. Seed URLs are leads until observed: ${item.autonomousPlan!.seedUrls.join(", ")}.`,
          inherited:{artifactIds:[...new Set(history.flatMap(p=>p.artifactIds))],summary:history.map(p=>`${p.attemptId}: ${p.outcome}; next ${p.nextRungs.join(", ")}`).join("\n"),
            priorRungs:history.flatMap(p=>p.rungs.map(r=>({rung:r.rung,tool:r.tool,target:r.target,observed:r.observed,ok:r.ok??null,at:r.at,attemptId:p.attemptId}))),nextRungs:history.at(-1)?.nextRungs??[]},
          tools:{spaceOut:tools.spaceOut,vault:async()=>{throw new Error("UNBOUND_SCOUT_VAULT_REFUSED");}},decision:"BOUNDED_MODEL_WORKER" as const};
      },onResult:async result=>{await input.repos.scoutResults.append(result.obligationId,result.attemptId,result,result.recordedAt);}
    })}:{})};
  return runtime;
}
