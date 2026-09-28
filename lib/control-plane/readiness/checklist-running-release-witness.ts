import { createHash } from "node:crypto";
import type { ExpansionScopeDecision } from "../expansion/scopes.ts";
import type { RunnerHeartbeat, RuntimeReleaseAdoption } from "../owner-surface.ts";
import { canonicalJson } from "../repository/types.ts";
import { ORIGINAL_LIFETIME_HUNT } from "../scheduler/hunt-continuation.ts";
import { CHECKLIST_PROFILE, type ChecklistInstance, type ChecklistWitness } from "./checklist-score.ts";

/** Frozen PR446 phase-one repair base. Advancing this authority requires a
 * versioned code change; a process must never choose its own current HEAD. */
export const GATE02_REPAIR_PHASE = "acquisition-to-reader-repair/phase1";
export const GATE02_REQUIRED_BASE_SHA = "3712686786e3368c43756f327fc340aa8b53f4c3";
const VERSION = "checklist-running-release/1";
const MAX_OBSERVATION_AGE_MS = 3 * 60 * 60_000;
const SHA = /^[0-9a-f]{40}$/;
const at = (value:string|null|undefined)=>value?Date.parse(value):NaN;

/** Hash only exact machine fields written to the canonical heartbeat. */
export function runtimeReleaseAdoptionHash(value:Omit<RuntimeReleaseAdoption,"evidenceHash">):string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Keep the first matching, fresh observation across a completed cycle. The
 * post-cycle release check must not move adoption past that cycle's start. */
export function retainedRuntimeReleaseAdoption(previous:RuntimeReleaseAdoption|null|undefined,
  fresh:RuntimeReleaseAdoption, now:string):RuntimeReleaseAdoption {
  if(!previous) return fresh;
  const {evidenceHash,...hashed}=previous;
  const age=at(now)-at(previous.observedAt);
  if(!Number.isFinite(age)||age<0||age>=MAX_OBSERVATION_AGE_MS||
    runtimeReleaseAdoptionHash(hashed)!==evidenceHash) return fresh;
  const keys=["formatVersion","phase","requiredBaseSha","baseContained","processIdentity","runningSha",
    "servedSha","servedHow","inspectionCode","integrityReceiptId","integritySha","integrityObservedAt"] as const;
  return keys.every(key=>previous[key]===fresh[key])?previous:fresh;
}

/** GATE-02 proves only the running release identity for the original saved
 * instruction. It gives no credit for other gates or civic publication. */
export function checklistRunningReleaseWitness(input:{
  readonly scope:ExpansionScopeDecision;
  readonly instances:readonly ChecklistInstance[];
  readonly heartbeat:RunnerHeartbeat|null;
  readonly observedAt:string;
}):readonly ChecklistWitness[] {
  const {scope,heartbeat,observedAt}=input;
  if(scope.key!==ORIGINAL_LIFETIME_HUNT.key||scope.receiptId!==ORIGINAL_LIFETIME_HUNT.receiptId||
    scope.budgetStartedAt!==ORIGINAL_LIFETIME_HUNT.budgetStartedAt||scope.budgetUsd!==ORIGINAL_LIFETIME_HUNT.budgetUsd) return [];
  const instance=input.instances.find(row=>row.predicateKey==="GATE-02"&&row.objectId===scope.key&&
    row.period===`instruction:${scope.receiptId}`);
  const clause=`${CHECKLIST_PROFILE.version}:GATE-02`;
  if(!instance||instance.predicate.kind!=="CAPABILITY"||instance.predicate.requiredClauses.length!==1||
    instance.predicate.requiredClauses[0]!==clause||!heartbeat?.runtimeRelease) return [];
  const proof=heartbeat.runtimeRelease;
  const {evidenceHash,...hashInput}=proof;
  const now=at(observedAt),adopted=at(proof.observedAt),beat=at(heartbeat.beatAt),
    cycleStart=at(heartbeat.lastCycleStartedAt),cycleEnd=at(heartbeat.lastCycleFinishedAt),codeRead=at(heartbeat.codeIdentity?.readAt);
  if(!Number.isFinite(now)||!Number.isFinite(adopted)||!Number.isFinite(beat)||
    !Number.isFinite(cycleStart)||!Number.isFinite(cycleEnd)||!Number.isFinite(codeRead)||
    adopted>now||beat>now||now-adopted>MAX_OBSERVATION_AGE_MS||now-beat>MAX_OBSERVATION_AGE_MS||
    heartbeat.lastCycleOk!==true||cycleStart<adopted||cycleEnd<cycleStart||cycleEnd>beat||codeRead<cycleStart||codeRead>beat||
    proof.formatVersion!==1||!proof.processIdentity||proof.phase!==GATE02_REPAIR_PHASE||proof.requiredBaseSha!==GATE02_REQUIRED_BASE_SHA||
    proof.baseContained!==true||proof.inspectionCode!=="RUNTIME_RELEASE_CURRENT"||
    !SHA.test(proof.runningSha)||proof.runningSha!==proof.servedSha||proof.runningSha!==proof.integritySha||
    proof.runningSha!==heartbeat.testedSha||proof.runningSha!==heartbeat.codeIdentity?.runnerTestedSha||
    heartbeat.codeIdentity?.verdict!=="CONSISTENT"||
    !proof.integrityReceiptId||at(proof.integrityObservedAt)>adopted||!Number.isFinite(at(proof.integrityObservedAt))||
    !/^GET https:\/\/[^\s]+\/api\/build$/.test(proof.servedHow)||
    !/^[0-9a-f]{64}$/.test(evidenceHash)||runtimeReleaseAdoptionHash(hashInput)!==evidenceHash) return [];
  const id=`${VERSION}:${createHash("sha256").update(JSON.stringify([scope.receiptId,proof.evidenceHash,heartbeat.beatAt])).digest("hex")}`;
  return [{id,obligationKey:instance.obligationKey,objectId:instance.objectId,jurisdictionId:instance.jurisdictionId,
    period:instance.period,predicateKey:instance.predicateKey,contractVersion:instance.predicate.contractVersion,
    recordedAt:heartbeat.beatAt,sourcePublication:"UNKNOWN",acquisition:"PRESENT",
    sourceIds:[proof.servedHow.slice(4)],artifactIds:[proof.integrityReceiptId,`runner-heartbeat:${proof.runningSha}`],
    contentHashes:[`sha256-${evidenceHash}`],attemptIds:[`runtime-release:${proof.observedAt}`,`cycle:${heartbeat.lastCycleStartedAt}`],
    verificationIds:[proof.integrityReceiptId,`code-identity:${heartbeat.codeIdentity.readAt}`],verification:"PASS",
    satisfiedClauses:[clause],conflict:false,freshness:{ruleId:"runtime-release-observation/3h",validUntil:new Date(Math.min(adopted,beat)+MAX_OBSERVATION_AGE_MS).toISOString()},
    publication:{state:"NONE",candidateId:null,version:null,receiptId:null,at:null},surfaces:[],change:"UNDETERMINED"}];
}
