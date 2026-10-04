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
 * The switch is off until the new path is checked live (rulings §5).
 */

import { SOURCE_WIRING, installRegistryWiring, type BodySourceWiring } from "../registry/source-wiring.ts";
import { listDoors, type DoorRepository } from "./registry.ts";
import { wiringParity, wiringRowsFromDoors } from "./rows.ts";

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
}

export async function installDoorWiringFromRegistry(
  repo: DoorRepository,
  options: { readonly mode?: DoorReadMode; readonly code?: readonly BodySourceWiring[] } = {},
): Promise<DoorInstallResult> {
  const mode = options.mode ?? doorReadModeFromEnv();
  const code = options.code ?? SOURCE_WIRING;
  if (mode !== "registry") {
    installRegistryWiring(null);
    return { mode, reading: "code", rows: code.length, reason: null, differences: [] };
  }
  let rows: BodySourceWiring[];
  try {
    rows = wiringRowsFromDoors((await listDoors(repo)).doors);
  } catch {
    installRegistryWiring(null);
    return { mode, reading: "code", rows: code.length, reason: "the door registry could not be read, so the code's own list is in use", differences: [] };
  }
  const differences = wiringParity(code, rows);
  if (differences.length > 0) {
    installRegistryWiring(null);
    return {
      mode,
      reading: "code",
      rows: code.length,
      reason: `the registry's meeting doors do not match the code's list yet (${differences.length} differences), so the code's own list is in use`,
      differences,
    };
  }
  installRegistryWiring(rows);
  return { mode, reading: "registry", rows: rows.length, reason: null, differences: [] };
}
