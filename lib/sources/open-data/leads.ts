import { mergeEntry, newFieldManualEntry, normalizeEntry, writeFieldManual } from "../../control-plane/field-manual.ts";
import { recordNewPublicKinds } from "../../civic-data/public-records.ts";
import type { ControlPlaneRepositories } from "../../control-plane/repository/types.ts";
import type { OpenDataFact } from "./model.ts";
import { canonicalCivicDataJson } from "../../civic-data/changes.ts";
import { freezeDurableJson } from "../../civic-data/durable-json.ts";

/** Catalog contents are concrete source leads; a listing never pretends its rows have been extracted. */
export async function saveSocrataLeads(repos:ControlPlaneRepositories, rows:readonly OpenDataFact[], now:string) {
  const datasets=rows.filter(row=>row.kind==="SOCRATA_DATASET");
  const entries=datasets.map(row=>normalizeEntry(newFieldManualEntry("socrata-discovery",row.id,{
    role:"SHARED",kind:"SOURCE_LEAD",title:row.title,summary:row.description || `Read ${row.title} from ${row.sourceOrg}`,
    outcome:"REFERENCE",url:row.sourceUrl,observedAt:row.capturedAt,ocdIds:[...row.divisionIds],states:row.state?[row.state.toLowerCase()]:[],
    recordClasses:["PUBLIC_RECORD"],platforms:["SOCRATA"],portable:false,
    payload:{datasetId:row.nativeIds.socrata_id,domain:row.nativeIds.domain,nativeIds:row.nativeIds,publishedAt:row.publishedAt,
      updatedAt:row.updatedAt,columns:row.fields.columns,metadata:row.fields.metadata,sourceId:row.sourceId},
  })));
  const inserted=await repos.fieldManual.insertNew(entries,now);
  const existing=entries.filter(entry=>!inserted.has(entry.id));
  const held=new Map((await repos.fieldManual.readMany(existing.map(entry=>entry.id))).map(row=>[row.id,row.value]));
  const changed=existing.filter(entry=>{
    const prior=held.get(entry.id);if(!prior)return true;
    // A fresh catalog check alone does not rewrite every standing lead.
    const facts=(value:typeof entry)=>canonicalCivicDataJson(freezeDurableJson({...value,observedAt:null,placeResults:null}));
    return facts(mergeEntry(prior,entry))!==facts(prior);
  });
  const saved=await writeFieldManual(repos,changed,now);
  if(saved.error)throw Error(saved.error);
  const records=datasets.flatMap(row=>row.divisionIds.map(ocdId=>({id:row.id,kind:"PUBLIC_RECORD" as const,bodyId:null,ocdId,
    kindLabel:String(row.fields.category || "Open data"),title:row.title,sourceSentence:row.description || row.title,
    sourceUrl:row.sourceUrl,capturedAt:row.capturedAt})));
  if(records.length)await recordNewPublicKinds(repos,records,now);
}
