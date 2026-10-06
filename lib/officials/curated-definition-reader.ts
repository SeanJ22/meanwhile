import { formFor } from "./body-form.ts";
import { definitionsForBody } from "./body-definitions.ts";
import { blurbForTitle, officeTypeForTitle, blurbForContestTitle, officeTypeForContestTitle } from "./office-blurbs.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { readTranslations } from "../translate/publication.ts";
import { textTranslationFor } from "../translate/reader.ts";
import type { TextTranslation } from "../translate/records.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
function originalDefinition(record: TextTranslation | null) {
  const citation=record?.curatedOrigin?.citation;
  return record ? citation ? {text:record.text,basis:citation.basis,basisUrl:citation.url,readOn:citation.readOn ?? ""}
    : {text:record.text,basis:record.label,basisUrl:record.sourceUrl,readOn:record.retrievedAt} : null;
}
/** Same layering/body-identity rules, same original text and citations. The
 * retained static selector is the way back until River checks the replacement. */
export async function readCuratedBodyDefinitions(input: Parameters<typeof definitionsForBody>[0], options: PromotedCivicDataReadOptions = {}) {
  const legacy=definitionsForBody(input), jurisdiction=jurisdictionFromOcdId(input.ocdId);
  if(!input.ocdId || !jurisdiction)return legacy;
  const stateOcd=`ocd-division/country:us/${jurisdiction.prefix}:${jurisdiction.slug}`;
  const records=await readTranslations([stateOcd,input.ocdId],options);
  const classRecord=legacy.classKey ? textTranslationFor(records,{kind:"BODY_CLASS",subjectId:`body_class:${jurisdiction.usps}:${legacy.classKey}`,ocdId:stateOcd}) : null;
  const bodyRecord=textTranslationFor(records,{kind:"BODY",subjectId:`body:${input.bodyId}`,ocdId:input.ocdId});
  const formKey=formFor(input).formKey;
  const formRecord=formKey ? textTranslationFor(records,{kind:"BODY_CLASS",subjectId:`body_class:${jurisdiction.usps}:form:${formKey}`,ocdId:stateOcd}) : null;
  // A division/body-specific explanation keeps its precedence over a shared
  // form definition. Migrate that form layer only where it was the old value.
  const formValue=formRecord?.curatedOrigin && formRecord.text===legacy.formDefinition?.text ? originalDefinition(formRecord) : null;
  return {...legacy,classDefinition:originalDefinition(classRecord) ?? legacy.classDefinition,
    formDefinition:originalDefinition(bodyRecord) ?? formValue ?? legacy.formDefinition};
}
export async function readCuratedOfficeBlurb(title: string, divisionOcdId: string | null, options: PromotedCivicDataReadOptions = {}) {
  const legacy=blurbForTitle(title,divisionOcdId), key=officeTypeForTitle(title), jurisdiction=jurisdictionFromOcdId(divisionOcdId);
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
    const legacy=blurbForContestTitle(contest.title,contest.ocdId),jurisdiction=jurisdictionFromOcdId(contest.ocdId),key=officeTypeForContestTitle(contest.title);
    if(!jurisdiction || !key)return [contest.id,legacy] as const;
    const stateOcd=`ocd-division/country:us/${jurisdiction.prefix}:${jurisdiction.slug}`;
    const specific=textTranslationFor(records,{kind:"OFFICE",subjectId:`office:${jurisdiction.usps}:${key}:division:${contest.ocdId}`,ocdId:contest.ocdId});
    const general=textTranslationFor(records,{kind:"OFFICE",subjectId:`office:${jurisdiction.usps}:${key}`,ocdId:stateOcd});
    const held=originalDefinition(specific ?? general);
    return [contest.id,held ? {text:held.text,basis:held.basis,basisUrl:held.basisUrl} : legacy] as const;
  }));
}
