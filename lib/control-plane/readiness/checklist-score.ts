import profile from "./checklist-profile.json" with { type: "json" };

/** Receipt projection only: this module neither creates work nor owns civic data. */
export const CHECKLIST_PROFILE = profile;
export const CHECKLIST_SCORE_VERSION = "checklist-score/1";
/** These clause IDs bind the complete original wording, including shared-row
 * residuals. A caller cannot shrink the burden to a convenient field. */
export function checklistRequiredClauses(predicateKey: string): readonly string[] {
  return profile.definitions.filter(d=>d.canonicalPredicate===predicateKey&&!d.policyOverride).map(d=>`${profile.version}:${d.id}`);
}
export type ChecklistDimension = "CIVIC_FULL_TARGET" | "ANSWER_READINESS" | "OPERATIONAL_READINESS" | "DELIVERY_READINESS" | "PARTICIPATION_READINESS" | "GATES";
export type RequirementDisposition = "DELIVERED" | "PARTIALLY_DELIVERED" | "STALE" | "MISSING_CAPABILITY" | "DISCONNECTED_CAPABILITY" | "EXECUTION_FAILURE" | "SOURCE_LIMITATION" | "UNCERTAIN_APPLICABILITY" | "NOT_APPLICABLE" | "NOT_YET_DUE" | "SUPERSEDED";
export interface ChecklistDecision {
  readonly state: "REQUIRED" | "NOT_APPLICABLE" | "UNRESOLVED";
  readonly evidenceIds: readonly string[];
  readonly reason: string;
}
export interface ChecklistInstance {
  /** Stable fact/object/period identity. The profile and scope do not create another paid job. */
  readonly obligationKey: string;
  readonly definitionIds: readonly string[];
  readonly predicateKey: string;
  readonly objectId: string;
  readonly jurisdictionId: string;
  readonly period: string;
  readonly scopeRevision: string;
  readonly applicability: ChecklistDecision;
  readonly due: { readonly state: "DUE_NOW" | "NOT_YET_DUE" | "UNRESOLVED"; readonly evidenceIds: readonly string[]; readonly at: string | null };
  /** Required clauses are declared before execution, including broad-row residuals. */
  readonly predicate: { readonly kind: "POSSESSION" | "ESTABLISH_ABSENCE" | "CAPABILITY"; readonly requiredClauses: readonly string[]; readonly contractVersion: string };
  readonly workIds: readonly string[];
  readonly requiredSurfaces: readonly string[];
  readonly requiresFreshness: boolean;
  readonly owner: string;
  readonly blocker: string | null;
  readonly nextAction: string;
  readonly failureKind?: Exclude<RequirementDisposition, "DELIVERED" | "NOT_APPLICABLE" | "NOT_YET_DUE" | "SUPERSEDED">;
}
export interface ChecklistWitness {
  readonly id: string;
  readonly obligationKey: string;
  readonly objectId: string;
  readonly jurisdictionId: string;
  readonly period: string;
  readonly predicateKey: string;
  readonly contractVersion: string;
  readonly recordedAt: string;
  readonly sourcePublication: "PUBLISHED" | "NOT_PUBLISHED" | "UNKNOWN";
  readonly acquisition: "PRESENT" | "ABSENT" | "FAILED" | "UNKNOWN";
  readonly sourceIds: readonly string[];
  readonly artifactIds: readonly string[];
  readonly contentHashes: readonly string[];
  readonly attemptIds: readonly string[];
  readonly verificationIds: readonly string[];
  readonly verification: "PASS" | "FAIL" | "UNPROVED";
  readonly satisfiedClauses: readonly string[];
  readonly conflict: boolean;
  readonly freshness: { readonly ruleId: string | null; readonly validUntil: string | null };
  readonly publication: { readonly state: "ACCEPTED" | "HELD" | "NONE"; readonly candidateId: string | null; readonly version: string | null; readonly receiptId: string | null; readonly at: string | null };
  readonly surfaces: readonly { readonly surfaceId: string; readonly version: string; readonly objectId: string; readonly jurisdictionId: string; readonly period: string; readonly checkedAt: string; readonly receiptId: string; readonly url: string; readonly visible: boolean }[];
  readonly change: "NEW" | "UPDATED" | "REUSED" | "RETAINED" | "UNDETERMINED";
}
export interface ChecklistSnapshot {
  readonly profile: string;
  readonly scopeId: string;
  readonly scopeRevision: string;
  readonly observedAt: string;
  readonly inventory: { readonly complete: boolean; readonly evidenceIds: readonly string[]; readonly unresolvedObjects: number };
  readonly readsComplete: boolean;
  readonly instances: readonly ChecklistInstance[];
  readonly witnesses: readonly ChecklistWitness[];
}
export interface ChecklistItemResult {
  readonly obligationKey: string;
  readonly definitionIds: readonly string[];
  readonly dimension: ChecklistDimension;
  readonly owner: string;
  readonly disposition: RequirementDisposition;
  readonly due: boolean;
  readonly passed: boolean;
  readonly fresh: boolean;
  readonly accepted: boolean;
  readonly visible: boolean;
  readonly witnessId: string | null;
  readonly reasons: readonly string[];
  readonly nextAction: string;
}
const has = (values: readonly string[]) => values.some(v => v.trim().length > 0);
const at = (value: string | null) => value === null ? NaN : Date.parse(value);
const canonicalValue = (v: unknown): unknown => v && typeof v === "object"
  ? Array.isArray(v) ? v.map(canonicalValue) : Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonicalValue(x)])) : v;
