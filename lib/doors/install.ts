/**
 * DB-12: put the registry's rows where adapters read them, behind a switch.
 *
 * The code's `SOURCE_WIRING` stays the default and the way back. With
 * `WTP_DOORS_READ=registry` the runner calls `installDoorWiringFromRegistry`
 * at the start of a pass: the registry's rows are installed only when they
 * match the code's exactly, so a registry that is empty, half seeded or edited
 * wrongly never changes what meetings readers see. A hand edit that is meant to
 * change a door is made on the door and is read from the next pass once the
 * switch is on (the comparison then covers only doors the code also names;
 * see `wiringParity`'s `differs` and `only in the registry` lines).
 *
 * DB-13: with the switch on, the registry is read every pass and is the list
 * once it holds every body the code names. A door added or edited in Admin is
 * then read on the next pass; a registry that has lost a door the code still
 * names is refused whole and the code's list stays in use.
 * `refreshDoorsForPass` also rebuilds the runner's meeting partitions from it.
 *
 * The switch is off until the new path is checked live (rulings §5).
 */

import { refreshCuratedBodyStatus } from "../registry/curated-bodies.ts";
import { refreshMeetingPartitions, type MeetingPartitionRefresh } from "../civic-data/meeting-partitions.ts";
import { refreshOutcomePartitions, type OutcomePartitionRefresh } from "../civic-data/outcome-partitions.ts";
import type { DoorRecord } from "./registry.ts";
import { SOURCE_WIRING, installRegistryWiring, type BodySourceWiring } from "../registry/source-wiring.ts";
import { listDoors, type DoorRepository } from "./registry.ts";
import { installDoorHosts } from "../civic-data/source-authority.ts";
import { meetingDoorHosts, wiringParity, wiringRowsFromDoors } from "./rows.ts";

export const DOORS_READ_SWITCH = "WTP_DOORS_READ";

export type DoorReadMode = "code" | "registry";

export function doorReadModeFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): DoorReadMode {
  return env[DOORS_READ_SWITCH]?.trim().toLowerCase() === "registry" ? "registry" : "code";
}

export interface DoorInstallResult {
  readonly mode: DoorReadMode;
  /** What adapters read now. */
  readonly reading: "registry" | "code";
  readonly rows: number;
  /** Why the registry was not used, in a sentence; null when it was or the switch is off. */
  readonly reason: string | null;
  readonly differences: readonly string[];
  /** The doors the registry held when it was used, for what a pass builds from them; absent when the code's list is in use. */
  readonly doors?: readonly DoorRecord[];
}

export async function installDoorWiringFromRegistry(
  repo: DoorRepository,
  options: { readonly mode?: DoorReadMode; readonly code?: readonly BodySourceWiring[] } = {},
): Promise<DoorInstallResult> {
  const mode = options.mode ?? doorReadModeFromEnv();
  const code = options.code ?? SOURCE_WIRING;
  if (mode !== "registry") {
    installRegistryWiring(null);
    installDoorHosts(null);
    return { mode, reading: "code", rows: code.length, reason: null, differences: [] };
  }
  let rows: BodySourceWiring[];
  let hosts: string[];
  let listed: readonly DoorRecord[];
  try {
    const doors = (await listDoors(repo)).doors;
    listed = doors;
    rows = wiringRowsFromDoors(doors);
    hosts = meetingDoorHosts(doors);
  } catch {
    installRegistryWiring(null);
    installDoorHosts(null);
    return { mode, reading: "code", rows: code.length, reason: "the door registry could not be read, so the code's own list is in use", differences: [] };
  }
  const differences = wiringParity(code, rows);
  const named = new Set(rows.map((row) => `${row.bodyId} ${row.agendaSourceType}`));
  const lost = code.filter((row) => !named.has(`${row.bodyId} ${row.agendaSourceType}`));
  if (rows.length === 0 || lost.length > 0) {
    installRegistryWiring(null);
    installDoorHosts(null);
    return {
      mode,
      reading: "code",
      rows: code.length,
      reason: rows.length === 0
        ? "the door registry holds no meeting doors yet, so the code's own list is in use"
        : `the registry has lost ${lost.length} meeting door(s) the code still names, so the code's own list is in use`,
      differences,
    };
  }
  installRegistryWiring(rows);
  installDoorHosts(hosts);
  return { mode, reading: "registry", rows: rows.length, reason: null, differences, doors: listed };
}

export interface DoorPassResult extends DoorInstallResult {
  readonly partitions: MeetingPartitionRefresh | null;
  /** DB-22: the doors that collect outcomes, built into their own work; null with the switch off or the code's list in use. */
  readonly outcomes: OutcomePartitionRefresh | null;
}

/**
 * The start of a runner pass (DB-13): read the doors, then build the pass's
 * meeting partitions from them. With the switch off nothing changes.
 */
export async function refreshDoorsForPass(
  repo: DoorRepository,
  options: Parameters<typeof installDoorWiringFromRegistry>[1] = {},
): Promise<DoorPassResult> {
  const installed = await installDoorWiringFromRegistry(repo, options);
  if (installed.mode !== "registry") return { ...installed, partitions: null, outcomes: null };
  const partitions = refreshMeetingPartitions();
  refreshCuratedBodyStatus();
  // The registry's own doors only: while the code's list is in use no door is known to hold outcomes.
  const outcomes = installed.reading === "registry" && installed.doors !== undefined ? refreshOutcomePartitions(installed.doors) : null;
  return { ...installed, partitions, outcomes };
}
