import { sha256 } from "../civic-data/candidate-builders.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { FEDERAL_MONEY_PARSER, type FederalMoneyCursor, type FederalMoneyPage, type FederalMoneySource } from "./model.ts";

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
