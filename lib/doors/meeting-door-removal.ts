import { canonicalCivicDataHash } from "../civic-data/changes.ts";
import type { RoutineCandidate, ValidationCheck } from "../civic-data/types.ts";

/** Only the registry's exact, hash-bound SUSPENDED record can retire a door. Absence is no authority. */
export function meetingDoorRemovalCheck(candidate: RoutineCandidate): ValidationCheck | null {
  if (candidate.sourceId !== "meeting-doors" || candidate.recordClass !== "CURATED_READER_RECORD" || candidate.scope !== "US:meeting-doors") return null;
  const removed = candidate.changeSet?.removed ?? [];
  const payload = candidate.normalizedPayload as { suspendedDoors?: readonly { doorId: string; status: string; meeting: { family?: string | null } | null }[] } | null;
  const suspended = Array.isArray(payload?.suspendedDoors) ? payload.suspendedDoors : [];
  const inputs = candidate.retrieval.derived?.inputs ?? [];
  const valid = !candidate.removalEvidence?.length && removed.every(delta => {
    const before = delta.before as { doorId?: string } | null;
    const matching = suspended.filter(door => door?.doorId === before?.doorId);
    if (!before?.doorId || delta.key !== `meeting-door:${before.doorId}` || matching.length !== 1) return false;
    const door = matching[0]!;
    const refs = inputs.filter(input => input.kind === "DOOR_RECORD" && input.doorId === door.doorId);
    return door.status === "SUSPENDED" && door.meeting != null &&
      refs.length === 1 && refs[0]!.kind === "DOOR_RECORD" && refs[0]!.recordSha256 === canonicalCivicDataHash(door);
  });
  return { check: "COMPLETENESS_HORIZON_VALIDITY", verdict: valid ? "PASS" : "CANNOT_TELL",
    code: valid ? "REGISTRY_DOOR_SUSPENDED" : "INCOMPLETE_HORIZON_REMOVAL_UNEXPLAINED",
    detail: valid ? `${removed.length} removed door(s) have exact suspended registry records.` : "Every removed door needs its own hash-bound suspended registry record." };
}
