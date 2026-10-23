import { blurbForTitle, officeTypeForTitle } from "./office-blurbs.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { readTranslations } from "../translate/projection-reader.ts";
import { textTranslationFor } from "../translate/reader.ts";
import type { TextTranslation } from "../translate/records.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
function originalDefinition(record: TextTranslation | null) {
  const citation=record?.curatedOrigin?.citation;
  return record ? citation ? {text:record.text,basis:citation.basis,basisUrl:citation.url,readOn:citation.readOn ?? ""}
    : {text:record.text,basis:record.label,basisUrl:record.sourceUrl,readOn:record.retrievedAt} : null;
}
export async function readCuratedOfficeBlurb(title: string, divisionOcdId: string | null, options: PromotedCivicDataReadOptions = {}) {
  const legacy=blurbForTitle(title,divisionOcdId), key=officeTypeForTitle(title,divisionOcdId), jurisdiction=jurisdictionFromOcdId(divisionOcdId);
  if(!key || !jurisdiction || !divisionOcdId)return legacy;
  const stateOcd=`ocd-division/country:us/${jurisdiction.prefix}:${jurisdiction.slug}`;
  const records=await readTranslations([stateOcd,divisionOcdId],options);
  const specific=textTranslationFor(records,{kind:"OFFICE",subjectId:`office:${jurisdiction.usps}:${key}:division:${divisionOcdId}`,ocdId:divisionOcdId});
  const general=textTranslationFor(records,{kind:"OFFICE",subjectId:`office:${jurisdiction.usps}:${key}`,ocdId:stateOcd});
  const held=originalDefinition(specific ?? general);
  return held ? {text:held.text,basis:held.basis,basisUrl:held.basisUrl} : legacy;
}

/** One scoped translation read supplies a whole ballot; async cards receive
 * the selected value and never reopen a store outside the page's edge. */
export async function readCuratedContestOfficeBlurbs(contests: readonly { id: string; title: string; ocdId: string }[], options: PromotedCivicDataReadOptions = {}) {
  const scopes=contests.flatMap(contest=>{
    const jurisdiction=jurisdictionFromOcdId(contest.ocdId);
    return jurisdiction ? [`ocd-division/country:us/${jurisdiction.prefix}:${jurisdiction.slug}`,contest.ocdId] : [];
  });
  const records=await readTranslations(scopes,options);
  return new Map(contests.map(contest=>{
    const legacy=blurbForTitle(contest.title,contest.ocdId),jurisdiction=jurisdictionFromOcdId(contest.ocdId),key=officeTypeForTitle(contest.title,contest.ocdId);
    if(!jurisdiction || !key)return [contest.id,legacy] as const;
    const stateOcd=`ocd-division/country:us/${jurisdiction.prefix}:${jurisdiction.slug}`;
    const specific=textTranslationFor(records,{kind:"OFFICE",subjectId:`office:${jurisdiction.usps}:${key}:division:${contest.ocdId}`,ocdId:contest.ocdId});
    const general=textTranslationFor(records,{kind:"OFFICE",subjectId:`office:${jurisdiction.usps}:${key}`,ocdId:stateOcd});
    const held=originalDefinition(specific ?? general);
    return [contest.id,held ? {text:held.text,basis:held.basis,basisUrl:held.basisUrl} : legacy] as const;
  }));
}
