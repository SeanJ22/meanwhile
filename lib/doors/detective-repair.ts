/**
 * A detective's door repair is used on the very next check. A grounded
 * candidate's address is written at once as the door's new record through
 * `repairDoor`, labeled Testing in the door's notes, so the next check reads
 * it by plain code. A shut door stays shut until a read of the new record
 * succeeds; the label stays until then.
 */

import type { ScoutCandidate, ScoutResult } from "../control-plane/scheduler/scout-result.ts";
import { normalizeHost, type DoorConfigValue, type DoorDraft, type DoorRecord } from "./registry.ts";
import { repairDoor, type DoorRepair } from "./repair.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";

export const TESTING_LABEL = "Testing";

/** A candidate the detective saved evidence for, that plain code can replay, on an allowed https address. */
export function groundedCandidate(result: Pick<ScoutResult, "candidates">): ScoutCandidate | null {
  for (const candidate of result.candidates) {
    if (!candidate.deterministic || candidate.permission !== "ALLOWED") continue;
    if (candidate.evidenceArtifactIds.length === 0 || candidate.unverified.length > 0) continue;
    try {
      if (new URL(candidate.url).protocol === "https:") return candidate;
    } catch {
      // Not an address: not usable.
    }
  }
  return null;
}

function hostOf(url: string): string | null {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

/** The door's changes for a new address: its stored addresses on the old hosts move to the new one, and the hosts follow. */
export function changesForAddress(door: DoorRecord, address: string, at: string): Partial<DoorDraft> | null {
  const host = hostOf(address);
  if (host === null) return null;
  const old = new Set(door.hosts.map((h) => normalizeHost(h)));
  const config: Record<string, DoorConfigValue> = { ...door.config };
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== "string") continue;
    const valueHost = /^https?:\/\//i.test(value) ? hostOf(value) : null;
    if (valueHost !== null && old.has(valueHost)) {
      config[key] = address;
    }
  }
  const hosts = [...new Set([...door.hosts.filter((h) => !old.has(normalizeHost(h)) || h === host), host])];
  if (JSON.stringify(door.config) === JSON.stringify(config) && JSON.stringify(door.hosts) === JSON.stringify(hosts)) return null;
  const day = at.slice(0, 10);
  const note = `${TESTING_LABEL}: a detective found this address on ${day}; it has not yet been read successfully.`;
  const notes = door.notes.startsWith(`${TESTING_LABEL}:`) ? note : door.notes === "" ? note : `${note} ${door.notes}`;
  return { hosts, config, notes };
}

export type DetectiveDoorRepair = DoorRepair | { readonly ok: false; readonly says: string; readonly skipped: true };

/** Use a detective's find on `doorId` now. Nothing grounded, or nothing to change: nothing is written. */
export async function useDetectiveFind(
  repos: Pick<ControlPlaneRepositories, "doors" | "adminConfig">,
  doorId: string,
  result: Pick<ScoutResult, "candidates">,
  at: string,
): Promise<DetectiveDoorRepair> {
  const candidate = groundedCandidate(result);
  if (candidate === null) return { ok: false, says: "The detective found no address with saved evidence behind it, so the door was left as it was.", skipped: true };
  const row = await repos.doors.read(doorId);
  if (row === null) return { ok: false, says: `There is no door ${doorId}, so nothing was changed.`, skipped: true };
  const door = row.value;
  const changes = changesForAddress(door, candidate.url, at);
  if (changes === null) return { ok: false, says: "The detective's address is the one the door already reads, so nothing was changed.", skipped: true };
  return repairDoor(repos, doorId, changes, at);
}
