/**
 * **MEETINGS DISCOVERY OWED, BY JURISDICTION.** (2026-09-23.)
 *
 * Every enumerated government's meetings are owed to the reader (RULING 248).
 * The jurisdiction registries record how each one's meetings would be found:
 * the own-site MEETINGS source, state DISCOVERY_OWED ("walk this row's
 * `ownWebAddress` for the body's own meeting notices, agendas, minutes and
 * officeholder roster"). Where no website was recorded, no MEETINGS source was
 * recorded at all.
 *
 * Since 902f5c50 (2026-09-10) no freshness obligation carries that need. The
 * permanent meeting-partition contracts are the only production meeting clock,
 * and they cover the bodies wired in SOURCE_WIRING, not jurisdictions.
 *
 * This module turns the promoted registries into the discovery needs the
 * owner's dispatch and the mission map (CH-21,
 * `lib/hunt/mission-meetings-discovery.ts`) hand the free walk. It is PURE:
 * the caller reads the files.
 *
 * What it does not do: subtract jurisdictions a meeting partition already
 * covers. No reviewed jurisdiction→body crosswalk exists, and inferring one
 * from names is refused (`lib/control-plane/zip-gap-resolution.ts`). So the
 * list overstates by at most the partitions' roughly 22 governments, and says
 * so.
 */

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
  readonly ownWebAddress: string | null;
  readonly basis: MeetingsDiscoveryBasis;
  /** The DISCOVERY_OWED MEETINGS sources the need rests on; empty when none was recorded. */
  readonly sources: readonly string[];
  /**
   * Where `ownWebAddress` came from, so a route found from it can be attested later (NH330): the promoted
   * jurisdiction reference (its version id) or the state's registration. Absent when unrecorded.
   */
  readonly addressSource?: DiscoveryAddressSource;
  /** Present when `ownWebAddress` is a reviewed website correction, not the Census record (C15). */
  readonly addressCorrection?: WebsiteAddressCorrectionNote;
}

export interface DiscoveryAddressSource {
  readonly source: "GAP_LEDGER" | "OPERATIONAL_REFERENCE" | "REGISTRATION";
  /**
   * GAP_LEDGER: the sha256 (bare hex) of the retired gap ledger file a walk read before CH-21; kept so recorded
   * walks still read, never produced now. OPERATIONAL_REFERENCE: the promoted version id.
   * REGISTRATION (a state with no reviewed registry, 2026-09-25): the promoted registration version id.
   */
  readonly versionId: string | null;
}

/**
 * Every jurisdiction whose meetings are still to be discovered, sorted by id.
 * A row carrying any MEETINGS source in a state other than DISCOVERY_OWED is
 * not a discovery need: its source is known and wired.
 */
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
        ownWebAddress: row.ownWebAddress,
        basis: meetings.length === 0 ? "NO_MEETINGS_SOURCE_RECORDED" : "SOURCE_DISCOVERY_OWED",
        sources: meetings,
      });
    }
  }
  return needs.sort((a, b) => (a.jurisdictionId < b.jurisdictionId ? -1 : a.jurisdictionId > b.jurisdictionId ? 1 : 0));
}

/**
 * The need with its reviewed website correction applied (C15): while the address on record is still the one a
 * reviewed correction replaces, the need walks the corrected site and says so. A build reads nothing, so the
 * correction is applied as reviewed; the jurisdiction reference's promotion reads its sources again.
 */
export function withWebsiteCorrection(need: MeetingsDiscoveryNeed): MeetingsDiscoveryNeed {
  const c = websiteCorrectionFor(need.jurisdictionId, need.ownWebAddress);
  return c === null ? need : { ...need, ownWebAddress: c.corrected, addressCorrection: websiteCorrectionNote(c, "REVIEWED") };
}
