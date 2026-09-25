/**
 * **THE AUTOMATIC CALENDAR-TO-BODY RECORDS: ROWS THE RUNNER'S OWN REVIEWER
 * ACCEPTED, KEPT LIKE THE REVIEWED ONES.** (C16 option A, 2026-09-25.)
 *
 * The owner's decision, recorded 2026-09-24T22:43Z: "Agents may review and
 * promote the records connecting a calendar to its governing body. I should
 * not have to review every calendar. Use saved official evidence to establish
 * the exact body and which meetings belong to it, then publish through the
 * existing verified publication process."
 *
 * The manual crosswalk (`meeting-body-crosswalk`) is promoted by a reviewing
 * agent session, one package at a time. This store is the same record, made by
 * an agent-written deterministic reviewer that the standing runner applies to
 * every discovery walk that found a calendar
 * (`lib/control-plane/discovery/auto-crosswalk.ts`). Its routine contract
 * (`meeting-body-crosswalk-derived`, CURATED_READER_RECORD,
 * `US:meeting-body-crosswalk-derived`) is DERIVED: a version is authentic only
 * as the exact inputs it names (the previous version, each state's promoted
 * registration, the walks it reviewed and the vaulted bytes each row cites),
 * checked by the validator and at the door (`derived-door.ts`).
 *
 * What a version holds, and what it never does:
 *
 * - every row passes every C16 row check (`crosswalkRowIssue`), cites the
 *   reviewer's code version as its reviewer (never the owner), and no two
 *   active rows claim the same calendar under the same filter;
 * - a row once accepted is never dropped. An absent walk, an outage, a walk
 *   that did not reach the calendar, or a later review that holds it carries
 *   it exactly as it was: suspending a connection is the wiring's review
 *   triggers' job, and they apply to these rows exactly as to reviewed ones;
 * - a row changes only when a later review of a newer walk accepts it again,
 *   so its evidence and review time move forward (which is also what restores
 *   a suspended connection: a review later than its suspension);
 * - what the reviewer held is not in the version. It is each candidate's
 *   excluded facts, keyed stably, with what was ruled out, what would settle
 *   it and who moves next: Admin's held records show it.
 *
 * The wiring derive composes these rows with the manual crosswalk
 * (`composeCrosswalk`): a manually reviewed row wins over an automatic one for
 * the same body and kind (withdrawn or not), and over one claiming its
 * calendar and filter for another body.
 */
import { createHash } from "node:crypto";

