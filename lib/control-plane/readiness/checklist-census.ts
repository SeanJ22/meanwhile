import { createHash } from "node:crypto";
import type { AssignmentSources } from "../assignment-view.ts";
import type { ExpansionScopeDecision } from "../expansion/scopes.ts";
import type { RunnerHeartbeat } from "../owner-surface.ts";
import { CHECKLIST_PROFILE, checklistObligationKey, checklistRequiredClauses, type ChecklistInstance, type ChecklistSnapshot } from "./checklist-score.ts";
import { checklistDeliveryTimings, type WorkDeliveryTiming } from "./checklist-timings.ts";
import { checklistDispatchWitness } from "./checklist-dispatch-witness.ts";
import { checklistRunningReleaseWitness } from "./checklist-running-release-witness.ts";
import { checklistOfficialFieldEvidence, type ChecklistOfficialFieldEvidence } from "./checklist-official-field-evidence.ts";

/** A census projection, not a dispatcher. A receipt proves membership; matching
 * a state, a URL or a successful attempt never establishes object applicability. */
export interface ChecklistCensus extends ChecklistSnapshot {
  readonly censusVersion: "checklist-census/1";
  readonly instructionReceipt: string;
  readonly population: { readonly knownSubjects: number; readonly knownRecords: number; readonly expectedObjects: null };
  readonly gaps: readonly string[];
  readonly deliveryTimings?: readonly WorkDeliveryTiming[];
  /** Verified field progress; this is never a whole original requirement witness. */
  readonly fieldEvidence?: readonly ChecklistOfficialFieldEvidence[];
}

export function exactScopeMembers(scopes: readonly ExpansionScopeDecision[], sources: Pick<AssignmentSources,"obligations">): ReadonlyMap<string,ReadonlySet<string>> {
  return new Map(scopes.map(scope=>[scope.key,new Set(sources.obligations.filter(obligation=>
    obligation.assignments?.some(a=>a.assignmentKey===scope.key && a.ref===scope.receiptId))
    .map(obligation=>obligation.subjectId))]));
}

const RECORD_GROUPS: Readonly<Record<string,readonly string[]>> = {
  OFFICIAL_ROSTER:["OFF"], OFFICIAL_BOARD_DIRECTORY:["GOV"],
  SERVICE_CONTACT:["PAR"], PUBLIC_COMMENT_RULE:["PAR"], VOTER_ACCESS_ROUTE:["ELE"],
  CANDIDATE_FILING_DOCUMENT:["CAN"], CAMPAIGN_FINANCE_FILING:["CAM"],
};
const SCOPE_GROUPS = new Set(["GEO","ASK","ACQ","REC","PUB","ENG","GATE","SAFE"]);
type CensusObject = { id:string; jurisdiction:string; groups:readonly string[]; workIds:readonly string[]; evidenceIds:readonly string[]; kind:"SCOPE"|"RECORD"|"UNRESOLVED" };

/** The normal runner already owns these durable populations. Project every
 * known exact-scope record, retain original definitions for missing populations,
 * and refuse to call registered/discovered objects the complete source universe.
 * Field-level witnesses are a separate input: a PASS worker is not 325 PASSes. */
