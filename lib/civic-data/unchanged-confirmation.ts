import { canonicalCivicDataJson } from "./changes.ts";
import type { RoutineRecordClass } from "./types.ts";

/**
 * **A RE-CHECK THAT FOUND NOTHING NEW KEEPS READERS ON THEIR VERSION** (2026-09-24).
 *
 * In the 24 hours to 2026-09-24T16:00Z, 954 of 1,119 promotions were UNCHANGED
 * (923 of them meeting partitions): a successful re-check promoted a new
 * version whose read model was identical to the current one, and every such
 * move paid its readback, its recomposition and its readers' reloads. RULING
 * 283's other outcome is a durably receipted validated no-change, and this is
 * that receipt: an append-only event on the POINTED candidate itself (state
 * PROMOTED, next sequence), naming the version it confirms and the acquisition
 * that confirmed it. The pointer, the candidate row and every reader stay as
 * they are. The clock reads the latest confirmation as the source's latest
 * attempt and success, and Reader freshness reads its retrieval instant.
 *
 * Candidate and event states are database-constrained (migration 0026), so a
 * confirmation is not a new state or row; it is typed evidence, like a Reader
 * readback receipt.
 */
export const UNCHANGED_CONFIRMATION_PREFIX = "UNCHANGED_CONFIRMATION_V1 ";

/**
 * READ_MODEL_RECOMPUTED: the source was acquired and normalized, and the read
 * model hashed equal to the pointer's. CHANGE_SET_UNCHANGED: the source was
 * acquired, normalized and validated, and its change set against the pointed
 * version added, changed and removed nothing, with the same held records; only
 * observation stamps (a meeting row's collectedAt, the snapshot's generatedAt
 * and counts) differ, and those never decide a change (civicRecordFacts).
 * PUBLISHER_STAMPS_UNCHANGED: the publisher's own change stamps for every held
 * record equal the held ones, so the read model is unchanged by construction;
 * the stamps are the evidence.
 */
export type UnchangedBasis = "READ_MODEL_RECOMPUTED" | "CHANGE_SET_UNCHANGED" | "PUBLISHER_STAMPS_UNCHANGED";

export interface UnchangedConfirmationRetrieval {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly rawHash: string;
  readonly retrievedAt: string;
}

/** One held record's publisher stamps, as held and as fetched now. */
export interface PublisherStampComparison {
  readonly key: string;
  readonly held: Readonly<Record<string, string | null>>;
  readonly fetched: Readonly<Record<string, string | null>>;
}

export interface UnchangedConfirmation {
  readonly kind: "UNCHANGED_CONFIRMATION_V1";
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly pointerKey: string;
  /** The pointed version this re-check confirms. */
  readonly versionId: string;
  /** Equal to the pointed candidate's normalized (read-model) hash. */
  readonly readModelHash: string;
  readonly basis: UnchangedBasis;
  readonly parserVersion: string;
  readonly retrieval: UnchangedConfirmationRetrieval;
  /** PUBLISHER_STAMPS_UNCHANGED: every held record's stamps; otherwise optional source evidence. */
  readonly stamps: readonly PublisherStampComparison[] | null;
  /** The store-observed instant; the event's `at`. */
  readonly observedAt: string;
}

const SHA256 = /^[a-f0-9]{64}$/;

export function serializeUnchangedConfirmation(confirmation: UnchangedConfirmation): string {
  return `${UNCHANGED_CONFIRMATION_PREFIX}${canonicalCivicDataJson(confirmation)}`;
}

export function parseUnchangedConfirmation(detail: string): UnchangedConfirmation | null {
  if (!detail.startsWith(UNCHANGED_CONFIRMATION_PREFIX)) return null;
  try {
    const value: unknown = JSON.parse(detail.slice(UNCHANGED_CONFIRMATION_PREFIX.length));
    return unchangedConfirmationShapeIssue(value) === null ? value as UnchangedConfirmation : null;
  } catch {
    return null;
  }
}

