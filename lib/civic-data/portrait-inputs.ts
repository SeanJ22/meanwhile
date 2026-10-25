import type { Officeholder } from "../officials/types.ts";
import { portraitBindingMatches } from "../photos/binding.ts";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "./contracts.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "./manual-contracts.ts";
import { personIdentityKeys, PERSON_ID_NAMESPACES } from "../officials/people-identity.ts";

export function portraitInputKeys(jurisdiction:string):string[] {
  return [...new Set([...ROUTINE_SOURCE_CONTRACTS,...MANUAL_PRODUCTION_SOURCE_CONTRACTS]
    .filter(row=>row.sourceId!=="people-portraits" && (jurisdiction!=="US"||row.sourceId==="statewide-executive-sources") && ["STATE_LEGISLATOR","FEDERAL_DIRECTORY"].includes(row.recordClass)
      && (row.scope===jurisdiction||row.scope.startsWith(jurisdiction+":")))
    .map(row=>row.recordClass+":"+row.scope).concat("STATE_LEGISLATOR:"+jurisdiction+":people:portraits:v1",
      "REGISTRY_RUNTIME_BINDING:"+jurisdiction+":reader-registry-runtime"))];
}

export interface PortraitPersonRow {
  readonly scope: string;
  readonly person: Officeholder;
  readonly heldPhoto?: Officeholder["photo"];
}

export function localPortraitPerson(member:Officeholder,roster:{sourceUrl:string;sourceOrg:string;collectedAt:string},state:string):Officeholder {
  return {...member,personId:member.personId ?? member.id,level:"LOCAL",state:state.toUpperCase(),
    termStart:member.termStart ?? "",termEnd:member.termEnd ?? "",birthDate:null,partyLabel:null,
    profileUrls:[...new Set([member.websiteUrl,roster.sourceUrl].filter((url):url is string=>Boolean(url)))],
    contactFormUrl:null,campaignUrl:null,photo:null,social:{},
    provenance:{sourceUrl:roster.sourceUrl,sourceOrg:roster.sourceOrg,collectedAt:roster.collectedAt,verifiedAt:null}};
}

/** These are the source facts the portrait holding keeps, not contacts or a state's payload. */
export function portraitPersonInput(person: Officeholder) {
  return {id:person.id,personId:person.personId ?? person.id,nativeIds:person.nativeIds ?? {},name:person.name,
    officeTitle:person.officeTitle,level:person.level,state:person.state ?? null,chamber:person.chamber ?? null,
    provenance:{sourceUrl:person.provenance.sourceUrl,sourceOrg:person.provenance.sourceOrg,collectedAt:person.provenance.collectedAt,verifiedAt:person.provenance.verifiedAt ?? null},portraitCandidate:person.portraitCandidate ?? null,profileUrls:[...new Set([person.websiteUrl,...person.profileUrls ?? []].filter(Boolean))].sort()};
}

export function portraitPersonOwed(person: Officeholder, held: Officeholder | undefined, at: string): boolean {
  const photo=person.photo ?? held?.photo;
  if(!portraitBindingMatches(person.personId ?? person.id,photo ?? {url:""}))return true;
  // The combined standing job has always refreshed its retained roster every seven days.
  const everyMs=7*86_400_000;
  if(Date.parse(at)-Date.parse(photo!.verification!.checkedAt)>=everyMs)return true;
  if(!held)return true;
  const current=portraitPersonInput(person), prior=portraitPersonInput(held);
  // A profile learned during a portrait acquisition is complementary to source URLs.
  if(current.profileUrls.some(url=>!prior.profileUrls.includes(url)))return true;
  if(Object.entries(current.nativeIds).some(([key,ids])=>key!=="reader" && ids.some(id=>!prior.nativeIds[key]?.includes(id))))return true;
  if(current.portraitCandidate && canonicalCivicDataHash(current.portraitCandidate)!==canonicalCivicDataHash(prior.portraitCandidate))return true;
  if(current.provenance.sourceUrl!==prior.provenance.sourceUrl)return false;
  const owned=(row:typeof current)=>({name:row.name,officeTitle:row.officeTitle,level:row.level,state:row.state,chamber:row.chamber,provenance:row.provenance});
  return canonicalCivicDataHash(owned(current))!==canonicalCivicDataHash(owned(prior));
}

