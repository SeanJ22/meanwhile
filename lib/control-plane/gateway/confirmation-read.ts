import { HUNT_STATES } from "../hunt-orders.ts";
import { RUNNER_ID } from "../admin-data.ts";
import type { RunnerHeartbeat } from "../owner-surface.ts";
import { RESEARCH_STATE_ID } from "../scheduler/research-policy.ts";
import { ownerDispatchWorkOf, type DispatchWorkReading, type OwnerDispatchWork } from "../expansion/dispatch-work.ts";
import { placeReadConnection } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";

/** Status receipts need the clock and acknowledgement, not the runner's inventories. */
export const CONFIRMATION_HEARTBEAT_FIELDS = {
  beatAt: true, nextCycleDueAt: true, lastCycleStartedAt: true, discoverySearch: true,
} as const;

export async function readConfirmationHeartbeat(repos: ControlPlaneRepositories): Promise<RunnerHeartbeat | null> {
  return (await repos.runnerHeartbeat.readNarrowed(RUNNER_ID, CONFIRMATION_HEARTBEAT_FIELDS))?.value as RunnerHeartbeat | null ?? null;
}

/** Only the named order's small progress counts cross the database connection. */
export const DISPATCH_CONFIRMATION_SQL = `SELECT id,
  coalesce((SELECT jsonb_build_object('key',t->'key','defined',t #> '{requirements,defined}',
    'created',t #> '{requirements,created}','createdThisCycle',t #> '{requirements,createdThisCycle}',
    'carried',t #> '{requirements,carried}','deferred',t #> '{requirements,deferred}',
    'blockedUnits',t #> '{units,blocked}','blocked',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'code',b->'code','says',(b->>'why')||' ('||(b->>'dataset')||')')) FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(t->'blocked')='array' THEN t->'blocked' ELSE '[]'::jsonb END) b),'[]'::jsonb))
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(value #> '{dispatchWork,targets}')='array'
      THEN value #> '{dispatchWork,targets}' ELSE '[]'::jsonb END) t WHERE t->>'key'=$2 LIMIT 1),
    CASE WHEN value #>> '{ownerDispatch,intentId}'=$3 THEN value #> '{ownerDispatch,work}' END) AS work
  FROM cp_research_state WHERE id=ANY($1::text[])`;

export async function readDispatchConfirmation(repos: ControlPlaneRepositories, intentId: string): Promise<OwnerDispatchWork | null> {
  const ids = [...HUNT_STATES.map(code => `${RESEARCH_STATE_ID}:${code}`), RESEARCH_STATE_ID];
  const sql = placeReadConnection(repos);
  let rows: readonly { readonly id: string; readonly work: OwnerDispatchWork | null }[];
  if (sql) {
    rows = await boundedQuery(sql, { operation: "admin.dispatch-confirmation", callClass: "PAGE" },
      DISPATCH_CONFIRMATION_SQL, [ids, `dispatch:${intentId}`, intentId]) as typeof rows;
  } else {
    rows = await Promise.all(ids.map(async id => {
      const held = await repos.researchState.readNarrowed(id, { ownerDispatch: true, dispatchWork: true });
      const state = held?.value as { ownerDispatch?: { intentId: string; work?: OwnerDispatchWork | null }; dispatchWork?: DispatchWorkReading | null } | undefined;
      return { id, work: ownerDispatchWorkOf(state?.dispatchWork ?? null, intentId)
        ?? (state?.ownerDispatch?.intentId === intentId ? state.ownerDispatch.work ?? null : null) };
    }));
  }
  const byId = new Map(rows.map(row => [row.id, typeof row.work === "string" ? JSON.parse(row.work) as OwnerDispatchWork : row.work]));
  let work: OwnerDispatchWork | null = null;
  for (const id of ids.slice(0, -1)) {
    const scoped = byId.get(id);
    const prior = work as OwnerDispatchWork | null;
    if (scoped) work = prior ? { ...prior, created: prior.created + scoped.created, deferred: prior.deferred + scoped.deferred } : scoped;
  }
  return work ?? byId.get(RESEARCH_STATE_ID) ?? null;
}