function isInstant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function stampsEqual(held: Readonly<Record<string, unknown>>, fetched: Readonly<Record<string, unknown>>): boolean {
  const keys = new Set([...Object.keys(held), ...Object.keys(fetched)]);
  return keys.size > 0 && [...keys].every((key) => Object.hasOwn(held, key) && Object.hasOwn(fetched, key) && held[key] === fetched[key]);
}

/** Why a value is not a well-formed confirmation, or null. Pointer facts are checked by the store. */
export function unchangedConfirmationShapeIssue(value: unknown): string | null {
  if (!value || typeof value !== "object") return "not an object";
  const row = value as Record<string, unknown>;
  if (row.kind !== "UNCHANGED_CONFIRMATION_V1") return "unknown kind";
  for (const field of ["sourceId", "recordClass", "scope", "pointerKey", "versionId", "parserVersion"] as const) {
    if (typeof row[field] !== "string" || !(row[field] as string).trim()) return `${field} is missing`;
  }
  if (typeof row.readModelHash !== "string" || !SHA256.test(row.readModelHash)) return "readModelHash is not a SHA-256";
  if (row.basis !== "READ_MODEL_RECOMPUTED" && row.basis !== "CHANGE_SET_UNCHANGED" && row.basis !== "PUBLISHER_STAMPS_UNCHANGED") return "unknown basis";
  if (!isInstant(row.observedAt)) return "observedAt is not an instant";
  const retrieval = row.retrieval as Record<string, unknown> | null | undefined;
  if (
    !retrieval || typeof retrieval !== "object" ||
    typeof retrieval.requestedUrl !== "string" || typeof retrieval.finalUrl !== "string" ||
    typeof retrieval.httpStatus !== "number" || retrieval.httpStatus < 200 || retrieval.httpStatus > 299 ||
    typeof retrieval.rawHash !== "string" || !SHA256.test(retrieval.rawHash) ||
    !isInstant(retrieval.retrievedAt)
  ) return "the retrieval is not a successful acquisition";
  if (Date.parse(retrieval.retrievedAt) > Date.parse(row.observedAt)) return "retrieved after it was observed";
  const stamps = row.stamps;
  if (row.basis === "PUBLISHER_STAMPS_UNCHANGED") {
    if (!Array.isArray(stamps) || stamps.length === 0) return "a stamp basis needs every held record's stamps";
    const keys = new Set<string>();
    for (const stamp of stamps as unknown[]) {
      const entry = stamp as Record<string, unknown> | null;
      if (!entry || typeof entry.key !== "string" || !entry.key || keys.has(entry.key)) return "a stamp is unkeyed or repeated";
      keys.add(entry.key);
      if (!entry.held || typeof entry.held !== "object" || !entry.fetched || typeof entry.fetched !== "object") return `stamps for ${entry.key} are incomplete`;
      if (!stampsEqual(entry.held as Record<string, unknown>, entry.fetched as Record<string, unknown>)) return `stamps for ${entry.key} differ`;
    }
  } else if (stamps !== null && !Array.isArray(stamps)) {
    return "stamps must be a list or null";
  }
  return null;
}

export interface ConfirmUnchangedInput {
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly parserVersion: string;
  /** Compare-and-set: refused unless the pointer (current and LKG) still names this version. */
  readonly pointerVersionId: string;
  readonly readModelHash: string;
  readonly basis: UnchangedBasis;
  readonly retrieval: UnchangedConfirmationRetrieval;
  readonly stamps?: readonly PublisherStampComparison[] | null;
  /** The confirming acquisition's retained source bytes, kept in a companion event. */
  readonly retainedSourceResponses?: readonly unknown[] | null;
}

