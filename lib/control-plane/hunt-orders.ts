import { createHash } from "node:crypto";
import { unitBelongsToState } from "./unit-state.ts";
import type { AggregateRepository, ControlPlaneRepositories, Persisted } from "./repository/types.ts";
import { ADMIN_CONFIG_ID, withExpansionScopes } from "./gateway/admin-config.ts";
import { expansionScopesOf } from "./expansion/scopes.ts";
import { huntPlaceKey } from "./admin-view/v6-hunts-read.ts";
import { HUNT_PACKET_NAMESPACE } from "../hunt/packet.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";

export const scopeControlKey=(key:string):string=>createHash("sha256").update(key).digest("hex");
export const HUNT_STATES = [...new Set(Object.values(FIPS_TO_STATE).map(state=>state.postal.toLowerCase()))].sort();
export interface HuntOrder {
  readonly id: string;
  readonly receiptId: string;
  readonly state: string;
  readonly scopeKey: string | null;
  readonly requestedAt: string;
  readonly requestedBy: string;
  readonly confirmedAt: string | null;
  readonly affected: number | null;
}
export interface HuntOrderRepository extends AggregateRepository<HuntOrder> {
  pending(state: string): Promise<readonly Persisted<HuntOrder>[]>;
  request(orders:readonly HuntOrder[],at:string):Promise<void>;
  latestStop(state:string):Promise<Persisted<HuntOrder>|null>;
}
export const HUNT_ORDER_DDL = [
  `CREATE TABLE IF NOT EXISTS cp_hunt_orders (id text PRIMARY KEY,revision bigint NOT NULL,updated_at timestamptz NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now(),value jsonb NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS cp_hunt_orders_pending ON cp_hunt_orders ((value->>'state'),id) WHERE value->>'confirmedAt' IS NULL",
  "CREATE INDEX IF NOT EXISTS cp_hunt_orders_scope_time ON cp_hunt_orders ((value->>'state'),(value->>'scopeKey'),(value->>'requestedAt') DESC)",
  "CREATE INDEX IF NOT EXISTS cp_hunt_orders_receipt ON cp_hunt_orders ((value->>'receiptId'),id)",
];

export async function requestHuntStop(repos: ControlPlaneRepositories,input: {
  readonly receiptId: string; readonly state?: string; readonly scopeKey?: string; readonly at: string; readonly actor: string;
}): Promise<void> {
  const states=input.state?[input.state.toLowerCase()]:HUNT_STATES;
  if(states.some(state=>!HUNT_STATES.includes(state))) throw new Error("Choose a state for the hunt order");
  await repos.huntOrders.request(states.map(state=>{
    const id=`${input.receiptId}:${state}`;
    return {id,receiptId:input.receiptId,state,scopeKey:input.scopeKey??null,requestedAt:input.at,
      requestedBy:input.actor,confirmedAt:null,affected:null};
  }),input.at);
}

export async function applyHuntOrders(repos: ControlPlaneRepositories,state: string,now: string): Promise<number> {
  const orders=await repos.huntOrders.pending(state);
  if(!orders.length)return 0;
  const held=await repos.adminConfig.read(ADMIN_CONFIG_ID,{expansionScopes:{where:{path:["geography","stateAbbr"],value:state.toUpperCase()}}});
  const parsed=expansionScopesOf(held?.value??null);
  if(parsed.malformed)throw new Error("Stored hunt scopes could not be read");
  const removed=parsed.scopes.filter(scope=>orders.some(order=>scope.decidedAt<=order.value.requestedAt &&
    (order.value.scopeKey===null || scope.key===order.value.scopeKey || huntPlaceKey(scope)===order.value.scopeKey)));
  const removedKeys=new Set(removed.map(scope=>scope.key));
  const remaining=parsed.scopes.filter(scope=>!removedKeys.has(scope.key));
  if(held && removedKeys.size)await repos.adminConfig.save(held,withExpansionScopes(held.value,{scopes:remaining,decidedAt:now}),now);
  const funded=new Set(remaining.filter(scope=>scope.budgetUsd>0).map(scope=>scope.receiptId));
  for(const row of await repos.obligations.listWhere(["materializedBy"],"OWNER_DISPATCH")) {
    if(!row.id.startsWith(HUNT_PACKET_NAMESPACE) || !row.value.active || !unitBelongsToState(row.id,row.value.subjectId,state))continue;
    const marks=row.value.assignments??[];
    const reached=marks.some(mark=>orders.some(order=>mark.at<=order.value.requestedAt &&
      (order.value.scopeKey===null || mark.assignmentKey===order.value.scopeKey)));
    const keep=marks.some(mark=>!orders.some(order=>mark.at<=order.value.requestedAt &&
      (order.value.scopeKey===null || mark.assignmentKey===order.value.scopeKey)) &&
      (mark.assignmentKey.startsWith("dispatch:") || funded.has(mark.ref)));
    if(reached && !keep)await repos.obligations.compareAndSet(row.id,row.revision,{...row.value,active:false,nextDueAt:null,updatedAt:now},now);
  }
  for(const order of orders)await repos.huntOrders.compareAndSet(order.id,order.revision,{...order.value,confirmedAt:now,
    affected:removed.filter(scope=>scope.decidedAt<=order.value.requestedAt && (order.value.scopeKey===null ||
      scope.key===order.value.scopeKey || huntPlaceKey(scope)===order.value.scopeKey)).length},now);
  return orders.length;
}
