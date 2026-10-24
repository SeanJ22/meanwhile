import {createHash} from "node:crypto";
import { officeIdentity } from "../officials/office-identity.ts";
import { campaignFinanceNativeScope, campaignFinanceSource } from "./state-sources.ts";
import type { Query } from "../facts/publish.ts";
import type { CampaignSourceRecord } from "./state-source-records.ts";

export interface CampaignMoneyPerson {
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly name: string;
  readonly seat: string;
  readonly office: string;
  readonly division: string;
  readonly incumbent: boolean;
  readonly sourceUrl: string;
}

export const CAMPAIGN_PEOPLE_SQL = `WITH RECURSIVE roots AS MATERIALIZED (
  SELECT record_class,reader_payload_node(payload) AS value FROM civic_data_promotions
  WHERE (scope=$1 OR scope LIKE $1||':%') AND record_class IN ('STATE_LEGISLATOR','FEDERAL_DIRECTORY','REGISTRY_RUNTIME_BINDING','BALLOT_CANDIDACY')
), holders AS (
  SELECT reader_payload_node(p.item) AS value FROM roots r,LATERAL reader_payload_members(reader_payload_node(r.value->'roster')->'officeholders') p
  WHERE r.record_class IN ('STATE_LEGISLATOR','FEDERAL_DIRECTORY')
), memberships AS (
  SELECT h.value AS person,reader_payload_node(m.item) AS seat FROM holders h,LATERAL reader_payload_members(h.value->'memberships') m
  WHERE reader_payload_value(reader_payload_node(m.item)->'current')='true'::jsonb
), ballots AS (
  SELECT reader_payload_node(b.value) AS value FROM roots r,LATERAL jsonb_each(reader_payload_node(r.value->'ballots')) b
  WHERE r.record_class='BALLOT_CANDIDACY'
), candidates AS (
  SELECT reader_payload_node(c.item) AS person,reader_payload_node(t.item) AS seat FROM ballots b,
    LATERAL reader_payload_members(b.value->'candidacies') c,LATERAL reader_payload_members(b.value->'contests') t
  WHERE reader_payload_node(reader_payload_node(b.value->'election')->'date')#>>'{}'='2026-11-03'
    AND reader_payload_node(c.item)->>'contestId'=reader_payload_node(t.item)->>'id'
), lineup_aliases AS (
  SELECT reader_payload_node(r.item)->>'canonicalCandidacyId' AS id,reader_payload_node(r.item)->>'cardKey' AS alias FROM ballots b,
    LATERAL reader_payload_members(reader_payload_node(b.value->'lineupReconciliation')->'rows') r
  WHERE reader_payload_node(r.item)->>'outcome'='RECONCILED'
), local_members AS (
  SELECT reader_payload_node(m.item) AS person,reader_payload_node(b.item) AS body FROM roots r,
    LATERAL reader_payload_members(r.value->'bodyRosters') b,
    LATERAL reader_payload_members(reader_payload_node(b.item)->'members') m WHERE r.record_class='REGISTRY_RUNTIME_BINDING'
), executives AS (
  SELECT reader_payload_node(e.item) AS value FROM roots r,LATERAL reader_payload_members(r.value->'statewideExecutives') e
  WHERE r.record_class='REGISTRY_RUNTIME_BINDING'
), state_place AS MATERIALIZED (
  SELECT id AS division FROM entity WHERE kind='place' AND state=$2
    AND id ~ '^ocd-division/country:us/(state|district|territory):[^/]+$' ORDER BY id LIMIT 1
), body_parents(body_id,id,depth) AS (
  SELECT id,id,0 FROM entity WHERE kind='body' AND state=$2
  UNION ALL SELECT p.body_id,e.parent_id,p.depth+1 FROM body_parents p JOIN entity e ON e.id=p.id
    WHERE e.parent_id IS NOT NULL AND p.depth<8
), body_places AS MATERIALIZED (
  SELECT DISTINCT ON(body_id) body_id,division FROM (
    SELECT p.body_id,p.depth,ep.place_id AS division FROM body_parents p JOIN entity_place ep ON ep.entity_id=p.id
    UNION ALL SELECT p.body_id,p.depth,e.id FROM body_parents p JOIN entity e ON e.id=p.id WHERE e.kind='place'
  ) places WHERE division LIKE 'ocd-division/%' ORDER BY body_id,depth,division
), people AS (
  SELECT coalesce(person->>'personId',person->>'id') AS id,person->>'name' AS name,seat->>'officeId' AS seat,
    seat->>'officeTitle' AS office,seat->>'divisionId' AS division,true AS incumbent,
    coalesce(seat->>'sourceUrl',reader_payload_node(person->'provenance')->>'sourceUrl') AS source_url,
    jsonb_build_array(person->>'id',person->>'personId')||coalesce((SELECT jsonb_agg(alias) FROM jsonb_path_query(reader_payload_value(person->'nativeIds'),'$.*[*]') alias),'[]'::jsonb) AS aliases FROM memberships
  UNION SELECT person->>'id',concat_ws(' ',person->>'givenName',person->>'familyName'),seat->>'id',seat->>'title',seat->>'ocdId',false,
    reader_payload_node(person->'provenance')->>'sourceUrl',jsonb_build_array(person->>'id')||
      coalesce((SELECT jsonb_agg(alias) FROM lineup_aliases l WHERE l.id=person->>'id'),'[]'::jsonb) FROM candidates
  UNION SELECT coalesce(person->>'personId',person->>'id'),person->>'name',body->>'bodyId',person->>'officeTitle',
    coalesce((SELECT division FROM body_places WHERE body_id=body->>'bodyId'),
      CASE WHEN body->>'bodyId' LIKE 'ocd-division/%' THEN split_part(body->>'bodyId','#',1) END,(SELECT division FROM state_place)),true,
    coalesce(reader_payload_node(person->'membershipSource')->>'sourceUrl',body->>'sourceUrl'),jsonb_build_array(person->>'id',person->>'personId') FROM local_members
  UNION SELECT coalesce(reader_payload_node(value->'holder')->>'personId',reader_payload_node(value->'holder')->>'id'),
    reader_payload_node(value->'holder')->>'name',reader_payload_node(value->'holder')->>'id',reader_payload_node(value->'holder')->>'officeTitle',value->>'stateOcdId',true,
    value->>'sourceUrl',jsonb_build_array(reader_payload_node(value->'holder')->>'id',reader_payload_node(value->'holder')->>'personId') FROM executives
  UNION SELECT substr(f.field,8),coalesce(f.value->>'name',p.name),f.entity_id,f.value->>'office',
    coalesce((SELECT division FROM body_places WHERE body_id=f.entity_id),(SELECT division FROM state_place)),true,s.url,jsonb_build_array(p.id,(SELECT value FROM entity_external_id WHERE entity_id=p.id AND scheme='roster-member' LIMIT 1))
    FROM entity b JOIN fact f ON f.entity_id=b.id AND f.field LIKE 'member:%' AND f.status='live'
    JOIN entity p ON p.id=substr(f.field,8) LEFT JOIN source_copy s ON s.id=f.source_copy_id
    WHERE b.state=$2 AND b.kind='body'
) SELECT DISTINCT id,name,seat,office,division,incumbent,source_url,aliases FROM people
  WHERE id IS NOT NULL AND name IS NOT NULL AND seat IS NOT NULL AND division IS NOT NULL AND source_url IS NOT NULL
  ORDER BY incumbent DESC,id,seat`;

