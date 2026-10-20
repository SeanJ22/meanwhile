import { readRolePlaybook } from "../playbooks.ts";
import { backfillBox } from "../box.ts";
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
import { openRuntimeMethod, requireRuntimeMethodVersion } from "../../method/runtime-manual.ts";
import { scoutStateHint } from "../scheduler/field-manual-scout.ts";
import { researchRoleExecutor, type ResearchRuntimeTools } from "./research-runtime.ts";
import { durableResearchTools } from "./durable-research-tools.ts";
import type { AutonomousCoordinatorRuntime } from "./coordinator.ts";
import { refreshVenueResolutionsFromPromoted } from "../../civic-data/curated-reader-read-model.ts";
import { mayUseTestFixture } from "../../civic-data/fixture-policy.ts";
import { evidenceProjection } from "./runtime.ts";
import { researchVaultResolver } from "./vault-object.ts";
import { installOperationalReferenceSubjects, releaseOperationalReferenceState, requiredJurisdictionRegistry } from "../../civic-data/operational-references.ts";
import { readOperationalReferenceSubjects, readOperationalReferenceStateIndex } from "../../civic-data/operational-reference-state-read.ts";
import { hasReviewedRegistry } from "../../civic-data/reviewed-registry-states.ts";
import { brokeredSiblingCaptures, selectStandingLineages } from "./standing-lineage.ts";
import { readLineageHistory } from "./scoped-history.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import type { WorkItem } from "../work-item.ts";
import { indexReportedFinding } from "../box.ts";
import { hunterFor, readAskedGaps } from "../../hunt/runtime.ts";
import { exaAgentExecutor, EXA_AGENT_ROUTE_ID } from "../../hunt/exa-lane.ts";
import { readGovernmentPackets } from "../../hunt/packet-read.ts";
import { huntPacketObligationId, reportableSubjects } from "../../hunt/packet.ts";
import type { HuntSearch, SearchBudget } from "../../hunt/search.ts";
import { workerVaultResolver } from "./vault.ts";
import { forEachAggregate, forEachLatestScout } from "./streamed-history.ts";
import { refreshDoorsForPass } from "../../doors/install.ts";

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
  /** Each task's history reads are scoped to its own work item, subject and lineage. */
  /** The transport for one jurisdiction's work, held on the area budget covering it; absent, `transport` serves all. */
  transportFor?:(jurisdiction:{readonly subjectId:string;readonly state:string|null},taskId?:string)=>ModelTransport;
  refusedBeforeSending?:(error:unknown)=>boolean}):Promise<AutonomousCoordinatorRuntime> {
  const now=input.now??(()=>new Date().toISOString());
  let siblingHeldRootFor: NonNullable<ResearchRuntimeTools["siblingHeldRootFor"]> = () => null;
  const tools:ResearchRuntimeTools={repos:input.repos,store:new DurableEvidenceStore(input.vaultRoot??join(input.root,...VAULT_DIR)),now,
    siblingHeldRootFor: held=>siblingHeldRootFor(held),
    spaceOut:input.spaceOut??hostSpacer(),...(input.browse?{browse:input.browse}:{}),...(input.openBytes?{openBytes:input.openBytes}:{}),
    ...(input.openBytesFor?{openBytesFor:input.openBytesFor}:{})};
  const knowledge=await openRuntimeMethod(input.repos);
  let taskState: string | null = null, installedState: string | null = null;
  let reviewedStates: readonly string[] | null = null;
  const releaseState = () => { if (installedState !== null) releaseOperationalReferenceState(); installedState = null; };
  try {
  const heldRuntime = standingFleetRuntime({...input,method:knowledge,siblingHeldRootFor: held=>siblingHeldRootFor(held)});

  const readRepairCapture = researchVaultResolver(input.repos, tools.store, "freshness");
  const registeredPublisherAddressFor = (subjectId:string):string|null => {
    const state = taskState ?? scoutStateHint(subjectId, null)[0];
    if (!state) return null;
    let registry;
    try { registry = requiredJurisdictionRegistry(state); } catch { return null; }
    const found = registry.jurisdictions.filter(row=>row.id===subjectId);
    if (found.length !== 1) return null;
    const address = found[0]!.ownWebAddress;
    try { const url = new URL(address ?? ""); return ["http:","https:"].includes(url.protocol) && !url.username && !url.password ? address : null; }
    catch { return null; }
  };
  // The worker replaces its history when it starts another place.
  let lineages: ReturnType<typeof selectStandingLineages> = [];
  let sharedOriginByRoot=new Map<string,Set<string>>();
  const brokerLineages=(history:{occurrences:Parameters<typeof selectStandingLineages>[0]["occurrences"];workItems:readonly WorkItem[];
    artifacts:Parameters<typeof selectStandingLineages>[0]["artifacts"];attempts:Parameters<typeof selectStandingLineages>[0]["attempts"];
    workerResults:Parameters<typeof selectStandingLineages>[0]["workerResults"];scouts:readonly ScoutResult[]})=>{
    lineages=selectStandingLineages(history);
    sharedOriginByRoot=new Map();
    for (const lineage of lineages.filter(row=>row.siblingRootIds.length>1)) {
      const address=registeredPublisherAddressFor(history.workItems.find(item=>item.id===lineage.rootWorkItemId)?.subject??"");
      if (!address) continue;
      const registeredHost=new URL(address).hostname.toLowerCase();
      const brokered=brokeredSiblingCaptures({lineage,artifacts:history.artifacts,attempts:history.attempts,scouts:history.scouts,registeredHost});
      sharedOriginByRoot.set(lineage.rootWorkItemId,new Set(brokered.map(row=>`${row.originWorkItemId}\u0000${row.artifactId}`)));
    }
  };

  siblingHeldRootFor=held=>{
    const lineage=lineages.find(row=>row.siblingRootIds.includes(held.originWorkItemId) &&
      row.rootWorkItemId!==held.originWorkItemId &&
      sharedOriginByRoot.get(row.rootWorkItemId)?.has(`${held.originWorkItemId}\u0000${held.artifactId}`));
    return lineage?.rootWorkItemId??null;
  };
  const runtime:AutonomousCoordinatorRuntime={...heldRuntime, close: () => { releaseState(); taskState = null; return knowledge.close(); },
    beginTask:async (task)=>{
      releaseState(); lineages = []; sharedOriginByRoot.clear(); taskState = null;
      const item = await input.repos.workItems.read(task.workItemId);
      const contract = task.workerTask?.contract ?? item?.value.autonomousPlan?.contract;
      const jurisdiction = contract?.schemaVersion === 2 ? contract.jurisdiction.state : item?.value.autonomousPlan?.jurisdiction;
      const states = scoutStateHint(item?.value.subject, jurisdiction), state = states.length === 1 ? states[0] : null;
      taskState = state;
      if (!mayUseTestFixture()) {
        if (state) {
          reviewedStates ??= (await readOperationalReferenceStateIndex()).states;
          if (reviewedStates.includes(state) || hasReviewedRegistry(state)) {
            const subjectIds = [...new Set([item?.value.subject, contract?.subjectId,
              contract?.schemaVersion === 2 ? contract.jurisdiction.canonicalId : undefined].filter((id): id is string => Boolean(id)))];
            const read = await readOperationalReferenceSubjects(state, subjectIds);
            installOperationalReferenceSubjects(read.registry, reviewedStates, subjectIds);
            installedState = state;
          }
          const doors = await refreshDoorsForPass(input.repos.doors, { state });
          if (!doors.partitions?.refreshed) throw new Error(doors.reason ?? "The task's registered doors could not be read");
          await refreshVenueResolutionsFromPromoted({ state });
        }
      }
      brokerLineages(await readLineageHistory(input.repos,task.workItemId)); },
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
        const packetNow=async()=>(await readGovernmentPackets([item.subject],now(),await readAskedGaps(input.repos,now(),item.subject))).get(item.subject)??null;
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
  } catch (error) { releaseState(); await knowledge.close(); throw error; }
}

/** The round's upkeep streams one source log or work page; lease workers do only their place's work. */
export async function maintainAutonomousStandingRuntime(input: Parameters<typeof autonomousStandingRuntime>[0]): Promise<void> {
  const now = input.now ?? (() => new Date().toISOString());
  const methodVersion = await requireRuntimeMethodVersion(input.repos);
  const update = async (rows: readonly import("../repository/types.ts").Persisted<WorkItem>[]) => {
    for (const row of rows) {
      const plan = row.value.autonomousPlan;
      if (plan?.contract.schemaVersion !== 2 || plan.contract.methodVersion !== 0 ||
        plan.contract.extraction.format !== "UNSUPPORTED" || plan.contract.sourceScope.observationArtifactIds.length) continue;
      await input.repos.workItems.compareAndSet(row.id, row.revision, { ...row.value,
        autonomousPlan: { ...plan, contract: { ...plan.contract, methodVersion } } }, now());
    }
  };
  await forEachAggregate(input.repos.workItems, row => update([row]));
  await backfillBox(input.repos, now());
  const vault = workerUpkeepEvidence(input);
  await forEachLatestScout(input.repos.scoutResults, result => workAdapterQueue({ repos: input.repos,
    results: [result], now: now(), readEvidence: vault,
    ...(input.transportFor ? { transportFor: result => input.transportFor!({ subjectId: result.subjectId,
      state: scoutStateHint(result.subjectId, result.obligationId)[0] ?? null }) } : {}) }).then(() => {}));
}

function workerUpkeepEvidence(input: Parameters<typeof autonomousStandingRuntime>[0]) {
  const store = new DurableEvidenceStore(input.vaultRoot ?? join(input.root, ...VAULT_DIR));
  const read = workerVaultResolver(input.repos, store, "freshness");
  return async (id: string) => evidenceProjection(await read(id));
}
