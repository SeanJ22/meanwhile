import { DATASET_FAMILIES } from "../../holdings/datasets.ts";
import { HOLDING_FAMILY_DISPOSITIONS } from "../../civic-data/non-routine-dispositions.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../../civic-data/manual-contracts.ts";
import type { PublicationStatusRead } from "../../civic-data/publication-status.ts";
import { CHECKLIST_PROFILE, evaluateChecklistSnapshot, type ChecklistSnapshot } from "./checklist-score.ts";

/** Declared relationships are supporting paths, never requirement PASS claims.
 * Fine-grained field/object/period evidence is evaluated only by checklist-score. */
const FAMILY_GROUPS: Readonly<Record<string,readonly string[]>> = {
  "body-rosters":["GOV","OFF","REF"],"statewide-executives":["OFF","EXE"],"curated-body-identities":["GOV","REF"],"tribal-nation-identities":["GEO","REF"],
  "comment-access":["PAR"],"area-facts":["REF"],"ballot-navigation":["ELE"],"minutes-summaries":["DOC"],"venue-records":["MTG"],"campaign-sites":["CAN"],
  "everyday-routing":["PAR","ASK"],"sourced-definitions":["REF"],"body-compositions":["REF","OFF"],"measure-summaries":["ELE"],"notice-summaries":["DOC"],
  "state-money":["CAM"],"identity":["OFF","CAN"],"ballot":["ELE","CAN"],"candidate-corpus":["CAN"],"candidate-acquisitions":["CAN","ACQ"],
  "local-finance":["CAM"],"campaign-finance-corpus":["CAM","ACQ"],"meetings":["MTG","DOC"],"federal-finance":["CAM"],"statement-corpus":["OFF","ASK"],
  "congress":["OFF"],"registry":["GEO","GOV","OFF"],"votes":["LEG"],"voting-sites":["ELE"],"geography":["GEO"],"jurisdictions":["GOV","ACQ"],
  "reference":["REF"],"asset-index":["ACQ","PUB"],"dotgov":["REF"],"nh-legislative-members":["OFF","CAN"],"hunt":["ACQ","REC"],
  "state-officeholders":["LEG","OFF"],"official-actions":["EXE"],"outcomes":["DOC","LEG"],"questionnaire":["CAN"],"portraits":["CAN","OFF"],"prl":["PRL"],
};

const FAMILY_CLASSES: Readonly<Record<string,readonly string[]>> = {
  "body-rosters":["REGISTRY_RUNTIME_BINDING"],"statewide-executives":["REGISTRY_RUNTIME_BINDING"],"comment-access":["CURATED_READER_RECORD"],
  "ballot-navigation":["CURATED_READER_RECORD"],"minutes-summaries":["MEETING_OUTCOME"],"venue-records":["CURATED_READER_RECORD"],"campaign-sites":["CURATED_READER_RECORD"],
  "everyday-routing":["CURATED_READER_RECORD"],"measure-summaries":["BALLOT_CANDIDACY"],"notice-summaries":["MEETING_OUTCOME"],"state-money":["STATE_CAMPAIGN_FINANCE"],
  "identity":["REGISTRY_RUNTIME_BINDING","BALLOT_CANDIDACY"],"ballot":["BALLOT_CANDIDACY","BALLOT_FILING"],"candidate-corpus":["CANDIDATE_PUBLICATION"],
  "candidate-acquisitions":["CANDIDATE_PROFILE","BALLOT_FILING"],"local-finance":["LOCAL_CAMPAIGN_FINANCE"],"campaign-finance-corpus":["STATE_CAMPAIGN_FINANCE","LOCAL_CAMPAIGN_FINANCE"],
  "meetings":["MEETING"],"federal-finance":["FEC_FUNDING"],"statement-corpus":["OFFICEHOLDER_STATEMENT"],"congress":["FEDERAL_DIRECTORY"],"registry":["REGISTRY_RUNTIME_BINDING"],
  "votes":["STATE_ROLL_CALL","STATE_LEGISLATOR_VOTES","FEDERAL_ROLL_CALL","FEDERAL_KEY_VOTE"],"voting-sites":["VOTING_SITE"],"jurisdictions":["OPERATIONAL_REFERENCE"],
  "reference":["CENSUS_REFERENCE","OPERATIONAL_REFERENCE"],"dotgov":["DOTGOV_REFERENCE"],"nh-legislative-members":["STATE_LEGISLATOR"],"official-actions":["STATE_EXECUTIVE_ACTION"],
  "outcomes":["MEETING_OUTCOME"],"prl":["PRL_PROFILE"],
};
const EXACT_CONTRACTS: Readonly<Record<string,readonly string[]>> = {
  "comment-access":["comment-access"],"ballot-navigation":["ballot-navigation"],"venue-records":["venue-resolutions"],"campaign-sites":["campaign-sites"],"everyday-routing":["everyday-routing"],
};

