import type { ReadOnlyQuery } from "../../control-plane/admin-view/promoted-slices.ts";
import { PRL_CONTRACT } from "./data-plane.ts";
import { PRL_ARCHIVE_SCOPE } from "./archive-publication.ts";
import { prlReceiptMetadataViolations,type PrlReceiptMetadata } from "./receipt.ts";
import { authorityFor } from "../../civic-data/source-authority.ts";
import type { PrlMemberProfile,PrlSnapshot } from "./types.ts";
import { PRL_RHETORIC_ATTRIBUTION } from "./types.ts";
import type { PrlPersonKeys } from "./reader.ts";

export type PrlPersonDataset=PrlReceiptMetadata&{readonly profiles:readonly unknown[]|null};
export interface PrlPersonProjection {readonly datasets:Readonly<Record<string,PrlPersonDataset>>}
const pointer=`SELECT p.key,p.current_version_id,
  (p.source_id='prl' AND p.current_version_id=p.last_known_good_version_id AND c.id=p.current_version_id
   AND c.source_id=p.source_id AND c.record_class=p.record_class AND c.scope=p.scope AND c.state='PROMOTED' AND c.acquisition_succeeded
   AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id AND c.candidate#>'{normalization,succeeded}'='true'::jsonb
   AND c.normalized_hash ~ '^[a-f0-9]{64}$' AND c.candidate#>>'{normalization,normalizedHash}'=c.normalized_hash
   AND (p.current_version_id=c.id AND p.payload_fingerprint IS NOT DISTINCT FROM c.read_model_fingerprint) AND p.validation_receipt=c.validation_receipt AND p.validation_receipt->>'decision'='GOOD'
   AND reader_payload_value(reader_payload_node(p.payload)->'formatVersion')='1'::jsonb
   AND p.validation_receipt->>'candidateId'=c.id AND p.validation_receipt->>'sourceId'=c.source_id
   AND p.validation_receipt->>'recordClass'=p.record_class AND p.validation_receipt->>'scope'=p.scope) AS valid
  FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id WHERE p.record_class=$1 AND p.scope=$2`;
function requirePointer(row:Record<string,unknown>):void {if(row.valid!==true)throw Error("PRL_PERSON_PUBLISHED_POINTER_INVALID");}

export async function readKeyedPrlProfile(query:ReadOnlyQuery,bioguideId:string):Promise<{
  profile:PrlMemberProfile;metadata:Pick<PrlSnapshot,"fetchedAt"|"sourceUrl"|"attribution">;
}|null> {
  const [[row]]=await query([{text:`WITH pointer AS MATERIALIZED (${pointer}), selected AS (
    SELECT r.collection,r.ordinal,r.value FROM pointer p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.current_version_id
    WHERE p.valid AND (r.collection='prl.snapshot' AND r.row_id='metadata' OR r.collection='prl.profiles' AND r.row_id=$3)
  ) SELECT p.valid,(SELECT reader_payload_value(value) FROM selected WHERE collection='prl.snapshot' LIMIT 1) AS metadata,
    coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal) FROM selected WHERE collection='prl.profiles'),'[]'::jsonb) AS profiles FROM pointer p`,
    params:[PRL_CONTRACT.recordClass,PRL_CONTRACT.scope,bioguideId]}]);
  if(!row)return null;requirePointer(row);
  const metadata=row.metadata as Pick<PrlSnapshot,"formatVersion"|"fetchedAt"|"sourceUrl"|"attribution">&{profileShape?:string;rosterMissesShape?:string};
  if(!metadata||metadata.formatVersion!==1||metadata.profileShape!=="array"||metadata.rosterMissesShape!=="array"||
    metadata.sourceUrl!=="https://americaspoliticalpulse.com/data/elite/profiles-all-national.zip"||
    metadata.attribution?.citation!==PRL_RHETORIC_ATTRIBUTION.citation||!Number.isFinite(Date.parse(metadata.fetchedAt)))throw Error("PRL_PERSON_PROFILE_METADATA_INVALID");
  const profiles=row.profiles as PrlMemberProfile[];
  if(profiles.length>1)throw Error(`Ambiguous normalized PRL identity ${bioguideId}`);
  if(profiles[0]&&profiles[0].bioguideId!==bioguideId)throw Error("PRL_PERSON_PROFILE_IDENTITY_INVALID");
  return profiles[0]?{profile:profiles[0],metadata}:null;
}

export async function readKeyedPrlPerson(query:ReadOnlyQuery,keys:PrlPersonKeys):Promise<PrlPersonProjection|null> {
  const datasets=[...(keys.bioguideId?["statements-national","press-releases","newsletters","floor-speeches"]:[]),
    ...(keys.openstatesId?["profiles-state","state-rhetoric"]:[]),...(keys.candidateId?["primary-rhetoric"]:[])];
  if(!datasets.length)return null;
  const [[row]]=await query([{text:`WITH pointer AS MATERIALIZED (${pointer}), selected AS (
    SELECT r.collection,r.row_id,r.ordinal,r.value FROM pointer p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.current_version_id
    WHERE p.valid AND (r.collection='prl.datasets' AND r.row_id=ANY($3::text[])
      OR r.collection='prl.profiles:profiles-state' AND r.row_id=$4
      OR r.collection='prl.profiles:primary-rhetoric' AND r.row_id=$5)
  ) SELECT p.valid,coalesce((SELECT jsonb_object_agg(row_id,reader_payload_value(value)) FROM selected WHERE collection='prl.datasets'),'{}'::jsonb) AS datasets,
    coalesce((SELECT jsonb_agg(jsonb_build_object('datasetId',substring(collection FROM length('prl.profiles:')+1),
      'value',reader_payload_value(value)) ORDER BY ordinal) FROM selected WHERE collection<>'prl.datasets'),'[]'::jsonb) AS profiles FROM pointer p`,
    params:["PRL_ARCHIVE",PRL_ARCHIVE_SCOPE,datasets,keys.openstatesId??null,keys.candidateId??null]}]);
  if(!row)return null;requirePointer(row);
  const selected:Record<string,PrlPersonDataset>={};
  const profiles=row.profiles as {datasetId:string;value:unknown}[];
  for(const [id,raw]of Object.entries(row.datasets as Record<string,PrlReceiptMetadata&{profileShape:string}>)){
    const {profileShape,...metadata}=raw;
    if(prlReceiptMetadataViolations(metadata).length||metadata.datasetId!==id||!["array","null"].includes(profileShape)||
      !authorityFor("prl","PRL_ARCHIVE",metadata.sourceFinalUrl??metadata.sourceUrl).ok||
      metadata.target==="archive"&&(!metadata.objectRoot?.startsWith(`${id}/${metadata.sourceSha256}/`)||
        !Number.isInteger(metadata.subjectCount)||!metadata.subjectCount))throw Error("PRL_PERSON_DATASET_METADATA_INVALID");
    const values=profiles.filter(profile=>profile.datasetId===id).map(profile=>profile.value);
    selected[id]={...metadata,profiles:profileShape==="array"?values:null};
  }
  return {datasets:selected};
}
