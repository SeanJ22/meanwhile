import { jurisdictionFromOcdId,US_JURISDICTIONS } from "../coverage/states.ts";
import { CAMPAIGN_PEOPLE_SQL, CAMPAIGN_MONEY_MISSING_REASONS } from "./state-people.ts";
import { factReader } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import type { CampaignSourceCapture } from "./state-source-records.ts";

export interface CampaignMoneyCycle {
  readonly id: string;
  readonly person: { readonly id: string; readonly name: string; readonly seat: string;readonly office?:string };
  readonly committees?:readonly {readonly name:string;readonly seat:string;readonly office?:string;readonly totals:CampaignMoneyCycle["totals"]}[];
  readonly committee: string;
  readonly donors?:readonly {readonly kind:"INDIVIDUAL"|"COMMITTEE_OR_ORGANIZATION";readonly filedName:string;readonly amount:number;readonly filingUrl:string}[];
  readonly individualSmall?:number|null;
  readonly individualLarge?:number|null;
  readonly cycle: number;
  readonly totals: readonly { readonly label: string; readonly amount: number }[];
  readonly sources: readonly (CampaignSourceCapture & { readonly publisher: string; readonly filingUrl: string })[];
}
export interface CampaignFinancePlaceRead {
  readonly division: string;
  readonly state: string;
  readonly status: "HELD" | "NOT_HELD" | "UNAVAILABLE";
  readonly checkedAt: string | null;
  readonly records: readonly CampaignMoneyCycle[];
  readonly count: number | null;
  readonly nextCursor: string | null;
  readonly missingReason?: string;
}
interface Options { readonly query?: Query | null; readonly cursor?: string | null; readonly personId?: string }

export async function readCampaignMoneyForTarget(target:string,divisions:readonly string[],options:Options={}):Promise<CampaignFinancePlaceRead|null>{
  const query=options.query===undefined ? factReader() : options.query;
  const nativeState=/^(?:ballot-|statewide:|state-finance:)([A-Za-z]{2})[-/:]/.exec(target)?.[1]?.toUpperCase();
  const nativePlace=US_JURISDICTIONS.find(state=>state.usps===nativeState);
  const place=nativePlace??divisions.map(jurisdictionFromOcdId).find(Boolean);
  if(place)return readCampaignFinanceForPlace(`ocd-division/country:us/${place.prefix}:${place.slug}`,{...options,personId:target});
  if(!query)return null;
  const states=await query(`SELECT DISTINCT e.state FROM entity e WHERE e.kind='person' AND
    (e.id=$1 OR EXISTS(SELECT 1 FROM entity_external_id x WHERE x.entity_id=e.id AND x.scheme='campaign-person:'||e.state AND x.value=$1))`,[target]);
  if(states.length!==1)return null;
  const state=US_JURISDICTIONS.find(state=>state.usps===states[0].state);
  return state ? readCampaignFinanceForPlace(`ocd-division/country:us/${state.prefix}:${state.slug}`,{...options,personId:target}) : null;
}

