import { createHash } from "node:crypto";

import type { BodySourceWiring } from "../registry/source-wiring.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import {
  derivedRetrieval,
  type DerivedInputRef,
  type DerivedSuspension,
  type DerivedVersionEntry,
  type DerivedVersionPlan,
} from "./derived-authority.ts";
import {
  civicDataReadNotInitialized,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "./read-model.ts";
import { DATA_DOOR_KINDS, DOOR_KIND_SPECS, dataDoorConfig, isDataDoorKind, type DataDoorKind } from "./derived-door-kinds.ts";
import { DERIVED_WIRING_RECORD_CLASS, DERIVED_WIRING_SCOPE, derivedRequestedUrl } from "./derived-door.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "./types.ts";

/**
 * Which reviewed calendars publish, as which bodies. ACTIVE rows are read on their own attested host and nowhere
 * else; a SUSPENDED row stays, marked, and nothing new is read from it until a later review. Only what defines the
 * connection is in the record, so the version changes only when a connection does.
 */
export type DerivedWiringKind = "ICAL" | "OFFICIAL_PAGE_EVENTS" | "DILIGENT" | "LEGISTAR" | DataDoorKind;

export const DERIVED_WIRING_SOURCE_NAMES: Readonly<Record<DerivedWiringKind, string>> = {
  ICAL: "ical",
  OFFICIAL_PAGE_EVENTS: "official-page-events",
  DILIGENT: "diligent",
  LEGISTAR: "legistar",
  ...(Object.fromEntries(DATA_DOOR_KINDS.map((kind) => [kind, DOOR_KIND_SPECS[kind].sourceName])) as Record<DataDoorKind, string>),
};

export interface DerivedWiringRow {
  readonly bodyId: string;
  readonly ocdId: string;
  readonly bodyName: string;
  readonly kind: DerivedWiringKind;
  readonly route: string;
  /** The only host a member read of this row may touch. */
  readonly officialHost: string;
  readonly jurisdictionId: string;
  /** The covered state whose family this row is a member of, as `US-<postal code>`. */
  readonly state: string;
  readonly publishingOrg: string;
  readonly timeZone: string;
  readonly config: Readonly<Record<string, string>>;
  readonly crosswalkRowId: string;
  readonly reviewedAt: string;
  readonly verifiedAt: string;
}

export interface DerivedWiringRecord {
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
export function derivedWiringKey(kind: DerivedWiringKind, bodyId: string, route?: string): string {
  return `${DERIVED_WIRING_SOURCE_NAMES[kind]}:${bodyId}${typeof route === "string" && route ? `:${createHash("sha256").update(route).digest("hex").slice(0, 16)}` : ""}`;
}

/** A body's slug for meeting ids, from its id alone: stable, and never another body's. */
export function derivedMeetingSlug(bodyId: string): string {
  return `derived-${bodyId.replace(/^ocd-division\/country:us\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}`;
}

export function derivedAdapterConfig(input: {
  readonly kind: DerivedWiringKind;
  readonly route: string;
  readonly officialHost: string;
  readonly bodyId: string;
  readonly bodyName: string;
  readonly filter: Readonly<Record<string, string>>;
}): Readonly<Record<string, string>> {
  const common = { slug: derivedMeetingSlug(input.bodyId), bodyName: input.bodyName };
  if (isDataDoorKind(input.kind)) return dataDoorConfig({ kind: input.kind, route: input.route, slug: common.slug, bodyName: input.bodyName, filter: input.filter });
  if (input.kind === "LEGISTAR") {
    const slug = /^\/v1\/([a-z0-9_-]+)\/events\/?$/i.exec(new URL(input.route).pathname)?.[1];
    if (!slug) throw new Error("Invalid Legistar calendar route");
    return { ...common, slug, ...pick(input.filter, ["eventBodyId"]) };
  }
  if (input.kind === "DILIGENT") return { ...common, serviceBase: new URL(input.route).origin, meetingPath: "/Portal/MeetingInformation.aspx?Id=", ...pick(input.filter, ["titleMatch", "titleExclude"]) };
  return input.kind === "ICAL"
    ? { ...common, feedUrl: input.route, ...pick(input.filter, ["titleMatch", "categoryMatch", "titleExclude", "feedScope"]) }
    : { ...common, pageUrl: input.route, officialHost: input.officialHost, ...pick(input.filter, ["nameTerms"]) };
}

function pick(from: Readonly<Record<string, string>>, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.filter((key) => typeof from[key] === "string" && from[key]!.trim() !== "").map((key) => [key, from[key]!]));
}

export function bodySourceWiringFor(row: DerivedWiringRow): BodySourceWiring {
  return {
    bodyId: row.bodyId,
    ocdId: row.ocdId as BodySourceWiring["ocdId"],
    agendaSourceType: isDataDoorKind(row.kind) ? DOOR_KIND_SPECS[row.kind].agendaSourceType : row.kind,
    jurisdiction: row.publishingOrg,
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
    if (!row || (!["ICAL", "OFFICIAL_PAGE_EVENTS", "DILIGENT", "LEGISTAR"].includes(row.kind) && !isDataDoorKind(row.kind)) ||
      (record.id !== derivedWiringKey(row.kind, row.bodyId) && record.id !== derivedWiringKey(row.kind, row.bodyId, row.route))) {
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

export function familyMembers(projection: DerivedWiringProjection, state: string): readonly DerivedWiringRecord[] {
  return projection.records.filter((record) => record.row.state === state).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const WIRING_SOURCE_ID = "meeting-source-wiring" as const;
const WIRING_PARSER = "meeting-source-wiring/1" as const;
const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");

export function derivedWiringProjection(plan: DerivedVersionPlan<DerivedWiringRow>): DerivedWiringProjection {
  return {
    kind: "meeting-source-wiring",
    formatVersion: 1,
    records: plan.rows.map((entry) => ({
      id: entry.key,
      status: entry.suspension === undefined ? "ACTIVE" as const : "SUSPENDED" as const,
      row: entry.row,
      ...(entry.suspension === undefined ? {} : { suspension: entry.suspension }),
    })),
  };
}

export function derivedWiringEntries(projection: DerivedWiringProjection | null): DerivedVersionEntry<DerivedWiringRow>[] {
  return (projection?.records ?? []).map((record) => ({
    key: record.id,
    row: record.row,
    ...(record.suspension === undefined ? {} : { suspension: record.suspension }),
  }));
}

/**
 * The wiring candidate: authentic only as the inputs it was computed from (`retrieval.derived`). A plan with any
 * refused decision is never a GOOD version: its refusals are its semantic violations.
 */
export function derivedWiringCandidate(
  plan: DerivedVersionPlan<DerivedWiringRow>,
  extraInputs: readonly DerivedInputRef[],
  attemptedAt: string,
): RoutineCandidate {
  const readModel = derivedWiringProjection(plan);
  const byKey = new Map<string, DerivedInputRef>();
  for (const input of [...plan.inputs, ...extraInputs]) byKey.set(canonicalCivicDataJson(input), input);
  const inputs = [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, input]) => input);
  const retrieval = derivedRetrieval(inputs);
  const succeeded = retrieval.retrievedAt !== null;
  const retrievedAt = retrieval.retrievedAt ?? attemptedAt;
  const normalizedPayload = {
    readModel,
    decisions: {
      promoted: plan.promoted,
      carried: plan.carried,
      held: plan.held,
      suspended: plan.suspended,
      removed: plan.removed.map((r) => r.key),
      refusals: plan.refusals,
    },
  };
  const shapeIssue = derivedWiringProjectionIssue(readModel);
  const normalized = sha256Hex(canonicalCivicDataJson(readModel));
  return {
    id: `cv-${sha256Hex(`${WIRING_SOURCE_ID}\u001f${DERIVED_WIRING_SCOPE}\u001f${retrieval.rawHash}\u001f${retrievedAt}\u001f${attemptedAt}\u001f${normalized}`).slice(0, 32)}`,
    sourceId: WIRING_SOURCE_ID,
    recordClass: DERIVED_WIRING_RECORD_CLASS,
    scope: DERIVED_WIRING_SCOPE,
    sourceProjectionEvidence: sourceProjectionEvidence(WIRING_SOURCE_ID, DERIVED_WIRING_RECORD_CLASS, DERIVED_WIRING_SCOPE),
    retrieval: {
      succeeded,
      requestedUrl: derivedRequestedUrl(WIRING_SOURCE_ID, DERIVED_WIRING_SCOPE),
      finalUrl: null,
      httpStatus: null,
      retrievedAt,
      rawHash: succeeded ? retrieval.rawHash : null,
      ...(succeeded ? {} : { failureDetail: "No timed input: the wiring cannot claim when it was computed from." }),
      derived: { inputs },
    },
    normalization: {
      succeeded: true,
      parserVersion: WIRING_PARSER,
      schemaVersion: "meeting-source-wiring:1",
      normalizedHash: normalized,
      normalizedPayloadHash: sha256Hex(canonicalCivicDataJson(normalizedPayload)),
      inputRecords: readModel.records.length,
      outputRecords: readModel.records.length,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: readModel.records.map((record) => ({
      subjectId: record.id,
      jurisdiction: "US",
      identifiers: { record_id: record.id, body_id: record.row.bodyId },
      matchBasis: "EXACT_SCOPED_ID" as const,
      ambiguous: false,
    })),
    temporal: { version: DERIVED_WIRING_SCOPE, expectedVersion: DERIVED_WIRING_SCOPE, sourceThrough: retrievedAt, staleAtRetrieval: false },
    semantics: {
      factKind: "reviewed calendar-to-body connections recomputed from promoted and vaulted inputs",
      violations: [
        ...plan.refusals.map((r) => `${r.code}: ${r.key}: ${r.detail}`),
        ...(shapeIssue === null ? [] : [`the version is not a meeting-source wiring: ${shapeIssue}`]),
      ],
    },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: "every reviewed crosswalk row's connection, as its latest walk and the vault show it; no wider universe claim",
      returnedRecords: readModel.records.length,
      declaredTotal: null,
      paginationComplete: false,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{
      consumer: "derived meeting families (lib/civic-data/derived-meeting-family.ts)",
      passed: shapeIssue === null,
      detail: `${readModel.records.filter((r) => r.status === "ACTIVE").length} active and ${readModel.records.filter((r) => r.status === "SUSPENDED").length} suspended connection(s).`,
    }],
    normalizedPayload,
    readModel,
    excludedFacts: plan.held.map((h) => ({ key: `derived-wiring:${h.key}`, code: `DERIVED_ROW_HELD_${h.reason}`, detail: h.detail })),
  };
}

export function derivedWiringFailedCandidate(attemptedAt: string, failureDetail: string): RoutineCandidate {
  return {
    id: `cv-${sha256Hex(`${WIRING_SOURCE_ID}\u001f${DERIVED_WIRING_SCOPE}\u001ffailed\u001f${attemptedAt}`).slice(0, 32)}`,
    sourceId: WIRING_SOURCE_ID,
    recordClass: DERIVED_WIRING_RECORD_CLASS,
    scope: DERIVED_WIRING_SCOPE,
    sourceProjectionEvidence: sourceProjectionEvidence(WIRING_SOURCE_ID, DERIVED_WIRING_RECORD_CLASS, DERIVED_WIRING_SCOPE),
    retrieval: { succeeded: false, requestedUrl: derivedRequestedUrl(WIRING_SOURCE_ID, DERIVED_WIRING_SCOPE), finalUrl: null, httpStatus: null, retrievedAt: attemptedAt, rawHash: null, failureDetail },
    normalization: {
      succeeded: false, parserVersion: WIRING_PARSER, schemaVersion: "meeting-source-wiring:1", normalizedHash: null,
      inputRecords: 0, outputRecords: 0, droppedRecords: 0, missingRequiredFields: [], failureDetail,
    },
    identities: [],
    temporal: { version: DERIVED_WIRING_SCOPE, expectedVersion: DERIVED_WIRING_SCOPE, sourceThrough: attemptedAt, staleAtRetrieval: false },
    semantics: { factKind: "reviewed calendar-to-body connections recomputed from promoted and vaulted inputs", violations: [] },
    horizon: { kind: "OPEN_FACT_SET", query: "no inputs read", returnedRecords: 0, declaredTotal: null, paginationComplete: false, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [],
    normalizedPayload: null,
    readModel: null,
  };
}
