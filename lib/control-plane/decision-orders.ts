/** BR-20: a team recommendation becomes an exact gateway order only after the owner decides. */
import { fingerprint } from "./ids.ts";
import { NEEDS, type Need } from "./admin-view/blocker-causes.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig, isAdminConfig } from "./gateway/admin-config.ts";
import { lookupAction, type GatewayDeps, type ActionContext, type ActionResult } from "./gateway/registry.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";

export interface DecisionInputField {
  readonly key: string;
  readonly label: string;
  readonly kind: "number" | "boolean" | "text";
}
export interface DecisionOrderCard {
  readonly id: string;
  readonly need: Need;
  readonly happening: string;
  readonly recommends: string;
  readonly cost: string;
  readonly gets: string;
  readonly order: { readonly type: string; readonly subject: string; readonly input: Readonly<Record<string,unknown>> };
  /** The input fields the owner can change; the action type stays fixed. */
  readonly fields: readonly DecisionInputField[];
  readonly schedulable: boolean;
  readonly raisedAt: string;
  readonly version: string;
  readonly resolution?: { readonly choice: string; readonly reason: string | null; readonly at: string; readonly receiptId: string | null };
}
export interface DecisionOrdersView { readonly cards: readonly DecisionOrderCard[]; readonly observedAt: string }
export function decisionOrders(config: import("./gateway/admin-config.ts").AdminConfig | null):readonly DecisionOrderCard[] { return config?.decisionOrders ?? []; }

/** Called by the team only for BR-09 reasons, with its actual recommendation and exact existing action. */
export async function raiseDecisionOrder(repos:ControlPlaneRepositories,proposal:Omit<DecisionOrderCard,"id"|"version"|"resolution"|"schedulable">):Promise<DecisionOrderCard> {
  if (!(NEEDS as readonly string[]).includes(proposal.need)) throw new Error("A decision needs one of the BR-09 reasons");
  const target=lookupAction(proposal.order.type);
  if (!target || proposal.order.type.startsWith("decision.") || target.definition.authority==="PROHIBITED") throw new Error("A decision needs an existing sendable order");
  const checked=target.validate(proposal.order.input);if(!checked.ok)throw new Error(checked.why);
  if ([proposal.happening,proposal.recommends,proposal.cost,proposal.gets].some(s=>!s.trim()||s.length>1000))throw new Error("Describe what is happening, the recommendation, cost and result");
  for(const field of proposal.fields) {
    if(!field.label.trim()||!(field.key in proposal.order.input)||!['number','boolean','text'].includes(field.kind))throw new Error("Choose a named field of this order to edit");
    const value=proposal.order.input[field.key];if(value!==null&&!['number','boolean','string'].includes(typeof value))throw new Error("A decision field must be one value");
  }
  const version=fingerprint([proposal.need,proposal.happening,proposal.recommends,proposal.cost,proposal.gets,JSON.stringify(proposal.order),JSON.stringify(proposal.fields)]);
  const card:DecisionOrderCard={...proposal,id:`decision-${version}`,version,schedulable:!target.definition.requiresStateVersion&&!proposal.order.type.startsWith("orders.")};
  for(let attempt=0;attempt<4;attempt++){
    const held=await repos.adminConfig.read(ADMIN_CONFIG_ID);const config=held&&isAdminConfig(held.value)?held.value:defaultAdminConfig(proposal.raisedAt);
    const exists=decisionOrders(config).find(c=>c.id===card.id);if(exists)return exists;
    const cards=decisionOrders(config);if(cards.filter(c=>!c.resolution).length>=100)throw new Error("There are already 100 open decision cards");
    const next={...config,updatedAt:proposal.raisedAt,decisionOrders:[...cards.filter(c=>!c.resolution),...cards.filter(c=>c.resolution).slice(-100),card]};
    try{if(held)await repos.adminConfig.compareAndSet(ADMIN_CONFIG_ID,held.revision,next,proposal.raisedAt);else await repos.adminConfig.put(ADMIN_CONFIG_ID,next,proposal.raisedAt);return card;}catch(error){if(attempt===3)throw error;}
  }
  throw new Error("The decision could not be saved");
}

