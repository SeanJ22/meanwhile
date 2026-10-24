import { readFile, mkdir, writeFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import { CivicPayloadParts } from "../lib/civic-data/payload-parts.ts";
import { mergePeopleSets } from "../lib/officials/merge-people.ts";
import { personIdentityKeys } from "../lib/officials/people-identity.ts";
import { whiteHouseOffice } from "../lib/officials/white-house-offices.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import type { CandidateProfilesProjection } from "../lib/civic-data/manual-projections.ts";
import type { DerivedCandidatePortraitRecord } from "../lib/civic-data/derived-campaign-sites.ts";

interface CensusPayload extends Partial<RegistryRuntimeReadModel> {
  readonly roster?:OfficeholderSet;
  readonly cards?:CandidateProfilesProjection["cards"];
  readonly ballots?:Readonly<Record<string,{readonly candidacies:readonly {id:string;personId?:string;photoUrl?:string|null}[]}>>;
  readonly portraits?:readonly DerivedCandidatePortraitRecord[];
}

// This measurement never writes to either production database.
const file = process.argv.find(arg => arg.startsWith("--db-url-file="))?.split("=").slice(1).join("=");
const connection = file ? (await readFile(file, "utf8")).trim() : process.env.DATABASE_URL!;
if (new URL(connection).username !== "readonly") throw Error("Portrait census requires the reader readonly role");
const sql = neon(connection);
const output = process.argv.find(arg => arg.startsWith("--output="))?.slice(9) ?? "/tmp/pt01-census";
const requested = process.argv.find(arg => arg.startsWith("--state="))?.slice(8).toUpperCase();
const states = requested ? [requested] : (await sql`SELECT DISTINCT substring(scope from '^US-([A-Z]{2}):') AS state FROM civic_data_promotions WHERE record_class='REGISTRY_RUNTIME_BINDING' ORDER BY state`).map(row => row.state as string).filter(Boolean);
const roles = requested === "US" ? ["President","Vice President","Cabinet"] : ["Congress", "Statewide", "Legislator", "County", "City", "School", "Candidate"];
const counts: {state:string;role:string;withPhoto:number;withoutPhoto:number}[] = [];
const versions: {state:string;scope:string;version:string}[] = [];
for (const state of states) {
  const parts = new CivicPayloadParts({existing:async()=>[],write:async()=>{throw Error("Read-only census");},
    read:async hashes => await sql`SELECT hash,payload FROM civic_data_payload_parts WHERE hash=ANY(${hashes}::text[])` as {hash:string;payload:unknown}[]});
  const roots = await sql`SELECT record_class,scope,payload,current_version_id FROM civic_data_promotions WHERE scope LIKE ${state === 'US' ? 'US:%' : `US-${state}:%`} AND (${state} <> 'US' OR record_class='STATE_LEGISLATOR') AND (record_class IN ('REGISTRY_RUNTIME_BINDING','CANDIDATE_PROFILE','BALLOT_CANDIDACY','STATE_LEGISLATOR') OR scope LIKE '%candidate-campaign-sites-derived' OR scope LIKE '%current-congress-directory')`;
  const people = new Map(roles.map(role=>[role,new Map<string,boolean>()]));
  const photos = new Map<string,string>();
  const aliases=new Map<string,string>();
  const add = (role:string,id:string,url:unknown) => { id=aliases.get(id) ?? id;if(id && people.has(role)) people.get(role)!.set(id,people.get(role)!.get(id) || Boolean(url)); };
  const decoded: {scope:string;recordClass:string;value:CensusPayload}[] = [];
  for (const row of roots) {
    decoded.push({scope:row.scope,recordClass:row.record_class,value:await parts.loadOwned(row.payload) as CensusPayload});
    versions.push({state,scope:row.scope,version:row.current_version_id});
  }
  for (const {value} of decoded) {
    for (const p of value.roster?.officeholders ?? []) if(p.photo?.url) photos.set(p.personId ?? p.id,p.photo.url);
    for (const p of value.officialPhotos?.photos ?? []) if(p.url) photos.set(p.personId ?? p.officeholderId,p.url);
    for (const [id,url] of Object.entries(value.rosterPhotos ?? {})) if(url) photos.set(id,String(url));
  }
  const merged = mergePeopleSets(decoded.flatMap(row=>row.value.roster ? [row.value.roster] : []));
  for(const p of merged?.officeholders ?? [])for(const key of personIdentityKeys(p))aliases.set(key,p.personId ?? p.id);
  for (const p of merged?.officeholders ?? []) {
    const office=whiteHouseOffice(p.officeTitle);
    const role = state === 'US' ? office === 'vice-president' ? 'Vice President' : office === 'president' ? 'President' : office?.startsWith('cabinet:') ? 'Cabinet' : '' : p.level === 'FEDERAL' || p.id.startsWith('congress:') ? 'Congress' : p.chamber ? 'Legislator' : 'Statewide';
    add(role,p.personId ?? p.id,p.photo?.url ?? [...personIdentityKeys(p)].map(id=>photos.get(id)).find(Boolean));
  }
  const memberships=await sql`SELECT f.entity_id AS body_id,substr(f.field,8) AS person_id,
    (SELECT value FROM entity_external_id x WHERE x.entity_id=substr(f.field,8) AND x.scheme='roster-member' LIMIT 1) AS shown_id
    FROM fact f JOIN entity e ON e.id=f.entity_id WHERE e.state=${state} AND f.status='live' AND f.field LIKE 'member:%'`;
  for(const p of memberships)if(p.shown_id)aliases.set(p.shown_id,p.person_id);
  for(const p of memberships) {
    const role=/(?:school_district:|^[a-z]{2}:school:)/.test(p.body_id)?'School':/(?:\/(?:place|city):|^[a-z]{2}:city:)/.test(p.body_id)?'City':/(?:\/county:|^[a-z]{2}:county:)/.test(p.body_id)?'County':null;
    if(role)add(role,p.person_id,photos.get(p.person_id) ?? photos.get(p.shown_id));
  }
  for (const {scope,recordClass,value} of decoded) {
    for (const p of value.statewideExecutives ?? []) add('Statewide',p.holder.personId ?? p.holder.id,p.holder.photoUrl ?? photos.get(p.holder.personId ?? p.holder.id));
    for (const roster of value.bodyRosters ?? []) {
      const role = /(?:school_district:|^[a-z]{2}:school:)/.test(roster.bodyId) ? 'School' : /(?:\/(?:place|city):|^[a-z]{2}:city:)/.test(roster.bodyId) ? 'City' : 'County';
      for(const p of roster.members) add(role,p.personId ?? p.id,photos.get(p.personId ?? p.id) ?? photos.get(p.id));
    }
    if(recordClass === 'CANDIDATE_PROFILE') for(const [id,card] of Object.entries(value.cards?.cards ?? {})) add('Candidate',card.personId ?? id,card.photoUrl);
    if(scope.endsWith(':state-election-ballots')) for(const ballot of Object.values(value.ballots ?? {})) for(const p of ballot.candidacies ?? [])
      add('Candidate',p.id,p.photoUrl ?? photos.get(p.personId ?? p.id));
    for (const p of value.portraits ?? []) add('Candidate',p.portrait.personId ?? p.candidacyId ?? p.id,p.portrait.photoUrl);
  }
  for(const role of roles){const held=[...people.get(role)!.values()];counts.push({state,role,withPhoto:held.filter(Boolean).length,withoutPhoto:held.filter(v=>!v).length});}
  console.log(state,counts.filter(row=>row.state===state).map(row=>`${row.role}=${row.withPhoto}/${row.withoutPhoto}`).join(' '));
}
await mkdir(output.slice(0,output.lastIndexOf('/')),{recursive:true});
await writeFile(`${output}.json`,JSON.stringify({measuredAt:new Date().toISOString(),counts,versions},null,2));
await writeFile(`${output}.csv`,['state,role,with_photo,without_photo',...counts.map(row=>[row.state,row.role,row.withPhoto,row.withoutPhoto].join(','))].join('\n')+'\n');
