import { readGovernmentBudgets, type GovernmentBudgetFact } from "../civic-data/government-budgets.ts";
import { governmentMoneyView } from "../funding/government-money.ts";
import { currentReaderAuthorityEdge,currentPromotedEdge } from "../registry/runtime-edge.ts";
import { scopedManualContractScope } from "../civic-data/scoped-manual-contracts.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import type { EvidenceRecord,EvidenceSubject } from "./evidence.ts";

export function governmentFinanceQuestion(question:string) {
  return /\b(?:budget|revenue|expenditures?|spending|debt|audits?|grants?|tax rates?|capital totals?|operating totals?)\b/i.test(question) &&
    !/\b(?:campaign|donors?|contributions?|who voted|how did .*vote|when did .*vote)\b/i.test(question);
}
/** One government's existing scoped typed records; an absent optional family
 * in a complete edge request never opens a database fallback. */
export async function governmentFinanceEvidence(bodyId:string,divisionId:string,options:PromotedCivicDataReadOptions={}):Promise<EvidenceRecord[]> {
  const scope=scopedManualContractScope("government-budgets",divisionId);
  const served=options.store===undefined ? currentPromotedEdge("CURATED_READER_RECORD",scope) : null;
  if(options.store===undefined && currentReaderAuthorityEdge() && !served)return [];
  const read=await readGovernmentBudgets(divisionId,{...options,...(served?{edge:served.value}:{})});
  if(read.kind!=="PROMOTED")return [];
  return governmentMoneyView(read.value.records,bodyId,divisionId).records.map(row=>({kind:"GOVERNMENT_FINANCE",id:row.id,
    subjectId:bodyId,bodyId,text:row.sourceSentence,sourceUrl:row.sourceUrl,sourceOrg:row.government,retrievedAt:row.capturedAt,governmentFinance:row}));
}
export function composeGovernmentFinanceAnswer(input:{subject:EvidenceSubject|null;question:string;records:readonly EvidenceRecord[]}) {
  if(input.subject?.kind!=="BODY" || !governmentFinanceQuestion(input.question))return null;
  const held=input.records.filter(row=>row.kind==="GOVERNMENT_FINANCE" && row.subjectId===input.subject!.id && row.governmentFinance);
  const selected:EvidenceRecord[]=[];let answer="";
  for(const row of held){
    if(answer.length+row.text.length+1>650 || (answer+row.text).split(/[.!?](?:\s|$)/).length>5)continue;
    selected.push(row);answer+=(answer?" ":"")+row.text;
  }
  return answer ? {answer,citedUrls:[...new Set(selected.map(row=>row.sourceUrl).filter((url):url is string=>Boolean(url)))]} : null;
}
export type { GovernmentBudgetFact };
