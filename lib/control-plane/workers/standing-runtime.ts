import { readRolePlaybook } from "../playbooks.ts";
import { indexScoutFindings, indexDetectiveFindings, indexReportedFinding } from "../box.ts";
import { workAdapterQueue } from "./engineering-adapter.ts";
import { join } from "node:path";
import { DurableEvidenceStore } from "../evidence/durable-store.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { ModelTransport } from "../scheduler/scout-executor.ts";
import { buildScoutToolkit } from "../scheduler/scout-tools.ts";
import type { ScoutToolContext } from "../scheduler/scout-contract.ts";
import { hostSpacer } from "../scheduler/http-executor.ts";
import { VAULT_DIR } from "../scheduler/vault.ts";
import { standingFleetRuntime } from "./standing.ts";
import { readMethodKnowledge } from "../../method/manual-bridge.ts";
import { scoutStateHint } from "../scheduler/field-manual-scout.ts";
import { researchRoleExecutor, type ResearchRuntimeTools } from "./research-runtime.ts";
import { durableResearchTools } from "./durable-research-tools.ts";
import type { AutonomousCoordinatorRuntime } from "./coordinator.ts";
import { refreshVenueResolutionsFromPromoted } from "../../civic-data/curated-reader-read-model.ts";
import { mayUseTestFixture } from "../../civic-data/fixture-policy.ts";
import { evidenceProjection } from "./runtime.ts";
import { researchVaultResolver } from "./vault-object.ts";
import { promotedRegistries } from "../scheduler/provider-inputs.ts";
import { brokeredSiblingCaptures, selectStandingLineages } from "./standing-lineage.ts";
import { readLineageHistory } from "./scoped-history.ts";
import type { WorkItem } from "../work-item.ts";
import { hunterFor, readAskedGaps } from "../../hunt/runtime.ts";
import { exaAgentExecutor, EXA_AGENT_ROUTE_ID } from "../../hunt/exa-lane.ts";
import { readGovernmentPackets } from "../../hunt/packet-read.ts";
import { huntPacketObligationId, reportableSubjects } from "../../hunt/packet.ts";
import type { HuntSearch, SearchBudget } from "../../hunt/search.ts";

