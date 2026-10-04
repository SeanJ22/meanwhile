import { SCOUT_HELD_EVIDENCE_PROTOCOL_VERSION, archiveCapture } from "../scheduler/scout-result.ts";
import { scoutExecutor } from "../scheduler/scout-executor.ts";
import { contentHash } from "../ids.ts";
import { ZERO_COST } from "../attempt.ts";
import {installedAdapters,installedAdapterVersion} from '../scheduler/scout-adapters.ts';
import {readFieldManual, type FieldManualEntry} from '../field-manual.ts';
import type { FreshnessDebt } from "../scheduler/debt.ts";
import type { ExecutorDecision } from "../scheduler/dispatch.ts";
import type { RouteDescriptor } from "../scheduler/registry.ts";
import { sourceReliabilityKey } from "../scheduler/scout-reliability.ts";

/** Consecutive failures after which a door counts as shut. Becomes an Admin setting once BR-05 lands. */
export const DETECTIVE_SHUT_THRESHOLD = 3;

/**
 * A shut door needs a new route, not another replay of the same HTTP shape. A passing outage
 * (one 429, 5xx or timeout) is not shut: it keeps its plain backoff retry and costs nothing.
 */
export function sourceFailureRecovery(decision: ExecutorDecision, debt: FreshnessDebt | null | undefined,
  shutThreshold: number = DETECTIVE_SHUT_THRESHOLD): ExecutorDecision {
  if (!needsSourceInvestigation(debt, shutThreshold)) return decision;
  return {kind:'BOUNDED_MODEL_WORKER', disagreement:decision.disagreement,
    why:`DETECTIVE FAILURE RESPONSE: ${debt.target} failed at ${debt.lastFailedAt} (${debt.cause}, ${debt.consecutiveFailures} consecutive failure(s)). ${debt.detail}\n`+
      'Read held facts and the knowledge bank first, then available APIs. Find another working source or a documented dead end; do not replay the failed route.'};
}

/** The site itself changed: the same request cannot work again, so a detective goes at once. */
const SHUT_AT_ONCE = ['REFUSED_BY_HOST', 'EXTRACTION_FAILED'];
/** Plain backoff retries own these until the door has failed past the shut threshold. */
const PASSING_OUTAGE = ['RATE_LIMITED', 'UPSTREAM_ERROR', 'TRANSPORT_FAILED'];

export function needsSourceInvestigation(debt: FreshnessDebt | null | undefined,
  shutThreshold: number = DETECTIVE_SHUT_THRESHOLD): debt is FreshnessDebt {
  if (!debt || debt.consecutiveFailures <= 0) return false;
  if (SHUT_AT_ONCE.includes(debt.cause)) return true;
  return PASSING_OUTAGE.includes(debt.cause) && debt.consecutiveFailures >= shutThreshold;
}

/** Slot length for alternating a shut door between its detective and its plain re-read. */
export const PLAIN_REREAD_SLOT_MS = 3_600_000;

/**
 * One occurrence holds one executor, so a shut door whose detective is admitted cannot get both in one
 * cycle. It alternates by hourly slot instead: the plain re-read runs in every other slot (a door that
 * recovers is noticed within two slots, with no model charge), and the detective runs in the rest. A
 * door the host refused or whose page changed first goes to its detective at once (its plain re-read
 * can only fail the same way); it alternates from its second failure on.
 */
export function plainRereadSlot(debt: FreshnessDebt | null | undefined, nowMs: number,
  shutThreshold: number = DETECTIVE_SHUT_THRESHOLD): boolean {
  if (!needsSourceInvestigation(debt, shutThreshold)) return false;
  if (SHUT_AT_ONCE.includes(debt.cause) && debt.consecutiveFailures <= 1) return false;
  return Math.floor(nowMs / PLAIN_REREAD_SLOT_MS) % 2 === 1;
}

