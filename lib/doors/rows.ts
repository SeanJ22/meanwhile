import type { BodySourceWiring } from "../registry/source-wiring.ts";
import type { AgendaSourceType } from "../registry/types.ts";
import type { DoorRecord } from "./registry.ts";

export function wiringRowOfDoor(door: DoorRecord): BodySourceWiring | null {
  const meeting = door.meeting;
  if (meeting === null || meeting === undefined || door.bodyIds.length !== 1) return null;
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(door.config)) if (typeof value === "string") config[key] = value;
  return {
    bodyId: door.bodyIds[0],
    ocdId: door.ocdId as BodySourceWiring["ocdId"],
    agendaSourceType: meeting.agendaSourceType as AgendaSourceType,
    jurisdiction: meeting.jurisdiction,
    publishingOrg: meeting.publishingOrg,
    timeZone: meeting.timeZone,
    config,
    ...(meeting.noticeUrl === undefined ? {} : { noticeUrl: meeting.noticeUrl }),
    ...(meeting.publishesHistory === false ? { publishesHistory: false as const, historyGapReason: meeting.historyGapReason } : {}),
    verifiedAt: meeting.verifiedAt,
  };
}

/** Every host the registry's meeting doors read, so a door with a new host needs no edit to a host list. */
export function meetingDoorHosts(doors: readonly DoorRecord[]): string[] {
  const hosts = new Set<string>();
  for (const door of doors) {
    if (door.meeting == null) continue;
    for (const host of door.hosts) hosts.add(host);
  }
  return [...hosts].sort();
}

/** The wiring rows the registry's meeting doors describe, one per body and source type. */
export function wiringRowsFromDoors(doors: readonly DoorRecord[]): BodySourceWiring[] {
  const rows = new Map<string, BodySourceWiring>();
  for (const door of doors) {
    if (door.status === "SUSPENDED") continue;
    if (door.meeting == null) continue;
    const row = wiringRowOfDoor(door);
    if (row === null) continue;
    // One wiring row can produce several doors (one per source it feeds); they carry the same row.
    rows.set(`${row.bodyId}\u0000${row.agendaSourceType}\u0000${JSON.stringify(sortedConfig(row))}`, row);
  }
  return [...rows.values()].sort(compareRows);
}

export function compareRows(a: BodySourceWiring, b: BodySourceWiring): number {
  return a.bodyId < b.bodyId ? -1 : a.bodyId > b.bodyId ? 1 : a.agendaSourceType < b.agendaSourceType ? -1 : a.agendaSourceType > b.agendaSourceType ? 1 : 0;
}

function sortedConfig(row: BodySourceWiring): Record<string, string> {
  return Object.fromEntries(Object.entries(row.config).sort(([a], [b]) => (a < b ? -1 : 1)));
}