export function selectPortraitPeople(rows:readonly PortraitPersonRow[],held:readonly Officeholder[],at:string):PortraitPersonRow[] {
  const prior=new Map<string,Officeholder|null>();
  for(const person of held)for(const key of personIdentityKeys(person)){
    const existing=prior.get(key);prior.set(key,existing===undefined||existing?.personId===person.personId ? person : null);
  }
  const savedFor=(person:Officeholder)=>{
    const direct=prior.get(person.personId ?? person.id)??prior.get(person.id);if(direct)return direct;
    const matches=new Set([...personIdentityKeys(person)].flatMap(key=>prior.get(key) ? [prior.get(key)!] : []));
    return matches.size===1 ? [...matches][0] : undefined;
  };
  const aligned=rows.map(row=>{const saved=savedFor(row.person),personId=saved?.personId ?? saved?.id ?? row.person.personId ?? row.person.id;
    const fromSource=portraitBindingMatches(personId,row.person.photo ?? {url:""});
    const photo=fromSource ? row.person.photo : saved?.photo ?? row.person.photo;
    return {...row,person:{...row.person,personId,photo,fieldSources:{...row.person.fieldSources,
      ...!fromSource && saved?.fieldSources?.photo ? {photo:saved.fieldSources.photo} : {}}},saved};});
  const owed=new Set(aligned.filter(row=>portraitPersonOwed(row.person,row.saved,at))
    .map(row=>row.person.personId ?? row.person.id));
  return aligned.filter(row=>owed.has(row.person.personId ?? row.person.id)).map(row=>{
    const saved=row.saved;
    return {...row,person:{...row.person,photo:row.person.photo ?? saved?.photo ?? null,
      fieldSources:{...row.person.fieldSources,...!row.person.photo && saved?.fieldSources?.photo ? {photo:saved.fieldSources.photo} : {}}}};
  });
}

/** Resolve only a path/array's encoded nodes inside Postgres. Unrelated parts stay there. */
export const PORTRAIT_ARRAY_WALK = `walk(scope,kind,node,path,depth,parent,steps) AS (
  SELECT scope,kind,node,path,0,'{}'::jsonb,0 FROM roots
  UNION ALL
  SELECT w.scope,w.kind,n.node,w.path,n.depth,n.parent,w.steps+1 FROM walk w
  LEFT JOIN civic_data_payload_parts part ON part.hash=w.node->>'$civicPayloadPart'
  CROSS JOIN LATERAL (
    SELECT part.payload AS node,w.depth,w.parent WHERE w.node ? '$civicPayloadPart'
    UNION ALL SELECT w.node->'value',w.depth,w.parent WHERE w.node->>'kind'='object'
    UNION ALL SELECT g.value,w.depth,w.parent FROM jsonb_array_elements(
      CASE WHEN w.node->>'kind'='array' THEN w.node->'groups' ELSE '[]'::jsonb END) g
    UNION ALL SELECT e.value,w.depth+CASE WHEN w.path[w.depth+1]='*' THEN 1 ELSE 0 END,
      CASE WHEN w.path[w.depth+1]='*' THEN e.value ELSE w.parent END
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.node)='array' THEN w.node ELSE '[]'::jsonb END) e
    UNION ALL SELECT w.node->w.path[w.depth+1],w.depth+1,
      CASE WHEN w.depth>0 AND w.path[w.depth]='*' THEN w.node ELSE w.parent END
      WHERE w.depth<cardinality(w.path) AND w.path[w.depth+1]<>'*'
        AND jsonb_typeof(w.node)='object' AND NOT w.node ? '$civicPayloadPart' AND NOT w.node ? 'kind'
  ) n WHERE n.node IS NOT NULL AND n.node<>'null'::jsonb AND w.steps<64
)`;

