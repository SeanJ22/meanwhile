import { closeSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { csvRows } from "../../reference/csv.ts";
import type { MeetingsDiscoveryNeed } from "../../hunt/meetings-discovery.ts";

export interface PlatformTenant {
  readonly platform: string;
  readonly url: string;
  readonly name: string | null;
  readonly state: string | null;
  readonly source: string;
  readonly sourceVersion?: string;
}

/** A directory worker holds one CSV record, including quoted multiline fields. */
export function* csvFileRecords(path: string): Generator<Record<string, string>> {
  const fd = openSync(path, "r");
  const buffer = Buffer.alloc(64 * 1024), decoder = new StringDecoder("utf8");
  let record = "", quoted = false, header: string[] | undefined;
  function row(text: string): Record<string, string> | null {
    const cells = csvRows(text).next().value as string[] | undefined;
    if (!cells) return null;
    if (!header) { header = cells.map(cell => cell.replace(/^\uFEFF/, "")); return null; }
    if (cells.length !== header.length) throw new Error(`CSV record has ${cells.length} fields; expected ${header.length}: ${path}`);
    return Object.fromEntries(header.map((key, i) => [key, cells[i]]));
  }
  try {
    for (;;) {
      const n = readSync(fd, buffer, 0, buffer.length, null);
      const chunk = n ? decoder.write(buffer.subarray(0, n)) : decoder.end();
      for (const char of chunk) {
        record += char;
        if (char === '"') quoted = !quoted;
        if (char === "\n" && !quoted) { const next = row(record); if (next) yield next; record = ""; }
      }
      if (!n) break;
    }
    if (quoted) throw new Error(`Unclosed CSV quote: ${path}`);
    if (record.trim()) { const next = row(record); if (next) yield next; }
  } finally { closeSync(fd); }
}

/** Catalogues are leads. An unlocated tenant is retained once, never assigned to a guessed state. */
export function* heldPlatformTenants(root = process.cwd(), state?: string): Generator<PlatformTenant> {
  for (const [file, platform] of [["civicplus_tenants.csv", "civicplus"], ["granicus_legistar_tenants.csv", "legistar"], ["boarddocs_tenants.csv", "boarddocs"]]) {
    for (const row of csvFileRecords(join(root, "data", "reference", file))) {
      if (row.country && !/^(?:US|USA|UNITED STATES)$/i.test(row.country)) continue;
      const postal = /^[A-Z]{2}$/i.test(row.state) ? row.state.toUpperCase() : null;
      if (state && (state.toUpperCase() === "US" ? postal !== null : postal !== state.toUpperCase())) continue;
      let url: URL;
      try { url = new URL(row.portal_url); } catch { continue; }
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) continue;
      // Old catalogues contain http links. HTTPS is tried by the normal transport, without inventing a tenant.
      url.protocol = "https:";
      yield { platform, url: row.portal_url.replace(/^http:/i, "https:"), name: row.jurisdiction_name || null, state: postal,
        source: `data/reference/${file}` };
    }
  }
}

const host = (url: string | null) => {
  if (!url) return null;
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return null; }
};

/** Keep government type words: a city, county, township and school with one place name are different governments. */
export function governmentName(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&amp;|&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/^(?:the )?(city|town|village|borough|township|county) of /, "$1 ")
    .split(/\s+/).sort().join(" ");
}

function names(need: MeetingsDiscoveryNeed): string[] {
  const name = governmentName(need.name);
  const aliases = [name];
  // Vendor municipal directories often omit "City of". Counties and districts never get that alias.
  if (/CITY|TOWN|MUNICIPAL|VILLAGE|BOROUGH/.test(need.govClass)) aliases.push(name.replace(/(?:^| )(?:city|town|village|borough)(?= |$)/g, " ").trim().replace(/ +/g, " "));
  return aliases;
}

export type PlatformGovernmentMatch =
  | { readonly kind: "MATCHED"; readonly government: MeetingsDiscoveryNeed; readonly basis: "WEBSITE" }
  | { readonly kind: "CANDIDATE"; readonly government: MeetingsDiscoveryNeed; readonly basis: "DIRECTORY_NAME" }
  | { readonly kind: "UNRESOLVED" | "AMBIGUOUS"; readonly candidates: readonly string[] };

/** A directory name only selects work; the saved government-to-portal link still establishes publication authority. */
export function matchPlatformGovernment(tenant: PlatformTenant, governments: readonly MeetingsDiscoveryNeed[]): PlatformGovernmentMatch {
  const inState = governments.filter(government => !tenant.state || government.stateCode.toUpperCase() === tenant.state);
  const website = inState.filter(government => host(government.ownWebAddress) === host(tenant.url));
  if (website.length === 1) return { kind: "MATCHED", government: website[0], basis: "WEBSITE" };
  if (website.length > 1) return { kind: "AMBIGUOUS", candidates: website.map(row => row.jurisdictionId) };
  if (!tenant.name || !tenant.state) return { kind: "UNRESOLVED", candidates: [] };
  const key = governmentName(tenant.name);
  const matched = inState.filter(government => names(government).includes(key));
  return matched.length === 1 ? { kind: "CANDIDATE", government: matched[0], basis: "DIRECTORY_NAME" }
    : { kind: matched.length ? "AMBIGUOUS" : "UNRESOLVED", candidates: matched.map(row => row.jurisdictionId) };
}

/** Only observed portal addresses are accepted. Slugs are never manufactured from a government's name. */
export function platformHostedUrl(raw: string): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  return /(?:^|\.)(?:legistar\.com|civicclerk\.com|primegov\.com|granicus\.com|escribemeetings\.com|novusagenda\.com|municodemeetings\.com|iqm2\.com|civicweb\.net|diligentoneplatform\.com|boarddocs\.com|boardbook\.org|swagit\.com|municode\.com)$/.test(url.hostname)
    || /\/AgendaCenter(?:\/|$)/i.test(url.pathname);
}

/** Unique-host portals use their host; shared services also require the observed tenant path or identifier. */
export function samePlatformTenant(left: string, right: string): boolean {
  try {
    const a = new URL(left), b = new URL(right);
    if (a.hostname.toLowerCase().replace(/^www\./, "") !== b.hostname.toLowerCase().replace(/^www\./, "")) return false;
    const tenant = (url: URL): string => {
      if (/(^|\.)boarddocs\.com$/i.test(url.hostname)) return /^(\/[^/]+\/[^/]+\/Board\.nsf)(?:\/|$)/i.exec(url.pathname)?.[1]?.toLowerCase() ?? url.pathname;
      if (url.hostname === "meetings.boardbook.org") return /^\/Public\/Organization\/(\d+)(?:\/|$)/i.exec(url.pathname)?.[1] ?? url.pathname;
      if (url.hostname === "meetings.municode.com") return url.searchParams.get("siteId") ?? url.pathname + url.search;
      if (/\.granicus\.com$/i.test(url.hostname)) return url.searchParams.get("view_id") ?? url.pathname;
      return "";
    };
    return tenant(a) === tenant(b);
  } catch { return false; }
}
