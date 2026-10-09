import { acquireKnownRelease, type KnownRelease, type KnownReleaseOptions } from "../sources/known-release.ts";
import { readZipEntries } from "../sources/archive.ts";
import { parseCsv } from "../reference/index.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import type { LoadedReference } from "./reference.ts";
import { governmentNativeId, type RegistrationGovernmentListing } from "./listings.ts";

export const NCES_DIRECTORY = "https://nces.ed.gov/ccd/files.asp";
export type SchoolReleaseKind = "lea-directory" | "f33";

/** Only explicit archive links on the known official directory are followed. */
export function schoolReleaseLinks(html: string, kind: SchoolReleaseKind): string[] {
  const paths = [...html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].map(match => {
    try { return new URL(match[1].replaceAll("&amp;", "&"), NCES_DIRECTORY); } catch { return null; }
  }).filter((url): url is URL => Boolean(url && url.protocol === "https:" && url.hostname === "nces.ed.gov" &&
    (kind === "lea-directory" ? /\/ccd_lea_029_\d{4}[^/]*\.zip$/i.test(url.pathname) : /\/(?:sdf|f33)[^/]*\.zip$/i.test(url.pathname))));
  return [...new Set(paths.map(url => url.href))].sort().reverse();
}

function table(release: Pick<KnownRelease, "bytes">): { header: string[]; rows: string[][] } {
  const entries = readZipEntries(release.bytes, { maxEntries: 64, maxMemberBytes: 96 * 1024 * 1024, maxTotalBytes: 192 * 1024 * 1024 });
  const csvs = entries.filter(entry => /\.(?:csv|txt)$/i.test(entry.name));
  if (csvs.length !== 1) throw new Error("NCES_RELEASE_TABLE_AMBIGUOUS");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(csvs[0].data);
  const [header = [], ...rows] = text.split(/\r?\n/, 1)[0].includes("\t") ? text.trimEnd().split(/\r?\n/).map(line => line.split("\t")) : parseCsv(text);
  return { header: header.map(value => value.replace(/^\uFEFF/, "").trim().toUpperCase()), rows };
}

