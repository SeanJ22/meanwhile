import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { parseCsv } from "../../reference/csv.ts";
import { detectTenancy } from "../../hunt/platform-tenancy.ts";
import { platformFingerprints } from "../platform-fingerprints.ts";
import { meetingEndpointCandidates, siteOrigins, type MeetingsDiscoveryAttempt } from "../../hunt/meetings-site-discovery.ts";
import { OWN_SITE_MEETINGS_SOURCE, type MeetingsDiscoveryNeed } from "../../hunt/meetings-discovery.ts";
import type { JurisdictionRegistry } from "../../hunt/jurisdiction-universe.ts";
import { newFieldManualEntry, readFieldManual, writeFieldManual, type FieldManualEntry } from "../field-manual.ts";
import { recordAcquisition } from "../evidence/artifact.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { DiscoveryRuntime } from "./meetings-discovery-executor.ts";
import { loadRegistrationReference } from "../../registration/reference.ts";
import { readCensusGovernmentFacts } from "../../registration/jurisdictions.ts";
import { acquireDotGov, type DotGovAcquisition } from "../../civic-data/dotgov-acquisition.ts";
import type { DotGovDomain } from "../../civic-data/dotgov.ts";

const PLATFORM_CENSUS_RECHECK_HOURS = 12;
export const DOTGOV_CENSUS_URL = "https://raw.githubusercontent.com/cisagov/dotgov-data/main/current-full.csv";
type CensusRepos = Pick<ControlPlaneRepositories, "fieldManual">;
export interface PlatformCensusObservation {
  readonly checkedAt: string;
  readonly recheckAfter: string;
  readonly homepage: string;
  readonly artifactId: string | null;
  readonly matches: readonly { readonly platform: string; readonly tenant: string; readonly url: string; readonly basis: string }[];
}
const nextCheck = (now: string) => new Date(Date.parse(now) + PLATFORM_CENSUS_RECHECK_HOURS * 3_600_000).toISOString();
const PLATFORM_OF: Readonly<Record<string, string>> = { "legistar-api": "legistar", "legistar-insite": "legistar", "civicplus-agendacenter": "civicplus", "civicclerk-api": "civicclerk" };
const platformOf = (vendor: string) => PLATFORM_OF[vendor] ?? vendor;
function tenantOf(platform: string, url: string): string {
  const parsed = new URL(url);
  if (platform === "legistar" && parsed.hostname === "webapi.legistar.com") return parsed.pathname.split("/")[2] ?? parsed.hostname;
  if (platform === "boardbook") return /^\/Public\/Organization\/(\d+)/i.exec(parsed.pathname)?.[1] ?? parsed.hostname;
  if (platform === "boarddocs") return parsed.pathname.replace(/\/(?:Board\.nsf|[^/]+\.nsf).*$/i, "").replace(/^\//, "") || parsed.hostname;
  return parsed.hostname.replace(/^www\./, "").replace(/\.(?:portal|api)\.civicclerk\.com$/i, "").replace(/\.(?:legistar|iqm2)\.com$/i, "");
}
export function observePlatformCensus(html: string, homepage: string, artifactId: string | null, checkedAt: string, entries?: readonly FieldManualEntry[]): PlatformCensusObservation {
  const matches = new Map<string, PlatformCensusObservation["matches"][number]>();
  for (const fingerprint of platformFingerprints(entries ?? [])) {
    if (!fingerprint.hostPattern.test(new URL(homepage).hostname)) continue;
    const platform = /(^|\.)boarddocs\.com$/i.test(new URL(homepage).hostname) ? "boarddocs" : fingerprint.id;
    const match = { platform, tenant: tenantOf(platform, homepage), url: homepage, basis: "SERVED_BY" };
    matches.set(`${platform}|${match.tenant}`, match);
  }
  for (const hit of detectTenancy(html, homepage, entries)) {
    if (/VENDOR BOILERPLATE/.test(hit.evidence)) continue;
    let url = homepage;
    if (hit.strength === "LINKED") {
      const linked = /^https?:\/\/\S+/.exec(hit.evidence)?.[0];
      if (linked) url = linked;
    }
    const match = { platform: hit.platform, tenant: tenantOf(hit.platform, url), url, basis: hit.strength };
    matches.set(`${match.platform}|${match.tenant}`, match);
  }
  for (const endpoint of meetingEndpointCandidates(html, homepage, checkedAt, entries)) {
    if (["own-site-meetings-page", "official-page-events", "ical"].includes(endpoint.vendor)) continue;
    const platform = platformOf(endpoint.vendor);
    const match = { platform, tenant: tenantOf(platform, endpoint.url), url: endpoint.url, basis: endpoint.basis };
    matches.set(`${platform}|${match.tenant}`, match);
  }
  return { checkedAt, recheckAfter: nextCheck(checkedAt), homepage, artifactId, matches: [...matches.values()] };
}
export function platformCensusEntry(attempt: MeetingsDiscoveryAttempt, observation: PlatformCensusObservation): FieldManualEntry {
  return newFieldManualEntry("platform-census", attempt.jurisdictionId, {
    role: "SHARED", kind: "PLATFORM_CENSUS", title: `${attempt.jurisdictionId} meeting platforms`,
    summary: `${observation.matches.length} platform tenant(s) found on the recorded website; checked ${observation.checkedAt}.`,
    outcome: observation.matches.length ? "YIELDED" : "ZERO", states: [attempt.stateCode.toLowerCase()],
    platforms: observation.matches.map(match => match.platform), recordClasses: ["meetings"],
    url: observation.homepage, observedAt: observation.checkedAt,
    payload: { jurisdictionId: attempt.jurisdictionId, subjectKind: attempt.jurisdictionId.includes(":domain:") ? "DOMAIN" : attempt.jurisdictionId.includes(":tenant:") ? "TENANT_LEAD" : "GOVERNMENT", ...observation },
  });
}

/** Stream the committed CSV; only the requested state's tenant rows become records. */
function* fileLines(path: string): Generator<string> {
  const fd = openSync(path, "r"), bytes = Buffer.alloc(64 * 1024), decoder = new StringDecoder("utf8");
  let rest = "";
  try {
    for (let n; (n = readSync(fd, bytes, 0, bytes.length, null)) > 0;) {
      rest += decoder.write(bytes.subarray(0, n));
      let end: number;
      while ((end = rest.indexOf("\n")) >= 0) { yield rest.slice(0, end).replace(/\r$/, ""); rest = rest.slice(end + 1); }
    }
    rest += decoder.end();
    if (rest) yield rest;
  } finally { closeSync(fd); }
}
export function referenceTenantLeads(state: string, root = process.cwd()): FieldManualEntry[] {
  const entries: FieldManualEntry[] = [];
  for (const file of ["civicplus_tenants.csv", "granicus_legistar_tenants.csv"]) {
    let header: string[] | undefined;
    for (const line of fileLines(join(root, "data", "reference", file))) {
      const cells = parseCsv(line)[0];
      if (!cells) continue;
      if (!header) { header = cells; continue; }
      const row = Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ""]));
      if ((row.state || "US").toUpperCase() !== state.toUpperCase() || /CANADA/i.test(row.country)) continue;
      if (!siteOrigins(row.portal_url).length) continue;
      const platform = file.startsWith("civicplus") ? "civicplus" : "legistar";
      entries.push(newFieldManualEntry(`data/reference/${file}`, row.portal_url, {
        role: "SHARED", kind: "MEETINGS_TENANT_LEAD", title: row.jurisdiction_name || row.client_slug,
        summary: `${platform} starting lead from ${file}; the government's own page must identify its portal.`,
        states: [state.toLowerCase()], platforms: [platform], recordClasses: ["meetings"], outcome: "REFERENCE",
        url: row.portal_url, payload: row,
      }));
    }
  }
  return entries;
}
/** A .gov domain is a source lead, never a fabricated government/body pairing. */
export function dotgovDomainLeads(csv: string, state: string): FieldManualEntry[] {
  const entries: FieldManualEntry[] = [];
  let header: string[] | undefined;
  for (const line of csv.matchAll(/[^\r\n]+/g)) {
    const cells = parseCsv(line[0])[0];
    if (!cells) continue;
    if (!header) {
      header = cells;
      if (header[0] !== "Domain name" || !header.includes("State")) throw new Error("CISA domain census columns changed");
      continue;
    }
    const row = Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ""]));
    const postal = /^[A-Z]{2}$/.test(row.State) ? row.State : "US";
    const domain = row["Domain name"].toLowerCase();
    if (postal !== state.toUpperCase() || !/^[a-z0-9-]+\.gov$/.test(domain)) continue;
    entries.push(newFieldManualEntry("cisa-dotgov-census", domain, {
      role: "SHARED", kind: "PLATFORM_CENSUS_DOMAIN", title: row["Organization name"] || domain,
      summary: `${domain}: official domain listed by CISA.`, states: [postal.toLowerCase()], recordClasses: ["meetings"],
      outcome: "REFERENCE", url: `https://${domain}/`, payload: { domain, state: postal, organization: row["Organization name"], city: row.City, source: DOTGOV_CENSUS_URL },
    }));
  }
  if (!header) throw new Error("CISA domain census returned no header");
  return entries;
}