export function buildChecklistCensus(input: {
  scope: ExpansionScopeDecision;
  sources: AssignmentSources | null;
  observedAt:string;
  previous?: ChecklistCensus | null;
  heartbeat?: RunnerHeartbeat | null;
}): ChecklistCensus {
  const {scope,sources,observedAt}=input;
  if (!sources && input.previous?.instructionReceipt===scope.receiptId) return {
    ...input.previous, observedAt, readsComplete:false,
    gaps:[...new Set([...input.previous.gaps,"The current canonical population read failed; prior inventory is retained, not reduced."])],
  };
  const members= sources ? exactScopeMembers([scope],sources).get(scope.key)! : new Set<string>();
  const marksBySubject=new Map<string,{ref:string;at:string}[]>();
  for (const obligation of sources?.obligations??[]) for (const mark of obligation.assignments??[]) if (mark.assignmentKey===scope.key) {
    const list=marksBySubject.get(obligation.subjectId)??[];
    list.push({ref:mark.ref,at:mark.at});marksBySubject.set(obligation.subjectId,list);
  }
  const attemptById=new Map((sources?.attempts??[]).map(attempt=>[attempt.id,attempt] as const));
  const objects: CensusObject[]=[{id:scope.key,jurisdiction:scope.key,groups:[...SCOPE_GROUPS],workIds:[],evidenceIds:[scope.receiptId],kind:"SCOPE"}];
  const work=new Map(sources?.workItems.filter(item=>members.has(item.subject)).map(item=>[item.id,item])??[]);
  const recordObjects=new Map<string,CensusObject>();
  let priorResultsWithheld=0;
  for (const row of sources?.workerResults??[]) {
    if (!work.has(row.workItemId) || row.result.role!=="PARSER" || row.result.verdict!=="EXTRACTED") continue;
    const parser=row.result;
    if (!members.has(parser.subjectId)) continue;
    const marks=marksBySubject.get(parser.subjectId)??[];
    if (marks.some(mark=>mark.ref!==scope.receiptId)) {
      const attempt=attemptById.get(row.attemptId);
      const started=attempt?.startedAt??"";
      const joined=marks.filter(mark=>mark.ref===scope.receiptId).map(mark=>mark.at).sort()[0];
      const next=marks.filter(mark=>mark.ref!==scope.receiptId&&mark.at>=(joined??"")).map(mark=>mark.at).sort()[0];
      if (!joined || !started || started<joined || (next!==undefined && started>=next) ||
        !work.get(row.workItemId)?.autonomousPlan?.ownerInstructions?.includes(scope.receiptId)) {
        priorResultsWithheld += parser.records.length;
        continue;
      }
    }
    const groups=RECORD_GROUPS[parser.recordClass];
    if (!groups) continue;
    for (const record of parser.records) {
      const key=JSON.stringify([parser.subjectId,parser.recordClass,record.id]);
      const old=recordObjects.get(key);
      recordObjects.set(key,{id:record.id,jurisdiction:parser.subjectId,groups,
        workIds:[...new Set([...(old?.workIds??[]),row.workItemId])],
        evidenceIds:[...new Set([...(old?.evidenceIds??[]),row.id,parser.artifactId])],kind:"RECORD"});
    }
  }
  objects.push(...recordObjects.values());
  const groupsWithObjects=new Set(objects.flatMap(object=>object.groups));
  for (const group of new Set(CHECKLIST_PROFILE.definitions.map(definition=>definition.group))) {
    if (!groupsWithObjects.has(group)) objects.push({id:`unresolved-inventory:${group}`,jurisdiction:scope.key,groups:[group],workIds:[],evidenceIds:[scope.receiptId],kind:"UNRESOLVED"});
  }
  // A stable revision changes when discovery changes the objects, never merely
  // because another worker retries them or the publisher wakes up again.
  const identity=objects.map(object=>[object.id,object.jurisdiction,object.groups]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const scopeRevision=`census:${createHash("sha256").update(JSON.stringify([scope.key,scope.receiptId,identity])).digest("hex")}`;
  const instances:ChecklistInstance[]=[];
  for (const object of objects) {
    const predicates=new Map<string,typeof CHECKLIST_PROFILE.definitions>();
    for (const definition of CHECKLIST_PROFILE.definitions.filter(d=>object.groups.includes(d.group))) {
      predicates.set(definition.canonicalPredicate,[...(predicates.get(definition.canonicalPredicate)??[]),definition]);
    }
    for (const [predicateKey,definitions] of predicates) {
      // A saved Send establishes the operating window. It cannot establish a
      // term, filing period or election lifecycle for a discovered civic row.
      const period=object.kind==="SCOPE"?`instruction:${scope.receiptId}`:"effective-period-unresolved";
      const required=object.kind==="SCOPE" && definitions.every(d=>d.label==="R" || d.label==="G") && !definitions.some(d=>d.group==="GEO");
      instances.push({obligationKey:checklistObligationKey(predicateKey,object.id,object.jurisdiction,period),
        definitionIds:definitions.map(d=>d.id),predicateKey,objectId:object.id,jurisdictionId:object.jurisdiction,period,scopeRevision,
        applicability:{state:required?"REQUIRED":"UNRESOLVED",evidenceIds:object.evidenceIds,
          reason:required?"The saved instruction requires this operating contract. Its full predicate still needs execution evidence.":"The object is known or its inventory is owed; exact applicability, effective period and conditional triggers still need source evidence."},
        due:{state:required?"DUE_NOW":"UNRESOLVED",evidenceIds:object.evidenceIds,at:null},
        predicate:{kind:object.kind==="SCOPE"?"CAPABILITY":"POSSESSION",requiredClauses:checklistRequiredClauses(predicateKey),contractVersion:"checklist-field-contract/1"},
        workIds:object.workIds,requiredSurfaces:[],requiresFreshness:object.kind==="RECORD"||predicateKey==="GATE-02",
        owner:definitions[0]?.owner??"Lead",blocker:object.kind==="UNRESOLVED"?"Object inventory is not connected.":"Complete clause-level verification and period evidence are not yet connected.",
        nextAction:object.kind==="UNRESOLVED"?`Connect the ${definitions[0]?.group} source inventory and applicability decisions through the normal producer.`:"Resolve exact applicability and period, then evaluate every original clause against saved source and public receipts.",
        failureKind:object.kind==="UNRESOLVED"?"MISSING_CAPABILITY":"DISCONNECTED_CAPABILITY"});
    }
  }
  return {profile:CHECKLIST_PROFILE.version,scopeId:scope.key,scopeRevision,observedAt,censusVersion:"checklist-census/1",instructionReceipt:scope.receiptId,
    inventory:{complete:false,evidenceIds:[scope.receiptId,...members],unresolvedObjects:objects.filter(o=>o.kind==="UNRESOLVED").length},
    readsComplete:sources!==null&&sources.pipeline!==null,instances,
    witnesses:[...(sources ? checklistDispatchWitness({scope,sources,instances,observedAt}) : []),
      ...checklistRunningReleaseWitness({scope,instances,heartbeat:input.heartbeat??null,observedAt})],
    population:{knownSubjects:members.size,knownRecords:recordObjects.size,expectedObjects:null},
    // Older snapshots without the occurrence population cannot establish an
    // exact receipt timing count. Leave it unmeasured instead of showing zero.
    deliveryTimings:sources?.occurrences?checklistDeliveryTimings(sources,scope,members,observedAt):undefined,
    fieldEvidence:sources?checklistOfficialFieldEvidence({scope,sources,observedAt,
      knownRecordKeys:new Set(recordObjects.keys())}):undefined,
    gaps:["The competent expected-object universe is not yet reconciled; known records are a lower bound.","Clause-level field, period and per-surface verification remain owed; worker completion alone earns no checklist credit.",
      ...(priorResultsWithheld? [`${priorResultsWithheld} earlier parsed record${priorResultsWithheld===1?"":"s"} on shared subjects lack this exact instruction's result or reuse receipt; they remain available as history, not this hunt's inventory.`]:[])]};
}
