import { createHash } from "node:crypto";

import { canonicalCivicDataJson } from "./changes.ts";
import type { RoutineRecordClass } from "./types.ts";

/**
 * **A VERSION PROVED ONCE PER PASS** (2026-09-24).
 *
 * Every meeting-partition child used to prove the registry-runtime pointer on
 * its own: 24.47 MB per child, 19.81 MB of it the pointed candidate read only
 * to prove the pointer (measured on an isolated copy of reader production).
 * The registry is the same version for every child in a pass, so the standing
 * supervisor proves it once and hands each child this attestation. A child
 * then reads the pointer, and when it still names exactly the attested version
 * and its payload hashes to the proven payload, the proof is not re-run
 * (RULING 288: attest, never re-run). A promoted candidate row is immutable,
 * so the attested version is the proven one; any mismatch, or an attestation
 * that does not parse, runs the full proof.
 */
export interface AttestedPromotion {
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly versionId: string;
  /** SHA-256 of the canonical JSON of the proven pointer's payload. */
  readonly payloadSha256: string;
  /** The proven candidate's fields a promoted result reports. */
  readonly retrievedAt: string;
  readonly staleAtRetrieval: boolean;
  readonly version: string | null;
  readonly sourceThrough: string | null;
}

/** The supervisor's attestations for one child, as JSON. Only the standing supervisor sets it. */
export const ATTESTED_PROMOTIONS_ENV = "WTP_ROUTINE_ATTESTED_PROMOTIONS";

const SHA256 = /^[a-f0-9]{64}$/;

export function promotedPayloadSha256(payload: unknown): string {
  return createHash("sha256").update(canonicalCivicDataJson(payload)).digest("hex");
}

export function serializeAttestedPromotions(attestations: readonly AttestedPromotion[]): string {
  return JSON.stringify(attestations);
}

function isAttestedPromotion(value: unknown): value is AttestedPromotion {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const optionalText = (field: unknown) => field === null || typeof field === "string";
  return typeof row.recordClass === "string" && row.recordClass.length > 0 &&
    typeof row.scope === "string" && row.scope.length > 0 &&
    typeof row.versionId === "string" && row.versionId.length > 0 &&
    typeof row.payloadSha256 === "string" && SHA256.test(row.payloadSha256) &&
    typeof row.retrievedAt === "string" && Number.isFinite(Date.parse(row.retrievedAt)) &&
    typeof row.staleAtRetrieval === "boolean" &&
    optionalText(row.version) && optionalText(row.sourceThrough);
}

/** Every attestation in `text`, or none: a malformed value is never partly trusted. */
export function parseAttestedPromotions(text: string | undefined): readonly AttestedPromotion[] {
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) && parsed.every(isAttestedPromotion) ? parsed : [];
  } catch {
    return [];
  }
}

export function attestedPromotionFor(
  attestations: readonly AttestedPromotion[],
  recordClass: RoutineRecordClass,
  scope: string,
): AttestedPromotion | null {
  return attestations.find((row) => row.recordClass === recordClass && row.scope === scope) ?? null;
}