function domainLeads(rows: readonly DotGovDomain[], state: string): FieldManualEntry[] {
  return rows.filter(row => /^[a-z0-9-]+\.gov$/.test(row.domain)).map(row => newFieldManualEntry("cisa-dotgov-census", row.domain, {
    role: "SHARED", kind: "PLATFORM_CENSUS_DOMAIN", title: row.organization || row.domain,
    summary: `${row.domain}: official domain listed by CISA.`, states: [state.toLowerCase()], recordClasses: ["meetings"],
    outcome: "REFERENCE", url: `https://${row.domain}/`, payload: { domain: row.domain, state, organization: row.organization, city: row.city, source: DOTGOV_CENSUS_URL },
  }));
}

export async function refreshDotgovCensusLeads(repos: CensusRepos, runtime: DiscoveryRuntime, state: string,
  sharedSource?: () => Promise<DotGovAcquisition>): Promise<void> {
  const marker = newFieldManualEntry("platform-census-reference", state.toLowerCase(), { role: "SHARED", kind: "PLATFORM_CENSUS_REFERENCE", title: `${state} census inputs`, summary: "Standing census inputs", outcome: "REFERENCE" });
  const prior = (await repos.fieldManual.readMany([marker.id]))[0];
  if (prior?.value.observedAt && Date.parse(nextCheck(prior.value.observedAt)) > Date.parse(runtime.now())) return;
  const seeds = await writeFieldManual(repos, referenceTenantLeads(state), runtime.now());
  if (seeds.error) throw new Error(seeds.error);
  if (runtime.budget.spent()) return;
  await runtime.spaceOut(new URL(DOTGOV_CENSUS_URL).hostname);
  const timeoutMs = Math.max(1, Math.min(runtime.timeoutMs ?? 20_000, runtime.budget.remainingMs?.() ?? 20_000));
  const source = await (sharedSource?.() ?? acquireDotGov(AbortSignal.timeout(timeoutMs)));
  try {
    const postal = state.toUpperCase(), snapshot = source.snapshot(postal), csv = source.csv(postal);
    const acquired = recordAcquisition({ canonicalUrl: source.finalUrl, retrievedAt: source.retrievedAt, httpStatus: 200, contentType: "text/csv",
      sourceId: "cisa-dotgov-registry", workItemId: `platform-census-${state.toLowerCase()}`, attemptId: `platform-census-${state.toLowerCase()}-${runtime.now()}`,
      methodRouteId: "platform-census:dotgov-state", permission: "ALLOWED", transport: "REACHABLE",
      headers: { "x-meanwhile-source-state": postal, "x-meanwhile-source-sha256": source.rawHash, "x-meanwhile-source-projection": "selected CSV rows" } }, csv);
    const stored = await runtime.vault(acquired.artifact, csv);
    if (!stored.stored) throw new Error(`CISA census evidence could not be saved: ${stored.why}`);
    const saved = await writeFieldManual(repos, domainLeads(snapshot.domains, postal).map(entry => ({ ...entry, observedAt: runtime.now() })), runtime.now());
    if (saved.error) throw new Error(saved.error);
    const marked = await writeFieldManual(repos, [{ ...marker, states: [state.toLowerCase()], observedAt: runtime.now(), payload: {
      source: source.finalUrl, sourceDocumentSha256: source.rawHash, sourceRevision: source.sourceSha,
      artifactId: acquired.artifact.id, sha256: createHash("sha256").update(csv).digest("hex") } }], runtime.now());
    if (marked.error) throw new Error(marked.error);
  } finally { if (!sharedSource) await source.dispose(); }
}

