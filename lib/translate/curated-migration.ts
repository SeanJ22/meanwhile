import { readFileSync } from "node:fs";
import { CLASS_DEFINITIONS, DEPENDENT_SCHOOL_DEFINITION, UNCLASSIFIED_SCHOOL_DEFINITION, definitionsForBody } from "../officials/body-definitions.ts";
import { FORM_DEFINITIONS } from "../officials/form-definitions.ts";
import { BODY_BLURBS, DIVISION_BODY_BLURBS } from "../officials/body-description.ts";
import { OFFICE_BLURBS, STATE_OFFICE_BLURBS, DIVISION_OFFICE_BLURBS } from "../officials/office-blurbs.ts";
import { NOTICE_SUMMARIES } from "../meetings/notice-summary.ts";
import { MINUTES_SUMMARIES } from "../meetings/minutes-summaries.ts";
import { MEASURE_RECORD_FIRST_SEED } from "../ballot/measure-records.ts";
import { US_JURISDICTIONS } from "../coverage/states.ts";
import { translationHash, type PreservedCuratedText, type TextTranslation } from "./records.ts";
import { runHeldTextTranslations } from "./standing.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";

export interface CuratedDefinitionEntry {
  readonly key: string; readonly kind: "BODY_CLASS" | "BODY" | "OFFICE";
  readonly subjectId: string; readonly ocdId: string; readonly preservedText: PreservedCuratedText;
}
function preserve(file: string, key: string, text: string, citation: PreservedCuratedText["origin"]["citation"]): PreservedCuratedText {
  return { text, origin: { kind: "CURATED_MIGRATION", file, fileHash: translationHash(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")),
    recordKey: key, textHash: translationHash(text), citation } };
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Inventory of existing text only. The leased caller selects the entries and
 * holds their actual sources; this function starts no work or model call. */
export function curatedDefinitionEntries(state: string, bodies: readonly Parameters<typeof definitionsForBody>[0][] = []): CuratedDefinitionEntry[] {
  const jurisdiction = US_JURISDICTIONS.find(row => row.usps === state.toUpperCase());
  if (!jurisdiction) throw new Error("Curated migration requires a registered jurisdiction.");
  const lower = jurisdiction.slug, stateOcd = `ocd-division/country:us/${jurisdiction.prefix}:${lower}`;
  const entries: CuratedDefinitionEntry[] = [];
  const add = (kind: CuratedDefinitionEntry["kind"], key: string, subjectId: string, ocdId: string, file: string,
    definition: { text: string; basis: string; basisUrl: string | null; readOn?: string }) => {
    entries.push({ kind, key, subjectId, ocdId, preservedText: preserve(file,key,definition.text,
      { basis: definition.basis, url: definition.basisUrl, readOn: definition.readOn ?? null }) });
  };
  for (const row of CLASS_DEFINITIONS.filter(row => row.state === lower || row.state === null)) {
    add("BODY_CLASS",`class:${row.state ?? "national"}:${row.classKey}`,`body_class:${jurisdiction.usps}:${row.classKey}`,stateOcd,
      "lib/officials/body-definitions.ts",row.definition);
  }
  for (const [key,definition] of [["school_district_dependent",DEPENDENT_SCHOOL_DEFINITION],["school_district_unclassified",UNCLASSIFIED_SCHOOL_DEFINITION]] as const)
    add("BODY_CLASS",`class:national:${key}`,`body_class:${jurisdiction.usps}:${key}`,stateOcd,"lib/officials/body-definitions.ts",definition);
  for (const row of FORM_DEFINITIONS.filter(row => row.formKey.startsWith(`${lower}:`)))
    add("BODY_CLASS",`form:${row.formKey}`,`body_class:${jurisdiction.usps}:form:${row.formKey}`,stateOcd,"lib/officials/form-definitions.ts",row.definition);
  for (const [key,definition] of Object.entries(OFFICE_BLURBS)) {
    const overridden = STATE_OFFICE_BLURBS.find(row => row.state === lower && row.officeType === key)?.blurb;
    add("OFFICE",`office:${lower}:${key}`,`office:${jurisdiction.usps}:${key}`,stateOcd,"lib/officials/office-blurbs.ts",overridden ?? definition);
  }
  for (const row of DIVISION_OFFICE_BLURBS.filter(row => row.divisionOcdId.startsWith(`${stateOcd}/`)))
    add("OFFICE",`office:${row.divisionOcdId}:${row.officeType}`,`office:${jurisdiction.usps}:${row.officeType}:division:${row.divisionOcdId}`,row.divisionOcdId,"lib/officials/office-blurbs.ts",row.blurb);
  for (const body of bodies) {
    if (!body.ocdId?.startsWith(`${stateOcd}/`) && body.ocdId !== stateOcd) continue;
    const definition = definitionsForBody(body).formDefinition;
    if (!definition) continue;
    // Only an original curated value is a migration. Fresh runtime legal facts
    // continue through the ordinary writer; no fabricated legacy provenance.
    const bodyRow = [...BODY_BLURBS.map(row=>row.blurb),...DIVISION_BODY_BLURBS.map(row=>row.blurb)].find(row=>equal(row,definition));
    const formRow = FORM_DEFINITIONS.find(row=>equal(row.definition,definition));
    if (bodyRow) add("BODY",`body:${body.bodyId}`,`body:${body.bodyId}`,body.ocdId!,"data/states/az/reference/body-blurbs.json",bodyRow);
    else if (formRow) continue; // The shared form definition is already inventoried.
  }
  if (new Set(entries.map(row=>`${row.ocdId}:${row.subjectId}`)).size !== entries.length) throw new Error("Curated definitions repeat an exact subject.");
  return entries;
}

/** Existing notice/minutes text joins only an actual held sitting/document.
 * Its original unknown timestamp/hash stays unknown in the origin metadata. */
export function curatedMeetingEntries(input: {
  readonly meetings: readonly { id: string; bodyId: string; ocdId: string }[];
  readonly documents: readonly { kind: "AGENDA" | "MINUTES"; meetingId: string; bodyId: string; ocdId: string; url: string; hash: string; label: string }[];
}) {
  const entries: { subject: { kind: "AGENDA" | "MINUTES"; subjectId: string; label: string; state: string; ocdId: string; meeting: NonNullable<TextTranslation["meeting"]> };
    sourceUrl: string; preservedText: PreservedCuratedText }[] = [];
  for (const doc of input.documents) {
    const meeting=input.meetings.find(row=>row.id===doc.meetingId && row.bodyId===doc.bodyId && row.ocdId===doc.ocdId);
    const state=US_JURISDICTIONS.find(row=>doc.ocdId===`ocd-division/country:us/${row.prefix}:${row.slug}` || doc.ocdId.startsWith(`ocd-division/country:us/${row.prefix}:${row.slug}/`))?.usps;
    if (!meeting || !state || !/^[a-f0-9]{64}$/.test(doc.hash)) continue;
    const notice=doc.kind==="AGENDA" ? NOTICE_SUMMARIES.find(row=>row.meetingId===doc.meetingId && row.summarizesUrl===doc.url && row.contentHash===doc.hash) : null;
    const minutes=doc.kind==="MINUTES" ? MINUTES_SUMMARIES.find(row=>row.meetingId===doc.meetingId && row.minutesUrl===doc.url) : null;
    if (!notice && !minutes) continue;
    const preservedText=notice ? preserve("data/states/az/meetings/notice-summaries.json",`notice:${notice.meetingId}:${notice.contentHash}`,notice.summary,
      {basis:"Meeting notice",url:notice.summarizesUrl,readOn:notice.writtenAt}) : preserve("lib/meetings/minutes-summaries.ts",`minutes:${minutes!.meetingId}`,minutes!.summary,
      {basis:minutes!.sourceOrg,url:minutes!.minutesUrl,readOn:minutes!.readAt});
    entries.push({subject:{kind:doc.kind,subjectId:`${doc.kind.toLowerCase()}:${doc.meetingId}`,label:doc.label,state,ocdId:doc.ocdId,
      meeting:{id:doc.meetingId,bodyId:doc.bodyId,documentUrl:doc.url,documentHash:doc.hash}},sourceUrl:doc.url,preservedText});
  }
  return entries;
}

/** Immutable reaction subjects are retained while official numbering is owed.
 * This inventory neither assigns numbers nor asserts a model checked them. */
export function curatedMeasureMigrationInventory() {
  return MEASURE_RECORD_FIRST_SEED.map(row=>({contestId:row.contestId,original:row,
    preservedReactionIds:row.parts.map(part=>part.id),unknownNumberIds:row.parts.filter(part=>part.number===null).map(part=>part.id),
    fileHash:translationHash(readFileSync(new URL("../../data/ballot/measure-records-first-seed.json",import.meta.url),"utf8"))}));
}

/** Normal durable attempts, source admission, two guarded model calls and
 * scoped Slide/typed readback; selected entries do not get a separate clock. */
export function runCuratedDefinitionMigrations(input: Omit<Parameters<typeof runHeldTextTranslations>[0],"subjects"> & {
  readonly entries: readonly CuratedDefinitionEntry[];
  readonly bindings: readonly { key: string; label: string; sourceUrl: string }[];
}) {
  const subjects=input.entries.flatMap(entry=>{
    const bindings=input.bindings.filter(row=>row.key===entry.key);
    if(bindings.length!==1 || entry.preservedText.origin.citation.url!==null && bindings[0].sourceUrl!==entry.preservedText.origin.citation.url) return [];
    const binding=bindings[0], state=US_JURISDICTIONS.find(row=>entry.ocdId===`ocd-division/country:us/${row.prefix}:${row.slug}` || entry.ocdId.startsWith(`ocd-division/country:us/${row.prefix}:${row.slug}/`))?.usps;
    if(!state)return [];
    return [{subject:{kind:entry.kind,subjectId:entry.subjectId,label:binding.label,state,ocdId:entry.ocdId},sourceUrl:binding.sourceUrl,preservedText:entry.preservedText}];
  });
  return runHeldTextTranslations({...input,subjects});
}
export function runCuratedMeetingMigrations(input: Omit<Parameters<typeof runHeldTextTranslations>[0],"subjects"> & Parameters<typeof curatedMeetingEntries>[0]) {
  // Exact capture bytes must be the held document revision, before admission or
  // spending. In particular a notice whose body changed cannot be reattached.
  const subjects=curatedMeetingEntries(input).filter(entry=>input.captures.some((capture: WorkerPublicationCapture)=>
    capture.evidence.canonicalUrl===entry.sourceUrl && (capture.evidence.sourceDocument?.contentHash ?? capture.evidence.contentHash)===`sha256-${entry.subject.meeting.documentHash}`));
  return runHeldTextTranslations({...input,subjects});
}
