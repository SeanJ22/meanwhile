/**
 * Turns what the meeting runner already has into a `DoorEvidence` for
 * `lib/doors/shut.ts`. A read that proves nothing about the door itself gives
 * no evidence, and the caller keeps its plain last success / failure record.
 */

import { isDoorRecord, type DoorRepository } from "./registry.ts";
import { evidenceFromFailureCode, recordDoorEvidence, type DoorEvidence } from "./shut.ts";
import type { FixRepos } from "./shut-repair.ts";

const HTTP_STATUS = /\bHTTP (\d{3})\b/;

/** A held partition's evidence, from its durable candidate. Null when the read reached the page and the hold is the validator's. */
export function evidenceFromCandidate(candidate: { readonly acquisitionSucceeded: boolean; readonly failureCode: string | null; readonly failureDetail: string | null }): DoorEvidence | null {
  if (candidate.acquisitionSucceeded) return null;
  const status = HTTP_STATUS.exec(candidate.failureDetail ?? "")?.[1];
  return evidenceFromFailureCode(candidate.failureCode ?? "", status === undefined ? null : Number(status));
}

/** A family member's evidence from its own read. Null when a clean read came back with no sittings. */
export function evidenceFromFamilyRead(read: {
  readonly ok: boolean;
  readonly error: string | null;
  readonly acquisitions: readonly { readonly httpStatus: number }[];
  readonly freshMeetings: readonly unknown[];
}): DoorEvidence | null {
  if (read.ok) return read.freshMeetings.length > 0 ? { kind: "GOOD", rows: read.freshMeetings.length } : null;
  const failed = [...read.acquisitions].reverse().find((acquisition) => acquisition.httpStatus >= 400);
  const code = /PUBLISHER_DOCUMENT_INVALID/.test(read.error ?? "") ? "PUBLISHER_DOCUMENT_INVALID" : "";
  return evidenceFromFailureCode(code, failed?.httpStatus ?? null);
}

/**
 * A promoted read of a hand-wired door: it reopens a door that was shut. Nothing else is written (the runner's own
 * last-success record already was). A promotion never carries zero rows, so the evidence names one.
 */
export async function reopenDoorIfShut(repo: DoorRepository, doorId: string, at: string, fixes?: FixRepos): Promise<boolean> {
  const row = await repo.read(doorId);
  if (row === null || !isDoorRecord(row.value) || row.value.status !== "SHUT") return false;
  return (await recordDoorEvidence(repo, doorId, { kind: "GOOD", rows: 1 }, at, fixes)).change === "REOPENED";
}
