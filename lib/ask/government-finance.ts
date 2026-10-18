import { readGovernmentBudgets, type GovernmentBudgetFact } from "../civic-data/government-budgets.ts";
import { governmentMoneyView, governmentMoneyText } from "../funding/government-money.ts";
import { currentReaderAuthorityEdge,ensurePromotedEdge } from "../registry/runtime-edge.ts";
import { scopedManualContractScope } from "../civic-data/scoped-manual-contracts.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import type { EvidenceRecord,EvidenceSubject } from "./evidence.ts";

import { governmentFinanceQuestion } from "./government-finance-question.ts";
export { governmentFinanceQuestion } from "./government-finance-question.ts";
import { overLengthBudget } from "./length-contract.ts";
/** One government's existing scoped typed records; an absent optional family
 * in a complete edge request never opens a database fallback. */
export async function governmentFinanceEvidence(bodyId:string,divisionId:string,options:PromotedCivicDataReadOptions={}):Promise<EvidenceRecord[]> {
  const scope=scopedManualContractScope("government-budgets",divisionId);
  const served=options.store===undefined ? await ensurePromotedEdge("CURATED_READER_RECORD",scope) : null;
  if(options.store===undefined && currentReaderAuthorityEdge() && !served)return [];
  const read=await readGovernmentBudgets(divisionId,{...options,...(served?{edge:served.value}:{})});
  if(read.kind!=="PROMOTED")return [];
  return governmentMoneyView(read.value.records,bodyId,divisionId,{latestAudit:false}).records.map(row=>({kind:"GOVERNMENT_FINANCE",id:row.id,
    subjectId:bodyId,bodyId,text:governmentMoneyText(row),sourceUrl:row.sourceUrl,sourceOrg:row.government,retrievedAt:row.capturedAt,governmentFinance:row}));
}
export function composeGovernmentFinanceAnswer(input:{subject:EvidenceSubject|null;question:string;records:readonly EvidenceRecord[]}) {
  if(input.subject?.kind!=="BODY" || !governmentFinanceQuestion(input.question))return null;
  const period = input.question.match(/\b(?:FY\s*)?((?:19|20)\d{2})\b/i)?.[1];
  const wanted = /\baudit\b/i.test(input.question) ? "AUDIT" : /\bdebt\b/i.test(input.question) ? "DEBT" : /\brevenue\b/i.test(input.question) ? "REVENUE" : /\b(?:spending|expenditures?)\b/i.test(input.question) ? "SPENDING" : /\btax rates?\b/i.test(input.question) ? "TAX" : /\bgrants?\b/i.test(input.question) ? "GRANT" : "BUDGET";
  const held=input.records.filter(row=>row.kind==="GOVERNMENT_FINANCE" && row.subjectId===input.subject!.id && row.governmentFinance).filter(row => {
    const fact = row.governmentFinance!;
    const fiscal = fact.kind === "GOVERNMENT_FINANCE" ? fact.details.fiscalPeriod : fact.kind === "BUDGET_RESPONSIBILITY" ? null : fact.fiscalYear;
    return (!period || typeof fiscal === "string" && new RegExp(`\\b(?:FY\\s*)?${period}\\b`, "i").test(fiscal)) && (fact.kind === "GOVERNMENT_FINANCE" ? fact.category === wanted : wanted === "BUDGET");
  });
  const latest = !period && wanted === "AUDIT" ? new Set(governmentMoneyView(held.map(row=>row.governmentFinance!),input.subject.id,held[0]?.governmentFinance?.ocdId ?? "").records.map(row=>row.id)) : null;
  const selected:EvidenceRecord[]=[];let answer="";
  for(const row of held){
    if (latest && !latest.has(row.governmentFinance!.id)) continue;
    if (overLengthBudget((answer ? answer + " " : "") + row.text)) continue;
    selected.push(row);answer+=(answer?" ":"")+row.text;
  }
  return answer ? {answer,citedUrls:[...new Set(selected.map(row=>row.sourceUrl).filter((url):url is string=>Boolean(url)))]} : null;
}
export type { GovernmentBudgetFact };
