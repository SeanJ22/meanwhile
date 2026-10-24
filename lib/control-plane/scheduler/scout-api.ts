/** Credentialed, read-only government APIs shared by hunters and detectives.
 * Credentials stay in transport, never in source locators or model output. */
import { readCompleteResponse } from "../../sources/source-bytes.ts";
import { assertPublicUrl } from '../../hunt/egress.ts';
import type { ScoutToolSpec } from './scout-contract.ts';

export const SOURCE_API_TOOLS = ['congress_api', 'census_api', 'fec_api', 'plural_api', 'legiscan_api', 'lda_api', 'data_gov_api', 'socrata_api', 'google_civic_api', 'sam_gov_api', 'legistar_api'] as const;
export type SourceApiTool = typeof SOURCE_API_TOOLS[number];
export interface SourceApiResult { sourceUrl: string; status: number; text: string; requests: number; bytes: number; retryAfter?: string | null }
export interface SourceApiOptions {
  env?: Readonly<Record<string, string | undefined>>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
  spaceOut?: (host: string) => Promise<void>;
}
const descriptions: Record<SourceApiTool, string> = {
  congress_api: 'Congress.gov v3 records. path e.g. member, bill/119; params e.g. limit, offset, fromDateTime.',
  census_api: 'Census datasets. path e.g. 2024/acs/acs5; params get=NAME,B01003_001E, for=county:019, in=state:04.',
  fec_api: 'OpenFEC candidate, committee, election and aggregate finance data. path candidates/, committees/, elections/; params state, cycle, page, per_page.',
  plural_api: 'Plural/Open States v3 people, bills, votes and jurisdictions. path people or bills; params jurisdiction, page, per_page.',
  legiscan_api: 'LegiScan read API. params op=getMasterList and state=AZ, or op=getBill and id=<bill id>.',
  lda_api: 'Federal lobbying disclosures. path filings/, registrants/, clients/, lobbyists/ or contributions/; params filing_year, client_name, page.',
  data_gov_api: 'Data.gov APIs. Default provider is College Scorecard: path schools; params school.state, fields, page, per_page. provider=govinfo reads the Congressional Directory: path collections/CDIR/<start>/<end>, packages/<id>/summary or packages/<id>/granules.',
  socrata_api: 'Socrata catalog and dataset rows. params q searches the catalog; domain plus dataset reads verified catalog datasets with SoQL params ($select, $where, $limit, $offset).',
  google_civic_api: 'Working Google Civic divisions lookup. params query=<place name or OCD division id>.',
  sam_gov_api: 'SAM.gov public contract opportunities. params postedFrom and postedTo (MM/DD/YYYY, maximum one year), state, title, limit, offset.',
  legistar_api: 'Legistar public civic records. tenant required; path Events, Bodies, Persons, Matters or Events/<id>/EventItems; OData params $filter, $top, $skip.',
};
export const SOURCE_API_SPECS: readonly ScoutToolSpec[] = SOURCE_API_TOOLS.map(name => ({ name,
  description: descriptions[name] + ' Returns captured data and its credential-free source link. Reuse held data first. Keys are supplied by the runtime; never pass a key.',
  input_schema: { type: 'object', properties: { path: {type:'string'}, provider: {type:'string'}, tenant: {type:'string'}, domain: {type:'string'}, dataset: {type:'string'}, params: {type:'object', additionalProperties:{type:'string'}} } },
}));
const config: Partial<Record<SourceApiTool, { base: string; key: string; param?: string; header?: string; prefix?: string; path: string }>> = {
  congress_api: {base:'https://api.congress.gov/v3/', key:'CONGRESS_API_KEY', param:'api_key', path:'member'},
  census_api: {base:'https://api.census.gov/data/',key:'CENSUS_API_KEY',param:'key',path:'2024/acs/acs5'},
  fec_api: {base:'https://api.open.fec.gov/v1/',key:'FEC_API_KEY',param:'api_key',path:'candidates/'},
  plural_api: {base:'https://v3.openstates.org/',key:'PLURAL_API_KEY',header:'X-API-KEY',path:'people'},
  legiscan_api: {base:'https://api.legiscan.com/',key:'LEGISCAN_API_KEY',param:'key',path:''},
  lda_api: {base:'https://lda.gov/api/v1/',key:'LDA_API_KEY',header:'Authorization',prefix:'Token ',path:'filings/'},
  data_gov_api: {base:'https://api.data.gov/ed/collegescorecard/v1/',key:'DATA_GOV_API_KEY',param:'api_key',path:'schools.json'},
  google_civic_api: {base:'https://www.googleapis.com/civicinfo/v2/',key:'GOOGLE_CIVIC_API_KEY',param:'key',path:'divisions'},
  sam_gov_api: {base:'https://api.sam.gov/opportunities/v2/',key:'SAM_GOV_API_KEY',param:'api_key',path:'search'},
};
const credentialName = /^(api[_-]?key|key|apikey|token|access_token|authorization|secret|app_token)$/i;

/** The captured response of an API we hold is published directly from its fields. */
export function isSourceApiUrl(value: string): boolean {
  const url = new URL(value);
  const bases = [...Object.values(config).map(provider => provider.base),
    'https://api.govinfo.gov/', 'https://webapi.legistar.com/v1/',
    'https://api.us.socrata.com/api/catalog/v1', 'https://data.openstates.org/', 'https://open.pluralpolicy.com/'];
  return bases.some(base => {
    const provider = new URL(base);
    return url.origin === provider.origin && url.pathname.startsWith(provider.pathname);
  });
}

