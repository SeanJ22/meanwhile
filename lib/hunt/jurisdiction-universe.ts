/**
 * The jurisdiction universe: every local government that can hold an
 * election, named before a reader needs it. A row is the government; its
 * `sources` are the routes we know to its records, and a row with no route
 * carries an explicit discovery obligation. Absence of a route is a fact
 * about this repository, never about the government.
 *
 * A route's `scope` says whether it answers for the whole state or belongs to
 * this government alone; one is never presented as the other.
 *
 * ```
 *   ENUMERATED   the government is named, from an authoritative enumeration
 *   ADAPTED      a machine can open a route to at least one of its record classes
 * ```
 */

import type { WebsiteAddressCorrectionNote } from "../civic-data/website-corrections.ts";

/**
 * The classes of local government. A string union, not an `enum`: type
 * erasure in the test runner would drop a runtime enum.
 */
export type JurisdictionClass =
  | "STATE"
  | "COUNTY"
  | "CITY_OR_TOWN"
  | "SCHOOL_DISTRICT"
  | "DEPENDENT_SCHOOL_SYSTEM"
  | "COMMUNITY_COLLEGE_DISTRICT"
  | "SPECIAL_DISTRICT";

/** Which record class a source serves. A government publishes several. */
export type JurisdictionRecordClass =
  | "CAMPAIGN_FINANCE"
  | "BALLOT_AND_CANDIDATES"
  | "OFFICEHOLDERS"
  | "PUBLIC_COMMENT"
  | "PUBLIC_SERVICES"
  | "POLLING_PLACES"
  | "VOTER_ACCESS"
  | "PUBLIC_RECORDS"
  | "BALLOT_MEASURES"
  | "ADOPTED_BUDGETS"
  | "BUDGET_RESPONSIBILITIES"
  | "BUDGET_AMENDMENTS"
  | "GOVERNMENT_FINANCE"
  | "SPECIAL_DISTRICT_BOUNDARIES"
  | "MEETINGS";

/**
 * The scope of a route, kept apart from the scope of the record:
 * `STATEWIDE` answers for the whole state; `THIS_JURISDICTION` belongs to this
 * government and no other.
 */
export type RouteScope = "STATEWIDE" | "PER_COUNTY" | "THIS_JURISDICTION";

/** Whether this repository can open the route today. */
export type SourceState =
  /** A route exists here and a machine can open it. */
  | "ADAPTED"
  /** The authority and the routing rule are known; the address is not. */
  | "DISCOVERY_OWED"
  /** The address is known and this process holds no client for it. */
  | "REQUIRES_NEW_ADAPTER";

export interface JurisdictionSource {
  readonly recordClass: JurisdictionRecordClass;
  /** The custodian by law or by published record. Never the vendor. */
  readonly authority: string;
  /** Where the statutory or documentary routing rule comes from. */
  readonly authorityBasis: string;
  readonly scope: RouteScope;
  /** The method-store route id, when one is registered. */
  readonly routeId: string | null;
  readonly url: string | null;
  readonly state: SourceState;
  /** What is owed when `state` is not ADAPTED: a next move, or the human or offline act that is left. */
  readonly owed: string | null;
  readonly citation: string;
}

export interface Jurisdiction {
  /** `az:county:pima`, `az:city:tucson`, `az:school:tucson-unified-1`. */
  readonly id: string;
  /** Two-letter state. The registry is per state; this is carried for joins. */
  readonly stateCode: string;
  readonly name: string;
  readonly govClass: JurisdictionClass;
  /** The county this sits inside, where the enumeration states one. */
  readonly countyName: string | null;
  /** Census state+county FIPS for the government's published office. */
  readonly countyFips?: string | null;
  /** The `enumerationSources` id that named this government; a key with no entry is a malformed registry. */
  readonly enumeratedFrom: string;
  /**
   * The government's own published address, where the enumeration recorded
   * one. Where discovery starts, never a walked route.
   */
  readonly ownWebAddress: string | null;
  /**
   * Present only when `ownWebAddress` is not the Census record: the reviewed website correction applied to it, or
   * refused at promotion (`lib/civic-data/website-corrections.ts`).
   */
  readonly ownWebAddressCorrection?: WebsiteAddressCorrectionNote;
  /** Keys into the registry's `sourceCatalog`, so a route shared by many governments is written once. */
  readonly sourceIds: readonly string[];
  /**
   * A row read from a state's REGISTRATION (`lib/registration/jurisdictions.ts`) only: the Census division its
   * government is paired with, and the body registration minted there (`<ocdId>#governing`, `#board` for a
   * school district). Null when registration pairs the government with no division, so no body is minted for it.
   * Absent on every row of a reviewed registry.
   */
  readonly ocdId?: string | null;
  readonly bodyId?: string | null;
  /**
   * Registration rows only: that division's Census layer and GEOID (`county:39049`, `place:3918000`), the key its
   * source-established ZCTA intersections are read by. Null when no association is held.
   */
  readonly censusDivision?: string | null;
  /** Registration rows only: the Census of Governments id (`pid6`), or `<layer>:<GEOID>` for a territory government. */
  readonly censusId?: string;
}

/**
 * Where a registry read from a state's registration came from (`lib/registration/jurisdictions.ts`). A reviewed
 * registry — the promoted operational reference, which wins wherever it exists — carries none.
 */