/** A portrait row is already verified at publication; malformed/encoded checks are conservatively owed. */
export const PORTRAIT_PEOPLE_SQL = `WITH RECURSIVE roots AS (
  SELECT p.scope,CASE WHEN p.source_id='people-portraits' THEN 'held' ELSE 'person' END AS kind,
    p.payload AS node,ARRAY['roster','officeholders']::text[] AS path
  FROM civic_data_promotions p WHERE p.record_class IN ('STATE_LEGISLATOR','FEDERAL_DIRECTORY')
    AND (p.scope=$1 OR p.scope LIKE $1||':%')
    AND ($3::text[] IS NULL OR p.record_class||':'||p.scope=ANY($3::text[]))
  UNION ALL
  SELECT p.scope,'local',p.payload,ARRAY['bodyRosters','*','members']::text[]
  FROM civic_data_promotions p WHERE p.record_class='REGISTRY_RUNTIME_BINDING' AND p.scope=$1||':reader-registry-runtime'
  UNION ALL
  SELECT p.scope,'body',p.payload,ARRAY['registry','bodies']::text[] FROM civic_data_promotions p
    WHERE p.record_class='REGISTRY_RUNTIME_BINDING' AND p.scope=$1||':reader-registry-runtime'
), ${PORTRAIT_ARRAY_WALK}, normalized AS (
  SELECT scope,kind,CASE WHEN kind='local' THEN node || jsonb_build_object('level','LOCAL','state',substring($1 from 4),
    'personId',coalesce(node->>'personId',node->>'id'),'profileUrls',
      CASE WHEN node->>'websiteUrl' IS NULL THEN jsonb_build_array(parent->>'sourceUrl') ELSE jsonb_build_array(node->>'websiteUrl',parent->>'sourceUrl') END,
    'photo',null,'provenance',jsonb_build_object('sourceUrl',parent->'sourceUrl','sourceOrg',parent->'sourceOrg','collectedAt',parent->'collectedAt','verifiedAt',null)) ELSE node END AS node,parent
  FROM walk
  WHERE depth=cardinality(path) AND jsonb_typeof(node)='object' AND node ? 'id' AND kind<>'body'
  UNION ALL
  SELECT $1||':live-facts','person',jsonb_build_object(
    'id',coalesce(nullif((SELECT value FROM entity_external_id x WHERE x.entity_id=substr(m.field,8) AND x.scheme='roster-member' LIMIT 1),''),'roster:'||m.entity_id||'#'||substr(m.field,8)),
    'personId',substr(m.field,8),'name',coalesce(nullif(p.fields->'name','null'::jsonb),m.value->'name'),
    'officeTitle',coalesce(nullif(p.fields->'office','null'::jsonb),nullif(p.fields->('office:'||m.entity_id),'null'::jsonb),nullif(m.value->'office','null'::jsonb),'"Member"'::jsonb),
    'level','LOCAL','state',substring($1 from 4),'websiteUrl',p.fields->'website',
    'profileUrls',CASE WHEN p.fields->>'website' IS NULL THEN jsonb_build_array(s.url) ELSE jsonb_build_array(p.fields->>'website',s.url) END,
    'termStart','','termEnd','','birthDate',null,'partyLabel',null,'contactFormUrl',null,'phone',null,'email',null,'campaignUrl',null,'photo',null,'social','{}'::jsonb,
    'provenance',jsonb_build_object('sourceUrl',s.url,'sourceOrg',split_part(s.url,'/',3),
      'collectedAt',to_char(m.checked_at AT TIME ZONE 'UTC','YYYY-MM-DD'),'verifiedAt',null)),'{}'::jsonb
  FROM fact m JOIN entity b ON b.id=m.entity_id JOIN source_copy s ON s.id=m.source_copy_id
  LEFT JOIN LATERAL (SELECT jsonb_object_agg(f.field,f.value) AS fields FROM fact f
    WHERE f.entity_id=substr(m.field,8) AND f.status='live' AND (f.field IN ('name','website','office') OR f.field='office:'||m.entity_id)) p ON true
  WHERE $1<>'US' AND b.kind='body' AND (b.state=substring($1 from 4) OR b.id IN(SELECT node->>'id' FROM walk WHERE kind='body' AND depth=cardinality(path) AND node ? 'id')) AND m.status='live' AND m.field LIKE 'member:%'
), people AS (
  SELECT *,coalesce(node->>'personId',node->>'id') AS id FROM normalized
), identity_keys AS (
  SELECT scope,kind,id,node->>'id' AS key FROM people
  UNION ALL SELECT scope,kind,id,id FROM people
  UNION ALL SELECT p.scope,p.kind,p.id,k.key FROM people p
    LEFT JOIN civic_data_payload_parts part ON part.hash=p.node#>>'{nativeIds,$civicPayloadPart}'
    CROSS JOIN LATERAL (SELECT coalesce(part.payload->'value',p.node->'nativeIds') AS value) native
    CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(native.value)='object' THEN native.value ELSE '{}'::jsonb END) n
    CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(n.value)='array' THEN n.value ELSE '[]'::jsonb END) v
    CROSS JOIN LATERAL (SELECT '${JSON.stringify(PERSON_ID_NAMESPACES)}'::jsonb->>regexp_replace(lower(n.key),'[^a-z0-9]','','g') AS ns) c
    CROSS JOIN LATERAL (VALUES (CASE WHEN n.key='reader' THEN v.value ELSE n.key||':'||v.value END),
      (CASE WHEN c.ns IS NOT NULL THEN c.ns||':'||CASE WHEN c.ns='ocd-person' THEN regexp_replace(v.value,'^ocd-person/','') ELSE v.value END END),
      (CASE WHEN n.key='ocd-person' AND v.value LIKE 'ocd-person/%' THEN v.value END)) k(key)
    WHERE k.key IS NOT NULL
), held_identity AS (
  SELECT key,min(id) AS id FROM identity_keys WHERE kind='held' AND key IS NOT NULL GROUP BY key HAVING count(DISTINCT id)=1
), matches AS (
  SELECT p.scope,p.kind,p.id,min(h.id) AS person_key FROM identity_keys p JOIN held_identity h ON h.key=p.key
    GROUP BY p.scope,p.kind,p.id HAVING count(DISTINCT h.id)=1
), originals AS (
  SELECT * FROM people WHERE kind<>'held'
  UNION ALL SELECT h.* FROM people h WHERE h.kind='held' AND NOT EXISTS(SELECT 1 FROM people p WHERE p.kind<>'held' AND p.id=h.id)
), compared_refs AS (
  SELECT p.*,coalesce(h.id,p.id) AS person_key,h.node AS held,
    coalesce(nullif(p.node->'photo','null'::jsonb),h.node->'photo') AS photo_ref,h.node->'photo' AS held_photo_ref,
    coalesce(sp.payload->'value',p.node->'provenance') AS source_stamp,
    coalesce(hp.payload->'value',h.node->'provenance') AS held_stamp
  FROM originals p LEFT JOIN held_identity direct ON direct.key=p.id
  LEFT JOIN matches m ON m.scope=p.scope AND m.kind=p.kind AND m.id=p.id
  LEFT JOIN people h ON h.kind='held' AND h.id=coalesce(direct.id,m.person_key)
  LEFT JOIN civic_data_payload_parts sp ON sp.hash=p.node#>>'{provenance,$civicPayloadPart}'
  LEFT JOIN civic_data_payload_parts hp ON hp.hash=h.node#>>'{provenance,$civicPayloadPart}'
), photo_nodes AS (
  SELECT r.*,coalesce(part.payload->'value',photo_ref) AS photo_node,coalesce(hpart.payload->'value',held_photo_ref) AS held_photo_node FROM compared_refs r
  LEFT JOIN civic_data_payload_parts part ON part.hash=photo_ref->>'$civicPayloadPart'
  LEFT JOIN civic_data_payload_parts hpart ON hpart.hash=held_photo_ref->>'$civicPayloadPart'
), decoded_photos AS (
  SELECT r.*,CASE WHEN jsonb_typeof(photo_node)='object' THEN photo_node||jsonb_build_object(
    'verification',coalesce(part.payload->'value',photo_node->'verification')) ELSE photo_node END AS source_photo,
    CASE WHEN jsonb_typeof(held_photo_node)='object' THEN held_photo_node||jsonb_build_object(
    'verification',coalesce(hpart.payload->'value',held_photo_node->'verification')) ELSE held_photo_node END AS held_photo
  FROM photo_nodes r LEFT JOIN civic_data_payload_parts part ON part.hash=photo_node#>>'{verification,$civicPayloadPart}'
  LEFT JOIN civic_data_payload_parts hpart ON hpart.hash=held_photo_node#>>'{verification,$civicPayloadPart}'
), compared AS (
  SELECT *,CASE WHEN source_photo#>>'{verification,personId}'=person_key THEN source_photo ELSE coalesce(nullif(held_photo,'null'::jsonb),source_photo) END AS photo FROM decoded_photos
), owed AS (
  SELECT DISTINCT person_key FROM compared WHERE held IS NULL
    OR photo IS NULL OR photo='null'::jsonb OR photo ? '$civicPayloadPart'
    OR photo#>>'{verification,personId}' IS DISTINCT FROM person_key
    OR coalesce(photo#>>'{verification,imageHash}','') !~ '^sha256-[a-f0-9]{64}$'
    OR coalesce(photo#>>'{verification,sourceImageHash}','') !~ '^sha256-[a-f0-9]{64}$'
    OR coalesce(jsonb_typeof(photo#>'{verification,sources}'),'null')<>'array'
    OR photo#>'{verification,sources}'='[]'::jsonb
    OR photo#>'{verification,attribution}' IS NULL AND photo#>'{verification,license}' IS NULL
    OR photo->>'sourceUrl' IS DISTINCT FROM photo#>>'{verification,imageUrl}'
    OR photo->>'url' IS DISTINCT FROM '/api/portraits/officials/'||substring(photo#>>'{verification,imageHash}' from 8)||'.'||split_part(photo->>'url','.',2)
    OR NOT pg_input_is_valid(coalesce(photo#>>'{verification,checkedAt}',''),'timestamptz')
    OR CASE WHEN pg_input_is_valid(coalesce(photo#>>'{verification,checkedAt}',''),'timestamptz')
      THEN (photo#>>'{verification,checkedAt}')::timestamptz <= $2::timestamptz-interval '7 days' ELSE true END
    OR (
      NOT (coalesce(nullif(held->'nativeIds','null'::jsonb),'{}'::jsonb)-'reader') @> (coalesce(nullif(node->'nativeIds','null'::jsonb),'{}'::jsonb)-'reader')
      OR node->'portraitCandidate' IS NOT NULL AND node->'portraitCandidate'<>'null'::jsonb AND nullif(node->'portraitCandidate','null'::jsonb) IS DISTINCT FROM nullif(held->'portraitCandidate','null'::jsonb)
      OR source_stamp->>'sourceUrl'=held_stamp->>'sourceUrl' AND (node->'name' IS DISTINCT FROM held->'name' OR node->'officeTitle' IS DISTINCT FROM held->'officeTitle'
      OR (source_stamp->>'sourceUrl',source_stamp->>'sourceOrg',source_stamp->>'collectedAt',source_stamp->>'verifiedAt')
        IS DISTINCT FROM (held_stamp->>'sourceUrl',held_stamp->>'sourceOrg',held_stamp->>'collectedAt',held_stamp->>'verifiedAt')
      OR nullif(node->'level','null'::jsonb) IS DISTINCT FROM nullif(held->'level','null'::jsonb)
      OR nullif(node->'state','null'::jsonb) IS DISTINCT FROM nullif(held->'state','null'::jsonb)
      OR nullif(node->'chamber','null'::jsonb) IS DISTINCT FROM nullif(held->'chamber','null'::jsonb)
      )
      OR NOT coalesce(held->'profileUrls','[]'::jsonb) @> coalesce(node->'profileUrls','[]'::jsonb)
      OR node->>'websiteUrl' IS NOT NULL AND NOT coalesce(held->'profileUrls','[]'::jsonb) @> jsonb_build_array(node->>'websiteUrl'))
) SELECT scope,kind,jsonb_build_object('id',node->'id','personId',person_key,'nativeIds',node->'nativeIds',
    'name',node->'name','officeTitle',node->'officeTitle','level',node->'level','state',node->'state','chamber',node->'chamber',
    'websiteUrl',node->'websiteUrl','profileUrls',node->'profileUrls','portraitCandidate',node->'portraitCandidate',
    'provenance',node->'provenance','photo',photo,'fieldSources',jsonb_build_object(
      'name',coalesce(fs.payload->'value',node->'fieldSources')->'name',
      'officeTitle',coalesce(fs.payload->'value',node->'fieldSources')->'officeTitle',
      'photo',CASE WHEN source_photo#>>'{verification,personId}'=person_key THEN coalesce(fs.payload->'value',node->'fieldSources')->'photo'
        ELSE coalesce(hfs.payload->'value',held->'fieldSources')->'photo' END)) AS node
  FROM compared LEFT JOIN civic_data_payload_parts fs ON fs.hash=node#>>'{fieldSources,$civicPayloadPart}'
  LEFT JOIN civic_data_payload_parts hfs ON hfs.hash=held#>>'{fieldSources,$civicPayloadPart}'
  WHERE person_key IN(SELECT person_key FROM owed) ORDER BY scope,id`;

export const PORTRAIT_CAPTURES_SQL = `WITH RECURSIVE roots AS (
  SELECT id AS scope,'capture' AS kind,candidate AS node,ARRAY['normalizedPayload','captures']::text[] AS path
  FROM civic_data_candidates WHERE id=ANY($1::text[])
), ${PORTRAIT_ARRAY_WALK}, selected AS (
  SELECT node,encode(sha256(convert_to(node::text,'UTF8')),'hex') AS hash FROM walk WHERE depth=cardinality(path) AND node ? 'finalUrl'
    AND (node->>'finalUrl'=ANY($2::text[]) OR $5::boolean AND node->>'finalUrl' ~ '^https?://([^/]+\\.)?[^/.]+\\.gov/')
) SELECT hash,CASE WHEN $3::boolean THEN NULL ELSE node END AS node FROM selected
  WHERE $4::text[] IS NULL OR hash=ANY($4::text[]) ORDER BY hash`;
