/**
 * Every door edited within the due-request lifetime asks for the derive steps
 * (body crosswalk, source wiring) to run in the next pass rather than on their
 * own six-hour clocks. Derives never overwrite a newer manual edit.
 */

import { DOOR_DERIVE_CONTRACT_IDS, ROUTINE_DUE_REQUEST_MAX_LIFETIME_MS, type RoutineDueRequest } from "../civic-data/routine-due-request.ts";
import type { DoorRecord } from "./registry.ts";
import { stateOfPlace } from "../method/fix-map.ts";
import { parseMeetingDerivationContractId } from "../civic-data/meeting-derivation-scope.ts";

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
    const states = new Set([door.ocdId ?? "", ...door.bodyIds].flatMap(id => stateOfPlace(id)?.toUpperCase() ?? []));
    for (const contractId of DOOR_DERIVE_CONTRACT_IDS) {
      const state = parseMeetingDerivationContractId(contractId)?.state;
      if (!state || !states.has(state) || !known.has(contractId)) continue;
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
