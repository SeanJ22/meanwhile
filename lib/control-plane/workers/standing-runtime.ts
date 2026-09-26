import { join } from "node:path";
import { DurableEvidenceStore } from "../evidence/durable-store.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { scoutExecutor, type ModelTransport, type ScoutExecutorDeps } from "../scheduler/scout-executor.ts";
import { buildScoutToolkit } from "../scheduler/scout-tools.ts";
import type { ScoutToolContext } from "../scheduler/scout-contract.ts";
import { hostSpacer } from "../scheduler/http-executor.ts";
import { VAULT_DIR } from "../scheduler/vault.ts";
import { methodFields, standingFleetRuntime } from "./standing.ts";
import { computeRouteFloor } from "../preflight.ts";
import { readMethodStore } from "../../method/candidate.ts";
import { readCompletedWorkerResults } from "../repository/worker-completion.ts";
import { proposeScoutCandidates } from "../scheduler/scout-candidates.ts";
import { emptyFieldManual, type FieldManualStore } from "../field-manual.ts";
import {
  compoundingPair,
  fieldManualBriefLines,
  knownRouteIds,
  scoutDiscoveryEntries,
  scoutFieldManualProjection,
  scoutStateHint,
  usedFieldManualEntryIds,
  writeFieldManualDiscoveries,
} from "../scheduler/field-manual-scout.ts";
import { durableResearchTools, researchRoleExecutor, type ResearchRuntimeTools } from "./research-runtime.ts";
import type { AutonomousCoordinatorRuntime } from "./coordinator.ts";
import { refreshRegistryRuntimeFromPromoted } from "../../registry/runtime-read-model.ts";
import { refreshVenueResolutionsFromPromoted } from "../../civic-data/curated-reader-read-model.ts";
import { mayUseTestFixture } from "../../civic-data/fixture-policy.ts";
import { consumePlanRepairs, planRepairBrief } from "./plan-repair.ts";
import { evidenceProjection } from "./runtime.ts";
import { researchVaultResolver } from "./vault-object.ts";

