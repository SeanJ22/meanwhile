import { createHash } from "node:crypto";
import type { PromotedPointerIdentity, RoutineRecordClass } from "./types.ts";

export interface ReaderEdgePublicationOutcome {
  readonly ok: boolean;
  readonly readerEdge: string;
  readonly store: "local folder" | "Netlify Blobs" | "not configured";
  readonly sequence: number | null;
  /** Omitted when this pass carried the earlier meeting artifacts without reading them. */
  readonly supersededMeetingFields?: number;
  readonly detail: string | null;
}


type PointerState = Pick<PromotedPointerIdentity, "versionId" | "latestConfirmation"> | null;

export function promotedPointerVersion(recordClass: RoutineRecordClass, scope: string, pointer: PointerState): string {
  if (pointer === null) return `${recordClass}:${scope}=none`;
  const confirmation = pointer.latestConfirmation
    ? `~${createHash("sha256").update(JSON.stringify(pointer.latestConfirmation)).digest("hex").slice(0, 16)}`
    : "";
  return `${recordClass}:${scope}=${pointer.versionId}${confirmation}`;
}

export function safeReaderEdgeFailure(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[credentials-redacted]@")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join(" | ")
    .slice(0, 4_000) || "Reader repair failed without a diagnostic.";
}
