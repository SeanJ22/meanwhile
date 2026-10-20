/** BR-12/13: capture scores at acceptance and compare them with the same live place score later. */
import { readPlaceOwed } from "../admin-view/place-owed-read.ts";
import { scorePlace } from "../admin-view/place-scorecard.ts";
import { readerQuery } from "../../civic-data/promoted-reader-query.ts";
import { scopeKeyOf, expansionScopesOf, type ExpansionScopeGeography } from "../expansion/scopes.ts";
import { huntPlaceKey } from "../admin-view/v6-hunts-read.ts";
import { ADMIN_CONFIG_ID, isAdminConfig, placeTargetOf } from "./admin-config.ts";
import { readAssignmentCycleHeader, readAssignmentForSend } from "../expansion/assignment-reading.ts";
import type { ActionReceipt } from "./contract.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { Confirmation } from "./confirmation.ts";

export interface PlaceScoreReading { readonly captured:number;readonly owed:number;readonly percent:number|null;readonly observedAt:string }
export type PlaceScoreReader = (placeKey:string)=>Promise<PlaceScoreReading|null>;
export interface HuntAcceptanceScore { readonly placeKey:string;readonly scopeKey:string;readonly label:string;readonly assignmentRef?:string;readonly before:PlaceScoreReading|null }
export const livePlaceScore:PlaceScoreReader=async key=>{
  if (!readerQuery()) return null;
  const read=await readPlaceOwed(key);
  if(read.state!=="READ")return null;
  const score=scorePlace(read.rows,{},[]).overall;
  return {captured:score.captured,owed:score.total,percent:score.percent,observedAt:read.observedAt};
};
export async function scoresAtAcceptance(type:string,input:Readonly<Record<string,unknown>>,read:PlaceScoreReader=livePlaceScore):Promise<readonly HuntAcceptanceScore[]|undefined>{
  const geographies:ExpansionScopeGeography[]=type==="expansion.scope.set"?[input.geography as ExpansionScopeGeography]
    :type==="expansion.scope.setMany"?(input.items as readonly {geography:ExpansionScopeGeography}[]).map(i=>i.geography):[];
  if(!geographies.length)return undefined;
  const result:HuntAcceptanceScore[]=[];
  // Same place memo and at most eight reads in flight; this never creates work or changes a budget.
  for(let i=0;i<geographies.length;i+=8) result.push(...await Promise.all(geographies.slice(i,i+8).map(async geography=>{
    const placeKey=huntPlaceKey({geography} as Parameters<typeof huntPlaceKey>[0]);
    return {placeKey,scopeKey:scopeKeyOf(geography),label:geography.label,before:await read(placeKey).catch(()=>null)};
  })));
  return result;
}
const scoreWords=(score:PlaceScoreReading|null)=>score===null?"—":`${score.percent===null?"—":`${score.percent}%`} (${score.captured} of ${score.owed})`;
export async function confirmHuntScores(repos:ControlPlaneRepositories,receipt:ActionReceipt,core:Confirmation,read:PlaceScoreReader=livePlaceScore):Promise<Confirmation>{
  const accepted=receipt.huntScores;
  if(!accepted?.length)return core;
  try{
    const [held,assignments]=await Promise.all([repos.adminConfig.read(ADMIN_CONFIG_ID),readAssignmentCycleHeader(repos)]);
    const config=held&&isAdminConfig(held.value)?held.value:null;
    const scopes=config?expansionScopesOf(config):null;
    const current=await Promise.all(accepted.map(score=>read(score.placeKey).catch(()=>null)));
    let finished=true;
    for(const score of accepted){
      const assignment=await readAssignmentForSend(repos,assignments,score.scopeKey,score.assignmentRef??receipt.receiptId);
      const stopped=Boolean(scopes&&scopes.malformed===0&&!scopes.scopes.some(s=>s.key===score.scopeKey));
      if(!stopped&&assignment?.completion?.kind!=="COMPLETE")finished=false;
    }
    const before=accepted.map(score=>`${score.label}: ${scoreWords(score.before)}`).join("; ");
    const after=accepted.map((score,i)=>`${score.label}: ${scoreWords(current[i])}`).join("; ");
    const known=accepted.every((s,i)=>s.before?.percent!==null&&s.before!==null&&current[i]?.percent!==null&&current[i]!==null);
    const done=known?accepted.reduce((n,s,i)=>n+Math.max(0,current[i]!.percent!-s.before!.percent!),0):null;
    const of=known?accepted.reduce((n,s)=>n+Math.max(0,(placeTargetOf(config,s.placeKey)?.goalPercent??100)-s.before!.percent!),0):null;
    return {...core,state:finished?"applied":core.state==="applied"?"in-progress":core.state,
      words:finished?"Done. The place score before and after is shown below.":core.state==="applied"?"The runner has the hunt; its progress is shown below.":core.words,
      progress:{done,of},change:{before,after},at:finished?assignments?.at??core.at:core.at};
  }catch{return {...core,state:"unread",words:"The hunt is saved; its progress could not be read just now."};}
}

/** Existing lifetime hunts retain their original assignment identity when edited. */
export async function bindScoreAssignments(repos:ControlPlaneRepositories,scores:readonly HuntAcceptanceScore[],receiptId:string):Promise<readonly HuntAcceptanceScore[]> {
  try {
    const held=await repos.adminConfig.read(ADMIN_CONFIG_ID);
    if(!held||!isAdminConfig(held.value))return scores;
    const scopes=expansionScopesOf(held.value).scopes;
    return scores.map(score=>{ const scope=scopes.find(s=>s.key===score.scopeKey); return {...score,assignmentRef:scope&&(scope.latestDecisionReceiptId===receiptId||scope.receiptId===receiptId)?scope.receiptId:undefined}; });
  }catch{return scores;}
}
