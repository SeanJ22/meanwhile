/**
 * A door that stops working is marked shut at once, judged from its own
 * result, never a family's total. It goes SHUT, with `shutSince` and the
 * reason, on any of:
 *
 *  - the address answers 404 or 410;
 *  - a read succeeds but yields no rows where the last good version had rows;
 *  - a parse or schema failure;
 *  - `SHUT_AFTER_TRANSPORT_FAILURES` consecutive transport failures.
 *
 * The next good read reopens it. A SUSPENDED door is never shut or reopened by
 * a read. A system write: not a hand edit.
 */

import { isDoorRecord, type DoorRecord, type DoorRepository } from "./registry.ts";
import { completeReopenedDoorFix, openShutDoorFix, type FixRepos } from "./shut-repair.ts";

/** Three failed reads in a row, so one flaky pass never shuts a door. */
export const SHUT_AFTER_TRANSPORT_FAILURES = 3;

export type DoorEvidence =
  | { readonly kind: "GOOD"; readonly rows: number }
  | { readonly kind: "HTTP"; readonly httpStatus: number }
  | { readonly kind: "EMPTY"; readonly lastGoodRows: number }
  | { readonly kind: "PARSE_FAILURE"; readonly detail: string }
  | { readonly kind: "TRANSPORT_FAILURE" };

export type DoorJudgement =
  | { readonly change: "SHUT"; readonly reason: string }
  | { readonly change: "REOPENED" }
  | { readonly change: "NONE" };

/** Map a classified source failure onto what the door should hear. */
export function evidenceFromFailureCode(code: string, httpStatus?: number | null): DoorEvidence {
  if (code === "PUBLISHER_DOCUMENT_INVALID") return { kind: "PARSE_FAILURE", detail: "the page no longer reads the way this door says" };
  if (typeof httpStatus === "number" && Number.isInteger(httpStatus)) return { kind: "HTTP", httpStatus };
  return { kind: "TRANSPORT_FAILURE" };
}

export function judgeDoor(door: DoorRecord, evidence: DoorEvidence): DoorJudgement & { readonly transportFailures: number } {
  if (door.status === "SUSPENDED") return { change: "NONE", transportFailures: 0 };
  const before = door.transportFailures ?? 0;
  switch (evidence.kind) {
    case "GOOD":
      return { change: door.status === "SHUT" ? "REOPENED" : "NONE", transportFailures: 0 };
    case "HTTP":
      if (evidence.httpStatus === 404 || evidence.httpStatus === 410) {
        return door.status === "SHUT" ? { change: "NONE", transportFailures: 0 } : { change: "SHUT", reason: `the address answers ${evidence.httpStatus}`, transportFailures: 0 };
      }
      return judgeTransport(door, before);
    case "EMPTY":
      if (evidence.lastGoodRows <= 0) return { change: "NONE", transportFailures: before };
      return door.status === "SHUT" ? { change: "NONE", transportFailures: 0 } : { change: "SHUT", reason: `it now reads no rows where it last read ${evidence.lastGoodRows}`, transportFailures: 0 };
    case "PARSE_FAILURE":
      return door.status === "SHUT" ? { change: "NONE", transportFailures: 0 } : { change: "SHUT", reason: evidence.detail.trim() || "the page no longer reads the way this door says", transportFailures: 0 };
    case "TRANSPORT_FAILURE":
      return judgeTransport(door, before);
  }
}

function judgeTransport(door: DoorRecord, before: number): DoorJudgement & { readonly transportFailures: number } {
  const count = before + 1;
  if (door.status !== "SHUT" && count >= SHUT_AFTER_TRANSPORT_FAILURES) {
    return { change: "SHUT", reason: `${count} reads in a row could not reach it`, transportFailures: count };
  }
  return { change: "NONE", transportFailures: count };
}

export interface DoorEvidenceResult {
  readonly written: boolean;
  readonly change: DoorJudgement["change"];
}

/** Judge one door's own result and write the outcome on its record. No such door: nothing is invented. */
export async function recordDoorEvidence(repo: DoorRepository, doorId: string, evidence: DoorEvidence, at: string, fixes?: FixRepos): Promise<DoorEvidenceResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const row = await repo.read(doorId);
    if (row === null || !isDoorRecord(row.value)) return { written: false, change: "NONE" };
    const door = row.value;
    const verdict = judgeDoor(door, evidence);
    const good = evidence.kind === "GOOD";
    const next: DoorRecord = {
      ...door,
      ...(good ? { lastSuccessAt: at } : { lastFailureAt: at }),
      transportFailures: verdict.transportFailures,
      ...(verdict.change === "SHUT" ? { status: "SHUT" as const, shutSince: at, shutReason: verdict.reason, reopenedAt: null } : {}),
      ...(verdict.change === "REOPENED" ? { status: "OPEN" as const, shutSince: null, shutReason: null, reopenedAt: at } : {}),
      updatedAt: verdict.change === "NONE" ? door.updatedAt : at,
    };
    try {
      await repo.compareAndSet(doorId, row.revision, next, at);
    } catch (error) {
      if (attempt === 1) throw error;
      continue;
    }
    // The fix list hears of the change only after the door write lands; its failure never undoes the door's state.
    if (fixes && verdict.change === "SHUT") await openShutDoorFix(fixes, next, at).catch(() => undefined);
    if (fixes && verdict.change === "REOPENED") await completeReopenedDoorFix(fixes, door, next, at).catch(() => undefined);
    return { written: true, change: verdict.change };
  }
  return { written: false, change: "NONE" };
}
