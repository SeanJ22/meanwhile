import { createHash } from "node:crypto";

import { canonicalCivicDataJson } from "./changes.ts";
import { derivedRetrieval, type DerivedInputRef } from "./derived-authority.ts";
import { derivedRequestedUrl } from "./derived-door.ts";
import { crosswalkListIssues, crosswalkRowId, crosswalkRowIssue, type MeetingBodyCrosswalkRow } from "./meeting-body-crosswalk.ts";
import {
  civicDataReadNotInitialized,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "./read-model.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "./types.ts";

/**
 * Calendar-to-body rows the runner's deterministic reviewer accepted, kept like reviewed rows. An accepted row is
 * never dropped: it is carried until a later review of a newer walk renews it. Holds are excluded facts, not rows,
 * and a manually reviewed row wins over an automatic one (`composeCrosswalk`).
 */
export const DERIVED_CROSSWALK_CONTRACT_ID = "meeting-body-crosswalk-derived" as const;
export const DERIVED_CROSSWALK_SOURCE_ID = "meeting-source-wiring" as const;
export const DERIVED_CROSSWALK_RECORD_CLASS = "CURATED_READER_RECORD" as const;
export const DERIVED_CROSSWALK_SCOPE = "US:meeting-body-crosswalk-derived" as const;
const DERIVED_CROSSWALK_PARSER = "meeting-source-wiring/1" as const;

export const AUTO_CROSSWALK_REVIEWER_PREFIX = "auto-crosswalk-reviewer@" as const;
const REVIEWER = /^auto-crosswalk-reviewer@[0-9a-f]{12}$/;

export interface DerivedCrosswalkProjection {
  readonly kind: "meeting-body-crosswalk-derived";
  readonly formatVersion: 1;
  readonly records: readonly MeetingBodyCrosswalkRow[];
}

export const AUTO_CROSSWALK_HOLD_REASONS = [
  "KIND_NOT_REVIEWABLE",
  "HOST_NOT_ATTESTED",
  "HOST_NOT_OWN",
  "PERMISSION_NOT_SHOWN",
  "ROBOTS_NOT_READ",
  "EVIDENCE_NOT_VAULTED",
  "BODY_NOT_REGISTERED",
  "ALREADY_WIRED",
  "CALENDAR_UNREADABLE",
  "NO_EVENT_NAMES_BODY",
  "GOVERNING_NAME_CONFLICT",
  "SEPARATE_GOVERNMENT_NAME",
  "NAME_NOT_PRINTED_ON_OWN_PAGE",
  "AMBIGUOUS_TITLE",
  "SELECTS_NOTHING",
  "TIME_ZONE_UNKNOWN",
  "TIME_ZONE_CONFLICT",
  // A small-town feed may stamp local wall time as UTC.
  "UTC_STAMPED_TIMES",
  "CONFLICTING_SELECTION",
  "ROW_CHECK_FAILED",
] as const;
export type AutoCrosswalkHoldReason = (typeof AUTO_CROSSWALK_HOLD_REASONS)[number];

export interface AutoCrosswalkHold {
  /** Stable pass to pass: `auto-crosswalk:<jurisdiction>|<route>|<reason>|<body slug or ->`. */
  readonly key: string;
  readonly jurisdictionId: string;
  readonly route: string;
  readonly bodyName: string | null;
  readonly bodyId: string | null;
  readonly reason: AutoCrosswalkHoldReason;
  readonly detail: string;
  readonly ruledOut: string;
  readonly wouldSettle: string;
  readonly whoMovesNext: string;
}

export interface AutoCrosswalkAccepted {
  readonly row: MeetingBodyCrosswalkRow;
  readonly inputs: readonly DerivedInputRef[];
}

export interface AutoCrosswalkReview {
  readonly jurisdictionId: string;
  readonly inputs: readonly DerivedInputRef[];
  readonly accepted: readonly AutoCrosswalkAccepted[];
  readonly held: readonly AutoCrosswalkHold[];
}

const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

export function derivedCrosswalkProjectionIssue(value: unknown): string | null {
  const v = value as Partial<DerivedCrosswalkProjection> | null;
  if (typeof v !== "object" || v === null || v.kind !== "meeting-body-crosswalk-derived" || v.formatVersion !== 1 || !Array.isArray(v.records)) {
    return "not an automatic meeting-body crosswalk version";
  }
  for (const row of v.records) {
    const issue = crosswalkRowIssue(row);
    if (issue !== null) return issue;
    if (!REVIEWER.test(row.reviewedBy)) return `${row.id}: an automatic row names the reviewer's code version, not ${row.reviewedBy}`;
  }
  const listIssues = crosswalkListIssues(v.records);
  return listIssues.length === 0 ? null : listIssues[0]!;
}

let installed: CivicDataReadResult<DerivedCrosswalkProjection> | null = null;

export async function readDerivedMeetingBodyCrosswalk(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<DerivedCrosswalkProjection>> {
  const result = await readPromotedCivicData<DerivedCrosswalkProjection>(DERIVED_CROSSWALK_RECORD_CLASS, DERIVED_CROSSWALK_SCOPE, options);
  if (result.kind === "PROMOTED") {
    const issue = derivedCrosswalkProjectionIssue(result.value);
    if (issue !== null) {
      installed = { kind: "STORE_UNREACHABLE", value: null, metadata: result.metadata, code: "PROMOTION_PROOF_INVALID", detail: `meeting-body-crosswalk-derived ${result.metadata.versionId}: ${issue}` };
      return installed;
    }
  }
  installed = result;
  return result;
}

export function derivedMeetingBodyCrosswalkReadState(): CivicDataReadResult<DerivedCrosswalkProjection> {
  return installed ?? civicDataReadNotInitialized(DERIVED_CROSSWALK_RECORD_CLASS, DERIVED_CROSSWALK_SCOPE, "The automatic meeting-body crosswalk has not been read for this process.");
}

/** Everything that defines the connection, and nothing that moves with a re-read. */
function substance(row: MeetingBodyCrosswalkRow): string {
  const { reviewedBy: _by, reviewedAt: _at, evidence: _evidence, ...rest } = row;
  return canonicalCivicDataJson(rest);
}

export interface DerivedCrosswalkPlan {
  readonly rows: readonly MeetingBodyCrosswalkRow[];
  readonly accepted: readonly string[];
  readonly renewed: readonly string[];
  readonly carried: readonly string[];
  readonly held: readonly AutoCrosswalkHold[];
  readonly inputs: readonly DerivedInputRef[];
}

const inputKey = (input: DerivedInputRef): string => canonicalCivicDataJson(input);
const byKey = <T>(key: (value: T) => string) => (a: T, b: T): number => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

/**
 * **THE RULE.** Plan the next version from the previous one and this pass's reviews. Pure.
 *
 * - An accepted row new to the store enters.
 * - An accepted row the store holds is carried byte-exactly while its substance and its evidence are the same
 *   (the same walk reviewed again); a newer walk's evidence, or a changed filter or name, renews it with the new
 *   evidence and review time.
 * - A row this pass did not accept (no walk, an outage, a hold) is carried byte-exactly. A row is never dropped.
 */
export function planDerivedCrosswalk(input: {
  readonly previous: readonly MeetingBodyCrosswalkRow[];
  readonly reviews: readonly AutoCrosswalkReview[];
}): DerivedCrosswalkPlan {
  const before = new Map(input.previous.map((row) => [row.id, row]));
  const next = new Map(before);
  const routeKey = (row: MeetingBodyCrosswalkRow) => crosswalkRowId(row.bodyId, row.kind, row.route);
  const routes = new Map(input.previous.map(row => [routeKey(row), row]));
  const accepted: string[] = [];
  const renewed: string[] = [];
  const inputs = new Map<string, DerivedInputRef>();
  const held = new Map<string, AutoCrosswalkHold>();
  for (const review of input.reviews) {
    for (const h of review.held) held.set(h.key, h);
    for (const i of review.inputs) inputs.set(inputKey(i), i);
    for (const { row: reviewed, inputs: rowInputs } of review.accepted) {
      for (const i of rowInputs) inputs.set(inputKey(i), i);
      const key = routeKey(reviewed);
      const prior = routes.get(key);
      // Keep existing identities and their evidence. A new route must never
      // overwrite the legacy body/kind row for another verified calendar.
      const row = { ...reviewed, id: prior?.id ?? (next.has(reviewed.id) ? key : reviewed.id) };
      if (prior === undefined) {
        next.set(row.id, row);
        routes.set(key, row);
        accepted.push(row.id);
        continue;
      }
      const sameEvidence = prior.evidence.readAt === row.evidence.readAt &&
        prior.evidence.calendar.sha256 === row.evidence.calendar.sha256 &&
        prior.evidence.bodyPage.sha256 === row.evidence.bodyPage.sha256;
      if (sameEvidence && substance(prior) === substance(row)) continue;
      /* Never backward: a review of an older walk than the row's own evidence does not replace it. */
      if (Date.parse(row.evidence.readAt) < Date.parse(prior.evidence.readAt)) continue;
      next.set(row.id, row);
      routes.set(key, row);
      renewed.push(row.id);
    }
  }
  const touched = new Set([...accepted, ...renewed]);
  return {
    rows: [...next.values()].sort(byKey((row) => row.id)),
    accepted: accepted.sort(),
    renewed: renewed.sort(),
    carried: [...before.keys()].filter((id) => !touched.has(id)).sort(),
    held: [...held.values()].sort(byKey((h) => h.key)),
    inputs: [...inputs.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, i]) => i),
  };
}