export type ConfirmUnchangedOutcome =
  | { readonly kind: "CONFIRMED"; readonly versionId: string; readonly at: string }
  | {
      /**
       * POINTER_MOVED: the pointer no longer names the version. HASH_DIFFERS: its read
       * model is not the confirmed one. POINTER_IS_IMPORT: a trusted-LKG import is
       * never confirmed; a live read of it promotes. EVIDENCE_INVALID: malformed.
       * STORE_REFUSED: the database's event rule does not yet admit the receipt
       * (its migration is not applied); the caller promotes exactly as before.
       */
      readonly kind: "POINTER_MOVED" | "HASH_DIFFERS" | "POINTER_IS_IMPORT" | "EVIDENCE_INVALID" | "STORE_REFUSED";
      readonly detail: string;
    };

/** The confirmation `input` records at `observedAt`, or why it cannot be recorded. */
export function buildUnchangedConfirmation(
  input: ConfirmUnchangedInput,
  pointerKey: string,
  observedAt: string,
): { readonly ok: true; readonly confirmation: UnchangedConfirmation } | { readonly ok: false; readonly detail: string } {
  const confirmation: UnchangedConfirmation = {
    kind: "UNCHANGED_CONFIRMATION_V1",
    sourceId: input.sourceId,
    recordClass: input.recordClass,
    scope: input.scope,
    pointerKey,
    versionId: input.pointerVersionId,
    readModelHash: input.readModelHash,
    basis: input.basis,
    parserVersion: input.parserVersion,
    retrieval: {
      requestedUrl: input.retrieval.requestedUrl,
      finalUrl: input.retrieval.finalUrl,
      httpStatus: input.retrieval.httpStatus,
      rawHash: input.retrieval.rawHash,
      retrievedAt: input.retrieval.retrievedAt,
    },
    stamps: input.stamps ?? null,
    observedAt,
  };
  const issue = unchangedConfirmationShapeIssue(confirmation);
  return issue === null ? { ok: true, confirmation } : { ok: false, detail: issue };
}

/** The newest confirmation of `versionId` among a candidate's events, or null. */
export function latestUnchangedConfirmation(
  events: readonly { readonly sequence: number; readonly detail: string }[],
  versionId: string,
): UnchangedConfirmation | null {
  let latest: { readonly sequence: number; readonly confirmation: UnchangedConfirmation } | null = null;
  for (const event of events) {
    const confirmation = parseUnchangedConfirmation(event.detail);
    if (confirmation === null || confirmation.versionId !== versionId) continue;
    if (latest === null || event.sequence > latest.sequence) latest = { sequence: event.sequence, confirmation };
  }
  return latest?.confirmation ?? null;
}

/**
 * The confirming acquisition's retained source bytes, preserved exactly as a
 * promoted candidate would have preserved them (source history is kept), in a
 * companion event written in the same guarded step. Nothing routine reads it:
 * the clock and Reader freshness read only the small receipt.
 */
export const UNCHANGED_CONFIRMATION_SOURCES_PREFIX = "UNCHANGED_CONFIRMATION_SOURCES_V1 ";

export function serializeUnchangedConfirmationSources(
  confirmation: Pick<UnchangedConfirmation, "versionId" | "observedAt">,
  retainedSourceResponses: readonly unknown[],
): string {
  return `${UNCHANGED_CONFIRMATION_SOURCES_PREFIX}${canonicalCivicDataJson({
    versionId: confirmation.versionId,
    observedAt: confirmation.observedAt,
    retainedSourceResponses,
  })}`;
}

/**
 * A confirmation receipt or its companion sources event: the two events a
 * version gathers on every quiet re-check while it stays pointed. Only the
 * clock and Reader freshness read them, through their own one-row reads.
 */
export function isUnchangedConfirmationEvent(event: { readonly state: string; readonly detail: string }): boolean {
  return event.state === "PROMOTED" && isUnchangedConfirmationDetail(event.detail);
}

/** The detail test alone, for readers that classify events by detail (the database admits these only as PROMOTED). */
export function isUnchangedConfirmationDetail(detail: string): boolean {
  return detail.startsWith(UNCHANGED_CONFIRMATION_PREFIX) || detail.startsWith(UNCHANGED_CONFIRMATION_SOURCES_PREFIX);
}