export interface RegistrationRegistryOrigin {
  readonly kind: "REGISTRATION";
  /** The promoted REGISTRATION version, the one readers use. */
  readonly versionId: string;
  /** sha256 of the committed reference (`data/derived/registration/<st>.json`) the version was built from. */
  readonly referenceSha256: string;
  /** The Census file each web address was read from, with its sha256 as the reference's index records it. */
  readonly webAddresses: string;
}

/** Which kind of registry a row of work came from, in the words Admin prints. */
export type JurisdictionRegistrySource = "REVIEWED_REGISTRY" | "REGISTRATION";

/**
 * A count from one enumeration that disagrees with another. Recorded, never
 * reconciled by picking one.
 */
export interface EnumerationDisagreement {
  readonly about: string;
  readonly counts: readonly { readonly source: string; readonly count: number }[];
  readonly whyItIsNotReconciledHere: string;
}

export interface JurisdictionRegistry {
  readonly formatVersion: 1;
  readonly stateCode: string;
  readonly generatedBy: string;
  readonly generatedOn: string;
  readonly _note: readonly string[];
  /** Every enumeration read, with its own count. */
  readonly enumerationSources: readonly {
    readonly id: string;
    readonly describe: string;
    readonly path: string;
    readonly rowsRead: number;
  }[];
  readonly counts: Readonly<Record<string, number>>;
  readonly disagreements: readonly EnumerationDisagreement[];
  /** Every distinct route, once. Jurisdictions reference these by key. */
  readonly sourceCatalog: Readonly<Record<string, JurisdictionSource>>;
  readonly jurisdictions: readonly Jurisdiction[];
  /** Present only on a registry read from a state's registration; a reviewed registry carries none. */
  readonly registration?: RegistrationRegistryOrigin;
}

/** Whether a registry is a state's reviewed registry or was read from its registration. */
export function registrySourceOf(reg: Pick<JurisdictionRegistry, "registration">): JurisdictionRegistrySource {
  return reg.registration?.kind === "REGISTRATION" ? "REGISTRATION" : "REVIEWED_REGISTRY";
}

/* -------------------------------------------------------------- arithmetic */

/**
 * A jurisdiction's sources, resolved. A `sourceId` with no catalog entry
 * throws rather than being skipped.
 */
export function sourcesOf(reg: JurisdictionRegistry, j: Jurisdiction): JurisdictionSource[] {
  return j.sourceIds.map((id) => sourceOf(reg, j, id));
}

/**
 * One of a jurisdiction's sources, by its catalog key, under the same rule: a
 * key with no catalog entry throws.
 */
export function sourceOf(reg: JurisdictionRegistry, j: Jurisdiction, id: string): JurisdictionSource {
  const s = reg.sourceCatalog[id];
  if (!s) {
    throw new Error(
      `jurisdiction ${j.id} references source \`${id}\`, which is not in ${reg.stateCode}'s source ` +
        "catalog. A dangling reference dropped silently is a government quietly losing a route.",
    );
  }
  return s;
}

/**
 * A jurisdiction is ADAPTED when at least one of its sources can be opened,
 * including a statewide route that carries its records. `adaptedSplit`
 * reports this beside the local-scope count.
 */
export function isAdapted(reg: JurisdictionRegistry, j: Jurisdiction): boolean {
  return sourcesOf(reg, j).some((s) => s.state === "ADAPTED");
}

/**
 * True only when a route belonging to this government, or to the county its
 * records are filed with, can be opened; a statewide API does not count.
 */
export function isLocallyAdapted(reg: JurisdictionRegistry, j: Jurisdiction): boolean {
  return sourcesOf(reg, j).some((s) => s.state === "ADAPTED" && s.scope !== "STATEWIDE");
}

export function adaptedSplit(reg: JurisdictionRegistry): {
  readonly enumerated: number;
  readonly adapted: number;
  readonly notYetAdapted: number;
  readonly locallyAdapted: number;
  readonly notYetLocallyAdapted: number;
} {
  const adapted = reg.jurisdictions.filter((j) => isAdapted(reg, j)).length;
  const locallyAdapted = reg.jurisdictions.filter((j) => isLocallyAdapted(reg, j)).length;
  return {
    enumerated: reg.jurisdictions.length,
    adapted,
    notYetAdapted: reg.jurisdictions.length - adapted,
    locallyAdapted,
    notYetLocallyAdapted: reg.jurisdictions.length - locallyAdapted,
  };
}

/**
 * The registry's own refusal to be read as complete, as a sentence a report
 * prints beside the counts.
 */
export function completenessCaveat(reg: JurisdictionRegistry): string {
  const s = adaptedSplit(reg);
  return (
    `${reg.stateCode}: ${s.enumerated} jurisdiction(s) ENUMERATED from ` +
    `${reg.enumerationSources.length} authoritative enumeration(s); ${s.adapted} reachable by SOME ` +
    `route (statewide routes included), of which ${s.locallyAdapted} by a route belonging to that ` +
    `government or its county — ${s.notYetLocallyAdapted} NOT YET ADAPTED at local scope. This is what ` +
    "the project knows NOW. A government absent from every enumeration read here is absent from this " +
    "file — never absent from the state."
  );
}
