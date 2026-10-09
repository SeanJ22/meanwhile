import { createHash } from "node:crypto";
import { readZipEntries } from "../sources/archive.ts";
import { readXlsxSheets } from "../census-geography/xlsx.ts";
import { parseCsv } from "../reference/index.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import type { KnownRelease } from "../sources/known-release.ts";
import type { LoadedReference, ReferenceGovernment } from "./reference.ts";
import { governmentNativeId, type RegistrationGovernmentListing } from "./listings.ts";
import type { RegistrationReadModel } from "./candidate.ts";

/** Reacquisition starts from the latest published evidence as well as the
 * installed extract, so an outage cannot roll a newer source back to 2022. */
export function registrationReferenceWithPublished(base: LoadedReference, published: RegistrationReadModel | null): LoadedReference {
  if (!published?.governments) return base;
  const listings = new Map((base.listings ?? []).map(row => [row.id, row]));
  const governments = new Map(base.reference.governments.map(row => [row[0], row]));
  for (const listing of published.governments) {
    const held = listings.get(listing.id);
    if (!held || listing.provenance.collectedAt >= held.provenance.collectedAt) listings.set(listing.id, listing);
    const pid = listing.nativeIds.census_pid6;
    if (!pid) continue;
    const old = governments.get(pid);
    if (old) continue;
    const association = listing.associations[0];
    const division = association ? base.reference.divisions.findIndex(row => row[1] === association.layer && row[2] === association.geoid) : -1;
    governments.set(pid, [pid, listing.jurisdictionId ?? listing.id, listing.name, listing.governmentClass, division,
      division < 0 ? "NO_SOURCE_GEOGRAPHY" : association?.layer === "county" ? "COUNTY_FIPS" : association?.layer === "place" ? "PLACE_FIPS" : "COUSUB_FIPS", -1]);
  }
  return { ...base, reference: { ...base.reference, governments: [...governments.values()] }, listings: [...listings.values()] };
}

const SHEETS: Readonly<Record<string, string | null>> = {
  "General Purpose": null, "Special District": "SPECIAL DISTRICT", "School District": "SCHOOL DISTRICT", "DEP School Dist": "DEPENDENT SCHOOL SYSTEM",
};
const clean = (name: string) => name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");

function* sourceTables(bytes: Uint8Array): Generator<{ name: string; rows: Iterable<string[]> }> {
  const entries = readZipEntries(bytes, { maxEntries: 64, maxMemberBytes: 96 * 1024 * 1024, maxTotalBytes: 128 * 1024 * 1024 });
  const workbooks = entries.filter(entry => /\.xlsx$/i.test(entry.name));
  if (workbooks.length === 1) { yield* readXlsxSheets(workbooks[0].data); return; }
  const csvs = entries.filter(entry => /\.csv$/i.test(entry.name));
  if (!csvs.length) throw new Error("REGISTRATION_SOURCE_TABLE_MISSING");
  for (const entry of csvs) yield { name: entry.name, rows: parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(entry.data)) };
}

/** Validate every expected source sheet, without fixed national row counts. */
export function validateGovernmentRelease(bytes: Uint8Array): void {
  let recognized = 0;
  for (const table of sourceTables(bytes)) {
    if (!Object.hasOwn(SHEETS, table.name) && !/\.csv$/i.test(table.name)) continue;
    const header = table.rows[Symbol.iterator]().next().value as string[] | undefined;
    const names = new Set((header ?? []).map(clean));
    if (!(names.has("PID6") || names.has("CENSUS_ID_PID6")) || !(names.has("UNIT_NAME") || names.has("NAME"))) throw new Error(`REGISTRATION_SOURCE_HEADER_INVALID:${table.name}`);
    recognized++;
  }
  if (!recognized) throw new Error("REGISTRATION_SOURCE_TABLE_MISSING");
}

/** Parse only the requested state's rows. Source-native identity is sufficient
 * to list a government; geography and the recorded website are independent. */
