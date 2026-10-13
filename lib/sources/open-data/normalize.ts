import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { isOfficialSource } from "../../civic-data/source-authority.ts";
import type { OpenDataFact, OpenDataReport } from "./model.ts";
export interface GovernmentJoin {
  readonly divisionId: string;
  readonly bodyIds: readonly string[];
  readonly nativeIds: Readonly<Record<string, string>>;
}
/** A government page's saved link binds a publishing domain to its own held IDs. */
export interface PortalBinding extends GovernmentJoin {
  readonly domain: string;
  readonly official: boolean;
  readonly linkingUrl: string;
  readonly linkingHtml: string;
}
export const string = (v: unknown): string => typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
export const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function sourceDate(v: unknown): string | null {
  const text = string(v);
  if (!text) return null;
  const date = /^\d{10,13}$/.test(text) ? new Date(Number(text) * (text.length === 10 ? 1000 : 1)) : new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
const stateOf = (id: string) => /\/(?:state|district|territory):([a-z]{2})(?:\/|$)/i.exec(id)?.[1]?.toUpperCase() ?? null;
const joinIndexes = new WeakMap<readonly GovernmentJoin[], Map<string, GovernmentJoin[]>>();
export function nativeGovernmentJoins(ids: Readonly<Record<string, string>>, held: readonly GovernmentJoin[]) {
  let index=joinIndexes.get(held);
  if(!index) { index=new Map();for(const row of held)for(const [key,value]of Object.entries(row.nativeIds))if(value){const k=`${key}:${value}`;index.set(k,[...(index.get(k)??[]),row]);}joinIndexes.set(held,index); }
  return [...new Set(Object.entries(ids).flatMap(([key,value])=>value?index!.get(`${key}:${value}`)??[]:[]))];
}
export function normalizeSocrata(row: Record<string, unknown>, capturedAt: string, held: readonly GovernmentJoin[] = [], bindings: readonly PortalBinding[] = []): OpenDataFact {
  const resource = object(row.resource), classification = object(row.classification), metadata = object(row.metadata);
  const domain = string(metadata.domain).toLowerCase(), id = string(resource.id);
  if (!/^[a-z0-9.-]+$/.test(domain) || !/^[a-z0-9]{4}-[a-z0-9]{4}$/.test(id) || !string(resource.name)) throw Error("Socrata catalog row has no native domain, resource ID or title.");
  const nativeIds: Record<string, string> = { domain, socrata_id: id };
  const aliases: Record<string,string> = { ocdid: "ocd_id", divisionocdid: "ocd_id", geoid: "geoid", censusgeoid: "geoid", countyfips: "county_fips", statefips: "state_fips", placefips: "place_fips", censuspid6: "census_pid6", ncesid: "nces_id" };
  for (const item of Array.isArray(classification.domain_metadata) ? classification.domain_metadata : []) {
    const meta = object(item), key = string(meta.key).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (aliases[key] && string(meta.value)) nativeIds[aliases[key]] = string(meta.value);
  }
  const portal = bindings.filter(b => b.domain === domain && isOfficialSource(`https://${domain}/`, {url:b.linkingUrl, html:b.linkingHtml}));
  const joins = [...nativeGovernmentJoins(nativeIds, held), ...portal];
  const divisionIds = [...new Set(joins.map(j => j.divisionId))].sort();
  const states = [...new Set(divisionIds.map(stateOf).filter((s):s is string => !!s))];
  const state = states.length === 1 ? states[0] : FIPS_TO_STATE[nativeIds.state_fips]?.postal ?? null;
  const sourceUrl=string(row.permalink) || string(row.link);
  if(!sourceUrl.startsWith(`https://${domain}/`) || !sourceUrl.endsWith(id))throw Error("Socrata did not supply a resource permalink in its publishing domain.");
  return { id:`socrata:${domain}:${id}`, kind:"SOCRATA_DATASET", sourceId:"socrata-discovery", nativeIds,
    title:string(resource.name), state, divisionIds, bodyIds:[...new Set(joins.flatMap(j => j.bodyIds))].sort(), zip:null,
    sourceUrl, sourceOrg:string(resource.attribution) || domain,
    official:isOfficialSource(`https://${domain}/`) || portal.some(b => b.official),
    publishedAt:sourceDate(resource.publication_date), updatedAt:sourceDate(resource.data_updated_at ?? resource.updatedAt), capturedAt,
    description:string(resource.description), fields:{type:resource.type ?? null, category:classification.domain_category ?? null,
      tags:classification.domain_tags ?? [], columns:resource.columns_field_name ?? [], metadata:classification.domain_metadata ?? [],
      createdAt:sourceDate(resource.createdAt), metadataUpdatedAt:sourceDate(resource.metadata_updated_at)}, sourceRow:row };
}
/** ECHO exporter keeps program-specific identifiers and all the publisher's status/history fields. */
export function normalizeEcho(row: Record<string, unknown>, capturedAt: string, publishedAt: string | null, held: readonly GovernmentJoin[] = []): OpenDataFact {
  const get = (bulk: string, api: string) => string(row[bulk] ?? row[api]);
  const id = get("REGISTRY_ID", "RegistryID"), title = get("FAC_NAME", "FacName");
  if (!id || !title) throw Error("EPA row has no native facility ID or name.");
  const state = get("FAC_STATE", "FacState").toUpperCase() || null;
  const stateFips = Object.entries(FIPS_TO_STATE).find(([,s]) => s.postal === state)?.[0];
  const nativeIds: Record<string,string> = {registry_id:id, ...(stateFips ? {state_fips:stateFips} : {})};
  const countyFips = get("FAC_FIPS_CODE", "FacDerivedStctyFIPS");
  if (/^\d{5}$/.test(countyFips)) nativeIds.county_fips = countyFips;
  for (const key of ["AIR_IDS", "NPDES_IDS", "RCRA_IDS", "SDWA_IDS", "TRI_IDS"]) if (string(row[key])) nativeIds[key.toLowerCase()] = string(row[key]);
  const joins = nativeGovernmentJoins(nativeIds, held);
  const zip = /^\d{5}/.exec(get("FAC_ZIP", "FacZip"))?.[0] ?? null;
  return {id:`epa-echo:${id}`,kind:"EPA_FACILITY",sourceId:"epa-echo",nativeIds,title,state,
    divisionIds:[...new Set(joins.map(j=>j.divisionId))].sort(),bodyIds:[],zip,
    sourceUrl:string(row.DFR_URL).replace(/^http:/,"https:") || "https://echodata.epa.gov/echo/echo_rest_services.get_facilities",sourceOrg:"U.S. Environmental Protection Agency",official:true,
    publishedAt,updatedAt:publishedAt,capturedAt,description:get("FAC_COMPLIANCE_STATUS","FacComplianceStatus"),
    fields:{inspectionCount:get("FAC_INSPECTION_COUNT","FacInspectionCount") || null,
      lastInspection:sourceDate(get("FAC_DATE_LAST_INSPECTION","FacDateLastInspection")),
      quartersWithNoncompliance:get("FAC_QTRS_WITH_NC","FacQtrsWithNC") || null,
      significantNoncompliance:get("FAC_SNC_FLG","FacSNCFlg") || null,
      latitude:get("FAC_LAT","FacLat") || null,longitude:get("FAC_LONG","FacLong") || null,
      airCompliance:get("CAA_COMPLIANCE_STATUS","CAAComplianceStatus") || null,
      waterCompliance:get("CWA_COMPLIANCE_STATUS","CWAComplianceStatus") || null,
      wasteCompliance:get("RCRA_COMPLIANCE_STATUS","RCRAComplianceStatus") || null,
      drinkingWaterCompliance:get("SDWA_COMPLIANCE_STATUS","SDWAComplianceStatus") || null},sourceRow:row};
}
export function openDataReports(rows: readonly OpenDataFact[]): OpenDataReport[] {
  const counts = new Map<string, {loaded:number;joined:number;unjoined:number}>();
  for (const row of rows) {
    const state = row.state ?? "UNRESOLVED", n = counts.get(state) ?? {loaded:0,joined:0,unjoined:0};
    n.loaded++; if (row.divisionIds.length) n.joined++; else n.unjoined++; counts.set(state,n);
  }
  return [...counts].map(([state,n])=>({id:`state:${state}`,state,...n})).sort((a,b)=>a.state.localeCompare(b.state));
}
