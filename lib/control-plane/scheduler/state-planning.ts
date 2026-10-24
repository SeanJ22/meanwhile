import type { StalenessRisk } from "./debt.ts";
import type { DispatchTarget } from "./dispatch-target.ts";
import { ADMIN_CONFIG_ID } from "../gateway/admin-config.ts";
import { expansionScopesOf } from "../expansion/scopes.ts";
import { isAssignmentCycleReading } from "../expansion/assignment-budget.ts";
import { isExpansionCycleReading } from "../expansion/reading.ts";
import { continuingDirectedHunt, originalLifetimeHuntContinuation } from "./hunt-continuation.ts";
import { RESEARCH_STATE_ID } from "./research-policy.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { HUNT_STATES } from "../hunt-orders.ts";
import type { ControlReadsBackfill } from "../repository/control-reads-backfill.ts";

export const PLANNING_STATES=[...HUNT_STATES,"system"];
/** Each state yields its source walks so all states receive planning turns in the same round. */
export const STATE_PLANNING_WALK_MS = 2 * 60_000;
/** A completed state moves behind states still owed a turn, including across a release restart. */
export function planningStateOrder(states: readonly string[], finishedAt: ReadonlyMap<string, string | null>): string[] {
  const time = (state: string) => {
    const at = Date.parse(finishedAt.get(state) ?? "");
    return Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
  };
  return states.map((state, index) => ({ state, index })).sort((a, b) =>
    (Math.sign(time(a.state) - time(b.state)) || 0) || a.index - b.index).map(row => row.state);
}

export const PLANNING_FINISHED_TIMES_SQL = `SELECT states.state, latest.finished_at
  FROM unnest($1::text[]) AS states(state) LEFT JOIN LATERAL (
    SELECT record #>> '{runtimeOutcome,finishedAt}' AS finished_at FROM cp_log_owner_digests
    WHERE log_key='owner-digest:' || states.state AND record #>> '{runtimeOutcome,kind}'='FRESHNESS_CYCLE'
    ORDER BY position DESC LIMIT 1
  ) latest ON true`;
