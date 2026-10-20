import { acquireKnownRelease, type KnownReleaseOptions } from "../sources/known-release.ts";
import { acquireKnownReleaseFile, KnownReleaseFileUnavailable, type KnownReleaseFile } from "../sources/known-release-file.ts";
import { registrationSourceTables } from "./source-file.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import type { LoadedReference } from "./reference.ts";
import { governmentNativeId, schoolDistrictSourceAssociations, type RegistrationGovernmentListing } from "./listings.ts";

export const NCES_DIRECTORY = "https://nces.ed.gov/ccd/files.asp";
/** file-controller.js loads these catalogs when District is selected. */
export const NCES_SCHOOL_CATALOG = {
  "lea-directory": "https://nces.ed.gov/ccd/datatables/api/File/2/5/0/0/0/0",
  f33: "https://nces.ed.gov/ccd/datatables/api/File/1/5/0/0/0/0",
} as const;
export type SchoolReleaseKind = "lea-directory" | "f33";

export function schoolReleaseLinks(json: string, kind: SchoolReleaseKind): string[] {
  const catalog = JSON.parse(json) as { selectionGroupModels?: unknown[] };
  if (!Array.isArray(catalog?.selectionGroupModels)) throw new Error("NCES_CATALOG_INVALID");
  const files: { url: string; year: number; order: number }[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) walk(item); return; }
    if (!value || typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    if (typeof row.fileURL === "string" && row.elementType === "Data File" && row.level === "District" &&
        (kind === "lea-directory" ? row.fiscal === false && row.component === "Directory" : row.fiscal === true && /F-33/i.test(String(row.title)))) {
      let url: URL | undefined;
      try { url = new URL(row.fileURL, NCES_DIRECTORY); } catch { /* Invalid source link supplies no target. */ }
      if (url && url.protocol === "https:" && !url.username && !url.password &&
          (url.hostname === "nces.ed.gov" && url.pathname.startsWith("/ccd/") || url.hostname === "ies.ed.gov" && url.pathname.startsWith("/sites/default/files/")) &&
          (kind === "lea-directory" ? /\/ccd_lea_029_\d{4}[^/]*\.zip$/i.test(url.pathname) : /\/(?:sdf|f33)[^/]*\.(?:txt|zip)$/i.test(url.pathname) && !/(?:xlsx|xlxs|sas|spss)/i.test(url.pathname))) {
        const year = Number(/\d{4}/.exec(String(row.schoolYear))?.[0]);
        if (Number.isFinite(year)) files.push({ url: url.href, year, order: Number(row.versionOrder) || 0 });
      }
    }
    for (const item of Object.values(row)) if (item && typeof item === "object") walk(item);
  };
  walk(catalog.selectionGroupModels);
  files.sort((a, b) => b.year - a.year || a.order - b.order || b.url.localeCompare(a.url));
  return [...new Set(files.map(file => file.url))];
}

async function* tableRows(path: string): AsyncGenerator<string[]> {
  let tables = 0;
  for await (const table of registrationSourceTables(path)) {
    if (++tables > 1) throw new Error("NCES_RELEASE_TABLE_AMBIGUOUS");
    yield* table.rows;
  }
  if (tables !== 1) throw new Error("NCES_RELEASE_TABLE_AMBIGUOUS");
}
const cleanHeader = (row: readonly string[]) => row.map(value => value.replace(/^\uFEFF/, "").trim().toUpperCase());

