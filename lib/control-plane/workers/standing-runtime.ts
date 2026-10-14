import { readRolePlaybook } from "../playbooks.ts";
import { buildBoxFindings } from "./scout-extraction.ts";
import { readIntents, RESEARCH_INTENT_LOG_KEY } from "../scheduler/research-policy.ts";
import { readPublicationSourcePolicy } from "../promotion/source-settings.ts";
import { backfillBox, boxIndexEnabled } from "../box.ts";
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
import { readCompletedWorkerResults } from "../repository/worker-completion.ts";
import { scoutStateHint } from "../scheduler/field-manual-scout.ts";
import { researchRoleExecutor, type ResearchRuntimeTools } from "./research-runtime.ts";
import { durableResearchTools } from "./durable-research-tools.ts";
import type { AutonomousCoordinatorRuntime } from "./coordinator.ts";
import { refreshRegistryRuntimeFromPromoted } from "../../registry/runtime-read-model.ts";
import { refreshVenueResolutionsFromPromoted } from "../../civic-data/curated-reader-read-model.ts";
import { mayUseTestFixture } from "../../civic-data/fixture-policy.ts";
import { evidenceProjection } from "./runtime.ts";
import { researchVaultResolver } from "./vault-object.ts";
import { promotedRegistries } from "../scheduler/provider-inputs.ts";
import { brokeredSiblingCaptures, LINEAGE_ARTIFACT_FIELDS, LINEAGE_ATTEMPT_FIELDS, selectStandingLineages, type LineageArtifact, type LineageAttempt } from "./standing-lineage.ts";
import { readLineageHistory } from "./scoped-history.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import type { WorkItem } from "../work-item.ts";
import { indexReportedFinding } from "../box.ts";
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
  /** Each task's history reads are scoped to its own work item, subject and lineage. */
  scopedReads?:boolean;
  /** The transport for one jurisdiction's work, held on the area budget covering it; absent, `transport` serves all. */
  transportFor?:(jurisdiction:{readonly subjectId:string;readonly state:string|null},taskId?:string)=>ModelTransport;
  refusedBeforeSending?:(error:unknown)=>boolean}):Promise<AutonomousCoordinatorRuntime> {
  await refreshRegistryRuntimeFromPromoted();
  if (!mayUseTestFixture()) await refreshVenueResolutionsFromPromoted();
  const now=input.now??(()=>new Date().toISOString());
  let siblingHeldRootFor: NonNullable<ResearchRuntimeTools["siblingHeldRootFor"]> = () => null;
  const tools:ResearchRuntimeTools={repos:input.repos,store:new DurableEvidenceStore(input.vaultRoot??join(input.root,...VAULT_DIR)),now,
    siblingHeldRootFor: held=>siblingHeldRootFor(held),
    spaceOut:input.spaceOut??hostSpacer(),...(input.browse?{browse:input.browse}:{}),...(input.openBytes?{openBytes:input.openBytes}:{}),
    ...(input.openBytesFor?{openBytesFor:input.openBytesFor}:{})};
  // A scoped (lease worker) runtime reads each task's own history as it begins and leaves
  // whole-store upkeep to the research round, which builds this runtime unscoped every wave.
  const scoped = input.scopedReads === true;
  const [prior, initialWorkers] = scoped ? [[] as ScoutResult[], [] as Awaited<ReturnType<typeof readCompletedWorkerResults>>] : await Promise.all([
    input.repos.scoutResults.readAll(), readCompletedWorkerResults(input.repos),
  ]);
  const indexFindings = boxIndexEnabled(input.environment ?? process.env);
  // One worker process builds this runtime once and runs many tasks through it; `beginTask` keeps one task's
  // worker history current without re-reading everyone's.
  let priorWorkers = initialWorkers;
  const knowledge=await readMethodKnowledge(input.repos);
  for (const row of scoped ? [] : await input.repos.workItems.list()) {
    const plan = row.value.autonomousPlan;
    if (plan?.contract.schemaVersion !== 2 || plan.contract.methodVersion !== 0 ||
      plan.contract.extraction.format !== "UNSUPPORTED" || plan.contract.sourceScope.observationArtifactIds.length) continue;
    await input.repos.workItems.compareAndSet(row.id, row.revision, { ...row.value,
      autonomousPlan: { ...plan, contract: { ...plan.contract, methodVersion: knowledge.version } } }, now());
  }
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
  // The round owns Box replay/build upkeep; scoped lease runtimes skip it.
  if (!scoped && indexFindings) {
    const [allWorkRows, allArtifactRows] = await Promise.all([
      input.repos.workItems.list(), input.repos.artifacts.readAll(),
    ]);
    if (indexFindings) {
      await backfillBox(input.repos.boxFindings, { scouts: prior,
        detectives: initialWorkers.filter(record => record.result.role === "DETECTIVE") as import("../box.ts").BoxDetectiveRecord[],
        artifacts: new Map(allArtifactRows.map(artifact => [artifact.artifactId, artifact])) }, now());
    }
    if (indexFindings && !readIntents([...(await input.repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY))]).runnerPause.paused) {
      const sourcePolicy = await readPublicationSourcePolicy(input.repos);
      const built = await buildBoxFindings({ repos: input.repos, items: allWorkRows.map(row => row.value), now, leaseMs: 120_000,
        readCapture: async id => {
          const [{ artifact }, evidence] = await Promise.all([readRepairCapture(id), heldRuntime.readEvidence(id)]);
          return { evidence: evidenceProjection(evidence), sourcePolicy, observedAt: artifact.retrievedAt,
            httpStatus: artifact.httpStatus, transport: artifact.transport,
            partial: artifact.httpStatus === 206 || artifact.retentionPolicy === "DIAGNOSTIC" || artifact.extraction?.complete === false };
        } });
      if (built.built.length) priorWorkers = await readCompletedWorkerResults(input.repos);
    }
  }
  // Build saved findings before any paid adapter work.
  if (!scoped) await workAdapterQueue({repos:input.repos,results:prior,now:now(),readEvidence:async id=>evidenceProjection(await heldRuntime.readEvidence(id)),
    ...(input.transportFor?{transportFor:result=>input.transportFor!({subjectId:result.subjectId,state:scoutStateHint(result.subjectId,result.obligationId)[0]??null})}:{})});
  // The lineage broker: which sibling's captures each lineage root may reuse. Whole-store when unscoped; one task's lineage when scoped.
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
  const brokerWholeStore=async()=>{
    const [allWorkRows,allOccurrenceRows,allArtifactRows,allAttemptRows,scouts,workers] = await Promise.all([
      input.repos.workItems.list(),input.repos.occurrences.list(),
      input.repos.artifacts.readAllNarrowed(LINEAGE_ARTIFACT_FIELDS) as Promise<readonly LineageArtifact[]>,input.repos.attempts.listNarrowed(LINEAGE_ATTEMPT_FIELDS),
      scoped ? input.repos.scoutResults.readAll() : prior, scoped ? readCompletedWorkerResults(input.repos) : priorWorkers,
    ]);
    brokerLineages({occurrences:allOccurrenceRows.map(row=>row.value),workItems:allWorkRows.map(row=>row.value),
      artifacts:allArtifactRows,attempts:allAttemptRows.map(row=>row.value as LineageAttempt),workerResults:workers,scouts});
  };
  if (!scoped) await brokerWholeStore();

  siblingHeldRootFor=held=>{
    const lineage=lineages.find(row=>row.siblingRootIds.includes(held.originWorkItemId) &&
      row.rootWorkItemId!==held.originWorkItemId &&
      sharedOriginByRoot.get(row.rootWorkItemId)?.has(`${held.originWorkItemId}\u0000${held.artifactId}`));
    return lineage?.rootWorkItemId??null;
  };
  const runtime:AutonomousCoordinatorRuntime={...heldRuntime,
    beginTask:async (task)=>{
      const fresh=await readCompletedWorkerResults(input.repos,task.workItemId);
      priorWorkers=[...priorWorkers.filter(w=>w.workItemId!==task.workItemId),...fresh];
      if (scoped) {
        // A store without the filtered reads (a test double) brokers from the whole store, as before.
        const history=await readLineageHistory(input.repos,task.workItemId);
        if (history) brokerLineages(history); else await brokerWholeStore();
      } },
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