export async function executeDecisionOrder(deps:GatewayDeps,context:ActionContext,input:Readonly<Record<string,unknown>>):Promise<ActionResult> {
  const held=await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);const config=held&&isAdminConfig(held.value)?held.value:null;
  const card=decisionOrders(config).find(c=>c.id===input.decisionId);
  const refused=(refusal: "INVALID_INPUT"|"STALE_STATE"|"DOWNSTREAM_REFUSED",says:string):ActionResult=>({ok:false,refusal,says});
  if(!card)return refused("INVALID_INPUT","That decision card could not be found; nothing was sent.");
  if(card.version!==input.cardVersion)return refused("STALE_STATE","The recommendation has changed; read the card again before deciding.");
  if(card.resolution)return refused("STALE_STATE","That card already has a decision. Its recorded order and reason remain available.");
  const choice=String(input.option);const reason=typeof input.words==="string"?input.words.trim():"";
  if(choice==="decline"&&!reason)return refused("INVALID_INPUT","Say why you are declining this recommendation.");
  if(!["approve","decline","change","schedule"].includes(choice))return refused("INVALID_INPUT","Approve, decline, change or schedule this recommendation.");
  let childId:string|null=null;
  if(choice!=="decline"){
    const orderInput={...card.order.input};
    if(choice==="change"){
      const values=input.fields as Record<string,unknown>|undefined;
      for(const field of card.fields){
        if(!values||!(field.key in values))return refused("INVALID_INPUT",`Give the new ${field.label.toLowerCase()}.`);
        const raw=values[field.key];
        if(field.kind==="boolean"&&raw!==true&&raw!==false&&raw!=="true"&&raw!=="false")return refused("INVALID_INPUT",`Choose on or off for ${field.label.toLowerCase()}.`);
        orderInput[field.key]=field.kind==="number"?Number(raw):field.kind==="boolean"?raw===true||raw==="true":String(raw);
        if(field.kind==="number"&&(String(raw).trim()===""||!Number.isFinite(orderInput[field.key] as number)))return refused("INVALID_INPUT",`Give ${field.label.toLowerCase()} as a number.`);
      }
    }
    const {submit}=await import("./gateway/gateway.ts");
    const request=choice==="schedule"?{type:"orders.schedule",subject:"",input:{orderType:card.order.type,subject:card.order.subject,input:orderInput,startAt:input.startAt}}:{type:card.order.type,subject:card.order.subject,input:orderInput};
    const child=await submit({...request,stateVersion:deps.currentStateVersion,idempotencyKey:fingerprint(["decision-order",context.receiptId]),caller:context.request.caller,actorRef:context.request.actorRef},deps);
    if(!child.ok)return refused("DOWNSTREAM_REFUSED",child.receipt.says);
    childId=child.receipt.receiptId;
  }
  // The child is idempotent: if the resolution write loses a race or the process
  // stops here, the same approval can finish saving without sending twice.
  for(let attempt=0;attempt<4;attempt++){
    const latest=await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);
    if(!latest||!isAdminConfig(latest.value))return refused("DOWNSTREAM_REFUSED","The order was recorded, but the card could not be updated. Check its order before retrying.");
    const cards=decisionOrders(latest.value);const same=cards.find(c=>c.id===card.id);
    if(same?.resolution){if(same.resolution.receiptId!==childId)return refused("STALE_STATE","Another decision has already been recorded for this card.");break;}
    const resolution={choice,reason:reason||null,at:context.at,receiptId:childId};
    try{await deps.repos.adminConfig.compareAndSet(ADMIN_CONFIG_ID,latest.revision,{...latest.value,updatedAt:context.at,decisionOrders:cards.map(c=>c.id===card.id?{...c,resolution}:c)},context.at);break;}catch(error){if(attempt===3)throw error;}
  }
  return {ok:true,outcome:childId?"QUEUED":"DONE",subject:card.id,says:childId?"Accepted. The recommendation is now an order; its progress is shown with your orders.":"Declined. Your reason is saved on the card.",openedWork:childId?[{kind:"order",id:childId,title:card.recommends}]:[],readBackAt:"/admin?view=work",undo:null};
}