export async function schoolListingsFromRelease(prior: LoadedReference, release: KnownReleaseFile): Promise<RegistrationGovernmentListing[]> {
  let header: string[] | null = null;
  const at = (...fields: string[]) => fields.map(field => header?.indexOf(field) ?? -1).find(index => index >= 0) ?? -1;
  const out: RegistrationGovernmentListing[] = [];
  const seen = new Set<string>();
  for await (const row of tableRows(release.path)) {
    if (header === null) {
      header = cleanHeader(row);
      if (at("LEAID", "NCES_LEAID") < 0 || at("LEA_NAME", "LEANM") < 0) throw new Error("NCES_DIRECTORY_HEADER_INVALID");
      continue;
    }
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
    const listing: RegistrationGovernmentListing = { id: governmentNativeId(state, "nces", leaid), aliases: [], jurisdictionId: null, state, name,
      kind: "EDUCATION_AGENCY", governmentClass: value("LEA_TYPE_TEXT", "LEA_TYPE"),
      nativeIds: { nces_leaid: leaid, state_leaid: value("ST_LEAID", "STATE_LEAID"), source_state: sourceState,
        nces_lea_type: value("LEA_TYPE"), nces_charter_lea: value("CHARTER_LEA"),
        nces_lea_status: value("UPDATED_STATUS_TEXT", "UPDATED_STATUS") || value("SY_STATUS_TEXT", "SY_STATUS") },
      status: value("UPDATED_STATUS_TEXT", "UPDATED_STATUS") || value("SY_STATUS_TEXT", "SY_STATUS") || null, sourceVintage: release.releaseId,
      website: website ? (/^https?:\/\//i.test(website) ? website : `http://${website}`) : null,
      officePhone: value("PHONE") || null,
      officeAddress: [value("LSTREET1", "LOCATION_STREET1"), value("LSTREET2", "LOCATION_STREET2"), value("LSTREET3", "LOCATION_STREET3"), value("LCITY", "LOCATION_CITY"), value("LSTATE", "LOCATION_STATE"), value("LZIP", "LOCATION_ZIP")].filter(Boolean).join(", ") || null,
      mailingAddress: [value("MSTREET1", "MAILING_STREET1"), value("MSTREET2", "MAILING_STREET2"), value("MSTREET3", "MAILING_STREET3"), value("MCITY", "MAILING_CITY"), value("MSTATE", "MAILING_STATE"), value("MZIP", "MAILING_ZIP")].filter(Boolean).join(", ") || null,
      countyFips: null, associations: [], bodyIds: [], provenance: { sourceUrl: release.requestedUrl, sourceOrg: "National Center for Education Statistics", collectedAt: release.sourceObservedAt, verifiedAt: null } };
    out.push({ ...listing, associations: schoolDistrictSourceAssociations(listing, prior.reference) });
  }
  return out;
}

/** F-33 can supply a native crosswalk; ambiguity never becomes a name match. */
export async function applyF33NativeCrosswalk(listings: readonly RegistrationGovernmentListing[], release: KnownReleaseFile): Promise<RegistrationGovernmentListing[]> {
  let header: string[] | null = null, leaAt = -1, pidAt = -1;
  const wanted = new Set(listings.flatMap(row => row.nativeIds.census_pid6 ? [row.nativeIds.census_pid6] : []));
  const pairs = new Map<string, string | null>();
  for await (const row of tableRows(release.path)) {
    if (header === null) {
      header = cleanHeader(row); leaAt = header.indexOf("LEAID"); pidAt = header.findIndex(key => ["PID6", "CENSUS_ID_PID6"].includes(key));
      if (leaAt < 0 || pidAt < 0) throw new Error("NCES_F33_NATIVE_CROSSWALK_UNAVAILABLE");
      continue;
    }
    const lea = row[leaAt]?.trim(), native = row[pidAt]?.trim();
    if (!native || !wanted.has(native)) continue;
    if (!lea || !/^\d{7}$/.test(lea) || !native || !/^\d+$/.test(native)) continue;
    const key = `census_pid6:${native}`;
    const prior = pairs.get(key);
    pairs.set(key, prior === undefined || prior === lea ? lea : null);
  }
  // A second disk pass checks the reverse identity even when the conflicting
  // Census government was not requested. Only this state's candidate LEAs stay held.
  const wantedLeas = new Set([...pairs.values()].filter((value): value is string => value !== null));
  const reverse = new Map<string, string | null>();
  let first = true;
  for await (const row of tableRows(release.path)) {
    if (first) { first = false; continue; }
    const lea = row[leaAt]?.trim(), native = row[pidAt]?.trim();
    if (!lea || !wantedLeas.has(lea) || !native || !/^\d+$/.test(native)) continue;
    const prior = reverse.get(lea);
    reverse.set(lea, prior === undefined || prior === native ? native : null);
  }
  return listings.map(listing => {
    const native = listing.nativeIds.census_pid6;
    const lea = pairs.get(`census_pid6:${native}`);
    return lea && reverse.get(lea) === native ? { ...listing, nativeIds: { ...listing.nativeIds, nces_leaid: lea,
      f33_release: release.releaseId, f33_sha256: release.sha256, f33_source_url: release.requestedUrl, f33_observed_at: release.sourceObservedAt } } : listing;
  });
}

export async function acquireSchoolRelease(kind: SchoolReleaseKind, options: Pick<KnownReleaseOptions, "signal" | "fetchImpl" | "store" | "locks" | "now"> & {
  readonly onSourceUrl?: (url: string) => void;
}): Promise<KnownReleaseFile> {
  const catalogUrl = NCES_SCHOOL_CATALOG[kind];
  options.onSourceUrl?.(catalogUrl);
  const directory = await acquireKnownRelease({ ...options, sourceId: "nces-ccd", releaseId: `${kind}-catalog`, url: catalogUrl,
    parserVersion: "nces-catalog/2", allowedHosts: ["nces.ed.gov", "ies.ed.gov"], maxBytes: 4 * 1024 * 1024, checkAfterMs: 24 * 60 * 60 * 1000,
    validate: bytes => { if (!schoolReleaseLinks(new TextDecoder("utf-8", { fatal: true }).decode(bytes), kind).length) throw new Error("NCES_CATALOG_DATA_FILE_UNAVAILABLE"); } });
  const links = schoolReleaseLinks(new TextDecoder("utf-8", { fatal: true }).decode(directory.bytes), kind);
  if (!links.length) throw new Error(`NCES_${kind.toUpperCase()}_DOWNLOAD_LINK_UNAVAILABLE:${catalogUrl}`);
  const url = links[0];
  options.onSourceUrl?.(url);
  try { return await acquireKnownReleaseFile({ ...options, sourceId: "nces-ccd", releaseId: url.split("/").at(-1)!, url,
    parserVersion: kind === "f33" ? "nces-f33/2" : "nces-lea/2", allowedHosts: ["nces.ed.gov", "ies.ed.gov"], maxBytes: 64 * 1024 * 1024, checkAfterMs: 30 * 24 * 60 * 60 * 1000,
    validate: async path => {
      let header: string[] | null = null, rows = 0;
      for await (const row of tableRows(path)) { if (header === null) header = cleanHeader(row); else rows++; }
      if (!rows || !header?.includes("LEAID")) throw new Error("NCES_RELEASE_INVALID");
    } }); } catch (error) {
    if (error instanceof KnownReleaseFileUnavailable) await error.held.dispose();
    throw error;
  }
}
