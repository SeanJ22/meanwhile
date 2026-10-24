import { readBillsForState,billsForPerson } from "../sources/legiscan/reader.ts";
import type { Bill,HeldPerson } from "../sources/legiscan/bills.ts";
import type { EvidenceRecord,EvidenceSubject } from "./evidence.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";

export const isBillQuestion=(question:string)=>/\b(?:bills?|legislation|sponsor(?:ed|s|ing)?|cosponsor(?:ed|s|ing)?|[HS](?:B|R|JR|CR)\s*\d+)\b/i.test(question);
function billEvidence(bill:Bill,subjectId:string|null=null):EvidenceRecord[] {
  const record:EvidenceRecord={kind:"STATE_BILL",id:bill.id,subjectId,text:`${bill.state} ${bill.number} (${bill.sessionName}): ${bill.title}. Status: ${bill.statusLabel}${bill.statusDate?` on ${bill.statusDate}`:""}. Sponsors: ${bill.sponsors.map(row=>row.name).join(", ")||"not published"}. ${bill.description}`,
    occurredAt:bill.statusDate,sourceUrl:bill.sourceUrl,sourceOrg:"LegiScan (CC BY 4.0)",retrievedAt:bill.facts.title.collectedAt,
    bill:{number:bill.number,state:bill.state,session:bill.sessionName,status:bill.statusLabel,publishedAt:bill.facts.title.publishedAt,texts:bill.texts}};
  return [record,...bill.texts.map(row=>({kind:"BILL_TEXT_LINK" as const,id:`${bill.id}:text:${row.id}`,subjectId,text:`${bill.state} ${bill.number}: ${row.type} text link${row.date?` published ${row.date}`:""}.`,
    sourceUrl:row.url,sourceOrg:"LegiScan (CC BY 4.0)",retrievedAt:bill.facts.title.collectedAt,occurredAt:row.date})),
    ...(bill.governmentUrl?[{kind:"BILL_TEXT_LINK" as const,id:`${bill.id}:government`,subjectId,text:`${bill.state} ${bill.number}: legislature bill page.`,sourceUrl:bill.governmentUrl,sourceOrg:bill.governmentSourceOfficial?`${bill.state} Legislature (official)`:`${bill.state} Legislature`,retrievedAt:bill.facts.title.collectedAt}]:[])];
}
export async function legiscanBillEvidence(input:{question:string;states:readonly string[];subject:EvidenceSubject|null;person?:HeldPerson|null},options:PromotedCivicDataReadOptions={}) {
  const records:EvidenceRecord[]=[]; let rows=0,missing=0;
  const designation=/\b([HS](?:B|R|JR|CR))\s*0*(\d+)\b/i.exec(input.question);
  for(const state of new Set(input.states)) {
    let read:Awaited<ReturnType<typeof readBillsForState>>;
    try {read=await readBillsForState(state,{...options,...(input.subject?.kind==="PERSON"&&input.person?{person:input.person}:{})});} catch {missing++;continue;}
    if(!read.complete) missing++;
    const bodyDivision=input.subject?.kind==="BODY"?input.subject.id.split("#")[0]:null;
    const candidates=input.subject?.kind==="PERSON"?(input.person?billsForPerson(read.bills,input.person):[]):input.subject?.kind==="BODY"?read.bills.filter(row=>row.ocdId===bodyDivision):read.bills;
    const selected=candidates.filter(row=>!designation||row.number.replace(/\s/g,"").replace(/^([A-Z]+)0+(\d+)/,"$1$2").toUpperCase()===`${designation[1].toUpperCase()}${designation[2]}`)
      .sort((a,b)=>(b.statusDate??"").localeCompare(a.statusDate??""));
    rows+=selected.length;
    // The full denominator stays explicit while synthesis receives a bounded recent evidence pack.
    records.push(...selected.slice(0,30).flatMap(row=>billEvidence(row,input.subject?.id??null)));
  }
  return {records,denominators:{legiscanBillsMatched:rows,legiscanBillsShown:records.filter(row=>row.kind==="STATE_BILL").length},
    gaps:missing?[{whose:"OURS" as const,statement:"We're working on getting all bill records for your area."}]:input.subject?.kind==="PERSON"&&!rows?
      [{whose:"OURS" as const,statement:"We're working on getting this person's bill records."}]:[]};
}
