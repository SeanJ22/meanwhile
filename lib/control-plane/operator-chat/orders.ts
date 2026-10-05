/** BR-18: parse the owner's examples into inputs for existing registered actions. */
import { askedPlace } from "./place-key.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { US_STATES } from "../readiness/catalog.ts";
import { parseV6PlaceKey } from "../admin-view/v6-hunts-read.ts";
import { scopeKeyOf, expansionScopesOf, type ExpansionScopeGeography } from "../expansion/scopes.ts";
import type { OperatorContext } from "./context.ts";
export interface PlainOrder { readonly type:string; readonly subject:string; readonly input:Readonly<Record<string,unknown>>; readonly willDo:string }
export function plainOrderType(words:string):string|null {
 if (/\buntil (?:they(?:\'re| are) |it(?:\'s| is) )?done[,. ]+then\b/i.test(words)) return "orders.sequence";
 if (/^send agents (?:to|in)\b/i.test(words)) return "fleet.deployHere";
 if (/^start (?:a )?mission in\b/i.test(words)) return "expansion.scope.set";
 if (/^set (?:the )?(?:daily |spend )?budget to \$?[\d,.]+\s*[.!]?$/i.test(words)) return "config.setFleetSpendCeiling";
 if (/^(?:pause|resume) (?:all workers|workers|the runner|runner|paid research|research)\s*[.!]?$/i.test(words)) return /^pause/i.test(words) ? /research/i.test(words)?"research.pause":"runner.pause" : /research/i.test(words)?"research.resume":"runner.resume";
 if (/^take back\s+\S+/i.test(words)) return "fleet.cancelDispatch";
 return null;
}
function geographyOf(key:string):ExpansionScopeGeography|null {
 const scope=parseV6PlaceKey(key);if(!scope||scope.kind==="country")return null;
 const state=US_STATES.find(s=>s.code===scope.state);const fips=Object.entries(FIPS_TO_STATE).find(([,s])=>s.postal.toLowerCase()===scope.state)?.[0];
 if(!state||!fips)return null;
 if(scope.kind==="state")return {type:"state",geoid:fips,version:"state:2020",label:state.name,stateAbbr:state.code.toUpperCase()};
 const label=scope.type==="zcta"?`ZIP ${scope.geoid} in ${state.name}`:scope.type==="congressional_district"?`Congressional district ${Number(scope.geoid.slice(-2))} in ${state.name}`:`the selected ${scope.type.replace(/_/g," ")} in ${state.name}`;
 const version=scope.type==="congressional_district"?"cd:119":`${scope.type}:2020`;
 return {type:scope.type as ExpansionScopeGeography["type"],geoid:scope.geoid,version,label,stateAbbr:state.code.toUpperCase()};
}
export function parsePlainOrder(words:string,context:OperatorContext):PlainOrder|{why:string}|null {
 const type=plainOrderType(words);if(!type)return null;
 if(type === "orders.sequence"){
  const split=/\buntil (?:they(?:'re| are) |it(?:'s| is) )?done[,. ]+then\b/i.exec(words)!;
  let before=words.slice(0,split.index).trim();let after=words.slice(split.index+split[0].length).trim();
  if(/^put everything on /i.test(before))before=before.replace(/^put everything on /i,"send agents to ");
  if(/^go back to /i.test(after))after=after.replace(/^go back to /i,"send agents to ")+(/\bthis (?:district|place|state|county)\b/i.test(before)?" in this district":"");
  let first=parsePlainOrder(before,context);let second=parsePlainOrder(after,context);
  if(!first||!second||"why" in first||"why" in second)return {why:"Name two sendable orders, with the second after ‘until done, then’."};
  if(/school boards?/i.test(before)) first={...first,input:{...first.input,kind:{divisionType:"school_district"}}};
  if(/candidates?/i.test(after)) second={...second,input:{...second.input,kind:{family:"CAN"}}};
  return {type,subject:first.subject,input:{first:{type:first.type,subject:first.subject,input:first.input},second:{type:second.type,subject:second.subject,input:second.input}},willDo:`First: ${first.willDo} When its work is done: ${second.willDo}`};
 }
 if(type==="fleet.deployHere"){
  let target=words.replace(/^send agents (?:to|in)\s*/i,"").replace(/[.!]$/,"").trim();
  let shown=target;
  if(/\b(?:this|selected|my)\s+(?:place|district|state|county)\b/i.test(target)){
   const key=askedPlace(target,context.from);const geo=key?geographyOf(key):null;
   if(!geo)return {why:"Choose a place first, or name the place to send agents to."};
   shown=target.replace(/(?:this|selected|my)\s+(?:place|district|state|county)/i,geo.label);
   target=target.replace(/(?:this|selected|my)\s+(?:place|district|state|county)/i,`${geo.stateAbbr} ${geo.geoid}`);
  }
  return {type,subject:askedPlace(words,context.from)??target,input:{note:target},willDo:`Send agents to ${shown}, inside the current spending limits.`};
 }
 if(type==="config.setFleetSpendCeiling"){
  const amount=Number(words.replace(/^.*?\$?([\d,.]+)\s*[.!]?$/,"$1").replace(/,/g,""));
  return {type,subject:"us",input:{rollingCeilingUsd:amount},willDo:`Set the daily spend ceiling to $${amount}.`};
 }
 if(type==="expansion.scope.set"){
  const key=askedPlace(words,context.from);const geo=key?geographyOf(key):null;
  if(!geo)return {why:"Name a state or district, or choose the place for this mission."};
  if(context.adminConfig===undefined||context.adminConfig===null)return {why:"The current mission budgets could not be read, so no budget was guessed. Try again."};
  const scopes=expansionScopesOf(context.adminConfig);if(scopes.malformed)return {why:"The saved missions could not all be read. Nothing was changed."};
  const held=scopes.scopes.find(s=>s.key===scopeKeyOf(geo));
  const explicit=/\b(?:with (?:a )?budget (?:of )?|for )\$([\d,.]+)/i.exec(words);
  const budgetUsd=explicit?Number(explicit[1].replace(/,/g,"")):held?.budgetUsd??0;
  return {type,subject:key!,input:{geography:geo,priority:held?.priority??1,budgetUsd,huntBudget:held?.budgetStartedAt!==undefined,note:null},willDo:`Start a mission in ${geo.label} with a $${budgetUsd} paid-work budget${!explicit&&!held?"; plain-code work can run, and paid work waits for a budget":""}.`};
 }
 if(type==="fleet.cancelDispatch"){
  const intentId=words.replace(/^take back\s+/i,"").trim();
  if(!/^DISPATCH:/.test(intentId))return {why:"Use Take it back on the send's row so the exact order is named."};
  return {type,subject:intentId,input:{intentId},willDo:"Take back this send; work already in flight may finish."};
 }
 return {type,subject:"us",input:{note:null},willDo:`${/^pause/i.test(words)?"Pause":"Resume"} ${/research/i.test(words)?"paid research":"all workers"}.`};
}