export function checklistConnectionIssues(): string[] {
  const declared=new Set(DATASET_FAMILIES.map(f=>f.id));
  return [...DATASET_FAMILIES.filter(f=>!FAMILY_GROUPS[f.id]).map(f=>`No checklist relationship for dataset ${f.id}`),
    ...Object.keys(FAMILY_GROUPS).filter(id=>!declared.has(id)).map(id=>`Unknown dataset ${id}`),
    ...DATASET_FAMILIES.filter(f=>!HOLDING_FAMILY_DISPOSITIONS.some(d=>d.familyId===f.id)).map(f=>`No lifecycle disposition for ${f.id}`)];
}

export function checklistConnections(input: {
  readonly publication: PublicationStatusRead;
  /** Only an exact scoped census with clause-level receipts can provide a score. */
  readonly assessment?: ChecklistSnapshot | null;
}) {
  const contracts=input.publication.kind==="HELD"?input.publication.view.contracts:[];
  const families=DATASET_FAMILIES.map(family=>{
    const exact=EXACT_CONTRACTS[family.id];
    const related=contracts.filter(c=>exact?exact.includes(c.contractId):(FAMILY_CLASSES[family.id]??[]).includes(c.recordClass));
    return {id:family.id,groups:FAMILY_GROUPS[family.id]??[],surfaces:family.surfaces,consumerPaths:family.consumerPaths,relationship:family.relationship,
      classification:HOLDING_FAMILY_DISPOSITIONS.find(d=>d.familyId===family.id)?.classification??null,
      declaredRecordClasses:FAMILY_CLASSES[family.id]??[],contracts:related,
      observation:input.publication.kind!=="HELD"?"UNREAD" as const:related.length?"CONTRACT_EVIDENCE" as const:family.surfaces.length?"NO_MATCHED_RUNTIME_CONTRACT" as const:"SUPPORTING_OR_HISTORICAL" as const};
  });
  return {profile:CHECKLIST_PROFILE.version,asOf:input.publication.kind==="HELD"?input.publication.asOf:null,
    readFailure:input.publication.kind==="HELD"?null:input.publication.detail,
    assessment:input.assessment?evaluateChecklistSnapshot(input.assessment):null,
    assessmentGap:input.assessment?null:"The full object, jurisdiction and period census has not yet been connected to clause-level receipts. Contract publication below supports investigation; it does not establish checklist completion or a ZIP coverage percentage.",
    definitions:CHECKLIST_PROFILE.definitions.map(definition=>({...definition,familyIds:families.filter(f=>f.groups.includes(definition.group)).map(f=>f.id)})),
    families,manualContracts:MANUAL_PRODUCTION_SOURCE_CONTRACTS.map(c=>({id:c.id,recordClass:c.recordClass,scope:c.scope,execution:c.execution,consumers:c.readerProjection.consumers,
      publication:contracts.find(row=>row.contractId===c.id)??null})),issues:checklistConnectionIssues()};
}
