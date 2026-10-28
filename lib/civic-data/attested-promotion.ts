import { createHash } from "node:crypto";

import { canonicalCivicDataJson } from "./changes.ts";
import type { RoutineRecordClass } from "./types.ts";

/** Integrity metadata for a loaded reader edge entry. */
export interface AttestedPromotion {
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly versionId: string;
  /** SHA-256 of the canonical JSON of the proven pointer's payload. */
  readonly payloadSha256: string;
  readonly retrievedAt: string;
  readonly staleAtRetrieval: boolean;
  readonly version: string | null;
  readonly sourceThrough: string | null;
}

export function promotedPayloadSha256(payload: unknown): string {
  return createHash("sha256").update(canonicalCivicDataJson(payload)).digest("hex");
}
