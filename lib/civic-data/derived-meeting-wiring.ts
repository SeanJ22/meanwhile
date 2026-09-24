/**
 * **THE DERIVED MEETING-SOURCE WIRING: WHICH REVIEWED CALENDARS PUBLISH, AS
 * WHICH BODIES.** (C16, 2026-09-24.)
 *
 * The standing runner recomputes this store (`meeting-source-wiring`,
 * CURATED_READER_RECORD, `US:meeting-source-wiring`) from promoted and vaulted
 * inputs only (`lib/civic-data/derived-authority.ts`). Each record is one
 * reviewed route of one body:
 *
 * - ACTIVE: the discovery walk validated the crosswalk's route, its host is
 *   attested, the reader adapter produced a sitting for the body from the
 *   vaulted bytes, and no hand-wired route serves the body. An ACTIVE record is
 *   a member of its state's derived meeting family and is read on its own
 *   attested host (`officialHost`) and nowhere else.
 * - SUSPENDED: a review trigger fired (C16). The record stays, marked, so the
 *   family keeps its previously verified meetings; nothing new is read from it
 *   until a later review restores or corrects it.
 *
 * Only what defines the connection is in the record, so the version changes
 * only when a connection does; each pass's walks, verifications and inputs are
 * the candidate's evidence, not its read model.
 */
import type { BodySourceWiring } from "../registry/source-wiring.ts";
import type { DerivedSuspension } from "./derived-authority.ts";
import {
  civicDataReadNotInitialized,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "./read-model.ts";
import { DERIVED_WIRING_RECORD_CLASS, DERIVED_WIRING_SCOPE } from "./derived-door.ts";

/** The adapter kinds a derived row wires, as the crosswalk names them. */
export type DerivedWiringKind = "ICAL" | "OFFICIAL_PAGE_EVENTS";

/** The meeting source (adapter) name each kind's meetings carry. */
export const DERIVED_WIRING_SOURCE_NAMES: Readonly<Record<DerivedWiringKind, string>> = {
  ICAL: "ical",
  OFFICIAL_PAGE_EVENTS: "official-page-events",
};

/** One wired route of one body: exactly what the reader adapter needs, and where it came from. */
export interface DerivedWiringRow {
  readonly bodyId: string;
  readonly ocdId: string;
  readonly bodyName: string;
  readonly kind: DerivedWiringKind;
  /** The calendar the crosswalk reviewed and discovery validated. */
  readonly route: string;
  /** The only host a member read of this row may touch. */
  readonly officialHost: string;
  readonly jurisdictionId: string;
  /** The covered state whose family this row is a member of: `US-AZ`. */
  readonly state: string;
  readonly publishingOrg: string;
  readonly timeZone: string;
  /** The adapter's own configuration: the route, the reviewed filter, the slug its meeting ids carry. */
  readonly config: Readonly<Record<string, string>>;
  /** The reviewed crosswalk row this rests on, and when it was reviewed. */
  readonly crosswalkRowId: string;
  readonly reviewedAt: string;
  /** When the crosswalk's evidence was read: the row's `verifiedAt` as a wiring row. */
  readonly verifiedAt: string;
}

export interface DerivedWiringRecord {
  /** `${adapter source name}:${bodyId}`. */
  readonly id: string;
  readonly status: "ACTIVE" | "SUSPENDED";
  readonly row: DerivedWiringRow;
  readonly suspension?: DerivedSuspension;
}

export interface DerivedWiringProjection {
  readonly kind: "meeting-source-wiring";
  readonly formatVersion: 1;
  readonly records: readonly DerivedWiringRecord[];
}

/** The store key of a row: one route of one body, as its meetings' source names it. */
export function derivedWiringKey(kind: DerivedWiringKind, bodyId: string): string {
  return `${DERIVED_WIRING_SOURCE_NAMES[kind]}:${bodyId}`;
}

/** A body's slug for meeting ids, from its id alone: stable, and never another body's. */
export function derivedMeetingSlug(bodyId: string): string {
  return `derived-${bodyId.replace(/^ocd-division\/country:us\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}`;
}

/** The adapter configuration a crosswalk row's route and reviewed filter give a wired row. */
export function derivedAdapterConfig(input: {
  readonly kind: DerivedWiringKind;
  readonly route: string;
  readonly officialHost: string;
  readonly bodyId: string;
  readonly bodyName: string;
  readonly filter: Readonly<Record<string, string>>;
}): Readonly<Record<string, string>> {
  const common = { slug: derivedMeetingSlug(input.bodyId), bodyName: input.bodyName };
  return input.kind === "ICAL"
    ? { ...common, feedUrl: input.route, ...pick(input.filter, ["titleMatch", "categoryMatch", "titleExclude"]) }
    : { ...common, pageUrl: input.route, officialHost: input.officialHost, ...pick(input.filter, ["nameTerms"]) };
}

function pick(from: Readonly<Record<string, string>>, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.filter((key) => typeof from[key] === "string" && from[key]!.trim() !== "").map((key) => [key, from[key]!]));
}