export function registrationReferenceFromRelease(prior: LoadedReference, release: KnownRelease): LoadedReference {
  const state = prior.reference.state.toUpperCase();
  const existing = new Map(prior.reference.governments.map(row => [row[0], row]));
  const governments: ReferenceGovernment[] = prior.reference.governments.filter(row => row[3] === "STATE" || row[5] === "TIGER_FUNCSTAT");
  const listings: RegistrationGovernmentListing[] = (prior.listings ?? []).filter(row => !row.nativeIds.census_pid6);
  const native = new Set<string>();
  const divisions = new Map(prior.reference.divisions.map((row, index) => [`${row[1]}:${row[2]}`, index]));
  let found = 0;
  for (const table of sourceTables(release.bytes)) {
    if (!Object.hasOwn(SHEETS, table.name) && !/\.csv$/i.test(table.name)) continue;
    const iterator = table.rows[Symbol.iterator]();
    const header = (iterator.next().value as string[] | undefined)?.map(clean) ?? [];
    const at = (...names: string[]) => names.map(name => header.indexOf(name)).find(index => index >= 0) ?? -1;
    const pidAt = at("PID6", "CENSUS_ID_PID6"), nameAt = at("UNIT_NAME", "NAME");
    if (pidAt < 0 || nameAt < 0) throw new Error(`REGISTRATION_SOURCE_HEADER_INVALID:${table.name}`);
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      const row = next.value;
      const value = (...names: string[]) => (row[at(...names)] ?? "").trim();
      const fips = value("FIPS_STATE", "FIPSST", "FIPS_ST").padStart(2, "0");
      const postal = value("STATE", "STATE_ABBR") || FIPS_TO_STATE[fips]?.postal;
      if (postal?.toUpperCase() !== state) continue;
      const pid = (row[pidAt] ?? "").trim(), name = (row[nameAt] ?? "").trim();
      if (!/^\d+$/.test(pid) || !name) continue;
      if (native.has(pid)) throw new Error(`REGISTRATION_NATIVE_ID_AMBIGUOUS:${state}:${pid}`);
      native.add(pid);
      const rawType = value("GOV_TYPE", "UNIT_TYPE").toUpperCase();
      const type = SHEETS[table.name] ?? (/1\s*-\s*COUNTY|^COUNTY$/.test(rawType) ? "COUNTY" : /2\s*-\s*MUNICIPAL|^MUNICIPAL$/.test(rawType) ? "MUNICIPAL" : /3\s*-\s*TOWNSHIP|^TOWNSHIP$/.test(rawType) ? "TOWNSHIP" : rawType);
      if (!type) continue;
      const county = value("FIPS_COUNTY", "FIPSCO", "FIPS_CTY").padStart(3, "0");
      const place = value("FIPS_PLACE").padStart(5, "0");
      const key = type === "COUNTY" ? `county:${fips}${county}` : type === "MUNICIPAL" ? `place:${fips}${place}` : type === "TOWNSHIP" ? `cousub:${fips}${county}${place}` : "";
      const division = divisions.get(key) ?? -1;
      const how = division < 0 ? "NO_SOURCE_GEOGRAPHY" : type === "COUNTY" ? "COUNTY_FIPS" : type === "MUNICIPAL" ? "PLACE_FIPS" : "COUSUB_FIPS";
      const id = governmentNativeId(state, "cog", pid);
      const old = existing.get(pid);
      const jurisdictionId = old?.[1] ?? id;
      governments.push([pid, jurisdictionId, name, type, division, how, -1]);
      const website = value("WEB_ADDRESS", "WEBSITE");
      listings.push({ id, aliases: [jurisdictionId], jurisdictionId, state, name,
        kind: type === "DEPENDENT SCHOOL SYSTEM" ? "DEPENDENT_SCHOOL_SYSTEM" : "GOVERNMENT", governmentClass: type,
        nativeIds: { census_pid6: pid }, status: value("IS_ACTIVE") || null, sourceVintage: release.releaseId,
        website: website ? (/^https?:\/\//i.test(website) ? website : `http://${website}`) : null,
        // COG mailing/title fields can name a private addressee; they are not office contacts.
        officePhone: null, officeAddress: null, countyFips: /^\d{2}$/.test(fips) && /^\d{3}$/.test(county) && county !== "000" ? fips + county : null,
        associations: [], bodyIds: [], provenance: { sourceUrl: release.requestedUrl, sourceOrg: "U.S. Census Bureau", collectedAt: release.sourceObservedAt, verifiedAt: null } });
      found++;
    }
  }
  if (!found && !prior.reference.functionalStatus) throw new Error(`REGISTRATION_SOURCE_STATE_EMPTY:${state}`);
  // Missing rows/classes are not an affirmative government dissolution. Keep
  // their dated evidence until a source establishes a successor or closure.
  for (const row of prior.reference.governments) if (row[3] !== "STATE" && row[5] !== "TIGER_FUNCSTAT" && !native.has(row[0])) {
    governments.push(row);
    const held = prior.listings?.find(listing => listing.nativeIds.census_pid6 === row[0]);
    if (held) listings.push(held);
  }
  const reference = { ...prior.reference, governments };
  const sha256 = createHash("sha256").update(JSON.stringify(reference)).digest("hex");
  return { reference, sha256, generatedAt: prior.generatedAt, listings };
}
