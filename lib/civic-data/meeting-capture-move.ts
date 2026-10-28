import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import { holdMeetingResponses } from "./retained-meeting-bytes.ts";
import { UNCHANGED_CONFIRMATION_SOURCES_PREFIX } from "./unchanged-confirmation.ts";

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Prepare a decoded historical candidate for its atomic database move. */
export async function moveMeetingCandidateResponses(vault: EvidenceStore, candidate: unknown): Promise<unknown> {
  const row = object(candidate);
  if (!row) throw new Error("MEETING_CAPTURE_CANDIDATE_INVALID");
  if (!Object.hasOwn(row, "retainedSourceResponses")) return candidate;
  if (!Array.isArray(row.retainedSourceResponses)) throw new Error("MEETING_CAPTURE_CANDIDATE_INVALID");
  const responses = await holdMeetingResponses(vault, row.retainedSourceResponses);
  return { ...row, retainedSourceResponses: responses };
}

/** Prepare a source-confirmation event for its atomic database move. Other event types are untouched. */
export async function moveMeetingConfirmationResponses(vault: EvidenceStore, detail: string): Promise<string> {
  if (!detail.startsWith(UNCHANGED_CONFIRMATION_SOURCES_PREFIX)) return detail;
  let parsed: unknown;
  try { parsed = JSON.parse(detail.slice(UNCHANGED_CONFIRMATION_SOURCES_PREFIX.length)); }
  catch { throw new Error("MEETING_CAPTURE_CONFIRMATION_INVALID"); }
  const row = object(parsed);
  if (!row || typeof row.versionId !== "string" || typeof row.observedAt !== "string" ||
      !Array.isArray(row.retainedSourceResponses)) throw new Error("MEETING_CAPTURE_CONFIRMATION_INVALID");
  const responses = await holdMeetingResponses(vault, row.retainedSourceResponses);
  if (canonicalCivicDataJson(responses) === canonicalCivicDataJson(row.retainedSourceResponses)) return detail;
  return UNCHANGED_CONFIRMATION_SOURCES_PREFIX + canonicalCivicDataJson({ ...row, retainedSourceResponses: responses });
}