export function schoolListingsFromRelease(prior: LoadedReference, release: KnownRelease): RegistrationGovernmentListing[] {
  const { header, rows } = table(release);
  const at = (...fields: string[]) => fields.map(field => header.indexOf(field)).find(index => index >= 0) ?? -1;
  if (at("LEAID", "NCES_LEAID") < 0 || at("LEA_NAME", "LEANM") < 0) throw new Error("NCES_DIRECTORY_HEADER_INVALID");
  const out: RegistrationGovernmentListing[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const value = (...fields: string[]) => (row[at(...fields)] ?? "").trim();
    const sourceState = value("ST", "STATE").toUpperCase();
    const fips = value("FIPST", "FIPS_STATE").padStart(2, "0");
    // BIE jurisdiction remains source_state; its published administrative state
    // only chooses the bounded inventory shard, never a service territory.
    const state = FIPS_TO_STATE[fips]?.postal ?? (Object.values(FIPS_TO_STATE).some(item => item.postal === sourceState) ? sourceState : value("LSTATE", "LOCATION_STATE").toUpperCase());
    if (state !== prior.reference.state.toUpperCase()) continue;
    const leaid = value("LEAID", "NCES_LEAID").padStart(7, "0"), name = value("LEA_NAME", "LEANM");
    if (!/^\d{7}$/.test(leaid) || !name) throw new Error("NCES_DIRECTORY_NATIVE_ID_INVALID");
    if (seen.has(leaid)) throw new Error(`NCES_DIRECTORY_NATIVE_ID_AMBIGUOUS:${leaid}`);
    seen.add(leaid);
    const website = value("WEBSITE", "WEBADDR");
    out.push({ id: governmentNativeId(state, "nces", leaid), aliases: [], jurisdictionId: null, state, name,
      kind: "EDUCATION_AGENCY", governmentClass: value("LEA_TYPE"), nativeIds: { nces_leaid: leaid, state_leaid: value("ST_LEAID", "STATE_LEAID"), source_state: sourceState },
      status: value("UPDATED_STATUS") || value("SY_STATUS") || null, sourceVintage: release.releaseId,
      website: website ? (/^https?:\/\//i.test(website) ? website : `http://${website}`) : null,
      officePhone: value("PHONE") || null,
      officeAddress: [value("LSTREET1", "LOCATION_STREET1"), value("LSTREET2", "LOCATION_STREET2"), value("LSTREET3", "LOCATION_STREET3"), value("LCITY", "LOCATION_CITY"), value("LSTATE", "LOCATION_STATE"), value("LZIP", "LOCATION_ZIP")].filter(Boolean).join(", ") || null,
      countyFips: null, associations: [], bodyIds: [], provenance: { sourceUrl: release.requestedUrl, sourceOrg: "National Center for Education Statistics", collectedAt: release.sourceObservedAt, verifiedAt: null } });
  }
  return out;
}

/** F-33 can supply a native crosswalk; ambiguity never becomes a name match. */
export function applyF33NativeCrosswalk(listings: readonly RegistrationGovernmentListing[], release: KnownRelease): RegistrationGovernmentListing[] {
  const { header, rows } = table(release);
  const leaAt = header.indexOf("LEAID"), pidAt = header.indexOf("PID6"), gidAt = header.findIndex(key => ["CENSUSID", "CENSUS_ID", "GIDID"].includes(key));
  if (leaAt < 0 || (pidAt < 0 && gidAt < 0)) throw new Error("NCES_F33_NATIVE_CROSSWALK_UNAVAILABLE");
  const pairs = new Map<string, Set<string>>();
  for (const row of rows) {
    const lea = row[leaAt]?.trim(), native = row[pidAt >= 0 ? pidAt : gidAt]?.trim();
    if (!lea || !/^\d{7}$/.test(lea) || !native || !/^\d+$/.test(native)) continue;
    const key = `${pidAt >= 0 ? "census_pid6" : "census_gidid"}:${native}`;
    const values = pairs.get(key) ?? new Set<string>(); values.add(lea); pairs.set(key, values);
  }
  const reverse = new Map<string, Set<string>>();
  for (const [key, values] of pairs) for (const lea of values) { const keys = reverse.get(lea) ?? new Set<string>(); keys.add(key); reverse.set(lea, keys); }
  return listings.map(listing => {
    const field = pidAt >= 0 ? "census_pid6" : "census_gidid";
    const values = pairs.get(`${field}:${listing.nativeIds[field]}`);
    const lea = values?.size === 1 ? [...values][0] : undefined;
    return lea && reverse.get(lea)?.size === 1 ? { ...listing, nativeIds: { ...listing.nativeIds, nces_leaid: lea, f33_release: release.releaseId, f33_sha256: release.sha256 } } : listing;
  });
}

export async function acquireSchoolRelease(kind: SchoolReleaseKind, options: Pick<KnownReleaseOptions, "signal" | "fetchImpl" | "store" | "locks" | "now"> & {
  readonly onSourceUrl?: (url: string) => void;
}): Promise<KnownRelease> {
  options.onSourceUrl?.(NCES_DIRECTORY);
  const directory = await acquireKnownRelease({ ...options, sourceId: "nces-ccd", releaseId: "directory", url: NCES_DIRECTORY,
    parserVersion: "nces-links/1", maxBytes: 4 * 1024 * 1024, checkAfterMs: 24 * 60 * 60 * 1000 });
  const links = schoolReleaseLinks(new TextDecoder("utf-8", { fatal: true }).decode(directory.bytes), kind);
  if (!links.length) throw new Error(`NCES_${kind.toUpperCase()}_DOWNLOAD_LINK_UNAVAILABLE:${NCES_DIRECTORY}`);
  const url = links[0];
  options.onSourceUrl?.(url);
  return acquireKnownRelease({ ...options, sourceId: "nces-ccd", releaseId: url.split("/").at(-1)!, url,
    parserVersion: kind === "f33" ? "nces-f33/1" : "nces-lea/1", maxBytes: 64 * 1024 * 1024, checkAfterMs: 30 * 24 * 60 * 60 * 1000,
    validate: bytes => { const parsed = table({ bytes }); if (!parsed.rows.length || !parsed.header.includes("LEAID")) throw new Error("NCES_RELEASE_INVALID"); } });
}