export async function readCampaignFinanceForPlace(division: string, options: Options = {}): Promise<CampaignFinancePlaceRead> {
  const identity = jurisdictionFromOcdId(division);
  if (!identity) throw new Error("Campaign records require a state or local division.");
  const state = identity.usps;
  let cursor = "",donorCursor="";
  if (options.cursor) {
    if (options.cursor.length > 4096) throw new Error("The campaign records page is invalid.");
    const value = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8"));
    if (value.division !== division || !new RegExp(`^.+$`).test(value.entity)) throw new Error("The campaign records page is invalid.");
    cursor = value.entity;
    if(value.donor!==undefined){if(typeof value.donor!=="string" || !/^campaign-donor:[a-f0-9]{32}$/.test(value.donor))throw new Error("The campaign records page is invalid");donorCursor=value.donor;}
  }
  const query = options.query === undefined ? factReader() : options.query;
  const empty = (status: CampaignFinancePlaceRead["status"]): CampaignFinancePlaceRead => ({ division, state, status, checkedAt: null, records: [], count: null, nextCursor: null });
  if (!query) return empty("UNAVAILABLE");
  if(cursor && !(await query("SELECT id FROM entity WHERE id=$1 AND state=$2 AND kind='person'",[cursor,state])).length)throw new Error("The campaign records page is invalid");
  const committees=await query(`WITH published AS MATERIALIZED (${CAMPAIGN_PEOPLE_SQL.replaceAll("$1","$5")}) SELECT e.id FROM entity_place ep JOIN entity e ON e.id=ep.entity_id
    WHERE ep.place_id=$1 AND e.state=$2 AND e.kind='person' AND (e.id>$3 OR ($6::boolean AND e.id=$3))
      AND ($4::text IS NULL OR e.id=$4 OR EXISTS(SELECT 1 FROM entity_external_id WHERE entity_id=e.id AND scheme='campaign-person:'||$2 AND value=$4))
      AND EXISTS(SELECT 1 FROM published p WHERE p.name=e.name AND (p.id=e.id OR p.aliases ? e.id OR EXISTS(
        SELECT 1 FROM entity_external_id x WHERE x.entity_id=e.id AND x.scheme='campaign-person:'||$2 AND (x.value=p.id OR p.aliases ? x.value))))
      AND EXISTS(SELECT 1 FROM fact f WHERE f.entity_id=e.id AND f.field LIKE 'campaign-cycle:%' AND f.status='live')
      ORDER BY e.id LIMIT 2`,[division,state,cursor,options.personId??null,`US-${state}`,!!donorCursor]);
  const committee=committees[0];
  if(!committee){
    if(!options.personId)return empty("NOT_HELD");
    const [missing]=await query(`WITH published AS MATERIALIZED (${CAMPAIGN_PEOPLE_SQL})
      SELECT b.detail FROM blank b JOIN entity e ON e.id=b.entity_id JOIN published p ON p.name=e.name
        AND (p.id=e.id OR p.aliases ? e.id) AND b.field='campaign-money:'||p.seat
      WHERE e.state=$2 AND b.reason='MONEY_NOT_YET_JOINED'
        AND (p.id=$3 OR p.aliases ? $3 OR e.id=$3 OR EXISTS(SELECT 1 FROM entity_external_id x
          WHERE x.entity_id=e.id AND x.scheme='campaign-person:'||$2 AND x.value=$3))
        AND (p.division=$4 OR $4=$5) ORDER BY b.updated_at DESC LIMIT 1`,[`US-${state}`,state,options.personId,division,`ocd-division/country:us/${identity.prefix}:${identity.slug}`]);
    const reason=missing?.detail;
    return {...empty("NOT_HELD"),...(typeof reason==="string" && (Object.values(CAMPAIGN_MONEY_MISSING_REASONS) as readonly string[]).includes(reason)?{missingReason:reason}:{})};
  }
  const rows=await query(`SELECT value,checked_at FROM fact WHERE entity_id=$1 AND field LIKE 'campaign-cycle:%' AND status='live'
    AND value#>>'{person,name}'=(SELECT name FROM entity WHERE id=$1) ORDER BY (value->>'cycle')::int DESC,field`,[committee.id]);
  const donors=await query(`SELECT field,value FROM fact WHERE entity_id=$1 AND field LIKE 'campaign-donor:%' AND status='live' AND field>$2
    AND value#>>'{person,name}'=(SELECT name FROM entity WHERE id=$1) AND
      (value->>'kind'='COMMITTEE_OR_ORGANIZATION' OR value->>'kind'='INDIVIDUAL' AND (value->>'amount')::numeric>200)
    ORDER BY field LIMIT 101`,[committee.id,donorCursor]);
  const records:CampaignMoneyCycle[]=[];
  for(const row of rows){
    const value=row.value as CampaignMoneyCycle;
    if(!value || !value.person || value.cycle<2020 || !Number.isInteger(value.cycle) || !Array.isArray(value.totals) || !Array.isArray(value.sources))continue;
    const held=records.find(record=>record.cycle===value.cycle);
    const totals=held ? [...held.totals] : [];
    for(const amount of value.totals){
      if(typeof amount.label!=="string" || typeof amount.amount!=="number" || !Number.isFinite(amount.amount))continue;
      const existing=totals.find(total=>total.label===amount.label);
      if(existing)totals[totals.indexOf(existing)]={label:amount.label,amount:existing.amount+amount.amount};else totals.push({label:amount.label,amount:amount.amount});
    }
    const organizations=(value as CampaignMoneyCycle & {organizations?:readonly {kind:string;filedName:string;amount:number;sourceUrl:string}[]}).organizations??[];
    const named=[...held?.donors??[],...organizations.filter(org=>org.kind==="COMMITTEE_OR_ORGANIZATION" && typeof org.filedName==="string" && Number.isFinite(org.amount) && /^https:\/\//.test(org.sourceUrl)).map(org=>({kind:"COMMITTEE_OR_ORGANIZATION" as const,filedName:org.filedName,amount:org.amount,filingUrl:org.sourceUrl}))];
    const sources=value.sources.flatMap(source=>[{url:source.url,filingUrl:source.filingUrl,publisher:source.publisher,rawHash:source.rawHash,vaultKey:source.vaultKey,
      byteLength:source.byteLength,retrievedAt:source.retrievedAt,publicationDate:source.publicationDate,checkedAt:new Date(row.checked_at as string).toISOString()},
      ...(source.lookup?[{url:source.lookup.url,filingUrl:source.lookup.url,publisher:source.publisher,rawHash:source.lookup.rawHash,vaultKey:source.lookup.vaultKey,
        byteLength:source.lookup.byteLength,retrievedAt:source.lookup.retrievedAt,publicationDate:source.lookup.publicationDate}]:[])]);
    const record:CampaignMoneyCycle={id:`${committee.id}:${value.cycle}`,person:{id:value.person.id,name:value.person.name,seat:value.person.seat,...(value.person.office?{office:value.person.office}:{})},
      committees:[...held?.committees??[],{name:value.committee,seat:value.person.seat,...(value.person.office?{office:value.person.office}:{}),totals:value.totals}],
      committee:[...new Set([held?.committee,value.committee].filter(Boolean))].join("; "),cycle:value.cycle,totals,sources:[...held?.sources??[],...sources],
      individualSmall:typeof value.individualSmall==="number" && (!held || typeof held.individualSmall==="number") ? (held?.individualSmall??0)+value.individualSmall : null,
      individualLarge:typeof value.individualLarge==="number" && (!held || typeof held.individualLarge==="number") ? (held?.individualLarge??0)+value.individualLarge : null,donors:named};
    if(held)records[records.indexOf(held)]=record;else records.push(record);
  }
  for(const donor of donors.slice(0,100)){
    const value=donor.value as {cycle:number;kind:"INDIVIDUAL"|"COMMITTEE_OR_ORGANIZATION";filedName:string;amount:number;filingUrl:string;source:CampaignSourceCapture&{publisher:string}};
    const record=records.find(record=>record.cycle===value.cycle);
    if(!record || typeof value.filedName!=="string" || typeof value.amount!=="number" || !Number.isFinite(value.amount) || !/^https:\/\//.test(value.filingUrl))continue;
    const publicDonor={kind:value.kind,filedName:value.filedName,amount:value.amount,filingUrl:value.filingUrl};
    (record.donors as typeof publicDonor[]).push(publicDonor);
  }
  const checkedAt = rows.map(row => new Date(row.checked_at as string).toISOString()).sort().at(-1) ?? null;
  return { division, state, status: records.length ? "HELD" : "NOT_HELD", checkedAt, records, count: null,
    nextCursor: donors.length>100 ? Buffer.from(JSON.stringify({division,entity:committee.id,donor:donors[99].field})).toString("base64url") : committees.length > 1 ? Buffer.from(JSON.stringify({ division, entity: committee.id })).toString("base64url") : null };
}
