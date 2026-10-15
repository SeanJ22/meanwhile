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

export async function reopenDoorIfShut(repo: DoorRepository, doorId: string, at: string, fixes?: FixRepos): Promise<boolean> {
  const row = await repo.read(doorId);
  if (row === null || !isDoorRecord(row.value) || row.value.status !== "SHUT") return false;
  return (await recordDoorEvidence(repo, doorId, { kind: "GOOD", rows: 1 }, at, fixes)).change === "REOPENED";
}