export async function readCampaignMoneyPeople(query: Query, state: string): Promise<readonly CampaignMoneyPerson[]> {
  const rows = await query(CAMPAIGN_PEOPLE_SQL, [`US-${state}`, state]);
  const people = rows.map(row => ({ id: String(row.id), name: String(row.name), seat: String(row.seat), office: String(row.office ?? ""),
    division: String(row.division), incumbent: row.incumbent === true, sourceUrl: String(row.source_url), aliases: [...new Set((row.aliases as unknown[]).filter((value):value is string=>typeof value==="string" && !!value))] }));
  const grouped = new Map<string, CampaignMoneyPerson>();
  for(const raw of people){
    const district=/\bdistrict\s*[-:#]?\s*(\d+)\b/i.exec(raw.office)?.[1],office=campaignOffice(raw.office);
    const chamber=office==="state_lower_house"?"sldl":office==="state_senator"?"sldu":null;
    const person=district && chamber && !raw.division.includes(`/${chamber}:`) ? {...raw,division:`${raw.division.split("/").slice(0,3).join("/")}/${chamber}:${Number(district)}`} : raw;
    const key=[campaignName(person.name),campaignOffice(person.office),person.division].join("|");
    const old=grouped.get(key);
    grouped.set(key,old ? {...old,aliases:[...new Set([old.id,person.id,...old.aliases ?? [],...person.aliases])]} : person);
  }
  return [...grouped.values()];
}

export function campaignRecordYear(row: CampaignSourceRecord): number | null {
  if (row.transactionDate) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T|\s|$)/.exec(row.transactionDate);
    const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/.exec(row.transactionDate);
    if (!iso && !local) return null;
    const [year, month, day] = iso ? iso.slice(1).map(Number) : [Number(local![3]), Number(local![1]), Number(local![2])];
    const at = new Date(Date.UTC(year, month - 1, day));
    return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day ? year : null;
  }
  const years = row.period?.match(/\b(?:19|20)\d{2}\b/g)?.map(Number);
  if (!years?.length || new Set(years.map(year => year + year % 2)).size !== 1) return null;
  return Math.min(...years);
}

