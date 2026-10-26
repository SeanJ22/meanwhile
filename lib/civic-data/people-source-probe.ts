import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "./changes.ts";
import { confirmSourceHashUnchanged, sourceContentHash, type SourceHashConfirmation } from "./source-hash.ts";
import { peopleNormalizationInputHash } from "./people-source-hash.ts";
import type { RoutineDataStore } from "./store.ts";
import type { RoutineRecordClass } from "./types.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import { statePeopleSourcePointers } from "../officials/people-identity.ts";
import { peopleSourceRecordClass, peopleSourceScope } from "../officials/people-sources.ts";
import { peopleJurisdiction } from "./people-source-read.ts";
import { sourceAuthority } from "./source-authority.ts";
import { officialLegislatureRosterRoutes } from "../sources/people/roster-routes.ts";
import { STATEWIDE_REFERENCE_SOURCES } from "../sources/statewide/reference.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "../census-geography/publication.ts";
import { pacedPortraitAcquire } from "../photos/portrait-work.ts";
import { knownReleaseSourceCheck, type KnownRelease, type KnownReleaseOptions } from "../sources/known-release.ts";
import type { ExecutiveSourceCredentials } from "../sources/white-house/presidential-records.ts";
import type { StatePeopleAcquisition } from "./state-people-publication.ts";

type SourceDependencies = Readonly<Record<string, readonly [string, string | null, string | null, string] | null>>;
type SourceRequest = Pick<StatePeopleAcquisition, "requestedUrl" | "finalUrl" | "request">;
export interface PeopleSourceProbe {
  readonly formatVersion: 1;
  readonly complete: boolean;
  readonly sourceId: string;
  readonly state: string;
  readonly normalizationInputHash: string;
  readonly requests: readonly SourceRequest[];
  readonly dependencies: SourceDependencies;
  readonly discovery: string;
  readonly nextTermAt: string | null;
}
const hash = (value: unknown) => createHash("sha256").update(canonicalCivicDataJson(value)).digest("hex");

function discoveryInputs(state: string, sourceId: string, at: string): string {
  return hash({ sourceId, parser: sourceAuthority(sourceId)?.parserVersion,
    officialRosters: sourceId === "official-state-people" ? officialLegislatureRosterRoutes(state) : null,
    statewideDirectories: sourceId === "statewide-executive-sources" ? STATEWIDE_REFERENCE_SOURCES : null,
    // National activity query ranges and annual cycles are rebuilt on their real day change.
    nationalDay: state.toLowerCase() === "us" ? at.slice(0,10) : null });
}

/** Inputs determine which people, source routes and districts the next parse must consider. */
export async function readPeopleSourceDependencies(store: RoutineDataStore, state: string, sourceId: string): Promise<SourceDependencies> {
  const jurisdiction = peopleJurisdiction(state), own = `${peopleSourceRecordClass(sourceId)}:${peopleSourceScope(jurisdiction,sourceId)}`;
  const pointers: readonly { readonly recordClass: RoutineRecordClass; readonly scope: string }[] = [
    ...statePeopleSourcePointers(jurisdiction), { recordClass: CENSUS_GEO_RECORD_CLASS, scope: CENSUS_GEO_SCOPE },
  ];
  const entries = await Promise.all(pointers.filter(pointer => `${pointer.recordClass}:${pointer.scope}` !== own).map(async pointer => {
    const head = await store.readSourceHead(pointer.recordClass,pointer.scope);
    return [`${pointer.recordClass}:${pointer.scope}`, head ? [head.versionId,head.rawHash,head.normalizedHash,head.parserVersion] as const : null] as const;
  }));
  return Object.fromEntries(entries);
}

