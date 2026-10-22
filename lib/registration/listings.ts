import type { RegistryProvenance } from "../registry/types.ts";
import type { LoadedReference, RegistrationReference } from "./reference.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";

export interface RegistrationGovernmentListing {
  readonly id: string;
  /** Existing durable work identifiers remain aliases; they are not renamed by a rebuild. */
  readonly aliases: readonly string[];
  readonly jurisdictionId: string | null;
  readonly state: string;
  readonly name: string;
  readonly kind: "GOVERNMENT" | "DEPENDENT_SCHOOL_SYSTEM" | "EDUCATION_AGENCY";
  readonly governmentClass: string;
  readonly nativeIds: Readonly<Record<string, string>>;
  readonly status: string | null;
  readonly sourceVintage: string;
  readonly website: string | null;
  readonly officePhone: string | null;
  readonly officeAddress: string | null;
  /** Census government contact title and mailing address, as published. */
  readonly contactTitle?: string | null;
  readonly mailingAddress?: string | null;
  readonly govDomains?: readonly { readonly domain: string; readonly website: string; readonly sourceUrl: string; readonly checkedAt: string }[];
  /** Administrative/source location, never a service boundary. */
  readonly countyFips: string | null;
  readonly associations: readonly {
    readonly divisionId: string;
    readonly layer: string;
    readonly geoid: string;
    readonly basis: "SOURCE_CODE" | "GOVERNING_FUNCSTAT" | "SOURCE_BOUNDARY" | "COUNTY_IN_NAME";
  }[];
  readonly bodyIds: readonly string[];
  readonly provenance: RegistryProvenance;
  /** Independent directory and native-crosswalk evidence retained after an identity merge. */
  readonly additionalSources?: readonly RegistryProvenance[];
  readonly contactProvenance?: Readonly<Partial<Record<"website" | "mailingAddress" | "officePhone" | "officeAddress", RegistryProvenance>>>;
}

export function governmentNativeId(state: string, namespace: "cog" | "nces" | "tiger" | "aiannh" | "boundary", id: string): string {
  if (!/^[a-z]{2}$/i.test(state) || !id || !/^[a-z0-9:_-]+$/i.test(id)) throw new Error("Invalid native government identity");
  return `government:US-${state.toUpperCase()}:${namespace}:${id}`;
}