const canonical = (v: unknown): string => JSON.stringify(canonicalValue(v)) ?? "null";

export function checklistObligationKey(predicateKey: string, objectId: string, jurisdictionId: string, period: string): string {
  return [predicateKey, objectId, jurisdictionId, period].map(encodeURIComponent).join("|");
}
export function checklistProfileInstanceKey(obligationKey: string, scopeRevision: string): string {
  return [profile.version, scopeRevision, obligationKey].map(encodeURIComponent).join("|");
}

/** Floored display cannot turn a near-complete value into an exact 100. */
export function checklistFraction(passed: number, due: number, unresolved: number) {
  const percent = due > 0 ? Math.floor(passed / due * 1000) / 10 : null;
  return { passed, due, owed: due - passed, unresolved, percent,
    label: due === 0 ? "Not measured" : `${passed} of ${due} known items pass${unresolved ? `; ${unresolved} unresolved — incomplete assessment` : passed < due ? `; ${due-passed} still owed` : ""}` };
}

export function evaluateChecklistSnapshot(snapshot: ChecklistSnapshot) {
  const issues: string[] = [];
  const observed = at(snapshot.observedAt);
  if (!Number.isFinite(observed)) issues.push("Observation time is invalid.");
  if (snapshot.profile !== profile.version) issues.push("The snapshot does not use the adopted checklist profile.");
  if (!snapshot.readsComplete) issues.push("One or more receipt populations could not be read completely.");
  if (!snapshot.inventory.complete || !has(snapshot.inventory.evidenceIds) || snapshot.inventory.unresolvedObjects > 0) issues.push("The object inventory or its source evidence is incomplete.");
  const definitions = new Map(profile.definitions.map(d=>[d.id,d]));
  const grouped = new Map<string, ChecklistInstance>();
  const conflicts = new Set<string>();
  for (const instance of snapshot.instances) {
    const old = grouped.get(instance.obligationKey);
    if (old && canonical({...old,definitionIds:[],workIds:[]}) !== canonical({...instance,definitionIds:[],workIds:[]})) conflicts.add(instance.obligationKey);
    grouped.set(instance.obligationKey, old ? {...old,definitionIds:[...new Set([...old.definitionIds,...instance.definitionIds])],workIds:[...new Set([...old.workIds,...instance.workIds])]} : instance);
  }
  const coveredIds = new Set(snapshot.instances.flatMap(i=>i.definitionIds));
  const uninstantiated = profile.definitions.filter(d=>!d.policyOverride && !coveredIds.has(d.id)).map(d=>d.id);
  const results: ChecklistItemResult[] = [];
  for (const instance of [...grouped.values()].sort((a,b)=>a.obligationKey.localeCompare(b.obligationKey))) {
    const defs = instance.definitionIds.map(id=>definitions.get(id));
    const dimension = (defs.find(Boolean)?.dimension ?? "GATES") as ChecklistDimension;
    const reasons: string[] = [];
    if (!defs.length || defs.some(d=>!d)) reasons.push("An original checklist definition is missing or unknown.");
    if (defs.some(d=>d && d.dimension !== dimension)) reasons.push("Different score dimensions cannot share one point.");
    if (defs.some(d=>d && d.canonicalPredicate !== instance.predicateKey)) reasons.push("The predicate differs from the versioned overlap map; residual clauses cannot be dropped.");
    if (!checklistRequiredClauses(instance.predicateKey).every(clause=>instance.predicate.requiredClauses.includes(clause))) reasons.push("The field contract omits part of the complete original requirement wording.");
    if (instance.obligationKey !== checklistObligationKey(instance.predicateKey,instance.objectId,instance.jurisdictionId,instance.period)) reasons.push("Stable obligation identity does not match its fact, object, jurisdiction and period.");
    if (instance.scopeRevision !== snapshot.scopeRevision) reasons.push("The instance belongs to a different inventory revision.");
    if (conflicts.has(instance.obligationKey)) reasons.push("Duplicate instances disagree about the same obligation.");
    if (!instance.objectId || !instance.jurisdictionId || !instance.period) reasons.push("Object, jurisdiction or effective period is unresolved.");
    const decision = instance.applicability;
    const decisionValid = has(decision.evidenceIds) && Boolean(decision.reason.trim());
    let disposition: RequirementDisposition = instance.failureKind ?? "PARTIALLY_DELIVERED";
    let due = false;
    if (defs.length && defs.every(d=>d?.policyOverride)) disposition = "SUPERSEDED";
    else if (decision.state === "NOT_APPLICABLE" && decisionValid) disposition = "NOT_APPLICABLE";
    else if (decision.state !== "REQUIRED" || !decisionValid) { disposition = "UNCERTAIN_APPLICABILITY"; reasons.push("Applicability is not supported by a recorded decision."); }
    else if (instance.due.state === "NOT_YET_DUE" && has(instance.due.evidenceIds) && at(instance.due.at) > observed) disposition = "NOT_YET_DUE";
    else if (instance.due.state !== "DUE_NOW" || !has(instance.due.evidenceIds)) { disposition = "UNCERTAIN_APPLICABILITY"; reasons.push("Due state or publication trigger is unresolved."); }
    else due = true;
    const witnesses = snapshot.witnesses.filter(w=>w.obligationKey===instance.obligationKey && at(w.recordedAt)<=observed).sort((a,b)=>at(b.recordedAt)-at(a.recordedAt)||b.id.localeCompare(a.id));
    const witness = witnesses[0];
    if (witness && witnesses.some(w=>w.id===witness.id && canonical(w)!==canonical(witness))) reasons.push("One witness identifier carries conflicting content.");
    const witnessMatches = witness?.objectId===instance.objectId && witness.jurisdictionId===instance.jurisdictionId && witness.period===instance.period && witness.predicateKey===instance.predicateKey && witness.contractVersion===instance.predicate.contractVersion;
    const accepted = witnessMatches && witness?.publication.state === "ACCEPTED" && Boolean(witness.publication.version && witness.publication.receiptId && witness.publication.candidateId) && at(witness.publication.at)<=observed;
    const visible = Boolean(accepted && instance.requiredSurfaces.length > 0 && instance.requiredSurfaces.every(surface => witness?.surfaces.some(s=>s.surfaceId===surface && s.version===witness.publication.version && s.objectId===instance.objectId && s.jurisdictionId===instance.jurisdictionId && s.period===instance.period && s.visible && s.receiptId && /^https:\/\//.test(s.url) && at(s.checkedAt)>=at(witness.publication.at) && at(s.checkedAt)<=observed && observed-at(s.checkedAt)<=3*60*60_000)));
    const fresh = !instance.requiresFreshness || Boolean(witnessMatches && witness?.verification==="PASS" &&
      (witness.acquisition==="PRESENT" || instance.predicate.kind==="ESTABLISH_ABSENCE" && witness.acquisition==="ABSENT") &&
      witness.freshness.ruleId && at(witness.freshness.validUntil)>=observed);
    if (due) {
      if (!witness) reasons.push("No qualifying verification witness has been recorded.");
      else {
        if (witness.objectId!==instance.objectId || witness.jurisdictionId!==instance.jurisdictionId || witness.period!==instance.period || witness.predicateKey!==instance.predicateKey || witness.contractVersion!==instance.predicate.contractVersion) reasons.push("Witness identity, effective period or field contract does not match.");
        if (witness.conflict || witness.verification!=="PASS" || !has(witness.verificationIds)) reasons.push("Verification has not passed or a material conflict remains.");
        if (!has(witness.sourceIds) || !has(witness.artifactIds) || !has(witness.contentHashes) || !witness.contentHashes.every(hash=>/^(?:sha256-)?[0-9a-f]{64}$/.test(hash)) || !has(witness.attemptIds)) reasons.push("Source, saved evidence or attempt lineage is incomplete.");
        if (!instance.predicate.requiredClauses.length || !instance.predicate.contractVersion || !instance.predicate.requiredClauses.every(c=>witness.satisfiedClauses.includes(c))) reasons.push("One or more required clauses are unproved.");
        if (instance.predicate.kind === "POSSESSION" && (witness.acquisition!=="PRESENT" || witness.sourcePublication!=="PUBLISHED")) reasons.push("Absence or a future source publication does not satisfy possession.");
        if (instance.predicate.kind === "ESTABLISH_ABSENCE" && witness.acquisition!=="ABSENT") reasons.push("The required absence has not been established.");
        if (!fresh) { disposition="STALE"; reasons.push("Freshness is stale or its rule is not measured."); }
        if (instance.requiredSurfaces.length && !visible) reasons.push("The accepted version has not been checked on every promised public surface.");
      }
      if (!reasons.length) disposition="DELIVERED";
    }
    results.push({obligationKey:instance.obligationKey,definitionIds:instance.definitionIds,dimension,owner:instance.owner,disposition,due,passed:due&&disposition==="DELIVERED",fresh,accepted:Boolean(accepted),visible,witnessId:witness?.id??null,reasons,nextAction:instance.nextAction});
  }
  const dimensions = Object.fromEntries((["CIVIC_FULL_TARGET","ANSWER_READINESS","OPERATIONAL_READINESS","DELIVERY_READINESS","PARTICIPATION_READINESS"] as const).map(d=>{
    const rows=results.filter(r=>r.dimension===d);
    const unresolved=rows.filter(r=>r.disposition==="UNCERTAIN_APPLICABILITY").length+uninstantiated.filter(id=>definitions.get(id)?.dimension===d).length;
    return [d,checklistFraction(rows.filter(r=>r.passed).length,rows.filter(r=>r.due).length,unresolved)];
  }));
  const gateRows=results.filter(r=>r.dimension==="GATES" && r.disposition!=="SUPERSEDED" && r.disposition!=="NOT_APPLICABLE" && r.disposition!=="NOT_YET_DUE");
  const gateState = gateRows.some(r=>r.due&&!r.passed) ? "FAIL" : uninstantiated.some(id=>definitions.get(id)?.dimension==="GATES") || gateRows.some(r=>!r.passed) ? "UNPROVED" : "PASS";
  const dueRows=results.filter(r=>r.due);
  // Several requirements may describe fields of the same accepted object.
  // Count its version once and require the union of promised surfaces.
  const delivery = new Map<string, { visible: boolean; obligations: string[] }>();
  for (const row of results.filter(r=>r.due&&r.accepted&&grouped.get(r.obligationKey)!.requiredSurfaces.length)) {
    const instance=grouped.get(row.obligationKey)!;
    const witness=snapshot.witnesses.find(w=>w.id===row.witnessId && w.obligationKey===row.obligationKey)!;
    const key=canonical([instance.objectId,instance.jurisdictionId,instance.period,witness.publication.candidateId,witness.publication.version]);
    const previous=delivery.get(key);
    delivery.set(key,{visible:row.visible&&(previous?.visible??true),obligations:[...(previous?.obligations??[]),row.obligationKey]});
  }
  const deliveryRows=[...delivery.values()];
  const freshnessRows=dueRows.filter(r=>grouped.get(r.obligationKey)!.requiresFreshness);
  const complete=issues.length===0 && conflicts.size===0 && uninstantiated.length===0 && dueRows.length>0 && dueRows.every(r=>r.passed) && results.every(r=>r.disposition!=="UNCERTAIN_APPLICABILITY"&&r.reasons.length===0) && gateState==="PASS";
  return {profile:profile.version,scoreVersion:CHECKLIST_SCORE_VERSION,overlapVersion:profile.overlapVersion,scopeId:snapshot.scopeId,scopeRevision:snapshot.scopeRevision,observedAt:snapshot.observedAt,
    complete,provisional:issues.length>0||uninstantiated.length>0||results.some(r=>r.disposition==="UNCERTAIN_APPLICABILITY"),issues,uninstantiated,results,dimensions,gates:{state:gateState,rows:gateRows},
    publicDelivery:{...checklistFraction(deliveryRows.filter(r=>r.visible).length,deliveryRows.length,0),unit:"accepted object versions",objects:deliveryRows},freshness:checklistFraction(freshnessRows.filter(r=>r.fresh).length,freshnessRows.length,0)};
}
