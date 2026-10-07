import { canonicalCivicDataJson } from "./changes.ts";
import { derivedRequestedUrl } from "./derived-door.ts";
import type { RoutineRecordClass } from "./types.ts";

/** An append-only event on the pointed candidate naming the version it confirms; the pointer, candidate row and readers stay as they are. */
export const UNCHANGED_CONFIRMATION_PREFIX = "UNCHANGED_CONFIRMATION_V1 ";

/** Only observation stamps may differ between a confirmed re-check and the pointed version; they never decide a change. */
export type UnchangedBasis = "READ_MODEL_RECOMPUTED" | "CHANGE_SET_UNCHANGED" | "PUBLISHER_STAMPS_UNCHANGED";

/** A derived version fetched nothing: null status, and its own `derived:<sourceId>:<scope>` route as the requested URL. */
export interface UnchangedConfirmationRetrieval {
  readonly requestedUrl: string;
  readonly finalUrl: string | null;
  readonly httpStatus: number | null;
  readonly rawHash: string;
  readonly retrievedAt: string;
}

function isOwnDerivedRetrieval(retrieval: Record<string, unknown>, sourceId: unknown, scope: unknown): boolean {
  return retrieval.httpStatus === null &&
    typeof sourceId === "string" && typeof scope === "string" &&
    retrieval.requestedUrl === derivedRequestedUrl(sourceId, scope) &&
    (retrieval.finalUrl === null || retrieval.finalUrl === retrieval.requestedUrl);
}

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
  readonly versionId: string;
  readonly readModelHash: string;
  readonly basis: UnchangedBasis;
  readonly parserVersion: string;
  readonly retrieval: UnchangedConfirmationRetrieval;
  readonly stamps: readonly PublisherStampComparison[] | null;
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
  const fetched = (value: Record<string, unknown>): boolean =>
    typeof value.finalUrl === "string" &&
    typeof value.httpStatus === "number" && value.httpStatus >= 200 && value.httpStatus <= 299;
  if (
    !retrieval || typeof retrieval !== "object" ||
    typeof retrieval.requestedUrl !== "string" ||
    !(fetched(retrieval) || isOwnDerivedRetrieval(retrieval, row.sourceId, row.scope)) ||
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
  readonly retainedSourceResponses?: readonly unknown[] | null;
}

export type ConfirmUnchangedOutcome =
  | { readonly kind: "CONFIRMED"; readonly versionId: string; readonly at: string }
  | {
            /** STORE_REFUSED: the database's event rule does not yet admit the receipt; the caller promotes instead. */
      readonly kind: "POINTER_MOVED" | "HASH_DIFFERS" | "POINTER_IS_IMPORT" | "EVIDENCE_INVALID" | "STORE_REFUSED";
      readonly detail: string;
    };

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

export function isUnchangedConfirmationEvent(event: { readonly state: string; readonly detail: string }): boolean {
  return event.state === "PROMOTED" && isUnchangedConfirmationDetail(event.detail);
}

export function isUnchangedConfirmationDetail(detail: string): boolean {
  return detail.startsWith(UNCHANGED_CONFIRMATION_PREFIX) || detail.startsWith(UNCHANGED_CONFIRMATION_SOURCES_PREFIX);
}
