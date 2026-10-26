import { type DoorRecord } from "../../doors/registry.ts";
import { hoursBetween, shutDoorFixWords } from "../../doors/shut-repair.ts";
import type { AdminV6StuckItem } from "./v6-stuck-read.ts";

export { readAdminShutDoors as readShutDoorRecords } from "./door-queries.ts";

const DAY_HOURS = 24;

/** Longest shut first. A door with no recorded shut time sorts last among them and says so. */
export function shutDoorItems(doors: readonly DoorRecord[], nowIso: string): readonly AdminV6StuckItem[] {
  return doors.filter((d) => d.status === "SHUT")
    .map((d) => ({ d, hours: d.shutSince === null ? null : hoursBetween(d.shutSince, nowIso) }))
    .sort((a, b) => (b.hours ?? -1) - (a.hours ?? -1) || a.d.doorId.localeCompare(b.d.doorId))
    .map(({ d, hours }): AdminV6StuckItem => {
      const words = shutDoorFixWords(d);
      const age = hours === null ? "for an unknown time" : hours < 1 ? "since just now" : hours < DAY_HOURS ? `for ${Math.floor(hours)} hours` : `for ${Math.floor(hours / DAY_HOURS)} days`;
      return {
        id: `door:${d.doorId}`, title: d.hosts.length > 0 ? `The source at ${d.hosts[0]} is shut` : "A source is shut", applies: [], lane: "auto",
        cause: words.says, age, ageRank: hours === null ? 0 : Math.floor(hours / DAY_HOURS),
        tried: d.lastFailureAt === null ? "—" : `Last failed read at ${d.lastFailureAt}.`, helped: "—",
        next: "A detective looks for where it publishes now; editing its record repairs it with no release.",
        owner: "The factory", readersAffected: true, group: "shut-door", actions: [],
      };
    });
}