export function peopleSourceProbe(input: {
  readonly sourceId: string; readonly state: string; readonly roster: OfficeholderSet;
  readonly acquisitions: readonly StatePeopleAcquisition[]; readonly gaps: readonly unknown[];
  readonly dependencies: SourceDependencies; readonly now: string; readonly complete: boolean;
}): PeopleSourceProbe {
  const terms = input.roster.officeholders.flatMap(person => [person.termStart,person.termEnd,
    ...(person.memberships ?? []).flatMap(membership => [membership.termStart,membership.termEnd])])
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.parse(input.now))
    .map(value => new Date(value).toISOString()).sort();
  return { formatVersion: 1, sourceId: input.sourceId, state: input.state,
    complete: input.complete && input.acquisitions.length > 0 && !input.gaps.length &&
      input.acquisitions.every(page => page.httpStatus >= 200 && page.httpStatus < 300 && page.body.length > 0),
    normalizationInputHash: peopleNormalizationInputHash(input.roster),
    requests: [...new Map(input.acquisitions.map(({ requestedUrl,finalUrl,request }) =>
      [canonicalCivicDataJson([requestedUrl,request ?? null]),{requestedUrl,finalUrl,...(request ? {request} : {})}])).values()],
    dependencies: input.dependencies, discovery: discoveryInputs(input.state,input.sourceId,input.now), nextTermAt: terms[0] ?? null };
}

function currentRequest(request: SourceRequest, at: string): SourceRequest {
  const requested = new URL(request.requestedUrl), final = new URL(request.finalUrl);
  for (const url of [requested,final]) if (url.hostname === "query.wikidata.org" && url.pathname === "/sparql" && url.searchParams.has("query"))
    url.searchParams.set("query",url.searchParams.get("query")!.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, `${at.slice(0,10)}T00:00:00.000Z`));
  return { ...request,requestedUrl:requested.href,finalUrl:final.href };
}

export interface ProbedSource { readonly request: SourceRequest; readonly release: KnownRelease }
export type PeopleSourceProbeAcquire = (request: SourceRequest, signal: AbortSignal, now: string) => Promise<KnownRelease>;
export async function acquirePeopleSourceProbe(input: {
  readonly request: SourceRequest; readonly state: string; readonly sourceId: string;
  readonly signal: AbortSignal; readonly now: string; readonly credentials?: ExecutiveSourceCredentials;
}): Promise<KnownRelease> {
  const url = new URL(input.request.requestedUrl), headers = new Headers({ accept: "text/html,application/json,application/xml" });
  if (url.hostname === "query.wikidata.org" && url.pathname === "/sparql") headers.set("accept","application/sparql-results+json");
  else if (["api.congress.gov","api.open.fec.gov","www.wikidata.org","commons.wikimedia.org","www.federalregister.gov"].includes(url.hostname)) headers.set("accept","application/json");
  else if (input.sourceId === "official-state-people" || input.state.toLowerCase() !== "us") headers.set("accept","text/html");
  const key = url.hostname === "api.congress.gov" ? input.credentials?.congress : url.hostname === "api.open.fec.gov" ? input.credentials?.fec : undefined;
  if (["api.congress.gov","api.open.fec.gov"].includes(url.hostname) && !key) throw new Error("PEOPLE_SOURCE_PROBE_CREDENTIAL_UNAVAILABLE");
  if (key) headers.set("X-Api-Key",key);
  if (input.request.request) headers.set("content-type","application/json");
  const fetchImpl: typeof fetch | undefined = input.request.request ? (resource,init) => fetch(resource,{...init,method:"POST",body:JSON.stringify(input.request.request!.body)})
    : url.hostname === "query.wikidata.org" && url.pathname === "/sparql" ? (resource,init) => {
      const endpoint = new URL(String(resource)), body = endpoint.searchParams.toString(); endpoint.search = "";
      const requestHeaders = new Headers(init?.headers); requestHeaders.set("content-type","application/x-www-form-urlencoded");
      return fetch(endpoint,{...init,method:"POST",headers:requestHeaders,body});
    } : undefined;
  return pacedPortraitAcquire({ sourceId: input.sourceId, releaseId: `source-probe:${input.state}:${hash(input.request)}`,
    url: input.request.requestedUrl, parserVersion: sourceAuthority(input.sourceId)?.parserVersion ?? "people-sources/1",
    signal: input.signal, now: () => input.now, maxBytes: 16 * 1024 * 1024, checkAfterMs: 0, refresh: true, headers, fetchImpl,
    allowedHosts: [...new Set([url.hostname,new URL(input.request.finalUrl).hostname])] });
}