/** A failed discovery provider does not invalidate another source already found for the subject. */
function heldAfterSourceFailure(solved: import('../scheduler/scout-result.ts').ScoutResult | null | undefined,
  debt: FreshnessDebt | null | undefined, route: RouteDescriptor | null | undefined) {
  if (!solved) return null;
  if (!needsSourceInvestigation(debt) || Date.parse(debt.lastFailedAt) < Date.parse(solved.recordedAt)) return solved;
  const open = route?.open;
  const failedUrl = open?.kind === 'HTTP_GET' || open?.kind === 'HTTP_POST' ? open.url : debt.target;
  const sourceKey = (url: string) => {
    try { return /^https?:\/\//i.test(url) ? sourceReliabilityKey(url) : null; } catch { return null; }
  };
  const failedSource = sourceKey(failedUrl);
  if (!failedSource) return null;
  const candidates = reusableScoutCandidates(solved).filter(candidate => {
    const source = sourceKey(candidate.url);
    return source !== null && source !== failedSource;
  });
  // Facts-only results are already represented as captured-source candidates above.
  // Keep the stored result intact; only this acquisition handoff drops failed sources.
  return candidates.length ? { ...solved, candidates, findings: [] } : null;
}

/** Reuses the research loop and every source tool for failure response. */
type ScoutExecutorFactory = (deps: import('../scheduler/scout-executor.ts').ScoutExecutorDeps) => import('../scheduler/dispatch.ts').DeclaredExecutor;
export function detectiveExecutor(deps: import('../scheduler/scout-executor.ts').ScoutExecutorDeps, executorFactory: ScoutExecutorFactory = scoutExecutor) {
  return executorFactory({...deps, role:'DETECTIVE',onResult:async(result,artifacts)=>{
    const recorded={...result,researchRole:'DETECTIVE' as const};
    return deps.onResult ? await deps.onResult(recorded,artifacts) : recorded;
  }, contextFor:row=>{
    const context=deps.contextFor(row);
    return {...context,reason:'DETECTIVE FAILURE RESPONSE: '+context.reason,
      inherited:{...context.inherited,summary:'Investigate the recorded blank field, blocked route, failed parse or retry loop. Read inherited facts and methods first, then use every available API/tool. Return a reusable new route with field/value/exactQuote data, or a documented dead end naming what was tried and what evidence would reopen it. Never retry the same unchanged failure.\n'+context.inherited.summary}};
  }});
}

/** Both Scout lanes use the same failure responder and keep their existing budgets and tools. */
export function failureResponderExecutor(deps: import('../scheduler/scout-executor.ts').ScoutExecutorDeps & {
  solved?: import('../scheduler/scout-result.ts').ScoutResult | null;
  sourceFailure?: FreshnessDebt | null;
  sourceRoute?: RouteDescriptor | null;
  executorFactory?: ScoutExecutorFactory;
}): import('../scheduler/dispatch.ts').DeclaredExecutor {
  const contexts=new Map<string,{value?:ReturnType<typeof deps.contextFor>;error?:unknown}>();
  const contextFor: typeof deps.contextFor = row=>{
    let saved=contexts.get(row.obligation.id);
    if (!saved) { try {saved={value:deps.contextFor(row)};} catch(error) {saved={error};} contexts.set(row.obligation.id,saved); }
    if (!saved.value) throw saved.error;
    return saved.value;
  };
  const factory=deps.executorFactory ?? scoutExecutor;
  const scout=factory({...deps,contextFor}), detective=detectiveExecutor({...deps,contextFor},factory);
  const choose=(row:Parameters<typeof contextFor>[0])=>{
    try {
      if (needsSourceInvestigation(deps.sourceFailure)) return detective;
      const inherited=contextFor(row).inherited;
      // Shared manual failures are knowledge, not failures of this job. Its
      // projected entries/instructions are indented; keep actual prior-result
      // and debt lines for role selection while handing the full brief onward.
      const ownHistory=inherited.summary.split('\n').filter(line=>!/^\s|^FIELD MANUAL/.test(line)).join('\n');
      return (inherited.priorRungs ?? []).some(r=>r.ok===false || /transport failure|HTTP [45]\d\d|NOT VAULTED/i.test(r.observed)) ||
        /\b(?:REFUSED|BLOCKED|NO_PROGRESS|NEEDS_ADAPTER|REQUIRED_FIELD_MISSING)\b|failed parse|blocked route|retry loop|DEBT: [1-9]\d* consecutive failure/i.test(ownHistory) ? detective : scout;
    } catch { return scout; }
  };
  const held=heldAfterSourceFailure(deps.solved,deps.sourceFailure,deps.sourceRoute);
  return {lane:held?'DETERMINISTIC':'BOUNDED_MODEL_WORKER',
    ...(!held && scout.dispatch && detective.dispatch ? {dispatch: ((input) => choose(input.obligation).dispatch!(input)) as NonNullable<import('../scheduler/dispatch.ts').DeclaredExecutor['dispatch']>} : {}),
    workerFor:input=>held
    ? {role:'ACQUIRER',provider:'we-the-people',version:'held-subject-route',instance:input.holder}
    : choose(input.obligation).workerFor!(input),run:async input=>{
      if (!held) return choose(input.obligation).run(input);
      // Discovery is solved; reuse its route without pretending old facts were freshly fetched.
      return {ranAs:'DETERMINISTIC',kind:'DISPOSED',artifacts:[],endedAt:deps.now?.()??new Date().toISOString(),
        cost:{...ZERO_COST,inputTokens:0,outputTokens:0,usd:0,durationMs:0,bytesFetched:0,requestCount:0},
        disposition:{disposition:'DISCOVERED',observation:null,permission:'NOT_APPLICABLE',transport:'REACHABLE',
          note:`Reuse solved subject/class from ${held.attemptId}; acquisition and verification remain owed. Sources: ${reusableScoutCandidates(held).map(c=>c.url).join(', ')}`},
        detail:`HELD_SUBJECT_REUSED: ${held.attemptId}; no Scout or model request; original observation ${held.recordedAt}`};
    }};
}

/** A refused request that never researched a source cannot overturn accepted source evidence. */
function refusedWithoutResearch(result: import('../scheduler/scout-result.ts').ScoutResult): boolean {
  return !!result.refusal?.length && result.refusal.every(refusal =>
    refusal.code === 'SCOUT_POLICY_DENIED' || refusal.code === 'SCOUT_TRANSPORT_FAILED') &&
    result.rungs?.length === 0 && result.artifactIds?.length === 0 &&
    result.candidates.length === 0 && result.findings.length === 0 && !result.sourceDeadEnds?.length;
}

/** A later real failure reopens investigation; an accepted source route is never scouted again. */
export function solvedScoutResult(results: readonly import('../scheduler/scout-result.ts').ScoutResult[],subjectId:string,recordClass:string,routeId?:string|null) {
  // Legacy providers group several distinct blanks under local-jurisdiction.
  // Share their evidence, but a roster result cannot solve public-comment rules.
  const field=routeId?.startsWith('coverage-discovery:') ? routeId : null;
  const latest=subjectScoutHistory(results,subjectId,recordClass).filter(result=>(!field ||
    (result.routeId ?? result.obligationId?.split('#').at(-1))===field) && !refusedWithoutResearch(result)).at(-1);
  return latest?.refusal===null && ['ROUTE_CANDIDATE','EVIDENCE_FOUND'].includes(latest.outcome) &&
    reusableScoutCandidates(latest).length>0 ? latest : null;
}

/** The latest result for a civic subject serves all work items for that subject and class. */
export function subjectScoutHistory(results: readonly import('../scheduler/scout-result.ts').ScoutResult[], subjectId:string, recordClass:string) {
  return results.filter(result=>result.subjectId===subjectId && result.recordClass===recordClass)
    .sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt));
}

