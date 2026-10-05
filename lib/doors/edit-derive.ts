/**
 * DB-36: a door edit is applied at once, not on a six-hour clock.
 *
 * Editing a door (Admin's door.save, a repair, a detective's fix) stamps the
 * record's `editedAt`. The two derive steps that build records from doors and
 * walks (the body crosswalk and the source wiring) ran only on their own
 * six-hour clocks, so a derived record could contradict the edit for hours.
 * Here every door edited inside the request lifetime asks for both derives to
 * run in the very next pass, as the same due request an owner's controlled
 * refresh makes. The derives never overwrite a newer manual edit
 * (`applyDerivedRow`), so running them early is safe.
 */

import { DOOR_DERIVE_CONTRACT_IDS, ROUTINE_DUE_REQUEST_MAX_LIFETIME_MS, type RoutineDueRequest } from "../civic-data/routine-due-request.ts";
import type { DoorRecord } from "./registry.ts";

/** Due requests for the derive steps, one per edited door and step, due from the edit. Only steps the pass knows are named. */
export function editDeriveDueRequests(
  doors: readonly DoorRecord[],
  known: ReadonlySet<string>,
  now: string,
): RoutineDueRequest[] {
  const nowMs = Date.parse(now);
  const requests: RoutineDueRequest[] = [];
  for (const door of doors) {
    if (door.origin !== "MANUAL" || door.editedAt === null || door.status === "SUSPENDED") continue;
    const editedMs = Date.parse(door.editedAt);
    if (!Number.isFinite(editedMs) || nowMs - editedMs >= ROUTINE_DUE_REQUEST_MAX_LIFETIME_MS) continue;
    for (const contractId of DOOR_DERIVE_CONTRACT_IDS) {
      if (!known.has(contractId)) continue;
      requests.push({
        id: `door-edit-derive:${door.doorId}:${contractId}`,
        contractId,
        requestedAt: door.editedAt,
        dueAt: door.editedAt,
        expiresAt: new Date(editedMs + ROUTINE_DUE_REQUEST_MAX_LIFETIME_MS).toISOString(),
        reason: "a door was edited; the records derived from it are rebuilt now, not on the six-hour clock",
        withdrawnAt: null,
      });
    }
  }
  return requests;
}
