import { csvRows } from "../../reference/csv.ts";
import { matchPlatformGovernment, type PlatformTenant } from "./platform-enumeration.ts";
import type { MeetingsDiscoveryNeed } from "../../hunt/meetings-discovery.ts";
import { platformGovernmentCandidates, type PlatformQuery } from "./platform-registration.ts";
import type { DiscoveryRuntime } from "./meetings-discovery-executor.ts";
import { pageLinks } from "../../hunt/meetings-site-discovery.ts";
import { DEFAULT_USER_AGENT } from "../scheduler/route-executor.ts";
import { US_STATES } from "../readiness/catalog.ts";
import { assertPublicUrl } from "../../hunt/egress.ts";
import { createHash } from "node:crypto";
import { recordAcquisition, deriveSanitized } from "../evidence/artifact.ts";

/** Public client identifiers maintained by the Legistar API library; they select routes, never government identity. */
export const LEGISTAR_CLIENT_CATALOG_URL = "https://docs.google.com/spreadsheets/d/1Py-Oqyb8kW13x0_BjGJS-fw1EdZzqBeIsjxvQvBV5dM/gviz/tq?tqx=out:csv&sheet=clients";

export function* legistarClientCatalog(csv: string): Generator<PlatformTenant> {
  let header = true;
  for (const row of csvRows(csv)) {
    if (header) { if (row[0] !== "clients") throw new Error("Legistar client directory columns changed"); header = false; continue; }
    if (!/^[a-z0-9_-]+$/i.test(row[0])) continue;
    yield { platform: "legistar", url: `https://${row[0]}.legistar.com/Calendar.aspx`, name: null, state: null, source: LEGISTAR_CLIENT_CATALOG_URL };
  }
  if (header) throw new Error("Legistar client directory has no header");
}

/** CISA explicitly names the registered .gov organization and state; a domain is never converted into a guessed government. */
export function* dotgovPlatformTenants(csv: string, sourceVersion: string): Generator<PlatformTenant> {
  let header: string[] | undefined;
  for (const cells of csvRows(csv)) {
    if (!header) { header = cells; if (header[0] !== "Domain name" || !header.includes("State")) throw new Error("CISA domain directory columns changed"); continue; }
    const row = Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ""]));
    const domain = row["Domain name"].toLowerCase(), state = row.State.toUpperCase();
    if (!/^[a-z0-9-]+\.gov$/.test(domain) || !US_STATES.some(value => value.code.toUpperCase() === state) || !row["Organization name"].trim()) continue;
    yield { platform: "government-website", url: `https://${domain}/`, name: row["Organization name"], state,
      source: "https://raw.githubusercontent.com/cisagov/dotgov-data/main/current-full.csv", sourceVersion };
  }
  if (!header) throw new Error("CISA domain directory has no header");
}

/** An ordered government with a missing website uses its exact held CISA identity immediately. */
export function dotgovTenantForGovernment(csv: string, sourceVersion: string, need: MeetingsDiscoveryNeed): PlatformTenant | undefined {
  if (need.ownWebAddress) return undefined;
  let selected: PlatformTenant | undefined;
  for (const tenant of dotgovPlatformTenants(csv, sourceVersion)) {
    const match = matchPlatformGovernment(tenant, [need]);
    if (match.kind !== "MATCHED" && match.kind !== "CANDIDATE") continue;
    if (selected && selected.url !== tenant.url) return undefined;
    selected = tenant;
  }
  return selected;
}

/** A portal's printed publisher name selects candidates; its calendar still needs the government's saved link. */
export function platformPublisherNames(html: string): string[] {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim() ?? "";
  return title.split(/\s+[-–|•]\s+/).filter(name => name.trim()
    && !/\b(?:calendar|legislation|meetings|home|sign in|civicengage|civicplus|access denied|just a moment|error|agenda\s?center)\b/i.test(name)
    && !/^(?:city council|town council|council|board of commissioners|board of education)$/i.test(name));
}

export function platformPublisherIdentity(name: string) {
  const parts = name.split(/,\s*/);
  const state = US_STATES.find(state => parts.at(-1)?.toLowerCase() === state.name.toLowerCase() || parts.at(-1)?.toUpperCase() === state.code.toUpperCase());
  return { name: state ? parts.slice(0, -1).join(", ") : name, state: state?.code.toUpperCase() ?? null };
}

/** A public directory is a lead. Read its publisher and native registry before choosing one government. */
export async function registeredPlatformTenant(query: PlatformQuery, tenant: PlatformTenant, runtime: DiscoveryRuntime) {
  const read = async (first: string) => {
    let url = first;
    for (let hops = 0; hops <= 6; hops++) {
      if (runtime.budget.spent()) throw new Error("Platform directory reading interrupted");
      assertPublicUrl(url);
      await runtime.spaceOut(new URL(url).hostname);
      let page;
      try { page = await runtime.open({ url, headers: { "user-agent": DEFAULT_USER_AGENT }, timeoutMs: runtime.timeoutMs ?? 20_000 }); }
      catch (error) { if (runtime.budget.spent()) throw error; return null; }
      if (page.status && page.status >= 300 && page.status < 400 && page.location) { url = new URL(page.location,url).href; continue; }
      if (page.status !== 200 || page.transportError) return null;
      const at = page.retrievedAt ?? runtime.now();
      const acquired = recordAcquisition({ canonicalUrl: url, retrievedAt: at, httpStatus: 200, contentType: page.contentType,
        sourceId: "platform-census", workItemId: `platform-tenant:${createHash("sha256").update(tenant.url).digest("hex").slice(0, 20)}`,
        attemptId: `platform-tenant:${url}:${at}`, methodRouteId: "public-customer-directory", permission: "ALLOWED", transport: "REACHABLE" }, page.body);
      const readable = acquired.artifact.tier === "RESTRICTED_RAW" ? deriveSanitized(acquired.artifact,page.body,at) : { artifact: acquired.artifact,text:page.body };
      const stored = await runtime.vault(readable.artifact,readable.text);
      if (!stored.stored) throw new Error(stored.why);
      return {url,text:readable.text};
    }
    return null;
  };
  const portal = await read(tenant.url);
  if (portal) {
    // A source's own publisher links choose the government to check before a directory's printed location.
    const linked = await platformGovernmentCandidates(query,{...tenant,name:null,state:null},pageLinks(portal.text,portal.url));
    if (linked.length) return linked;
    for (const name of platformPublisherNames(portal.text)) {
      const printed = platformPublisherIdentity(name);
      const candidates = await platformGovernmentCandidates(query,{...tenant,name:printed.name,state:printed.state ?? tenant.state});
      if (candidates.length) return candidates;
    }
  }
  return platformGovernmentCandidates(query,tenant);
}