/** Locate cross-job history with small identity projections, then read only this batch's recent source context. */
export async function readSubjectScoutHistory(repos:import('../repository/types.ts').ControlPlaneRepositories,
  subjects:readonly {subjectId:string;recordClass:string}[]):Promise<import('../scheduler/scout-result.ts').ScoutResult[]> {
  const wanted=new Set(subjects.map(s=>s.subjectId+'\u0000'+s.recordClass));
  const keys=await repos.scoutResults.keys();
  const identities=await repos.scoutResults.readLatest(keys,{subjectId:true,recordClass:true});
  const results:import('../scheduler/scout-result.ts').ScoutResult[]=[];
  const projection=Object.fromEntries(['formatVersion','attemptId','obligationId','routeTaskId','workItemId','subjectId','routeId',
    'recordClass','providerId','reason','outcome','stoppedBy','rungs','distinctEvidenceRungs','candidates','findings','nextRungs',
    'unverified','narrative','worker','usage','usd','elapsedMs','artifactIds','sourceDeadEnds','recoveryCapabilityVersion','methodCandidateIds',
    'refusal','startedAt','recordedAt','researchRole'].map(key=>[key,true as const]));
  for(const [key,value] of identities) {
    const identity=value as {subjectId?:string;recordClass?:string};
    if(!identity?.subjectId || !identity.recordClass || !wanted.has(identity.subjectId+'\u0000'+identity.recordClass))continue;
    const rows=await repos.scoutResults.readRecentWhere(key,['recordClass'],identity.recordClass,2,projection);
    for(const row of rows) {
      const result=row as import('../scheduler/scout-result.ts').ScoutResult;
      if(result?.subjectId===identity.subjectId && result.recordClass===identity.recordClass && Array.isArray(result.rungs) &&
        Array.isArray(result.candidates) && Array.isArray(result.findings))results.push(result);
    }
  }
  return results;
}
/**
 * Publication holds and validator failures that a detective takes with the failing code in its brief,
 * instead of a fresh Scout starting over (DP-03). The §3 holds and the validator codes name the check
 * that failed, so the detective goes to the exact field. Date-sanity refusals (CP-06) arrive as held
 * outcomes with a worker recovery and are covered by that rule; add their code here if they get one.
 */
