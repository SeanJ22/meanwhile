/**
 * The hand-wired meeting doors tests run against: the rows the one-time door import moved into the registry, turned
 * into door records and installed the way every process installs the registry's doors.
 */
import { readFileSync } from "node:fs";

import { installDoorRecords } from "../../lib/doors/meeting-doors.ts";
import { applyDerivedRow, checkDoorDraft, type DoorRecord } from "../../lib/doors/registry.ts";
import { doorsFromWiringRow, seedMeetingDoors } from "../../lib/doors/seed-meetings.ts";
import { createMemoryRepositories } from "../../lib/control-plane/repository/memory.ts";
import type { BodySourceWiring } from "../../lib/registry/source-wiring.ts";

const AT = "2026-10-08T12:00:00.000Z";

export const FIXTURE_DOOR_ROWS: readonly BodySourceWiring[] =
  (JSON.parse(readFileSync(new URL("../fixtures/meeting-doors.json", import.meta.url), "utf8")) as { rows: BodySourceWiring[] }).rows;

/** Door records for wiring rows, as the registry holds them after the import. */
export function fixtureDoorRecords(rows: readonly BodySourceWiring[] = FIXTURE_DOOR_ROWS): DoorRecord[] {
  return rows.flatMap(doorsFromWiringRow).map((draft) => {
    const checked = checkDoorDraft(draft);
    if (!checked.ok) throw new Error(`fixture door ${draft.doorId}: ${checked.why}`);
    return applyDerivedRow(null, checked.value, AT, AT)!;
  });
}

/** Install the fixture doors in this process, as a process installs the registry's. */
export function installFixtureDoors(rows: readonly BodySourceWiring[] = FIXTURE_DOOR_ROWS): void {
  installDoorRecords(fixtureDoorRecords(rows));
}

/** In-memory repositories whose door registry holds the fixture doors, as production's registry holds the imported ones. */
export async function fixtureRepositories(rows: readonly BodySourceWiring[] = FIXTURE_DOOR_ROWS) {
  const repos = createMemoryRepositories();
  await seedMeetingDoors({ repo: repos.doors, wiring: rows, derived: [], deriveInputAt: AT, at: AT });
  return repos;
}