/** One runtime over the same stores and bounded worker infrastructure used by the standing runner. */
export async function autonomousStandingRuntime(input:{root:string;vaultRoot?:string;repos:ControlPlaneRepositories;transport?:ModelTransport;
  environment?: Readonly<NodeJS.ProcessEnv>;
  now?:()=>string;spaceOut?:ScoutToolContext["spaceOut"];browse?:ScoutToolContext["browse"];openBytes?:ScoutToolContext["openBytes"];
  openBytesFor?:(subjectId:string)=>ScoutToolContext["openBytes"];
  /** The guarded search service, under the owner's paid-search switch and budget. */
  search?:HuntSearch;
  searchFor?:(subjectId:string)=>HuntSearch|undefined;
  /** The paid-search budget the Exa agent lane is admitted by. */
  searchBudget?:SearchBudget;
  /** When this process will be ended; a long outside run is cancelled before then. */
  endsAt?:number;
  /** Tells the worker pool this process is still working while it waits on an outside run. */
  progress?:()=>void;
  /** The rolling ceiling in force; the auditor admits against it (model-audit.ts). */
  auditCeilingUsd?:number;
  lifetimeHuntSubject?:(subjectId:string)=>boolean;
  /** The transport for one jurisdiction's work, held on the area budget covering it; absent, `transport` serves all. */
  transportFor?:(jurisdiction:{readonly subjectId:string;readonly state:string|null},taskId?:string)=>ModelTransport;
  refusedBeforeSending?:(error:unknown)=>boolean}):Promise<AutonomousCoordinatorRuntime> {
  if (!mayUseTestFixture()) await refreshVenueResolutionsFromPromoted();
  const now=input.now??(()=>new Date().toISOString());
  const siblingHeldRootFor: NonNullable<ResearchRuntimeTools["siblingHeldRootFor"]> = async held => {
    const history=await readLineageHistory(input.repos,held.childWorkItemId);
    for (const lineage of selectStandingLineages(history)) {
      if (!lineage.siblingRootIds.includes(held.originWorkItemId) || lineage.rootWorkItemId===held.originWorkItemId) continue;
      const address=registeredPublisherAddressFor(history.workItems.find(item=>item.id===lineage.rootWorkItemId)?.subject??"");
      if (!address) continue;
      const brokered=brokeredSiblingCaptures({lineage,artifacts:history.artifacts,attempts:history.attempts,scouts:history.scouts,
        registeredHost:new URL(address).hostname.toLowerCase()});
      if (brokered.some(row=>row.originWorkItemId===held.originWorkItemId && row.artifactId===held.artifactId)) return lineage.rootWorkItemId;
    }
    return null;
  };
  const tools:ResearchRuntimeTools={repos:input.repos,store:new DurableEvidenceStore(input.vaultRoot??join(input.root,...VAULT_DIR)),now,
    siblingHeldRootFor: held=>siblingHeldRootFor(held),
    spaceOut:input.spaceOut??hostSpacer(),...(input.browse?{browse:input.browse}:{}),...(input.openBytes?{openBytes:input.openBytes}:{}),
    ...(input.openBytesFor?{openBytesFor:input.openBytesFor}:{})};
  const knowledge=await readMethodKnowledge(input.repos);
  const heldRuntime = standingFleetRuntime({...input,method:knowledge,siblingHeldRootFor: held=>siblingHeldRootFor(held)});

  const readRepairCapture = researchVaultResolver(input.repos, tools.store, "freshness");
  const installed = promotedRegistries();
  const registeredPublisherAddressFor = (subjectId:string):string|null => {
    if ("unreadable" in installed) return null;
    const found = [...installed.registries.values()].flatMap(registry=>registry.jurisdictions.filter(row=>row.id===subjectId));
    if (found.length !== 1) return null;
    const address = found[0]!.ownWebAddress;
    try { const url = new URL(address ?? ""); return ["http:","https:"].includes(url.protocol) && !url.username && !url.password ? address : null; }
    catch { return null; }
  };
  const prepareWorkItem = async (item:WorkItem):Promise<WorkItem> => {
    const row = await input.repos.workItems.mustRead(item.id);
    const plan = row.value.autonomousPlan;
    if (plan?.contract.schemaVersion === 2 && plan.contract.methodVersion === 0 &&
      plan.contract.extraction.format === "UNSUPPORTED" && !plan.contract.sourceScope.observationArtifactIds.length) {
      item = (await input.repos.workItems.compareAndSet(row.id,row.revision,{...row.value,
        autonomousPlan:{...plan,contract:{...plan.contract,methodVersion:knowledge.version}}},now())).value;
    }
    const history=await readLineageHistory(input.repos,item.id);
    const artifacts=new Map(history.artifacts.map(artifact=>[artifact.artifactId,artifact]));
    for (const result of history.scouts) await indexScoutFindings(input.repos.boxFindings,result,now());
    for (const record of history.workerResults) if (record.result.role === "DETECTIVE") {
      await indexDetectiveFindings(input.repos.boxFindings,{...record,result:record.result},artifacts,now());
    }
    if (history.scouts.some(result=>result.outcome === "NEEDS_ADAPTER" && result.refusal === null)) {
      await workAdapterQueue({repos:input.repos,results:history.scouts,now:now(),
        readEvidence:async id=>evidenceProjection(await heldRuntime.readEvidence(id)),
        ...(input.transportFor?{transportFor:result=>input.transportFor!({subjectId:result.subjectId,state:scoutStateHint(result.subjectId,result.obligationId)[0]??null})}:{})});
    }
    return item;
  };

  const runtime:AutonomousCoordinatorRuntime={...heldRuntime,
    prepareWorkItem,
    beginTask:async (task,item)=>{ await prepareWorkItem(item??(await input.repos.workItems.mustRead(task.workItemId)).value); },
    rollingCeilingUsd:input.auditCeilingUsd??0,routineMeetingsAuthority:"PERMANENT_CIVIC_DATA_PLANE",
    roleExecutor:(task,holder)=>researchRoleExecutor(runtime,tools,task,holder,input.root),
    ...(input.transport?{scoutFor:async (item:WorkItem,task)=>{
      const search=input.searchFor?.(item.subject)??input.search;
      const transport=input.transportFor?input.transportFor({subjectId:item.subject,state:item.autonomousPlan?.jurisdiction??null},task.id):input.transport!;
      const readHeldArtifact=async (id:string)=>{
        const [{ artifact }, evidence] = await Promise.all([readRepairCapture(id), heldRuntime.readEvidence(id)]);
        return { ...evidenceProjection(evidence), provenance: { artifactId: id, canonicalUrl: artifact.canonicalUrl, retrievedAt: artifact.retrievedAt,
          permission: artifact.permission, methodRouteId: artifact.methodRouteId, httpStatus: artifact.httpStatus,
          retrievalUrl: artifact.retrievalUrl, contentType: artifact.contentType } };
      };
      const exaKey=(input.environment??process.env).EXA_API_KEY?.trim();
      if (task.routeId===EXA_AGENT_ROUTE_ID) {
        const packetNow=async()=>(await readGovernmentPackets([item.subject],now(),await readAskedGaps(input.repos,now()))).get(item.subject)??null;
        return exaAgentExecutor({key:exaKey,now,budget:input.searchBudget,packetNow,
          ...(input.endsAt!==undefined?{endsAt:input.endsAt}:{}),...(input.progress?{progress:input.progress}:{}),
          instructions:async()=>(await readRolePlaybook(input.repos,"HUNTER")).text,
          toolkitFor:ctx=>buildScoutToolkit({...ctx,root:input.root}),
          toolsFor:(job,packet)=>{
            const bound=durableResearchTools(tools,{project:item.project,attemptId:job.attemptId,workItemId:item.id,routeTaskId:task.id,subjectId:item.subject});
            return {vault:bound.vault,vaultBytes:bound.vaultBytes,spaceOut:bound.spaceOut,...(bound.openBytes?{openBytes:bound.openBytes}:{}),
              reportFinding:{subjects:reportableSubjects(packet),write:async finding=>({boxId:(await indexReportedFinding(input.repos.boxFindings,
                {workItemId:item.id,attemptId:job.attemptId,obligationId:huntPacketObligationId(item.subject),missionPart:null,finding},now())).id})}};
          },
          onResult:async result=>{ await input.repos.scoutResults.append(`${huntPacketObligationId(item.subject)}#exa`,result.attemptId,
            {...result,obligationId:huntPacketObligationId(item.subject)},result.recordedAt); }});
      }
      return hunterFor({repos:input.repos,root:input.root,now,tools,transport,
        ...(input.refusedBeforeSending?{refusedBeforeSending:input.refusedBeforeSending}:{}),
        ...(search?{search}:{}),...(input.environment?{environment:input.environment}:{}),readHeldArtifact},item,task);
    }}:{})};
  return runtime;
}