export const DETECTIVE_HELD_CODES: readonly string[] = ['SOURCE_REPLAY_FAILED', 'PAGE_UNVERIFIED', 'ROSTER_PAGE_UNVERIFIED',
  'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'SEMANTIC_INVALID', 'DATE_OUT_OF_WINDOW'];

type HeldOutcome = { readonly status: string; readonly code: string; readonly detail: string;
  readonly recovery?: string; readonly candidateId?: string | null } | null | undefined;

/** The detective's brief line for a held record, or null when the outcome is not one it owns. */
export function heldRecoveryBrief(outcome: HeldOutcome): string | null {
  if (!outcome || outcome.status !== 'HELD') return null;
  const listed = DETECTIVE_HELD_CODES.includes(outcome.code);
  if (!listed && outcome.recovery !== 'WORKER') return null;
  return `Publication was held: failed check ${outcome.code}${outcome.candidateId ? ` on candidate ${outcome.candidateId}` : ''}. ${outcome.detail} `+
    'Find the exact field that failed that check, confirm it against the source, and return a corrected result; do not start the search over.';
}

export function investigationRole(results: readonly import('../scheduler/scout-result.ts').ScoutResult[], failedWorkers:boolean): 'SCOUT'|'DETECTIVE' {
  return failedWorkers || results.some(result=>result.refusal !== null || ['BLOCKED','NO_PROGRESS','NEEDS_ADAPTER'].includes(result.outcome)) ? 'DETECTIVE':'SCOUT';
}
export function hasUntriedAdapter(latest:import('../scheduler/scout-result.ts').ScoutResult|undefined,installed:readonly string[],knowledge:readonly FieldManualEntry[]=[]) {
  const description = latest ? [latest.narrative,...(latest.nextRungs ?? []),...(latest.candidates ?? []).map(c=>c.routeId)].join(' ').toLowerCase() : '';
  const sourceOrigin=(value:unknown)=>{
    if(typeof value!=='string' || archiveCapture(value))return null;
    try {const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.origin:null;}catch{return null;}
  };
  const origins=new Set([...(latest?.candidates??[]).map(c=>c.url),...(latest?.rungs??[]).filter(r=>r.tool!=='search').map(r=>r.target)].map(sourceOrigin).filter(Boolean));
  const learned=new Set(knowledge.flatMap(entry=>{
    const payload=entry.payload as {sourceAttemptId?:string;files?:unknown;sourceUrls?:unknown}|null;
    if(!['ENGINEER_ADAPTER_PR','PLATFORM_ADAPTER'].includes(entry.kind) || !latest || !Array.isArray(payload?.files))return [];
    const sameAttempt=Boolean(latest.attemptId && payload.sourceAttemptId===latest.attemptId);
    const sameSourceClass=entry.recordClasses.includes(latest.recordClass?.toLowerCase()) && Array.isArray(payload.sourceUrls) &&
      payload.sourceUrls.some(value=>{const origin=sourceOrigin(value);return origin!==null && origins.has(origin);});
    if(!sameAttempt && !sameSourceClass)return [];
    return payload.files.flatMap(path=>{
      const name=typeof path==='string'?/^lib\/sources\/platform-adapters\/([a-z0-9-]+)\.(?:ts|mjs)$/.exec(path)?.[1]:undefined;
      return name?[name]:[];
    });
  }));
  return installed.some(name=>(learned.has(name) || description.includes(name) || (name==='uncapped-source-links' && /uncapped.link|raw.html extraction|verified webpages/.test(description)) || (name==='dated-sitemap' && /streamline|dated.sitemap/.test(description))) &&
    !(latest?.rungs??[]).some(r=>r.tool==='run_adapter' && r.observed.includes(name+'@'+installedAdapterVersion(name))));
}
export function adapterWaitReason(results: readonly import('../scheduler/scout-result.ts').ScoutResult[], installed: readonly string[] = [], knowledge:readonly FieldManualEntry[]=[]): string|null {
  const latest=results.at(-1);
  if(hasUntriedAdapter(latest,installed,knowledge))return null;
  return latest?.refusal === null && latest.outcome === 'NEEDS_ADAPTER' && latest.recoveryCapabilityVersion === SCOUT_HELD_EVIDENCE_PROTOCOL_VERSION
    ? 'AWAITING_ADAPTER: '+latest.narrative+'; Engineer owns this work. Resume when its adapter is available.' : null;
}

/** Reuse the Engineer's failed-attempt and source-class links before generated filenames appear in Scout history. */
export async function adapterWaitReasonFromKnowledge(repos:import('../repository/types.ts').ControlPlaneRepositories,
  results:readonly import('../scheduler/scout-result.ts').ScoutResult[]):Promise<string|null> {
  const installed=await installedAdapters();
  const wait=adapterWaitReason(results,installed);
  if(!wait)return null;
  const manual=await readFieldManual(repos,{role:'DETECTIVE'});
  return adapterWaitReason(results,installed,manual.store.entries);
}

/** Reopen adapter waits only when a matching installed implementation has not already been tried. */
export async function wakeInstalledAdapterDebts(repos:import('../repository/types.ts').ControlPlaneRepositories,
  debts:readonly import('../scheduler/debt.ts').FreshnessDebt[],now:string) {
  const waiting=debts.filter(debt=>debt.cause==='AWAITING_ADAPTER');
  if(!waiting.length)return debts;
  const adapters=await installedAdapters();
  const manual=await readFieldManual(repos,{role:'DETECTIVE'});
  const latest=await repos.scoutResults.readLatest(waiting.map(debt=>debt.obligationId),{
    attemptId:true,recordClass:true,refusal:true,outcome:true,recoveryCapabilityVersion:true,narrative:true,nextRungs:true,candidates:true,rungs:true});
  return debts.map(debt=>{
    const result=latest.get(debt.obligationId) as import('../scheduler/scout-result.ts').ScoutResult|undefined;
    if(debt.cause!=='AWAITING_ADAPTER' || !result || result.outcome!=='NEEDS_ADAPTER' || result.refusal!==null ||
      !hasUntriedAdapter(result,adapters,manual.store.entries))return debt;
    return {...debt,cause:'EXTRACTION_FAILED' as const,retryAt:now,detail:debt.detail+'; installed adapter changed: Detective can try the saved bytes.'};
  });
}

export function scoutFactGrounded(result: import('../scheduler/scout-result.ts').ScoutResult, sourceUrl: string, text: string): boolean {
  return result.findings.some(f=>f.sourceUrl===sourceUrl && f.field && f.exactQuote && text.includes(f.exactQuote) && f.value !== null && f.value !== undefined && f.exactQuote.includes(String(f.value)));
}

/** Facts-only success supplies its captured source for plain acquisition/parse, never another Scout. */
export function reusableScoutCandidates(result: import('../scheduler/scout-result.ts').ScoutResult): import('../scheduler/scout-result.ts').ScoutCandidate[] {
  if (result.refusal !== null) return [];
  const rejected = new Set((result.sourceDeadEnds ?? []).map(source => source.artifactId));
  const candidates = result.candidates.filter(c=>!archiveCapture(c.url) && !c.evidenceArtifactIds.some(id=>rejected.has(id)));
  const facts = result.findings.filter(f=>f.kind==='RECORD' && f.field && f.exactQuote && f.sourceUrl && !archiveCapture(f.sourceUrl) &&
    f.artifactIds.length && !f.artifactIds.some(id=>rejected.has(id)));
  return [...candidates,...facts.filter(f=>!candidates.some(c=>c.url===f.sourceUrl)).map(f=>({
    routeId:'held-fact:'+contentHash(f.sourceUrl!).slice(0,24),title:f.field!,url:f.sourceUrl!,procedure:'Read the captured source and parse its exact field value.',
    relevance:'Already solved for this subject and class: '+f.field,permission:'NOT_APPLICABLE' as const,permissionReading:'Saved source facts; normal acquisition and verification still apply.',
    evidenceArtifactIds:f.artifactIds,observedOn:result.recordedAt.slice(0,10),recordClass:result.recordClass,deterministic:true,unverified:[],
  }))];
}
