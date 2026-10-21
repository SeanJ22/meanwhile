import { detectTenancy } from "../../hunt/platform-tenancy.ts";
import { platformFingerprints } from "../platform-fingerprints.ts";
import { meetingEndpointCandidates, type MeetingsDiscoveryAttempt } from "../../hunt/meetings-site-discovery.ts";
import { newFieldManualEntry, type FieldManualEntry } from "../field-manual.ts";

const PLATFORM_CENSUS_RECHECK_HOURS = 12;
export const DOTGOV_CENSUS_URL = "https://raw.githubusercontent.com/cisagov/dotgov-data/main/current-full.csv";
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
