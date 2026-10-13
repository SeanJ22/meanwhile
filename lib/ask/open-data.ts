import type { EvidenceRecord } from "./evidence.ts";
import type { OpenDataFact } from "../sources/open-data/model.ts";
import { readerOpenData } from "../sources/open-data/reader.ts";
export const openDataQuestion = (question:string) => /\b(?:data(?:sets?)?|socrata|checkbooks?|permits?|budget|spending|meeting calendars?|facilit(?:y|ies)|pollution|pollutants?|environment|EPA|ECHO|inspections?|violations?|compliance)\b/i.test(question);
export function openDataText(row:OpenDataFact) {
  const dates=`Published ${row.publishedAt?.slice(0,10) ?? "date not supplied"}; updated ${row.updatedAt?.slice(0,10) ?? "date not supplied"}; checked ${row.capturedAt.slice(0,10)}.`;
  return row.kind==="SOCRATA_DATASET" ? `${row.title}. ${row.description} ${dates} Dataset metadata: ${JSON.stringify(row.fields)}. This is the publisher's catalog entry; values in dataset rows have not been extracted by this catalog record.` :
    `${row.title}, ZIP ${row.zip ?? "not supplied"}. ${row.description} Inspections in the past five years: ${row.fields.inspectionCount ?? "not supplied"}; last inspection: ${row.fields.lastInspection ?? "not supplied"}; quarters with noncompliance: ${row.fields.quartersWithNoncompliance ?? "not supplied"}; significant noncompliance: ${row.fields.significantNoncompliance ?? "not supplied"}. Program compliance: air ${row.fields.airCompliance ?? "not supplied"}; water ${row.fields.waterCompliance ?? "not supplied"}; hazardous waste ${row.fields.wasteCompliance ?? "not supplied"}; drinking water ${row.fields.drinkingWaterCompliance ?? "not supplied"}. ${dates}`;
}
export function openDataEvidence(row:OpenDataFact, subjectId?:string|null):EvidenceRecord {
  return {kind:row.kind==="SOCRATA_DATASET"?"DATASET":"REGULATED_FACILITY",id:row.id,subjectId,
    text:openDataText(row),sourceUrl:row.sourceUrl,sourceOrg:row.sourceOrg,retrievedAt:row.capturedAt,occurredAt:row.publishedAt,
    openData:{nativeIds:row.nativeIds,official:row.official,publishedAt:row.publishedAt,updatedAt:row.updatedAt,zip:row.zip}};
}
export async function openDataEvidenceFor(input:Parameters<typeof readerOpenData>[0], subjectId?:string|null) {
  const read=await readerOpenData(input);return {...read,records:read.records.map(row=>openDataEvidence(row,subjectId))};
}
