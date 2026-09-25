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
 * This module turns the committed registries into the list the gap ledger
 * records, so the need has a durable home before the old
 * `freshness:jurisdiction:*#meetings-N` rows retire. It is PURE: the caller
 * reads the files.
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

/** The committed gap ledger, and the field in it that records these needs. */
export const GAP_LEDGER_PATH = "data/derived/gap-ledger.json";
export const MEETINGS_DISCOVERY_FIELD = "meetingsDiscovery.needs";

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
   * Where `ownWebAddress` came from, so a route found from it can be attested later (NH330): the committed gap
   * ledger (its file's sha256) or the promoted jurisdiction reference (its version id). Absent when unrecorded.
   */
  readonly addressSource?: DiscoveryAddressSource;
  /** Present when `ownWebAddress` is a reviewed website correction, not the Census record (C15). */
  readonly addressCorrection?: WebsiteAddressCorrectionNote;
}

export interface DiscoveryAddressSource {
  readonly source: "GAP_LEDGER" | "OPERATIONAL_REFERENCE";
  /** GAP_LEDGER: the sha256 (bare hex) of the ledger file read. OPERATIONAL_REFERENCE: the promoted version id. */
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

/** A recorded correction note is well formed, and it is the reviewed correction for this jurisdiction. */
function isCorrectionNote(value: unknown, site: unknown, jurisdictionId: string): boolean {
  const n = value as Partial<Record<keyof WebsiteAddressCorrectionNote, unknown>> | null;
  return (
    typeof n === "object" && n !== null &&
    typeof n.recorded === "string" && typeof n.corrected === "string" && n.corrected === site &&
    websiteCorrectionFor(jurisdictionId, n.recorded)?.corrected === n.corrected &&
    (n.basis === "HOMEPAGE_AND_REGISTRY" || n.basis === "OTHER_GOVERNMENT_PUBLICATION") &&
    typeof n.reviewedBy === "string" && n.reviewedBy !== "" && typeof n.reviewedAt === "string" &&
    n.reading === "REVIEWED" && typeof n.authorization === "string"
  );
}

/**
 * The jurisdictions the committed gap ledger records as owed meetings
 * discovery, or why its record cannot be read. The standing runner retires an
 * old jurisdiction meetings clock only against this answer.
 *
 * Anything short of a well-formed record is UNREADABLE, never an empty list:
 * a missing field, no needs, a need without an id, a duplicated id, a need
 * with a malformed field, or a count that disagrees with the list. A ledger
 * that cannot be read retires nothing and is walked by nothing. The validated
 * needs are returned for the discovery executor to walk.
 */
export function recordedMeetingsDiscovery(
  ledger: unknown,
):
  | { readonly jurisdictionIds: ReadonlySet<string>; readonly needs: readonly MeetingsDiscoveryNeed[] }
  | { readonly unreadable: string } {
  const section = (ledger as { meetingsDiscovery?: unknown } | null)?.meetingsDiscovery as
    | { counts?: { enumerated?: unknown }; needs?: unknown }
    | undefined;
  if (typeof section !== "object" || section === null) return { unreadable: `${GAP_LEDGER_PATH} has no meetingsDiscovery section` };
  if (!Array.isArray(section.needs) || section.needs.length === 0) {
    return { unreadable: `${GAP_LEDGER_PATH} records no ${MEETINGS_DISCOVERY_FIELD}` };
  }
  const jurisdictionIds = new Set<string>();
  const needs: MeetingsDiscoveryNeed[] = [];
  for (const need of section.needs as unknown[]) {
    const row = need as Partial<Record<keyof MeetingsDiscoveryNeed, unknown>> | null;
    const id = row?.jurisdictionId;
    if (typeof id !== "string" || id === "") return { unreadable: `${GAP_LEDGER_PATH} holds a need with no jurisdictionId` };
    if (jurisdictionIds.has(id)) return { unreadable: `${GAP_LEDGER_PATH} lists ${id} twice` };
    jurisdictionIds.add(id);
    const site = row?.ownWebAddress;
    const basis = row?.basis;
    const correction = row?.addressCorrection;
    if (correction !== undefined && !isCorrectionNote(correction, site, id)) {
      return { unreadable: `${GAP_LEDGER_PATH} holds a malformed website correction for ${id}` };
    }
    if (
      typeof row?.stateCode !== "string" || typeof row.name !== "string" || typeof row.govClass !== "string" ||
      (site !== null && typeof site !== "string") ||
      (basis !== "SOURCE_DISCOVERY_OWED" && basis !== "NO_MEETINGS_SOURCE_RECORDED") ||
      !Array.isArray(row.sources) || !row.sources.every((s) => typeof s === "string")
    ) {
      return { unreadable: `${GAP_LEDGER_PATH} holds a malformed need for ${id}` };
    }
    needs.push({
      jurisdictionId: id,
      stateCode: row.stateCode,
      name: row.name,
      govClass: row.govClass,
      ownWebAddress: site as string | null,
      basis,
      sources: row.sources as string[],
      ...(correction === undefined ? {} : { addressCorrection: correction as WebsiteAddressCorrectionNote }),
    });
  }
  if (section.counts?.enumerated !== jurisdictionIds.size) {
    return {
      unreadable:
        `${GAP_LEDGER_PATH} counts ${String(section.counts?.enumerated)} needs and lists ${jurisdictionIds.size}, ` +
        "so the record disagrees with itself",
    };
  }
  return { jurisdictionIds, needs };
}
