/** BR-18: parse the owner's examples into inputs for existing registered actions. */
import { askedPlace } from "./place-key.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { US_STATES } from "../readiness/catalog.ts";
import { parseV6PlaceKey } from "../admin-view/v6-hunts-read.ts";
import { scopeKeyOf, expansionScopesOf, type ExpansionScopeGeography } from "../expansion/scopes.ts";
import type { OperatorContext } from "./context.ts";
export interface PlainOrder { readonly type:string; readonly subject:string; readonly input:Readonly<Record<string,unknown>>; readonly willDo:string }
export function plainOrderType(words:string):string|null {
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
 const version=scope.type==="congressional_district"?"cd:119":`${scope.type}:2020`;
 return {type:scope.type as ExpansionScopeGeography["type"],geoid:scope.geoid,version,label:`${scope.type==="zcta"?"ZIP":scope.type==="congressional_district"?"Congressional district":scope.type} ${scope.geoid} in ${state.name}`,stateAbbr:state.code.toUpperCase()};
}
export function parsePlainOrder(words:string,context:OperatorContext):PlainOrder|{why:string}|null {
 const type=plainOrderType(words);if(!type)return null;
 if(type==="fleet.deployHere"){
  let target=words.replace(/^send agents (?:to|in)\s*/i,"").replace(/[.!]$/,"").trim();
  if(/\b(?:this|selected|my)\s+(?:place|district|state|county)\b/i.test(target)){
   const key=askedPlace(target,context.from);const geo=key?geographyOf(key):null;
   if(!geo)return {why:"Choose a place first, or name the place to send agents to."};
   target=target.replace(/(?:this|selected|my)\s+(?:place|district|state|county)/i,`${geo.stateAbbr} ${geo.geoid}`);
  }
  return {type,subject:askedPlace(words,context.from)??target,input:{note:target},willDo:`Send agents to ${target}, inside the current spending limits.`};
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
