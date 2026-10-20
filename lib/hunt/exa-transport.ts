import {runExaAgent,type ExaAgentRun} from './exa-agent.ts';
import type {HuntPacket} from './packet.ts';
import type {ModelRequest,ModelResponse} from '../control-plane/scheduler/scout-executor.ts';

export const EXA_AGENT_MODEL='exa-agent-high';
/** Exa's fixed high-effort list price. Public source reads do not request paid contact enrichment. */
export const EXA_AGENT_PRICE_USD=0.5;
export interface ExaResearchRequest {readonly packet:HuntPacket;readonly instructions:string;readonly deadlineMs:number;}
type Request=ModelRequest & {readonly exaResearch?:ExaResearchRequest;readonly onProviderProgress?:()=>void};
type Response=ModelResponse & {readonly exaResearch?:ExaAgentRun};

export function exaModelRequest(research:ExaResearchRequest):Request {
 return {model:EXA_AGENT_MODEL,max_tokens:0,system:[],tools:[],messages:[],exaResearch:research};
}
export function isExaModelRequest(request:ModelRequest):request is Request & {readonly exaResearch:ExaResearchRequest} {
 return request.model===EXA_AGENT_MODEL && !!(request as Request).exaResearch;
}
export function exaRunOf(response:ModelResponse):ExaAgentRun {
 const run=(response as Response).exaResearch;
 if(response.model!==EXA_AGENT_MODEL || !run)throw new Error('EXA_AGENT_RESPONSE_MISSING');
 return run;
}
export function exaResponseUsd(response:ModelResponse):number|null {
 const usd=(response as Response).exaResearch?.costUsd;
 return typeof usd==='number' && Number.isFinite(usd) && usd>=0 ? usd : null;
}
/** The parent's existing paid transport owns Send, area and Fleet reservations.
 * Only after admission does it call this provider; the child still reports
 * source evidence through its ordinary report_finding toolkit. */
export function exaAgentTransport(key:string|undefined){
 return async(request:ModelRequest):Promise<Response>=>{
  if(!key || !isExaModelRequest(request))throw new Error('EXA_AGENT_TRANSPORT_UNCONFIGURED');
  const run=await runExaAgent({...request.exaResearch,key,onPoll:request.onProviderProgress});
  return {model:EXA_AGENT_MODEL,stop_reason:run.status,content:[],usage:{input_tokens:0,output_tokens:0},exaResearch:run};
 };
}