const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");

export function derivedCrosswalkProjection(plan: DerivedCrosswalkPlan): DerivedCrosswalkProjection {
  return { kind: "meeting-body-crosswalk-derived", formatVersion: 1, records: plan.rows };
}

export function autoCrosswalkHeldFact(h: AutoCrosswalkHold): { key: string; code: string; detail: string; record: unknown } {
  return {
    key: h.key,
    code: `AUTO_CROSSWALK_HELD_${h.reason}`,
    detail: `${h.detail} Ruled out: ${h.ruledOut}. Would settle it: ${h.wouldSettle}. Who moves next: ${h.whoMovesNext}.`,
    record: {
      reason: h.reason,
      jurisdictionId: h.jurisdictionId,
      route: h.route,
      bodyName: h.bodyName,
      bodyId: h.bodyId,
      ruledOut: h.ruledOut,
      wouldSettle: h.wouldSettle,
      whoMovesNext: h.whoMovesNext,
    },
  };
}

export function derivedCrosswalkCandidate(
  plan: DerivedCrosswalkPlan,
  extraInputs: readonly DerivedInputRef[],
  attemptedAt: string,
): RoutineCandidate {
  const readModel = derivedCrosswalkProjection(plan);
  const keyed = new Map<string, DerivedInputRef>();
  for (const i of [...plan.inputs, ...extraInputs]) keyed.set(inputKey(i), i);
  const inputs = [...keyed.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, i]) => i);
  const retrieval = derivedRetrieval(inputs);
  const succeeded = retrieval.retrievedAt !== null;
  const retrievedAt = retrieval.retrievedAt ?? attemptedAt;
  const shapeIssue = derivedCrosswalkProjectionIssue(readModel);
  const normalized = sha256Hex(canonicalCivicDataJson(readModel));
  const normalizedPayload = {
    readModel,
    decisions: { accepted: plan.accepted, renewed: plan.renewed, carried: plan.carried, held: plan.held.map((h) => h.key) },
  };
  return {
    id: `cv-${sha256Hex(`${DERIVED_CROSSWALK_CONTRACT_ID}\u001f${DERIVED_CROSSWALK_SCOPE}\u001f${retrieval.rawHash}\u001f${retrievedAt}\u001f${attemptedAt}\u001f${normalized}`).slice(0, 32)}`,
    sourceId: DERIVED_CROSSWALK_SOURCE_ID,
    recordClass: DERIVED_CROSSWALK_RECORD_CLASS,
    scope: DERIVED_CROSSWALK_SCOPE,
    sourceProjectionEvidence: sourceProjectionEvidence(DERIVED_CROSSWALK_SOURCE_ID, DERIVED_CROSSWALK_RECORD_CLASS, DERIVED_CROSSWALK_SCOPE),
    retrieval: {
      succeeded,
      requestedUrl: derivedRequestedUrl(DERIVED_CROSSWALK_SOURCE_ID, DERIVED_CROSSWALK_SCOPE),
      finalUrl: null,
      httpStatus: null,
      retrievedAt,
      rawHash: succeeded ? retrieval.rawHash : null,
      ...(succeeded ? {} : { failureDetail: "No timed input: the automatic crosswalk cannot claim when it was computed from." }),
      derived: { inputs },
    },
    normalization: {
      succeeded: true,
      parserVersion: DERIVED_CROSSWALK_PARSER,
      schemaVersion: "meeting-body-crosswalk-derived:1",
      normalizedHash: normalized,
      normalizedPayloadHash: sha256Hex(canonicalCivicDataJson(normalizedPayload)),
      inputRecords: readModel.records.length,
      outputRecords: readModel.records.length,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: readModel.records.map((row) => ({
      subjectId: row.id,
      jurisdiction: "US",
      identifiers: { record_id: row.id, body_id: row.bodyId },
      matchBasis: "EXACT_SCOPED_ID" as const,
      ambiguous: false,
    })),
    temporal: { version: DERIVED_CROSSWALK_SCOPE, expectedVersion: DERIVED_CROSSWALK_SCOPE, sourceThrough: retrievedAt, staleAtRetrieval: false },
    semantics: {
      factKind: "calendar-to-body connections accepted by the runner's deterministic reviewer on vaulted official evidence",
      violations: shapeIssue === null ? [] : [`the version is not an automatic meeting-body crosswalk: ${shapeIssue}`],
    },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: "every calendar a discovery walk found on a government's attested own host, as the reviewer read it; no wider universe claim",
      returnedRecords: readModel.records.length,
      declaredTotal: null,
      paginationComplete: false,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{
      consumer: "derived meeting-source wiring (scripts/derive-meeting-source-wiring.mts)",
      passed: shapeIssue === null,
      detail: `${readModel.records.length} automatic row(s): ${plan.accepted.length} new, ${plan.renewed.length} renewed, ${plan.carried.length} carried; ${plan.held.length} proposal(s) held.`,
    }],
    normalizedPayload,
    readModel,
    excludedFacts: plan.held.map(autoCrosswalkHeldFact),
  };
}

