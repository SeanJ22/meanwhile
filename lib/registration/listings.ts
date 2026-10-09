import type { RegistryProvenance } from "../registry/types.ts";
import type { LoadedReference } from "./reference.ts";

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
  /** Administrative/source location, never a service boundary. */
  readonly countyFips: string | null;
  readonly associations: readonly {
    readonly divisionId: string;
    readonly layer: string;
    readonly geoid: string;
    readonly basis: "SOURCE_CODE" | "GOVERNING_FUNCSTAT";
  }[];
  readonly bodyIds: readonly string[];
  readonly provenance: RegistryProvenance;
}

export function governmentNativeId(state: string, namespace: "cog" | "nces" | "tiger", id: string): string {
  if (!/^[a-z]{2}$/i.test(state) || !id || !/^[a-z0-9:_-]+$/i.test(id)) throw new Error("Invalid native government identity");
  return `government:US-${state.toUpperCase()}:${namespace}:${id}`;
}

export function governmentStateOf(id: string): string | null {
  const state = /^government:US-([A-Z]{2}):/i.exec(id)?.[1]
    ?? /^([a-z]{2}):[a-z]+:/i.exec(id)?.[1]
    ?? /^ocd-division\/country:us\/(?:state|district|territory):([a-z]{2})(?:\/|#|$)/i.exec(id)?.[1];
  return state?.toLowerCase() ?? null;
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
    const territory = how === "TIGER_FUNCSTAT";
    const id = governmentNativeId(state, territory ? "tiger" : "cog", pid);
    const qualified = territory || ["COUNTY_FIPS", "PLACE_FIPS", "COUSUB_FIPS"].includes(how);
    const associations = qualified ? [...new Set([division, alternate])].flatMap(index => {
      const item = index >= 0 ? reference.divisions[index] : undefined;
      return item ? [{ divisionId: item[0], layer: item[1], geoid: item[2], basis: territory ? "GOVERNING_FUNCSTAT" as const : "SOURCE_CODE" as const }] : [];
    }) : [];
    const held = enrich.get(id);
    rows.push({
      state, name,
      kind: kind === "DEPENDENT SCHOOL SYSTEM" ? "DEPENDENT_SCHOOL_SYSTEM" : "GOVERNMENT",
      governmentClass: kind, nativeIds: { [territory ? "tiger_geoid" : "census_pid6"]: pid },
      status: null, sourceVintage: territory ? "TIGER/Line 2023" : "2022 Census of Governments",
      website: null, officePhone: null, officeAddress: null, countyFips: null,
      bodyIds: [],
      provenance: { sourceUrl: territory ? reference.functionalStatus?.sources[reference.divisions[division]?.[1] ?? ""] ?? null : "https://www2.census.gov/programs-surveys/gus/datasets/2022/govt_units_2022.ZIP",
        sourceOrg: "U.S. Census Bureau", collectedAt: territory ? loaded.generatedAt : "2026-09-23", verifiedAt: null },
      ...held,
      // Independent source enrichment cannot replace this source's stable identity or turn location into territory.
      id, aliases: [...new Set([jurisdictionId, ...(held?.aliases ?? [])])], jurisdictionId, associations,
    });
    enrich.delete(id);
  }
  rows.push(...enrich.values());
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

/** Match a real held body by the source's identity, never by its division. */
export function bindGovernmentBodies(listings: readonly RegistrationGovernmentListing[], bodies: readonly { id: string; censusId?: string }[]): RegistrationGovernmentListing[] {
  return listings.map(listing => ({ ...listing, bodyIds: [...new Set([...listing.bodyIds,
    ...bodies.filter(body => Boolean(body.censusId) && body.censusId === listing.nativeIds.census_pid6).map(body => body.id)])] }));
}
