import { workAdapterQueue } from "./engineering-adapter.ts";
import { detectiveExecutor, heldRecoveryBrief, investigationRole, subjectScoutHistory } from "./detective.ts";
import { outsideRecordBlockBriefs } from "./record-block.ts";
import { readFieldManual, writeFieldManual, newFieldManualEntry } from "../field-manual.ts";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { readFile } from "node:fs/promises";
import { DurableEvidenceStore } from "../evidence/durable-store.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { scoutExecutor, type ModelTransport, type ScoutExecutorDeps } from "../scheduler/scout-executor.ts";
import { buildScoutToolkit } from "../scheduler/scout-tools.ts";
import type { ScoutToolContext } from "../scheduler/scout-contract.ts";
import { hostSpacer } from "../scheduler/http-executor.ts";
import { VAULT_DIR } from "../scheduler/vault.ts";
import { methodFields, standingFleetRuntime } from "./standing.ts";
import { computeRouteFloor } from "../preflight.ts";
import { readMethodKnowledge } from "../../method/manual-bridge.ts";
import { readCompletedWorkerResults } from "../repository/worker-completion.ts";
import { proposeScoutCandidates } from "../scheduler/scout-candidates.ts";
import { type FieldManualStore } from "../field-manual.ts";
import {
  compoundingPair,
  scoutFieldManualCatalog,
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
import { consumePlanRepairs, planRepairBrief, planRepairFailureBrief, type PlanRepairLink } from "./plan-repair.ts";
import { evidenceProjection } from "./runtime.ts";
import { researchVaultResolver } from "./vault-object.ts";
import { promotedRegistries } from "../scheduler/provider-inputs.ts";
import { brokeredSiblingCaptures, selectStandingLineages } from "./standing-lineage.ts";

/** One runtime over the same stores and bounded Scout infrastructure used by the standing runner. */
export async function autonomousStandingRuntime(input:{root:string;vaultRoot?:string;repos:ControlPlaneRepositories;transport?:ModelTransport;
  environment?: Readonly<NodeJS.ProcessEnv>;
  now?:()=>string;spaceOut?:ScoutToolContext["spaceOut"];browse?:ScoutToolContext["browse"];openBytes?:ScoutToolContext["openBytes"];
  openBytesFor?:(subjectId:string)=>ScoutToolContext["openBytes"];
  /** The existing guarded search service, with the same accounting and owner settings as the first Scout. */
  search?:ScoutToolContext["search"];
  searchFor?:(subjectId:string)=>ScoutToolContext["search"];
  /** The rolling ceiling in force; the auditor admits against it (model-audit.ts). */
  auditCeilingUsd?:number;
  lifetimeHuntSubject?:(subjectId:string)=>boolean;
  /** MW-033: the rolling-ceiling hold a Scout escalation must win before its frontier attempt; absent, every escalation is refused NOT_RESERVED. */
  reserveScoutEscalation?:ScoutExecutorDeps["reserveEscalation"];
  /** MW-021 (2026-09-25): the transport for the work on one jurisdiction, so its requests are held on the area budget covering it; absent, `transport` serves all. */
  transportFor?:(jurisdiction:{readonly subjectId:string;readonly state:string|null})=>ModelTransport}):Promise<AutonomousCoordinatorRuntime> {
  await refreshRegistryRuntimeFromPromoted();
  if (!mayUseTestFixture()) await refreshVenueResolutionsFromPromoted();
  const now=input.now??(()=>new Date().toISOString());
  let siblingHeldRootFor: NonNullable<ResearchRuntimeTools["siblingHeldRootFor"]> = () => null;
  const tools:ResearchRuntimeTools={repos:input.repos,store:new DurableEvidenceStore(input.vaultRoot??join(input.root,...VAULT_DIR)),now,
    siblingHeldRootFor: held=>siblingHeldRootFor(held),
    spaceOut:input.spaceOut??hostSpacer(),...(input.browse?{browse:input.browse}:{}),...(input.openBytes?{openBytes:input.openBytes}:{}),
    ...(input.openBytesFor?{openBytesFor:input.openBytesFor}:{})};
  const [prior, initialWorkers] = await Promise.all([
    input.repos.scoutResults.readAll(), readCompletedWorkerResults(input.repos),
  ]);
  // One worker process builds this runtime once and runs many tasks through it; `beginTask` keeps one task's
  // worker history current without re-reading everyone's.
  let priorWorkers = initialWorkers;
  const knowledge=await readMethodKnowledge(input.repos);
  for (const row of await input.repos.workItems.list()) {
    const plan = row.value.autonomousPlan;
    if (plan?.contract.schemaVersion !== 2 || plan.contract.methodVersion !== 0 ||
      plan.contract.extraction.format !== "UNSUPPORTED" || plan.contract.sourceScope.observationArtifactIds.length) continue;
    await input.repos.workItems.compareAndSet(row.id, row.revision, { ...row.value,
      autonomousPlan: { ...plan, contract: { ...plan.contract, methodVersion: knowledge.version } } }, now());
  }
  const inheritedFieldManualCounts = new Map<string, number>();
  const inheritedManualStores = new Map<string, FieldManualStore>();
  const inheritedFieldManualDoors = new Map<string, { readonly entryIds: readonly string[]; readonly availableIds: readonly string[]; readonly lines: readonly string[] }>();
  const heldRuntime = standingFleetRuntime({...input,method:knowledge,siblingHeldRootFor: held=>siblingHeldRootFor(held)});
  // Held data and plain adapters first; generated adapters use the same guarded area transport as research.
  await workAdapterQueue({repos:input.repos,results:prior,now:now(),readEvidence:async id=>evidenceProjection(await heldRuntime.readEvidence(id)),
    ...(input.transportFor?{transportFor:result=>input.transportFor!({subjectId:result.subjectId,state:scoutStateHint(result.subjectId,result.obligationId)[0]??null})}:{})});
  const fmRead = await readFieldManual(input.repos,{role:"SCOUT"});
  let fieldManual: FieldManualStore = fmRead.store;
  let fieldManualRevision = fmRead.revision ?? 0;
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
  const [allWorkRows,allOccurrenceRows,allArtifactRows,allAttemptRows] = await Promise.all([
    input.repos.workItems.list(),input.repos.occurrences.list(),input.repos.artifacts.readAll(),input.repos.attempts.list(),
  ]);
  const allWork=allWorkRows.map(row=>row.value);
  const lineages=selectStandingLineages({occurrences:allOccurrenceRows.map(row=>row.value),workItems:allWork,
    artifacts:allArtifactRows,attempts:allAttemptRows.map(row=>row.value),workerResults:priorWorkers});
  const sharedHeldByRoot=new Map<string,string[]>();
  const sharedOriginByRoot=new Map<string,Set<string>>();
  for (const lineage of lineages.filter(row=>row.siblingRootIds.length>1)) {
    const address=registeredPublisherAddressFor(allWork.find(item=>item.id===lineage.rootWorkItemId)?.subject??"");
    if (!address) continue;
    const registeredHost=new URL(address).hostname.toLowerCase();
    const brokered=brokeredSiblingCaptures({lineage,artifacts:allArtifactRows,
      attempts:allAttemptRows.map(row=>row.value),scouts:prior,registeredHost});
    sharedHeldByRoot.set(lineage.rootWorkItemId,[...new Set(brokered.map(row=>row.artifactId))]);
    sharedOriginByRoot.set(lineage.rootWorkItemId,new Set(brokered.map(row=>`${row.originWorkItemId}\u0000${row.artifactId}`)));
  }
  siblingHeldRootFor=held=>{
    const lineage=lineages.find(row=>row.siblingRootIds.includes(held.originWorkItemId) &&
      row.rootWorkItemId!==held.originWorkItemId &&
      sharedOriginByRoot.get(row.rootWorkItemId)?.has(`${held.originWorkItemId}\u0000${held.artifactId}`));
    return lineage?.rootWorkItemId??null;
  };
  const deferredSiblingRoots=new Set(lineages.flatMap(lineage=>lineage.siblingRootIds.filter(id=>id!==lineage.rootWorkItemId)));
  await consumePlanRepairs({ repos: input.repos, scouts: prior.filter(result=>!deferredSiblingRoots.has(result.workItemId)),
    now: now(),registeredPublisherAddressFor,
    authorizedSiblingArtifactIdsFor: parent=>sharedHeldByRoot.get(parent.id)??[],
    readCapture: async id => {
      const { artifact } = await readRepairCapture(id);
      return { evidence: evidenceProjection(await heldRuntime.readEvidence(id)), permission: artifact.permission, transport: artifact.transport,
        httpStatus: artifact.httpStatus, partial: artifact.httpStatus === 206 || Boolean(artifact.headers["content-range"]) || artifact.retentionPolicy === "DIAGNOSTIC" };
    } });
  // CP-19: a field dropped for sitting outside its person's row goes to a detective (DP-03); the kept record still publishes.
  const outsideBlockLines=(workItemId:string)=>outsideRecordBlockBriefs(priorWorkers.filter(w=>w.workItemId===workItemId)
    .flatMap(w=>"warnings" in w.result?w.result.warnings:w.result.findings));
  const runtime:AutonomousCoordinatorRuntime={...heldRuntime,
    beginTask:async task=>{ const fresh=await readCompletedWorkerResults(input.repos,task.workItemId);
      priorWorkers=[...priorWorkers.filter(w=>w.workItemId!==task.workItemId),...fresh]; },
    rollingCeilingUsd:input.auditCeilingUsd??0,routineMeetingsAuthority:"PERMANENT_CIVIC_DATA_PLANE",
    authorizedSiblingHeldArtifactIdsFor:item=>sharedHeldByRoot.get(item.id)??[],
    roleExecutor:(task,holder)=>researchRoleExecutor(runtime,tools,task,holder,input.root),
    ...(input.transport?{scoutFor:(item,task,currentHistory)=>(investigationRole(subjectScoutHistory(currentHistory??prior,item.subject,item.autonomousPlan!.contract.recordClass),task.routeLabel.includes('UNRESOLVED_INVESTIGATION') || heldRecoveryBrief(item.publicationOutcome)!==null || outsideBlockLines(item.id).length>0 || priorWorkers.some(w=>w.workItemId===item.id && (!["ACQUIRED","EXTRACTED","PASS","SUPPORTED","SURVIVED","CANDIDATE_PROVED"].includes(w.result.verdict) || ("warnings" in w.result ? w.result.warnings : w.result.findings).some(f=>f.severity==="BLOCKING")))) === "DETECTIVE" ? detectiveExecutor : scoutExecutor)({transport:input.transportFor?input.transportFor({subjectId:item.subject,state:item.autonomousPlan?.jurisdiction??null}):input.transport!,now,
      ...(input.reserveScoutEscalation?{reserveEscalation:input.reserveScoutEscalation}:{}),
      toolkitFor:ctx=>buildScoutToolkit({...ctx,root:input.root,
        obligation:{...ctx.obligation,obligation:{...ctx.obligation.obligation,autonomousPlan:item.autonomousPlan}},
        ...(input.environment?{sourceApi:{env:input.environment}}:{}),...durableResearchTools(tools,{project:item.project,attemptId:ctx.attemptId,workItemId:item.id,routeTaskId:task.id,subjectId:item.subject}),
        readHeldArtifact: async id => {
          const [{ artifact }, evidence] = await Promise.all([readRepairCapture(id), heldRuntime.readEvidence(id)]);
          return { ...evidenceProjection(evidence), provenance: {
            artifactId: id, canonicalUrl: artifact.canonicalUrl, retrievedAt: artifact.retrievedAt,
            permission: artifact.permission, methodRouteId: artifact.methodRouteId, httpStatus: artifact.httpStatus,
            retrievalUrl: artifact.retrievalUrl, contentType: artifact.contentType,
          } };
        },
        readManualDocument: async path => {
          const allowed = ctx.inherited.manualEntries?.some(entry => entry.payload !== null && typeof entry.payload === "object" &&
            "path" in entry.payload && entry.payload.path === path) ?? false;
          if (!allowed) throw new Error("MANUAL_DOCUMENT_NOT_HANDED_TO_WORKER");
          const root = resolve(input.root), absolute = resolve(root, path), within = relative(root, absolute);
          if (!within || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error("MANUAL_DOCUMENT_OUTSIDE_CHECKOUT");
          return readFile(absolute, "utf8");
        },
        ...((input.searchFor?.(item.subject) ?? input.search) ? { search: input.searchFor?.(item.subject) ?? input.search } : {})}),
      contextFor:()=>{
        const history=subjectScoutHistory(currentHistory??prior,item.subject,item.autonomousPlan!.contract.recordClass);
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
        const manualProjection=scoutFieldManualProjection(fieldManual,{subjectId:plan.jurisdiction,obligationId:item.id,recordClass:plan.contract.recordClass});
        const manualEntries=scoutFieldManualCatalog(fieldManual,{subjectId:plan.jurisdiction,obligationId:item.id});
        const repair=(item as typeof item & {readonly planRepair?:PlanRepairLink}).planRepair;
        inheritedFieldManualCounts.set(item.id,manualEntries.length);
        inheritedManualStores.set(item.id,fieldManual);
        const manualLines=fieldManualBriefLines(manualProjection);
        inheritedFieldManualDoors.set(item.id,{entryIds:manualProjection.entryIds,availableIds:manualEntries.map(entry=>entry.id),lines:manualLines});
        return {route:null,providerId:null,sourceRecordClass:plan.contract.recordClass,
          reason:`${task.routeLabel}. Resolve ${item.obligation}. Canonical registry references: ${plan.sourceRegistryReferences.join(", ")}. Seed URLs are leads until observed: ${plan.seedUrls.join(", ")}. ${planRepairBrief(plan)}`,
          inherited:{artifactIds:[...new Set([...history.flatMap(p=>p.artifactIds),...walks.flatMap(w=>w.artifactIds),
            ...(repair?.retainedEvidenceIds??[]),...(repair?.sourceArtifactId?[repair.sourceArtifactId]:[]),
            ...(sharedHeldByRoot.get(item.id)??[])])],manualEntries,summary:[
            ...manualLines,
            ...planRepairFailureBrief(item),
            ...(heldRecoveryBrief(item.publicationOutcome) ? [heldRecoveryBrief(item.publicationOutcome)!] : item.publicationOutcome && item.publicationOutcome.status !== "PUBLISHED" ? [`Publication repair remains owed: ${item.publicationOutcome.code}. ${item.publicationOutcome.detail}`] : []),
            ...outsideBlockLines(item.id),
            `Inherited method version ${knowledge.version}. Walk applicable known methods before novelty; the fourteen retrieval rungs are a floor, never a completion ceiling.`,
            ...floor.routes.map(r=>`${r.routeId}: ${r.obligation}; ${r.proof}; ${r.label}; target ${r.target}; applicability ${r.grade}`),
            ...workers.map(w=>{
              const result=w.result;
              const issues="warnings" in result?result.warnings:result.findings;
              return `${w.id}: ${result.role} ${result.verdict}; recorded at ${w.endedAt}; issues ${issues.map(i=>i.code).join(", ") || "none recorded"}; unresolved results do not establish absence.`;
            }),
            ...history.map(p=>`${p.attemptId}: ${p.outcome}; next ${Array.isArray(p.nextRungs) ? p.nextRungs.filter((value): value is string => typeof value === "string").join(", ") : "stored list unreadable"}`)].join("\n"),
            priorRungs:[...history.flatMap(p=>p.rungs.map(r=>({rung:r.rung,tool:r.tool,target:r.target,observed:r.observed,ok:r.ok??null,at:r.at,attemptId:p.attemptId}))),
              ...walks.map(w=>({rung:w.rung,tool:w.tool,target:w.target,observed:w.observed,ok:w.outcome==="BLOCKED"?false:w.transport==="REACHABLE"?true:null,at:w.at,attemptId:w.attemptId}))],
            nextRungs:[...new Set([...(Array.isArray(history.at(-1)?.nextRungs)
              ? history.at(-1)!.nextRungs.filter((value): value is string => typeof value === "string") : []),...walks.flatMap(w=>w.nextRouteIds)])]},
          tools:{spaceOut:tools.spaceOut,vault:async()=>{throw new Error("UNBOUND_SCOUT_VAULT_REFUSED");}},decision:"BOUNDED_MODEL_WORKER" as const};
      },onResult:async (result,artifacts)=>{
        let recorded=result;
        try {
          const proposal=await proposeScoutCandidates({repos:input.repos,result,artifacts,stamp:result.recordedAt.slice(0,10)});
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
          ...(doors?{inheritedFieldManualEntryIds:doors.entryIds,availableFieldManualEntryIds:doors.availableIds,inheritedFieldManualLines:doors.lines,
            // MW-025: which handed doors this walk actually went through.
            usedFieldManualEntryIds:usedFieldManualEntryIds(result,doors.availableIds,handedManual)}:{})};
        if((result.refusal===null&&result.candidates.length>0)||result.sourceDeadEnds?.length){
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
        await writeFieldManual(input.repos,[newFieldManualEntry("investigation",recorded.subjectId+":"+recorded.recordClass,{
          role:"SHARED",kind:"INVESTIGATION_RESULT",title:recorded.subjectId,
          summary:recorded.outcome+": "+recorded.narrative,outcome:recorded.candidates.length||recorded.findings.length?"YIELDED":"BLOCKED",
          recordClasses:[recorded.recordClass],observedAt:recorded.recordedAt,
          payload:{subjectId:recorded.subjectId,recordClass:recorded.recordClass,facts:recorded.findings,routes:recorded.candidates,tried:recorded.rungs,nextRungs:recorded.nextRungs}})],recorded.recordedAt);
        await input.repos.scoutResults.append(recorded.obligationId,recorded.attemptId,recorded,recorded.recordedAt);
        return recorded;
      }
    })}:{})};
  return runtime;
}