/** One runtime over the same stores and bounded Scout infrastructure used by the standing runner. */
export async function autonomousStandingRuntime(input:{root:string;vaultRoot?:string;repos:ControlPlaneRepositories;transport?:ModelTransport;
  now?:()=>string;spaceOut?:ScoutToolContext["spaceOut"];browse?:ScoutToolContext["browse"];openBytes?:ScoutToolContext["openBytes"];
  /** The rolling ceiling in force; the auditor admits against it (model-audit.ts). */
  auditCeilingUsd?:number;
  /** MW-033: the rolling-ceiling hold a Scout escalation must win before its frontier attempt; absent, every escalation is refused NOT_RESERVED. */
  reserveScoutEscalation?:ScoutExecutorDeps["reserveEscalation"];
  /** MW-021 (2026-09-25): the transport for the work on one jurisdiction, so its requests are held on the area budget covering it; absent, `transport` serves all. */
  transportFor?:(jurisdiction:{readonly subjectId:string;readonly state:string|null})=>ModelTransport}):Promise<AutonomousCoordinatorRuntime> {
  await refreshRegistryRuntimeFromPromoted();
  if (!mayUseTestFixture()) await refreshVenueResolutionsFromPromoted();
  const now=input.now??(()=>new Date().toISOString());
  const tools:ResearchRuntimeTools={repos:input.repos,store:new DurableEvidenceStore(input.vaultRoot??join(input.root,...VAULT_DIR)),now,
    spaceOut:input.spaceOut??hostSpacer(),...(input.browse?{browse:input.browse}:{}),...(input.openBytes?{openBytes:input.openBytes}:{})};
  const [prior, priorWorkers] = await Promise.all([
    input.repos.scoutResults.readAll(), readCompletedWorkerResults(input.repos),
  ]);
  const knowledge=readMethodStore(join(input.root,"data","method","knowledge.json"));
  const fmRead = await input.repos.fieldManual.read("live").catch(() => null);
  let fieldManual: FieldManualStore = fmRead?.value ?? emptyFieldManual();
  let fieldManualRevision = fmRead?.revision ?? 0;
  const inheritedFieldManualCounts = new Map<string, number>();
  const inheritedManualStores = new Map<string, FieldManualStore>();
  const inheritedFieldManualDoors = new Map<string, { readonly entryIds: readonly string[]; readonly lines: readonly string[] }>();
  const heldRuntime = standingFleetRuntime(input);
  const readRepairCapture = researchVaultResolver(input.repos, tools.store, "freshness");
  await consumePlanRepairs({ repos: input.repos, scouts: prior, now: now(),
    readCapture: async id => {
      const { artifact } = await readRepairCapture(id);
      return { evidence: evidenceProjection(await heldRuntime.readEvidence(id)), permission: artifact.permission, transport: artifact.transport,
        httpStatus: artifact.httpStatus, partial: artifact.httpStatus === 206 || Boolean(artifact.headers["content-range"]) || artifact.retentionPolicy === "DIAGNOSTIC" };
    } });
  const runtime:AutonomousCoordinatorRuntime={...heldRuntime,routineMeetingsAuthority:"PERMANENT_CIVIC_DATA_PLANE",roleExecutor:(task,holder)=>researchRoleExecutor(runtime,tools,task,holder),
    ...(input.transport?{scoutFor:(item,task,currentHistory)=>scoutExecutor({transport:input.transportFor?input.transportFor({subjectId:item.subject,state:item.autonomousPlan?.jurisdiction??null}):input.transport!,now,
      ...(input.reserveScoutEscalation?{reserveEscalation:input.reserveScoutEscalation}:{}),
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
        // RULING 63: inherit the one growing field manual too, projected to this jurisdiction.
        const manualProjection=scoutFieldManualProjection(fieldManual,{subjectId:plan.jurisdiction,obligationId:item.id});
        inheritedFieldManualCounts.set(item.id,manualProjection.entryIds.length);
        inheritedManualStores.set(item.id,fieldManual);
        const manualLines=fieldManualBriefLines(manualProjection);
        inheritedFieldManualDoors.set(item.id,{entryIds:manualProjection.entryIds,lines:manualLines});
        return {route:null,providerId:null,reason:`${task.routeLabel}. Resolve ${item.obligation}. Canonical registry references: ${plan.sourceRegistryReferences.join(", ")}. Seed URLs are leads until observed: ${plan.seedUrls.join(", ")}. ${planRepairBrief(plan)}`,
          inherited:{artifactIds:[...new Set([...history.flatMap(p=>p.artifactIds),...walks.flatMap(w=>w.artifactIds)])],summary:[
            ...manualLines,
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
        // RULING 63 reported pair + live write-back (no human method:learn step).
        const handedManual = inheritedManualStores.get(result.workItemId) ?? fieldManual;
        const pair=compoundingPair(inheritedFieldManualCounts.get(result.workItemId)??0,result,knownRouteIds(handedManual));
        const doors=inheritedFieldManualDoors.get(result.workItemId);
        recorded={...recorded,inheritedFieldManual:pair.inheritedCount,rebuiltExistingRoutes:pair.rebuiltExisting,
          ...(doors?{inheritedFieldManualEntryIds:doors.entryIds,inheritedFieldManualLines:doors.lines,
            // MW-025: which handed doors this walk actually went through.
            usedFieldManualEntryIds:usedFieldManualEntryIds(result,doors.entryIds,handedManual)}:{})};
        if(result.refusal===null&&result.candidates.length>0){
          const written=await writeFieldManualDiscoveries(input.repos,scoutDiscoveryEntries(result,scoutStateHint(result.subjectId,result.obligationId)),result.recordedAt);
          if(written.error) recorded={...recorded,unverified:[...recorded.unverified,`field manual write-back failed: ${written.error}`]};
          else {
            // Read the canonical result, including concurrent writers, before a later
            // task constructs its context. Already running tasks retain their receipt.
            try {
              const refreshed = await input.repos.fieldManual.read("live");
              if (refreshed && refreshed.revision >= fieldManualRevision) { fieldManualRevision = refreshed.revision; fieldManual = refreshed.value; }
            } catch (error) {
              recorded = { ...recorded, unverified: [...recorded.unverified, `field manual saved but refresh failed: ${String(error)}`] };
            }
          }
        }
        await input.repos.scoutResults.append(recorded.obligationId,recorded.attemptId,recorded,recorded.recordedAt);
        return recorded;
      }
    })}:{})};
  return runtime;
}