/** An ACTIVE row as the composite adapters read a wiring row. */
export function bodySourceWiringFor(row: DerivedWiringRow): BodySourceWiring {
  return {
    bodyId: row.bodyId,
    ocdId: row.ocdId as BodySourceWiring["ocdId"],
    agendaSourceType: row.kind,
    jurisdiction: row.jurisdictionId,
    publishingOrg: row.publishingOrg,
    timeZone: row.timeZone,
    config: { ...row.config },
    verifiedAt: row.verifiedAt,
  };
}

/** Why a projection is not a wiring version, or null. Checked on every read: a malformed version is never served. */
export function derivedWiringProjectionIssue(value: unknown): string | null {
  const v = value as Partial<DerivedWiringProjection> | null;
  if (typeof v !== "object" || v === null || v.kind !== "meeting-source-wiring" || v.formatVersion !== 1 || !Array.isArray(v.records)) {
    return "not a meeting-source-wiring version";
  }
  const ids = new Set<string>();
  for (const record of v.records) {
    const row = record?.row;
    if (!record || typeof record.id !== "string" || ids.has(record.id)) return "a wiring record has no id, or a duplicate one";
    ids.add(record.id);
    if (record.status !== "ACTIVE" && record.status !== "SUSPENDED") return `${record.id} has no status`;
    if ((record.status === "SUSPENDED") !== (record.suspension !== undefined)) return `${record.id}: only a suspended record carries a suspension`;
    if (!row || (row.kind !== "ICAL" && row.kind !== "OFFICIAL_PAGE_EVENTS") || record.id !== derivedWiringKey(row.kind, row.bodyId)) {
      return `${record.id} is not keyed by its own route and body`;
    }
    if (!/^https:\/\//.test(row.route) || typeof row.officialHost !== "string" || new URL(row.route).hostname.toLowerCase() !== row.officialHost.toLowerCase()) {
      return `${record.id}: its route is not on its attested host`;
    }
    if (!/^US-[A-Z]{2}$/.test(row.state)) return `${record.id} names no covered state`;
  }
  return null;
}

let installed: CivicDataReadResult<DerivedWiringProjection> | null = null;

/** Read the promoted wiring version, refusing a malformed one. A store error stays an error, never "no rows". */
export async function readDerivedMeetingWiring(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<DerivedWiringProjection>> {
  const result = await readPromotedCivicData<DerivedWiringProjection>(DERIVED_WIRING_RECORD_CLASS, DERIVED_WIRING_SCOPE, options);
  if (result.kind === "PROMOTED") {
    const issue = derivedWiringProjectionIssue(result.value);
    if (issue !== null) {
      installed = { kind: "STORE_UNREACHABLE", value: null, metadata: result.metadata, code: "PROMOTION_PROOF_INVALID", detail: `meeting-source-wiring ${result.metadata.versionId}: ${issue}` };
      return installed;
    }
  }
  installed = result;
  return result;
}

export function derivedMeetingWiringReadState(): CivicDataReadResult<DerivedWiringProjection> {
  return installed ?? civicDataReadNotInitialized(DERIVED_WIRING_RECORD_CLASS, DERIVED_WIRING_SCOPE, "The meeting-source wiring has not been read for this process.");
}

/** A family's members: the version's records for one state, ACTIVE and SUSPENDED, in key order. */
export function familyMembers(projection: DerivedWiringProjection, state: string): readonly DerivedWiringRecord[] {
  return projection.records.filter((record) => record.row.state === state).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
