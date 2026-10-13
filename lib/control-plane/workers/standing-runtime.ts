import { readRolePlaybook } from "../playbooks.ts";
import { buildBoxFindings } from "./scout-extraction.ts";
import { readIntents, RESEARCH_INTENT_LOG_KEY } from "../scheduler/research-policy.ts";
import { readPublicationSourcePolicy } from "../promotion/source-settings.ts";
import { backfillBox, indexReportedFinding, indexScoutFindings } from "../box.ts";
import { MISSION_BRIEF_LINE_CAP, missionBriefLines, SCOUT_BRIEF_LINE_BUDGET, type MissionBlank } from "./mission-brief.ts";
import { missionPartOfPlan } from "../expansion/mission-parts.ts";
import { workAdapterQueue } from "./engineering-adapter.ts";
import { detectiveExecutor, heldRecoveryBrief, investigationRole, subjectScoutHistory } from "./detective.ts";
import { outsideRecordBlockBriefs } from "./record-block.ts";
import { readFieldManual, writeFieldManual, newFieldManualEntry, type FieldManualRead, type FieldManualStore } from "../field-manual.ts";
import type { DeclaredExecutor } from "../scheduler/dispatch.ts";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { readFile } from "node:fs/promises";
import { DurableEvidenceStore } from "../evidence/durable-store.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { scoutExecutor, type ModelTransport, type ScoutExecutorDeps } from "../scheduler/scout-executor.ts";
import { buildScoutToolkit } from "../scheduler/scout-tools.ts";
import type { ScoutToolContext } from "../scheduler/scout-contract.ts";
import { consecutiveTransportFailures } from "../scheduler/scout-result.ts";
import { hostSpacer } from "../scheduler/http-executor.ts";
import { VAULT_DIR } from "../scheduler/vault.ts";
import { methodFields, standingFleetRuntime } from "./standing.ts";
import { computeRouteFloor } from "../preflight.ts";
import { readMethodKnowledge } from "../../method/manual-bridge.ts";
import { readCompletedWorkerResults } from "../repository/worker-completion.ts";
import { proposeScoutCandidates } from "../scheduler/scout-candidates.ts";
import {
  compoundingPair,
  scoutFieldManualCatalog,
  fieldManualBriefLines,
  knownRouteIds,
  scoutDiscoveryEntries,
  scoutFieldManualProjection,
  scoutFieldManualQuery,
  recordScoutMethods,
  scoutStateHint,
  usedFieldManualEntryIds,
  writeFieldManualDiscoveries,
} from "../scheduler/field-manual-scout.ts";
import { recordFoundSources } from "../../doors/page-doors.ts";
import { durableResearchTools, researchRoleExecutor, type ResearchRuntimeTools } from "./research-runtime.ts";
import type { AutonomousCoordinatorRuntime } from "./coordinator.ts";
import { refreshRegistryRuntimeFromPromoted, getRegistryRuntimeReadModel } from "../../registry/runtime-read-model.ts";
import { refreshVenueResolutionsFromPromoted } from "../../civic-data/curated-reader-read-model.ts";
import { mayUseTestFixture } from "../../civic-data/fixture-policy.ts";
import { consumePlanRepairs, planRepairBrief, planRepairFailureBrief, type PlanRepairLink } from "./plan-repair.ts";
import { evidenceProjection } from "./runtime.ts";
import { researchVaultResolver } from "./vault-object.ts";
import { promotedRegistries } from "../scheduler/provider-inputs.ts";
import { brokeredSiblingCaptures, selectStandingLineages } from "./standing-lineage.ts";
import { readLineageHistory } from "./scoped-history.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import type { WorkItem } from "../work-item.ts";

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
  /** Each task's history reads are scoped to its own work item, subject and lineage. */
  scopedReads?:boolean;
  /** The mission's open blanks related to one government, from the owed list the round already holds (no store read). */
  missionBlanksFor?:(subjectId:string)=>readonly MissionBlank[];
  /** The same, asked of the parent process; read once as each task begins. */
  readMissionBlanks?:(subjectId:string)=>Promise<readonly MissionBlank[]>;
  /** The rolling-ceiling hold a Scout escalation must win before its frontier attempt; absent, every escalation is refused NOT_RESERVED. */
  reserveScoutEscalation?:ScoutExecutorDeps["reserveEscalation"];
  /** The transport for one jurisdiction's work, held on the area budget covering it; absent, `transport` serves all. */
  transportFor?:(jurisdiction:{readonly subjectId:string;readonly state:string|null})=>ModelTransport}):Promise<AutonomousCoordinatorRuntime> {
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
  const inheritedFieldManualCounts = new Map<string, number>();
  const inheritedManualStores = new Map<string, FieldManualStore>();
  const inheritedFieldManualDoors = new Map<string, { readonly entryIds: readonly string[]; readonly availableIds: readonly string[]; readonly lines: readonly string[] }>();
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
  if (!scoped) {
    const [allWorkRows, allArtifactRows] = await Promise.all([
      input.repos.workItems.list(), input.repos.artifacts.readAll(),
    ]);
    await backfillBox(input.repos.boxFindings, { scouts: prior,
      detectives: initialWorkers.filter(record => record.result.role === "DETECTIVE") as import("../box.ts").BoxDetectiveRecord[],
      artifacts: new Map(allArtifactRows.map(artifact => [artifact.artifactId, artifact])) }, now());
    if (!readIntents([...(await input.repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY))]).runnerPause.paused) {
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
  // Build saved findings before any paid adapter work; include freshly installed routes in the Scout brief.
  if (!scoped) await workAdapterQueue({repos:input.repos,results:prior,now:now(),readEvidence:async id=>evidenceProjection(await heldRuntime.readEvidence(id)),
    ...(input.transportFor?{transportFor:result=>input.transportFor!({subjectId:result.subjectId,state:scoutStateHint(result.subjectId,result.obligationId)[0]??null})}:{})});
  // Each walk reads only the manual rows its place could use, as it starts.
  const manualReads = new Map<string, FieldManualRead>();
  // The divisions each walk's obligation covers: its places for the manual and the fix map.
  const walkDivisions = new Map<string, readonly string[]>();
  const divisionsOf = async (item: WorkItem): Promise<readonly string[]> => {
    try {
      const occurrence = (await input.repos.occurrences.listWhere(["workItemId"], item.id))[0];
      const obligation = occurrence ? await input.repos.obligations.read(occurrence.value.obligationId) : null;
      return obligation?.value.scopeDivisions ?? [];
    } catch {
      return [];
    }
  };
  const readScoutManual = async (item: WorkItem): Promise<void> => {
    const divisions = await divisionsOf(item);
    walkDivisions.set(item.id, divisions);
    manualReads.set(item.id, await readFieldManual(input.repos, scoutFieldManualQuery({ subjectId: item.subject, obligationId: item.id, divisions })));
  };
  // The rows are held only while the walk runs; a process that runs many walks keeps none of them.
  const withManual = async <T>(item: WorkItem, walk: () => Promise<T>): Promise<T> => {
    await readScoutManual(item);
    try { return await walk(); } finally { manualReads.delete(item.id); walkDivisions.delete(item.id); inheritedManualStores.delete(item.id); }
  };
  const withScoutManual = (item: WorkItem, executor: DeclaredExecutor): DeclaredExecutor => ({ ...executor,
    run: (...args) => withManual(item, () => executor.run(...args)),
    ...(executor.dispatch ? { dispatch: (...args) => withManual(item, () => executor.dispatch!(...args)) } : {}) });

  // The lineage broker: which sibling's captures each lineage root may reuse. Whole-store when unscoped; one task's lineage when scoped.
  let lineages: ReturnType<typeof selectStandingLineages> = [];
  let sharedHeldByRoot=new Map<string,string[]>();
  let sharedOriginByRoot=new Map<string,Set<string>>();
  const brokerLineages=(history:{occurrences:Parameters<typeof selectStandingLineages>[0]["occurrences"];workItems:readonly WorkItem[];
    artifacts:Parameters<typeof selectStandingLineages>[0]["artifacts"];attempts:Parameters<typeof selectStandingLineages>[0]["attempts"];
    workerResults:Parameters<typeof selectStandingLineages>[0]["workerResults"];scouts:readonly ScoutResult[]})=>{
    lineages=selectStandingLineages(history);
    sharedHeldByRoot=new Map(); sharedOriginByRoot=new Map();
    for (const lineage of lineages.filter(row=>row.siblingRootIds.length>1)) {
      const address=registeredPublisherAddressFor(history.workItems.find(item=>item.id===lineage.rootWorkItemId)?.subject??"");
      if (!address) continue;
      const registeredHost=new URL(address).hostname.toLowerCase();
      const brokered=brokeredSiblingCaptures({lineage,artifacts:history.artifacts,attempts:history.attempts,scouts:history.scouts,registeredHost});
      sharedHeldByRoot.set(lineage.rootWorkItemId,[...new Set(brokered.map(row=>row.artifactId))]);
      sharedOriginByRoot.set(lineage.rootWorkItemId,new Set(brokered.map(row=>`${row.originWorkItemId}\u0000${row.artifactId}`)));
    }
  };
  const brokerWholeStore=async()=>{
    const [allWorkRows,allOccurrenceRows,allArtifactRows,allAttemptRows,scouts,workers] = await Promise.all([
      input.repos.workItems.list(),input.repos.occurrences.list(),input.repos.artifacts.readAll(),input.repos.attempts.list(),
      scoped ? input.repos.scoutResults.readAll() : prior, scoped ? readCompletedWorkerResults(input.repos) : priorWorkers,
    ]);
    brokerLineages({occurrences:allOccurrenceRows.map(row=>row.value),workItems:allWorkRows.map(row=>row.value),
      artifacts:allArtifactRows,attempts:allAttemptRows.map(row=>row.value),workerResults:workers,scouts});
  };
  if (!scoped) await brokerWholeStore();

  siblingHeldRootFor=held=>{
    const lineage=lineages.find(row=>row.siblingRootIds.includes(held.originWorkItemId) &&
      row.rootWorkItemId!==held.originWorkItemId &&
      sharedOriginByRoot.get(row.rootWorkItemId)?.has(`${held.originWorkItemId}\u0000${held.artifactId}`));
    return lineage?.rootWorkItemId??null;
  };
  const deferredSiblingRoots=new Set(lineages.flatMap(lineage=>lineage.siblingRootIds.filter(id=>id!==lineage.rootWorkItemId)));
  if (!scoped) await consumePlanRepairs({ repos: input.repos, scouts: prior.filter(result=>!deferredSiblingRoots.has(result.workItemId)),
    now: now(),registeredPublisherAddressFor,
    authorizedSiblingArtifactIdsFor: parent=>sharedHeldByRoot.get(parent.id)??[],
    readCapture: async id => {
      const { artifact } = await readRepairCapture(id);
      return { evidence: evidenceProjection(await heldRuntime.readEvidence(id)), permission: artifact.permission, transport: artifact.transport,
        httpStatus: artifact.httpStatus, partial: artifact.httpStatus === 206 || Boolean(artifact.headers["content-range"]) || artifact.retentionPolicy === "DIAGNOSTIC" };
    } });
  // A field dropped for sitting outside its person's row goes to a detective; the kept record still publishes.
  const outsideBlockLines=(workItemId:string)=>outsideRecordBlockBriefs(priorWorkers.filter(w=>w.workItemId===workItemId)
    .flatMap(w=>"warnings" in w.result?w.result.warnings:w.result.findings));
  // A worker process asks its parent for the task's mission blanks; a failed ask leaves the brief without them.
  const askedBlanks=new Map<string,readonly MissionBlank[]>();
  const blanksFor=(subjectId:string)=>askedBlanks.get(subjectId)??input.missionBlanksFor?.(subjectId)??[];
  const runtime:AutonomousCoordinatorRuntime={...heldRuntime,
    beginTask:async (task,item)=>{
      if (item && input.readMissionBlanks) {
        try { askedBlanks.set(item.subject,await input.readMissionBlanks(item.subject)); }
        catch (error) { askedBlanks.delete(item.subject); console.warn(`  mission blanks unread for this task: ${error instanceof Error?error.message:String(error)}`); }
      }
      const fresh=await readCompletedWorkerResults(input.repos,task.workItemId);
      priorWorkers=[...priorWorkers.filter(w=>w.workItemId!==task.workItemId),...fresh];
      if (scoped) {
        // A store without the filtered reads (a test double) brokers from the whole store, as before.
        const history=await readLineageHistory(input.repos,task.workItemId);
        if (history) brokerLineages(history); else await brokerWholeStore();
      } },
    rollingCeilingUsd:input.auditCeilingUsd??0,routineMeetingsAuthority:"PERMANENT_CIVIC_DATA_PLANE",
    authorizedSiblingHeldArtifactIdsFor:item=>sharedHeldByRoot.get(item.id)??[],
    roleExecutor:(task,holder)=>researchRoleExecutor(runtime,tools,task,holder,input.root),
    ...(input.transport?{scoutFor:(item,task,currentHistory)=>{
      const blanks=blanksFor(item.subject);
      const mission=missionBriefLines(item.subject,blanks,MISSION_BRIEF_LINE_CAP);
      const ownPart=item.autonomousPlan?missionPartOfPlan(item.autonomousPlan):null;
      return withScoutManual(item,(investigationRole(subjectScoutHistory(currentHistory??prior,item.subject,item.autonomousPlan!.contract.recordClass),task.routeLabel.includes('UNRESOLVED_INVESTIGATION') || heldRecoveryBrief(item.publicationOutcome)!==null || outsideBlockLines(item.id).length>0 || priorWorkers.some(w=>w.workItemId===item.id && (!["ACQUIRED","EXTRACTED","PASS","SUPPORTED","SURVIVED"].includes(w.result.verdict) || ("warnings" in w.result ? w.result.warnings : w.result.findings).some(f=>f.severity==="BLOCKING")))) === "DETECTIVE" ? detectiveExecutor : scoutExecutor)({transport:input.transportFor?input.transportFor({subjectId:item.subject,state:item.autonomousPlan?.jurisdiction??null}):input.transport!,now,playbookFor:role=>readRolePlaybook(input.repos,role),
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
        ...((input.searchFor?.(item.subject) ?? input.search) ? { search: input.searchFor?.(item.subject) ?? input.search } : {}),
        // Drop a finding for this target or any mission subject its brief lists straight into the Box.
        reportFinding: { subjects: new Set([item.subject,...mission.subjects]),
          write: async finding => ({ boxId: (await indexReportedFinding(input.repos.boxFindings, { workItemId: item.id, attemptId: ctx.attemptId,
            missionPart: finding.subjectId===item.subject ? ownPart : blanks.find(blank=>blank.subjectId===finding.subjectId)?.missionPart ?? null,
            finding }, now())).id }) } }),
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
        // The field manual projected to this jurisdiction takes the line budget the mission's lines leave.
        const manual=manualReads.get(item.id)??{store:{entries:[]}};
        const divisions=walkDivisions.get(item.id)??[];
        const manualProjection=scoutFieldManualProjection(manual,{subjectId:item.subject,obligationId:item.id,divisions,recordClass:plan.contract.recordClass,
          limit:SCOUT_BRIEF_LINE_BUDGET-mission.lines.length});
        const manualEntries=scoutFieldManualCatalog(manual,{subjectId:item.subject,obligationId:item.id,divisions});
        const repair=(item as typeof item & {readonly planRepair?:PlanRepairLink}).planRepair;
        inheritedFieldManualCounts.set(item.id,manualEntries.length);
        inheritedManualStores.set(item.id,manual.store);
        const manualLines=fieldManualBriefLines(manualProjection);
        inheritedFieldManualDoors.set(item.id,{entryIds:manualProjection.entryIds,availableIds:manualEntries.map(entry=>entry.id),lines:manualLines});
        return {route:null,providerId:null,sourceRecordClass:plan.contract.recordClass,
          reason:`${item.obligation}. ${planRepairBrief(plan)}`,
          inherited:{placeName: (() => {
            const named = blanks.find(blank => blank.subjectId === item.subject)?.subjectLabel;
            if (named) return named;
            try {
              const registry = getRegistryRuntimeReadModel().registry;
              return registry.bodies.find(body => body.id === item.subject)?.name ?? registry.divisions.find(division => division.ocdId === item.subject)?.label ?? item.obligation;
            } catch { return item.obligation; }
          })(), blanks: blanks.filter(blank => blank.subjectId === item.subject).map(blank => blank.label),
          officialWebsite: (() => {
            try { return getRegistryRuntimeReadModel().registry.bodies.find(body => body.id === item.subject)?.homepageUrl ?? plan.sources[0]?.url; }
            catch { return plan.sources[0]?.url; }
          })(),
          savedPages: workers.flatMap(worker => worker.result.role === "ACQUIRER"
            ? worker.result.artifacts.map(artifact => ({ id: artifact.artifactId, url: artifact.canonicalUrl })) : []),
          similarPlaces: manualEntries.filter(entry => entry.outcome === "YIELDED" && entry.states.includes(plan.jurisdiction.toLowerCase())).map(entry => entry.summary),
          artifactIds:[...new Set([...history.flatMap(p=>p.artifactIds),...walks.flatMap(w=>w.artifactIds),
            ...(repair?.retainedEvidenceIds??[]),...(repair?.sourceArtifactId?[repair.sourceArtifactId]:[]),
            ...(sharedHeldByRoot.get(item.id)??[])])],manualEntries,summary:[
            ...manualLines,
            ...mission.lines,
            ...planRepairFailureBrief(item),
            ...(heldRecoveryBrief(item.publicationOutcome) ? [heldRecoveryBrief(item.publicationOutcome)!] : item.publicationOutcome && item.publicationOutcome.status !== "PUBLISHED" ? [`Publication repair remains owed: ${item.publicationOutcome.code}. ${item.publicationOutcome.detail}`] : []),
            ...outsideBlockLines(item.id),
            `Use the successful saved methods before trying a new route.`,
            ...floor.routes.map(r=>`${r.speculative ? "Method to try" : "Saved route"}: ${r.label}; ${r.target}`),
            ...workers.map(w=>{
              const result=w.result;
              const issues="warnings" in result?result.warnings:result.findings;
              return `${result.role} worked at ${w.endedAt}; ${issues.map(i=>i.detail).join("; ") || "no problems recorded"}.`;
            }),
            ...history.map(p=>`${p.attemptId}: ${p.outcome}; next ${Array.isArray(p.nextRungs) ? p.nextRungs.filter((value): value is string => typeof value === "string").join(", ") : "stored list unreadable"}`)].join("\n"),
            priorRungs:[...history.flatMap(p=>p.rungs.map(r=>({rung:r.rung,tool:r.tool,target:r.target,observed:r.observed,ok:r.ok??null,at:r.at,attemptId:p.attemptId}))),
              ...walks.map(w=>({rung:w.rung,tool:w.tool,target:w.target,observed:w.observed,ok:w.outcome==="BLOCKED"?false:w.transport==="REACHABLE"?true:null,at:w.at,attemptId:w.attemptId}))],
            transportFailures:consecutiveTransportFailures(history),
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
          // A refused candidate proposal must not erase the typed Scout result already learned.
          recorded={...result,unverified:[...result.unverified,
            `Method candidates were not proposed: ${error instanceof Error?error.message:String(error)}`]};
        }
        const handedManual = inheritedManualStores.get(result.workItemId) ?? { entries: [] };
        const pair=compoundingPair(inheritedFieldManualCounts.get(result.workItemId)??0,result,knownRouteIds(handedManual));
        const doors=inheritedFieldManualDoors.get(result.workItemId);
        recorded={...recorded,inheritedFieldManual:pair.inheritedCount,rebuiltExistingRoutes:pair.rebuiltExisting,
          ...(doors?{inheritedFieldManualEntryIds:doors.entryIds,availableFieldManualEntryIds:doors.availableIds,inheritedFieldManualLines:doors.lines,
            // Which handed doors this walk actually went through.
            usedFieldManualEntryIds:usedFieldManualEntryIds(result,doors.availableIds,handedManual)}:{})};
        if((result.refusal===null&&result.candidates.length>0)||result.sourceDeadEnds?.length){
          const written=await writeFieldManualDiscoveries(input.repos,scoutDiscoveryEntries(result,scoutStateHint(result.subjectId,result.obligationId)),result.recordedAt);
          if(written.error) recorded={...recorded,unverified:[...recorded.unverified,`field manual write-back failed: ${written.error}`]};
        }
        const fixed=await recordScoutMethods(input.repos,recorded,handedManual,walkDivisions.get(result.workItemId)??[]);
        if(fixed) recorded={...recorded,unverified:[...recorded.unverified,fixed]};
        await writeFieldManual(input.repos,[newFieldManualEntry("investigation",recorded.subjectId+":"+recorded.recordClass,{
          role:"SHARED",kind:"INVESTIGATION_RESULT",title:recorded.subjectId,
          summary:recorded.outcome+": "+recorded.narrative,outcome:recorded.candidates.length||recorded.findings.length?"YIELDED":"BLOCKED",
          recordClasses:[recorded.recordClass],observedAt:recorded.recordedAt,
          payload:{subjectId:recorded.subjectId,recordClass:recorded.recordClass,facts:recorded.findings,routes:recorded.candidates,tried:recorded.rungs,nextRungs:recorded.nextRungs}})],recorded.recordedAt);
        await input.repos.scoutResults.append(recorded.obligationId,recorded.attemptId,recorded,recorded.recordedAt);
        await recordFoundSources(input.repos.doors,[recorded],recorded.recordedAt);
        await indexScoutFindings(input.repos.boxFindings, recorded, now());
        return recorded;
      }
    }));}}:{})};
  return runtime;
}