export function governmentStateOf(id: string): string | null {
  const state = /^government:US-([A-Z]{2}):/i.exec(id)?.[1]
    ?? /^([a-z]{2}):[a-z]+:/i.exec(id)?.[1]
    ?? /^ocd-division\/country:us\/(?:state|district|territory):([a-z]{2})(?:\/|#|$)/i.exec(id)?.[1];
  return state?.toLowerCase() ?? null;
}

/** Census school district GEOIDs use the NCES LEAID, including its state prefix.
 * A directory code establishes territory only when exactly one held school
 * district carries it. Charter and closed agencies remain directory listings. */
export function schoolDistrictSourceAssociations(
  listing: Pick<RegistrationGovernmentListing, "state" | "kind" | "governmentClass" | "nativeIds" | "status">,
  reference: RegistrationReference,
): RegistrationGovernmentListing["associations"] {
  if (listing.kind === "GOVERNMENT" && !/SCHOOL/i.test(listing.governmentClass)) return [];
  const leaid = listing.nativeIds.nces_leaid;
  if (!/^\d{7}$/.test(leaid ?? "") || reference.state.toUpperCase() !== listing.state.toUpperCase() ||
      FIPS_TO_STATE[leaid.slice(0, 2)]?.postal !== listing.state.toUpperCase()) return [];
  const type = listing.nativeIds.nces_lea_type ?? listing.governmentClass;
  const charter = listing.nativeIds.nces_charter_lea;
  if (type === "7" || /^independent charter/i.test(type) || /^CHRT/i.test(charter ?? "") ||
      /^(?:2|6|7|closed|inactive|future)$/i.test(listing.nativeIds.nces_lea_status ?? listing.status ?? "")) return [];
  const districts = reference.divisions.filter(([, layer, geoid, name]) =>
    ["unsd", "elsd", "scsd"].includes(layer) && geoid === leaid && !/not defined/i.test(name));
  if (districts.length !== 1) return [];
  const [divisionId, layer, geoid] = districts[0];
  return [{ divisionId, layer, geoid, basis: "SOURCE_CODE" }];
}

/** Only a reversible F-33 native identity joins Census and NCES directories.
 * The Census identity remains durable; NCES supplies its independently sourced
 * contacts and the source-code service association. Ambiguous identities stay
 * separate, even if their names or district divisions happen to agree. */
export function mergeSchoolGovernmentListings(listings: readonly RegistrationGovernmentListing[]): RegistrationGovernmentListing[] {
  const pairs = new Map<string, { census: RegistrationGovernmentListing[]; nces: RegistrationGovernmentListing[] }>();
  for (const listing of listings) {
    const leaid = listing.nativeIds.nces_leaid;
    if (!leaid) continue;
    const key = `${listing.state.toUpperCase()}:${leaid}`;
    const pair = pairs.get(key) ?? { census: [], nces: [] };
    if (listing.nativeIds.census_pid6 && /SCHOOL/i.test(listing.governmentClass) && /^[a-f0-9]{64}$/.test(listing.nativeIds.f33_sha256 ?? "")) pair.census.push(listing);
    else if (listing.kind === "EDUCATION_AGENCY" && !listing.nativeIds.census_pid6) pair.nces.push(listing);
    pairs.set(key, pair);
  }
  const replacement = new Map<string, RegistrationGovernmentListing>(), joined = new Set<string>();
  for (const { census, nces } of pairs.values()) {
    if (census.length !== 1 || nces.length !== 1) continue;
    const government = census[0], agency = nces[0];
    const f33 = government.nativeIds;
    const crosswalk: RegistryProvenance[] = f33.f33_source_url && f33.f33_observed_at ? [{
      sourceUrl: f33.f33_source_url, sourceOrg: "National Center for Education Statistics / U.S. Census Bureau",
      collectedAt: f33.f33_observed_at, verifiedAt: null,
    }] : [];
    const sources = [...(government.additionalSources ?? []), agency.provenance, ...(agency.additionalSources ?? []), ...crosswalk];
    const contactProvenance: Partial<Record<"website" | "mailingAddress" | "officePhone" | "officeAddress", RegistryProvenance>> = {};
    for (const field of ["website", "mailingAddress", "officePhone", "officeAddress"] as const) {
      const source = government[field] ? government : agency[field] ? agency : null;
      if (source) contactProvenance[field] = source.contactProvenance?.[field] ?? source.provenance;
    }
    replacement.set(government.id, { ...government,
      aliases: [...new Set([...government.aliases, agency.id, ...agency.aliases])],
      nativeIds: { ...government.nativeIds, ...agency.nativeIds },
      website: government.website || agency.website,
      officePhone: government.officePhone || agency.officePhone,
      officeAddress: government.officeAddress || agency.officeAddress,
      mailingAddress: government.mailingAddress || agency.mailingAddress || null,
      contactProvenance,
      associations: agency.associations,
      bodyIds: [...new Set([...government.bodyIds, ...agency.bodyIds])],
      additionalSources: sources.filter((source, index) => sources.findIndex(other => other.sourceUrl === source.sourceUrl && other.collectedAt === source.collectedAt) === index),
    });
    joined.add(agency.id);
  }
  return listings.filter(listing => !joined.has(listing.id)).map(listing => replacement.get(listing.id) ?? listing);
}

/** An inventory establishes its own named entity. A name-only geometry join
 * supplies neither identity nor a resident membership claim. */
export function referenceGovernmentListings(loaded: LoadedReference): RegistrationGovernmentListing[] {
  const reference = loaded.reference;
  const state = reference.state.toUpperCase();
  const enrich = new Map((loaded.listings ?? []).map(row => [row.id, row]));
  const rows: RegistrationGovernmentListing[] = [];
  for (const [pid, jurisdictionId, name, kind, division, how, alternate] of reference.governments) {
    if (kind === "STATE") continue;
    const territory = how === "TIGER_FUNCSTAT", tribal = how === "AIANNH_CODE", boundaryOnly = how === "BOUNDARY_SOURCE_ONLY";
    const bounded = how === "BOUNDARY_SOURCE" || boundaryOnly, countyNamed = how === "COUNTY_NAMED";
    const id = governmentNativeId(state, territory ? "tiger" : tribal ? "aiannh" : boundaryOnly ? "boundary" : "cog", pid);
    const qualified = territory || tribal || bounded || countyNamed || ["COUNTY_FIPS", "PLACE_FIPS", "COUSUB_FIPS"].includes(how);
    const associations = qualified ? [...new Set([division, alternate])].flatMap(index => {
      const item = index >= 0 ? reference.divisions[index] : undefined;
      return item ? [{ divisionId: item[0], layer: item[1], geoid: item[2],
        basis: territory ? "GOVERNING_FUNCSTAT" as const : bounded ? "SOURCE_BOUNDARY" as const : countyNamed ? "COUNTY_IN_NAME" as const : "SOURCE_CODE" as const }] : [];
    }) : [];
    // A district drawn only by its own official layer is listed from that layer.
    const layer = boundaryOnly ? reference.boundarySources?.[String(reference.divisions[division]?.[2]).split("#")[0]!] : undefined;
    const held = enrich.get(id);
    rows.push({
      state, name,
      kind: kind === "DEPENDENT SCHOOL SYSTEM" ? "DEPENDENT_SCHOOL_SYSTEM" : "GOVERNMENT",
      governmentClass: kind,
      nativeIds: { [territory ? "tiger_geoid" : tribal ? "census_aiannh" : boundaryOnly ? "boundary_feature" : "census_pid6"]: tribal ? pid.slice("aiannh:".length) : pid },
      status: null,
      sourceVintage: territory ? "TIGER/Line 2023" : tribal ? "2020 Census AIANNH areas" : layer ? `${layer.title}, read ${layer.readAt}` : "2022 Census of Governments",
      website: null, officePhone: null, officeAddress: null, countyFips: null,
      bodyIds: [],
      provenance: tribal ? { sourceUrl: "https://www2.census.gov/geo/docs/reference/codes2020/national_aiannh2020.txt", sourceOrg: "U.S. Census Bureau", collectedAt: loaded.generatedAt, verifiedAt: null }
        : layer ? { sourceUrl: layer.url, sourceOrg: layer.publisher, collectedAt: layer.readAt, verifiedAt: null }
        : { sourceUrl: territory ? reference.functionalStatus?.sources[reference.divisions[division]?.[1] ?? ""] ?? null : "https://www2.census.gov/programs-surveys/gus/datasets/2022/govt_units_2022.ZIP",
          sourceOrg: "U.S. Census Bureau", collectedAt: territory ? loaded.generatedAt : "2026-09-23", verifiedAt: null },
      ...held,
      // Independent source enrichment cannot replace this source's stable identity or turn location into territory.
      id, aliases: [...new Set([jurisdictionId, ...(held?.aliases ?? [])])], jurisdictionId, associations,
    });
    enrich.delete(id);
  }
  rows.push(...enrich.values());
  return mergeSchoolGovernmentListings(rows.map(row => row.nativeIds.nces_leaid && (row.kind !== "GOVERNMENT" || /SCHOOL/i.test(row.governmentClass))
    ? { ...row, associations: schoolDistrictSourceAssociations(row, reference) }
    : row)).sort((a, b) => a.id.localeCompare(b.id));
}

/** Match a real held body by the source's identity, never by its division. */
export function bindGovernmentBodies(listings: readonly RegistrationGovernmentListing[], bodies: readonly { id: string; censusId?: string }[]): RegistrationGovernmentListing[] {
  return listings.map(listing => ({ ...listing, bodyIds: [...new Set([...listing.bodyIds,
    ...bodies.filter(body => Boolean(body.censusId) && body.censusId === listing.nativeIds.census_pid6).map(body => body.id)])] }));
}
