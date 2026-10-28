import { sha256 } from "../civic-data/candidate-builders.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { FEDERAL_MONEY_PARSER, type FederalMoneyCheckpoint, type FederalMoneyCursor, type FederalMoneyPage, type FederalMoneySource } from "./model.ts";

/** Provider job/file names and incremental observation bounds do not change a native request's identity. */
export function federalMoneySourceKey(source:FederalMoneySource,state:string,cursor:FederalMoneyCursor|null|undefined):string {
  const initial:FederalMoneyCursor={source,phase:source==="federal-audit-clearinghouse"?"general":source==="openfema"?"declarations":source==="usaspending"?"download":"extract"};
  const {since:_since,statusUrl:_status,fileUrl:_file,bulkId:_bulk,...request}=cursor??initial;
  return sha256(canonicalCivicDataJson({source,state,parser:FEDERAL_MONEY_PARSER,request}));
}

/** An acquired native page can be compared before any held recipient or partition facts are read. */
export function federalMoneySourceHash(source:FederalMoneySource,state:string,page:FederalMoneyPage):string|null {
  if(!page.captures.length)return null;
  return sha256(canonicalCivicDataJson({source,state,parser:FEDERAL_MONEY_PARSER,
    captures:[...new Set(page.captures.map(capture=>canonicalCivicDataJson([new URL(capture.url).origin,capture.format,capture.rawHash])))].sort()}));
}

/** A complete task's change history is the union of its actual applied native page hashes. */
export function federalMoneyAppliedSourceHash(source:FederalMoneySource,state:string,pages:FederalMoneyCheckpoint["checkpoint"]["sourcePages"]):string|null {
  return pages?sha256(canonicalCivicDataJson({source,state,
    pages:Object.entries(pages).map(([key,page])=>[key,page.rawHash]).sort((a,b)=>a[0].localeCompare(b[0]))})):null;
}