export function derivedCrosswalkFailedCandidate(attemptedAt: string, failureDetail: string): RoutineCandidate {
  return {
    id: `cv-${sha256Hex(`${DERIVED_CROSSWALK_CONTRACT_ID}\u001f${DERIVED_CROSSWALK_SCOPE}\u001ffailed\u001f${attemptedAt}`).slice(0, 32)}`,
    sourceId: DERIVED_CROSSWALK_SOURCE_ID,
    recordClass: DERIVED_CROSSWALK_RECORD_CLASS,
    scope: DERIVED_CROSSWALK_SCOPE,
    sourceProjectionEvidence: sourceProjectionEvidence(DERIVED_CROSSWALK_SOURCE_ID, DERIVED_CROSSWALK_RECORD_CLASS, DERIVED_CROSSWALK_SCOPE),
    retrieval: { succeeded: false, requestedUrl: derivedRequestedUrl(DERIVED_CROSSWALK_SOURCE_ID, DERIVED_CROSSWALK_SCOPE), finalUrl: null, httpStatus: null, retrievedAt: attemptedAt, rawHash: null, failureDetail },
    normalization: {
      succeeded: false, parserVersion: DERIVED_CROSSWALK_PARSER, schemaVersion: "meeting-body-crosswalk-derived:1", normalizedHash: null,
      inputRecords: 0, outputRecords: 0, droppedRecords: 0, missingRequiredFields: [], failureDetail,
    },
    identities: [],
    temporal: { version: DERIVED_CROSSWALK_SCOPE, expectedVersion: DERIVED_CROSSWALK_SCOPE, sourceThrough: attemptedAt, staleAtRetrieval: false },
    semantics: { factKind: "calendar-to-body connections accepted by the runner's deterministic reviewer on vaulted official evidence", violations: [] },
    horizon: { kind: "OPEN_FACT_SET", query: "no inputs read", returnedRecords: 0, declaredTotal: null, paginationComplete: false, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [],
    normalizedPayload: null,
    readModel: null,
  };
}

export interface ComposedCrosswalk {
  readonly rows: readonly MeetingBodyCrosswalkRow[];
  readonly automaticIds: ReadonlySet<string>;
  readonly shadowed: readonly { readonly id: string; readonly why: string }[];
}

/**
 * **MANUAL ROWS WIN.** The rows the wiring derive decides: every well-formed manual row, and every automatic row no
 * manual row shadows. A manual row shadows an automatic one for the same body, kind and route, whatever its status (a
 * withdrawal by review is never undone by the reviewer), and an automatic row claiming a manual ACTIVE row's
 * calendar and filter for another body.
 */
export function composeCrosswalk(
  manual: readonly MeetingBodyCrosswalkRow[] | null,
  automatic: readonly MeetingBodyCrosswalkRow[] | null,
): ComposedCrosswalk {
  const reviewed = (manual ?? []).filter((row) => crosswalkRowIssue(row) === null);
  const routeKey = (row: MeetingBodyCrosswalkRow) => crosswalkRowId(row.bodyId, row.kind, row.route);
  const ids = new Set(reviewed.map(routeKey));
  const claim = (row: MeetingBodyCrosswalkRow): string => `${row.route}\n${JSON.stringify(Object.entries(row.filter).sort())}`;
  const claims = new Map(reviewed.filter((row) => row.status === "ACTIVE").map((row) => [claim(row), row] as const));
  const kept: MeetingBodyCrosswalkRow[] = [];
  const shadowed: { id: string; why: string }[] = [];
  for (const row of automatic ?? []) {
    if (crosswalkRowIssue(row) !== null) continue;
    if (ids.has(routeKey(row))) {
      shadowed.push({ id: row.id, why: "a manually reviewed row for the same body, calendar kind and route wins" });
      continue;
    }
    const other = claims.get(claim(row));
    if (other !== undefined && other.bodyId !== row.bodyId) {
      shadowed.push({ id: row.id, why: `the manually reviewed row ${other.id} claims the same calendar and filter` });
      continue;
    }
    kept.push(row);
  }
  return { rows: [...reviewed, ...kept], automaticIds: new Set(kept.map((row) => row.id)), shadowed };
}

export function isAutomaticCrosswalkRow(row: Pick<MeetingBodyCrosswalkRow, "reviewedBy">): boolean {
  return text(row.reviewedBy) && REVIEWER.test(row.reviewedBy);
}
