import { createHash } from "node:crypto";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import jurisdictionLabels from "../../../data/reference/us-jurisdiction-labels.json" with { type: "json" };
import { pacedPortraitAcquire } from "../../photos/portrait-work.ts";
import type { Officeholder, OfficeholderSet } from "../../officials/types.ts";
import type { StatePeopleAcquisition } from "../../civic-data/state-people-publication.ts";
import { readSourceApi, type SourceApiTool } from "../../control-plane/scheduler/scout-api.ts";
import { acquireKnownRelease, knownReleaseSourceCheck, type KnownRelease, type KnownReleaseOptions } from "../known-release.ts";
import type { RegistryDivisionLite } from "../plural/index.ts";
import type { Provenance } from "../types.ts";
import { mergePeopleSets } from "../../officials/merge-people.ts";

export const PEOPLE_SOURCE_DEFINITIONS = [
  { id: "legiscan-api", parserVersion: "legiscan-people/1", url: "https://api.legiscan.com/?op=getSessionList" },
  { id: "official-state-people", parserVersion: "official-legislature-people/1", url: "https://v3.openstates.org/jurisdictions" },
  { id: "congress-api", parserVersion: "congress-members/1", url: "https://api.congress.gov/v3/member?currentMember=true&format=json" },
  { id: "govinfo", parserVersion: "govinfo-cdir-people/1", url: "https://api.govinfo.gov/collections/CDIR" },
  { id: "wikidata-people", parserVersion: "wikidata-people/1", url: "https://query.wikidata.org/sparql" },
] as const;
export type PeopleSourceId = typeof PEOPLE_SOURCE_DEFINITIONS[number]["id"];
export interface PeopleAcquisitionOptions extends Pick<KnownReleaseOptions, "store" | "locks" | "fetchImpl" | "now"> {
  readonly sourceId: PeopleSourceId;
  readonly state: string;
  readonly asOf: string;
  readonly signal: AbortSignal;
  readonly roster?: OfficeholderSet;
  readonly divisions?: readonly RegistryDivisionLite[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Test injection keeps the same saved-source contract. */
  readonly acquire?: typeof acquireKnownRelease;
  /** Publish an accepted source delta before the rest of this source's standing read finishes. */
  readonly onPerson?: (release: PeopleSourceRelease) => Promise<void>;
  readonly linkingPages?: readonly import("../../civic-data/source-authority.ts").OfficialLinkingPage[];
}
export interface PeopleSourceRelease {
  readonly sourceId: PeopleSourceId;
  readonly state: string;
  readonly releaseId: string;
  readonly roster: OfficeholderSet;
  readonly acquisitions: readonly StatePeopleAcquisition[];
  readonly gaps: readonly { sourceUrl: string; detail: string }[];
  readonly coverage: { state: string; sourceId: PeopleSourceId; people: number; legislators: number; officers: number; photos: number; disagreements: number };
}
export const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const string = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
export const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export function stateIdentity(value: string) {
  const label = jurisdictionLabels.jurisdictions.find(row => row.name.toLowerCase() === value.toLowerCase() || row.postal.toLowerCase() === value.toLowerCase() || row.fips === value);
  const entry = Object.entries(FIPS_TO_STATE).find(([fips, state]) => state.postal.toLowerCase() === value.toLowerCase() || fips === value || state.postal === label?.postal);
  if (!entry) throw new Error(`PEOPLE_STATE_UNRESOLVED:${value}`);
  const [scope, state] = entry;
  return { state: state.postal, scope, label: label?.name ?? state.postal, jurisdiction: `US-${state.postal}`, root: `ocd-division/country:us/${state.prefix}:${state.postal.toLowerCase()}` };
}
export function provenance(sourceUrl: string, sourceOrg: string, collectedAt: string, quote?: string): Provenance {
  return { sourceUrl, sourceOrg, collectedAt, verifiedAt: collectedAt, ...(quote ? { quote } : {}) };
}
export function sourced(holder: Officeholder, source: Provenance): Officeholder {
  holder.fieldSources = Object.fromEntries(Object.entries(holder).filter(([key, value]) => value !== null && value !== undefined && value !== "" && !["fieldSources", "provenance", "photo"].includes(key)).map(([key]) => [key, source]));
  return holder;
}
export function emptyPerson(id: string, name: string, officeTitle: string, state: string, source: Provenance): Officeholder {
  return { id, personId: id, name, officeTitle, level: "STATE", state: state.toUpperCase(), termStart: "", termEnd: "", birthDate: null, partyLabel: null,
    websiteUrl: null, contactFormUrl: null, phone: null, email: null, campaignUrl: null, photo: null, provenance: source };
}
export function emptyRoster(state: string, asOf: string): OfficeholderSet {
  return { scope: stateIdentity(state).scope, generatedAt: asOf, officeholders: [], divisions: [], unmatched: [] };
}
export function result(options: PeopleAcquisitionOptions, roster: OfficeholderSet, acquisitions: StatePeopleAcquisition[], gaps: { sourceUrl: string; detail: string }[]): PeopleSourceRelease {
  return { sourceId: options.sourceId, state: options.state.toLowerCase(), releaseId: digest(acquisitions.map(row => `${row.finalUrl}:${row.rawHash}`).join("\n")), roster, acquisitions, gaps,
    coverage: { state: options.state.toUpperCase(), sourceId: options.sourceId, people: roster.officeholders.length,
      legislators: roster.officeholders.filter(row => row.level === "STATE" && ["upper", "lower", "legislature"].includes(row.chamber ?? "")).length,
      officers: roster.officeholders.filter(row => row.level === "STATE" && !row.chamber).length,
      photos: roster.officeholders.filter(row => row.photo).length, disagreements: roster.disagreements?.length ?? 0 } };
}
/** Preserve every source-native tenure and conflict when one publisher lists a person more than once. */
export function appendRoster(target:OfficeholderSet,next:OfficeholderSet):void {Object.assign(target,mergePeopleSets([target,next]));}
export function acquisition(release: KnownRelease): StatePeopleAcquisition {
  return { requestedUrl: release.requestedUrl, finalUrl: release.finalUrl, httpStatus: release.httpStatus,
    body: new TextDecoder("utf-8", { fatal: true }).decode(release.bytes), retrievedAt: release.retrievedAt, rawHash: release.sha256,
    sourceCheck: knownReleaseSourceCheck(release), ...(release.vaultKey ? { vaultKey: release.vaultKey } : {}) };
}
export async function savedRead(options: PeopleAcquisitionOptions, url: string, releaseId: string, validate?: KnownReleaseOptions["validate"], api?: { name: SourceApiTool; path: string; params?: Record<string, string>; provider?: string }): Promise<KnownRelease> {
  const definition = PEOPLE_SOURCE_DEFINITIONS.find(source => source.id === options.sourceId)!;
  const requested=new URL(url);if(requested.protocol==="http:")requested.protocol="https:";requested.hash="";
  const publicFetch:typeof fetch|undefined=requested.hostname==="query.wikidata.org"&&requested.pathname==="/sparql"?async(resource,init)=>{
    const endpoint=new URL(String(resource)),body=endpoint.searchParams.toString();endpoint.search="";
    const headers=new Headers(init?.headers);headers.set("content-type","application/x-www-form-urlencoded");headers.set("accept","application/sparql-results+json");
    return (options.fetchImpl??fetch)(endpoint.href,{...init,method:"POST",headers,body});
  }:options.fetchImpl;
  return (options.acquire ?? pacedPortraitAcquire)({ sourceId: options.sourceId, releaseId, url:requested.href, parserVersion: definition.parserVersion,
    signal: options.signal, maxBytes: 16 * 1024 * 1024, checkAfterMs: 86_400_000, now: options.now ?? (() => options.asOf),
    store: options.store, locks: options.locks, validate, fetchImpl: api ? async (_resource, init) => {
      const response = await readSourceApi(api.name, { path: api.path, params: api.params, ...(api.provider ? { provider: api.provider } : {}) },
        { env: options.env, fetchImpl: options.fetchImpl, signal: init?.signal ?? options.signal, timeoutMs: 60_000 });
      return new Response(response.text, { status: response.status, headers: { "content-type": "application/json",...(response.retryAfter ? {"retry-after":response.retryAfter} : {}) } });
    } : publicFetch });
}
export function json(release: KnownRelease): Record<string, unknown> { return record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(release.bytes))); }
export function gap(gaps: { sourceUrl: string; detail: string }[], options: PeopleAcquisitionOptions, sourceUrl: string, error: unknown): void {
  options.signal.throwIfAborted();
  const secrets = Object.entries(options.env ?? process.env).filter(([key, value]) => /(?:API_KEY|TOKEN)$/.test(key) && value).map(([, value]) => value!);
  const detail = secrets.reduce((text, secret) => text.split(secret).join("[REDACTED]").split(encodeURIComponent(secret)).join("[REDACTED]"), error instanceof Error ? error.message : String(error));
  gaps.push({ sourceUrl, detail: `${options.sourceId.toUpperCase().replace(/-/g, "_")}_SOURCE_GAP:${detail}` });
}
export function url(value: unknown): string | null {
  const text = string(value); if (!text) return null;
  try {
    const parsed = new URL(text);
    if(!["https:","http:"].includes(parsed.protocol)||parsed.username||parsed.password)return null;
    if(parsed.protocol==="http:")parsed.protocol="https:";parsed.hash="";
    for(const key of [...parsed.searchParams.keys()])if(/^(api[_-]?key|key|apikey|token|access_token|secret)$/i.test(key))parsed.searchParams.delete(key);
    return parsed.href;
  } catch { return null; }
}
export function legislativeDivision(options: PeopleAcquisitionOptions, chamber: string, district: string): string | undefined {
  const state = stateIdentity(options.state);
  const normalized = district.toLowerCase().replace(/^(?:house|senate|assembly|district|hd|sd|ad)[\s-]*/g, "").replace(/^0+(?=\d)/, "").trim();
  return options.divisions?.find(row => row.divisionType === (chamber === "upper" ? "sldu" : "sldl") &&
    row.ocdId.startsWith(`${state.root}/`) && (row.ocdId.split(":").at(-1)?.toLowerCase() === normalized || row.label?.toLowerCase().replace(/^.*district\s*/, "") === normalized))?.ocdId;
}