import { canonicalCivicDataJson } from "./changes.ts";
import { derivedRetrieval, type DerivedInputRef } from "./derived-authority.ts";
import { derivedRequestedUrl } from "./derived-door.ts";
import { crosswalkListIssues, crosswalkRowIssue, type MeetingBodyCrosswalkRow } from "./meeting-body-crosswalk.ts";
import {
  civicDataReadNotInitialized,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "./read-model.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "./types.ts";

export const DERIVED_CROSSWALK_CONTRACT_ID = "meeting-body-crosswalk-derived" as const;
/** The authority it shares with the wiring store: the standing runner, from promoted and vaulted inputs only. */
export const DERIVED_CROSSWALK_SOURCE_ID = "meeting-source-wiring" as const;
export const DERIVED_CROSSWALK_RECORD_CLASS = "CURATED_READER_RECORD" as const;
export const DERIVED_CROSSWALK_SCOPE = "US:meeting-body-crosswalk-derived" as const;
const DERIVED_CROSSWALK_PARSER = "meeting-source-wiring/1" as const;

/** Every automatic row's reviewer names the reviewer's code version: `auto-crosswalk-reviewer@<12 hex>`. */
export const AUTO_CROSSWALK_REVIEWER_PREFIX = "auto-crosswalk-reviewer@" as const;
const REVIEWER = /^auto-crosswalk-reviewer@[0-9a-f]{12}$/;

export interface DerivedCrosswalkProjection {
  readonly kind: "meeting-body-crosswalk-derived";
  readonly formatVersion: 1;
  readonly records: readonly MeetingBodyCrosswalkRow[];
}

/** Every reason the reviewer holds a proposal. A hold publishes nothing and never removes an accepted row. */
export const AUTO_CROSSWALK_HOLD_REASONS = [
  /** The find is of a kind no reviewed filter is defined for (a Legistar or AgendaCenter route). */
  "KIND_NOT_REVIEWABLE",
  /** The walk's chain from the government's recorded site to the calendar cannot be recomputed. */
  "HOST_NOT_ATTESTED",
  /** The calendar is not on the host the walk attested as the government's own. */
  "HOST_NOT_OWN",
  /** A read the proposal rests on has no robots permission recorded. */
  "PERMISSION_NOT_SHOWN",
  /** The calendar's or the naming page's bytes are not held in the vault. */
  "EVIDENCE_NOT_VAULTED",
  /** The state's registration pairs this government with no body. */
  "BODY_NOT_REGISTERED",
  /** A hand-wired route already serves the body. */
  "ALREADY_WIRED",
  /** The held bytes are not a calendar of the find's kind, or hold no event. */
  "CALENDAR_UNREADABLE",
  /** No event names the government's governing body by any governing-body name its kind of government uses. */
  "NO_EVENT_NAMES_BODY",
  /** Events name the governing body two different ways; which is the government's is a review. */
  "GOVERNING_NAME_CONFLICT",
  /** The printed name reads as another government's body (a county's, a school district's, an authority). */
  "SEPARATE_GOVERNMENT_NAME",
  /** No page of the government's own host the walk saved prints the body's name. */
  "NAME_NOT_PRINTED_ON_OWN_PAGE",
  /** An event the filter would select names another body too, and no exact exclusion separates them. */
  "AMBIGUOUS_TITLE",
  /** The filter selects no event. */
  "SELECTS_NOTHING",
  /** The calendar states no zone, and its state spans zones. */
  "TIME_ZONE_UNKNOWN",
  /** The calendar's zone disagrees with itself or with its state's. */
  "TIME_ZONE_CONFLICT",
  /** The selected events are stamped in UTC, which a small-town feed may use for local wall time (Holbrook, R21). */
  "UTC_STAMPED_TIMES",
  /** Two proposed bodies' filters select the same event. */
  "CONFLICTING_SELECTION",
  /** More bodies than one calendar is read for in one pass. */
  "ROUTE_CAP",
  /** The row the reviewer built fails a C16 row check (ours, never guessed around). */
  "ROW_CHECK_FAILED",
] as const;
export type AutoCrosswalkHoldReason = (typeof AUTO_CROSSWALK_HOLD_REASONS)[number];

/** One held proposal: a dead end with what was ruled out, what would settle it and who moves next. */
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

/** One accepted row, with the inputs it rests on. */
export interface AutoCrosswalkAccepted {
  readonly row: MeetingBodyCrosswalkRow;
  readonly inputs: readonly DerivedInputRef[];
}

/** The reviewer's reading of one walk. */
export interface AutoCrosswalkReview {
  readonly jurisdictionId: string;
  /** The walk reviewed, and the registration the body rests on. */
  readonly inputs: readonly DerivedInputRef[];
  readonly accepted: readonly AutoCrosswalkAccepted[];
  readonly held: readonly AutoCrosswalkHold[];
}

const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** Why a projection is not an automatic crosswalk version, or null. Checked on every read: a malformed version is never served. */
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

/** Read the promoted automatic crosswalk, refusing a malformed one. A store error stays an error, never "no rows". */
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

/* ------------------------------------------------------------------ plan */

/** Everything that defines the connection, and nothing that moves with a re-read. */
function substance(row: MeetingBodyCrosswalkRow): string {
  const { reviewedBy: _by, reviewedAt: _at, evidence: _evidence, ...rest } = row;
  return canonicalCivicDataJson(rest);
}

export interface DerivedCrosswalkPlan {
  /** The next version's rows, sorted by id. */
  readonly rows: readonly MeetingBodyCrosswalkRow[];
  /** Rows first accepted this version. */
  readonly accepted: readonly string[];
  /** Rows a later review of a newer walk accepted again, with its evidence and review time. */
  readonly renewed: readonly string[];
  /** Rows kept exactly as they were. */
  readonly carried: readonly string[];
  readonly held: readonly AutoCrosswalkHold[];
  /** Every input the version was computed from, deduplicated and sorted. */
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
  const accepted: string[] = [];
  const renewed: string[] = [];
  const inputs = new Map<string, DerivedInputRef>();
  const held = new Map<string, AutoCrosswalkHold>();
  for (const review of input.reviews) {
    for (const h of review.held) held.set(h.key, h);
    /* A walk reviewed is an input whether it was accepted or held: the holds it produced are this version's too. */
    for (const i of review.inputs) inputs.set(inputKey(i), i);
    for (const { row, inputs: rowInputs } of review.accepted) {
      for (const i of rowInputs) inputs.set(inputKey(i), i);
      const prior = before.get(row.id);
      if (prior === undefined) {
        next.set(row.id, row);
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

/* ------------------------------------------------------------- candidate */

const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");

export function derivedCrosswalkProjection(plan: DerivedCrosswalkPlan): DerivedCrosswalkProjection {
  return { kind: "meeting-body-crosswalk-derived", formatVersion: 1, records: plan.rows };
}

/** A hold as the candidate's excluded fact: Admin's held records show the dead end and who moves next. */
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

/**
 * The automatic crosswalk's candidate: authentic only as the inputs it was computed from (`retrieval.derived`). Its
 * semantic violations are every C16 row check and list check its rows fail, so a malformed version is never GOOD.
 */
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

/** A pass that cannot read its inputs records a refused candidate; the last known good rows stay live. */
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

/* ----------------------------------------------------------- composition */

export interface ComposedCrosswalk {
  /** The rows the wiring decides, manual first. */
  readonly rows: readonly MeetingBodyCrosswalkRow[];
  /** The automatic rows kept: the wiring cites the automatic version for these. */
  readonly automaticIds: ReadonlySet<string>;
  /** Automatic rows a manual row shadows, and why. */
  readonly shadowed: readonly { readonly id: string; readonly why: string }[];
}

/**
 * **MANUAL ROWS WIN.** The rows the wiring derive decides: every well-formed manual row, and every automatic row no
 * manual row shadows. A manual row shadows an automatic one for the same body and kind, whatever its status (a
 * withdrawal by review is never undone by the reviewer), and an automatic row claiming a manual ACTIVE row's
 * calendar and filter for another body.
 */
export function composeCrosswalk(
  manual: readonly MeetingBodyCrosswalkRow[] | null,
  automatic: readonly MeetingBodyCrosswalkRow[] | null,
): ComposedCrosswalk {
  const reviewed = (manual ?? []).filter((row) => crosswalkRowIssue(row) === null);
  const ids = new Set(reviewed.map((row) => row.id));
  const claim = (row: MeetingBodyCrosswalkRow): string => `${row.route}\n${JSON.stringify(Object.entries(row.filter).sort())}`;
  const claims = new Map(reviewed.filter((row) => row.status === "ACTIVE").map((row) => [claim(row), row] as const));
  const kept: MeetingBodyCrosswalkRow[] = [];
  const shadowed: { id: string; why: string }[] = [];
  for (const row of automatic ?? []) {
    if (crosswalkRowIssue(row) !== null) continue;
    if (ids.has(row.id)) {
      shadowed.push({ id: row.id, why: "a manually reviewed row for the same body and calendar kind wins" });
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

/** A row the reviewer names as its own (for the wiring's conflict rule and for display). */
export function isAutomaticCrosswalkRow(row: Pick<MeetingBodyCrosswalkRow, "reviewedBy">): boolean {
  return text(row.reviewedBy) && REVIEWER.test(row.reviewedBy);
}
