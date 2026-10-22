/**
 * People feeds: the registered sources that say who holds each office. Each covers the
 * country or one state by its contract scope, so a check for a state, county, district
 * or ZIP reads every people source over that place, with no per-state list.
 */
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { feedDoorDrafts } from "./seed-feeds.ts";
import { ocdInside } from "./mission-refresh.ts";
import { isDoorRecord, listDoors, upsertDerivedDoor, type DoorRecord, type DoorRepository } from "./registry.ts";
import type { MissionRefreshCount } from "./mission-refresh.ts";

const PEOPLE_HOLDS = new Set(["state-legislator", "federal-directory"]);

/** The division a people contract covers, from its own scope. */
export function peopleFeedDivision(scope: string): string | null {
  if (scope === "US" || scope.startsWith("US:")) return "ocd-division/country:us";
  const postal = /^US-([A-Z]{2})(?:$|:)/.exec(scope)?.[1];
  const entry = Object.values(FIPS_TO_STATE).find(row => row.postal === postal);
  return entry ? `ocd-division/country:us/${entry.prefix}:${entry.postal.toLowerCase()}` : null;
}

/** A feed of officeholders; verified portraits are a separate standing job. */
export function isPeopleDoor(door: Pick<DoorRecord, "doorId" | "holds" | "config">): boolean {
  return door.doorId.startsWith("feed:") && door.holds.some(hold => PEOPLE_HOLDS.has(hold)) && door.config.sourceId !== "people-portraits" &&
    typeof door.config.scope === "string";
}

/** A jurisdiction's people feed applies to each of its counties, districts and ZIPs, and a state check reads the national feeds over it. */
export function peopleDoorCovers(door: Pick<DoorRecord, "doorId" | "holds" | "config">, divisions: readonly string[]): boolean {
  if (!isPeopleDoor(door)) return false;
  const covered = peopleFeedDivision(String(door.config.scope));
  return covered !== null && divisions.some(division => ocdInside(division, covered));
}

/** Registered people contracts are usable on the first check, before the next general door derivation creates their rows. */
export async function ensurePeopleFeedDoors(repo: DoorRepository, divisions: readonly string[], at: string): Promise<number> {
  let created = 0;
  for (const draft of feedDoorDrafts()) {
    if (!peopleDoorCovers({ doorId: draft.doorId, holds: draft.holds ?? [], config: draft.config ?? {} }, divisions)) continue;
    if (await repo.read(draft.doorId) !== null) continue;
    if (await upsertDerivedDoor(repo, draft, at, at) === "created") created++;
  }
  return created;
}

/** Admin's officials check marks only the people sources covering the place. A new check renews an older mark, so an earlier read cannot spend it. */
export async function markPeopleDoorsReadNow(repo: DoorRepository, divisions: readonly string[], at: string): Promise<MissionRefreshCount & { readonly doors: readonly DoorRecord[] }> {
  const wanted = divisions.filter(division => division.startsWith("ocd-division/"));
  const counts = { inPlace: 0, marked: 0, alreadyMarked: 0, notRead: 0, raced: 0 };
  const doors: DoorRecord[] = [];
  for (const row of await repo.list()) {
    const door = row.value;
    if (!isDoorRecord(door) || !peopleDoorCovers(door, wanted)) continue;
    counts.inPlace++;
    doors.push(door);
    if (door.status !== "OPEN") { counts.notRead++; continue; }
    if (door.readNow && door.updatedAt >= at) { counts.alreadyMarked++; continue; }
    try {
      await repo.compareAndSet(door.doorId, row.revision, { ...door, readNow: true, updatedAt: at }, at);
      counts.marked++;
    } catch { counts.raced++; }
  }
  return { ...counts, doors };
}

/** The people doors over a place, as currently held. */
export async function peopleDoorsFor(repo: DoorRepository, divisions: readonly string[]): Promise<readonly DoorRecord[]> {
  return (await listDoors(repo)).doors.filter(door => peopleDoorCovers(door, divisions));
}
