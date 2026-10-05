/** BR-19: two confirmed orders, the second durably scheduled after the first's Done state. */
import { fingerprint } from "../ids.ts";
import type { ActionContext, ActionResult, GatewayDeps } from "./registry.ts";
export async function executeSequence(deps:GatewayDeps,context:ActionContext,input:Readonly<Record<string,unknown>>):Promise<ActionResult>{
 const {submit}=await import("./gateway.ts");
 const first=input.first as {type:string;subject:string;input:Readonly<Record<string,unknown>>};
 const second=input.second as {type:string;subject:string;input:Readonly<Record<string,unknown>>};
 const base={stateVersion:deps.currentStateVersion,caller:context.request.caller,actorRef:context.request.actorRef};
 const started=await submit({...first,...base,untilDone:first.type==="fleet.deployHere",idempotencyKey:fingerprint([context.receiptId,"first"])},deps);
 if(!started.ok)return {ok:false,refusal:"DOWNSTREAM_REFUSED",says:started.receipt.says};
 const scheduled=await submit({...base,type:"orders.schedule",subject:"",input:{orderType:second.type,subject:second.subject,input:second.input,after:started.receipt.receiptId},idempotencyKey:fingerprint([context.receiptId,"second"])},deps);
 if(!scheduled.ok)return {ok:false,refusal:"DOWNSTREAM_REFUSED",says:`The first order was saved. The second could not be scheduled: ${scheduled.receipt.says}`};
 return {ok:true,outcome:"QUEUED",subject:started.receipt.receiptId,says:"Accepted. The first order starts now; the second waits until it is done.",openedWork:[{kind:"order",id:started.receipt.receiptId,title:started.receipt.label},{kind:"order",id:scheduled.receipt.receiptId,title:scheduled.receipt.label}],readBackAt:"/admin?view=work",undo:"Stop the first order and unschedule the second from their rows."};
}