export function planningStateOf(value:string):string|null {
  const state= /\/(?:state|district|territory):([a-z]{2})(?:\/|#|$)/i.exec(value)?.[1].toLowerCase()
    ?? /(?:^|:)government:US-([a-z]{2})(?:[:-]|$)/i.exec(value)?.[1].toLowerCase()
    ?? /^(?:US-)?([a-z]{2})(?:[:-]|$)/i.exec(value)?.[1].toLowerCase();
  return state && HUNT_STATES.includes(state)?state:null;
}
export function stateDispatchTarget(target:DispatchTarget,state:string):DispatchTarget|null {
  if(state==="system" || target.states.length>0 && !target.states.includes(state) || target.states.length===0 && target.terms.length===0)return null;
  return {...target,states:[state],stateNames:[target.stateNames[target.states.indexOf(state)]??state.toUpperCase()]};
}

export function planningStateArg(args:readonly string[]):string|null {
  const named=args.find(arg=>arg.startsWith("--state="));
  if(!named) return null;
  const state=named.slice(8).toLowerCase();
  if(!PLANNING_STATES.includes(state)) throw new Error("Planning requires one state");
  return state;
}
export async function runStateControlBackfill(jobs:ControlReadsBackfill,state:string,onProgress:(state:string,copied:number,archived:number)=>void):Promise<void> {
  let copied=0,archived=0;
  for(;;) {
    const batch=await jobs.runState(state);copied+=batch.copied;archived+=batch.archived;
    if(batch.complete)break;
    onProgress(state,copied,archived);
  }
  onProgress(state,copied,archived);
}
export async function runStatePlanningRound(run:(state:string)=>Promise<boolean>,states:readonly string[]=PLANNING_STATES):Promise<{readonly completed:number;readonly failed:readonly string[]}> {
  let completed=0;const failed:string[]=[];
  for(const state of states) {
    if(await run(state))completed++;else failed.push(state);
  }
  return {completed,failed};
}

export interface PlanningControls {
  revision(state:string):Promise<number>;
  pendingStates():Promise<readonly string[]>;
  applied(state:string,revision:number,at:string):Promise<void>;
  publishSummary(roundAt:string,at:string):Promise<void>;
}
export const PLANNING_CONTROL_DDL=[
  "CREATE TABLE IF NOT EXISTS cp_planning_controls(state text PRIMARY KEY,revision bigint NOT NULL DEFAULT 1,applied_revision bigint NOT NULL DEFAULT 0,applied_at timestamptz)",
  "CREATE INDEX IF NOT EXISTS cp_planning_controls_pending ON cp_planning_controls (state) WHERE revision>applied_revision",
  `CREATE OR REPLACE FUNCTION cp_change_planning_controls() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE state_key text; states text[];
    BEGIN
      IF TG_TABLE_NAME='cp_hunt_orders' AND NEW.value->>'confirmedAt' IS NOT NULL THEN RETURN NULL; END IF;
      SELECT array_agg(DISTINCT key) INTO states FROM (
        SELECT cp_control_state(coalesce(NEW.value,OLD.value)) AS key
        UNION SELECT lower(jsonb_array_elements_text(coalesce(NEW.value->'planningStates','[]'::jsonb)))
        UNION SELECT lower(jsonb_array_elements_text(coalesce(OLD.value->'planningStates','[]'::jsonb)))) reached;
      FOREACH state_key IN ARRAY states LOOP
        INSERT INTO cp_planning_controls(state,revision) VALUES(state_key,1)
          ON CONFLICT(state) DO UPDATE SET revision=cp_planning_controls.revision+1;
      END LOOP;
      RETURN NULL;
    END $$;`,
  ...["cp_admin_expansion_scopes","cp_admin_place_targets","cp_hunt_orders"].map(table=>
    `CREATE OR REPLACE TRIGGER ${table}_planning_changed AFTER INSERT OR UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION cp_change_planning_controls();`),
];

export const PLANNING_SUMMARY_SQL=`WITH rows AS MATERIALIZED (
  SELECT value FROM cp_research_state WHERE id=ANY($1::text[]) AND value->>'cycleStartedAt'>=$2
), latest AS (
  SELECT value FROM rows ORDER BY value->>'beatAt' DESC LIMIT 1
), metadata AS (
  SELECT jsonb_object_agg(key,entry) AS value FROM latest l CROSS JOIN LATERAL jsonb_each(l.value) AS fields(key,entry)
  WHERE key=ANY(ARRAY['formatVersion','beatAt','cycleStartedAt','cycleFinishedAt','testedSha','host',
    'modelLaneEnabled','modelLaneDisabledReason','pausedByOwner','pauseIntentId','workerCredential','model','bounds','spend','hostSupervision'])
), queue_totals AS (
  SELECT key,sum(amount::text::numeric) AS total FROM rows r CROSS JOIN LATERAL jsonb_each(r.value->'queue') AS fields(key,amount)
  WHERE jsonb_typeof(amount)='number' GROUP BY key
), lanes AS (
  SELECT lane,sum(coalesce((entry->>'due')::bigint,0)) AS due,sum(coalesce((entry->>'dispatched')::bigint,0)) AS dispatched,
    CASE WHEN bool_or(entry->>'active' IS NULL) THEN NULL ELSE sum((entry->>'active')::bigint) END AS active,
    sum(coalesce((entry->>'waiting')::bigint,0)) AS waiting,min(entry->>'oldestWaitingDueAt') AS oldest
  FROM rows r CROSS JOIN LATERAL jsonb_each(r.value #> '{queue,lanes}') AS l(lane,entry)
  WHERE lane=ANY(ARRAY['deterministic','model','autonomous']) AND jsonb_typeof(entry)='object' GROUP BY lane
), payload AS (
  SELECT metadata.value || jsonb_build_object('beatAt',$3::text,'cycleStartedAt',$2::text,
    'cycleFinishedAt',CASE WHEN (SELECT bool_and(value->>'cycleFinishedAt' IS NOT NULL) FROM rows) THEN $3::text ELSE NULL END,
    'queue',(SELECT coalesce(jsonb_object_agg(key,total),'{}'::jsonb) FROM queue_totals) || jsonb_build_object('lanes',
      (SELECT jsonb_build_object('at',$3::text,'final',true) || coalesce(jsonb_object_agg(lane,jsonb_build_object(
        'due',due,'dispatched',dispatched,'active',active,'waiting',waiting,'skippedBy',NULL,'oldestWaitingDueAt',oldest)),'{}'::jsonb) FROM lanes)),
    'fleetSafety',(SELECT value->'fleetSafety' #- '{deferred}' FROM latest),'running','[]'::jsonb,'runtimeConditions','[]'::jsonb,'methodCandidates',NULL,'expansion',NULL,'assignments',NULL,'dispatchWork',NULL) AS value
  FROM metadata WHERE metadata.value IS NOT NULL
)
INSERT INTO cp_research_state(id,revision,updated_at,value) SELECT $4,1,$3::timestamptz,value FROM payload
ON CONFLICT(id) DO UPDATE SET revision=cp_research_state.revision+1,updated_at=EXCLUDED.updated_at,value=EXCLUDED.value`;

export async function readPlanningContinuation(repos:ControlPlaneRepositories,cycleOk:boolean,stalledCycles:number) {
  for(const state of HUNT_STATES) {
    if((await repos.huntOrders.pending(state)).length)continue;
    const policy=await repos.adminConfig.read(ADMIN_CONFIG_ID,{expansionScopes:{where:{path:["geography","stateAbbr"],value:state.toUpperCase()}}});
    const scopes=expansionScopesOf(policy?.value??null);if(scopes.malformed || !scopes.scopes.some(scope=>scope.budgetUsd>0))continue;
    const held=await repos.researchState.readNarrowed(`${RESEARCH_STATE_ID}:${state}`,{expansion:true,assignments:true});
    const value=held?.value as {expansion?:unknown;assignments?:unknown}|undefined;
    const expansion=isExpansionCycleReading(value?.expansion)?value.expansion:null;
    const assignments=isAssignmentCycleReading(value?.assignments)?value.assignments:null;
    const funded=scopes.scopes.filter(scope=>scope.budgetUsd>0);
    const lifetime=originalLifetimeHuntContinuation(funded,expansion,assignments,cycleOk?stalledCycles:Math.max(1,stalledCycles));
    const hunt=lifetime??(cycleOk?continuingDirectedHunt(funded,expansion,assignments):null);
    if(hunt)return {hunt,lifetime};
  }
  return null;
}

export interface StatePlanningSummary {
  readonly state: string;
  readonly cycleId:string;
  readonly cycleIds:readonly string[];
  readonly providers:readonly {providerId:string;records:number;units:number;readFailure:string|null;emptyReason:string|null}[];
  readonly risk:StalenessRisk;
  readonly incidents:readonly {cause:string;target:string;obligationsAffected:number;nextRetryAt:string}[];
  readonly recordPath: string;
  readonly registeredUnits: number;
  readonly dueCount: number;
  readonly dispatched: number;
  readonly workedCount: number;
  readonly debts: number;
  readonly incidentCount: number;
  readonly deferred: number;
  readonly dispositionCounts: Readonly<Record<string, number>>;
  readonly costs: { readonly usd: number; readonly measured: number; readonly attempts: number };
  readonly executors: Readonly<Record<string, number>>;
  readonly scoutCost: { readonly usd: number; readonly attempts: number; readonly unmeasured: number };
  readonly deferredRound: boolean;
}

export function summarizePlanningRound(states: readonly StatePlanningSummary[]) {
  const total = (key: "registeredUnits" | "dueCount" | "dispatched" | "workedCount" | "debts" | "incidentCount" | "deferred") =>
    states.reduce((sum, state) => sum + state[key], 0);
  const dispositionCounts: Record<string, number> = {};
  const executors: Record<string, number> = {};
  const providers=new Map<string,{providerId:string;records:number;units:number;failures:number}>();
  for(const state of states)for(const provider of state.providers) {
    const prior=providers.get(provider.providerId)??{providerId:provider.providerId,records:0,units:0,failures:0};
    providers.set(provider.providerId,{...prior,records:prior.records+provider.records,units:prior.units+provider.units,failures:prior.failures+Number(provider.readFailure!==null)});
  }
  const risk:StalenessRisk={obligationsScheduled:states.reduce((n,s)=>n+s.risk.obligationsScheduled,0),
    obligationsUnscheduled:states.reduce((n,s)=>n+s.risk.obligationsUnscheduled,0),
    obligationsOverdue:states.reduce((n,s)=>n+s.risk.obligationsOverdue,0),debtRows:total("debts"),incidents:total("incidentCount"),
    oldestDebtHours:states.some(s=>s.risk.oldestDebtHours!==null)?Math.max(...states.map(s=>s.risk.oldestDebtHours??0)):null,
    activation:"SHADOW_NOT_ACTIVATED"};
  for (const state of states) {
    for (const [key, count] of Object.entries(state.dispositionCounts)) dispositionCounts[key] = (dispositionCounts[key] ?? 0) + count;
    for (const [key, count] of Object.entries(state.executors)) executors[key] = (executors[key] ?? 0) + count;
  }
  const costs = states.reduce((sum, state) => ({usd: sum.usd + state.costs.usd,
    measured: sum.measured + state.costs.measured, attempts: sum.attempts + state.costs.attempts}), {usd: 0, measured: 0, attempts: 0});
  const scoutCost = states.reduce((sum, state) => ({usd: sum.usd + state.scoutCost.usd,
    attempts: sum.attempts + state.scoutCost.attempts, unmeasured: sum.unmeasured + state.scoutCost.unmeasured}), {usd: 0, attempts: 0, unmeasured: 0});
  return {
    registry: {registeredUnits: total("registeredUnits"),workedUnits:total("registeredUnits"),only:null,
      providers:[...providers.values()].map(p=>({providerId:p.providerId,records:p.records,units:p.units,
        readFailure:p.failures?`${p.failures} state reads failed; their state records carry the details.`:null,
        emptyReason:p.units?null:"No state registered work from this provider."}))}, dueCount: total("dueCount"), dispatched: total("dispatched"),
    workedCount: total("workedCount"), debts: total("debts"), incidentCount: total("incidentCount"),
    deferred: total("deferred"), dispositionCounts, costs, executors, scoutCost,risk,incidents:states.flatMap(state=>state.incidents),
    stateReports: states.map(({state, recordPath,cycleIds}) => ({state, recordPath,cycleIds})),
    digest: [`  cost               ${costs.usd.toFixed(4)} over ${costs.measured} measured Attempt(s) of ${costs.attempts} dispatched`,
      `  executors          ${executors.DETERMINISTIC ?? 0} deterministic · ${executors.BOUNDED_MODEL_WORKER ?? 0} bounded model worker`],
  };
}

export function mergeStatePlanningPass(prior:StatePlanningSummary|undefined,next:StatePlanningSummary):StatePlanningSummary {
  if(!prior)return next;
  const add=(a:Readonly<Record<string,number>>,b:Readonly<Record<string,number>>)=>Object.fromEntries(
    [...new Set([...Object.keys(a),...Object.keys(b)])].map(key=>[key,(a[key]??0)+(b[key]??0)]));
  return {...next,cycleIds:[...prior.cycleIds,...next.cycleIds],dueCount:prior.dueCount+next.dueCount,dispatched:prior.dispatched+next.dispatched,workedCount:prior.workedCount+next.workedCount,
    dispositionCounts:add(prior.dispositionCounts,next.dispositionCounts),executors:add(prior.executors,next.executors),
    costs:{usd:prior.costs.usd+next.costs.usd,measured:prior.costs.measured+next.costs.measured,attempts:prior.costs.attempts+next.costs.attempts},
    scoutCost:{usd:prior.scoutCost.usd+next.scoutCost.usd,attempts:prior.scoutCost.attempts+next.scoutCost.attempts,unmeasured:prior.scoutCost.unmeasured+next.scoutCost.unmeasured},
    deferredRound:prior.deferredRound||next.deferredRound};
}
