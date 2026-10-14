import {
  websiteCorrectionFor,
  websiteCorrectionNote,
  type WebsiteAddressCorrectionNote,
} from "../civic-data/website-corrections.ts";

/** The registries' own-site MEETINGS source key. */
export const OWN_SITE_MEETINGS_SOURCE = "MEETINGS:THIS_JURISDICTION:this-government-itself";

/** The fields of a committed `data/states/<st>/jurisdictions/<st>.json` this module reads. */
export interface JurisdictionRegistryFile {
  readonly stateCode: string;
  readonly generatedOn: string;
  readonly sourceCatalog: Readonly<Record<string, { readonly recordClass: string; readonly state: string }>>;
  readonly jurisdictions: readonly {
    readonly id: string;
    readonly stateCode: string;
    readonly name: string;
    readonly govClass: string;
    readonly countyFips?: string | null;
  readonly countyName?: string | null;
  readonly city?: string | null;
    readonly ownWebAddress: string | null;
    readonly sourceIds: readonly string[];
  }[];
}

export type MeetingsDiscoveryBasis =
  /** Every MEETINGS source the row carries is DISCOVERY_OWED: the site is known and has not been walked. */
  | "SOURCE_DISCOVERY_OWED"
  /** The row carries no MEETINGS source: no website was recorded, so the first step is finding one. */
  | "NO_MEETINGS_SOURCE_RECORDED";

export interface MeetingsDiscoveryNeed {
  readonly jurisdictionId: string;
  readonly stateCode: string;
  readonly name: string;
  readonly govClass: string;
  readonly countyFips?: string | null;
  readonly countyName?: string | null;
  readonly city?: string | null;
  readonly ownWebAddress: string | null;
  readonly basis: MeetingsDiscoveryBasis;
  /** The DISCOVERY_OWED MEETINGS sources the need rests on; empty when none was recorded. */
  readonly sources: readonly string[];

  readonly addressSource?: DiscoveryAddressSource;
  /** Present when `ownWebAddress` is a reviewed website correction, not the Census record. */
  readonly addressCorrection?: WebsiteAddressCorrectionNote;
}

export interface DiscoveryAddressSource {
  readonly source: "GAP_LEDGER" | "OPERATIONAL_REFERENCE" | "REGISTRATION" | "WEBSITE_EVIDENCE";

  readonly versionId: string | null;
}

export function meetingsDiscoveryNeeds(files: readonly JurisdictionRegistryFile[]): readonly MeetingsDiscoveryNeed[] {
  const needs: MeetingsDiscoveryNeed[] = [];
  for (const file of files) {
    for (const row of file.jurisdictions) {
      const meetings = row.sourceIds.filter((id) => file.sourceCatalog[id]?.recordClass === "MEETINGS");
      if (meetings.some((id) => file.sourceCatalog[id]?.state !== "DISCOVERY_OWED")) continue;
      needs.push({
        jurisdictionId: row.id,
        stateCode: row.stateCode,
        name: row.name,
        govClass: row.govClass,
        countyFips: row.countyFips ?? null,
        ownWebAddress: row.ownWebAddress,
        basis: meetings.length === 0 ? "NO_MEETINGS_SOURCE_RECORDED" : "SOURCE_DISCOVERY_OWED",
        sources: meetings,
      });
    }
  }
  return needs.sort((a, b) => (a.jurisdictionId < b.jurisdictionId ? -1 : a.jurisdictionId > b.jurisdictionId ? 1 : 0));
}

export function withWebsiteCorrection(need: MeetingsDiscoveryNeed): MeetingsDiscoveryNeed {
  const c = websiteCorrectionFor(need.jurisdictionId, need.ownWebAddress);
  return c === null ? need : { ...need, ownWebAddress: c.corrected, addressCorrection: websiteCorrectionNote(c, "REVIEWED") };
}