export function heldCensusWebsiteNeeds(state: string, root = process.cwd()): MeetingsDiscoveryNeed[] {
  if (state.toUpperCase() === "US") return [];
  const loaded = loadRegistrationReference(root, state);
  const facts = readCensusGovernmentFacts(root, [state]);
  return loaded.reference.governments.flatMap(([pid, jurisdictionId, name, govClass]) => {
    const fact = facts.byPid.get(pid);
    const website = fact?.web || null;
    return [{ jurisdictionId, stateCode: state.toUpperCase(), name, govClass, countyFips: fact?.countyFips,
      city: fact?.city, countyName: fact?.county, ownWebAddress: website, basis: "SOURCE_DISCOVERY_OWED" as const, sources: [OWN_SITE_MEETINGS_SOURCE] }];
  });
}
export async function readPlatformCensusNeeds(state: string, registry: JurisdictionRegistry | null, input: { repos: CensusRepos; root?: string; census?: typeof heldCensusWebsiteNeeds; reviewedVersionId?: string | null }): Promise<{ needs: MeetingsDiscoveryNeed[]; failures: string[] }> {
  const needs: MeetingsDiscoveryNeed[] = [];
  const failures: string[] = [];
  const hosts = new Set<string>();
  for (const row of registry?.jurisdictions ?? []) {
    const origin = siteOrigins(row.ownWebAddress)[0];
    if (origin) hosts.add(new URL(origin).hostname.replace(/^www\./, ""));
    needs.push({ jurisdictionId: row.id, ...(row.bodyId ? { bodyIds: [row.bodyId] } : {}), stateCode: row.stateCode, name: row.name, govClass: row.govClass, countyFips: row.countyFips, countyName: row.countyName,
      ownWebAddress: row.ownWebAddress, basis: "SOURCE_DISCOVERY_OWED", sources: [OWN_SITE_MEETINGS_SOURCE],
      addressSource: registry?.registration ? { source: "REGISTRATION", versionId: registry.registration.versionId } : { source: "OPERATIONAL_REFERENCE", versionId: input.reviewedVersionId ?? null } });
  }
  if (registry === null) {
    try {
      for (const need of (input.census ?? heldCensusWebsiteNeeds)(state, input.root)) {
        needs.push(need);
        const origin = siteOrigins(need.ownWebAddress)[0];
        if (origin) hosts.add(new URL(origin).hostname.replace(/^www\./, ""));
      }
    } catch (error) { failures.push(`Held ${state.toUpperCase()} Census websites could not be read: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const domains = await readFieldManual(input.repos, { kinds: ["PLATFORM_CENSUS_DOMAIN"], state: state.toLowerCase(), withinState: state });
  for (const entry of domains.store.entries) {
    if (!entry.url) continue;
    const hostname = new URL(entry.url).hostname;
    if (hosts.has(hostname)) continue;
    needs.push({ jurisdictionId: `${state.toLowerCase()}:domain:${hostname}`, stateCode: state.toUpperCase(), name: entry.title,
      govClass: "DOMAIN", ownWebAddress: entry.url, basis: "SOURCE_DISCOVERY_OWED", sources: [OWN_SITE_MEETINGS_SOURCE] });
  }
  const tenants = await readFieldManual(input.repos, { kinds: ["MEETINGS_TENANT_LEAD"], state: state.toLowerCase(), withinState: state });
  for (const entry of tenants.store.entries) {
    if (!entry.url) continue;
    const origin = siteOrigins(entry.url)[0];
    if (!origin || hosts.has(new URL(origin).hostname.replace(/^www\./, ""))) continue;
    hosts.add(new URL(origin).hostname.replace(/^www\./, ""));
    needs.push({ jurisdictionId: `${state.toLowerCase()}:tenant:${createHash("sha256").update(entry.url).digest("hex").slice(0, 16)}`, stateCode: state.toUpperCase(), name: entry.title,
      govClass: "TENANT_LEAD", ownWebAddress: entry.url, basis: "SOURCE_DISCOVERY_OWED", sources: [OWN_SITE_MEETINGS_SOURCE] });
  }
  return { needs, failures: [...failures, ...[domains.error, tenants.error].filter((error): error is string => Boolean(error))] };
}