/** Re-read every discovery page and saved request before opening a held roster. A changed plan always parses normally. */
export async function probePeopleSource(input: {
  readonly store: RoutineDataStore; readonly sourceId: string; readonly state: string; readonly now: string;
  readonly signal: AbortSignal; readonly dependencies: SourceDependencies; readonly acquire: PeopleSourceProbeAcquire;
}): Promise<{ readonly confirmed: SourceHashConfirmation | null; readonly sources: readonly ProbedSource[] }> {
  const jurisdiction = peopleJurisdiction(input.state), recordClass = peopleSourceRecordClass(input.sourceId), scope = peopleSourceScope(jurisdiction,input.sourceId);
  const head = await input.store.readSourceHead(recordClass,scope);
  if (!head || head.rawHashBasis !== "SOURCE_CONTENT_V1" || head.imported || head.candidateState !== "PROMOTED") return {confirmed:null,sources:[]};
  const plan = await input.store.readCandidatePath<PeopleSourceProbe>(head.versionId,["normalizedPayload","sourceProbe"]);
  if (!plan || plan.formatVersion !== 1 || !plan.complete || plan.sourceId !== input.sourceId || plan.state !== input.state ||
    !plan.requests.length || plan.discovery !== discoveryInputs(input.state,input.sourceId,input.now) ||
    canonicalCivicDataJson(plan.dependencies) !== canonicalCivicDataJson(input.dependencies) ||
    plan.nextTermAt && Date.parse(plan.nextTermAt) <= Date.parse(input.now)) return {confirmed:null,sources:[]};
  const sources: ProbedSource[] = [], pages: StatePeopleAcquisition[] = [];
  for (const priorRequest of plan.requests) {
    input.signal.throwIfAborted();
    const request = currentRequest(priorRequest,input.now);
    try {
      const release = await input.acquire(request,input.signal,input.now);
      if (release.outage || release.httpStatus < 200 || release.httpStatus >= 300 || !release.bytes.length) return {confirmed:null,sources};
      sources.push({request,release});
      pages.push({ ...request,requestedUrl:release.requestedUrl,finalUrl:release.finalUrl,httpStatus:release.httpStatus,
        body: new TextDecoder("utf-8",{fatal:true}).decode(release.bytes),retrievedAt:release.retrievedAt,rawHash:release.sha256,sourceCheck:knownReleaseSourceCheck(release) });
    } catch { input.signal.throwIfAborted(); return {confirmed:null,sources}; }
  }
  const rawHash = sourceContentHash(pages,{normalizationInputHash:plan.normalizationInputHash});
  const first = pages[0], check = pages.map(page => page.sourceCheck!).sort((a,b) => a.checkedAt.localeCompare(b.checkedAt))[0];
  const confirmed = await confirmSourceHashUnchanged({store:input.store,sourceId:input.sourceId,recordClass,scope,
    parserVersion:sourceAuthority(input.sourceId)?.parserVersion ?? "people-sources/1",rawHash,now:input.now,complete:true,
    retrieval:{requestedUrl:first.requestedUrl,finalUrl:first.finalUrl,httpStatus:first.httpStatus,rawHash,
      retrievedAt:pages.map(page=>page.retrievedAt).sort().at(-1)!,sourceCheck:check} });
  return {confirmed,sources};
}

/** Changed probe bytes are the next parser's inputs too, so an older release cache cannot undo the observation. */
export function reuseProbedPeopleSources(sources: readonly ProbedSource[], acquire: (options: KnownReleaseOptions) => Promise<KnownRelease> = pacedPortraitAcquire) {
  return async (options: KnownReleaseOptions): Promise<KnownRelease> => {
    const matches = sources.filter(source => source.request.requestedUrl === options.url || source.release.finalUrl === options.url);
    const selected = matches.length === 1 ? matches[0] : matches.find(source => source.request.request && options.releaseId.endsWith(hash(source.request.request)));
    if (!selected) return acquire(sources.length ? {...options,refresh:true} : options);
    options.signal.throwIfAborted();
    const release = {...selected.release,sourceId:options.sourceId,releaseId:options.releaseId};
    try { await options.validate?.(release.bytes,release); }
    catch { return acquire({...options,refresh:true}); }
    return release;
  };
}