export async function readSourceApi(name: SourceApiTool, raw: unknown, options: SourceApiOptions = {}): Promise<SourceApiResult> {
  const env = options.env ?? process.env;
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const params = input.params && typeof input.params === 'object' ? input.params as Record<string,unknown> : {};
  const fetcher = options.fetchImpl ?? fetch;
  const secrets = Object.entries(env).filter(([key,value]) => /(?:API_KEY|TOKEN)$/.test(key) && value).map(([,value]) => value!);
  const redact = (text:string) => secrets.reduce((s,key) => s.split(key).join('[REDACTED]').split(encodeURIComponent(key)).join('[REDACTED]'), text);
  let requests = 0, bytes = 0;
  const get = async (url:URL, headers:Record<string,string> = {}) => {
    assertPublicUrl(url.href);
    await options.spaceOut?.(url.host);
    requests++;
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 15000);
    const response = await fetcher(url.href, {method:'GET',headers:{accept:'application/json',...headers},redirect:'error',signal:options.signal ? AbortSignal.any([options.signal,timeout]) : timeout});
    const text = redact(new TextDecoder("utf-8", {fatal:true}).decode(await readCompleteResponse(response,16*1024*1024))); bytes += Buffer.byteLength(text);
    return {status:response.status,text,retryAfter:response.headers.get('retry-after')};
  };
  try {
    let url:URL;
    const headers:Record<string,string> = {};
    if (name === 'data_gov_api' && input.provider !== undefined && !['govinfo','college-scorecard'].includes(String(input.provider))) throw new Error('Unknown Data.gov provider');
    const cfg = name === 'data_gov_api' && input.provider === 'govinfo'
      ? {base:'https://api.govinfo.gov/',key:'DATA_GOV_API_KEY',param:'api_key',path:'collections'} : config[name];
    if (name === 'legistar_api') {
      if (typeof input.tenant !== 'string' || !/^[a-z0-9-]+$/i.test(input.tenant)) throw new Error('Legistar tenant required');
      url = new URL(`https://webapi.legistar.com/v1/${input.tenant}/${typeof input.path === 'string' ? input.path : 'Events'}`);
      if (!url.pathname.startsWith(`/v1/${input.tenant}/`)) throw new Error('Invalid Legistar path');
    } else if (name === 'socrata_api') {
      if (typeof input.domain === 'string' && typeof input.dataset === 'string') {
        if (!/^[a-z0-9.-]+$/i.test(input.domain) || !/^[a-z0-9]{4}-[a-z0-9]{4}$/.test(input.dataset)) throw new Error('Invalid Socrata domain/dataset');
        const catalog = new URL('https://api.us.socrata.com/api/catalog/v1');
        catalog.searchParams.set('search_context',input.domain); catalog.searchParams.set('ids',input.dataset);
        const found = await get(catalog);
        const entries = JSON.parse(found.text).results ?? [];
        if (found.status !== 200 || !entries.some((e:{resource?:{id?:string};metadata?:{domain?:string}}) => e.resource?.id === input.dataset && e.metadata?.domain === input.domain)) throw new Error('Dataset/domain not found in Socrata catalog');
        url = new URL(`https://${input.domain}/resource/${input.dataset}.json`);
        if (env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = env.SOCRATA_APP_TOKEN;
        // SOCRATA_SECRET_TOKEN is an OAuth application secret, not a Basic Auth password.
        // Public dataset reads use the application token; never send its secret to dataset hosts.
      } else url = new URL('https://api.us.socrata.com/api/catalog/v1');
    } else {
      if (!cfg) throw new Error('Unknown source API');
      const key = env[cfg.key]?.trim();
      if (!key) throw new Error(`${cfg.key} is not configured`);
      const path = typeof input.path === 'string' ? input.path.replace(/^\/+/, '') : cfg.path;
      const providerBase = new URL(cfg.base);
      url = new URL(path === 'schools' && name === 'data_gov_api' ? 'schools.json' : path,providerBase);
      if (url.origin !== providerBase.origin || !url.pathname.startsWith(providerBase.pathname)) throw new Error('API path must stay under its provider base');
      if (cfg.header) headers[cfg.header] = (cfg.prefix ?? '') + key;
    }
    for (const [key,value] of Object.entries(params)) {
      if (credentialName.test(key) || typeof value !== 'string') continue;
      url.searchParams.set(key,value);
    }
    if (name === 'google_civic_api' && url.pathname !== '/civicinfo/v2/divisions') throw new Error('Only Civic divisions lookup is supported');
    if (name === 'legiscan_api' && !/^get[A-Z]/.test(url.searchParams.get('op') ?? '')) throw new Error('LegiScan requires a read-only get operation');
    for (const key of [...url.searchParams.keys()]) if (credentialName.test(key)) url.searchParams.delete(key);
    const sourceUrl = url.href;
    if (cfg?.param) url.searchParams.set(cfg.param,env[cfg.key]!);
    const response = await get(url,headers);
    return {...response,sourceUrl,requests,bytes};
  } catch (error) { throw new Error(redact(error instanceof Error ? error.message : String(error))); }
}