const normalized = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function campaignName(value:string):string {
  const parts=value.split(",").map(part=>part.trim());
  return normalized(parts.length===2 ? `${parts[1]} ${parts[0]}` : value);
}
export function campaignOffice(value:string,state?:string):string {
  const office=state ? value.replace(new RegExp(`^${state}\\s+`,"i"),"") : value;
  return officeIdentity(office) ?? normalized(office);
}
export function campaignMoneyPeopleIndex(people:readonly CampaignMoneyPerson[]):ReadonlyMap<string,readonly CampaignMoneyPerson[]> {
  const index=new Map<string,CampaignMoneyPerson[]>();
  for(const person of people){const key=`${campaignName(person.name)}|${campaignOffice(person.office,/(?:state|district|territory):([a-z]{2})/.exec(person.division)?.[1].toUpperCase())}`;const rows=index.get(key)??[];rows.push(person);index.set(key,rows);}
  return index;
}
function filedSeatMatches(row:CampaignSourceRecord,person:CampaignMoneyPerson):boolean {
  if(row.governmentOcdId && row.governmentOcdId!==person.division && !person.division.startsWith(row.governmentOcdId+"/"))return false;
  const expectedDistrict=/\/(?:sldl|sldu|cd|ward|council_district):([0-9]+)/.exec(person.division)?.[1]??/\bdistrict\s*(\d+)\b/i.exec(person.office)?.[1];
  const district=row.filedDistrict??/\/(?:sldl|sldu|cd|ward|council_district):([0-9]+)/.exec(row.governmentOcdId??"")?.[1]??/\bdistrict\s*(\d+)\b/i.exec(row.office??"")?.[1];
  const filedNumber=district?.trim().match(/^(?:(?:legislative\s+)?district\s*[-:#]?\s*)?(\d+)(?:(?:st|nd|rd|th)?\s+(?:senatorial\s+|representative\s+)?district)?$/i)?.[1];
  if(expectedDistrict && (!filedNumber || Number(filedNumber)!==Number(expectedDistrict)))return false;
  const place=[...person.division.matchAll(/\/(?:place|county|school_district):([^/]+)/g)].at(-1);
  if(place && !row.governmentOcdId?.split("/").includes(place[0].slice(1))){
    const jurisdiction=normalized([row.filedJurisdiction,row.filedDistrict].filter(Boolean).join(" ")),name=normalized(place[1]);
    if(!jurisdiction || !(` ${jurisdiction} `).includes(` ${name} `))return false;
  }
  return true;
}
export function campaignMoneyIdentityMatches(row: CampaignSourceRecord, people: ReadonlyMap<string,readonly CampaignMoneyPerson[]>): readonly CampaignMoneyPerson[] {
  if (!row.candidateName || !row.office) return [];
  const names=[row.candidateName.replace(/\s*\([^)]*\)\s*/g," "),...Array.from(row.candidateName.matchAll(/\(([^)]+)\)/g),match=>match[1])].map(campaignName), office = campaignOffice(row.office,row.state);
  const matches=names.flatMap(name=>people.get(`${name}|${office}`)??[]).filter(person=>filedSeatMatches(row,person));
  return [...new Map(matches.map(person => [`${person.id}:${person.seat}`, person])).values()];
}
export function bindCampaignMoney(row: CampaignSourceRecord, people: ReadonlyMap<string,readonly CampaignMoneyPerson[]>): CampaignSourceRecord | null {
  const year = campaignRecordYear(row);
  if (year === null || year < campaignFinanceSource(row.state).minimumYear || (row.cycle??0)<2020 || row.filingState !== "FILED" || !row.filerName || row.issues.some(issue => /conflict|disagree/i.test(issue))) return null;
  const matches = campaignMoneyIdentityMatches(row, people);
  if (matches.length !== 1) return null;
  const person = matches[0];
  return { ...row, governmentOcdId: person.division, unjoinedReason: null,
    person: { id: person.id, name: person.name, seat: person.seat, sourceUrl: person.sourceUrl,office:person.office } };
}

export const CAMPAIGN_MONEY_MISSING_REASONS = {
  period: "The source has no readable filing period",
  old: "The filing predates January 1, 2020",
  cycle: "The source has no mapped election cycle",
  unfiled: "The source has not established a filed financial report",
  identity: "The source does not bind a filed committee, candidate and office",
  unmatched: "The filed person, office or district does not uniquely match a person we publish",
  unsupported: "The official source has no supported committee-to-person and office binding yet",
  unavailable: "The official campaign source could not be read on this check",
  invalid: "The official campaign source could not be matched to verified filing records on this check",
  absent: "No filed money has matched this published person and seat yet",
} as const;

export const campaignPersonKey = (state:string,person:Pick<CampaignMoneyPerson,"id"|"seat">) =>
  `campaign-money:person:${state}:${createHash("sha256").update(`${person.id}\0${person.seat}`).digest("hex")}`;
interface CampaignPersonCheck { readonly checkedAt:string; readonly found:boolean }
function campaignMoneyDue(person:CampaignPersonCheck|null,at:string):boolean {
  return !person || !person.found || Date.parse(at)-Date.parse(person.checkedAt)>=24*60*60_000;
}
export async function campaignMoneyWork(query:Query,state:string,people:readonly CampaignMoneyPerson[],at:string):Promise<readonly CampaignMoneyPerson[]> {
  const checks=new Map<string,CampaignPersonCheck>(),withMoney=new Set<string>();
  for(let start=0;start<people.length;start+=500){
    const keys=people.slice(start,start+500).map(person=>campaignPersonKey(state,person));
    const rows=await query("SELECT name,position FROM pass_cursor WHERE name=ANY($1::text[])",[keys]);
    for(const row of rows)checks.set(String(row.name),JSON.parse(String(row.position)) as CampaignPersonCheck);
    const batch=people.slice(start,start+500);
    const money=await query(`SELECT DISTINCT wanted.id,wanted.seat FROM unnest($1::text[],$2::text[],$3::text[]) wanted(id,name,seat)
      JOIN fact f ON f.entity_id=wanted.id AND f.status='live' AND f.field LIKE 'campaign-cycle:%'
        AND f.value#>>'{person,name}'=wanted.name AND f.value#>>'{person,seat}'=wanted.seat`,
      [batch.map(person=>person.id),batch.map(person=>person.name),batch.map(person=>person.seat)]);
    for(const row of money)withMoney.add(campaignPersonKey(state,{id:String(row.id),seat:String(row.seat)}));
  }
  return people.filter(person=>!withMoney.has(campaignPersonKey(state,person)) || campaignMoneyDue(checks.get(campaignPersonKey(state,person))??null,at))
    .sort((a,b)=>Number(b.incumbent)-Number(a.incumbent)||a.id.localeCompare(b.id));
}

export async function readCampaignMoneyStateWork(query:Query,state:string){
  const [row]=await query("SELECT position FROM pass_cursor WHERE name=$1",[campaignFinanceNativeScope(state)]);
  return row ? JSON.parse(String(row.position)) as Partial<import("./state-sources.ts").CampaignFinanceWorkCheck["records"][number]> : null;
}
export function campaignMoneyStateDue(work:{readonly startedAt?:string}|null,at:string):boolean {
  const started=Date.parse(work?.startedAt??""),now=Date.parse(at);
  return !Number.isFinite(started) || started>now || now-started>=60*60_000;
}
