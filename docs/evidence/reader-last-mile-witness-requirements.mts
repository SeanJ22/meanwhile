import {writeFileSync} from "node:fs";
import {readReaderEvidence,componentRequirements,importReachability,type ReaderCensus,type ReaderComponentCase} from "../../lib/holdings/reader-census.ts";
import {READER_SURFACES} from "../../lib/holdings/datasets.ts";
const root=process.cwd();
const census=JSON.parse(readReaderEvidence(root,"docs/evidence/reader-last-mile-current.json").toString()) as ReaderCensus;
const cases=["current-components","bodies"].flatMap(name=>(JSON.parse(readReaderEvidence(root,`docs/evidence/reader-last-mile-${name}.json`).toString()) as {cases:ReaderComponentCase[]}).cases);
const records=new Map(census.records.map(r=>[r.auditId,r]));
const requirements=new Map<string,{surface:string;component:string;families:Set<string>;ids:Set<string>;selectors:Set<string>;importReach:boolean}>();
for(const row of census.rows) for(const id of row.applicableEligibleRecordIds??row.eligibleRecordIds) for(const component of componentRequirements(records.get(id)!)){
 const key=`${row.readerSurface}#${component}`; let entry=requirements.get(key);
 if(!entry){entry={surface:row.readerSurface,component,families:new Set(),ids:new Set(),selectors:new Set(),importReach:importReachability(root,READER_SURFACES.find(s=>s.id===row.readerSurface)!.path,component).reached};requirements.set(key,entry);}
 entry.families.add(row.datasetFamily);entry.ids.add(id);
}
for(const c of cases)for(const r of requirements.values())if(c.component===r.component&&r.ids.has(c.auditId))r.selectors.add(c.selector);
const result=[...requirements.values()].map(r=>({surface:r.surface,component:r.component,families:[...r.families],recordObligations:r.ids.size,selectorClasses:[...r.selectors],importReach:r.importReach}));
writeFileSync("docs/evidence/reader-last-mile-witness-requirements.json",JSON.stringify({rule:"Actual component classes needing in-situ execution. Non-reachable API/Ask classes need their actual route record proofs instead of a manufactured visual witness. Counts use current applicability and will refresh after final selector repair.",requirements:result},null,2)+"\n");
console.log(JSON.stringify(result.filter(r=>r.importReach).map(({selectorClasses,...r})=>({...r,selectorClasses:selectorClasses.length})),null,2));
